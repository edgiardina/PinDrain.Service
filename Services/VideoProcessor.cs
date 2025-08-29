using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenCvSharp;
using PinDrain.Service.Cv;
using PinDrain.Service.Models;
using System.Diagnostics;

namespace PinDrain.Service.Services;

public sealed class VideoProcessor : BackgroundService
{
    private readonly EventHub _hub;
    private readonly StatsService _stats;
    private readonly ProfileStore _profiles;
    private readonly IServiceProvider _services; // optional SettingsStore
    private readonly ILogger<VideoProcessor> _log;
    private readonly DebugState _debug;

    // Tunables - relaxed for better drain detection
    private const int FPS_TARGET = 30;
    private const double MIN_AREA = 8, MAX_AREA = 600;    // lowered MIN_AREA, raised MAX_AREA
    private const double ROUND_MIN = 0.4;                 // much more permissive circularity
    private const float VY_MIN = 0.8f;                    // allow slower downward movement
    private const int COOLDOWN_MS = 400;                  // shorter cooldown

    // Foreground / nudge control - kept for nudge suppression
    private const int BGS_HISTORY = 600;                  // slightly lower for more responsiveness
    private const double BGS_VARTHRESH = 20;              // lower = more sensitive to movement
    private const bool BGS_SHADOWS = true;                // shadow value=127 (ignored by threshold 200)
    private const double NUDGE_FG_FRACTION = 0.25;        // higher threshold for nudge detection
    private const int NUDGE_SUPPRESS_MS = 250;            // shorter suppression window

    // Fallback source selection when SettingsStore is not registered
    private readonly int _deviceIndex = 0; // OBS Virtual Cam usually 0/1
    private readonly string? _filePath = null; // e.g., "C:/clips/pinball.mp4" to test

    public VideoProcessor(EventHub hub, StatsService stats, ProfileStore profiles, IServiceProvider services, ILogger<VideoProcessor> log, DebugState debug)
    {
        _hub = hub; _stats = stats; _profiles = profiles; _services = services; _log = log; _debug = debug;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Load active profiles
            CameraProfile cam; GameProfile game;
            try { (cam, game) = _profiles.GetActive(); }
            catch { await Task.Delay(2000, stoppingToken); return; }

            // Open capture first to know source size
            using var cap = OpenCaptureOptional();
            if (cap is null || !cap.IsOpened()) { _log.LogWarning("Video source not opened"); return; }
            var capW = (int)cap.Get(VideoCaptureProperties.FrameWidth);
            var capH = (int)cap.Get(VideoCaptureProperties.FrameHeight);
            var capFps = cap.Get(VideoCaptureProperties.Fps);

            // Homography and masks
            using var H = Homography.ComputeHomography(cam.Quad, game.Canonical, cam.Scene, capW, capH);
            using var mL = new RoiMask("L", game.Canonical, game.Rois["leftOutlane"]);
            using var mC = new RoiMask("C", game.Canonical, game.Rois["centerDrain"]);
            using var mR = new RoiMask("R", game.Canonical, game.Rois["rightOutlane"]);
            var rois = new[] { mL, mC, mR };
            using var roiUnion = new Mat(game.Canonical.Height, game.Canonical.Width, MatType.CV_8UC1, Scalar.Black);
            Cv2.BitwiseOr(mL.Mask, mC.Mask, roiUnion);
            Cv2.BitwiseOr(roiUnion, mR.Mask, roiUnion);
            int roiArea = Math.Max(1, Cv2.CountNonZero(roiUnion));

            _log.LogInformation("Capture: {W}x{H} @ {FPS:0.##}fps; Quad scaled from scene {SW}x{SH}", capW, capH, capFps, cam.Scene?.Width, cam.Scene?.Height);

            using var bgs = BackgroundSubtractorMOG2.Create(history: BGS_HISTORY, varThreshold: BGS_VARTHRESH, detectShadows: BGS_SHADOWS);
            var tracker = new CentroidTracker();

            var lastFire = new Dictionary<string, DateTimeOffset> {
                ["L"] = DateTimeOffset.MinValue,
                ["C"] = DateTimeOffset.MinValue,
                ["R"] = DateTimeOffset.MinValue,
            };

            var delay = TimeSpan.FromMilliseconds(1000.0 / FPS_TARGET);
            using var frame = new Mat();
            using var canon = new Mat(game.Canonical.Height, game.Canonical.Width, MatType.CV_8UC3);
            using var fg = new Mat();
            using var bin = new Mat();

            // per-second diagnostics
            var sw = Stopwatch.StartNew();
            int frames = 0, contoursSum = 0, detsSum = 0, tracksSum = 0, drainsSum = 0;
            DateTimeOffset suppressUntil = DateTimeOffset.MinValue;

            while (!stoppingToken.IsCancellationRequested)
            {
                if (!cap.Read(frame) || frame.Empty()) { await Task.Delay(delay, stoppingToken); continue; }
                frames++;

                // warp to canonical
                Cv2.WarpPerspective(frame, canon, H, new OpenCvSharp.Size(game.Canonical.Width, game.Canonical.Height), InterpolationFlags.Linear);

                // foreground mask
                bgs.Apply(canon, fg);
                Cv2.Threshold(fg, bin, 200, 255, ThresholdTypes.Binary); // ignore shadows (127)
                Cv2.MedianBlur(bin, bin, 3);

                // restrict analysis to union of ROIs to reduce false positives
                Cv2.BitwiseAnd(bin, roiUnion, bin);

                // nudge suppression: if too many fg pixels in ROI area at once, skip for a short time
                var nz = Cv2.CountNonZero(bin);
                if (nz > roiArea * NUDGE_FG_FRACTION)
                {
                    suppressUntil = DateTimeOffset.UtcNow.AddMilliseconds(NUDGE_SUPPRESS_MS);
                }
                if (DateTimeOffset.UtcNow < suppressUntil)
                {
                    if (sw.ElapsedMilliseconds >= 1000)
                    {
                        _log.LogInformation("fps={FPS}, nudge-suppressed", frames);
                        sw.Restart(); frames = contoursSum = detsSum = tracksSum = drainsSum = 0;
                    }
                    await Task.Delay(delay, stoppingToken);
                    continue;
                }

                // contours
                Cv2.FindContours(bin, out var contours, out _, RetrievalModes.External, ContourApproximationModes.ApproxSimple);
                contoursSum += contours.Length;

                var dets = new List<Point2f>();
                foreach (var c in contours)
                {
                    var area = Cv2.ContourArea(c);
                    if (area < MIN_AREA || area > MAX_AREA) continue;
                    var peri = Cv2.ArcLength(c, true);
                    if (peri <= 0) continue;
                    var circ = 4 * Math.PI * area / (peri * peri);
                    if (circ < ROUND_MIN) continue;
                    var m = Cv2.Moments(c);
                    if (m.M00 == 0) continue;
                    dets.Add(new Point2f((float)(m.M10 / m.M00), (float)(m.M01 / m.M00)));
                }
                detsSum += dets.Count;

                var tracks = tracker.Update(dets);
                var trackList = tracks as IList<Track> ?? tracks.ToList();
                tracksSum += trackList.Count;

                foreach (var t in trackList)
                {
                    if (!t.HasVelocity || t.Vy <= VY_MIN) continue; // downward only, but allow slower movement
                    var lane = WhichRoi(t.X, t.Y, rois);
                    if (lane == null) continue;
                    var last = lastFire[lane];
                    if (DateTimeOffset.UtcNow - last < TimeSpan.FromMilliseconds(COOLDOWN_MS)) continue;
                    lastFire[lane] = DateTimeOffset.UtcNow;
                    var ev = DrainEvent.Auto(lane, conf: 0.8);
                    drainsSum++;
                    await _stats.AddAsync(ev);
                    await _hub.BroadcastAsync(ev);
                }

                // annotate and store debug frame (downsampled for size)
                using (var dbg = canon.Clone())
                {
                    // draw ROI outlines
                    foreach (var m in rois)
                    {
                        var contoursRoi = Cv2.FindContoursAsArray(m.Mask, RetrievalModes.External, ContourApproximationModes.ApproxSimple);
                        Cv2.DrawContours(dbg, contoursRoi, -1, m.Name switch { "L" => Scalar.LightSkyBlue, "C" => Scalar.LightCoral, _ => Scalar.LightGreen }, 2);
                    }
                    // draw tracks
                    foreach (var t in trackList)
                    {
                        Cv2.Circle(dbg, (int)Math.Round(t.X), (int)Math.Round(t.Y), 6, Scalar.Yellow, 2);
                    }
                    // encode
                    Cv2.Resize(dbg, dbg, new OpenCvSharp.Size(canon.Cols/2, canon.Rows/2));
                    Cv2.ImEncode(".png", dbg, out var png);
                    _debug.SetFrame(png, dbg.Cols, dbg.Rows, frames, contoursSum, detsSum, tracksSum, drainsSum);
                }

                if (sw.ElapsedMilliseconds >= 1000)
                {
                    _log.LogInformation("fps={FPS}, contours/f={CF:0.0}, dets/f={DF:0.0}, tracks/f={TF:0.0}, drains/s={Dr}",
                        frames, contoursSum / (double)frames, detsSum / (double)frames, tracksSum / (double)frames, drainsSum);
                    sw.Restart(); frames = contoursSum = detsSum = tracksSum = drainsSum = 0;
                }

                await Task.Delay(delay, stoppingToken);
            }
        }
        catch (Exception ex)
        {
            try { _log.LogError(ex, "VideoProcessor failed"); } catch { /* ignore */ }
        }
    }

    private VideoCapture? OpenCaptureOptional()
    {
        try
        {
            var settings = _services.GetService(typeof(SettingsStore)) as SettingsStore;
            if (settings is null)
            {
                // fallback
                return _filePath is { Length: > 0 } ? new VideoCapture(_filePath) : new VideoCapture(_deviceIndex);
            }
            var vs = settings.GetVideo();
            return vs.Mode switch
            {
                "device" => new VideoCapture(vs.DeviceId ?? _deviceIndex),
                "file"   => new VideoCapture(vs.FilePath ?? string.Empty),
                "url"    => new VideoCapture(vs.StreamUrl ?? string.Empty),
                _ => new VideoCapture(vs.DeviceId ?? _deviceIndex)
            };
        }
        catch
        {
            return null;
        }
    }

    private static string? WhichRoi(float x, float y, RoiMask[] masks)
    {
        foreach (var m in masks)
        {
            var px = (int)Math.Clamp(Math.Round(x), 0, m.Mask.Cols - 1);
            var py = (int)Math.Clamp(Math.Round(y), 0, m.Mask.Rows - 1);
            if (m.Mask.At<byte>(py, px) > 0) return m.Name;
        }
        return null;
    }
}

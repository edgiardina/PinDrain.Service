using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenCvSharp;
using PinDrain.Service.Cv;
using PinDrain.Service.Models;

namespace PinDrain.Service.Services;

public sealed class VideoProcessor : BackgroundService
{
    private readonly EventHub _hub;
    private readonly StatsService _stats;
    private readonly ProfileStore _profiles;
    private readonly IServiceProvider _services; // optional SettingsStore
    private readonly ILogger<VideoProcessor> _log;

    // Tunables
    private const int FPS_TARGET = 30;
    private const double MIN_AREA = 15, MAX_AREA = 400;
    private const double ROUND_MIN = 0.65; // circularity
    private const int COOLDOWN_MS = 600;

    // Fallback source selection when SettingsStore is not registered
    private readonly int _deviceIndex = 0; // OBS Virtual Cam usually 0/1
    private readonly string? _filePath = null; // e.g., "C:/clips/pinball.mp4" to test

    public VideoProcessor(EventHub hub, StatsService stats, ProfileStore profiles, IServiceProvider services, ILogger<VideoProcessor> log)
    {
        _hub = hub; _stats = stats; _profiles = profiles; _services = services; _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Load active profiles
            CameraProfile cam; GameProfile game;
            try { (cam, game) = _profiles.GetActive(); }
            catch { await Task.Delay(2000, stoppingToken); return; }

            // Compute homography and masks
            using var H = Homography.ComputeHomography(cam.Quad, game.Canonical);
            using var mL = new RoiMask("L", game.Canonical, game.Rois["leftOutlane"]);
            using var mC = new RoiMask("C", game.Canonical, game.Rois["centerDrain"]);
            using var mR = new RoiMask("R", game.Canonical, game.Rois["rightOutlane"]);
            var rois = new[] { mL, mC, mR };

            // Open capture: try SettingsStore if available, else fallback
            using var cap = OpenCaptureOptional();
            if (cap is null || !cap.IsOpened()) return;

            using var bgs = BackgroundSubtractorMOG2.Create(history: 500, varThreshold: 16, detectShadows: false);
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

            while (!stoppingToken.IsCancellationRequested)
            {
                if (!cap.Read(frame) || frame.Empty()) { await Task.Delay(delay, stoppingToken); continue; }

                // warp to canonical
                Cv2.WarpPerspective(frame, canon, H, new OpenCvSharp.Size(game.Canonical.Width, game.Canonical.Height), InterpolationFlags.Linear);

                // foreground mask
                bgs.Apply(canon, fg);
                Cv2.Threshold(fg, bin, 200, 255, ThresholdTypes.Binary);
                Cv2.MedianBlur(bin, bin, 3);

                // contours
                Cv2.FindContours(bin, out var contours, out _, RetrievalModes.External, ContourApproximationModes.ApproxSimple);
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

                var tracks = tracker.Update(dets);
                foreach (var t in tracks)
                {
                    if (!t.HasVelocity || t.Vy <= 1.0f) continue; // downward only
                    var lane = WhichRoi(t.X, t.Y, rois);
                    if (lane == null) continue;
                    var last = lastFire[lane];
                    if (DateTimeOffset.UtcNow - last < TimeSpan.FromMilliseconds(COOLDOWN_MS)) continue;
                    lastFire[lane] = DateTimeOffset.UtcNow;
                    var ev = DrainEvent.Auto(lane, conf: 0.8);
                    await _stats.AddAsync(ev);
                    await _hub.BroadcastAsync(ev);
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

using OpenCvSharp;
using ModelSize = PinDrain.Service.Models.Size;
using PinDrain.Service.Models;

namespace PinDrain.Service.Cv;

public static class Homography
{
    // Compute H mapping scene-space quad -> canonical rectangle (0,0)-(W-1,H-1).
    // If the saved camera profile had a different scene size than the current frame, scale the quad first.
    public static Mat ComputeHomography(PointF[] quad, ModelSize canonical, ModelSize? sceneSize = null, int? currentFrameWidth = null, int? currentFrameHeight = null)
    {
        var srcPts = new Point2f[4];
        for (int i = 0; i < 4; i++) srcPts[i] = new(quad[i].X, quad[i].Y);

        // Scale if we know saved scene size and current capture size
        if (sceneSize is { } s && currentFrameWidth is { } cw && currentFrameHeight is { } ch && s.Width > 0 && s.Height > 0)
        {
            var sx = cw / (float)s.Width;
            var sy = ch / (float)s.Height;
            for (int i = 0; i < 4; i++) srcPts[i] = new Point2f(srcPts[i].X * sx, srcPts[i].Y * sy);
        }

        var w = canonical.Width;
        var h = canonical.Height;
        var dst = new Point2f[]
        {
            new(0, 0),
            new(w - 1, 0),
            new(w - 1, h - 1),
            new(0, h - 1)
        };
        return Cv2.GetPerspectiveTransform(srcPts, dst);
    }
}

public sealed class RoiMask : IDisposable
{
    public string Name { get; }
    public Mat Mask { get; }

    public RoiMask(string name, ModelSize canonical, float[][] polygon)
    {
        Name = name;
        Mask = new Mat(canonical.Height, canonical.Width, MatType.CV_8UC1, Scalar.Black);
        if (polygon.Length == 0) return;
        var pts = polygon.Select(p => new Point(p[0], p[1])).ToArray();
        Point[][] arr = [pts];
        Cv2.FillPoly(Mask, arr, Scalar.White);
    }

    public void Dispose()
    {
        Mask.Dispose();
    }
}

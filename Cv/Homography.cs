using OpenCvSharp;
using ModelSize = PinDrain.Service.Models.Size;
using PinDrain.Service.Models;

namespace PinDrain.Service.Cv;

public static class Homography
{
    // Compute H mapping scene-space quad -> canonical rectangle (0,0)-(W,H).
    public static Mat ComputeHomography(PointF[] quad, ModelSize canonical)
    {
        if (quad.Length != 4) throw new ArgumentException("quad must have 4 points TL,TR,BR,BL");
        var src = new Point2f[]
        {
            new(quad[0].X, quad[0].Y),
            new(quad[1].X, quad[1].Y),
            new(quad[2].X, quad[2].Y),
            new(quad[3].X, quad[3].Y),
        };
        var w = canonical.Width;
        var h = canonical.Height;
        var dst = new Point2f[]
        {
            new(0, 0),
            new(w, 0),
            new(w, h),
            new(0, h)
        };
        return Cv2.GetPerspectiveTransform(src, dst);
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

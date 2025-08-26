using OpenCvSharp;

namespace PinDrain.Service.Cv;

public sealed class Track
{
    public int Id { get; init; }
    public float X { get; set; }
    public float Y { get; set; }
    public float Vx { get; set; }
    public float Vy { get; set; }
    public bool HasVelocity { get; set; }
    public int Age { get; set; }
}

public sealed class CentroidTracker
{
    private readonly float _maxDistSq;
    private readonly int _maxAge;
    private int _nextId = 1;
    private readonly List<Track> _tracks = new();

    public CentroidTracker(int maxDistancePx = 40, int maxAgeFrames = 8)
    {
        _maxDistSq = maxDistancePx * maxDistancePx;
        _maxAge = maxAgeFrames;
    }

    public IEnumerable<Track> Update(IEnumerable<Point2f> detections)
    {
        var dets = detections.ToList();

        // mark all tracks as aged
        foreach (var t in _tracks) t.Age++;

        // greedy nearest neighbor matching
        var usedDet = new bool[dets.Count];
        foreach (var t in _tracks)
        {
            int best = -1; float bestDist = float.MaxValue;
            for (int i = 0; i < dets.Count; i++)
            {
                if (usedDet[i]) continue;
                var dx = dets[i].X - t.X; var dy = dets[i].Y - t.Y;
                var d2 = dx*dx + dy*dy;
                if (d2 < bestDist && d2 <= _maxDistSq) { bestDist = d2; best = i; }
            }
            if (best >= 0)
            {
                var p = dets[best]; usedDet[best] = true; t.Age = 0;
                var vx = p.X - t.X; var vy = p.Y - t.Y;
                t.HasVelocity = MathF.Abs(vx) + MathF.Abs(vy) > 0.01f;
                t.Vx = vx; t.Vy = vy; t.X = p.X; t.Y = p.Y;
            }
        }

        // create new tracks for unmatched detections
        for (int i = 0; i < dets.Count; i++)
        {
            if (usedDet[i]) continue;
            var p = dets[i];
            _tracks.Add(new Track { Id = _nextId++, X = p.X, Y = p.Y, HasVelocity = false, Vx = 0, Vy = 0, Age = 0 });
        }

        // drop old tracks
        _tracks.RemoveAll(t => t.Age > _maxAge);
        return _tracks.ToArray();
    }
}

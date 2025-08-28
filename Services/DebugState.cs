namespace PinDrain.Service.Services;

public sealed class DebugState
{
    private byte[]? _png;
    private readonly object _lock = new();

    public (byte[]? Png, int Width, int Height, DateTimeOffset Ts, int Frames, int Contours, int Dets, int Tracks, int Drains) Snapshot { get; private set; }

    public void SetFrame(byte[] png, int width, int height, int frames, int contours, int dets, int tracks, int drains)
    {
        lock (_lock)
        {
            _png = png;
            Snapshot = (png, width, height, DateTimeOffset.UtcNow, frames, contours, dets, tracks, drains);
        }
    }

    public byte[]? GetLastPng()
    {
        lock (_lock) { return _png; }
    }
}

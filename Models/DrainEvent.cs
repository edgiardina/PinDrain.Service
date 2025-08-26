namespace PinDrain.Service.Models;

public record DrainEvent(string Type, string Lane, double Confidence, DateTimeOffset Ts, string Source)
{
    public static DrainEvent Auto(string lane, double conf)
        => new("drain", lane, conf, DateTimeOffset.UtcNow, "auto");
    public static DrainEvent Manual(string lane)
        => new("drain", lane, 1.0, DateTimeOffset.UtcNow, "manual");
}

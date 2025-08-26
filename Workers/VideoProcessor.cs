using PinDrain.Service.Models;
using PinDrain.Service.Services;

namespace PinDrain.Service.Workers;

public sealed class VideoProcessor : BackgroundService
{
    private readonly EventHub _hub;
    private readonly StatsService _stats;
    private static readonly string[] Lanes = ["L","C","R"];
    private readonly Random _rng = new();
    public VideoProcessor(EventHub hub, StatsService stats) { _hub = hub; _stats = stats; }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            var lane = Lanes[_rng.Next(0, Lanes.Length)];
            var ev = DrainEvent.Auto(lane, conf: Math.Round(_rng.NextDouble()*0.4 + 0.6, 2));
            await _stats.AddAsync(ev);
            await _hub.BroadcastAsync(ev);
        }
    }
}

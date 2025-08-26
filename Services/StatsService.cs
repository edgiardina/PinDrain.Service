using PinDrain.Service.Models;

namespace PinDrain.Service.Services;

public sealed class StatsService
{
    private int _l, _c, _r;
    public Task AddAsync(DrainEvent ev)
    {
        switch (ev.Lane)
        {
            case "L": Interlocked.Increment(ref _l); break;
            case "C": Interlocked.Increment(ref _c); break;
            case "R": Interlocked.Increment(ref _r); break;
        }
        return Task.CompletedTask;
    }
    public Task ResetAsync() { _l = _c = _r = 0; return Task.CompletedTask; }
    public Task<object> GetSessionStatsAsync()
    {
        var total = Math.Max(1, _l + _c + _r);
        var dto = new {
            total,
            lanes = new {
                L = new { count = _l, pct = Math.Round(_l * 100.0 / total, 1) },
                C = new { count = _c, pct = Math.Round(_c * 100.0 / total, 1) },
                R = new { count = _r, pct = Math.Round(_r * 100.0 / total, 1) }
            }
        };
        return Task.FromResult<object>(dto);
    }
}

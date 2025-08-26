using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PinDrain.Service.Services;

public sealed class EventHub
{
    private static readonly JsonSerializerOptions Camel = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new();

    public async Task<Guid> AddAsync(WebSocket socket)
    {
        var id = Guid.NewGuid();
        _clients[id] = socket;
        var hello = Encoding.UTF8.GetBytes("{\"type\":\"hello\"}");
        await socket.SendAsync(hello, WebSocketMessageType.Text, true, CancellationToken.None);
        return id;
    }
    public Task RemoveAsync(Guid id)
    {
        if (_clients.TryRemove(id, out var sock)) sock.Dispose();
        return Task.CompletedTask;
    }
    public async Task BroadcastAsync<T>(T payload)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(payload, Camel);
        foreach (var (id, socket) in _clients)
        {
            if (socket.State != WebSocketState.Open) { await RemoveAsync(id); continue; }
            try { await socket.SendAsync(json, WebSocketMessageType.Text, true, CancellationToken.None); }
            catch { await RemoveAsync(id); }
        }
    }
}

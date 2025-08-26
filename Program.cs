using Microsoft.Extensions.FileProviders;
using System.Net.WebSockets;
using PinDrain.Service.Models;
using PinDrain.Service.Services;
using PinDrain.Service.Workers;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls("http://localhost:5173");

builder.Services.AddSingleton<EventHub>();
builder.Services.AddSingleton<StatsService>();
builder.Services.AddHostedService<VideoProcessor>();

var app = builder.Build();

var overlayPath = Path.Combine(AppContext.BaseDirectory, "Overlay");
app.UseDefaultFiles(new DefaultFilesOptions {
    FileProvider = new PhysicalFileProvider(overlayPath),
    RequestPath = "/overlay"
});
app.UseStaticFiles(new StaticFileOptions {
    FileProvider = new PhysicalFileProvider(overlayPath),
    RequestPath = "/overlay"
});

app.UseWebSockets();

app.Map("/ws", async (HttpContext ctx, EventHub hub) =>
{
    if (ctx.WebSockets.IsWebSocketRequest)
    {
        using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
        var id = await hub.AddAsync(socket);
        try
        {
            var buffer = new byte[4096];
            while (socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(buffer, ctx.RequestAborted);
                if (result.MessageType == WebSocketMessageType.Close) break;
            }
        }
        finally
        {
            await hub.RemoveAsync(id);
        }
    }
    else
    {
        ctx.Response.StatusCode = 400;
    }
});

app.MapPost("/api/override", async (OverrideRequest req, EventHub hub, StatsService stats) =>
{
    var ev = DrainEvent.Manual(req.Lane);
    await stats.AddAsync(ev);
    await hub.BroadcastAsync(ev);
    return Results.Ok();
});

app.MapGet("/api/stats", async (StatsService stats) => Results.Json(await stats.GetSessionStatsAsync()));
app.MapPost("/api/session/reset", async (StatsService stats) => { await stats.ResetAsync(); return Results.Ok(); });

await app.RunAsync();

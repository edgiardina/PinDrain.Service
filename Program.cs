using Microsoft.Extensions.FileProviders;
using System.Net.WebSockets;
using PinDrain.Service.Models;
using PinDrain.Service.Services;
using PinDrain.Service.Workers;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls("http://localhost:5173");

builder.Services.AddSingleton<EventHub>();
builder.Services.AddSingleton<StatsService>();
builder.Services.AddSingleton<ProfileStore>();
// Use the heuristic VideoProcessor in Services (new implementation)
builder.Services.AddHostedService<PinDrain.Service.Services.VideoProcessor>();

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

// friendly route without .html extension
app.MapGet("/overlay/calibrate", async ctx => {
    ctx.Response.ContentType = "text/html";
    await ctx.Response.SendFileAsync(Path.Combine(overlayPath, "calibrate.html"));
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

// Profiles API
app.MapGet("/api/profiles", (ProfileStore s) => Results.Json(s.List()));
app.MapPost("/api/profiles/camera", (ProfileStore s, CameraProfile p) => { s.SaveCamera(p); return Results.Ok(); });
app.MapPost("/api/profiles/game",   (ProfileStore s, GameProfile p)   => { s.SaveGame(p); return Results.Ok(); });
app.MapPost("/api/profiles/activate", (ProfileStore s, ActivateRequest r) => { s.Activate(r); return Results.Ok(); });

await app.RunAsync();

using Microsoft.Extensions.FileProviders;
using System.Net.WebSockets;
using PinDrain.Service.Models;
using PinDrain.Service.Services;
using PinDrain.Service.Workers;
using OpenCvSharp;
using PinDrain.Service.Cv;
using ModelSize = PinDrain.Service.Models.Size;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls("http://localhost:5173");

builder.Services.AddSingleton<EventHub>();
builder.Services.AddSingleton<StatsService>();
builder.Services.AddSingleton<ProfileStore>();
//builder.Services.AddSingleton<SettingsStore>();
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

// Calibrate warp endpoint: accept base64 PNG, quad and canonical size, return warped PNG
app.MapPost("/api/calibrate/warp", async (CalibrateWarpRequest req) =>
{
    try
    {
        var w = req.Canonical.Width; var h = req.Canonical.Height;
        // strip data URL prefix if present
        var b64 = req.ImageBase64;
        var comma = b64.IndexOf(',');
        if (comma >= 0) b64 = b64[(comma + 1)..];
        var bytes = Convert.FromBase64String(b64);
        using var src = Cv2.ImDecode(bytes, ImreadModes.Color);
        if (src.Empty()) return Results.BadRequest("Invalid image");
        using var H = Homography.ComputeHomography(req.Quad, req.Canonical);
        using var dst = new Mat(h, w, MatType.CV_8UC3);
        Cv2.WarpPerspective(src, dst, H, new OpenCvSharp.Size(w, h), InterpolationFlags.Linear);
        Cv2.ImEncode(".png", dst, out var png);
        return Results.File(png, "image/png");
    }
    catch (Exception ex)
    {
        return Results.BadRequest(ex.Message);
    }
});

await app.RunAsync();

public record CalibrateWarpRequest(ModelSize Canonical, PointF[] Quad, string ImageBase64);

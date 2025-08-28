using System.Text.Json;

namespace PinDrain.Service.Services;

public sealed class SettingsStore
{
    private readonly string _path;
    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    public SettingsStore(IHostEnvironment env)
    {
        var root = Path.Combine(env.ContentRootPath, "Profiles");
        Directory.CreateDirectory(root);
        _path = Path.Combine(root, "video.settings.json");
    }

    public VideoSettings GetVideo()
    {
        try
        {
            if (!File.Exists(_path)) return VideoSettings.Default();
            var json = File.ReadAllText(_path);
            return JsonSerializer.Deserialize<VideoSettings>(json) ?? VideoSettings.Default();
        }
        catch { return VideoSettings.Default(); }
    }

    public void SaveVideo(VideoSettings settings)
    {
        try
        {
            var json = JsonSerializer.Serialize(settings, JsonOpts);
            File.WriteAllText(_path, json);
        }
        catch { /* ignore */ }
    }
}

public record VideoSettings(
    string Mode,
    int? DeviceId,
    string? FilePath,
    string? StreamUrl,
    int? Width,
    int? Height,
    int? Fps,
    bool FlipH,
    bool FlipV,
    int Rotate
)
{
    public static VideoSettings Default() => new("device", 0, null, null, null, null, null, false, false, 0);
}

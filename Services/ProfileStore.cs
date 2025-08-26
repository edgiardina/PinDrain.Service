using System.Text.Json;
using PinDrain.Service.Models;

namespace PinDrain.Service.Services;

public sealed class ProfileStore
{
    private readonly string _root;
    private readonly string _cams;
    private readonly string _games;
    private readonly string _active;

    public ProfileStore(IHostEnvironment env)
    {
        _root = Path.Combine(env.ContentRootPath, "Profiles");
        _cams = Path.Combine(_root, "Cameras");
        _games = Path.Combine(_root, "Games");
        _active = Path.Combine(_root, "active.json");
        Directory.CreateDirectory(_cams);
        Directory.CreateDirectory(_games);
    }

    public async Task<object> ListAsync()
    {
        var cams = Directory.EnumerateFiles(_cams, "*.json").Select(File.ReadAllText).Select(j => JsonSerializer.Deserialize<CameraProfile>(j, JsonDefaults.Options))!.Where(x => x != null).ToArray();
        var games = Directory.EnumerateFiles(_games, "*.json").Select(File.ReadAllText).Select(j => JsonSerializer.Deserialize<GameProfile>(j, JsonDefaults.Options))!.Where(x => x != null).ToArray();
        ActiveProfile? active = null;
        if (File.Exists(_active))
        {
            active = JsonSerializer.Deserialize<ActiveProfile>(await File.ReadAllTextAsync(_active), JsonDefaults.Options);
        }
        return new { cameras = cams, games, active };
    }

    public async Task SaveCameraAsync(CameraProfile profile)
    {
        var path = Path.Combine(_cams, $"cam-{San(profile.id)}.json");
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(profile, JsonDefaults.Options));
    }

    public async Task SaveGameAsync(GameProfile profile)
    {
        var path = Path.Combine(_games, $"game-{San(profile.id)}.json");
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(profile, JsonDefaults.Options));
    }

    public async Task ActivateAsync(ActiveProfile req)
    {
        await File.WriteAllTextAsync(_active, JsonSerializer.Serialize(req, JsonDefaults.Options));
    }

    private static string San(string s)
        => string.Join('-', s.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();
}

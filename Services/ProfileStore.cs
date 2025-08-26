using System.Text.Json;
using PinDrain.Service.Models;

namespace PinDrain.Service.Services;

public sealed class ProfileStore
{
    private readonly string _root;
    private readonly string _camsDir;
    private readonly string _gamesDir;
    private readonly string _activePath;
    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    public ProfileStore(IHostEnvironment env)
    {
        _root = Path.Combine(env.ContentRootPath, "Profiles");
        _camsDir = Path.Combine(_root, "Cameras");
        _gamesDir = Path.Combine(_root, "Games");
        _activePath = Path.Combine(_root, "active.json");
        Directory.CreateDirectory(_camsDir);
        Directory.CreateDirectory(_gamesDir);
    }

    public object List()
    {
        var cams = Directory.EnumerateFiles(_camsDir, "cam-*.json")
            .Select(Path.GetFileNameWithoutExtension)
            .Select(n => n!.Substring("cam-".Length))
            .OrderBy(s => s)
            .ToArray();
        var games = Directory.EnumerateFiles(_gamesDir, "game-*.json")
            .Select(Path.GetFileNameWithoutExtension)
            .Select(n => n!.Substring("game-".Length))
            .OrderBy(s => s)
            .ToArray();
        string? active = null;
        if (File.Exists(_activePath))
        {
            var a = JsonSerializer.Deserialize<ActivateRequest>(File.ReadAllText(_activePath));
            if (a != null) active = $"{a.CameraId}:{a.GameId}";
        }
        return new { cams, games, active };
    }

    public void SaveCamera(CameraProfile p)
    {
        var path = Path.Combine(_camsDir, $"cam-{San(p.Id)}.json");
        File.WriteAllText(path, JsonSerializer.Serialize(p, JsonOpts));
    }

    public void SaveGame(GameProfile p)
    {
        var path = Path.Combine(_gamesDir, $"game-{San(p.Id)}.json");
        File.WriteAllText(path, JsonSerializer.Serialize(p, JsonOpts));
    }

    public void Activate(ActivateRequest r)
    {
        File.WriteAllText(_activePath, JsonSerializer.Serialize(r, JsonOpts));
    }

    public (CameraProfile cam, GameProfile game) GetActive()
    {
        if (!File.Exists(_activePath)) throw new InvalidOperationException("active.json not found");
        var active = JsonSerializer.Deserialize<ActivateRequest>(File.ReadAllText(_activePath))
                     ?? throw new InvalidOperationException("Invalid active.json");
        var camPath = Path.Combine(_camsDir, $"cam-{San(active.CameraId)}.json");
        var gamePath = Path.Combine(_gamesDir, $"game-{San(active.GameId)}.json");
        if (!File.Exists(camPath)) throw new FileNotFoundException("Camera profile not found", camPath);
        if (!File.Exists(gamePath)) throw new FileNotFoundException("Game profile not found", gamePath);
        var cam = JsonSerializer.Deserialize<CameraProfile>(File.ReadAllText(camPath))
                  ?? throw new InvalidOperationException("Invalid camera profile JSON");
        var game = JsonSerializer.Deserialize<GameProfile>(File.ReadAllText(gamePath))
                  ?? throw new InvalidOperationException("Invalid game profile JSON");
        return (cam, game);
    }

    private static string San(string s)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var ch in s)
        {
            sb.Append(Array.IndexOf(invalid, ch) >= 0 ? '_' : ch);
        }
        return sb.ToString();
    }
}

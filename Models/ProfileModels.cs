using System.Text.Json;
using System.Text.Json.Serialization;

namespace PinDrain.Service.Models;

public record CameraProfile(
    string id,
    string name,
    double[][] quad
);

public record GameProfile(
    string id,
    string name,
    CanonicalSize canonical,
    Dictionary<string, double[][]> rois
);

public record CanonicalSize(int width, int height);

public record ActiveProfile(string cameraId, string gameId);

public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true
    };
}

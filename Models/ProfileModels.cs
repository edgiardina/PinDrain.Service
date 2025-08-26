using System.Text.Json;
using System.Text.Json.Serialization;

namespace PinDrain.Service.Models;

public record Size(int Width, int Height);
public record PointF(float X, float Y);

// Quad points are TL, TR, BR, BL in scene space (clockwise).
public record CameraProfile(string Id, string Name, Size Canonical, PointF[] Quad);

// ROIs are polygons in canonical space: [[x,y], ...].
public record GameProfile(string Id, string Name, Size Canonical, Dictionary<string, float[][]> Rois);

public record ActivateRequest(string CameraId, string GameId);

public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true
    };
}

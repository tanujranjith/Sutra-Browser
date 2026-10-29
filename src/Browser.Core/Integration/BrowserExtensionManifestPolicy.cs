using System.Text.Json;

namespace Browser.Core.Integration;

public sealed record BrowserExtensionManifestInfo(string Name, string Version, IReadOnlyList<string> Permissions);

/// <summary>Bounds the extension details shown to the user before a local extension is installed.</summary>
public static class BrowserExtensionManifestPolicy
{
    public const int MaximumManifestBytes = 256 * 1024;
    private const int MaximumPermissions = 80;

    public static bool TryParse(string? json, out BrowserExtensionManifestInfo? manifest)
    {
        manifest = null;
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaximumManifestBytes) return false;
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 12 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("manifest_version", out var versionElement) ||
                versionElement.ValueKind != JsonValueKind.Number ||
                !versionElement.TryGetInt32(out var manifestVersion) || manifestVersion is not (2 or 3) ||
                !root.TryGetProperty("name", out var nameElement) || nameElement.ValueKind != JsonValueKind.String ||
                !root.TryGetProperty("version", out var extensionVersion) || extensionVersion.ValueKind != JsonValueKind.String) return false;
            var name = nameElement.GetString()?.Trim();
            var version = extensionVersion.GetString()?.Trim();
            if (string.IsNullOrWhiteSpace(name) || name.Length > 120 || string.IsNullOrWhiteSpace(version) || version.Length > 40) return false;

            var permissions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var field in new[] { "permissions", "host_permissions", "optional_permissions", "optional_host_permissions" })
            {
                if (!root.TryGetProperty(field, out var values)) continue;
                if (values.ValueKind != JsonValueKind.Array) return false;
                foreach (var value in values.EnumerateArray())
                {
                    if (value.ValueKind != JsonValueKind.String) return false;
                    var permission = value.GetString()?.Trim();
                    if (string.IsNullOrWhiteSpace(permission) || permission.Length > 500) return false;
                    permissions.Add(permission);
                    if (permissions.Count > MaximumPermissions) return false;
                }
            }
            manifest = new(name, version, permissions.Order(StringComparer.OrdinalIgnoreCase).ToArray());
            return true;
        }
        catch (JsonException) { return false; }
    }
}

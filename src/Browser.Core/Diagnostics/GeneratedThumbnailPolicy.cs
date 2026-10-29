namespace Browser.Core.Diagnostics;

public static class GeneratedThumbnailPolicy
{
    public static bool IsOwnedPath(string directory, Guid tabId, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        try
        {
            var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            if (!string.Equals(Path.GetDirectoryName(Path.GetFullPath(path)), Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory)), comparison)) return false;
            var name = Path.GetFileName(path);
            if (name.Equals($"thumb-{tabId:N}.png", StringComparison.Ordinal)) return true;
            var prefix = $"thumb-{tabId:N}-";
            return name.StartsWith(prefix, StringComparison.Ordinal) && name.EndsWith(".jpg", StringComparison.Ordinal) &&
                name.Length == prefix.Length + 32 + 4 && name.AsSpan(prefix.Length, 32).ToString().All(Uri.IsHexDigit);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { return false; }
    }
}

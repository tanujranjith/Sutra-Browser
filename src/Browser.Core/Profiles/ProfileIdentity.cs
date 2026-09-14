using System.Security.Cryptography;
using System.Text;

namespace Browser.Core.Profiles;

public static class ProfileIdentity
{
    public static string Normalize(string? name)
    {
        name = name?.Trim();
        if (string.IsNullOrWhiteSpace(name)) return "Default";
        if (name.Length > 40 || !name.All(c => char.IsLetterOrDigit(c) || c is ' ' or '-' or '_'))
            throw new ArgumentException("Use a profile name of up to 40 letters, numbers, spaces, hyphens, or underscores.", nameof(name));
        return name.Equals("Default", StringComparison.OrdinalIgnoreCase) ? "Default" : name;
    }

    public static string DirectoryKey(string name) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Normalize(name).ToUpperInvariant())));

    // Preserve existing simple ASCII profiles; never collapse punctuation or Unicode names together.
    public static string WebViewName(string name)
    {
        name = Normalize(name);
        return name.All(c => c <= 127) ? "Sutra-" + name : "Sutra-~" + DirectoryKey(name)[..56];
    }
}

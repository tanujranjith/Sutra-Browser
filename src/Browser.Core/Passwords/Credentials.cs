namespace Browser.Core.Passwords;

public sealed record CredentialMetadata(Guid Id, string Origin, string Username, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record CredentialSecret(string Username, string Password);

public interface ISecureCredentialStore
{
    Task SaveAsync(Guid id, CredentialSecret secret, CancellationToken cancellationToken = default);
    Task<CredentialSecret?> GetAsync(Guid id, CancellationToken cancellationToken = default);
    Task DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}

public static class CredentialOrigin
{
    public static string Normalize(string origin)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || string.IsNullOrWhiteSpace(uri.Host))
            throw new ArgumentException("Credentials require a valid HTTPS origin.", nameof(origin));
        var port = uri.IsDefaultPort ? string.Empty : $":{uri.Port}";
        return $"https://{uri.IdnHost.ToLowerInvariant()}{port}";
    }

    public static bool IsExactMatch(string storedOrigin, Uri page) => page.Scheme == Uri.UriSchemeHttps &&
        string.Equals(Normalize(storedOrigin), Normalize(page.GetLeftPart(UriPartial.Authority)), StringComparison.Ordinal);
}

public static class PasswordGenerator
{
    private const string Upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    private const string Lower = "abcdefghijkmnopqrstuvwxyz";
    private const string Digits = "23456789";
    private const string Symbols = "!@#$%^&*-_=+";

    public static string Generate(int length = 20)
    {
        length = Math.Clamp(length, 12, 128);
        var required = new[] { Pick(Upper), Pick(Lower), Pick(Digits), Pick(Symbols) };
        var all = Upper + Lower + Digits + Symbols;
        var chars = required.Concat(Enumerable.Range(0, length - required.Length).Select(_ => Pick(all))).ToArray();
        System.Security.Cryptography.RandomNumberGenerator.Shuffle(chars.AsSpan());
        return new string(chars);
    }

    private static char Pick(string source) => source[System.Security.Cryptography.RandomNumberGenerator.GetInt32(source.Length)];
}

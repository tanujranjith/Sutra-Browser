using System.Security.Cryptography;
using System.Text;

namespace Browser.Core.Updates;

public sealed record BrowserUpdateManifest(
    string Version,
    string InstallerUrl,
    string Sha256,
    string UpstreamCommit,
    string PublishedAt,
    string Signature)
{
    public string SignedPayload => string.Join('\n', Version, InstallerUrl, Sha256.ToLowerInvariant(), UpstreamCommit.ToLowerInvariant(), PublishedAt);

    public bool Verify(RSA signer, Uri expectedReleaseOrigin)
    {
        if (string.IsNullOrWhiteSpace(Version) || string.IsNullOrWhiteSpace(InstallerUrl) ||
            string.IsNullOrWhiteSpace(Sha256) || string.IsNullOrWhiteSpace(UpstreamCommit) ||
            string.IsNullOrWhiteSpace(PublishedAt) || string.IsNullOrWhiteSpace(Signature) ||
            !System.Version.TryParse(Version, out _) || !Uri.TryCreate(InstallerUrl, UriKind.Absolute, out var assetUri) ||
            assetUri.Scheme != Uri.UriSchemeHttps || !assetUri.Host.Equals(expectedReleaseOrigin.Host, StringComparison.OrdinalIgnoreCase) ||
            !assetUri.IsDefaultPort || !string.IsNullOrEmpty(assetUri.Query) || !string.IsNullOrEmpty(assetUri.Fragment) ||
            !assetUri.AbsolutePath.StartsWith("/tanujranjith/Sutra-Browser/releases/download/", StringComparison.Ordinal) ||
            !string.IsNullOrEmpty(assetUri.UserInfo) ||
            !assetUri.AbsolutePath.EndsWith("/SutraBrowserSetup.exe", StringComparison.OrdinalIgnoreCase) ||
            Sha256.Length != 64 || !Sha256.All(Uri.IsHexDigit) || UpstreamCommit.Length != 40 || !UpstreamCommit.All(Uri.IsHexDigit) ||
            !DateTimeOffset.TryParse(PublishedAt, out _) || Signature.Length > 2048) return false;
        try
        {
            var bytes = Convert.FromBase64String(Signature);
            return signer.VerifyData(Encoding.UTF8.GetBytes(SignedPayload), bytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        }
        catch (FormatException) { return false; }
    }
}

namespace Browser.Core.Navigation;

/// <summary>
/// Limits compact authentication windows to known HTTPS identity-provider hosts.
/// All other page-requested windows stay in the browser's normal tab workflow.
/// </summary>
public static class AuthenticationPopupPolicy
{
    private static readonly string[] TrustedHosts =
    [
        "accounts.google.com",
        "accounts.youtube.com",
        "login.microsoftonline.com",
        "login.live.com",
        "appleid.apple.com"
    ];

    public static bool ShouldOpenInAuthenticationWindow(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || !uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            return false;

        return TrustedHosts.Any(host =>
            uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase) ||
            uri.Host.EndsWith('.' + host, StringComparison.OrdinalIgnoreCase));
    }
}

namespace Browser.Core.Navigation;

public static class UrlSanitizer
{
    private static readonly HashSet<string> TrackingParameters = new(StringComparer.OrdinalIgnoreCase)
    {
        "fbclid", "gclid", "dclid", "msclkid", "yclid", "twclid", "igshid",
        "mc_cid", "mc_eid", "mkt_tok", "vero_conv", "vero_id", "ref_src", "ref_url"
    };

    public static string RemoveTrackingParameters(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return value;
        var kept = new List<string>();
        foreach (var part in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var equals = part.IndexOf('=');
            var encodedName = equals < 0 ? part : part[..equals];
            var name = Uri.UnescapeDataString(encodedName.Replace('+', ' '));
            if (name.StartsWith("utm_", StringComparison.OrdinalIgnoreCase) || TrackingParameters.Contains(name)) continue;
            kept.Add(part);
        }

        var builder = new UriBuilder(uri) { Query = string.Join('&', kept) };
        return builder.Uri.AbsoluteUri;
    }
}

using System.Globalization;
using System.Net;

namespace Browser.Core.Privacy;

/// <summary>Uses the Mozilla Public Suffix List for deterministic first/third-party classification.</summary>
public static class PublicSuffixDomains
{
    private sealed record Rules(HashSet<string> Exact, HashSet<string> Wildcard, HashSet<string> Exceptions);
    private static readonly Lazy<Rules> List = new(Load);

    public static string RegistrableDomain(string host)
    {
        host = host.Trim().TrimEnd('.').ToLowerInvariant();
        if (IPAddress.TryParse(host, out _) || !host.Contains('.')) return host;
        try { host = new IdnMapping().GetAscii(host); } catch (ArgumentException) { return host; }
        var labels = host.Split('.');
        var suffixLength = 1;
        var rules = List.Value;
        for (var i = 0; i < labels.Length; i++)
        {
            var suffix = string.Join('.', labels[i..]);
            if (rules.Exceptions.Contains(suffix)) return string.Join('.', labels[i..]);
            if (rules.Exact.Contains(suffix)) suffixLength = Math.Max(suffixLength, labels.Length - i);
            if (i > 0 && rules.Wildcard.Contains(suffix)) suffixLength = Math.Max(suffixLength, labels.Length - i + 1);
        }
        return string.Join('.', labels[Math.Max(0, labels.Length - suffixLength - 1)..]);
    }

    private static Rules Load()
    {
        var rules = new Rules(new(StringComparer.OrdinalIgnoreCase), new(StringComparer.OrdinalIgnoreCase), new(StringComparer.OrdinalIgnoreCase));
        using var stream = typeof(PublicSuffixDomains).Assembly.GetManifestResourceStream("Browser.Core.Privacy.public_suffix_list.dat")
            ?? throw new InvalidOperationException("The bundled Public Suffix List is unavailable.");
        using var reader = new StreamReader(stream);
        var idn = new IdnMapping();
        while (reader.ReadLine() is { } raw)
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith("//", StringComparison.Ordinal)) continue;
            var target = line.StartsWith('!') ? rules.Exceptions : line.StartsWith("*.", StringComparison.Ordinal) ? rules.Wildcard : rules.Exact;
            var name = line.TrimStart('!', '*', '.');
            try { target.Add(idn.GetAscii(name)); } catch (ArgumentException) { }
        }
        return rules;
    }
}

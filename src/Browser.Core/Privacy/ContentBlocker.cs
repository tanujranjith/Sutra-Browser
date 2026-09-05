namespace Browser.Core.Privacy;

public sealed class ContentBlockRuleSet
{
    private readonly HashSet<string> _blockedDomains;
    private readonly HashSet<string> _allowedDomains;
    private readonly IReadOnlyList<PathRule> _blockedPaths;
    private readonly IReadOnlyList<PathRule> _allowedPaths;
    private readonly IReadOnlyList<string> _globalSelectors;
    private readonly IReadOnlyDictionary<string, IReadOnlyList<string>> _domainSelectors;

    private ContentBlockRuleSet(HashSet<string> blockedDomains, HashSet<string> allowedDomains,
        IReadOnlyList<PathRule> blockedPaths, IReadOnlyList<PathRule> allowedPaths,
        IReadOnlyList<string> globalSelectors, IReadOnlyDictionary<string, IReadOnlyList<string>> domainSelectors)
    {
        _blockedDomains = blockedDomains;
        _allowedDomains = allowedDomains;
        _blockedPaths = blockedPaths;
        _allowedPaths = allowedPaths;
        _globalSelectors = globalSelectors;
        _domainSelectors = domainSelectors;
    }

    public int NetworkRuleCount => _blockedDomains.Count + _allowedDomains.Count + _blockedPaths.Count + _allowedPaths.Count;
    public int CosmeticRuleCount => _globalSelectors.Count + _domainSelectors.Values.Sum(x => x.Count);

    public static ContentBlockRuleSet Parse(IEnumerable<string> lines)
    {
        var blocked = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var blockedPaths = new List<PathRule>();
        var allowedPaths = new List<PathRule>();
        var globalSelectors = new HashSet<string>(StringComparer.Ordinal);
        var domainSelectors = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0 || line[0] is '!' or '[') continue;
            var cosmetic = line.IndexOf("##", StringComparison.Ordinal);
            if (cosmetic >= 0)
            {
                var selector = line[(cosmetic + 2)..].Trim();
                if (!SafeSelector(selector)) continue;
                var domains = line[..cosmetic].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                if (domains.Length == 0) globalSelectors.Add(selector);
                foreach (var scopeDomain in domains.Where(x => !x.StartsWith('~')))
                {
                    var clean = scopeDomain.TrimStart('.').ToLowerInvariant();
                    if (!ValidDomain(clean)) continue;
                    if (!domainSelectors.TryGetValue(clean, out var selectors)) domainSelectors[clean] = selectors = new(StringComparer.Ordinal);
                    selectors.Add(selector);
                }
                continue;
            }

            var exception = line.StartsWith("@@||", StringComparison.Ordinal);
            var markerLength = exception ? 4 : line.StartsWith("||", StringComparison.Ordinal) ? 2 : 0;
            if (markerLength == 0) continue;
            var remainder = line[markerLength..];
            var options = remainder.IndexOf('$');
            if (options >= 0) remainder = remainder[..options];
            var slash = remainder.IndexOf('/');
            if (slash > 0)
            {
                var pathDomain = remainder[..slash].TrimStart('.').ToLowerInvariant();
                var pattern = remainder[slash..].TrimEnd('|');
                if (ValidDomain(pathDomain) && pattern.Length is > 1 and < 1000)
                    (exception ? allowedPaths : blockedPaths).Add(new(pathDomain, pattern));
                continue;
            }
            var end = remainder.IndexOfAny(['^', '|']);
            var domain = (end < 0 ? remainder : remainder[..end]).TrimStart('.').ToLowerInvariant();
            if (!ValidDomain(domain)) continue;
            (exception ? allowed : blocked).Add(domain);
        }

        return new(blocked, allowed, blockedPaths, allowedPaths, globalSelectors.ToList(),
            domainSelectors.ToDictionary(x => x.Key, x => (IReadOnlyList<string>)x.Value.ToList(), StringComparer.OrdinalIgnoreCase));
    }

    public bool ShouldBlock(Uri resource)
    {
        if (resource.Scheme is not ("http" or "https") || string.IsNullOrWhiteSpace(resource.Host)) return false;
        if (_allowedPaths.Any(rule => rule.Matches(resource))) return false;
        if (_allowedDomains.Any(domain => DomainMatches(resource.Host, domain))) return false;
        return _blockedDomains.Any(domain => DomainMatches(resource.Host, domain)) || _blockedPaths.Any(rule => rule.Matches(resource));
    }

    public IReadOnlyList<string> CosmeticSelectorsFor(string host)
    {
        var selectors = new HashSet<string>(_globalSelectors, StringComparer.Ordinal);
        foreach (var (domain, values) in _domainSelectors)
            if (DomainMatches(host, domain)) selectors.UnionWith(values);
        return selectors.Take(500).ToList();
    }

    public static bool DomainMatches(string host, string domain) =>
        host.Equals(domain, StringComparison.OrdinalIgnoreCase) || host.EndsWith('.' + domain, StringComparison.OrdinalIgnoreCase);

    private static bool ValidDomain(string value) => value.Length is > 2 and < 254 && value.Contains('.') &&
        value.All(c => char.IsLetterOrDigit(c) || c is '-' or '.');
    private static bool SafeSelector(string value) => value.Length is > 0 and < 500 &&
        !value.Contains('{') && !value.Contains('}') && !value.Contains("url(", StringComparison.OrdinalIgnoreCase) && !value.StartsWith('@');

    private sealed record PathRule(string Domain, string Pattern)
    {
        public bool Matches(Uri resource) => DomainMatches(resource.Host, Domain) && WildcardMatch(resource.PathAndQuery, Pattern);

        private static bool WildcardMatch(string value, string pattern)
        {
            if (!pattern.Contains('*')) return value.Contains(pattern.Replace("^", ""), StringComparison.OrdinalIgnoreCase);
            var pieces = pattern.Split('*', StringSplitOptions.RemoveEmptyEntries);
            var position = 0;
            foreach (var raw in pieces)
            {
                var piece = raw.Replace("^", "");
                var next = value.IndexOf(piece, position, StringComparison.OrdinalIgnoreCase);
                if (next < 0) return false;
                position = next + piece.Length;
            }
            return true;
        }
    }
}

public static class BuiltInContentFilters
{
    public static IReadOnlyList<string> Rules { get; } =
    [
        "||doubleclick.net^", "||doubleclickbygoogle.com^", "||googlesyndication.com^", "||googlesyndication.com/pagead/",
        "||googleadservices.com^", "||googleadservices.com/pagead/", "||adservice.google.com^", "||adservice.google.com/pagead/",
        "||google-analytics.com^", "||googletagmanager.com^", "||facebook.net^", "||hotjar.com^",
        "||branch.io^", "||appsflyer.com^", "||moatads.com^", "||segment.io^", "||mixpanel.com^",
        "||amazon-adsystem.com^", "||adsrvr.org^", "||adnxs.com^", "||criteo.com^", "||criteo.net^",
        "||taboola.com^", "||outbrain.com^", "||scorecardresearch.com^", "||quantserve.com^",
        "||demdex.net^", "||optimizely.com^", "||smartadserver.com^", "||serving-sys.com^",
        "||smaato.net^", "||rubiconproject.com^", "||openx.net^", "||pubmatic.com^", "||casalemedia.com^",
        "||bidswitch.net^", "||sharethrough.com^", "||advertising.com^", "||zedo.com^", "||yieldmo.com^",
        "||adroll.com^", "||adform.net^", "||adkernel.com^", "||adzerk.net^", "||lijit.com^",
        "||ad-delivery.net^", "||pubnative.net^", "||tritondigital.com^", "||indexww.com^", "||ads.linkedin.com^",
        "||youtube.com/ads?", "||youtube.com/get_video_info", "||youtube.com/api/stats/ads",
        "||googlevideo.com/pagead/", "||youtubei.googleapis.com/youtubei/v1/next?",
        "##iframe[id^='google_ads']", "##div[id^='google_ads']", "##[data-ad-container]", "##[data-ad-slot]",
        "##[data-ad-client]", "##[data-testid*='ad-']", "##.adsbygoogle", "##.ad-banner", "##.ad-container",
        "##.advertisement", "##iframe[src*='doubleclick']", "##iframe[src*='googlesyndication']",
        "youtube.com##ytd-display-ad-renderer", "youtube.com##ytd-promoted-sparkles-web-renderer", "youtube.com##ytd-ad-slot-renderer",
        "youtube.com##ytd-promoted-video-renderer", "youtube.com##ytd-promoted-sparkles-text-search-renderer",
        "youtube.com##.ytp-ad-overlay-container", "youtube.com##.ytp-ad-overlay-slot", "youtube.com##.ytp-ad-skip-button",
        "youtube.com##.ytp-ad-preview-container", "youtube.com##.ytp-ad-text", "youtube.com##.ytp-ad-module",
        "youtube.com##.video-ads", "youtube.com##.ad-showing", "youtube.com##ytd-shorts-lockup-view-model",
        "youtube.com##ytd-reel-item-renderer"
    ];
}

using System.Text.RegularExpressions;

namespace Browser.Core.Privacy;

/// <summary>A bounded ABP-style filter set. Unsupported ABP syntax is ignored safely.</summary>
public sealed class ContentBlockRuleSet
{
    private readonly IReadOnlyList<NetworkRule> _networkRules;
    private readonly IReadOnlyList<NetworkRule> _genericNetworkRules;
    private readonly Dictionary<string, NetworkRule[]> _hostNetworkRules;
    private readonly IReadOnlyList<CosmeticRule> _cosmeticRules;

    private ContentBlockRuleSet(IReadOnlyList<NetworkRule> networkRules, IReadOnlyList<CosmeticRule> cosmeticRules)
    {
        _networkRules = networkRules;
        _genericNetworkRules = networkRules.Where(x => x.DomainAnchor is null).ToArray();
        _hostNetworkRules = networkRules.Where(x => x.DomainAnchor is not null).GroupBy(x => x.DomainAnchor!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.ToArray(), StringComparer.OrdinalIgnoreCase);
        _cosmeticRules = cosmeticRules;
    }

    public int NetworkRuleCount => _networkRules.Count;
    public int CosmeticRuleCount => _cosmeticRules.Count(x => !x.IsException);

    public static ContentBlockRuleSet Parse(IEnumerable<string> lines)
    {
        var network = new List<NetworkRule>();
        var cosmetic = new List<CosmeticRule>();
        foreach (var source in lines.Distinct(StringComparer.Ordinal).Take(250_000))
        {
            if (source is null || source.Length > 4096) continue;
            var line = source.Trim();
            if (line.Length == 0 || line[0] is '!' or '[' || line.StartsWith("@@$", StringComparison.Ordinal)) continue;

            var cosmeticMarker = line.IndexOf("#@#", StringComparison.Ordinal);
            var exception = cosmeticMarker >= 0;
            if (!exception) cosmeticMarker = line.IndexOf("##", StringComparison.Ordinal);
            if (cosmeticMarker >= 0)
            {
                var selector = line[(cosmeticMarker + (exception ? 3 : 2))..].Trim();
                if (!ElementHideRuleSet.IsSafeSelector(selector)) continue;
                var domains = line[..cosmeticMarker].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var included = new List<string>();
                var excluded = new List<string>();
                foreach (var rawDomain in domains)
                {
                    var domain = rawDomain.TrimStart('~', '.').ToLowerInvariant();
                    if (ValidDomain(domain)) (rawDomain.StartsWith('~') ? excluded : included).Add(domain);
                }
                if (domains.Length == 0 || included.Count + excluded.Count > 0) cosmetic.Add(new(included.ToArray(), excluded.ToArray(), selector, exception));
                continue;
            }

            if (line.StartsWith('!')) continue;
            var allow = line.StartsWith("@@", StringComparison.Ordinal);
            if (allow) line = line[2..];
            var optionsAt = line.IndexOf('$');
            // A regex may contain the end anchor '$' inside its /.../ delimiters.
            // Options begin after the closing delimiter, not at that anchor.
            if (line.StartsWith('/'))
            {
                var closingSlash = line.LastIndexOf('/');
                if (closingSlash > 0 && (closingSlash == line.Length - 1 || line[closingSlash + 1] == '$'))
                    optionsAt = closingSlash == line.Length - 1 ? -1 : closingSlash + 1;
            }
            var optionText = optionsAt >= 0 ? line[(optionsAt + 1)..] : string.Empty;
            if (optionsAt >= 0) line = line[..optionsAt];
            if (line.Length is 0 or > 1000) continue;
            if (!line.StartsWith('/') && line.Any(c => char.IsWhiteSpace(c) || c is '<' or '>')) continue;

            var types = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var excludedTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var includedDomains = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var excludedDomains = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            bool? thirdParty = null;
            var matchCase = false;
            var unsupported = false;
            foreach (var rawOption in optionText.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var option = rawOption.ToLowerInvariant();
                if (option == "third-party") thirdParty = true;
                else if (option == "~third-party") thirdParty = false;
                else if (option == "match-case") matchCase = true;
                else if (option is "collapse" or "~collapse") { }
                else if (option.StartsWith("domain=", StringComparison.Ordinal))
                {
                    foreach (var domainOption in option[7..].Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    {
                        var excluded = domainOption.StartsWith('~');
                        var domain = domainOption.TrimStart('~', '.');
                        if (!ValidDomain(domain)) { unsupported = true; continue; }
                        (excluded ? excludedDomains : includedDomains).Add(domain);
                    }
                }
                else
                {
                    var excluded = option.StartsWith('~');
                    var type = excluded ? option[1..] : option;
                    if (KnownTypes.Contains(type)) (excluded ? excludedTypes : types).Add(type);
                    else unsupported = true; // Never broaden a rule by dropping an unknown restriction or action.
                }
            }
            if (unsupported) continue;
            var onlyDomainTypes = optionText.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Any(x => KnownTypes.Contains(x.TrimStart('~').ToLowerInvariant()));
            var rule = NetworkRule.TryCreate(line, allow, types, excludedTypes, onlyDomainTypes, includedDomains, excludedDomains, thirdParty, matchCase);
            if (rule is not null) network.Add(rule);
        }
        return new(network, cosmetic);
    }

    public bool ShouldBlock(Uri resource) => ShouldBlock(resource, resource.Host, string.Empty);

    public bool ShouldBlock(Uri resource, string documentHost, string resourceType)
    {
        if (resource.Scheme is not ("http" or "https") || string.IsNullOrWhiteSpace(resource.Host)) return false;
        var allow = false;
        var block = false;
        foreach (var rule in NetworkCandidates(resource.Host))
        {
            if (!rule.Matches(resource, documentHost, resourceType)) continue;
            if (rule.IsException) allow = true;
            else block = true;
        }
        return block && !allow;
    }

    public IReadOnlyList<string> CosmeticSelectorsFor(string host)
    {
        var selectors = new HashSet<string>(StringComparer.Ordinal);
        var exceptions = new HashSet<string>(StringComparer.Ordinal);
        foreach (var rule in _cosmeticRules)
        {
            if (rule.IncludedDomains.Length > 0 && !rule.IncludedDomains.Any(x => DomainMatches(host, x)) || rule.ExcludedDomains.Any(x => DomainMatches(host, x))) continue;
            if (rule.IsException) exceptions.Add(rule.Selector);
            else selectors.Add(rule.Selector);
        }
        selectors.ExceptWith(exceptions);
        return selectors.Take(1000).ToArray();
    }

    public static bool DomainMatches(string host, string domain) =>
        host.Equals(domain, StringComparison.OrdinalIgnoreCase) || host.EndsWith('.' + domain, StringComparison.OrdinalIgnoreCase);

    private static bool ValidDomain(string value) => value.Length is > 2 and < 254 && value.Contains('.') &&
        value.All(c => char.IsLetterOrDigit(c) || c is '-' or '.');

    private static readonly HashSet<string> KnownTypes = new(StringComparer.OrdinalIgnoreCase)
    { "document", "subdocument", "script", "stylesheet", "image", "font", "media", "xmlhttprequest", "fetch", "ping", "websocket", "other", "object", "object-subrequest" };

    private IEnumerable<NetworkRule> NetworkCandidates(string host)
    {
        foreach (var rule in _genericNetworkRules) yield return rule;
        var domain = host;
        while (domain.Length > 0)
        {
            if (_hostNetworkRules.TryGetValue(domain, out var rules)) foreach (var rule in rules) yield return rule;
            var dot = domain.IndexOf('.');
            if (dot < 0) break;
            domain = domain[(dot + 1)..];
        }
    }

    private sealed record CosmeticRule(string[] IncludedDomains, string[] ExcludedDomains, string Selector, bool IsException);

    private sealed class NetworkRule
    {
        private readonly string _pattern;
        private readonly string? _domainAnchor;
        private readonly bool _startAnchor;
        private readonly bool _endAnchor;
        private readonly HashSet<string> _types;
        private readonly HashSet<string> _excludedTypes;
        private readonly bool _hasTypeOptions;
        private readonly HashSet<string> _includedDomains;
        private readonly HashSet<string> _excludedDomains;
        private readonly bool? _thirdParty;
        private readonly bool _matchCase;
        private readonly string _literalHint;
        private readonly Regex? _regex;
        public string? DomainAnchor => _domainAnchor;
        public bool IsException { get; }

        private NetworkRule(string pattern, string? domainAnchor, bool startAnchor, bool endAnchor, bool isException,
            HashSet<string> types, HashSet<string> excludedTypes, bool hasTypeOptions,
            HashSet<string> includedDomains, HashSet<string> excludedDomains, bool? thirdParty, bool matchCase, Regex? regex)
        {
            _pattern = pattern; _domainAnchor = domainAnchor; _startAnchor = startAnchor; _endAnchor = endAnchor; IsException = isException;
            _types = types; _excludedTypes = excludedTypes; _hasTypeOptions = hasTypeOptions;
            _includedDomains = includedDomains; _excludedDomains = excludedDomains; _thirdParty = thirdParty;
            _matchCase = matchCase;
            _regex = regex;
            _literalHint = regex is null ? pattern.Split('*', '^').OrderByDescending(x => x.Length).FirstOrDefault() ?? string.Empty : string.Empty;
        }

        public static NetworkRule? TryCreate(string value, bool isException, HashSet<string> types, HashSet<string> excludedTypes,
            bool hasTypeOptions, HashSet<string> includedDomains, HashSet<string> excludedDomains, bool? thirdParty, bool matchCase)
        {
            string? domainAnchor = null;
            Regex? regex = null;
            if (value.Length > 2 && value.StartsWith('/') && value.EndsWith('/'))
            {
                try { regex = new Regex(value[1..^1], RegexOptions.CultureInvariant | RegexOptions.NonBacktracking | (matchCase ? RegexOptions.None : RegexOptions.IgnoreCase), TimeSpan.FromMilliseconds(20)); }
                catch (ArgumentException) { return null; }
                catch (NotSupportedException) { return null; }
            }
            if (value.StartsWith("||", StringComparison.Ordinal))
            {
                var rest = value[2..];
                var end = rest.IndexOfAny(['/', '^', '*', '?', '|', ':']);
                domainAnchor = (end < 0 ? rest : rest[..end]).TrimEnd('.').ToLowerInvariant();
                if (!ValidDomain(domainAnchor)) return null;
                value = end < 0 ? string.Empty : rest[end..];
            }
            var start = value.StartsWith('|');
            var endAnchor = value.EndsWith('|') && !value.EndsWith("||", StringComparison.Ordinal);
            if (start) value = value[1..];
            if (endAnchor && value.Length > 0) value = value[..^1];
            if (domainAnchor is null && value.Length == 0) return null;
            return new(value, domainAnchor, start, endAnchor, isException, types, excludedTypes, hasTypeOptions, includedDomains, excludedDomains, thirdParty, matchCase, regex);
        }

        public bool Matches(Uri resource, string documentHost, string resourceType)
        {
            var value = _domainAnchor is null ? resource.AbsoluteUri : (resource.IsDefaultPort ? "" : ":" + resource.Port) + resource.PathAndQuery;
            if (_literalHint.Length > 0 && !value.Contains(_literalHint, _matchCase ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase)) return false;
            if (_regex is not null)
            {
                try { if (!_regex.IsMatch(value)) return false; }
                catch (RegexMatchTimeoutException) { return false; }
            }
            else if (_domainAnchor is not null)
            {
                if (!DomainMatches(resource.Host, _domainAnchor)) return false;
                if (_pattern.Length > 0 && !WildcardMatch(value, _pattern, true, _endAnchor, _matchCase)) return false;
            }
            else if (!WildcardMatch(value, _pattern, _startAnchor, _endAnchor, _matchCase)) return false;

            var type = resourceType.Equals("fetch", StringComparison.OrdinalIgnoreCase) ? "xmlhttprequest" : resourceType.ToLowerInvariant();
            if (_excludedTypes.Contains(type)) return false;
            if (_hasTypeOptions && _types.Count > 0 && type.Length > 0 && !_types.Contains(type)) return false;
            if (_includedDomains.Count > 0 && !_includedDomains.Any(x => DomainMatches(documentHost, x))) return false;
            if (_excludedDomains.Any(x => DomainMatches(documentHost, x))) return false;
            if (_thirdParty is not null && IsThirdParty(resource.Host, documentHost) != _thirdParty.Value) return false;
            return true;
        }

        private static bool IsThirdParty(string resourceHost, string documentHost) =>
            !string.IsNullOrWhiteSpace(documentHost) && !SameSite(resourceHost, documentHost);
        private static bool SameSite(string a, string b)
        {
            return PublicSuffixDomains.RegistrableDomain(a).Equals(PublicSuffixDomains.RegistrableDomain(b), StringComparison.OrdinalIgnoreCase);
        }

        private static bool WildcardMatch(string value, string pattern, bool startAnchor, bool endAnchor, bool matchCase)
        {
            if (pattern.Length == 0) return true;
            var finalStart = startAnchor ? 0 : value.Length;
            for (var candidate = 0; candidate <= finalStart; candidate++)
            {
                var patternIndex = 0;
                var valueIndex = candidate;
                var lastStar = -1;
                var valueAfterStar = -1;
                while (valueIndex < value.Length)
                {
                    if (patternIndex == pattern.Length && !endAnchor) return true;
                    if (patternIndex < pattern.Length && pattern[patternIndex] == '*')
                    {
                        lastStar = patternIndex++;
                        valueAfterStar = valueIndex;
                        continue;
                    }
                    if (patternIndex < pattern.Length && (PatternCharacterMatches(pattern[patternIndex], value[valueIndex], matchCase) || pattern[patternIndex] == '^' && IsSeparator(value[valueIndex])))
                    {
                        patternIndex++;
                        valueIndex++;
                        continue;
                    }
                    if (lastStar >= 0)
                    {
                        patternIndex = lastStar + 1;
                        valueIndex = ++valueAfterStar;
                        continue;
                    }
                    break;
                }
                if (patternIndex < pattern.Length && pattern[patternIndex] == '^' && valueIndex == value.Length) patternIndex++;
                while (patternIndex < pattern.Length && pattern[patternIndex] == '*') patternIndex++;
                if (patternIndex == pattern.Length && (!endAnchor || valueIndex == value.Length)) return true;
                if (startAnchor) return false;
            }
            return pattern.Length == 0;
        }

        private static bool PatternCharacterMatches(char pattern, char value, bool matchCase) =>
            pattern != '^' && (matchCase ? pattern == value : char.ToUpperInvariant(pattern) == char.ToUpperInvariant(value));

        private static bool IsSeparator(char value) => !char.IsLetterOrDigit(value) && value is not ('_' or '-' or '.' or '%');
    }
}

public static class BuiltInContentFilters
{
    public static IReadOnlyList<string> Rules { get; } =
    [
        "||doubleclick.net^", "||doubleclickbygoogle.com^", "||googlesyndication.com^", "||googleadservices.com^",
        "||adservice.google.com^", "||google-analytics.com^", "||googletagmanager.com^", "||facebook.net^", "||hotjar.com^",
        "||branch.io^", "||appsflyer.com^", "||moatads.com^", "||segment.io^", "||mixpanel.com^", "||amazon-adsystem.com^",
        "||adsrvr.org^", "||adnxs.com^", "||criteo.com^", "||criteo.net^", "||taboola.com^", "||outbrain.com^",
        "||scorecardresearch.com^", "||quantserve.com^", "||demdex.net^", "||optimizely.com^", "||smartadserver.com^",
        "||serving-sys.com^", "||smaato.net^", "||rubiconproject.com^", "||openx.net^", "||pubmatic.com^", "||casalemedia.com^",
        "||bidswitch.net^", "||sharethrough.com^", "||advertising.com^", "||zedo.com^", "||yieldmo.com^", "||adroll.com^",
        "||adform.net^", "||adkernel.com^", "||adzerk.net^", "||lijit.com^", "||ad-delivery.net^", "||pubnative.net^",
        "||tritondigital.com^", "||indexww.com^", "||ads.linkedin.com^", "||youtube.com/ads?",
        "||youtube.com/api/stats/ads", "||googlevideo.com/pagead/",
        "@@||youtube.com/get_video_info", "@@||youtubei.googleapis.com/youtubei/v1/next?",
        "##iframe[id^='google_ads']", "##div[id^='google_ads']", "##[data-ad-container]", "##[data-ad-slot]",
        "##[data-ad-client]", "##[data-testid*='ad-']", "##.adsbygoogle", "##.ad-banner", "##.ad-container", "##.advertisement",
        "##iframe[src*='doubleclick']", "##iframe[src*='googlesyndication']", "youtube.com##ytd-display-ad-renderer",
        "youtube.com##ytd-promoted-sparkles-web-renderer", "youtube.com##ytd-ad-slot-renderer", "youtube.com##ytd-promoted-video-renderer",
        "youtube.com##ytd-promoted-sparkles-text-search-renderer", "youtube.com##.ytp-ad-overlay-container", "youtube.com##.ytp-ad-overlay-slot",
        "youtube.com##.ytp-ad-preview-container", "youtube.com##.ytp-ad-text",
        "youtube.com##ytd-shorts-lockup-view-model",
        // ad-showing belongs to the actual player, not just the advertisement.
        // Exceptions also neutralize these old rules in downloaded/backup lists.
        "youtube.com#@#.ad-showing", "youtube.com#@#.ytp-ad-skip-button",
        "youtube.com#@#.ytp-ad-module", "youtube.com#@#.video-ads",
        "youtube.com##ytd-reel-item-renderer"
    ];
}

namespace Browser.Core.Privacy;

public sealed record ElementHideRule(string Host, string Selector);

/// <summary>Local, per-host element rules created by the reversible element picker.</summary>
public static class ElementHideRuleSet
{
    public static bool IsSafeSelector(string? selector) => selector is { Length: > 0 and <= 512 } &&
        selector.All(c => char.IsLetterOrDigit(c) || c is '_' or '-' or '#' or '.' or '*' or '[' or ']' or '=' or '\'' or '"' or ' ' or '>' or '+' or ':' or '(' or ')' or ',' or '^' or '$' or '|' or '~' or '/' or '\\') &&
        !selector.Contains("url(", StringComparison.OrdinalIgnoreCase) &&
        !selector.Contains("expression", StringComparison.OrdinalIgnoreCase) &&
        !selector.Contains('{') && !selector.Contains('}') && !selector.Contains(';') && !selector.StartsWith('@');

    public static IReadOnlyList<ElementHideRule> Normalize(IEnumerable<ElementHideRule>? rules) => (rules ?? [])
        .Where(x => x is not null && IsHost(x.Host) && IsSafeSelector(x.Selector))
        .Select(x => new ElementHideRule(x.Host.Trim().TrimEnd('.').ToLowerInvariant(), x.Selector.Trim()))
        .DistinctBy(x => (x.Host, x.Selector), ElementHideKeyComparer.Instance)
        .Take(2000)
        .ToArray();

    public static IReadOnlyList<ElementHideRule> Add(IEnumerable<ElementHideRule>? rules, string host, string selector)
    {
        if (!IsHost(host) || !IsSafeSelector(selector)) return Normalize(rules);
        var next = Normalize(rules).ToList();
        var rule = new ElementHideRule(host.Trim().TrimEnd('.').ToLowerInvariant(), selector.Trim());
        if (!next.Contains(rule)) next.Add(rule);
        return next.Take(2000).ToArray();
    }

    public static IReadOnlyList<ElementHideRule> Remove(IEnumerable<ElementHideRule>? rules, string host, string selector) =>
        Normalize(rules).Where(x => !x.Host.Equals(host, StringComparison.OrdinalIgnoreCase) || !x.Selector.Equals(selector, StringComparison.Ordinal)).ToArray();

    public static IReadOnlyList<string> ForHost(IEnumerable<ElementHideRule>? rules, string host) =>
        Normalize(rules).Where(x => x.Host.Equals(host, StringComparison.OrdinalIgnoreCase)).Select(x => x.Selector).ToArray();

    private static bool IsHost(string? host) => host is { Length: > 2 and < 254 } && host.Contains('.') &&
        host.All(c => char.IsLetterOrDigit(c) || c is '-' or '.');

    private sealed class ElementHideKeyComparer : IEqualityComparer<(string Host, string Selector)>
    {
        public static ElementHideKeyComparer Instance { get; } = new();
        public bool Equals((string Host, string Selector) x, (string Host, string Selector) y) =>
            x.Host.Equals(y.Host, StringComparison.OrdinalIgnoreCase) && x.Selector.Equals(y.Selector, StringComparison.Ordinal);
        public int GetHashCode((string Host, string Selector) obj) => HashCode.Combine(StringComparer.OrdinalIgnoreCase.GetHashCode(obj.Host), StringComparer.Ordinal.GetHashCode(obj.Selector));
    }
}

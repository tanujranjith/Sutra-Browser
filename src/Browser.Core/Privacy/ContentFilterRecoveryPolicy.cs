namespace Browser.Core.Privacy;

/// <summary>Selects downloaded filter data only when it parses as a plausible list.</summary>
public static class ContentFilterRecoveryPolicy
{
    public const int MinimumAddedNetworkRules = 25;

    public static ContentBlockRuleSet Load(IEnumerable<string> builtIn, IEnumerable<string>? current, IEnumerable<string>? lastKnownGood)
    {
        var builtInRules = builtIn.ToArray();
        var baseSet = ContentBlockRuleSet.Parse(builtInRules);
        return Load(baseSet, builtInRules, current, lastKnownGood);
    }

    public static ContentBlockRuleSet Load(ContentBlockRuleSet baseSet, IReadOnlyList<string> builtInRules,
        IEnumerable<string>? current, IEnumerable<string>? lastKnownGood)
    {
        return LoadWithFallbackProvider(baseSet, builtInRules, current, () => lastKnownGood);
    }

    public static ContentBlockRuleSet LoadWithFallbackProvider(ContentBlockRuleSet baseSet, IReadOnlyList<string> builtInRules,
        IEnumerable<string>? current, Func<IEnumerable<string>?> lastKnownGoodProvider)
    {
        var currentRules = current as string[] ?? current?.ToArray() ?? [];
        var currentSet = ContentBlockRuleSet.Parse(builtInRules.Concat(currentRules));
        if (currentSet.NetworkRuleCount >= baseSet.NetworkRuleCount + MinimumAddedNetworkRules) return currentSet;
        var lastKnownGood = lastKnownGoodProvider();
        var backupRules = lastKnownGood as string[] ?? lastKnownGood?.ToArray() ?? [];
        if (backupRules.Length == 0) return baseSet;
        var backupSet = ContentBlockRuleSet.Parse(builtInRules.Concat(backupRules));
        return backupSet.NetworkRuleCount >= baseSet.NetworkRuleCount + MinimumAddedNetworkRules ? backupSet : baseSet;
    }
}

using Browser.Core.Privacy;
using Xunit;

namespace Browser.Core.Tests;

public sealed class ContentFilterRuleSetCacheTests
{
    [Fact]
    public async Task ReusesParsedRulesAndInvalidatesWhenTheActiveFileChanges()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sutra-filter-cache-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var active = Path.Combine(directory, "active.txt");
        var backup = Path.Combine(directory, "backup.txt");
        try
        {
            await File.WriteAllTextAsync(active, Rules(30));
            var simultaneousLoads = await Task.WhenAll(Enumerable.Range(0, 8)
                .Select(_ => ContentFilterRuleSetCache.LoadAsync(active, backup)));
            var first = simultaneousLoads[0];
            Assert.All(simultaneousLoads, rules => Assert.Same(first, rules));

            await File.AppendAllTextAsync(active, Environment.NewLine + "||cache-added-rule.example^");
            var afterChange = await ContentFilterRuleSetCache.LoadAsync(active, backup);
            Assert.NotSame(first, afterChange);
            Assert.True(afterChange.NetworkRuleCount > first.NetworkRuleCount);
        }
        finally { try { Directory.Delete(directory, recursive: true); } catch (IOException) { } }
    }

    [Fact]
    public async Task UsesAndCachesLastKnownGoodRulesWhenTheActiveListIsInvalid()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sutra-filter-cache-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var active = Path.Combine(directory, "active.txt");
        var backup = Path.Combine(directory, "backup.txt");
        try
        {
            await File.WriteAllTextAsync(active, "this is not a valid blocking rule");
            await File.WriteAllTextAsync(backup, Rules(30));

            var first = await ContentFilterRuleSetCache.LoadAsync(active, backup);
            var second = await ContentFilterRuleSetCache.LoadAsync(active, backup);
            Assert.Same(first, second);
            Assert.True(first.NetworkRuleCount > ContentFilterRuleSetCache.BuiltIn.NetworkRuleCount);
        }
        finally { try { Directory.Delete(directory, recursive: true); } catch (IOException) { } }
    }

    private static string Rules(int count) => string.Join(Environment.NewLine,
        Enumerable.Range(0, count).Select(index => $"||cache-rule-{index}.example^"));
}

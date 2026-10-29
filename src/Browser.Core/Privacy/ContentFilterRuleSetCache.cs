namespace Browser.Core.Privacy;

/// <summary>
/// Holds one immutable content-filter index per active/backup file version for
/// the process. Browser windows share the same filter files, so recompiling the
/// same large EasyList data in each window needlessly multiplies retained RAM.
/// </summary>
public static class ContentFilterRuleSetCache
{
    private const long MaximumFileBytes = 40_000_000;
    private const int MaximumLines = 250_000;
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly string[] BuiltInRules = BuiltInContentFilters.Rules.ToArray();
    public static ContentBlockRuleSet BuiltIn { get; } = ContentBlockRuleSet.Parse(BuiltInRules);
    private static CacheEntry? _entry;

    private readonly record struct FileStamp(string Path, long Length, long LastWriteUtcTicks);
    private readonly record struct CacheKey(FileStamp Active, FileStamp Backup);
    private sealed record CacheEntry(CacheKey Key, ContentBlockRuleSet Rules);

    public static async Task<ContentBlockRuleSet> LoadAsync(string activePath, string backupPath, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(activePath);
        ArgumentException.ThrowIfNullOrWhiteSpace(backupPath);

        var key = CreateKey(activePath, backupPath);
        var cached = Volatile.Read(ref _entry);
        if (cached is not null && cached.Key == key) return cached.Rules;

        await Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                key = CreateKey(activePath, backupPath);
                cached = Volatile.Read(ref _entry);
                if (cached is not null && cached.Key == key) return cached.Rules;

                var current = await Task.Run(() => ReadSafely(key.Active), cancellationToken).ConfigureAwait(false);
                var sourceKey = key;
                var rules = await Task.Run(
                    () => ContentFilterRecoveryPolicy.LoadWithFallbackProvider(
                        BuiltIn, BuiltInRules, current, () => ReadSafely(sourceKey.Backup)), cancellationToken)
                    .ConfigureAwait(false);

                if (CreateKey(activePath, backupPath) != sourceKey) continue;
                Volatile.Write(ref _entry, new CacheEntry(sourceKey, rules));
                return rules;
            }

            // An updater replaced a filter file repeatedly while it was being
            // read. Return a safe compiled copy without caching a stale version.
            return BuiltIn;
        }
        finally { Gate.Release(); }
    }

    private static string[] ReadSafely(FileStamp stamp)
    {
        if (stamp.Length <= 0 || stamp.Length > MaximumFileBytes) return [];
        try { return File.ReadLines(stamp.Path).Take(MaximumLines).ToArray(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException) { return []; }
    }

    private static CacheKey CreateKey(string activePath, string backupPath) => new(Stamp(activePath), Stamp(backupPath));

    private static FileStamp Stamp(string path)
    {
        var fullPath = Path.GetFullPath(path);
        try
        {
            var file = new FileInfo(fullPath);
            return file.Exists
                ? new(fullPath, file.Length, file.LastWriteTimeUtc.Ticks)
                : new(fullPath, 0, 0);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new(fullPath, -1, 0);
        }
    }
}

namespace Browser.Core.Bookmarks;

public sealed record BookmarkIdentity(long Id, long? FolderId, string Url);

public static class BookmarkMaintenancePolicy
{
    // Exact address + folder only. Query strings, fragments and path case can
    // identify different resources; folders can represent deliberate collections.
    public static IReadOnlyList<long> DuplicateIds(IEnumerable<BookmarkIdentity> items) => items.Take(10000)
        .Where(item => item.Id > 0 && !string.IsNullOrWhiteSpace(item.Url))
        .GroupBy(item => (item.FolderId, item.Url))
        .SelectMany(group => group.OrderBy(item => item.Id).Skip(1)).Select(item => item.Id).Take(200).ToArray();
}

namespace Browser.Core.Search;

/// <summary>Broader library pagination (#9). Downloads already page; this bounds every other library list.</summary>
public static class PagedQueryPolicy
{
    public const int DefaultPageSize = 50;
    public const int MaximumPageSize = 200;

    public static (int Offset, int Limit) Normalize(int page, int pageSize)
    {
        page = Math.Clamp(page, 0, 100_000);
        pageSize = Math.Clamp(pageSize, 1, MaximumPageSize);
        return (checked(page * pageSize), pageSize);
    }

    public static string EscapeLike(string value) =>
        (value ?? string.Empty).Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}

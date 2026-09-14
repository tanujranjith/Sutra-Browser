namespace Browser.Core.Tabs;

/// <summary>Persisted presentation and hibernation policy for a tab collection.</summary>
public sealed class TabGroup
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string Name { get; set; } = "New group";
    public string Color { get; set; } = "#4C8DFF";
    public bool IsCollapsed { get; set; }
    public bool NeverHibernate { get; set; }
    public string Note { get; set; } = string.Empty;
    public int SortOrder { get; set; }

    public TabGroupSnapshot ToSnapshot() => new(Id, Name, Color, IsCollapsed, NeverHibernate, SortOrder, Note);

    public static TabGroup FromSnapshot(TabGroupSnapshot? item)
    {
        if (item is null) return new();
        return new()
        {
            Id = item.Id == Guid.Empty ? Guid.NewGuid() : item.Id,
            Name = NormalizeName(item.Name),
            Color = NormalizeColor(item.Color),
            IsCollapsed = item.IsCollapsed,
            NeverHibernate = item.NeverHibernate,
            Note = NormalizeNote(item.Note),
            SortOrder = Math.Max(0, item.SortOrder)
        };
    }

    public static string NormalizeName(string? value) => string.IsNullOrWhiteSpace(value) ? "New group" : value.Trim()[..Math.Min(40, value.Trim().Length)];
    public static string NormalizeNote(string? value) => string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim()[..Math.Min(240, value.Trim().Length)];
    public static string NormalizeColor(string? value) => value is { Length: 7 } && value[0] == '#' && value.Skip(1).All(Uri.IsHexDigit) ? value.ToUpperInvariant() : "#4C8DFF";
}

public sealed record TabGroupSnapshot(Guid Id, string Name, string Color, bool IsCollapsed, bool NeverHibernate, int SortOrder, string Note = "");

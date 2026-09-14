using Browser.Core.Notes;

namespace Browser.Core.Reading;

/// <summary>Offline articles contain inert text only; never store live page HTML or scripts.</summary>
public static class OfflineArticlePolicy
{
    public const int MaximumTextLength = 250_000;
    public const int MaximumArticles = 500;
    public const int MaximumLibraryCharacters = 20_000_000;

    public static string NormalizeUrl(string url) => NoteTargets.Normalize(url);

    public static string ValidateText(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) throw new ArgumentException("The page has no readable text.", nameof(text));
        if (text.Length > MaximumTextLength) throw new ArgumentException("The article exceeds the text limit.", nameof(text));
        return text.Trim();
    }

    public static string NormalizeTitle(string title, string url) =>
        string.IsNullOrWhiteSpace(title) ? new Uri(url).Host : title.Trim()[..Math.Min(500, title.Trim().Length)];
}

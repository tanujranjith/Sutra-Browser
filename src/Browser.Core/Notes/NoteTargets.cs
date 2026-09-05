namespace Browser.Core.Notes;

/// <summary>
/// Deterministic validation and normalization for page-note targets. Notes attach
/// to a specific HTTP or HTTPS page, so the stored target must be safe to display,
/// free of embedded user information, and stable across visits. This policy lives
/// in Core so the WinUI layer cannot diverge from it.
/// </summary>
public static class NoteTargets
{
    /// <summary>Longest accepted URL after normalization. Longer pages are rejected rather than silently truncated.</summary>
    public const int MaxUrlLength = 2048;

    /// <summary>Longest optional quotation captured with a note.</summary>
    public const int MaxQuoteLength = 2000;

    /// <summary>Longest note body accepted for storage.</summary>
    public const int MaxNoteLength = 8000;

    /// <summary>
    /// Normalizes an absolute HTTP/HTTPS URL for use as a note target.
    /// The fragment is removed because a note describes the page, not one scroll
    /// position; meaningful path and query information is preserved.
    /// Returns <c>false</c> for anything that is not a plain web page URL:
    /// other schemes, relative input, embedded user information, or over-long URLs.
    /// </summary>
    public static bool TryNormalize(string? value, out string normalized)
    {
        normalized = string.Empty;
        if (string.IsNullOrWhiteSpace(value)) return false;
        value = value.Trim();
        if (value.Length > MaxUrlLength) return false;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme is not ("http" or "https")) return false;
        if (!string.IsNullOrEmpty(uri.UserInfo)) return false;
        if (string.IsNullOrWhiteSpace(uri.Host)) return false;
        // GetLeftPart(Query) keeps scheme, authority (host lowercased by Uri),
        // path, and query while dropping the fragment entirely.
        normalized = uri.GetLeftPart(UriPartial.Query);
        // A normalized fragment-free target can still exceed the limit when the
        // original was near it and Uri re-encoded characters; enforce once more
        // so callers can rely on the bound unconditionally.
        if (normalized.Length > MaxUrlLength) { normalized = string.Empty; return false; }
        return true;
    }

    /// <summary>Normalizing variant of <see cref="TryNormalize"/> that throws on invalid input.</summary>
    public static string Normalize(string value)
    {
        if (!TryNormalize(value, out var normalized))
            throw new ArgumentException("Notes require an HTTP or HTTPS page URL without embedded credentials.", nameof(value));
        return normalized;
    }

    /// <summary>Trims a captured quotation to the supported length without throwing and without splitting surrogate pairs.</summary>
    public static string ClampQuote(string? quote)
    {
        var trimmed = (quote ?? string.Empty).Trim();
        if (trimmed.Length <= MaxQuoteLength) return trimmed;
        var cut = trimmed[..MaxQuoteLength];
        // Never leave a lone high surrogate at the end; that would corrupt the text.
        if (char.IsHighSurrogate(cut[^1])) cut = cut[..^1];
        return cut;
    }
}

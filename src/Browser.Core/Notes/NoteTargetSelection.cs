namespace Browser.Core.Notes;

/// <summary>
/// Target-selection policy for the note dialog scenarios. Kept pure so the
/// WinUI layer cannot accidentally attach a note to a native manager surface or
/// let an edit drift to whichever tab happens to be selected.
/// </summary>
public static class NoteTargetSelection
{
    /// <summary>
    /// The target for editing is always the stored record's own normalized URL,
    /// regardless of which surface (for example, the notes manager page) is active.
    /// Editing must never re-target the note to the currently viewed tab.
    /// </summary>
    public static string ResolveEditTarget(string recordUrl) => NoteTargets.Normalize(recordUrl);

    /// <summary>
    /// The target for adding a new note is the actively viewed page, and only when
    /// that page can legally carry notes. Native browser surfaces (manager pages,
    /// the new tab, error documents) yield <c>null</c> instead of silently
    /// attaching the note to something unrelated.
    /// </summary>
    public static string? TryResolveAddTarget(string? activeSurfaceUrl)
        => NoteTargets.TryNormalize(activeSurfaceUrl, out var normalized) ? normalized : null;
}

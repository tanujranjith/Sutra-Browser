using System.Diagnostics;
using System.Text.Json;
using Browser.Core.Notes;
using Browser.Data.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Automation;
using Windows.System;

namespace Browser.App;

/// <summary>
/// Page Notes: local-first quotations and reminders attached to HTTP/HTTPS pages.
/// Notes are plain text only, never leave the device, and are unavailable in
/// private windows so private browsing cannot leak into persistent storage.
/// Existing notes remain readable from the private utility sidebar by design
/// (documented in docs/SECURITY.md); private windows can never create, edit,
/// or delete them.
/// </summary>
public sealed partial class MainWindow
{
    // Live views that must refresh after a note is created, edited, or deleted.
    // Both are guarded by identity/generation checks so stale references from a
    // closed or replaced surface can never overwrite current content.
    private Func<Task>? _refreshNotesManagerView;
    private ListView? _notesSidebarList;
    private int _notesSearchGeneration;

    /// <summary>The normalized note target of the selected tab, or null when the page cannot carry notes.</summary>
    private string? CurrentNoteTarget() =>
        NoteTargetSelection.TryResolveAddTarget(_vm.SelectedTab?.Url);

    // ---------------------------------------------------------------------
    // Manager page (transient native tab; never enters session restore).
    // ---------------------------------------------------------------------

    private async Task ShowNotesManagerAsync()
    {
        if (_isPrivate)
        {
            ShowPage("Notes", "Notes are stored locally so they persist between normal sessions.",
                EmptyState(Symbol.Document, "Persistent page notes are unavailable in private windows. Nothing you select or write there would be saved."));
            return;
        }

        // Capture the web page this manager was opened FROM before the manager tab
        // becomes selected. "Add note for this page" then targets that explicit
        // reference; it can never attach to the manager surface itself or drift
        // to an unrelated tab the user switches to while browsing notes.
        var originTarget = CurrentNoteTarget();

        // Invalidate any in-flight searches from a prior manager instance before
        // installing this one's loader.
        unchecked { _notesSearchGeneration++; }

        var search = new AutoSuggestBox { PlaceholderText = "Search notes", MinWidth = 260 };
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single };
        Func<Task>? load = null;
        load = async () =>
        {
            // Ignore results from superseded searches and from loaders that no
            // longer belong to the live manager view.
            var requestGeneration = ++_notesSearchGeneration;
            IReadOnlyList<PageNoteRecord> notes;
            try { notes = await _pageNotes.SearchAsync(search.Text ?? "", 200); }
            catch (Exception ex)
            {
                Debug.WriteLine($"Notes could not be loaded: {ex.GetType().Name}");
                if (!IsCurrentNotesRequest(requestGeneration)) return;
                list.Items.Clear();
                list.Items.Add(EmptyState(Symbol.Important, "Notes could not be loaded from local storage. The list will recover on the next search or reopen."));
                return;
            }
            if (!IsCurrentNotesRequest(requestGeneration) || !ReferenceEquals(_refreshNotesManagerView, load)) return;
            list.Items.Clear();
            if (notes.Count == 0)
            {
                var message = string.IsNullOrWhiteSpace(search.Text)
                    ? "No notes yet. Open a page and choose Add note for this page, then write a quotation and a reminder."
                    : $"No notes match “{search.Text}”. Try fewer words.";
                list.Items.Add(EmptyState(Symbol.Document, message));
                return;
            }
            var current = CurrentNoteTarget();
            foreach (var note in notes) list.Items.Add(NoteListItem(note, current));
        };
        bool IsCurrentNotesRequest(int generation) => generation == _notesSearchGeneration && ReferenceEquals(_refreshNotesManagerView, load);
        _refreshNotesManagerView = load;

        search.TextChanged += async (_, e) => { if (e.Reason == AutoSuggestionBoxTextChangeReason.UserInput && load is not null) await load(); };
        list.DoubleTapped += async (_, _) => await EditSelectedNoteAsync(list);
        list.KeyDown += async (_, e) =>
        {
            if (e.Key is VirtualKey.Enter or VirtualKey.Space) { await EditSelectedNoteAsync(list); e.Handled = true; }
        };

        var edit = ActionButton("Edit", Symbol.Edit, async () => await EditSelectedNoteAsync(list));
        var open = ActionButton("Open page", Symbol.OpenFile, () =>
        {
            if (list.SelectedItem is ListViewItem item && item.Tag is PageNoteRecord note)
            {
                HidePage();
                NewTab(note.Url, activate: !_vm.Settings.OpenLinksInBackground);
            }
        });
        var remove = ActionButton("Delete", Symbol.Delete, async () =>
        {
            if (list.SelectedItem is not ListViewItem item || item.Tag is not PageNoteRecord note) return;
            var host = NoteHost(note.Url);
            if (!await ConfirmAsync("Delete this note?", $"Delete the note on {host}? This removes it from local storage.", "Delete")) return;
            try
            {
                await _pageNotes.DeleteAsync(note.Id);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Note delete failed: {ex.GetType().Name}");
                ShowStatus("The note could not be deleted. It is still saved on this device.", InfoBarSeverity.Error);
                return;
            }
            ShowUndoStatus($"Deleted the note on {host}", async () =>
            {
                try
                {
                    await _pageNotes.AddAsync(note.Url, note.Quote, note.Note);
                    ShowStatus("Note restored as a new entry.", InfoBarSeverity.Success);
                }
                catch (Exception undoError)
                {
                    Debug.WriteLine($"Note undo failed: {undoError.GetType().Name}");
                    ShowStatus("The deleted note could not be restored. Its text is no longer available.", InfoBarSeverity.Error);
                    return;
                }
                await RefreshNotesSurfacesAsync();
            });
            await RefreshNotesSurfacesAsync();
        });
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        toolbar.Children.Add(search); toolbar.Children.Add(edit); toolbar.Children.Add(open); toolbar.Children.Add(remove);
        var export = ActionButton("Export results", Symbol.Upload, async () =>
        {
            var notes = list.Items.OfType<ListViewItem>().Select(x => x.Tag).OfType<PageNoteRecord>().ToList();
            if (notes.Count == 0) { ShowStatus("Search for notes to export first."); return; }
            var picker = new Windows.Storage.Pickers.FileSavePicker { SuggestedFileName = $"Sutra notes {DateTime.Now:yyyy-MM-dd}" };
            picker.FileTypeChoices.Add("Markdown", [".md"]);
            WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
            var file = await picker.PickSaveFileAsync();
            if (file is null) return;
            try
            {
                var markdown = NoteMarkdownExporter.Export(notes.Select(x => new NoteExportItem(x.Url, x.Quote, x.Note, x.UpdatedAt)));
                await File.WriteAllTextAsync(file.Path, markdown, _windowLifetimeCts.Token);
                ShowStatus($"Exported {notes.Count} notes as Markdown.", InfoBarSeverity.Success);
            }
            catch (OperationCanceledException) { }
            catch (IOException) { ShowStatus("The notes could not be exported to this file.", InfoBarSeverity.Warning); }
        });
        toolbar.Children.Add(export);
        // Only offer manager-local creation when the manager was opened from a
        // real web page; otherwise there is no honest target for a new note.
        if (originTarget is not null)
        {
            var capturedOrigin = originTarget;
            var addForOrigin = ActionButton("Add note for this page", Symbol.Edit,
                () => _ = ShowPageNoteDialogAsync(null, capturedOrigin));
            toolbar.Children.Insert(1, addForOrigin);
        }

        await load();
        ShowPage("Notes", "Quotations and reminders attached to pages, stored only on this device.", PageBody(toolbar, list), onClosed: () =>
        {
            // Retire only OUR loader: if a newer Notes page already owns the
            // field (reuse path), this closure is stale and must not clear it.
            if (!ReferenceEquals(_refreshNotesManagerView, load)) return;
            _refreshNotesManagerView = null;
            // Kill in-flight searches so they cannot update the detached view.
            unchecked { _notesSearchGeneration++; }
        });
    }

    private static ListViewItem NoteListItem(PageNoteRecord note, string? currentTarget)
    {
        var host = NoteHost(note.Url);
        var marker = string.Equals(currentTarget, note.Url, StringComparison.Ordinal) ? "  ·  current page" : string.Empty;
        var heading = FirstLine(note.Quote, 70) is { Length: > 0 } quoteLine ? quoteLine : FirstLine(note.Note, 70);
        var body = FirstLine(note.Note, 140);
        var detail = $"{host}{marker}  ·  updated {note.UpdatedAt.LocalDateTime:g}\n{body}";
        var item = new ListViewItem { Tag = note, Content = ManagerRow(heading, detail), HorizontalContentAlignment = HorizontalAlignment.Stretch };
        AutomationProperties.SetName(item, $"Note on {host}: {FirstLine(note.Note, 80)}");
        return item;
    }

    private async Task EditSelectedNoteAsync(ListView list)
    {
        if (list.SelectedItem is ListViewItem item && item.Tag is PageNoteRecord note)
            await ShowPageNoteDialogAsync(note);
    }

    // ---------------------------------------------------------------------
    // Create/edit dialog.
    // ---------------------------------------------------------------------

    /// <param name="existing">The record being edited, if any.</param>
    /// <param name="explicitTarget">
    /// An explicit HTTP/HTTPS target for a new note (for example, the page the
    /// notes manager was opened from). When omitted, the actively viewed page
    /// becomes the target — never a native browser surface.
    /// </param>
    private async Task ShowPageNoteDialogAsync(PageNoteRecord? existing, string? explicitTarget = null)
    {
        if (_isPrivate)
        {
            await NoticeAsync("Notes are unavailable in private browsing",
                "Persistent page notes are disabled here so private pages are never written to local storage. Reopen the page in a normal window to save a note.");
            return;
        }

        string target;
        string identityTitle;
        if (existing is not null)
        {
            // Editing: the stored record's own target is authoritative. The active
            // surface may be the notes manager page itself, which cannot carry
            // notes and must never become the new target.
            try { target = NoteTargetSelection.ResolveEditTarget(existing.Url); }
            catch (ArgumentException)
            {
                ShowStatus("This note's saved page link is no longer a valid web address, so it cannot be edited safely.", InfoBarSeverity.Warning);
                return;
            }
            identityTitle = NoteHost(target);
        }
        else
        {
            var resolved = explicitTarget ?? CurrentNoteTarget();
            if (resolved is null)
            {
                ShowStatus("Open an HTTP or HTTPS page before adding a note.", InfoBarSeverity.Warning);
                return;
            }
            target = resolved;
            identityTitle = NoteHost(target);
        }

        var initialQuote = existing?.Quote ?? await CaptureSelectionTextAsync();
        var identity = new StackPanel { Spacing = 2 };
        identity.Children.Add(new TextBlock { Text = identityTitle, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
        identity.Children.Add(new TextBlock { Text = target, FontSize = 12, Opacity = .62, TextWrapping = TextWrapping.Wrap });

        var quoteInput = new TextBox
        {
            Header = "Quoted text (optional)",
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            Height = 96,
            Text = initialQuote,
            MaxLength = NoteTargets.MaxQuoteLength
        };
        var noteInput = new TextBox
        {
            Header = $"Note ({NoteTargets.MaxNoteLength} characters maximum)",
            PlaceholderText = "Write what you want to remember about this page",
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = 150,
            MaxLength = NoteTargets.MaxNoteLength,
            Text = existing?.Note ?? string.Empty
        };
        var content = new StackPanel { Spacing = 10, MinWidth = 460, MaxWidth = 620 };
        content.Children.Add(identity);
        content.Children.Add(quoteInput);
        content.Children.Add(noteInput);

        var dialog = new ContentDialog
        {
            Title = existing is null ? "Add page note" : "Edit page note",
            Content = content,
            PrimaryButtonText = "Save",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = _root.XamlRoot
        };
        dialog.IsPrimaryButtonEnabled = !string.IsNullOrWhiteSpace(noteInput.Text);
        noteInput.TextChanged += (_, _) => dialog.IsPrimaryButtonEnabled = !string.IsNullOrWhiteSpace(noteInput.Text);

        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        try
        {
            // UpdateAsync changes quotation and body only; the stored target URL
            // is intentionally untouched by edits.
            if (existing is null) await _pageNotes.AddAsync(target, quoteInput.Text, noteInput.Text);
            else await _pageNotes.UpdateAsync(existing.Id, quoteInput.Text, noteInput.Text);
            ShowStatus(existing is null ? $"Note saved for {identityTitle}" : "Note updated", InfoBarSeverity.Success);
        }
        catch (ArgumentException)
        {
            ShowStatus($"A note needs text between 1 and {NoteTargets.MaxNoteLength} characters.", InfoBarSeverity.Warning);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Note save failed: {ex.GetType().Name}");
            ShowStatus("The note could not be saved to local storage.", InfoBarSeverity.Error);
            return;
        }
        await RefreshNotesSurfacesAsync();
    }

    // ---------------------------------------------------------------------
    // Selected-text capture (top-level frame only; untrusted plain text).
    // ---------------------------------------------------------------------

    private async Task<string> CaptureSelectionTextAsync()
    {
        try
        {
            var web = CurrentWebView();
            if (web?.CoreWebView2 is null || _isWindowClosed) return string.Empty;
            // String(getSelection()) returns visible plain text of the top-level
            // document selection only: no HTML, no input/password values, no
            // cross-frame content. The result arrives JSON-encoded and stays text.
            var json = await web.ExecuteScriptAsync("(String(window.getSelection())||'').slice(0,2001)");
            if (_isWindowClosed) return string.Empty;
            var text = JsonSerializer.Deserialize<string>(json);
            return NoteTargets.ClampQuote(text);
        }
        catch (Exception ex)
        {
            // Selection capture is best-effort; a note without a quote is fine.
            Debug.WriteLine($"Selection capture unavailable: {ex.GetType().Name}");
            return string.Empty;
        }
    }

    // ---------------------------------------------------------------------
    // Utility sidebar surface.
    // ---------------------------------------------------------------------

    private async Task<ListView> BuildSidebarNotesAsync()
    {
        var list = new ListView();
        _notesSidebarList = list;
        await ReloadSidebarNotesAsync(list);
        return list;
    }

    private async Task ReloadSidebarNotesAsync(ListView list)
    {
        IReadOnlyList<PageNoteRecord> notes;
        try { notes = await _pageNotes.SearchAsync("", 50); }
        catch (Exception ex)
        {
            Debug.WriteLine($"Sidebar notes unavailable: {ex.GetType().Name}");
            if (_notesSidebarList != list) return;
            list.Items.Clear();
            list.Items.Add(new TextBlock { Text = "Notes are unavailable right now.", Opacity = .65, Margin = new Thickness(10, 8, 10, 8), TextWrapping = TextWrapping.Wrap });
            return;
        }
        if (_notesSidebarList != list) return;
        list.Items.Clear();
        if (notes.Count == 0)
        {
            list.Items.Add(new TextBlock { Text = "No notes yet. Use Page tools › Add page note.", Opacity = .65, Margin = new Thickness(10, 8, 10, 8), TextWrapping = TextWrapping.Wrap });
            return;
        }
        var current = CurrentNoteTarget();
        foreach (var note in notes)
        {
            var captured = note.Url;
            var host = NoteHost(note.Url);
            var marker = string.Equals(current, note.Url, StringComparison.Ordinal) ? "  ·  current page" : string.Empty;
            list.Items.Add(SidebarItem(FirstLine(note.Quote, 60) is { Length: > 0 } q ? q : FirstLine(note.Note, 60),
                $"{host}{marker}",
                () => NewTab(captured, activate: true)));
        }
    }

    private async Task RefreshNotesSurfacesAsync()
    {
        var managerRefresh = _refreshNotesManagerView;
        if (managerRefresh is not null) await managerRefresh();
        var sidebarList = _notesSidebarList;
        if (sidebarList is not null && _utilitySidebar.Visibility == Visibility.Visible)
            await ReloadSidebarNotesAsync(sidebarList);
    }

    // ---------------------------------------------------------------------
    // Shared helpers.
    // ---------------------------------------------------------------------

    private static string NoteHost(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && !string.IsNullOrWhiteSpace(uri.Host) ? uri.Host : url;

    private static string FirstLine(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var line = value.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault() ?? string.Empty;
        return line.Length <= maxLength ? line : line[..maxLength] + "…";
    }
}

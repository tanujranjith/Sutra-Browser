using System.Text.Json;
using Browser.Core.Reading;
using Browser.Core.Search;
using Browser.Data.Repositories;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Windows.System;

namespace Browser.App;

public sealed partial class MainWindow
{
    private OfflineArticleRepository OfflineArticles => _dataServices.GetRequiredService<OfflineArticleRepository>();
    private sealed record LibraryResult(string Title, string Detail, string Kind, Func<Task> Open, int Rank);

    private async Task SaveOfflineArticleAsync()
    {
        if (_isPrivate) { ShowStatus("Saving offline articles is unavailable in private windows."); return; }
        var tab = _vm.SelectedTab;
        var web = CurrentWebView();
        if (tab is null || web?.CoreWebView2 is null || !Uri.TryCreate(tab.Url, UriKind.Absolute, out var source) || source.Scheme is not ("http" or "https"))
        { ShowStatus("Open an article on the web to save it for offline reading."); return; }
        var url = tab.Url;
        var title = tab.Title;
        try
        {
            // Only rendered text nodes; never read form values, hidden text, or editable fields.
            var raw = await web.ExecuteScriptAsync("""
                (() => {
                  const root = document.querySelector('article') || document.querySelector('main') || document.body;
                  if (!root) return '';
                  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                  const parts = []; let node, length = 0, visited = 0;
                  while ((node = walker.nextNode()) && visited++ < 50000 && length < 250000) {
                    const parent = node.parentElement;
                    if (!parent || parent.closest('script,style,noscript,input,textarea,select,button,[contenteditable],[hidden],[aria-hidden="true"]')) continue;
                    const style = getComputedStyle(parent);
                    if (style.visibility === 'hidden' || style.display === 'none' || !parent.getClientRects().length) continue;
                    const text = node.textContent.trim();
                    if (!text) continue;
                    parts.push(text); length += text.length + 2;
                  }
                  return parts.join('\n\n').slice(0,250000);
                })()
                """).AsTask().WaitAsync(TimeSpan.FromSeconds(10), _windowLifetimeCts.Token);
            if (_isWindowClosed || tab.Url != url || web.CoreWebView2?.Source != url)
            { ShowStatus("The page changed while saving. Try again on the article you want."); return; }
            var text = JsonSerializer.Deserialize<string>(raw) ?? "";
            await OfflineArticles.SaveAsync(title, url, text, _windowLifetimeCts.Token);
            ShowStatus("Article saved for offline reading. Open it from Library → Offline.", InfoBarSeverity.Success);
        }
        catch (OperationCanceledException) { }
        catch (ArgumentException) { ShowStatus("This page does not have readable article text to save.", InfoBarSeverity.Warning); }
        catch (InvalidOperationException) { ShowStatus("The offline library is full or unavailable. Remove an older article and try again.", InfoBarSeverity.Warning); }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Offline save: {ex.GetType().Name}"); ShowStatus("The article could not be saved. Try again.", InfoBarSeverity.Error); }
    }

    private async Task ShowOfflineLibraryAsync()
    {
        var search = new TextBox { PlaceholderText = "Search saved articles and their text", MaxLength = 200, MinWidth = 260 };
        AutomationProperties.SetName(search, "Search offline articles");
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, IsItemClickEnabled = true };
        var count = new TextBlock { Opacity = .72, VerticalAlignment = VerticalAlignment.Center };
        var closed = false;
        var generation = 0;
        var empty = EmptyState(Symbol.SaveLocal, "Your reading, ready anywhere. Open a web article and choose “Save for offline reading” from the browser menu.");
        var content = new Grid(); content.Children.Add(list); content.Children.Add(empty);
        async Task Load()
        {
            var version = ++generation;
            try
            {
                await Task.Delay(120, _windowLifetimeCts.Token);
                if (closed || version != generation) return;
                var articles = await OfflineArticles.SearchAsync(search.Text, _windowLifetimeCts.Token);
                if (closed || version != generation) return;
                list.Items.Clear();
                foreach (var article in articles)
                    list.Items.Add(new ListViewItem { Tag = article, Content = ManagerRow(article.Title, $"{new Uri(article.Url).Host} · Saved {article.SavedAt.LocalDateTime:d} · {Math.Max(1, article.Characters / 1200)} min read") });
                count.Text = $"{articles.Count} article{(articles.Count == 1 ? "" : "s")}";
                empty.Visibility = articles.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Offline list: {ex.GetType().Name}"); if (!closed) count.Text = "Could not load articles. Try again."; }
        }
        async Task OpenSelected() { if (list.SelectedItem is ListViewItem { Tag: OfflineArticle article }) await OpenOfflineArticleAsync(article.Id); }
        list.ItemClick += async (_, e) => { if (e.ClickedItem is ListViewItem { Tag: OfflineArticle article }) await OpenOfflineArticleAsync(article.Id); };
        list.KeyDown += async (_, e) => { if (e.Key == VirtualKey.Enter) { e.Handled = true; await OpenSelected(); } };
        var open = ActionButton("Read offline", Symbol.Read, async () => await OpenSelected());
        var delete = ActionButton("Remove", Symbol.Delete, async () =>
        {
            if (_isPrivate || list.SelectedItem is not ListViewItem { Tag: OfflineArticle article }) return;
            var saved = await OfflineArticles.GetAsync(article.Id);
            await OfflineArticles.DeleteAsync(article.Id); await Load();
            if (saved is not null) ShowUndoStatus("Offline article removed", async () => { await OfflineArticles.SaveAsync(saved.Title, saved.Url, saved.Text); if (!closed) await Load(); });
        });
        delete.IsEnabled = false; open.IsEnabled = false;
        list.SelectionChanged += (_, _) => { open.IsEnabled = list.SelectedItem is not null; delete.IsEnabled = !_isPrivate && list.SelectedItem is not null; };
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { search, open, delete, count } };
        search.TextChanged += async (_, _) => await Load();
        ShowPage("Offline library", "Saved article text, available without a connection. Images and interactive content stay on the original website.", PageBody(toolbar, content), () => { closed = true; generation++; });
        await Load();
    }

    private async Task OpenOfflineArticleAsync(long id)
    {
        var article = await OfflineArticles.GetAsync(id, _windowLifetimeCts.Token);
        if (article is null || _isWindowClosed) { if (!_isWindowClosed) ShowStatus("This saved article is no longer available."); return; }
        var text = new TextBlock { Text = article.Text, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true, FontSize = 19, LineHeight = 32, MaxWidth = 780, HorizontalAlignment = HorizontalAlignment.Center, Padding = new(8, 16, 8, 40) };
        var font = new Slider { Minimum = 14, Maximum = 28, Value = 19, Width = 140, StepFrequency = 1 };
        AutomationProperties.SetName(font, "Reading font size");
        font.ValueChanged += (_, e) => { text.FontSize = e.NewValue; text.LineHeight = e.NewValue * 1.7; };
        var online = ActionButton("Open original", Symbol.Globe, () => NewTab(article.Url));
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, Children = { online, new TextBlock { Text = "Text size", VerticalAlignment = VerticalAlignment.Center }, font } };
        ShowPage("Saved article", $"{article.Title} · {new Uri(article.Url).Host} · Saved {article.SavedAt.LocalDateTime:g}", PageBody(toolbar, new ScrollViewer { Content = text, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled }));
    }

    private async Task ShowLibrarySearchAsync()
    {
        var search = new TextBox { PlaceholderText = "Search tabs, bookmarks, history, reading list, notes, and offline articles", MaxLength = 160 };
        AutomationProperties.SetName(search, "Search your library");
        var filter = new ComboBox { ItemsSource = new[] { "Everything", "Tabs", "Bookmarks", "History", "Reading list", "Notes", "Offline", "Workspaces" }, SelectedIndex = 0, MinWidth = 150 };
        AutomationProperties.SetName(filter, "Filter library by source");
        var status = new TextBlock { Opacity = .72, VerticalAlignment = VerticalAlignment.Center };
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, IsItemClickEnabled = true };
        var empty = EmptyState(Symbol.Find, "Nothing here yet. Try another search or save a page to your library.");
        var results = new Grid(); results.Children.Add(list); results.Children.Add(empty);
        var closed = false; var generation = 0;
        async Task Load()
        {
            var version = ++generation;
            var query = search.Text.Trim();
            var source = filter.SelectedItem?.ToString() ?? "Everything";
            bool Include(string kind) => source == "Everything" || source == kind;
            try
            {
                await Task.Delay(180, _windowLifetimeCts.Token);
                if (closed || version != generation) return;
                var items = new List<LibraryResult>();
                void Add(string title, string detail, string kind, Func<Task> action, string? searchableText = null) =>
                    items.Add(new(title, detail, kind, action, TextMatchRanking.Rank(title, searchableText ?? detail, query)));
                if (Include("Tabs")) foreach (var tab in _vm.Tabs.Where(x => !IsNativePageTab(x)).ToArray())
                    if (TextMatchRanking.Rank(tab.Title, tab.Url, query) >= 0) Add(tab.Title, tab.Url, "Tabs", () => ActivateTabAsync(tab));
                if (Include("Bookmarks")) foreach (var bookmark in await _bookmarks.SearchAsync(query, _windowLifetimeCts.Token, 100))
                    Add(bookmark.Title, bookmark.Url, "Bookmarks", () => { NewTab(bookmark.Url); return Task.CompletedTask; });
                if (!_isPrivate && Include("History"))
                    foreach (var entry in await _history.SearchAsync(query, limit: 100, ct: _windowLifetimeCts.Token))
                        Add(entry.Title, entry.Url, "History", () => { NewTab(entry.Url); return Task.CompletedTask; });
                if (Include("Reading list")) foreach (var entry in (await _readingList.SearchAsync(query, _windowLifetimeCts.Token)).Take(100))
                    Add(entry.Title, entry.Url, "Reading list", () => { NewTab(entry.Url); return Task.CompletedTask; });
                if (!_isPrivate && Include("Notes"))
                    foreach (var note in await _pageNotes.SearchAsync(query, 100, _windowLifetimeCts.Token))
                        Add(note.Note[..Math.Min(110, note.Note.Length)], note.Url, "Notes", () => OpenLibraryNoteAsync(note.Id), note.Note + " " + note.Quote + " " + note.Url);
                if (Include("Offline")) foreach (var article in (await OfflineArticles.SearchAsync(query, _windowLifetimeCts.Token)).Take(100))
                    Add(article.Title, article.Url, "Offline", () => OpenOfflineArticleAsync(article.Id));
                if (!_isPrivate && Include("Workspaces"))
                    foreach (var workspace in (await _workspaces.ListAsync(_windowLifetimeCts.Token)).Where(x => TextMatchRanking.Rank(x.Name, "", query) >= 0).Take(100))
                        Add(workspace.Name, workspace.IsTemplate ? "Open template in a new window" : "Open workspace in a new window", "Workspaces", () => OpenWorkspaceAsync(workspace, false));
                if (closed || version != generation) return;
                var found = items.Where(x => source == "Everything" || x.Kind == source)
                    .OrderByDescending(x => x.Rank).ThenBy(x => x.Title, StringComparer.OrdinalIgnoreCase).Take(200).ToList();
                list.Items.Clear();
                foreach (var item in found) list.Items.Add(new ListViewItem { Tag = item, Content = ManagerRow(item.Title, $"{item.Kind} · {item.Detail}") });
                status.Text = $"{found.Count}{(found.Count == 200 ? "+" : "")} results · On this device";
                empty.Visibility = found.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
                if (list.Items.Count > 0) list.SelectedIndex = 0;
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Library search: {ex.GetType().Name}"); if (!closed && version == generation) status.Text = "Search unavailable. Try again."; }
        }
        list.ItemClick += async (_, e) => { if (e.ClickedItem is ListViewItem { Tag: LibraryResult result }) await result.Open(); };
        list.KeyDown += async (_, e) => { if (e.Key == VirtualKey.Enter && list.SelectedItem is ListViewItem { Tag: LibraryResult result }) { e.Handled = true; await result.Open(); } };
        search.TextChanged += async (_, _) => await Load(); filter.SelectionChanged += async (_, _) => await Load();
        var toolbar = new Grid { RowSpacing = 12 };
        toolbar.RowDefinitions.Add(new() { Height = GridLength.Auto }); toolbar.RowDefinitions.Add(new() { Height = GridLength.Auto });
        toolbar.Children.Add(search);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, Children = { filter, status } };
        Grid.SetRow(row, 1); toolbar.Children.Add(row);
        // Keep the search input stretched rather than measured inside a horizontal scroller.
        var body = new Grid { RowSpacing = 16 }; body.RowDefinitions.Add(new() { Height = GridLength.Auto }); body.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        body.Children.Add(toolbar); Grid.SetRow(results, 1); body.Children.Add(results);
        ShowPage("Library", _isPrivate ? "Search saved items and this window's tabs. Normal browsing history is excluded." : "Everything you saved, visited, or left open. Search stays on your device.", body, () => { closed = true; generation++; });
        search.Loaded += (_, _) => search.Focus(FocusState.Keyboard);
        await Load();
    }

    private async Task OpenLibraryNoteAsync(long id)
    {
        if (_isPrivate) return;
        var note = await _pageNotes.GetAsync(id, _windowLifetimeCts.Token);
        if (_isWindowClosed) return;
        if (note is null) { ShowStatus("This note was removed. Search again to refresh the results."); return; }
        await ShowPageNoteDialogAsync(note);
    }
}

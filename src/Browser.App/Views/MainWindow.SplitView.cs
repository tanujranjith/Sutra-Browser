using Browser.Core.Tabs;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Browser.App;

public sealed partial class MainWindow
{
    private bool IsSplitViewActive => _splitTabIds.Count >= 2;

    private MenuFlyout BuildSplitViewMenu()
    {
        var menu = new MenuFlyout();
        var heading = new MenuFlyoutItem { Text = IsSplitViewActive ? $"Split screen · {_splitTabIds.Count} panes" : "Split screen", IsEnabled = false };
        menu.Items.Add(heading);
        menu.Items.Add(new MenuFlyoutSeparator());
        foreach (var count in new[] { 2, 3, 4, 6, 8 })
        {
            var paneCount = count;
            AddMenu(menu, $"{paneCount} panes", async () => await EnableSplitViewAsync(paneCount), null, Symbol.View);
        }
        if (IsSplitViewActive)
        {
            menu.Items.Add(new MenuFlyoutSeparator());
            AddMenu(menu, "Exit split screen", async () => await ExitSplitViewAsync(), null, Symbol.BackToWindow);
        }
        return menu;
    }

    private async Task EnableSplitViewAsync(int paneCount)
    {
        paneCount = Math.Clamp(paneCount, 2, 8);
        if (paneCount >= 6 && paneCount > _splitTabIds.Count)
        {
            var dialog = new ContentDialog
            {
                Title = $"Open {paneCount} live panes?",
                Content = "Every pane keeps a full WebView active. Media-heavy pages can use substantial memory and visible split tabs will not hibernate.",
                PrimaryButtonText = "Open panes",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Close,
                XamlRoot = _root.XamlRoot
            };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        }

        var selected = _vm.SelectedTab ?? _vm.Tabs.FirstOrDefault() ?? NewTab(activate: false);
        var candidates = new List<BrowserTab> { selected };
        candidates.AddRange(_vm.Tabs.Where(tab => tab.Id != selected.Id));
        while (candidates.Count < paneCount) candidates.Add(NewTab(activate: false));

        _splitTabIds.Clear();
        _splitTabIds.AddRange(candidates.Take(paneCount).Select(tab => tab.Id));
        _vm.SelectedTab = selected;
        await EnsureSplitWebViewsAsync();
        RenderBrowserSurface();
        await RenderAttachedNewTabPagesAsync();
        RefreshTabLists();
        ShowStatus($"Split screen: {paneCount} live panes");
        _ = SaveSessionAsync();
    }

    private async Task ExitSplitViewAsync()
    {
        var selected = _vm.SelectedTab ?? _splitTabIds.Select(FindTab).FirstOrDefault(tab => tab is not null);
        _splitTabIds.Clear();
        _splitPaneBorders.Clear();
        _splitPaneTitles.Clear();
        if (selected is not null) await ActivateTabAsync(selected);
        _ = SaveSessionAsync();
    }

    private async Task EnsureSplitWebViewsAsync()
    {
        foreach (var id in _splitTabIds.ToList())
        {
            var tab = FindTab(id);
            if (tab is null) { _splitTabIds.Remove(id); continue; }
            if (!_webViews.ContainsKey(id)) await CreateWebViewAsync(tab);
        }
        if (_splitTabIds.Count < 2) _splitTabIds.Clear();
    }

    private void RenderBrowserSurface()
    {
        foreach (var web in _webViews.Values) DetachWebView(web);
        _browserHost.Children.Clear();
        _browserHost.RowDefinitions.Clear();
        _browserHost.ColumnDefinitions.Clear();
        _splitPaneBorders.Clear();
        _splitPaneTitles.Clear();

        if (!IsSplitViewActive)
        {
            if (_vm.SelectedTab is not null && _webViews.TryGetValue(_vm.SelectedTab.Id, out var selectedWeb))
                _browserHost.Children.Add(selectedWeb);
            return;
        }

        var count = _splitTabIds.Count;
        var columns = count switch { 2 => 2, 3 => 3, 4 => 2, <= 6 => 3, _ => 4 };
        var rows = (int)Math.Ceiling(count / (double)columns);
        for (var i = 0; i < columns; i++)
        {
            _browserHost.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star), MinWidth = 180 });
            if (i < columns - 1) _browserHost.ColumnDefinitions.Add(new() { Width = new(4) });
        }
        for (var i = 0; i < rows; i++)
        {
            _browserHost.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star), MinHeight = 130 });
            if (i < rows - 1) _browserHost.RowDefinitions.Add(new() { Height = new(4) });
        }

        for (var index = 0; index < count; index++)
        {
            var tab = FindTab(_splitTabIds[index]);
            if (tab is null || !_webViews.TryGetValue(tab.Id, out var web)) continue;
            var pane = BuildSplitPane(tab, web);
            Grid.SetColumn(pane, (index % columns) * 2);
            Grid.SetRow(pane, (index / columns) * 2);
            _browserHost.Children.Add(pane);
        }
        for (var column = 1; column < columns; column++)
        {
            var splitter = BuildColumnSplitter(column * 2 - 2, column * 2);
            Grid.SetColumn(splitter, column * 2 - 1);
            Grid.SetRowSpan(splitter, _browserHost.RowDefinitions.Count);
            _browserHost.Children.Add(splitter);
        }
        for (var row = 1; row < rows; row++)
        {
            var splitter = BuildRowSplitter(row * 2 - 2, row * 2);
            Grid.SetRow(splitter, row * 2 - 1);
            Grid.SetColumnSpan(splitter, _browserHost.ColumnDefinitions.Count);
            _browserHost.Children.Add(splitter);
        }
        RefreshSplitPaneChrome();
    }

    private Border BuildColumnSplitter(int leftIndex, int rightIndex)
    {
        var splitter = SplitterSurface();
        var dragging = false;
        var start = 0d;
        var leftWidth = 0d;
        var rightWidth = 0d;
        splitter.PointerPressed += (_, e) =>
        {
            dragging = splitter.CapturePointer(e.Pointer);
            start = e.GetCurrentPoint(_browserHost).Position.X;
            leftWidth = _browserHost.ColumnDefinitions[leftIndex].ActualWidth;
            rightWidth = _browserHost.ColumnDefinitions[rightIndex].ActualWidth;
            e.Handled = true;
        };
        splitter.PointerMoved += (_, e) =>
        {
            if (!dragging) return;
            var delta = e.GetCurrentPoint(_browserHost).Position.X - start;
            var adjusted = Math.Clamp(delta, 180 - leftWidth, rightWidth - 180);
            _browserHost.ColumnDefinitions[leftIndex].Width = new(Math.Max(180, leftWidth + adjusted));
            _browserHost.ColumnDefinitions[rightIndex].Width = new(Math.Max(180, rightWidth - adjusted));
        };
        splitter.PointerReleased += (_, e) => { dragging = false; splitter.ReleasePointerCapture(e.Pointer); e.Handled = true; };
        splitter.PointerCanceled += (_, e) => { dragging = false; splitter.ReleasePointerCapture(e.Pointer); };
        return splitter;
    }

    private Border BuildRowSplitter(int topIndex, int bottomIndex)
    {
        var splitter = SplitterSurface();
        var dragging = false;
        var start = 0d;
        var topHeight = 0d;
        var bottomHeight = 0d;
        splitter.PointerPressed += (_, e) =>
        {
            dragging = splitter.CapturePointer(e.Pointer);
            start = e.GetCurrentPoint(_browserHost).Position.Y;
            topHeight = _browserHost.RowDefinitions[topIndex].ActualHeight;
            bottomHeight = _browserHost.RowDefinitions[bottomIndex].ActualHeight;
            e.Handled = true;
        };
        splitter.PointerMoved += (_, e) =>
        {
            if (!dragging) return;
            var delta = e.GetCurrentPoint(_browserHost).Position.Y - start;
            var adjusted = Math.Clamp(delta, 130 - topHeight, bottomHeight - 130);
            _browserHost.RowDefinitions[topIndex].Height = new(Math.Max(130, topHeight + adjusted));
            _browserHost.RowDefinitions[bottomIndex].Height = new(Math.Max(130, bottomHeight - adjusted));
        };
        splitter.PointerReleased += (_, e) => { dragging = false; splitter.ReleasePointerCapture(e.Pointer); e.Handled = true; };
        splitter.PointerCanceled += (_, e) => { dragging = false; splitter.ReleasePointerCapture(e.Pointer); };
        return splitter;
    }

    private static Border SplitterSurface() => new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Stretch,
        Background = new SolidColorBrush(Windows.UI.Color.FromArgb(45, 128, 128, 128))
    };

    private Border BuildSplitPane(BrowserTab tab, WebView2 web)
    {
        var paneGrid = new Grid();
        paneGrid.RowDefinitions.Add(new() { Height = new(34) });
        paneGrid.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });

        var header = new Grid
        {
            Padding = new(8, 3, 4, 3),
            ColumnSpacing = 6,
            Background = SplitHeaderBrush()
        };
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });

        FrameworkElement icon = !string.IsNullOrWhiteSpace(tab.FaviconPath) && File.Exists(tab.FaviconPath)
            ? new Image { Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(tab.FaviconPath)), Width = 15, Height = 15, VerticalAlignment = VerticalAlignment.Center }
            : new SymbolIcon(Symbol.World) { Width = 15, Height = 15 };
        header.Children.Add(icon);
        var title = new TextBlock { Text = tab.Title, FontSize = 12, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(title, 1); header.Children.Add(title); _splitPaneTitles[tab.Id] = title;

        var replace = IconButton(Symbol.Switch, "Choose a different tab for this pane");
        replace.Width = replace.Height = 28;
        replace.Click += (_, _) => BuildPaneTabPicker(tab.Id).ShowAt(replace);
        Grid.SetColumn(replace, 2); header.Children.Add(replace);
        var remove = IconButton(Symbol.Cancel, "Remove pane (keep tab open)");
        remove.Width = remove.Height = 28;
        remove.Click += async (_, _) => await RemoveSplitPaneAsync(tab.Id);
        Grid.SetColumn(remove, 3); header.Children.Add(remove);
        header.Tapped += async (_, _) => await ActivateSplitPaneAsync(tab);
        paneGrid.Children.Add(header);

        Grid.SetRow(web, 1);
        paneGrid.Children.Add(web);

        var border = new Border { Child = paneGrid, BorderThickness = new(1), BorderBrush = SplitInactiveBrush() };
        _splitPaneBorders[tab.Id] = border;
        return border;
    }

    private MenuFlyout BuildPaneTabPicker(Guid paneTabId)
    {
        var menu = new MenuFlyout();
        foreach (var tab in _vm.Tabs.Where(tab => tab.Id == paneTabId || !_splitTabIds.Contains(tab.Id)).Take(30))
        {
            var item = new MenuFlyoutItem { Text = tab.Title, Icon = new SymbolIcon(tab.Id == paneTabId ? Symbol.Accept : Symbol.World) };
            item.Click += async (_, _) => await ReplaceSplitPaneAsync(paneTabId, tab);
            menu.Items.Add(item);
        }
        return menu;
    }

    private async Task ReplaceSplitPaneAsync(Guid oldId, BrowserTab replacement)
    {
        var index = _splitTabIds.IndexOf(oldId);
        if (index < 0 || (_splitTabIds.Contains(replacement.Id) && replacement.Id != oldId)) return;
        _splitTabIds[index] = replacement.Id;
        await ActivateTabAsync(replacement);
        _ = SaveSessionAsync();
    }

    private void ReplaceActiveSplitPane(Guid replacementId, Guid? activePaneId = null)
    {
        if (!IsSplitViewActive || _splitTabIds.Contains(replacementId)) return;
        var activeId = activePaneId ?? _vm.SelectedTab?.Id;
        var activeIndex = activeId is null ? -1 : _splitTabIds.IndexOf(activeId.Value);
        _splitTabIds[activeIndex >= 0 ? activeIndex : 0] = replacementId;
    }

    private async Task RemoveSplitPaneAsync(Guid tabId)
    {
        _splitTabIds.Remove(tabId);
        var next = _splitTabIds.Select(FindTab).FirstOrDefault(tab => tab is not null) ?? _vm.Tabs.FirstOrDefault();
        if (_splitTabIds.Count < 2) _splitTabIds.Clear();
        if (next is not null) await ActivateTabAsync(next);
        _ = SaveSessionAsync();
    }

    private async Task ToggleTabInSplitAsync(BrowserTab tab)
    {
        if (_splitTabIds.Contains(tab.Id)) { await RemoveSplitPaneAsync(tab.Id); return; }
        if (!IsSplitViewActive)
        {
            var current = _vm.SelectedTab ?? tab;
            var second = current.Id == tab.Id ? _vm.Tabs.FirstOrDefault(item => item.Id != current.Id) ?? NewTab(activate: false) : tab;
            _splitTabIds.Clear();
            _splitTabIds.Add(current.Id);
            _splitTabIds.Add(second.Id);
        }
        else if (_splitTabIds.Count < 8) _splitTabIds.Add(tab.Id);
        else ReplaceActiveSplitPane(tab.Id);
        await ActivateTabAsync(tab);
        _ = SaveSessionAsync();
    }

    private async Task ActivateSplitPaneAsync(BrowserTab tab)
    {
        if (!IsSplitViewActive || !_splitTabIds.Contains(tab.Id)) return;
        _vm.SelectedTab = tab;
        tab.LastActivatedAt = DateTimeOffset.UtcNow;
        if (_webViews.TryGetValue(tab.Id, out var web)) UpdateNavigationState(web, tab);
        RefreshTabLists();
        RefreshSplitPaneChrome();
        await Task.CompletedTask;
    }

    private void RefreshSplitPaneChrome()
    {
        foreach (var (id, border) in _splitPaneBorders)
            border.BorderBrush = id == _vm.SelectedTab?.Id ? SplitActiveBrush() : SplitInactiveBrush();
        foreach (var (id, title) in _splitPaneTitles)
            if (FindTab(id) is { } tab) title.Text = tab.Title;
        ToolTipService.SetToolTip(_splitView, IsSplitViewActive ? $"Split screen · {_splitTabIds.Count} panes" : "Split screen");
    }

    private BrowserTab? FindTab(Guid id) => _vm.Tabs.FirstOrDefault(tab => tab.Id == id);

    private static void DetachWebView(WebView2 web)
    {
        if (web.Parent is Panel panel) panel.Children.Remove(web);
        else if (web.Parent is Border border && ReferenceEquals(border.Child, web)) border.Child = null;
        Grid.SetRow(web, 0);
        Grid.SetColumn(web, 0);
    }

    private Brush SplitHeaderBrush() => new SolidColorBrush(_root.ActualTheme == ElementTheme.Light
        ? Windows.UI.Color.FromArgb(255, 248, 248, 248)
        : Windows.UI.Color.FromArgb(255, 37, 37, 37));
    private static Brush SplitActiveBrush() => new SolidColorBrush(Colors.DodgerBlue);
    private static Brush SplitInactiveBrush() => new SolidColorBrush(Windows.UI.Color.FromArgb(80, 128, 128, 128));
}

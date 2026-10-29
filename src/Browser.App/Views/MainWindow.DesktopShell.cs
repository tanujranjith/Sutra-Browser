using Browser.Core.Branding;
using Browser.Core.Integration;
using Browser.Core.Settings;
using Microsoft.UI;
using Microsoft.UI.Input;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Graphics;

namespace Browser.App;

public sealed partial class MainWindow
{
    private readonly Grid _desktopTitleBar = new();
    private bool _desktopTitleBarRegionsQueued;
    private readonly Dictionary<string, Button> _desktopDestinations = new(StringComparer.Ordinal);
    private readonly List<(Button Button, TextBlock Label, TextBlock? Detail)> _captureActions = [];
    private readonly StackPanel _desktopSidebarFooter = new() { Spacing = 6 };
    private readonly TextBlock _captureHeading = new() { Text = "SAVE TO SUTRA", FontSize = 11, Margin = new(8, 14, 0, 6) };
    private string _workspaceDestination = "today";
    private string? _activeCaptureAction;
    private Action? _updateCompactDestination;
    private readonly TextBox _sidebarTabFilter = new() { PlaceholderText = "Find a tab…", MaxLength = 160, Height = 34, FontSize = 12 };
    private readonly Expander _captureExpander = new() { Header = "Save to workspace", IsExpanded = false, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel _sidebarTools = new() { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };

    private Grid BuildDesktopTitleBar()
    {
        var bar = _desktopTitleBar;
        bar.Padding = new(16, 0, 144, 0);
        bar.ColumnSpacing = 12;
        bar.Background = ChromeBrush("SutraChromeBrush");
        bar.ColumnDefinitions.Add(new() { Width = new(144) });
        bar.ColumnDefinitions.Add(new() { Width = GridLength.Auto, MinWidth = 148 });
        // Keep an empty grip area even when navigation fills the rest of the header.
        bar.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var brand = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        brand.Children.Add(new Image { Source = new BitmapImage(new Uri(AppBrand.DesktopIconUri)), Width = 26, Height = 26 });
        brand.Children.Add(new TextBlock { Text = AppBrand.ShortName, FontFamily = new FontFamily("Georgia"), FontSize = 23, FontWeight = FontWeights.Bold, VerticalAlignment = VerticalAlignment.Center });
        if (_isPrivate) brand.Children.Add(new TextBlock { Text = "Private", FontSize = 11, VerticalAlignment = VerticalAlignment.Center });
        bar.Children.Add(brand);

        var destinations = new (string Id, string Label)[]
        {
            ("today", "Home"), ("homework", "Homework"), ("notes", "Create"), ("timeline", "Timeline"),
            ("apstudy", "Review & Tests"), ("collegeapp", "College"), ("life", "Life"),
            ("assistantview", AppBrand.AssistantName), ("browser", "Browser")
        };
        if (_isPrivate) destinations = [("browser", "Private browser")];
        var navigation = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
        foreach (var destination in destinations)
        {
            var button = new Button { Content = destination.Label, Height = 38, Padding = new(12, 0, 12, 0), CornerRadius = new(8), FontSize = 13, IsEnabled = !_isPrivate || destination.Id == "browser" };
            AutomationProperties.SetName(button, destination.Label);
            button.Click += async (_, _) => await NavigateDesktopDestinationAsync(destination.Id);
            _desktopDestinations.Add(destination.Id, button);
            navigation.Children.Add(button);
        }
        Grid.SetColumn(navigation, 1); bar.Children.Add(navigation);
        var compactNavigation = new ComboBox { ItemsSource = destinations.Select(x => x.Label).ToArray(), SelectedIndex = 0, MinWidth = 148, FontSize = 12, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(compactNavigation, "Sutra sections");
        var updatingCompact = false;
        compactNavigation.SelectionChanged += async (_, _) =>
        {
            if (!updatingCompact && compactNavigation.SelectedIndex >= 0)
                await NavigateDesktopDestinationAsync(destinations[compactNavigation.SelectedIndex].Id);
        };
        _updateCompactDestination = () =>
        {
            updatingCompact = true;
            compactNavigation.SelectedIndex = Array.FindIndex(destinations, x => x.Id == (_workspaceVisible ? _workspaceDestination : "browser"));
            updatingCompact = false;
        };
        compactNavigation.DropDownOpened += (_, _) => _updateCompactDestination();
        Grid.SetColumn(compactNavigation, 1); bar.Children.Add(compactNavigation);
        var commandContent = new Grid { ColumnSpacing = 10 };
        commandContent.ColumnDefinitions.Add(new() { Width = new(16) }); commandContent.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); commandContent.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        commandContent.Children.Add(new Viewbox { Width = 14, Height = 14, VerticalAlignment = VerticalAlignment.Center, Child = new SymbolIcon(Symbol.Find) });
        var commandLabel = new TextBlock { Text = "Search tabs or commands", FontSize = 12, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
        Grid.SetColumn(commandLabel, 1); commandContent.Children.Add(commandLabel);
        var commandKey = new TextBlock { Text = "Ctrl Shift P", FontSize = 10, Opacity = .65, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(commandKey, 2); commandContent.Children.Add(commandKey);
        var commandLauncher = new Button { Content = commandContent, Width = 340, MaxWidth = 390, Height = 32, HorizontalContentAlignment = HorizontalAlignment.Stretch, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, CornerRadius = new(10), Foreground = ChromeBrush("SutraTextSecondaryBrush"), Background = new SolidColorBrush(ColorFromHex(AppBrand.AccentColor, 16)), BorderBrush = ChromeBrush("SutraBorderBrush") };
        AutomationProperties.SetName(commandLauncher, "Search tabs and commands");
        commandLauncher.Click += async (_, _) => await ShowCommandPaletteAsync();
        Grid.SetColumn(commandLauncher, 2); bar.Children.Add(commandLauncher);
        var utilities = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center };
        var settings = IconButton(Symbol.Setting, "Settings");
        settings.Click += async (_, _) => await ShowSettingsAsync();
        utilities.Children.Add(settings);
        var account = IconButton(Symbol.Contact, "Workspace and profile");
        account.CornerRadius = new(18);
        account.Background = new SolidColorBrush(ColorFromHex(AppBrand.AccentColor, 65));
        account.Click += (_, _) =>
        {
            var menu = new MenuFlyout();
            AddMenu(menu, "Sutra workspace", async () => await ShowSutraWorkspaceAsync());
            AddMenu(menu, "Settings", async () => await ShowSettingsAsync());
            AddMenu(menu, "Browser library", async () => await ShowLibrarySearchAsync());
            menu.ShowAt(account);
        };
        utilities.Children.Add(account);
        Grid.SetColumn(utilities, 3); bar.Children.Add(utilities);
        void UpdateTitleBarLayout()
        {
            navigation.Visibility = Visibility.Collapsed;
            compactNavigation.Visibility = Visibility.Visible;
            commandLauncher.Visibility = bar.ActualWidth < 1000 ? Visibility.Collapsed : Visibility.Visible;
            bar.ColumnDefinitions[0].Width = new(_isPrivate ? 150 : bar.ActualWidth < 900 ? 120 : 144);
            // Visibility and column changes need an arranged layout before measuring
            // the native input regions. Coalesce resize/theme/DPI updates on the UI thread.
            QueueDesktopTitleBarRegions(compactNavigation, commandLauncher, utilities);
        }
        bar.SizeChanged += (_, _) => UpdateTitleBarLayout();
        bar.Loaded += (_, _) =>
        {
            if (bar.XamlRoot is not null) bar.XamlRoot.Changed += OnTitleBarRootChanged;
            UpdateTitleBarLayout();
        };
        bar.Unloaded += (_, _) =>
        {
            if (bar.XamlRoot is not null) bar.XamlRoot.Changed -= OnTitleBarRootChanged;
        };
        void OnTitleBarRootChanged(XamlRoot sender, XamlRootChangedEventArgs args) => UpdateTitleBarLayout();
        navigation.SizeChanged += (_, _) => QueueDesktopTitleBarRegions(compactNavigation, commandLauncher, utilities);
        compactNavigation.SizeChanged += (_, _) => QueueDesktopTitleBarRegions(compactNavigation, commandLauncher, utilities);
        utilities.SizeChanged += (_, _) => QueueDesktopTitleBarRegions(compactNavigation, commandLauncher, utilities);
        commandLauncher.SizeChanged += (_, _) => QueueDesktopTitleBarRegions(compactNavigation, commandLauncher, utilities);
        RefreshDesktopNavigation();
        return bar;
    }

    private void QueueDesktopTitleBarRegions(params FrameworkElement[] controls)
    {
        if (_isWindowClosed || _desktopTitleBarRegionsQueued) return;
        _desktopTitleBarRegionsQueued = true;
        if (!_root.DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () =>
        {
            _desktopTitleBarRegionsQueued = false;
            if (_isWindowClosed || !ExtendsContentIntoTitleBar || _desktopTitleBar.XamlRoot is null) return;
            var scale = _desktopTitleBar.XamlRoot.RasterizationScale;
            var regions = new List<RectInt32>();
            foreach (var control in controls)
            {
                if (control.Visibility != Visibility.Visible || control.ActualWidth <= 0 || control.ActualHeight <= 0) continue;
                var bounds = control.TransformToVisual(_root).TransformBounds(new(0, 0, control.ActualWidth, control.ActualHeight));
                var left = (int)Math.Floor(bounds.Left * scale);
                var top = (int)Math.Floor(bounds.Top * scale);
                regions.Add(new(left, top, (int)Math.Ceiling(bounds.Right * scale) - left, (int)Math.Ceiling(bounds.Bottom * scale) - top));
            }
            // Windows handles dragging, double-click maximize, and the system menu
            // everywhere in the title bar except the interactive controls.
            InputNonClientPointerSource.GetForWindowId(AppWindow.Id)
                .SetRegionRects(NonClientRegionKind.Passthrough, regions.ToArray());
        })) _desktopTitleBarRegionsQueued = false;
    }

    private async Task NavigateDesktopDestinationAsync(string destination)
    {
        if (destination == "browser") { await ShowBrowserModeAsync(); return; }
        if (_isPrivate || !SutraBridgeProtocol.IsWorkspaceView(destination)) return;
        await ShowSutraWorkspaceAsync();
        if (await SendSutraCommandAsync("workspace.navigate", new { view = destination }))
            _workspaceDestination = destination;
        RefreshDesktopNavigation();
    }

    private void RefreshDesktopNavigation()
    {
        _updateCompactDestination?.Invoke();
        foreach (var (id, button) in _desktopDestinations)
        {
            var selected = id == (_workspaceVisible ? _workspaceDestination : "browser");
            button.Background = selected ? new SolidColorBrush(ColorFromHex(_vm.Settings.AccentColor, 52)) : new SolidColorBrush(Colors.Transparent);
            button.BorderBrush = selected ? ChromeBrush("SutraAccentBrush") : new SolidColorBrush(Colors.Transparent);
            button.Foreground = ChromeBrush(selected ? "SutraTextBrush" : "SutraTextSecondaryBrush");
            AutomationProperties.SetHelpText(button, selected ? "Current section" : "Open " + button.Content);
        }
    }

    private void BuildDesktopSidebar()
    {
        _verticalPane.BorderThickness = new(1);
        _verticalPane.CornerRadius = new(10);
        _verticalPane.Margin = new(6, 0, 6, 6);
        _verticalPane.BorderBrush = ChromeBrush("SutraBorderBrush");
        var layout = new Grid { Padding = new(10, 12, 10, 10), RowSpacing = 10 };
        layout.RowDefinitions.Add(new() { Height = GridLength.Auto });
        layout.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star), MinHeight = 70 });
        layout.RowDefinitions.Add(new() { Height = GridLength.Auto, MaxHeight = 395 });
        var top = new StackPanel { Spacing = 10 };
        var newTab = DesktopSidebarAction("New tab", null, Symbol.Add, () => { NewTab(activate: true); return Task.CompletedTask; }, false);
        newTab.Height = 44;
        newTab.Background = new SolidColorBrush(ColorFromHex(AppBrand.AccentColor, 55));
        newTab.BorderBrush = ChromeBrush("SutraAccentBrush");
        top.Children.Add(newTab);
        var search = DesktopSidebarAction("Search everything", null, Symbol.Find, ShowLibrarySearchAsync, false);
        search.BorderThickness = new(0);
        search.Background = new SolidColorBrush(Colors.Transparent);
        top.Children.Add(search);
        AutomationProperties.SetName(_sidebarTabFilter, "Filter open tabs");
        ToolTipService.SetToolTip(_sidebarTabFilter, "Find a tab by title or address · Escape to clear");
        _sidebarTabFilter.TextChanged += (_, _) => RefreshVerticalSidebar();
        _sidebarTabFilter.KeyDown += async (_, e) =>
        {
            if (e.Key == Windows.System.VirtualKey.Escape) { _sidebarTabFilter.Text = string.Empty; e.Handled = true; }
            else if (e.Key == Windows.System.VirtualKey.Enter)
            {
                if (string.IsNullOrWhiteSpace(_sidebarTabFilter.Text)) return;
                var match = _vm.Tabs.Select(tab => (Tab: tab, Rank: Browser.Core.Search.TextMatchRanking.Rank(tab.Title, tab.Url, _sidebarTabFilter.Text)))
                    .Where(item => item.Rank >= 0).OrderByDescending(item => item.Rank).FirstOrDefault();
                if (match.Tab is not null) { await ActivateTabAsync(match.Tab); e.Handled = true; }
            }
        };
        top.Children.Add(_sidebarTabFilter);
        var tabsHeader = new Grid { Margin = new(8, 4, 0, 0) };
        tabsHeader.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        tabsHeader.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        _verticalHeading.Text = "BROWSER TABS";
        _verticalHeading.FontSize = 11;
        _verticalHeading.Foreground = ChromeBrush("SutraTextSecondaryBrush");
        _verticalHeading.VerticalAlignment = VerticalAlignment.Center;
        tabsHeader.Children.Add(_verticalHeading);
        _sidebarToggle.Content = new SymbolIcon(Symbol.DockLeft);
        _sidebarToggle.Width = 28; _sidebarToggle.Height = 28; _sidebarToggle.Padding = new(0); _sidebarToggle.BorderThickness = new(0);
        _sidebarToggle.Background = new SolidColorBrush(Colors.Transparent);
        AutomationProperties.SetName(_sidebarToggle, "Collapse or expand tab sidebar");
        _sidebarToggle.Click += async (_, _) => await ToggleTabSidebarAsync();
        Grid.SetColumn(_sidebarToggle, 1); tabsHeader.Children.Add(_sidebarToggle);
        top.Children.Add(tabsHeader);
        layout.Children.Add(top);
        var tabs = new ScrollViewer { Content = _verticalGroupHost, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        Grid.SetRow(tabs, 1); layout.Children.Add(tabs);
        _desktopSidebarFooter.Children.Add(DesktopSidebarAction("Add to Notes", "Save this page for later", Symbol.Document, CaptureSourceToSutraAsync));
        _desktopSidebarFooter.Children.Add(DesktopSidebarAction("Create Homework", "Turn into a task", Symbol.Library, () => CaptureSutraTaskAsync(false)));
        _desktopSidebarFooter.Children.Add(DesktopSidebarAction("Add Deadline", "Set a due date", Symbol.Calendar, () => CaptureSutraTaskAsync(true)));
        _desktopSidebarFooter.Children.Add(DesktopSidebarAction("Save Source", "Keep link and citation", Symbol.Link, CaptureCollectionToSutraAsync));
        _desktopSidebarFooter.Children.Add(DesktopSidebarAction("Open beside Note", "Read and write side by side", Symbol.OpenWith, OpenSutraBesideNoteAsync));
        var assistant = DesktopSidebarAction(AppBrand.AssistantName, "Ask, summarize, create", Symbol.Message, SendCurrentPageToSutraAssistantAsync);
        assistant.Margin = new(0, 8, 0, 0);
        _desktopSidebarFooter.Children.Add(assistant);
        var footer = new ScrollViewer { Content = _desktopSidebarFooter, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        _captureExpander.Content = footer;
        var footerLayout = new StackPanel { Spacing = 10 };
        footerLayout.Children.Add(_captureExpander);
        var library = IconButton(Symbol.Library, "Library · Ctrl+K"); library.Click += async (_, _) => await ShowLibrarySearchAsync();
        var downloads = IconButton(Symbol.Download, "Downloads · Ctrl+J"); downloads.Click += async (_, _) => await ShowDownloadsAsync();
        var media = IconButton(Symbol.Play, "Media and mini players"); media.Click += async (_, _) => await ShowMediaHubAsync();
        _sidebarTools.Children.Add(library); _sidebarTools.Children.Add(downloads); _sidebarTools.Children.Add(media);
        footerLayout.Children.Add(_sidebarTools);
        layout.SizeChanged += (_, e) => footer.MaxHeight = Math.Max(80, e.NewSize.Height - 380);
        Grid.SetRow(footerLayout, 2); layout.Children.Add(footerLayout);
        var surface = new Grid();
        surface.Children.Add(layout);
        var resize = BuildSidebarResizeHandle(); resize.HorizontalAlignment = HorizontalAlignment.Right; surface.Children.Add(resize);
        _verticalPane.Child = surface;
        _verticalPane.PointerEntered += (_, _) => ExpandSidebarOnHover();
        _verticalPane.PointerExited += (_, e) =>
        {
            var p = e.GetCurrentPoint(_verticalPane).Position;
            if (p.X >= 0 && p.Y >= 0 && p.X <= _verticalPane.ActualWidth && p.Y <= _verticalPane.ActualHeight) return;
            _sidebarHoverExpanded = false; ApplyTabLayout(); RefreshTabLists();
        };
        Grid.SetRowSpan(_verticalPane, 3);
        _contentGrid.Children.Add(_verticalPane);
    }

    private Button DesktopSidebarAction(string label, string? detail, Symbol icon, Func<Task> action, bool workspaceAction = true)
    {
        var content = new Grid { ColumnSpacing = 10 };
        content.ColumnDefinitions.Add(new() { Width = new(30) });
        content.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        content.Children.Add(new Border { Width = 30, Height = 30, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, CornerRadius = new(7), Background = workspaceAction ? new SolidColorBrush(ColorFromHex(AppBrand.AccentColor, 130)) : new SolidColorBrush(Colors.Transparent), Child = new Viewbox { Width = 18, Height = 18, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Child = new SymbolIcon(icon) } });
        var words = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        var title = new TextBlock { Text = label, FontSize = 13, TextTrimming = TextTrimming.CharacterEllipsis };
        words.Children.Add(title);
        TextBlock? subtitle = detail is null ? null : new() { Text = detail, FontSize = 11, Foreground = ChromeBrush("SutraTextSecondaryBrush"), TextTrimming = TextTrimming.CharacterEllipsis };
        if (subtitle is not null) words.Children.Add(subtitle);
        Grid.SetColumn(words, 1); content.Children.Add(words);
        var button = new Button { Content = content, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new(9, 7, 8, 7), CornerRadius = new(8), Background = ChromeBrush("SutraSurfaceBrush"), BorderBrush = ChromeBrush("SutraBorderBrush"), IsEnabled = !workspaceAction || !_isPrivate };
        AutomationProperties.SetName(button, label);
        ToolTipService.SetToolTip(button, _isPrivate && workspaceAction ? "Sutra capture is unavailable in private windows" : label);
        button.Click += async (_, _) => await action();
        _captureActions.Add((button, title, subtitle));
        return button;
    }

    private void RefreshDesktopSidebar()
    {
        _sidebarTabFilter.Visibility = SidebarExpanded ? Visibility.Visible : Visibility.Collapsed;
        _captureExpander.Visibility = SidebarExpanded && !_isPrivate ? Visibility.Visible : Visibility.Collapsed;
        _sidebarTools.Orientation = SidebarExpanded ? Orientation.Horizontal : Orientation.Vertical;
        _captureHeading.Visibility = SidebarExpanded ? Visibility.Visible : Visibility.Collapsed;
        foreach (var (button, label, detail) in _captureActions)
        {
            if (button.Content is Grid content)
            {
                content.ColumnSpacing = SidebarExpanded ? 10 : 0;
                content.ColumnDefinitions[0].Width = SidebarExpanded ? new GridLength(30) : new GridLength(1, GridUnitType.Star);
                content.ColumnDefinitions[1].Width = SidebarExpanded ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
            }
            label.Visibility = SidebarExpanded ? Visibility.Visible : Visibility.Collapsed;
            if (detail is not null) detail.Visibility = SidebarExpanded ? Visibility.Visible : Visibility.Collapsed;
            button.Padding = SidebarExpanded ? new(9, 7, 8, 7) : new(0, 7, 0, 7);
            if (detail is null)
            {
                if (label.Text == "New tab")
                {
                    button.Background = new SolidColorBrush(ColorFromHex(_vm.Settings.AccentColor, 45));
                    button.BorderBrush = ChromeBrush("SutraAccentBrush");
                }
                continue;
            }
            var selected = label.Text == _activeCaptureAction || label.Text == "Open beside Note" && _workspaceSidePanelOpen;
            button.Background = selected ? new SolidColorBrush(ColorFromHex(_vm.Settings.AccentColor, 60)) : ChromeBrush("SutraSurfaceBrush");
            button.BorderBrush = ChromeBrush(selected ? "SutraAccentBrush" : "SutraBorderBrush");
        }
    }
}

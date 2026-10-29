using Browser.App.ViewModels;
using System.Diagnostics;
using Browser.App.Diagnostics;
using Browser.Core.Branding;
using Browser.Core.Privacy;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using Browser.Data.Repositories;
using Browser.Platform.Windows.Security;
using Browser.Platform.Windows.Storage;
using Browser.Platform.Windows.WebView;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.Web.WebView2.Core;
using Windows.ApplicationModel.DataTransfer;
using Windows.System;

namespace Browser.App;

public sealed partial class MainWindow : Window
{
    private readonly MainWindowViewModel _vm = new();
    private readonly WebViewEnvironmentManager _environment = App.Services.GetRequiredService<WebViewEnvironmentManager>();
    private readonly BrowserPaths _paths = App.Services.GetRequiredService<BrowserPaths>();
    private readonly SessionRepository _sessions;
    private readonly SessionSnapshotRepository _sessionSnapshots;
    private readonly WindowSessionRepository _windowSessions;
    private readonly IServiceProvider _dataServices;
    private readonly Guid _sessionWindowId;
    private readonly List<Browser.Core.Diagnostics.StartupPhaseTiming> _startupTimings = [];
    private readonly Browser.Core.Diagnostics.HealthHistory _healthHistory = new();
    private TimeSpan _lastCpuTotal = TimeSpan.Zero;
    private DateTimeOffset _lastCpuAt = DateTimeOffset.MinValue;
    private double _lastCpuPercent;
    private readonly TaskCompletionSource<bool> _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Browser.Core.Sessions.BrowserSession? _launchSession;
    private readonly bool _showWorkspaceOnLaunch;
    private readonly SettingsRepository _settingsRepository;
    private readonly AppStateRepository _appState;
    private readonly HistoryRepository _history;
    private readonly BookmarkRepository _bookmarks;
    private readonly DownloadRepository _downloads;
    private readonly WorkspaceRepository _workspaces;
    private readonly ReadingListRepository _readingList;
    private readonly PermissionRepository _permissions;
    private readonly CredentialService _credentials;
    private readonly PasswordMetadataRepository _passwordMetadata;
    private readonly AiActionLogRepository _aiLogs;
    private readonly PageNoteRepository _pageNotes;
    // ONE coordinator serializes every persistent write (session snapshots and
    // settings alike) because both paths touch the same SQLite app_state store.
    // Requests that arrive mid-pass are coalesced into one trailing pass that
    // reads live state, and shutdown drains deterministically.
    private readonly Browser.Core.Runtime.PersistencePassCoordinator _persistenceSaves = new();
    // Background passes that can outlive a closing window are tracked so shutdown
    // can cancel lifetime work and await it before releasing shared controls.
    private readonly Browser.Core.Runtime.BackgroundWorkTracker _maintenanceWork = new();
    private readonly Browser.Core.Runtime.BackgroundWorkTracker _mediaRefreshWork = new();
    private readonly Browser.Core.Passwords.ISecureCredentialStore _secureStore;
    private readonly Dictionary<Guid, WebView2> _webViews = [];
    // Native manager pages are intentionally transient UI tabs: they do not create a WebView
    // or persist into session restore/recently-closed history.
    private readonly Dictionary<Guid, FrameworkElement> _nativePageTabs = [];
    // Small lifecycle hook: per-native-tab callbacks invoked exactly when that
    // page instance is removed or replaced, so feature surfaces (like the Notes
    // manager) can invalidate their refresh state without generic close logic
    // knowing about them.
    private readonly Dictionary<Guid, Action> _nativePageClosedHandlers = [];
    private readonly Dictionary<Guid, Action> _nativePageActivatedHandlers = [];
    private bool _focusMode;
    private bool _utilitySidebarVisibleBeforeFocus;
    private readonly Dictionary<Guid, ulong> _activeNavigationIds = [];
    private readonly Dictionary<Guid, double> _zoomFactors = [];
    private bool _tabMemoryRefreshInFlight;
    private DateTimeOffset _lastTabMemoryRefreshAt = DateTimeOffset.MinValue;
    private readonly Dictionary<Guid, CoreWebView2DownloadOperation> _activeDownloads = [];
    private readonly Dictionary<Guid, CoreWebView2DownloadOperation> _resumableDownloads = [];
    private readonly Dictionary<Guid, Guid> _downloadTabIds = [];
    private readonly HashSet<Guid> _pausedDownloads = [];
    private readonly Dictionary<Guid, Browser.Data.Models.DownloadRecord> _privateDownloads = [];
    private readonly Dictionary<Guid, TabViewItem> _horizontalTabItems = [];
    private readonly Dictionary<Guid, ListViewItem> _verticalTabItems = [];
    private readonly List<Button> _sidebarNavButtons = [];
    private readonly Dictionary<Guid, TabGroup> _tabGroups = [];
    private readonly List<Guid> _splitTabIds = [];
    private const string DragKindKey = "SutraDragKind";
    private const string DragTabKey = "SutraTabId";
    private const string DragGroupKey = "SutraGroupId";
    private bool _sidebarHoverExpanded;
    private bool _applyingCustomization;
    private bool _themeRefreshQueued;
    private bool _nativeThemeInitialized;
    private bool _nativeThemeRestartRequired;
    private int _maintenanceTicks;
    private readonly Dictionary<Guid, Border> _splitPaneBorders = [];
    private readonly Dictionary<Guid, TextBlock> _splitPaneTitles = [];
    private readonly Dictionary<Guid, int> _blockedRequestCounts = [];
    private readonly HashSet<Guid> _readerTabs = [];
    private readonly HashSet<Guid> _translationOfferedTabs = [];
    private readonly List<KeyboardAccelerator> _customAccelerators = [];
    private ContentBlockRuleSet _contentBlockRules = ContentFilterRuleSetCache.BuiltIn;
    private readonly Grid _root = new();
    private readonly Grid _contentGrid = new();
    private readonly Grid _toolbar = new();
    private readonly TabView _horizontalTabs = new();
    private readonly Border _browserToolbarHost = new();
    private readonly Border _verticalPane = new();
    private readonly StackPanel _verticalGroupHost = new() { Spacing = 5 };
    private readonly TextBlock _verticalHeading = new();
    private readonly Button _sidebarToggle = new();
    private readonly Grid _browserHost = new();
    private readonly Grid _workspaceHost = new() { Visibility = Visibility.Collapsed };
    private WebView2? _sutraWorkspaceView;
    private bool _workspaceVisible;
    private readonly List<Browser.Core.Privacy.ElementHideRule> _elementHideRules = [];
    private Guid? _elementPickerTabId;
    private string? _elementPickerHost;
    private string? _elementPickerOrigin;
    private string? _elementPickerNonce;
    private readonly AutoSuggestBox _address = new();
    private readonly ProgressBar _progress = new();
    private readonly TextBlock _status = new();
    private readonly Border _statusBubble = new();
    private readonly TextBlock _security = new();
    private readonly Button _back = IconButton(Symbol.Back, "Back (Alt+Left)");
    private readonly Button _forward = IconButton(Symbol.Forward, "Forward (Alt+Right)");
    private readonly Button _reload = IconButton(Symbol.Refresh, "Reload (Ctrl+R)");
    private readonly Button _home = IconButton(Symbol.Home, "Home");
    private readonly Button _bookmark = IconButton(Symbol.OutlineStar, "Bookmark this page (Ctrl+D)");
    private readonly Button _ai = IconButton(Symbol.Message, AppBrand.AssistantName);
    private readonly Button _shield = IconButton(Symbol.ProtectedDocument, "Privacy and content blocking");
    private readonly Button _splitView = IconButton(Symbol.View, "Split screen");
    private readonly Button _media = IconButton(Symbol.Play, "Media controls");
    private readonly Button _more = IconButton(Symbol.More, "Browser menu");
    private readonly Border _bookmarkBar = new();
    private readonly StackPanel _bookmarkBarGroups = new() { Orientation = Orientation.Horizontal, Spacing = 4 };
    private readonly StackPanel _bookmarkBarItems = new() { Orientation = Orientation.Horizontal, Spacing = 4 };
    private readonly Button _bookmarkBarAll = new() { Content = "All", Padding = new(9, 4, 9, 4), CornerRadius = new(6), Margin = new(6, 0, 0, 0) };
    private readonly Grid _copilotPanel = new();
    private readonly Border _utilitySidebar = new();
    // Unlike a conventional sidebar, this owns at most one live WebView. Switching
    // panels closes the old controller before opening the next one.
    private WebView2? _webPanelView;
    private string? _activeWebPanelUrl;
    private readonly TextBox _copilotTranscript = new();
    private readonly TextBox _copilotInput = new();
    private readonly Border _pageOverlay = new();
    private readonly ScrollViewer _miniPlayerOverlay = new();
    private readonly StackPanel _miniPlayerHost = new() { Spacing = 10 };
    private readonly Dictionary<MiniPlayerKey, MiniPlayerView> _miniPlayers = [];
    private readonly Border _downloadShelf = new();
    private readonly Border _findBar = new();
    private readonly Border _tabSwitcherOverlay = new();
    private readonly Grid _bootOverlay = new();
    private readonly InfoBar _notification = new();
    private readonly bool _isPrivate;
    private readonly string _profileName;
    private readonly string? _initialUrl;
    private readonly bool _restoreSession;
    private readonly string _faviconDirectory;
    private readonly string _newTabDirectory;
    private readonly string _newTabFileUri;
    private CancellationTokenSource? _aiCancellation;
    // Window-lifetime cancellation exists for the whole life of the window, not
    // just shutdown: background passes (maintenance, hibernation, memory/media
    // refresh) observe its token so a closing window's work stops cooperatively.
    private readonly CancellationTokenSource _windowLifetimeCts = new();
    private bool _isWindowClosed;
    private DispatcherTimer? _notificationTimer;
    // Expiry lease state: both sides are fields so the reused Tick handler always
    // compares the CURRENT schedule against the CURRENT notification generation.
    private readonly Browser.Core.Runtime.ExpiryLeaseTracker _notificationLeaseTracker = new();
    private int _notificationScheduledGeneration;
    private DispatcherTimer? _maintenanceTimer;
    private DispatcherTimer? _mediaTimer;
    private DispatcherTimer? _tabSwitcherTimer;
    private readonly Browser.Core.Runtime.ExpiryLeaseTracker _tabSwitcherLeaseTracker = new();
    private int _tabSwitcherScheduledGeneration;
    private bool _privateAiEnabled;
    private bool _allowClose;
    private bool _refreshingTabs;
    private int _activationVersion;
    private string? _pendingTypedQuery;

    public MainWindow(bool isPrivate = false, string? initialUrl = null, bool restoreSession = true, string profileName = "Default", Browser.Core.Sessions.BrowserSession? launchSession = null, IServiceProvider? dataServices = null, bool showWorkspaceOnLaunch = false, Guid? restoredWindowId = null)
    {
        _dataServices = dataServices ?? App.Services;
        _sessions = _dataServices.GetRequiredService<SessionRepository>();
        _sessionSnapshots = _dataServices.GetRequiredService<SessionSnapshotRepository>();
        _windowSessions = _dataServices.GetRequiredService<WindowSessionRepository>();
        _settingsRepository = _dataServices.GetRequiredService<SettingsRepository>();
        _appState = _dataServices.GetRequiredService<AppStateRepository>();
        _history = _dataServices.GetRequiredService<HistoryRepository>();
        _bookmarks = _dataServices.GetRequiredService<BookmarkRepository>();
        _downloads = _dataServices.GetRequiredService<DownloadRepository>();
        _workspaces = _dataServices.GetRequiredService<WorkspaceRepository>();
        _readingList = _dataServices.GetRequiredService<ReadingListRepository>();
        _permissions = _dataServices.GetRequiredService<PermissionRepository>();
        _credentials = _dataServices.GetRequiredService<CredentialService>();
        _passwordMetadata = _dataServices.GetRequiredService<PasswordMetadataRepository>();
        _aiLogs = _dataServices.GetRequiredService<AiActionLogRepository>();
        _pageNotes = _dataServices.GetRequiredService<PageNoteRepository>();
        _secureStore = _dataServices.GetRequiredService<Browser.Core.Passwords.ISecureCredentialStore>();
        _isPrivate = isPrivate;
        _launchSession = isPrivate ? null : launchSession;
        _sessionWindowId = Browser.Core.Integration.SutraDesktopStartupPolicy.ResolveWindowId(isPrivate ? null : restoredWindowId);
        _showWorkspaceOnLaunch = Browser.Core.Integration.SutraDesktopStartupPolicy.ShouldOpenWorkspace(isPrivate, initialUrl is not null, launchSession is not null, showWorkspaceOnLaunch);
        _profileName = isPrivate ? "Private" : string.IsNullOrWhiteSpace(profileName) ? "Default" : profileName;
        // Keep browser shortcuts functional without WinUI's transient accelerator
        // badges appearing over arbitrary page or sidebar content.
        _root.KeyboardAcceleratorPlacementMode = KeyboardAcceleratorPlacementMode.Hidden;
        _initialUrl = initialUrl;
        _restoreSession = restoreSession;
        _faviconDirectory = isPrivate
            ? Path.Combine(Path.GetTempPath(), AppBrand.ApplicationId, "PrivateFavicons", Guid.NewGuid().ToString("N"))
            : _paths.FaviconCachePath;
        Directory.CreateDirectory(_faviconDirectory);
        _newTabDirectory = Path.Combine(Path.GetTempPath(), AppBrand.ApplicationId, "NewTab", Guid.NewGuid().ToString("N"));
        _newTabFileUri = new Uri("file:///" + Path.Combine(AppContext.BaseDirectory, "SutraUltra", "index.html").Replace('\\', '/')).AbsoluteUri;

        Title = isPrivate ? AppBrand.PrivateWindowTitle : AppBrand.Name;
        BuildInterface();
        Content = _root;
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(_desktopTitleBar);
        try { SystemBackdrop = new MicaBackdrop(); } catch { }
        try
        {
            var iconPath = Path.Combine(AppContext.BaseDirectory, AppBrand.IconRelativePath);
            if (File.Exists(iconPath)) AppWindow.SetIcon(iconPath);
        }
        catch { }

        AppWindow.Closing += OnAppWindowClosing;
        Closed += OnWindowClosed;
        _root.Loaded += async (_, _) =>
        {
            if (_isWindowClosed) return;
            try
            {
                await InitializeAsync();
                _ready.TrySetResult(true);
                if (!_isPrivate) _ = CheckForUpdatesQuietlyAsync();
            }
            catch (Exception ex)
            {
                // Startup must never terminate the process on corrupt local data
                // (session/settings/SQLite). Fall back to a single fresh tab so the
                // window is always usable; the type-only log avoids leaking paths.
                PrivacySafeDiagnosticLog.Record("window-startup-failed", ex);
                Debug.WriteLine($"Sutra startup containment: {ex.GetType().Name}");
                try { if (!_isWindowClosed) EnsureEmergencyTab(); } catch { }
                try { if (!_isWindowClosed) ShowStatus("Sutra started with a fresh tab because the saved session could not be read.", InfoBarSeverity.Warning, 7000); } catch { }
            }
            finally
            {
                if (!_isWindowClosed) _root.IsHitTestVisible = true;
                _ready.TrySetResult(false);
                try { if (!_isWindowClosed) await FinishBootOverlayAsync(); }
                catch (Exception ex) { Debug.WriteLine($"Boot animation cleanup failed: {ex.GetType().Name}"); }
            }
            // Warm the optional workspace without switching away from browsing.
            if (!_isWindowClosed && _showWorkspaceOnLaunch)
                ObserveUiCallback("Startup workspace", EnsureSutraWorkspaceAsync);
        };
        _root.ActualThemeChanged += (_, _) =>
        {
            // Let WinUI finish changing resources before touching its chrome. Doing
            // this inline can re-enter the visual tree while it is rebuilding.
            if (_themeRefreshQueued) return;
            _themeRefreshQueued = true;
            _root.DispatcherQueue.TryEnqueue(() =>
            {
                _themeRefreshQueued = false;
                if (_isWindowClosed) return;
                ApplyCustomization();
                if (_pageOverlay.Visibility == Visibility.Visible) _pageOverlay.Background = ManagerPageBackground();
            });
        };
    }

    private void BuildInterface()
    {
        _root.RowDefinitions.Add(new() { Height = new(52) });
        _root.RowDefinitions.Add(new() { Height = new(0) });
        _root.RowDefinitions.Add(new() { Height = new(0) });
        _root.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        _root.RowDefinitions.Add(new() { Height = new(2) });

        ConfigureHorizontalTabs();
        var titleBar = BuildTitleBar();
        Grid.SetRow(titleBar, 0);
        _root.Children.Add(titleBar);

        var browserChrome = new StackPanel();
        browserChrome.Children.Add(_horizontalTabs);
        browserChrome.Children.Add(BuildToolbar());
        _browserToolbarHost.Child = browserChrome;

        _bookmarkBar.Padding = new(8, 3, 8, 4);
        _bookmarkBar.BorderThickness = new(0, 0, 0, 1);
        _bookmarkBar.BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush");
        var bookmarkBarLayout = new Grid();
        bookmarkBarLayout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bookmarkBarLayout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var bookmarkBarContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        bookmarkBarContent.Children.Add(_bookmarkBarGroups);
        bookmarkBarContent.Children.Add(_bookmarkBarItems);
        var bookmarkScroll = new ScrollViewer
        {
            Content = bookmarkBarContent,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden
        };
        ToolTipService.SetToolTip(_bookmarkBarAll, "Open all bookmarks");
        _bookmarkBarAll.Click += async (_, _) => await ShowBookmarksAsync();
        Grid.SetColumn(_bookmarkBarAll, 1);
        bookmarkBarLayout.Children.Add(bookmarkScroll);
        bookmarkBarLayout.Children.Add(_bookmarkBarAll);
        _bookmarkBar.Child = bookmarkBarLayout;


        BuildContentArea();
        Grid.SetRow(_contentGrid, 1);
        Grid.SetRowSpan(_contentGrid, 3);
        _root.Children.Add(_contentGrid);

        _progress.IsIndeterminate = true;
        _progress.Visibility = Visibility.Collapsed;
        _progress.ShowPaused = false;
        Grid.SetRow(_progress, 4);
        _root.Children.Add(_progress);

        // Keep the browser chrome available while its initial tab loads.
        _bootOverlay.Visibility = Visibility.Collapsed;
        // Session/settings commands become available once their saved state is read.
        _root.IsHitTestVisible = false;
        AddShortcuts();
    }

    private void BuildBootOverlay()
    {
        _bootOverlay.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 15, 18, 28));
        _bootOverlay.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bootOverlay.VerticalAlignment = VerticalAlignment.Stretch;
        _bootOverlay.Opacity = 1;
        _bootOverlay.IsHitTestVisible = true;
        Grid.SetRowSpan(_bootOverlay, 6);

        var blueWash = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 1),
            EndPoint = new Windows.Foundation.Point(1, 0.52)
        };
        blueWash.GradientStops.Add(new GradientStop { Color = Windows.UI.Color.FromArgb(42, 28, 64, 174), Offset = 0 });
        blueWash.GradientStops.Add(new GradientStop { Color = Windows.UI.Color.FromArgb(18, 28, 64, 174), Offset = 0.45 });
        blueWash.GradientStops.Add(new GradientStop { Color = Windows.UI.Color.FromArgb(0, 28, 64, 174), Offset = 1 });
        _bootOverlay.Children.Add(new Border { Background = blueWash, IsHitTestVisible = false });

        var violetWash = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(1, 1),
            EndPoint = new Windows.Foundation.Point(0, 0.52)
        };
        violetWash.GradientStops.Add(new GradientStop { Color = Windows.UI.Color.FromArgb(42, 77, 34, 158), Offset = 0 });
        violetWash.GradientStops.Add(new GradientStop { Color = Windows.UI.Color.FromArgb(18, 77, 34, 158), Offset = 0.45 });
        violetWash.GradientStops.Add(new GradientStop { Color = Windows.UI.Color.FromArgb(0, 77, 34, 158), Offset = 1 });
        _bootOverlay.Children.Add(new Border { Background = violetWash, IsHitTestVisible = false });

        var logoFrame = new Border
        {
            Width = 116,
            Height = 116,
            CornerRadius = new(30),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(34, 255, 255, 255)),
            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(70, 255, 255, 255)),
            BorderThickness = new(1),
            Child = new Image
            {
                Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(AppBrand.DesktopIconUri)),
                Width = 94,
                Height = 94,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            }
        };

        var title = new TextBlock
        {
            Text = AppBrand.Name,
            FontSize = 28,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Colors.White),
            HorizontalAlignment = HorizontalAlignment.Center
        };
        var subtitle = new TextBlock
        {
            Text = "A calmer way to browse",
            FontSize = 13,
            Opacity = .68,
            Foreground = new SolidColorBrush(Colors.White),
            HorizontalAlignment = HorizontalAlignment.Center
        };
        var spinner = new ProgressRing
        {
            IsActive = true,
            Width = 24,
            Height = 24,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new(0, 10, 0, 0)
        };
        var content = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 9
        };
        content.Children.Add(logoFrame);
        content.Children.Add(title);
        content.Children.Add(subtitle);
        content.Children.Add(spinner);
        _bootOverlay.Children.Add(content);
        _root.Children.Add(_bootOverlay);
    }

    private async Task FinishBootOverlayAsync()
    {
        if (_bootOverlay.Visibility != Visibility.Visible) return;
        var finished = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var fade = new DoubleAnimation { To = 0, Duration = new Duration(TimeSpan.FromMilliseconds(360)) };
        fade.Completed += (_, _) => finished.TrySetResult(true);
        var storyboard = new Storyboard();
        Storyboard.SetTarget(fade, _bootOverlay);
        Storyboard.SetTargetProperty(fade, "Opacity");
        storyboard.Children.Add(fade);
        storyboard.Begin();
        await finished.Task;
        _bootOverlay.Visibility = Visibility.Collapsed;
        _bootOverlay.IsHitTestVisible = false;
    }

    private Grid BuildTitleBar() => BuildDesktopTitleBar();

    private void ConfigureHorizontalTabs()
    {
        _horizontalTabs.IsAddTabButtonVisible = true;
        _horizontalTabs.CanDragTabs = true;
        _horizontalTabs.CanReorderTabs = true;
        _horizontalTabs.TabWidthMode = TabViewWidthMode.SizeToContent;
        _horizontalTabs.CloseButtonOverlayMode = TabViewCloseButtonOverlayMode.Auto;
        _horizontalTabs.AllowDrop = true;
        _horizontalTabs.AddTabButtonClick += (_, _) => NewTab(activate: true);
        _horizontalTabs.TabCloseRequested += (_, e) => CloseTab(((TabViewItem)e.Tab).Tag as BrowserTab);
        _horizontalTabs.TabDragCompleted += (_, _) => SynchronizeTabOrder(_horizontalTabs.TabItems.OfType<TabViewItem>().Select(item => (BrowserTab)item.Tag));
        // Horizontal-strip transfer (#11): publish the same drag payload the sidebar uses so
        // strips can be both sources and targets across windows. Same-window reorders still
        // use the built-in TabView path; cross-window drops go through the guarded transfer.
        _horizontalTabs.TabDragStarting += (_, e) =>
        {
            try
            {
                if (e.Tab is TabViewItem { Tag: BrowserTab tab })
                {
                    e.Data.Properties[DragKindKey] = "tab";
                    e.Data.Properties[DragTabKey] = tab.Id.ToString();
                    e.Data.RequestedOperation = DataPackageOperation.Move;
                }
            }
            catch (Exception ex) { Debug.WriteLine($"Tab drag payload failed: {ex.GetType().Name}"); }
        };
        _horizontalTabs.TabStripDragOver += (_, e) =>
        {
            try
            {
                e.AcceptedOperation = e.Data.Properties.ContainsKey(DragTabKey) || e.Data.Properties.ContainsKey(DragKindKey)
                    ? DataPackageOperation.Move : DataPackageOperation.None;
            }
            catch { e.AcceptedOperation = DataPackageOperation.None; }
        };
        _horizontalTabs.TabStripDrop += async (_, e) => { await AcceptHorizontalTabDropAsync(e.Data); };
        _horizontalTabs.DragOver += (_, e) =>
        {
            try
            {
                e.AcceptedOperation = e.DataView.Properties.ContainsKey(DragTabKey) || e.DataView.Properties.ContainsKey(DragKindKey)
                    ? DataPackageOperation.Move : DataPackageOperation.None;
                e.DragUIOverride.Caption = "Move tab here";
            }
            catch { e.AcceptedOperation = DataPackageOperation.None; }
        };
        _horizontalTabs.Drop += async (_, e) => { await AcceptHorizontalTabDropAsync(e.DataView); };
        _horizontalTabs.SelectionChanged += async (_, _) =>
        {
            if (!_refreshingTabs && _horizontalTabs.SelectedItem is TabViewItem item && item.Tag is BrowserTab tab && tab.Id != _vm.SelectedTab?.Id)
                await ActivateTabAsync(tab);
        };
    }

    private async Task AcceptHorizontalTabDropAsync(DataPackage data)
    {
        Guid? id = null;
        try { if (data.Properties.TryGetValue(DragTabKey, out var v) && v is string s && Guid.TryParse(s, out var parsed)) id = parsed; }
        catch (Exception ex) { Debug.WriteLine($"Horizontal tab drop failed: {ex.GetType().Name}"); return; }
        await AcceptHorizontalTabTransferAsync(id);
    }

    private async Task AcceptHorizontalTabDropAsync(DataPackageView data)
    {
        Guid? id = null;
        try { if (data.Properties.TryGetValue(DragTabKey, out var v) && v is string s && Guid.TryParse(s, out var parsed)) id = parsed; }
        catch (Exception ex) { Debug.WriteLine($"Horizontal tab drop failed: {ex.GetType().Name}"); return; }
        await AcceptHorizontalTabTransferAsync(id);
    }

    private async Task AcceptHorizontalTabTransferAsync(Guid? id)
    {
        try
        {
            if (id is null || id == Guid.Empty) return;
            var tabId = id.Value;
            if (_vm.Tabs.Any(x => x.Id == tabId)) return;
            var source = TabTransferTargets().FirstOrDefault(window => window._vm.Tabs.Any(x => x.Id == tabId));
            var sourceTab = source?._vm.Tabs.FirstOrDefault(x => x.Id == tabId);
            if (source is null || sourceTab is null) return;
            await source.MoveTabToWindowAsync(sourceTab, this);
        }
        catch (Exception ex) { Debug.WriteLine($"Horizontal tab drop failed: {ex.GetType().Name}"); }
    }

    private Border BuildToolbar()
    {
        _toolbar.Padding = new(12, 8, 12, 8);
        _toolbar.Background = ChromeBrush("SutraToolbarBrush");
        _toolbar.ColumnSpacing = 4;
        for (var i = 0; i < 12; i++) _toolbar.ColumnDefinitions.Add(new() { Width = i == 4 ? new(1, GridUnitType.Star) : GridLength.Auto });
        _back.Click += (_, _) => SafeGoBack();
        _forward.Click += (_, _) => SafeGoForward();
        _reload.Click += (_, _) => ReloadOrStop();
        _home.Click += (_, _) => Navigate(_vm.Settings.HomePage);

        _address.PlaceholderText = "Search or enter address";
        _address.MinWidth = 120;
        AutomationProperties.SetName(_address, "Search or enter address");
        _address.Height = 36;
        _address.CornerRadius = new(10);
        _address.GotFocus += (_, _) => _addressEditing = true;
        _address.LostFocus += (_, _) => _addressEditing = false;
        _address.QueryIcon = new SymbolIcon(Symbol.Find);
        _address.SuggestionChosen += (box, e) =>
        {
            if (e.SelectedItem is ListViewItem { Tag: Browser.Core.Search.LocalSuggestion suggestion })
            {
                _selectedAddressSuggestion = suggestion;
                box.Text = suggestion.Url;
            }
        };
        _address.QuerySubmitted += async (_, e) =>
        {
            _addressEditing = false;
            var suggestion = (e.ChosenSuggestion as ListViewItem)?.Tag as Browser.Core.Search.LocalSuggestion;
            suggestion ??= _selectedAddressSuggestion?.Url == e.QueryText ? _selectedAddressSuggestion : null;
            _selectedAddressSuggestion = null;
            _address.ItemsSource = null;
            if (suggestion is { Kind: Browser.Core.Search.LocalSuggestionKind.OpenTab, TabId: { } id })
            {
                if (FindTab(id) is { } tab) await ActivateTabAsync(tab);
                else ShowStatus("That tab is no longer open.");
            }
            else Navigate(suggestion?.Url ?? e.QueryText);
        };
        _address.TextChanged += AddressTextChanged;
        ConfigureAddressMenu();

        _security.VerticalAlignment = VerticalAlignment.Center;
        _security.FontFamily = new FontFamily("Segoe Fluent Icons");
        _security.FontSize = 13;
        _security.Margin = new(4, 0, 2, 0);
        ToolTipService.SetToolTip(_security, "Connection status");
        _shield.Click += async (_, _) => await ShowSiteInformationAsync();
        _bookmark.Click += async (_, _) => await BookmarkCurrentAsync();
        _ai.Click += async (_, _) => await ToggleCopilotAsync();
        _splitView.Click += (_, _) => BuildSplitViewMenu().ShowAt(_splitView);
        _media.Click += async (_, _) => await ShowMediaHubAsync();
        _more.Click += (_, _) => BuildMainMenu().ShowAt(_more);

        Add(_toolbar, _back, 0); Add(_toolbar, _forward, 1); Add(_toolbar, _reload, 2); Add(_toolbar, _home, 3);
        Add(_toolbar, _address, 4); Add(_toolbar, _security, 5); Add(_toolbar, _shield, 6); Add(_toolbar, _bookmark, 7); Add(_toolbar, _ai, 8);
        Add(_toolbar, _splitView, 9); Add(_toolbar, _media, 10); Add(_toolbar, _more, 11);

        return new Border
        {
            BorderThickness = new(0, 0, 0, 1),
            BorderBrush = ChromeBrush("SutraBorderBrush"),
            Child = _toolbar
        };
    }

    private void BuildContentArea()
    {
        _contentGrid.ColumnDefinitions.Add(new() { Width = new(0) });
        _contentGrid.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        _contentGrid.ColumnDefinitions.Add(new() { Width = new(0) });

        _contentGrid.RowDefinitions.Add(new() { Height = GridLength.Auto });
        _contentGrid.RowDefinitions.Add(new() { Height = GridLength.Auto });
        _contentGrid.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        BuildDesktopSidebar();
        Grid.SetColumn(_browserToolbarHost, 1);
        _browserToolbarHost.Margin = new(0, 0, 6, 0);
        _contentGrid.Children.Add(_browserToolbarHost);
        Grid.SetColumn(_bookmarkBar, 1); Grid.SetRow(_bookmarkBar, 1);
        _contentGrid.Children.Add(_bookmarkBar);

        Grid.SetColumn(_browserHost, 1);
        _browserHost.Background = ResourceBrush("SolidBackgroundFillColorBaseBrush");
        var startup = new StackPanel { Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        startup.Children.Add(new Image { Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri("ms-appx:///Assets/sutra-icon.png")), Width = 48, Height = 48, HorizontalAlignment = HorizontalAlignment.Center });
        startup.Children.Add(new TextBlock { Text = AppBrand.Name, FontSize = 20, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center });
        startup.Children.Add(new ProgressRing { IsActive = true, Width = 18, Height = 18, HorizontalAlignment = HorizontalAlignment.Center });
        _browserHost.Children.Add(startup);
        _contentGrid.Children.Add(_browserHost);
        Grid.SetColumn(_workspaceHost, 1);
        _workspaceHost.Background = ResourceBrush("SolidBackgroundFillColorBaseBrush");
        _contentGrid.Children.Add(_workspaceHost);
        BuildCopilotPanel();
        Grid.SetColumn(_copilotPanel, 2);
        _contentGrid.Children.Add(_copilotPanel);
        _utilitySidebar.Visibility = Visibility.Collapsed;
        _utilitySidebar.BorderThickness = new(1, 0, 0, 0);
        _utilitySidebar.BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush");
        _utilitySidebar.Background = ResourceBrush("SolidBackgroundFillColorBaseBrush");
        Grid.SetColumn(_utilitySidebar, 2);
        _contentGrid.Children.Add(_utilitySidebar);

        _pageOverlay.Visibility = Visibility.Collapsed;
        // Manager pages must be opaque. A translucent layer allows the composed
        // WebView surface to bleed through and makes settings appear corrupted.
        _pageOverlay.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 32, 32, 32));
        _pageOverlay.BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush");
        _pageOverlay.BorderThickness = new(1, 0, 0, 0);
        // Browser-owned pages are tabs, not app-wide modal overlays. Keep the
        // tab sidebar visible by replacing only the normal browser-content column.
        Grid.SetColumn(_pageOverlay, 1);
        Grid.SetColumnSpan(_pageOverlay, 1);
        Canvas.SetZIndex(_pageOverlay, 20);
        _contentGrid.Children.Add(_pageOverlay);

        ConfigureMiniPlayer();
        Grid.SetColumn(_miniPlayerOverlay, 1);
        Canvas.SetZIndex(_miniPlayerOverlay, 15);
        _contentGrid.Children.Add(_miniPlayerOverlay);

        _notification.IsOpen = false;
        _notification.IsClosable = true;
        _notification.MaxWidth = 520;
        _notification.HorizontalAlignment = HorizontalAlignment.Right;
        _notification.VerticalAlignment = VerticalAlignment.Top;
        _notification.Margin = new(16);
        Grid.SetColumn(_notification, 1);
        Canvas.SetZIndex(_notification, 30);
        _contentGrid.Children.Add(_notification);

        _downloadShelf.Visibility = Visibility.Collapsed;
        _downloadShelf.HorizontalAlignment = HorizontalAlignment.Center;
        _downloadShelf.VerticalAlignment = VerticalAlignment.Bottom;
        _downloadShelf.Margin = new(16);
        _downloadShelf.Padding = new(12, 9, 8, 9);
        _downloadShelf.CornerRadius = new(10);
        _downloadShelf.BorderThickness = new(1);
        _downloadShelf.BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush");
        _downloadShelf.Background = ResourceBrush("SolidBackgroundFillColorBaseBrush");
        Grid.SetColumn(_downloadShelf, 1);
        Canvas.SetZIndex(_downloadShelf, 25);
        _contentGrid.Children.Add(_downloadShelf);

        ConfigureNavigationOverlays();

        _statusBubble.Visibility = Visibility.Collapsed;
        _statusBubble.HorizontalAlignment = HorizontalAlignment.Left;
        _statusBubble.VerticalAlignment = VerticalAlignment.Bottom;
        _statusBubble.Margin = new(8);
        _statusBubble.Padding = new(10, 5, 10, 5);
        _statusBubble.CornerRadius = new(7);
        _statusBubble.Background = ResourceBrush("SolidBackgroundFillColorBaseBrush");
        _statusBubble.BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush");
        _statusBubble.BorderThickness = new(1);
        _statusBubble.Child = _status;
        Grid.SetColumn(_statusBubble, 1);
        Canvas.SetZIndex(_statusBubble, 24);
        _contentGrid.Children.Add(_statusBubble);

        foreach (var child in _contentGrid.Children.OfType<FrameworkElement>())
        {
            if (child == _verticalPane || child == _browserToolbarHost || child == _bookmarkBar) continue;
            if (child == _workspaceHost || child == _utilitySidebar || child == _copilotPanel)
            {
                Grid.SetRow(child, 0); Grid.SetRowSpan(child, 3);
            }
            else Grid.SetRow(child, 2);
        }
        _browserHost.Margin = new(0, 0, 6, 6);
        _workspaceHost.Margin = new(6, 0, 6, 6);
        Grid.SetColumn(_webViewInitializationHost, 1); Grid.SetRow(_webViewInitializationHost, 2);
        _contentGrid.Children.Add(_webViewInitializationHost);
    }

    private Border BuildSidebarResizeHandle()
    {
        var handle = new Border
        {
            Width = 6,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Stretch,
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 128, 128, 128))
        };
        ToolTipService.SetToolTip(handle, "Drag to resize sidebar");
        handle.PointerEntered += (_, _) => handle.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(110, 128, 128, 128));
        handle.PointerExited += (_, _) => handle.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 128, 128, 128));

        var dragging = false;
        var startX = 0d;
        var startWidth = 0d;
        handle.PointerPressed += (_, e) =>
        {
            if (!SidebarExpanded) return;
            dragging = handle.CapturePointer(e.Pointer);
            startX = e.GetCurrentPoint(_contentGrid).Position.X;
            startWidth = _vm.Settings.SidebarWidth;
            e.Handled = true;
        };
        handle.PointerMoved += (_, e) =>
        {
            if (!dragging) return;
            var width = (int)Math.Round(Math.Clamp(startWidth + e.GetCurrentPoint(_contentGrid).Position.X - startX, 208, 520));
            _vm.Settings = _vm.Settings with { SidebarWidth = width };
            ApplyTabLayout();
            e.Handled = true;
        };
        handle.PointerReleased += async (_, e) =>
        {
            if (!dragging) return;
            dragging = false;
            handle.ReleasePointerCapture(e.Pointer);
            if (!_isPrivate) await SaveSettingsSafeAsync();
            e.Handled = true;
        };
        handle.PointerCanceled += (_, e) =>
        {
            dragging = false;
            handle.ReleasePointerCapture(e.Pointer);
        };
        return handle;
    }

    private MenuFlyout BuildMainMenu()
    {
        var flyout = new MenuFlyout();
        AddMenu(flyout, "New tab", () => NewTab(activate: true), "Ctrl+T", Symbol.Add);
        AddMenu(flyout, "New window", OpenNewWindow, "Ctrl+N", Symbol.NewWindow);
        AddMenu(flyout, "New private window", OpenPrivateWindow, "Ctrl+Shift+N", Symbol.ProtectedDocument);
        AddMenu(flyout, "Reopen closed tab", ReopenClosed, "Ctrl+Shift+T", Symbol.OpenFile);
        AddMenu(flyout, "Recently closed tabs", async () => await ShowRecentlyClosedAsync(), null, Symbol.Undo);
        AddMenu(flyout, "Search tabs", async () => await SearchTabsAsync(), null, Symbol.Find);
        AddMenu(flyout, "Organize tabs by site", async () => await SuggestDomainGroupsAsync(true), null, Symbol.Tag);
        AddMenu(flyout, "Command palette", async () => await ShowCommandPaletteAsync(), "Ctrl+Shift+P", Symbol.AllApps);
        AddMenu(flyout, "Workspaces", async () => await ShowWorkspacesAsync(), null, Symbol.Library);
        AddMenu(flyout, "Library", async () => await ShowLibrarySearchAsync(), null, Symbol.Library);
        if (!_isPrivate)
        {
            var capture = new MenuFlyoutSubItem { Text = "Save to Sutra", Icon = new SymbolIcon(Symbol.Save) };
            foreach (var (label, action) in new (string, Func<Task>)[]
            {
                ("Save to Collection", CaptureCollectionToSutraAsync),
                ("Annotate selection", AddResearchAnnotationToSutraAsync),
                ("Save PDF to Sutra", ImportPdfToSutraAsync)
            })
            {
                var item = new MenuFlyoutItem { Text = label };
                item.Click += async (_, _) => await action();
                capture.Items.Add(item);
            }
            flyout.Items.Add(capture);
        }
        AddMenu(flyout, "Save for offline reading", async () => await SaveOfflineArticleAsync(), null, Symbol.SaveLocal);
        AddMenu(flyout, "Offline library", async () => await ShowOfflineLibraryAsync(), null, Symbol.SaveLocal);
        AddMenu(flyout, "Session recovery", async () => await ShowSessionRecoveryAsync(), null, Symbol.Undo);
        AddMenu(flyout, "Web panels", async () => await ShowWebPanelsAsync(), null, Symbol.DockRight);
        if (!_isPrivate) AddMenu(flyout, "Extensions", async () => await ShowExtensionsAsync(), null, Symbol.Add);
        AddMenu(flyout, "Profiles", async () => await ShowProfilesAsync(), null, Symbol.Contact);
        AddMenu(flyout, "Keyboard shortcuts", async () => await ShowKeyboardShortcutsAsync(), null, Symbol.Keyboard);
        AddMenu(flyout, "Reading list", async () => await ShowReadingListAsync(), null, Symbol.Document);
        AddMenu(flyout, _vm.Settings.SidebarCollapsed ? "Expand tab sidebar" : "Collapse tab sidebar", async () => await ToggleTabSidebarAsync(), null, Symbol.DockLeft);
        AddMenu(flyout, "Sidebar", async () => await ToggleUtilitySidebarAsync(), null, Symbol.DockRight);
        AddMenu(flyout, "Settings", async () => await ShowSettingsAsync(), null, Symbol.Setting);
        flyout.Items.Add(new MenuFlyoutSeparator());
        AddMenu(flyout, "Page zoom", async () => await ShowPageZoomAsync(), null, Symbol.ZoomIn);
        AddMenu(flyout, "Search shortcuts", async () => await ShowSearchAliasesAsync(), null, Symbol.Find);
        AddMenu(flyout, "Site information", async () => await ShowSiteInformationAsync(), null, Symbol.ProtectedDocument);
        AddMenu(flyout, "Split view", () => BuildSplitViewMenu().ShowAt(_more), null, Symbol.View);
        AddMenu(flyout, "Media controls", async () => await ShowMediaHubAsync(), null, Symbol.Play);
        AddMenu(flyout, "Find in page", async () => await FindInPageAsync(), "Ctrl+F", Symbol.Find);
        AddMenu(flyout, "Reader mode", async () => await ToggleReaderModeAsync(), null, Symbol.Document);
        AddMenu(flyout, "Translate page to English", TranslateCurrentPage, null, Symbol.Globe);
        AddMenu(flyout, "Copy clean page link", async () => await CopyCleanLinkAsync(), null, Symbol.Copy);
        AddMenu(flyout, "Open clean copy", OpenCleanCopy, null, Symbol.OpenFile);
        AddMenu(flyout, "Page tools", async () => await ShowPageToolsAsync(), null, Symbol.Repair);
        AddMenu(flyout, "Search across open tabs", async () => await SearchAcrossTabsAsync(), null, Symbol.Find);
        AddMenu(flyout, "Browser health", async () => await ShowPerformanceDashboardAsync(), null, Symbol.Repair);
        AddMenu(flyout, "Full screen", ToggleFullScreen, "F11", Symbol.FullScreen);
        AddMenu(flyout, "Focus mode", ToggleFocusMode, "Ctrl+Shift+F", Symbol.FullScreen);
        AddMenu(flyout, "History", async () => await ShowHistoryAsync(), "Ctrl+H", Symbol.Clock);
        AddMenu(flyout, "Bookmarks", async () => await ShowBookmarksAsync(), null, Symbol.OutlineStar);
        AddMenu(flyout, "Downloads", async () => await ShowDownloadsAsync(), "Ctrl+J", Symbol.Download);
        AddMenu(flyout, "Passwords", async () => await ShowPasswordsAsync(), null, Symbol.Permissions);
        flyout.Items.Add(new MenuFlyoutSeparator());
        AddMenu(flyout, _vm.Settings.BookmarkBarVisible ? "Hide bookmark bar" : "Show bookmark bar", async () => await ToggleBookmarkBarAsync(), null, Symbol.Favorite);
        AddMenu(flyout, "Settings", async () => await ShowSettingsAsync(), null, Symbol.Setting);
        AddMenu(flyout, "Import browser data", async () => await ShowImportDataAsync(), null, Symbol.Download);
        if (!_isPrivate) AddMenu(flyout, "Welcome to Sutra", async () => await ShowOnboardingAsync(restart: false), null, Symbol.Help);
        AddMenu(flyout, "Updates", async () => await ShowUpdatesAsync(), null, Symbol.Sync);
        AddMenu(flyout, "About", async () => await ShowAboutAsync(), null, Symbol.Help);
        return flyout;
    }

    private static Button IconButton(Symbol symbol, string tooltip)
    {
        var button = new Button { Content = new Viewbox { Width = 18, Height = 18, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Child = new SymbolIcon(symbol) }, HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center, Width = 36, Height = 36, Padding = new(0), CornerRadius = new(8) };
        ToolTipService.SetToolTip(button, tooltip);
        // Icon-only buttons need a real name for keyboard users and screen readers.
        AutomationProperties.SetName(button, tooltip);
        return button;
    }

    private void FocusAddressBar()
    {
        _addressEditing = true;
        _address.Focus(FocusState.Keyboard);
        if (Microsoft.UI.Xaml.Input.FocusManager.GetFocusedElement(_root.XamlRoot) is TextBox text) text.SelectAll();
    }

    private static void Add(Grid grid, FrameworkElement element, int column) { Grid.SetColumn(element, column); grid.Children.Add(element); }

    private static void AddMenu(MenuFlyout flyout, string text, Action action, string? shortcut = null, Symbol? icon = null)
        => AddMenu(flyout, text, (Func<Task>)(() => { action(); return Task.CompletedTask; }), shortcut, icon);

    private static void AddMenu(MenuFlyout flyout, string text, Func<Task> action, string? shortcut = null, Symbol? icon = null)
    {
        var item = new MenuFlyoutItem { Text = text, KeyboardAcceleratorTextOverride = shortcut };
        if (icon is not null) item.Icon = new SymbolIcon(icon.Value);
        var running = false;
        item.Click += (_, _) =>
        {
            if (running) return;
            running = true;
            _ = ObserveUiCallbackAsync("Menu action", async () => { try { await action(); } finally { running = false; } });
        };
        flyout.Items.Add(item);
    }

    private static Brush ResourceBrush(string key)
    {
        if (Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush) return brush;
        return new SolidColorBrush(Colors.Transparent);
    }

    private void AddShortcuts()
    {
        // Ctrl+L is handled by the WebView document bridge. Keeping it out of the
        // WinUI accelerator collection prevents the framework from rendering its
        // transient "Ctrl+L" hint over webpages.
        Shortcut(VirtualKey.T, VirtualKeyModifiers.Control, async () => await OpenNewTabAndFocusAddressAsync());
        Shortcut(VirtualKey.K, VirtualKeyModifiers.Control, async () => await ShowLibrarySearchAsync());
        Shortcut(VirtualKey.Z, VirtualKeyModifiers.Control | VirtualKeyModifiers.Menu, async () => await SutraSaveAsync());
        Shortcut(VirtualKey.N, VirtualKeyModifiers.Control, OpenNewWindow);
        Shortcut(VirtualKey.N, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, OpenPrivateWindow);
        Shortcut(VirtualKey.W, VirtualKeyModifiers.Control, () => CloseTab(_vm.SelectedTab));
        Shortcut(VirtualKey.T, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, ReopenClosed);
        Shortcut(VirtualKey.F, VirtualKeyModifiers.Control, async () => await FindInPageAsync());
        Shortcut(VirtualKey.P, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, async () => await ShowCommandPaletteAsync());
        Shortcut(VirtualKey.K, VirtualKeyModifiers.Control | VirtualKeyModifiers.Menu | VirtualKeyModifiers.Shift, async () => await ((App)Application.Current).RunKillSwitchAsync());
        Shortcut(VirtualKey.P, VirtualKeyModifiers.Control, PrintCurrentPage);
        Shortcut(VirtualKey.D, VirtualKeyModifiers.Control, async () => await BookmarkCurrentAsync());
        Shortcut(VirtualKey.H, VirtualKeyModifiers.Control, async () => await ShowHistoryAsync());
        Shortcut(VirtualKey.J, VirtualKeyModifiers.Control, async () => await ShowDownloadsAsync());
        Shortcut(VirtualKey.R, VirtualKeyModifiers.Control, ReloadOrStop);
        Shortcut(VirtualKey.F5, VirtualKeyModifiers.None, ReloadOrStop);
        Shortcut(VirtualKey.Left, VirtualKeyModifiers.Menu, () => SafeGoBack());
        Shortcut(VirtualKey.Right, VirtualKeyModifiers.Menu, () => SafeGoForward());
        Shortcut(VirtualKey.Add, VirtualKeyModifiers.Control, () => Zoom(.1));
        Shortcut(VirtualKey.Subtract, VirtualKeyModifiers.Control, () => Zoom(-.1));
        Shortcut(VirtualKey.Number0, VirtualKeyModifiers.Control, () => SetZoom(1));
        Shortcut(VirtualKey.Tab, VirtualKeyModifiers.Control, () => CycleTabWithPreview(1));
        Shortcut(VirtualKey.Tab, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, () => CycleTabWithPreview(-1));
        Shortcut(VirtualKey.A, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, async () => await SearchTabsAsync());
        Shortcut(VirtualKey.F11, VirtualKeyModifiers.None, ToggleFullScreen);
        Shortcut(VirtualKey.F, VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, ToggleFocusMode);
    }

    private void Shortcut(VirtualKey key, VirtualKeyModifiers modifiers, Action action)
    {
        var accelerator = new KeyboardAccelerator { Key = key, Modifiers = modifiers };
        accelerator.Invoked += (_, e) => { if (_root.IsHitTestVisible) action(); e.Handled = true; };
        _root.KeyboardAccelerators.Add(accelerator);
    }

    private void OpenPrivateWindow() => ((App)Application.Current).OpenWindow(true);
    private void OpenNewWindow() => ((App)Application.Current).OpenWindow(false, null, false, _isPrivate ? "Default" : _profileName);
    private void OpenNewWindow(string url) => ((App)Application.Current).OpenWindow(false, url, false, _isPrivate ? "Default" : _profileName);

    private void ApplyTheme()
    {
        // The chosen new-tab appearance is also the browser-shell appearance.
        // Do not let the minute-based maintenance pass overwrite it with System.
        var theme = _vm.Settings.NewTabAppearance switch
        {
            NewTabAppearance.Light => BrowserTheme.Light,
            NewTabAppearance.Dark => BrowserTheme.Dark,
            _ => ThemeSchedule.Resolve(_vm.Settings, DateTime.Now.Hour)
        };
        var requestedTheme = theme switch
        {
            BrowserTheme.Light => ElementTheme.Light,
            BrowserTheme.Dark => ElementTheme.Dark,
            _ => ElementTheme.Default
        };

        // Changing RequestedTheme after this unpackaged WinUI window is already
        // composed has proved unstable on some WebView2/WinAppSDK combinations.
        // Persist the choice and apply it during the next clean window creation;
        // colors and new-tab styling still update immediately below.
        if (_nativeThemeInitialized)
        {
            _nativeThemeRestartRequired |= _root.RequestedTheme != requestedTheme;
            return;
        }
        try
        {
            _root.RequestedTheme = requestedTheme;
            _nativeThemeInitialized = true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Sutra could not apply the requested theme: {ex.GetType().Name}");
        }
    }

    private void ApplyCustomization()
    {
        if (_applyingCustomization) return;
        _applyingCustomization = true;
        try { ApplyCustomizationCore(); }
        catch (Exception ex) { Debug.WriteLine($"Sutra could not apply customization: {ex.GetType().Name}"); }
        finally { _applyingCustomization = false; }
    }

    private void ApplyCustomizationCore()
    {
        _home.Visibility = _vm.Settings.ShowHomeButton ? Visibility.Visible : Visibility.Collapsed;
        _bookmark.Visibility = _vm.Settings.ShowBookmarkButton ? Visibility.Visible : Visibility.Collapsed;
        _ai.Visibility = _vm.Settings.ShowAiButton ? Visibility.Visible : Visibility.Collapsed;
        // Keep the permanent chrome intentionally quiet. Secondary tools remain
        // available from the browser menu and retain their existing behavior.
        _security.Visibility = Visibility.Visible;
        _shield.Visibility = Visibility.Visible;
        _splitView.Visibility = _vm.Settings.ShowSplitButton ? Visibility.Visible : Visibility.Collapsed;
        _media.Visibility = _vm.Settings.ShowMediaButton ? Visibility.Visible : Visibility.Collapsed;
        var compact = _vm.Settings.ToolbarDensity == ToolbarDensity.Compact;
        _toolbar.Padding = compact ? new Thickness(6, 2, 6, 3) : new Thickness(8, 5, 8, 6);
        _address.Height = compact ? 32 : 38;
        foreach (var button in _toolbar.Children.OfType<Button>())
        {
            button.Height = compact ? 32 : 36;
            button.Background = new SolidColorBrush(Colors.Transparent);
            button.BorderBrush = new SolidColorBrush(Colors.Transparent);
            button.Foreground = ChromeBrush("SutraTextSecondaryBrush");
        }
        _address.Background = ChromeBrush("SutraSurfaceBrush");
        _address.BorderBrush = ChromeBrush("SutraBorderBrush");
        var controls = new Dictionary<string, FrameworkElement>(StringComparer.OrdinalIgnoreCase)
        {
            ["Back"] = _back, ["Forward"] = _forward, ["Reload"] = _reload, ["Home"] = _home,
            ["Address"] = _address, ["Security"] = _security, ["Shield"] = _shield, ["Bookmark"] = _bookmark,
            ["Ai"] = _ai, ["Split"] = _splitView, ["Media"] = _media, ["Menu"] = _more
        };
        var order = SettingsValidator.Validate(_vm.Settings).ToolbarOrder;
        for (var index = 0; index < _toolbar.ColumnDefinitions.Count; index++) _toolbar.ColumnDefinitions[index].Width = GridLength.Auto;
        for (var index = 0; index < order.Length; index++)
        {
            Grid.SetColumn(controls[order[index]], index);
            if (order[index] == "Address") _toolbar.ColumnDefinitions[index].Width = new(1, GridUnitType.Star);
        }
        try
        {
            var hex = _vm.Settings.AccentColor.TrimStart('#');
            var color = Windows.UI.Color.FromArgb(255, Convert.ToByte(hex[..2], 16), Convert.ToByte(hex[2..4], 16), Convert.ToByte(hex[4..6], 16));
            var surfaceHex = (_vm.Settings.UseCustomThemeColors ? _vm.Settings.ThemeSurfaceColor : _vm.Settings.AccentColor).TrimStart('#');
            var surface = Windows.UI.Color.FromArgb(255, Convert.ToByte(surfaceHex[..2], 16), Convert.ToByte(surfaceHex[2..4], 16), Convert.ToByte(surfaceHex[4..6], 16));
            var accent = new SolidColorBrush(color);
            var chromeTint = new SolidColorBrush(Windows.UI.Color.FromArgb(_root.ActualTheme == ElementTheme.Light ? (byte)20 : (byte)34, surface.R, surface.G, surface.B));
            var chromeStroke = new SolidColorBrush(Windows.UI.Color.FromArgb(_root.ActualTheme == ElementTheme.Light ? (byte)76 : (byte)112, surface.R, surface.G, surface.B));
            var glass = CreateGlassBrush(surface, _root.ActualTheme == ElementTheme.Light ? .72 : .64);
            var strongGlass = CreateGlassBrush(surface, _root.ActualTheme == ElementTheme.Light ? .82 : .74);
            _progress.Foreground = accent;
            _root.Background = ChromeBrush("SutraChromeBrush");
            if (_horizontalTabs.Parent is Grid titleChrome)
            {
                titleChrome.Background = ChromeBrush("SutraChromeBrush");
                if (titleChrome.Children.FirstOrDefault() is TextBlock mark) mark.Foreground = accent;
            }
            _toolbar.Background = ChromeBrush("SutraToolbarBrush");
            _horizontalTabs.Background = new SolidColorBrush(Colors.Transparent);
            _verticalPane.Background = ChromeBrush("SutraChromeBrush");
            _bookmarkBar.Background = ChromeBrush("SutraToolbarBrush");
            _utilitySidebar.Background = ChromeBrush("SutraSurfaceBrush");
            _downloadShelf.Background = ChromeBrush("SutraSurfaceBrush");
            _statusBubble.Background = ChromeBrush("SutraSurfaceBrush");
            _bookmarkBar.BorderBrush = ChromeBrush("SutraBorderBrush");
            _verticalPane.BorderBrush = ChromeBrush("SutraBorderBrush");
            _utilitySidebar.BorderBrush = ChromeBrush("SutraBorderBrush");
            _downloadShelf.BorderBrush = ChromeBrush("SutraBorderBrush");
            _statusBubble.BorderBrush = ChromeBrush("SutraBorderBrush");
        }
        catch { }
        RefreshDesktopNavigation();
        RefreshDesktopSidebar();
        ApplyCustomKeyboardShortcuts();
    }

    private static Brush CreateGlassBrush(Windows.UI.Color accent, double tintOpacity)
    {
        // AcrylicBrush can fail when a WinUI surface is rebuilt during an unpackaged
        // window customization. A high-opacity translucent tint keeps the glass look
        // but is safe to recreate repeatedly.
        var alpha = (byte)Math.Clamp((int)(tintOpacity * 255), 160, 248);
        return new SolidColorBrush(Windows.UI.Color.FromArgb(alpha, accent.R, accent.G, accent.B));
    }

    private async Task ToggleBookmarkBarAsync()
    {
        _vm.Settings = _vm.Settings with { BookmarkBarVisible = !_vm.Settings.BookmarkBarVisible };
        await SaveSettingsSafeAsync();
        await RefreshBookmarkBarAsync();
    }

    private void ShowStatus(string message, InfoBarSeverity severity = InfoBarSeverity.Informational, int milliseconds = 3500)
    {
        if (_isWindowClosed) return;
        _status.Text = message;
        _notification.ActionButton = null;
        _notification.Message = message;
        _notification.Severity = severity;
        _notification.IsOpen = true;
        // One reusable timer plus an expiry lease stored in FIELDS: the Tick
        // handler re-reads current state on every firing, so each notification
        // dismisses after its own lifetime and an older expiration can never
        // close a newer notification. The Undo button set afterwards stays
        // available for exactly this notification's full lifetime.
        var lease = _notificationLeaseTracker.Arm();
        _notificationScheduledGeneration = lease;
        if (_notificationTimer is null)
        {
            _notificationTimer = new DispatcherTimer();
            _notificationTimer.Tick += (_, _) =>
            {
                if (_notificationTimer is null) return;
                _notificationTimer.Stop();
                if (_notificationLeaseTracker.ShouldDismiss(_notificationScheduledGeneration) && !_isWindowClosed)
                    _notification.IsOpen = false;
            };
        }
        _notificationTimer.Stop();
        _notificationTimer.Interval = TimeSpan.FromMilliseconds(Math.Max(500, milliseconds));
        _notificationTimer.Start();
    }

    private void ShowUndoStatus(string message, Func<Task> undo)
    {
        ShowStatus(message, InfoBarSeverity.Informational, 7000);
        var button = new Button { Content = "Undo", CornerRadius = new(7) };
        AutomationProperties.SetName(button, "Undo the last action");
        // The lease generation this prompt belongs to; a newer notification
        // supersedes it and this button can no longer act on the InfoBar.
        var scheduledGeneration = _notificationScheduledGeneration;
        button.Click += async (_, _) =>
        {
            button.IsEnabled = false;
            // Retire THIS prompt before invoking the operation so the delegate's
            // own result notification (success or failure) is not closed by
            // stale teardown here. A superseded prompt never touches the bar.
            if (_notificationLeaseTracker.ShouldDismiss(scheduledGeneration))
            {
                _notification.ActionButton = null;
                _notification.IsOpen = false;
            }
            try
            {
                await undo();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Undo action failed: {ex.GetType().Name}");
                if (!_isWindowClosed && _notificationLeaseTracker.ShouldDismiss(_notificationScheduledGeneration))
                    ShowStatus("The last action could not be reversed.", InfoBarSeverity.Error);
            }
        };
        // The Undo button stays available for the notification's full lifetime.
        _notification.ActionButton = button;
    }

    private async void OnAppWindowClosing(Microsoft.UI.Windowing.AppWindow sender, Microsoft.UI.Windowing.AppWindowClosingEventArgs args)
    {
        if (_allowClose || _activeDownloads.Count == 0 && _pausedDownloads.Count == 0) return;
        try
        {
            args.Cancel = true;
            var dialog = new ContentDialog
            {
                Title = "Downloads are active or paused",
                Content = "Closing now will cancel these transfers. They cannot resume after restart.",
                PrimaryButtonText = "Cancel downloads and close",
                CloseButtonText = "Keep browsing",
                DefaultButton = ContentDialogButton.Close,
                XamlRoot = _root.XamlRoot
            };
            if (await dialog.ShowAsync() == ContentDialogResult.Primary)
            {
                var transfers = _activeDownloads.Values.Concat(_resumableDownloads.Where(x => _pausedDownloads.Contains(x.Key)).Select(x => x.Value)).Distinct().ToList();
                _pausedDownloads.Clear();
                foreach (var operation in transfers) { try { operation.Cancel(); } catch { } }
                _allowClose = true;
                Close();
            }
        }
        catch (Exception ex) { Debug.WriteLine($"Close confirmation failed: {ex.GetType().Name}"); }
    }

    private async void OnWindowClosed(object sender, WindowEventArgs args)
    {
        try
        {
        // From here on, no callback may update the UI of this window.
        _isWindowClosed = true;
        CloseFindBar(false);
        foreach (var callback in _nativePageClosedHandlers.Values.ToArray())
        {
            try { callback(); } catch (Exception ex) { Debug.WriteLine($"Page shutdown cleanup: {ex.GetType().Name}"); }
        }
        _nativePageClosedHandlers.Clear();
        _nativePageActivatedHandlers.Clear();
        try { _aiCancellation?.Cancel(); } catch { }

        StopTimer(_maintenanceTimer);
        StopTimer(_notificationTimer);
        StopTimer(_mediaTimer);
        StopTimer(_tabSwitcherTimer);

        // Cancel lifetime work and let tracked in-flight passes unwind before any
        // control they can observe is released. Cancellation is normal shutdown.
        try { _windowLifetimeCts.Cancel(); } catch { }
        try { await _assetWrites.StopAndDrainAsync(); }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Debug.WriteLine($"Asset write cleanup: {ex.GetType().Name}"); }
        await DrainBackgroundWorkQuietlyAsync(_maintenanceWork);
        await DrainBackgroundWorkQuietlyAsync(_mediaRefreshWork);

        // The utility web-panel WebView is not a tab WebView; close it explicitly.
        try { CloseWebPanel(); } catch { }
        try
        {
            if (_workspaceSidePanelOpen) CloseSutraSidePanel();
            if (_sutraWorkspaceView?.Parent is Panel workspaceParent) workspaceParent.Children.Remove(_sutraWorkspaceView);
            _sutraWorkspaceView?.Close();
            _sutraWorkspaceView = null;
            CleanupSutraPdfImports();
        }
        catch (Exception ex) { Debug.WriteLine($"Sutra workspace close failed: {ex.GetType().Name}"); }
        try { CloseAllTabWebViews(); } catch { }

        if (!_isPrivate && !_suppressPersistence)
        {
            try { CaptureWindowPlacement(); } catch { }
            // Only mark shutdown clean once the required normal-window state has
            // actually been flushed. A failed flush leaves the crash-recovery
            // notice active instead of pretending the exit was clean.
            try
            {
                if (await FlushSessionStateBeforeExitAsync() && _restoreSession)
                    await _appState.SetAsync("browser.cleanShutdown", "true");
                // Multi-window restore (#2): an explicitly closed window must not reopen next launch,
                // but the last remaining window must stay restorable. Crash shutdowns never reach here,
                // so their rows correctly remain for recovery.
                try
                {
                    var others = ((App)Application.Current).BrowserWindows.Count(w => !ReferenceEquals(w, this));
                    if (others > 0) await _windowSessions.DeleteAsync(_sessionWindowId);
                }
                catch (Exception ex) { Debug.WriteLine($"Window session cleanup failed: {ex.GetType().Name}"); }
            }
            catch (Exception ex) { Debug.WriteLine($"Shutdown flush failed: {ex.GetType().Name}"); }
        }

        // Best-effort cleanup of window-specific temporary data. Normal browser
        // data (favicons cache, database, credentials) is never deleted here.
        try { Directory.Delete(_newTabDirectory, true); } catch { /* best effort */ }
        if (_isPrivate)
        {
            try { Directory.Delete(_faviconDirectory, true); } catch { /* best effort */ }
        }
        // Native surfaces are gone: drop every per-page lifecycle callback and the
        // Notes manager's refresh state so nothing can update detached views.
        _nativePageClosedHandlers.Clear();
        _refreshNotesManagerView = null;
        _notesSidebarList = null;
        unchecked { _notesSearchGeneration++; }
        _windowLifetimeCts.Dispose();
        }
        finally { _shutdownCompleted.TrySetResult(); }
    }

    private static async Task DrainBackgroundWorkQuietlyAsync(Browser.Core.Runtime.BackgroundWorkTracker tracker)
    {
        try { await tracker.DrainAsync(); }
        catch (OperationCanceledException) { /* normal shutdown */ }
        catch (Exception ex) { Debug.WriteLine($"Background work drain stopped: {ex.GetType().Name}"); }
    }

    private void CloseAllTabWebViews()
    {
        foreach (var id in _videoMiniPlayers.Keys.ToArray())
            ObserveUiCallback("Close video mini-player", () => CloseVideoMiniPlayerAsync(id, restoreTab: false));
        CancelAllPendingTabWebViewInitializations();
        foreach (var pending in _webViewInitializationHost.Children.OfType<WebView2>().ToArray())
        {
            DetachWebView(pending);
            try { pending.Close(); } catch { }
        }
        foreach (var pair in _webViews.ToList())
        {
            _webViews.Remove(pair.Key);
            try { DetachWebView(pair.Value); }
            catch (Exception ex) { Debug.WriteLine($"WebView detach during shutdown: {ex.GetType().Name}"); }
            finally { try { pair.Value.Close(); } catch { /* already closed or detached */ } }
        }
    }

    private static void StopTimer(DispatcherTimer? timer) => timer?.Stop();

    /// <summary>
    /// Observes a task started by a void-based WinUI/WebView2 callback. These
    /// callbacks cannot return a Task to the framework, so every exception must
    /// be contained here instead of becoming an application-level crash.
    /// </summary>
    private void ObserveUiCallback(string name, Func<Task> operation)
    {
        _ = ObserveUiCallbackAsync(name, operation);
    }

    private static async Task ObserveUiCallbackAsync(string name, Func<Task> operation)
    {
        try { await operation(); }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            PrivacySafeDiagnosticLog.Record("ui-callback-failed", ex, name);
            Debug.WriteLine($"{name} callback failed: {ex.GetType().Name}");
        }
    }

    private bool IsCurrentTabWebView(BrowserTab tab, WebView2 web)
        => !_isWindowClosed && _vm.Tabs.Contains(tab) &&
           _webViews.TryGetValue(tab.Id, out var current) && ReferenceEquals(current, web);

    private bool IsCurrentWebPanel(WebView2 web)
        => !_isWindowClosed && ReferenceEquals(_webPanelView, web);
}

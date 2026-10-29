using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Browser.Core.Tabs;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace Browser.App;

public sealed partial class MainWindow
{
    private static readonly JsonSerializerOptions MediaJsonOptions = new() { PropertyNameCaseInsensitive = true };

    private void ConfigureMiniPlayer()
    {
        _miniPlayerOverlay.Visibility = Visibility.Collapsed;
        _miniPlayerOverlay.Width = 390;
        _miniPlayerOverlay.MaxHeight = 620;
        _miniPlayerOverlay.HorizontalAlignment = HorizontalAlignment.Right;
        _miniPlayerOverlay.VerticalAlignment = VerticalAlignment.Bottom;
        _miniPlayerOverlay.Margin = new(18);
        _miniPlayerOverlay.VerticalScrollMode = ScrollMode.Auto;
        _miniPlayerOverlay.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _miniPlayerOverlay.HorizontalScrollMode = ScrollMode.Disabled;
        _miniPlayerOverlay.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _miniPlayerOverlay.Content = _miniPlayerHost;
        _mediaTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        // Refreshes run once per second and await script results; overlapping
        // ticks would pile up slow ExecuteScriptAsync calls, so ticks are skipped
        // while one tracked refresh is still running. The refresh observes the
        // window-lifetime token and stops cooperatively during close, keeping its
        // continuations on the UI thread because they update slider controls.
        _mediaTimer.Tick += (_, _) =>
        {
            if (_isWindowClosed || _mediaRefreshWork.IsActive) return;
            _mediaRefreshWork.Track(RefreshMiniPlayersGuardedAsync(_windowLifetimeCts.Token));
        };
    }

    private async Task ShowMediaHubAsync()
    {
        var root = new Grid { Width = 420, MaxHeight = 650, RowSpacing = 12 };
        root.RowDefinitions.Add(new() { Height = GridLength.Auto });
        root.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        var heading = new StackPanel { Spacing = 2, Margin = new(4, 2, 4, 0) };
        heading.Children.Add(new TextBlock { Text = "Media", FontSize = 20, FontWeight = FontWeights.SemiBold });
        heading.Children.Add(new TextBlock { Text = "Recent tab media · up to 32 sessions", FontSize = 12, Opacity = .62 });
        root.Children.Add(heading);

        var list = new StackPanel { Spacing = 10, Padding = new(2, 0, 2, 4) };
        var loading = new ProgressRing { IsActive = true, Width = 24, Height = 24, Margin = new(0, 28, 0, 28), HorizontalAlignment = HorizontalAlignment.Center };
        list.Children.Add(loading);
        var scroll = new ScrollViewer { Content = list, VerticalScrollMode = ScrollMode.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Grid.SetRow(scroll, 1); root.Children.Add(scroll);

        var flyout = new Flyout { Content = root, Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Bottom };
        flyout.ShowAt(_media);

        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(_windowLifetimeCts.Token);
        void Closed(object? sender, object args) => cancellation.Cancel();
        flyout.Closed += Closed;
        List<(BrowserTab Tab, MediaSnapshot Media)> sessions;
        try { sessions = await DiscoverMediaSessionsAsync(cancellation.Token); }
        finally { flyout.Closed -= Closed; }
        if (_isWindowClosed || cancellation.IsCancellationRequested) return;
        list.Children.Clear();
        if (sessions.Count == 0)
        {
            var empty = new StackPanel { Spacing = 8, Padding = new(14, 30, 14, 34), HorizontalAlignment = HorizontalAlignment.Center };
            empty.Children.Add(new SymbolIcon(Symbol.Play) { Width = 28, Height = 28, Opacity = .55 });
            empty.Children.Add(new TextBlock { Text = "Nothing is playing", FontSize = 15, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center });
            empty.Children.Add(new TextBlock { Text = "Start audio or video in a tab, then open Media again.", TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, Opacity = .6, MaxWidth = 300 });
            list.Children.Add(empty);
            return;
        }

        foreach (var session in sessions) list.Children.Add(BuildMediaCard(session.Tab, session.Media));
    }

    private async Task<List<(BrowserTab Tab, MediaSnapshot Media)>> DiscoverMediaSessionsAsync(CancellationToken lifetimeToken = default)
    {
        var sessions = new List<(BrowserTab, MediaSnapshot)>();
        foreach (var tab in _vm.Tabs.OrderByDescending(tab => tab.Id == _vm.SelectedTab?.Id).ThenByDescending(tab => tab.LastActivatedAt).Take(32).ToArray())
        {
            if (_isWindowClosed || lifetimeToken.IsCancellationRequested || sessions.Count >= 32) break;
            if (!_webViews.TryGetValue(tab.Id, out var web) || web.CoreWebView2 is null) continue;
            var media = await QueryMediaAsync(web, lifetimeToken);
            if (!IsCurrentTabWebView(tab, web)) continue;
            if (media is null) continue;
            sessions.AddRange(media.Take(32 - sessions.Count).Select(item => (tab, item)));
            if (media.Count == 0 && tab.IsMediaPlaying)
                sessions.Add((tab, new MediaSnapshot("", "site", tab.Title, "This site is playing media", 0, null, false, tab.IsMuted, false)));
        }
        return sessions;
    }

    private Border BuildMediaCard(BrowserTab tab, MediaSnapshot media)
    {
        var card = new Border
        {
            Background = MediaSurfaceBrush(),
            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(90, 128, 128, 128)),
            BorderThickness = new(1),
            CornerRadius = new(10),
            Padding = new(12)
        };
        var stack = new StackPanel { Spacing = 10 };
        var identity = new Grid { ColumnSpacing = 10 };
        identity.ColumnDefinitions.Add(new() { Width = new(42) });
        identity.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        identity.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        identity.Children.Add(MediaArtwork(tab));
        var copy = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        copy.Children.Add(new TextBlock { Text = media.Title, FontSize = 14, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis });
        copy.Children.Add(new TextBlock { Text = $"{DisplayOrigin(tab.Url)} · {tab.Title}", FontSize = 11, Opacity = .65, TextTrimming = TextTrimming.CharacterEllipsis });
        Grid.SetColumn(copy, 1); identity.Children.Add(copy);
        var switchTab = IconButton(Symbol.Go, "Switch to this tab");
        switchTab.Width = switchTab.Height = 32;
        switchTab.Click += async (_, _) => await ActivateTabAsync(tab);
        Grid.SetColumn(switchTab, 2); identity.Children.Add(switchTab);
        stack.Children.Add(identity);

        var controls = new Grid { ColumnSpacing = 6 };
        controls.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        controls.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        controls.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        controls.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        controls.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        controls.ColumnDefinitions.Add(new() { Width = GridLength.Auto });

        var isPaused = media.Paused;
        var play = IconButton(isPaused ? Symbol.Play : Symbol.Pause, isPaused ? "Play" : "Pause");
        play.Width = play.Height = 34;
        play.IsEnabled = media.IsControllable;
        play.Click += async (_, _) =>
        {
            await ExecuteMediaCommandAsync(tab, media, "toggle");
            isPaused = !isPaused;
            play.Content = new SymbolIcon(isPaused ? Symbol.Play : Symbol.Pause);
        };
        controls.Children.Add(play);
        var rewind = new Button { Content = "−10", Width = 42, Height = 34, Padding = new(0), CornerRadius = new(8), IsEnabled = media.IsControllable };
        rewind.Click += async (_, _) => await ExecuteMediaCommandAsync(tab, media, "seek-by", -10);
        Grid.SetColumn(rewind, 1); controls.Children.Add(rewind);
        var slider = new Slider { Minimum = 0, Maximum = Math.Max(1, media.Duration ?? 1), Value = Math.Clamp(media.CurrentTime, 0, Math.Max(1, media.Duration ?? 1)), StepFrequency = 1, IsEnabled = media.IsControllable && media.Duration is > 0, VerticalAlignment = VerticalAlignment.Center };
        slider.ValueChanged += async (_, e) => { if (slider.IsEnabled && Math.Abs(e.NewValue - media.CurrentTime) > 1.5) await ExecuteMediaCommandAsync(tab, media, "seek", e.NewValue); };
        Grid.SetColumn(slider, 2); controls.Children.Add(slider);
        var forward = new Button { Content = "+10", Width = 42, Height = 34, Padding = new(0), CornerRadius = new(8), IsEnabled = media.IsControllable };
        forward.Click += async (_, _) => await ExecuteMediaCommandAsync(tab, media, "seek-by", 10);
        Grid.SetColumn(forward, 3); controls.Children.Add(forward);
        var isMuted = media.Muted;
        var mute = IconButton(isMuted ? Symbol.Mute : Symbol.Volume, isMuted ? "Unmute" : "Mute");
        mute.Width = mute.Height = 34;
        mute.Click += async (_, _) =>
        {
            await ExecuteMediaCommandAsync(tab, media, "mute");
            isMuted = !isMuted;
            mute.Content = new SymbolIcon(isMuted ? Symbol.Mute : Symbol.Volume);
        };
        Grid.SetColumn(mute, 4); controls.Children.Add(mute);
        var mini = new Button { Content = "Mini", Height = 34, Padding = new(10, 0, 10, 0), CornerRadius = new(8), IsEnabled = media.IsControllable };
        mini.Click += async (_, _) => await ShowMiniPlayerAsync(tab, media);
        Grid.SetColumn(mini, 5); controls.Children.Add(mini);
        stack.Children.Add(controls);

        var timing = new TextBlock { Text = $"{FormatMediaTime(media.CurrentTime)}  /  {FormatMediaTime(media.Duration)}", FontSize = 10, Opacity = .55, HorizontalAlignment = HorizontalAlignment.Right };
        stack.Children.Add(timing);
        card.Child = stack;
        return card;
    }

    private FrameworkElement MediaArtwork(BrowserTab tab)
    {
        if (!string.IsNullOrWhiteSpace(tab.FaviconPath) && File.Exists(tab.FaviconPath))
            return new Border { Width = 42, Height = 42, CornerRadius = new(8), Background = MediaSurfaceBrush(), Child = new Image { Source = new BitmapImage(new Uri(tab.FaviconPath)), Width = 24, Height = 24 } };
        return new Border { Width = 42, Height = 42, CornerRadius = new(8), Background = MediaSurfaceBrush(), Child = new SymbolIcon(Symbol.Play) };
    }

    private async Task<IReadOnlyList<MediaSnapshot>?> QueryMediaAsync(WebView2 web, CancellationToken lifetimeToken = default)
    {
        try
        {
            if (_isWindowClosed) return null;
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(_windowLifetimeCts.Token, lifetimeToken);
            var state = NavigationState(web);
            var generation = state.AssetGeneration;
            var result = await state.MediaQuery.RunAsync(async () => (generation, await web.ExecuteScriptAsync(MediaDiscoveryScript)),
                TimeSpan.FromSeconds(2), linked.Token);
            if (_isWindowClosed || result.Generation != state.AssetGeneration) return null;
            var json = result.Json;
            if (json.Length > 128 * 1024) return null;
            var snapshots = JsonSerializer.Deserialize<List<MediaSnapshot>>(json, MediaJsonOptions);
            if (snapshots is null) return null; // ExecuteScript reports a page-script exception as JSON null.
            return snapshots.Take(64)
                .Select(media => media with {
                    DocumentGeneration = result.Generation,
                    CurrentTime = double.IsFinite(media.CurrentTime) ? Math.Clamp(media.CurrentTime, 0, Browser.Core.Media.MediaTimePolicy.MaximumSeconds) : 0,
                    Duration = media.Duration is { } duration && double.IsFinite(duration) ? Math.Clamp(duration, 0, Browser.Core.Media.MediaTimePolicy.MaximumSeconds) : null
                }).ToArray();
        }
        catch { return null; }
    }

    private async Task ExecuteMediaCommandAsync(BrowserTab tab, MediaSnapshot media, string action, double value = 0)
    {
        if (!_webViews.TryGetValue(tab.Id, out var web) || web.CoreWebView2 is null) return;
        if (media.DocumentGeneration >= 0 && media.DocumentGeneration != NavigationState(web).AssetGeneration) return;
        if (string.IsNullOrWhiteSpace(media.Id))
        {
            if (action == "mute")
            {
                tab.IsMuted = !tab.IsMuted;
                web.CoreWebView2.IsMuted = tab.IsMuted;
                RefreshTabLists();
            }
            return;
        }
        if (action is not ("toggle" or "seek" or "seek-by" or "mute" or "pip")) return;
        var idJson = JsonSerializer.Serialize(media.Id);
        var actionJson = JsonSerializer.Serialize(action);
        var number = value.ToString(CultureInfo.InvariantCulture);
        var script = $$"""
            (async()=>{
              const id={{idJson}},action={{actionJson}},value={{number}};
              const media=[...document.querySelectorAll('audio,video')].find(x=>x.__sutraMediaId===id);
              if(!media)return {ok:false,reason:'Media element is no longer available'};
              try{
                if(action==='toggle'){if(media.paused)await media.play();else media.pause();}
                else if(action==='seek')media.currentTime=Math.max(0,Math.min(Number.isFinite(media.duration)?media.duration:value,value));
                else if(action==='seek-by')media.currentTime=Math.max(0,Math.min(Number.isFinite(media.duration)?media.duration:media.currentTime+value,media.currentTime+value));
                else if(action==='mute')media.muted=!media.muted;
                else if(action==='pip'){
                  if(media.tagName!=='VIDEO'||!document.pictureInPictureEnabled)return {ok:false,reason:'Picture-in-picture is unavailable for this player'};
                  media.disablePictureInPicture=false;
                  if(document.pictureInPictureElement===media)await document.exitPictureInPicture();else await media.requestPictureInPicture();
                }
                return {ok:true,paused:media.paused,muted:media.muted,currentTime:media.currentTime};
              }catch(error){return {ok:false,reason:String(error&&error.message||error)};}
            }
            )()
            """;
        try
        {
            var result = await web.ExecuteScriptAsync(script).AsTask().WaitAsync(TimeSpan.FromSeconds(3), _windowLifetimeCts.Token);
            if (_isWindowClosed) return;
            if (result.Contains("\"ok\":false", StringComparison.Ordinal)) ShowStatus("This player blocked that media control.", InfoBarSeverity.Warning);
        }
        catch { ShowStatus("This player is no longer available.", InfoBarSeverity.Warning); }
    }

    private async Task ShowMiniPlayerAsync(BrowserTab tab, MediaSnapshot media)
    {
        if (_isWindowClosed || !_webViews.TryGetValue(tab.Id, out var currentWeb) ||
            media.DocumentGeneration >= 0 && media.DocumentGeneration != NavigationState(currentWeb).AssetGeneration) return;
        if (string.IsNullOrWhiteSpace(media.Id))
        {
            ShowStatus("This site does not expose an individual media player.", InfoBarSeverity.Warning);
            return;
        }

        var key = new MiniPlayerKey(tab.Id, media.Id);
        if (media.Kind == "video")
        {
            await ShowVideoMiniPlayerAsync(tab, media);
            return;
        }
        if (_miniPlayers.ContainsKey(key))
        {
            ShowStatus("That media player is already open in mini-player.");
            return;
        }

        var player = BuildMiniPlayerContent(tab, media, key);
        _miniPlayers.Add(key, player);
        _miniPlayerHost.Children.Add(player.Container);
        _miniPlayerOverlay.Visibility = Visibility.Visible;
        _mediaTimer?.Start();
        if (media.Kind == "video") await ExecuteMediaCommandAsync(tab, media, "pip");
    }

    private MiniPlayerView BuildMiniPlayerContent(BrowserTab tab, MediaSnapshot media, MiniPlayerKey key)
    {
        var container = new Border
        {
            Background = new SolidColorBrush(_root.ActualTheme == ElementTheme.Light
                ? Windows.UI.Color.FromArgb(255, 248, 248, 248)
                : Windows.UI.Color.FromArgb(255, 39, 39, 39)),
            Padding = new(14),
            CornerRadius = new(12),
            BorderThickness = new(1),
            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(110, 128, 128, 128))
        };
        var root = new Grid { RowSpacing = 10 };
        root.RowDefinitions.Add(new() { Height = GridLength.Auto });
        root.RowDefinitions.Add(new() { Height = GridLength.Auto });
        root.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var header = new Grid { ColumnSpacing = 8 };
        header.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var title = new StackPanel { Spacing = 2 };
        title.Children.Add(new TextBlock { Text = media.Title, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis });
        title.Children.Add(new TextBlock { Text = DisplayOrigin(tab.Url), FontSize = 11, Opacity = .6 });
        header.Children.Add(title);
        var close = IconButton(Symbol.Cancel, "Close mini-player"); close.Width = close.Height = 30;
        close.Click += (_, _) => CloseMiniPlayer(key); Grid.SetColumn(close, 1); header.Children.Add(close); root.Children.Add(header);

        var controls = new Grid { ColumnSpacing = 6 };
        controls.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        controls.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        controls.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        controls.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        controls.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var playPause = IconButton(media.Paused ? Symbol.Play : Symbol.Pause, media.Paused ? "Play" : "Pause");
        playPause.Width = playPause.Height = 34;
        playPause.Click += async (_, _) => await ExecuteMediaCommandAsync(tab, media, "toggle"); controls.Children.Add(playPause);
        var rewind = new Button { Content = "−10", Width = 42, Height = 34, Padding = new(0), CornerRadius = new(8) }; rewind.Click += async (_, _) => await ExecuteMediaCommandAsync(tab, media, "seek-by", -10); Grid.SetColumn(rewind, 1); controls.Children.Add(rewind);
        var slider = new Slider { Minimum = 0, Maximum = Math.Max(1, media.Duration ?? 1), Value = Math.Clamp(media.CurrentTime, 0, Math.Max(1, media.Duration ?? 1)), StepFrequency = 1, IsEnabled = media.Duration is > 0 };
        Grid.SetColumn(slider, 2); controls.Children.Add(slider);
        var forward = new Button { Content = "+10", Width = 42, Height = 34, Padding = new(0), CornerRadius = new(8) }; forward.Click += async (_, _) => await ExecuteMediaCommandAsync(tab, media, "seek-by", 10); Grid.SetColumn(forward, 3); controls.Children.Add(forward);
        var mute = IconButton(media.Muted ? Symbol.Mute : Symbol.Volume, "Mute or unmute"); mute.Width = mute.Height = 34; mute.Click += async (_, _) => await ExecuteMediaCommandAsync(tab, media, "mute"); Grid.SetColumn(mute, 4); controls.Children.Add(mute);
        Grid.SetRow(controls, 1); root.Children.Add(controls);
        var time = new TextBlock { Text = $"{FormatMediaTime(media.CurrentTime)} / {FormatMediaTime(media.Duration)}", FontSize = 10, Opacity = .6, HorizontalAlignment = HorizontalAlignment.Right, IsHitTestVisible = false };
        Grid.SetRow(time, 2); root.Children.Add(time);
        container.Child = root;
        var player = new MiniPlayerView(key, container, slider, time, playPause);
        slider.ValueChanged += async (_, e) =>
        {
            if (!player.IsUpdating && slider.IsEnabled)
                await ExecuteMediaCommandAsync(tab, media, "seek", e.NewValue);
        };
        return player;
    }

    private async Task RefreshMiniPlayersGuardedAsync(CancellationToken lifetimeToken)
    {
        try { await RefreshMiniPlayerAsync(lifetimeToken); }
        catch (OperationCanceledException) { /* normal shutdown */ }
        catch (Exception ex) { Debug.WriteLine($"Mini-player refresh failed: {ex.GetType().Name}"); }
    }

    private async Task RefreshMiniPlayerAsync(CancellationToken lifetimeToken = default)
    {
        foreach (var player in _miniPlayers.Values.ToList())
        {
            if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
            if (!_webViews.TryGetValue(player.Key.TabId, out var web))
            {
                CloseMiniPlayer(player.Key);
                continue;
            }
            var snapshots = await QueryMediaAsync(web, lifetimeToken);
            if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
            if (!_miniPlayers.TryGetValue(player.Key, out var current) || !ReferenceEquals(current, player) ||
                FindTab(player.Key.TabId) is not { } liveTab || !IsCurrentTabWebView(liveTab, web)) continue;
            if (snapshots is null) continue; // A busy renderer is not a removed media element.
            var media = snapshots.FirstOrDefault(item => item.Id == player.Key.MediaId);
            if (media is null)
            {
                CloseMiniPlayer(player.Key);
                continue;
            }
            player.IsUpdating = true;
            try
            {
                player.Slider.Maximum = Math.Max(1, media.Duration ?? 1);
                player.Slider.Value = Math.Clamp(media.CurrentTime, 0, player.Slider.Maximum);
                player.Slider.IsEnabled = media.Duration is > 0;
                player.Time.Text = $"{FormatMediaTime(media.CurrentTime)} / {FormatMediaTime(media.Duration)}";
                player.PlayPause.Content = new SymbolIcon(media.Paused ? Symbol.Play : Symbol.Pause);
            }
            finally { player.IsUpdating = false; }
        }
    }

    private bool HasMiniPlayerForTab(Guid tabId) => _videoMiniPlayers.ContainsKey(tabId) || _miniPlayers.Keys.Any(key => key.TabId == tabId);

    private void CloseMiniPlayersForTab(Guid tabId)
    {
        if (_videoMiniPlayers.ContainsKey(tabId))
            ObserveUiCallback("Close video mini-player", () => CloseVideoMiniPlayerAsync(tabId, restoreTab: false));
        foreach (var key in _miniPlayers.Keys.Where(key => key.TabId == tabId).ToList()) CloseMiniPlayer(key);
    }

    private void CloseMiniPlayer(MiniPlayerKey key)
    {
        if (!_miniPlayers.Remove(key, out var player)) return;
        _miniPlayerHost.Children.Remove(player.Container);
        if (_miniPlayers.Count != 0) return;
        _mediaTimer?.Stop();
        _miniPlayerOverlay.Visibility = Visibility.Collapsed;
    }

    private Brush MediaSurfaceBrush() => new SolidColorBrush(_root.ActualTheme == ElementTheme.Light
        ? Windows.UI.Color.FromArgb(255, 250, 250, 250)
        : Windows.UI.Color.FromArgb(255, 45, 45, 45));
    private static string DisplayOrigin(string url) => Uri.TryCreate(url, UriKind.Absolute, out var uri) && !string.IsNullOrWhiteSpace(uri.Host) ? uri.Host : "Local page";
    private static string FormatMediaTime(double? seconds)
    {
        return Browser.Core.Media.MediaTimePolicy.Format(seconds);
    }

    private const string MediaDiscoveryScript = """
        (()=>{
          let next=window.__sutraMediaNextId||1;window.__sutraMediaNextId=next;
          const metadata=navigator.mediaSession&&navigator.mediaSession.metadata;
          const metadataTitle=String(metadata&&metadata.title||'').slice(0,512);
          const isYouTube=location.hostname==='youtube.com'||location.hostname.endsWith('.youtube.com');
          const primary=isYouTube&&document.querySelector('#movie_player video.html5-main-video, #movie_player video');
          const visible=media=>{
            if(!media.getClientRects().length)return false;
            for(let node=media;node;node=node.parentElement){
              const style=getComputedStyle(node);
              if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
            }
            return true;
          };
          const score=media=>(!media.paused&&!media.ended?100:0)+(visible(media)?20:0)+(media.currentTime>0?10:0);
          const found=primary?[primary]:document.querySelectorAll('audio,video');
          const bounded=[];for(let i=0;i<Math.min(found.length,64);i++)bounded.push(found[i]);
          const candidates=bounded.filter(media=>{
            if(!(media.currentSrc||media.readyState>0||!media.paused))return false;
            if(primary)return media===primary;
            if(media.closest('ytd-ad-slot-renderer,ytd-display-ad-renderer,ytd-promoted-video-renderer'))return false;
            return media.tagName==='AUDIO'||visible(media)||!media.paused;
          });
          const unique=new Map();
          for(const media of candidates){
            // Metadata is shared by all elements in a document. Hidden/preloaded
            // copies without individual labels represent one playback session.
            const label=(media.getAttribute('aria-label')||media.getAttribute('title')||'').slice(0,512);
            const source=media.currentSrc||'';
            const key=label||metadataTitle
              ? media.tagName+':'+(label||metadataTitle)
              : media.tagName+':'+(source.length<=2048?source:candidates.indexOf(media));
            const previous=unique.get(key);
            if(!previous||score(media)>score(previous))unique.set(key,media);
          }
          const items=[...unique.values()];
          return items.map(media=>{
            if(!media.__sutraMediaId){Object.defineProperty(media,'__sutraMediaId',{value:`sutra-${window.__sutraMediaNextId++}`,configurable:true});}
            if(typeof media.__sutraMediaId!=='string'||media.__sutraMediaId.length>128)return null;
            const label=media.getAttribute('aria-label')||media.getAttribute('title')||(isYouTube?document.title:metadata&&metadata.title)||document.title||location.hostname;
            return {
              id:media.__sutraMediaId,
              kind:media.tagName.toLowerCase(),
              title:String(label||'Media').slice(0,512),
              artist:String(metadata&&metadata.artist||'').slice(0,256),
              currentTime:Number.isFinite(media.currentTime)?media.currentTime:0,
              duration:Number.isFinite(media.duration)?media.duration:null,
              paused:media.paused,
              muted:media.muted||media.volume===0,
              isControllable:true
            };
          }).filter(Boolean);
        })()
        """;

    private readonly record struct MiniPlayerKey(Guid TabId, string MediaId);

    private sealed class MiniPlayerView(
        MiniPlayerKey key,
        Border container,
        Slider slider,
        TextBlock time,
        Button playPause)
    {
        public MiniPlayerKey Key { get; } = key;
        public Border Container { get; } = container;
        public Slider Slider { get; } = slider;
        public TextBlock Time { get; } = time;
        public Button PlayPause { get; } = playPause;
        public bool IsUpdating { get; set; }
    }

    private sealed record MediaSnapshot(
        string Id,
        string Kind,
        string Title,
        string Artist,
        double CurrentTime,
        double? Duration,
        bool Paused,
        bool Muted,
        bool IsControllable,
        int DocumentGeneration = -1);
}

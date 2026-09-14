using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Browser.Core.Branding;
using Browser.Core.Navigation;
using Browser.Core.Onboarding;
using Browser.Core.Runtime;
using Browser.Core.Sessions;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using Browser.Data.Models;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Streams;
using Windows.System;
using Windows.UI;
using Windows.ApplicationModel.DataTransfer;

namespace Browser.App;

public sealed partial class MainWindow
{
    private BrowserSession? _previousSession;
    private bool _previousSessionRestored;
    private bool _isReplacingTabs;
    private bool _startupNeedsReview;

    private async Task InitializeAsync()
    {
        var boot = System.Diagnostics.Stopwatch.StartNew();
        void Phase(string name)
        {
            try { _startupTimings.Add(new(name, boot.ElapsedMilliseconds - _startupTimings.Sum(p => p.Milliseconds))); } catch { }
        }
        var previousCleanShutdown = _isPrivate || !_restoreSession ? "true" : await _appState.GetAsync("browser.cleanShutdown");
        Phase("state");
        if (!_isPrivate && _restoreSession)
        {
            var recovery = StartupRecoveryPolicy.Begin(await _appState.GetAsync(StartupRecoveryPolicy.StorageKey), previousCleanShutdown != "false", DateTimeOffset.UtcNow);
            _startupNeedsReview = recovery.NeedsReview;
            await _appState.SetAsync(StartupRecoveryPolicy.StorageKey, JsonSerializer.Serialize(recovery));
        }
        if (!_isPrivate && _restoreSession) await _appState.SetAsync("browser.cleanShutdown", "false");
        var existingSettings = !_isPrivate && _restoreSession ? await _appState.GetAsync("browser.settings") : null;
        var existingSession = !_isPrivate && _restoreSession ? await _appState.GetAsync("browser.session") : null;
        OnboardingState.TryDeserialize(!_isPrivate ? await _appState.GetAsync(OnboardingState.StorageKey) : null, out var onboardingState);
        _vm.Settings = await _settingsRepository.LoadAsync();
        Phase("settings");
        if (_isWindowClosed) return;
        if (!_isPrivate && _vm.Settings.HistoryRetentionDays > 0)
            await _history.DeleteOlderThanAsync(DateTimeOffset.UtcNow.AddDays(-_vm.Settings.HistoryRetentionDays));
        RestoreWindowPlacement();
        await LoadContentBlockRulesAsync();
        Phase("filters");
        _ = EnsureContentFiltersAvailableAsync();
        ApplyTheme();
        ApplyCustomization();
        ApplyTabLayout();
        var session = _isPrivate
            ? new BrowserSession([], null, DateTimeOffset.UtcNow)
            : _launchSession ?? await _sessions.LoadAsync();
        Phase("session");
        if (_isWindowClosed) return;
        _previousSession = !_isPrivate && _restoreSession && (session.Tabs?.Count ?? 0) > 0 ? session : null;
        foreach (var snapshot in session.Groups ?? [])
        {
            if (snapshot is null) continue;
            var group = TabGroup.FromSnapshot(snapshot);
            _tabGroups[group.Id] = group;
        }
        if (!_isPrivate && !_startupNeedsReview && (_launchSession is not null || _restoreSession && _vm.Settings.StartupBehavior == StartupBehavior.RestorePreviousSession))
        {
            _previousSessionRestored = true;
            foreach (var snapshot in session.Tabs ?? []) _vm.Add(BrowserTab.FromSnapshot(snapshot), false);
        }
        MigrateLegacyTabGroups();
        // A normal launch should always feel like opening a browser: land on a
        // ready-to-use new tab. Restored session tabs remain available behind it.
        var opensDefaultNewTab = !_isPrivate && _launchSession is null && string.IsNullOrWhiteSpace(_initialUrl);
        BrowserTab? launchTab = null;
        if (opensDefaultNewTab)
        {
            launchTab = _vm.Tabs.LastOrDefault(tab => tab.Url == "browser://newtab");
            if (launchTab is null)
            {
                launchTab = new BrowserTab { Url = "browser://newtab", Title = AppBrand.NewTabTitle };
                _vm.Add(launchTab, false);
            }
        }
        else if (_vm.Tabs.Count == 0)
        {
            launchTab = new BrowserTab { Url = _initialUrl ?? "browser://newtab", Title = _initialUrl ?? AppBrand.NewTabTitle };
            _vm.Add(launchTab, false);
        }
        if (!_isPrivate && !_startupNeedsReview && (_launchSession is not null || _restoreSession && _vm.Settings.StartupBehavior == StartupBehavior.RestorePreviousSession))
            foreach (var id in session.SplitTabIds ?? [])
                if (_vm.Tabs.Any(tab => tab.Id == id)) _splitTabIds.Add(id);
        if (_splitTabIds.Count < 2) { _splitTabIds.Clear(); _splitColumnFractions = null; _splitRowFractions = null; }
        else
        {
            _splitColumnFractions = session.SplitColumnFractions;
            _splitRowFractions = session.SplitRowFractions;
        }
        _splitLayout = session.SplitLayout;
        var initial = launchTab ?? _vm.Tabs.FirstOrDefault(x => x.Id == session.ActiveTabId) ?? _vm.Tabs.FirstOrDefault();
        if (initial is null)
        {
            // Session data guarantees at least one tab above, but never let a
            // corrupt/empty session leave startup with nothing to activate.
            initial = new BrowserTab { Url = "browser://newtab", Title = AppBrand.NewTabTitle };
            _vm.Add(initial, false);
        }
        RefreshTabLists();
        await RefreshBookmarkBarAsync();
        Phase("chrome");
        await ActivateTabAsync(initial);
        Phase("first-tab");
        try
        {
            var normalized = Browser.Core.Diagnostics.StartupPerformancePolicy.Normalize(_startupTimings);
            _startupTimings.Clear();
            _startupTimings.AddRange(normalized);
            if (Browser.Core.Diagnostics.StartupPerformancePolicy.IsSlowColdStart(_startupTimings))
                System.Diagnostics.Debug.WriteLine(Browser.Core.Diagnostics.StartupPerformancePolicy.Summarize(_startupTimings));
        }
        catch { }
        if (_isWindowClosed) return;
        if (OnboardingEligibility.ShouldShow(_isPrivate, _initialUrl is not null, _restoreSession, existingSettings is not null, existingSession is not null, onboardingState))
            await ShowOnboardingAsync(restart: true);
        _ = RefreshTabMemoryUsageAsync();
        if (previousCleanShutdown == "false")
        {
            ShowStatus(_startupNeedsReview
                ? "Sutra opened a fresh tab after repeated unexpected shutdowns. Review saved tabs before reopening them."
                : "Sutra previously closed unexpectedly. Your saved tabs are available in session recovery.", InfoBarSeverity.Warning, 12000);
            var review = new Button { Content = "Review saved tabs", CornerRadius = new(7) };
            review.Click += async (_, _) => await ShowSessionRecoveryAsync();
            _notification.ActionButton = review;
        }
        _maintenanceTimer = new DispatcherTimer { Interval = TimeSpan.FromMinutes(1) };
        // The tick body is asynchronous. A slow hibernation or session-save pass
        // must never overlap the next pass, so overlapping ticks are skipped
        // while one tracked pass is in flight instead of queueing duplicates.
        // The pass observes the window-lifetime token so it stops cooperatively
        // during close.
        _maintenanceTimer.Tick += (_, _) =>
        {
            if (_isWindowClosed || _maintenanceWork.IsActive) return;
            _maintenanceWork.Track(RunMaintenancePassAsync(_windowLifetimeCts.Token));
        };
        _maintenanceTimer.Start();
        if (_isPrivate) ShowStatus("Private browsing is active. History and site data from this window are not saved.", InfoBarSeverity.Informational, 7000);
    }

    private void EnsureEmergencyTab()
    {
        // Last-resort startup containment: guarantee a usable tab without touching
        // WebView2 or async work that could throw again.
        if (_vm.Tabs.Count == 0)
            _vm.Add(new BrowserTab { Url = "browser://newtab", Title = AppBrand.NewTabTitle }, true);
        if (_vm.SelectedTab is null) _vm.SelectedTab = _vm.Tabs[0];
        RefreshTabLists();
    }

    private async Task RunMaintenancePassAsync(CancellationToken lifetimeToken)
    {
        try
        {
            // Automatic hibernation is quiet: per-tab "sleeping" toasts during a
            // background pass would be notification spam.
            await HibernateInactiveTabsAsync(quiet: true, lifetimeToken);
            if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
            _ = RefreshTabMemoryUsageAsync(lifetimeToken);
            ApplyTheme();
            if (++_maintenanceTicks % 60 == 0)
            {
                PurgeStaleFavicons();
                if (!_isPrivate && _vm.Settings.HistoryRetentionDays > 0)
                    await _history.DeleteOlderThanAsync(DateTimeOffset.UtcNow.AddDays(-_vm.Settings.HistoryRetentionDays), lifetimeToken);
            }
            await SaveSessionAsync();
        }
        catch (OperationCanceledException)
        {
            // Cancellation is normal shutdown, not an error.
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Maintenance pass stopped: {ex.GetType().Name}");
        }
    }

    private BrowserTab NewTab(string url = "browser://newtab", bool activate = true, bool isTemporary = false, Guid? parentId = null)
    {
        if (!isTemporary && _vm.Settings.PreventDuplicateTabs && url != "browser://newtab" && _vm.Tabs.FirstOrDefault(x => !x.IsTemporary && x.Url.Equals(url, StringComparison.OrdinalIgnoreCase)) is { } existing)
        {
            if (activate) _ = ActivateTabAsync(existing);
            ShowStatus("That page is already open");
            return existing;
        }
        var tab = new BrowserTab { Url = url, Title = url == "browser://newtab" ? AppBrand.NewTabTitle : url, IsTemporary = isTemporary };
        if (parentId is { } parent && parent != Guid.Empty && _vm.Tabs.Any(x => x.Id == parent && x.Id != tab.Id))
            tab.ParentId = parent;
        _vm.Add(tab, activate);
        RefreshTabLists();
        if (activate) _ = ActivateTabAsync(tab);
        if (isTemporary) ShowStatus("Temporary tab — it closes with this window and is never saved.", InfoBarSeverity.Informational, 4000);
        else _ = SaveSessionAsync();
        return tab;
    }

    private async Task OpenNewTabAndFocusAddressAsync()
    {
        // Ctrl+T is a typing shortcut: do not let the new-tab document's autofocus
        // win the focus race with the browser chrome.
        var tab = NewTab(activate: false);
        await ActivateTabAsync(tab);
        DispatcherQueue.TryEnqueue(() =>
        {
            _address.Text = string.Empty;
            _address.Focus(FocusState.Keyboard);
        });
    }

    private async Task DuplicateTabAsync(BrowserTab source)
    {
        if (IsNativePageTab(source)) { ShowStatus("Browser pages cannot be duplicated. Open it again from the menu."); return; }
        var url = source.Url == "browser://newtab" || source.Url.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ? "browser://newtab" : source.Url;
        var duplicate = new BrowserTab
        {
            Url = url,
            Title = url == "browser://newtab" ? AppBrand.NewTabTitle : source.Title,
            FaviconPath = source.FaviconPath,
            IsMuted = source.IsMuted,
            GroupId = source.GroupId,
            GroupName = source.GroupName,
            IsTemporary = source.IsTemporary,
            ParentId = source.ParentId is { } parent && _vm.Tabs.Any(x => x.Id == parent) ? parent : null,
        };
        _vm.Add(duplicate, true);
        RefreshTabLists();
        await ActivateTabAsync(duplicate);
    }

    private void ReopenClosed()
    {
        var tab = _vm.Reopen();
        if (tab is not null)
        {
            RefreshTabLists();
            _ = ActivateTabAsync(tab);
            return;
        }

        // When the whole browser was closed, the last normal session is kept in
        // browser.session. Ctrl+Shift+T can restore it on the next launch.
        if (!_isPrivate && !_previousSessionRestored && _previousSession is { Tabs.Count: > 0 })
            _ = RestorePreviousSessionFromShortcutAsync(_previousSession);
    }

    private async Task RestorePreviousSessionFromShortcutAsync(BrowserSession session)
    {
        _previousSessionRestored = true;
        try
        {
            await ReplaceTabsWithSessionAsync(session);
            ShowStatus($"Restored {session.Tabs.Count} tabs from the previous session.", InfoBarSeverity.Success);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Previous-session restore failed: {ex.GetType().Name}");
            if (!_isWindowClosed) ShowStatus("The previous session could not be restored.", InfoBarSeverity.Error);
        }
    }

    private async Task ActivateTabAsync(BrowserTab tab)
    {
        var activation = ++_activationVersion;
        var previousSelectedTabId = _vm.SelectedTab?.Id;
        if (_vm.SelectedTab is not null && _vm.SelectedTab.Id != tab.Id) _vm.SelectedTab.LastActivatedAt = DateTimeOffset.UtcNow;
        _vm.SelectedTab = tab;
        tab.LastActivatedAt = DateTimeOffset.UtcNow;
        if (_nativePageTabs.TryGetValue(tab.Id, out var nativePage))
        {
            ShowNativePageVisual(nativePage);
            _address.Text = tab.Url;
            RefreshTabLists();
            return;
        }
        HideNativePageVisual();
        if (!_webViews.TryGetValue(tab.Id, out var web)) web = await CreateWebViewAsync(tab);
        // The window may have closed while the WebView was being created; never
        // touch released visuals after that point.
        if (_isWindowClosed || activation != _activationVersion || _vm.SelectedTab?.Id != tab.Id) return;
        if (IsSplitViewActive)
        {
            if (!_splitTabIds.Contains(tab.Id)) ReplaceActiveSplitPane(tab.Id, previousSelectedTabId);
            await EnsureSplitWebViewsAsync();
            RenderBrowserSurface();
        }
        else
        {
            DetachWebView(web);
            _browserHost.Children.Clear();
            _browserHost.RowDefinitions.Clear();
            _browserHost.ColumnDefinitions.Clear();
            _browserHost.Children.Add(web);
        }
        await RenderAttachedNewTabPagesAsync();
        _address.Text = tab.Url == "browser://newtab" ? string.Empty : tab.Url;
        UpdateNavigationState(web, tab);
        RefreshTabLists();
    }

    private async Task<WebView2> CreateWebViewAsync(BrowserTab tab)
    {
        var web = new WebView2 { HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
        var environment = await _environment.GetAsync();
        if (_isWindowClosed) { try { web.Close(); } catch { } throw new OperationCanceledException(); }
        if (_isPrivate)
        {
            var options = environment.CreateCoreWebView2ControllerOptions();
            options.ProfileName = AppBrand.PrivateProfileName;
            options.IsInPrivateModeEnabled = true;
            await web.EnsureCoreWebView2Async(environment, options);
        }
        else if (!_profileName.Equals("Default", StringComparison.OrdinalIgnoreCase))
        {
            var options = environment.CreateCoreWebView2ControllerOptions();
            options.ProfileName = Browser.Core.Profiles.ProfileIdentity.WebViewName(_profileName);
            await web.EnsureCoreWebView2Async(environment, options);
        }
        else await web.EnsureCoreWebView2Async(environment);
        if (_isWindowClosed) { try { web.Close(); } catch { } throw new OperationCanceledException(); }

        var core = web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
        {
            if (IsCurrentTabWebView(tab, web)) OnWebResourceRequested(tab, core, e);
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(ShortcutBridgeScript);
        core.WebMessageReceived += (_, e) =>
        {
            if (IsCurrentTabWebView(tab, web)) ObserveUiCallback("Web message", () => OnWebMessageReceivedAsync(tab, e));
        };
        core.NavigationStarting += (_, e) =>
        {
            if (IsCurrentTabWebView(tab, web)) ObserveUiCallback("Navigation starting", () => OnNavigationStartingAsync(tab, e));
        };
        core.NavigationCompleted += (_, e) =>
        {
            if (IsCurrentTabWebView(tab, web)) ObserveUiCallback("Navigation completed", () => OnNavigationCompletedAsync(tab, web, e));
        };
        core.SourceChanged += (_, _) =>
        {
            if (!IsCurrentTabWebView(tab, web)) return;
            var source = core.Source;
            var internalPage = tab.Url == "browser://newtab" && (source.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || source == "about:blank" || source.Equals(_newTabFileUri, StringComparison.OrdinalIgnoreCase));
            var errorPage = tab.Error is not null && (source.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || source == "about:blank");
            if (!internalPage && !errorPage) tab.Url = source;
            UpdateNavigationState(web, tab);
        };
        core.DocumentTitleChanged += (_, _) =>
        {
            if (!IsCurrentTabWebView(tab, web)) return;
            if (tab.Url != "browser://newtab") tab.Title = string.IsNullOrWhiteSpace(core.DocumentTitle) ? tab.Url : core.DocumentTitle;
            RefreshTabLists();
        };
        core.HistoryChanged += (_, _) =>
        {
            if (IsCurrentTabWebView(tab, web)) UpdateNavigationState(web, tab);
        };
        core.StatusBarTextChanged += (_, _) => DispatcherQueue.TryEnqueue(() =>
        {
            if (!IsCurrentTabWebView(tab, web) || _vm.SelectedTab?.Id != tab.Id) return;
            _status.Text = core.StatusBarText ?? string.Empty;
            _statusBubble.Visibility = string.IsNullOrWhiteSpace(core.StatusBarText) ? Visibility.Collapsed : Visibility.Visible;
        });
        core.IsDocumentPlayingAudioChanged += (_, _) =>
        {
            if (!IsCurrentTabWebView(tab, web)) return;
            tab.IsMediaPlaying = core.IsDocumentPlayingAudio;
            _media.Opacity = _vm.Tabs.Any(item => item.IsMediaPlaying) ? 1 : .72;
            RefreshTabLists();
        };
        core.NewWindowRequested += (_, e) =>
        {
            var popupUri = e.Uri;
            if (AuthenticationPopupPolicy.ShouldOpenInAuthenticationWindow(popupUri))
            {
                var deferral = e.GetDeferral();
                if (!DispatcherQueue.TryEnqueue(() => ObserveUiCallback("Authentication popup", async () =>
                {
                    try { if (!_isWindowClosed) await ((App)Application.Current).OpenAuthenticationPopupAsync(_isPrivate, popupUri, _profileName, e); }
                    finally { deferral.Complete(); }
                }))) deferral.Complete();
                return;
            }
            e.Handled = true;
            DispatcherQueue.TryEnqueue(() =>
            {
                try { if (IsCurrentTabWebView(tab, web)) NewTab(popupUri, !_vm.Settings.OpenLinksInBackground); }
                catch (Exception ex) { Debug.WriteLine($"New-tab popup failed: {ex.GetType().Name}"); }
            });
        };
        core.DownloadStarting += (_, e) =>
        {
            if (IsCurrentTabWebView(tab, web)) ObserveUiCallback("Download starting", () => OnDownloadStartingAsync(tab, e));
            else e.Cancel = true;
        };
        core.PermissionRequested += (_, e) =>
        {
            if (IsCurrentTabWebView(tab, web)) ObserveUiCallback("Permission request", () => OnPermissionRequestedAsync(tab, e));
            else { e.Handled = true; e.State = CoreWebView2PermissionState.Deny; }
        };
        core.ProcessFailed += (_, e) =>
        {
            // Closing an intentionally hibernated WebView can raise a process event.
            // It is not a crash and must not overwrite the sleeping placeholder.
            if (!IsCurrentTabWebView(tab, web) || tab.IsHibernated) return;
            tab.Error = $"WebView process failure: {e.ProcessFailedKind}";
            tab.IsLoading = false;
            try { ShowErrorPage(web, tab.Error); } catch { }
            ShowStatus("This tab stopped responding. Reload it to continue.", InfoBarSeverity.Error, 7000);
            RefreshTabLists();
        };
        core.ContainsFullScreenElementChanged += (_, _) => DispatcherQueue.TryEnqueue(() =>
        {
            if (!IsCurrentTabWebView(tab, web)) return;
            AppWindow.SetPresenter(core.ContainsFullScreenElement ? AppWindowPresenterKind.FullScreen : AppWindowPresenterKind.Default);
        });
        core.FaviconChanged += (_, _) =>
        {
            if (IsCurrentTabWebView(tab, web)) ObserveUiCallback("Favicon update", () => UpdateFaviconAsync(tab, core));
        };
        web.GotFocus += (_, _) =>
        {
            if (IsCurrentTabWebView(tab, web) && IsSplitViewActive && _splitTabIds.Contains(tab.Id) && _vm.SelectedTab?.Id != tab.Id)
                DispatcherQueue.TryEnqueue(() => ObserveUiCallback("Split-pane activation", async () => { if (IsCurrentTabWebView(tab, web)) await ActivateSplitPaneAsync(tab); }));
        };
        web.PointerPressed += (_, e) =>
        {
            var properties = e.GetCurrentPoint(web).Properties;
            if (properties.IsXButton1Pressed && core.CanGoBack) { core.GoBack(); e.Handled = true; }
            else if (properties.IsXButton2Pressed && core.CanGoForward) { core.GoForward(); e.Handled = true; }
        };
        _webViews[tab.Id] = web;
        tab.IsHibernated = false;
        tab.HibernationBaselineMemoryBytes = null;
        tab.HibernatedEstimatedMemoryBytes = null;
        if (tab.Url != "browser://newtab") core.Navigate(tab.Url);
        return web;
    }

    private async Task OnNavigationStartingAsync(BrowserTab tab, CoreWebView2NavigationStartingEventArgs e)
    {
        if (_isWindowClosed || !_vm.Tabs.Contains(tab)) return;
        _activeNavigationIds[tab.Id] = e.NavigationId;
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) { e.Cancel = true; return; }

        // WebView2 raises a new NavigationStarting event for each HTTP redirect.
        // Cancel it synchronously so the target is never loaded before the user
        // makes a choice. Navigating to an approved target starts a fresh,
        // user-approved navigation rather than resuming the redirect chain.
        if (e.IsRedirected && uri.Scheme is "http" or "https")
        {
            e.Cancel = true;
            tab.IsLoading = false;
            if (ReferenceEquals(tab, _vm.SelectedTab))
            {
                _progress.Visibility = Visibility.Collapsed;
                _reload.Content = new SymbolIcon(Symbol.Refresh);
            }
            RefreshTabLists();

            var source = string.IsNullOrWhiteSpace(tab.Url) ? "the current page" : tab.Url;
            var dialog = new ContentDialog
            {
                Title = "Allow redirect?",
                Content = $"{source}\n\nwants to redirect you to:\n{uri}\n\nContinue to this page?",
                PrimaryButtonText = "Yes, continue",
                CloseButtonText = "No, stay here",
                DefaultButton = ContentDialogButton.Close,
                XamlRoot = _root.XamlRoot
            };

            ContentDialogResult choice;
            try { choice = await dialog.ShowAsync(); }
            catch (Exception ex) { Debug.WriteLine($"Redirect prompt failed: {ex.GetType().Name}"); return; }
            if (choice == ContentDialogResult.Primary &&
                !_isWindowClosed &&
                _vm.Tabs.Contains(tab) &&
                _webViews.TryGetValue(tab.Id, out var web) &&
                web.CoreWebView2 is not null)
            {
                try { web.CoreWebView2.Navigate(uri.AbsoluteUri); } catch (Exception ex) { Debug.WriteLine($"Redirect navigation failed: {ex.GetType().Name}"); }
            }
            return;
        }

        if (uri.Scheme is not ("http" or "https" or "file" or "about" or "data"))
        {
            e.Cancel = true;
            var dialog = new ContentDialog
            {
                Title = "Open another application?",
                Content = $"{uri.Scheme} links leave {AppBrand.Name}.\n\n{uri}",
                PrimaryButtonText = "Open",
                CloseButtonText = "Cancel",
                XamlRoot = _root.XamlRoot
            };
            try { if (await dialog.ShowAsync() == ContentDialogResult.Primary) await Launcher.LaunchUriAsync(uri); }
            catch (Exception ex) { Debug.WriteLine($"External protocol prompt failed: {ex.GetType().Name}"); }
        }
        if (_isWindowClosed || !_vm.Tabs.Contains(tab)) return;
        tab.IsLoading = true;
        tab.Error = null;
        if (ReferenceEquals(tab, _vm.SelectedTab))
        {
            _progress.Visibility = Visibility.Visible;
            _reload.Content = new SymbolIcon(Symbol.Cancel);
            UpdateSecurity(uri);
        }
        RefreshTabLists();
    }

    private async Task OnNavigationCompletedAsync(BrowserTab tab, WebView2 web, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!IsCurrentTabWebView(tab, web)) return;
        // A new navigation can supersede the initial about:blank load. Ignore the
        // older completion so it cannot hide progress or replace the current page.
        if (_activeNavigationIds.TryGetValue(tab.Id, out var activeNavigationId) && activeNavigationId != e.NavigationId)
            return;

        tab.IsLoading = false;
        if (ReferenceEquals(tab, _vm.SelectedTab))
        {
            _progress.Visibility = Visibility.Collapsed;
            _reload.Content = new SymbolIcon(Symbol.Refresh);
        }
        if (!e.IsSuccess)
        {
            // Stop and superseded navigations are expected WebView2 control flow,
            // not network errors that should replace the page with an error view.
            if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled)
            {
                tab.Error = null;
                RefreshTabLists();
                UpdateNavigationState(web, tab);
                return;
            }

            // Some redirect/interstitial flows report Unknown after a usable
            // page is already visible. Preserve that document so the user can
            // interact with it (for example, complete a CAPTCHA).
            if (e.WebErrorStatus == CoreWebView2WebErrorStatus.Unknown &&
                web.Source is { Scheme: "http" or "https" })
            {
                tab.Error = null;
                RefreshTabLists();
                UpdateNavigationState(web, tab);
                return;
            }

            tab.Error = $"Navigation failed: {e.WebErrorStatus}";
            try { ShowErrorPage(web, tab.Error); } catch (Exception ex) { Debug.WriteLine($"Error page failed: {ex.GetType().Name}"); }
            ShowStatus(tab.Error, InfoBarSeverity.Error, 7000);
            RefreshTabLists();
            return;
        }
        var completedSource = web.Source?.AbsoluteUri ?? tab.Url;
        if (tab.Error is not null && (completedSource.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || completedSource == "about:blank"))
        {
            RefreshTabLists();
            UpdateNavigationState(web, tab);
            return;
        }
        var isInternalNewTab = tab.Url == "browser://newtab" &&
            (completedSource == "about:blank" || completedSource.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || completedSource.Equals(_newTabFileUri, StringComparison.OrdinalIgnoreCase));
        if (isInternalNewTab)
        {
            tab.Title = AppBrand.NewTabTitle;
            tab.Error = null;
            if (completedSource.Equals(_newTabFileUri, StringComparison.OrdinalIgnoreCase))
                web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { kind = "sutra-context", theme = _root.ActualTheme == ElementTheme.Light ? "light" : "dark", accent = _vm.Settings.AccentColor, profile = _profileName, privateWindow = _isPrivate }));
        }
        else
        {
            tab.Url = completedSource;
            try { tab.Title = string.IsNullOrWhiteSpace(web.CoreWebView2?.DocumentTitle) ? tab.Url : web.CoreWebView2.DocumentTitle; }
            catch { tab.Title = tab.Url; }
        }
        try { await ApplyStoredSiteZoomAsync(tab, web); } catch (Exception ex) { Debug.WriteLine($"Site zoom apply failed: {ex.GetType().Name}"); }
        try { await ApplyCosmeticFiltersAsync(tab, web); } catch (Exception ex) { Debug.WriteLine($"Cosmetic filters failed: {ex.GetType().Name}"); }
        // The window can close while those awaits are in flight; stop before any
        // further model mutation or UI refresh.
        if (!IsCurrentTabWebView(tab, web)) return;
        try
        {
            if (!_isPrivate && _vm.Settings.HistoryEnabled && Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
                await _history.RecordVisitAsync(tab.Url, tab.Title, _pendingTypedQuery);
        }
        catch (Exception ex) { Debug.WriteLine($"History record failed: {ex.GetType().Name}"); }
        if (!IsCurrentTabWebView(tab, web)) return;
        _pendingTypedQuery = null;
        RefreshTabLists();
        UpdateNavigationState(web, tab);
        if (Uri.TryCreate(tab.Url, UriKind.Absolute, out var previewUri) && previewUri.Scheme is "http" or "https") _ = UpdateTabThumbnailAsync(tab, web);
        _ = RefreshTabMemoryUsageAsync();
        if (_vm.Settings.SuggestTabGroupsByDomain) _ = SuggestDomainGroupsAsync();
        _ = OfferTranslationAsync(tab, web);
        if (tab.ScrollPosition > 0)
        {
            var y = tab.ScrollPosition;
            tab.ScrollPosition = 0;
            if (!IsCurrentTabWebView(tab, web)) return;
            try { await web.ExecuteScriptAsync($"window.scrollTo(0,{y.ToString(System.Globalization.CultureInfo.InvariantCulture)})"); }
            catch (Exception ex) { Debug.WriteLine($"Scroll restore failed: {ex.GetType().Name}"); }
        }
    }

    private const string ShortcutBridgeScript = """
        (()=>{
          if(window.__sutraShortcutBridge)return;window.__sutraShortcutBridge=true;
          document.addEventListener('input',e=>{if(e.target&&e.target.matches('input:not([type=hidden]),textarea,select'))window.chrome.webview.postMessage({kind:'dirty-form'});},{once:true,capture:true});
          document.addEventListener('submit',e=>{
            const form=e.target;if(!(form instanceof HTMLFormElement))return;
            const password=form.querySelector('input[type=password]');if(!password||!password.value)return;
            const username=form.querySelector('input[autocomplete=username],input[type=email],input[type=text]');
            window.chrome.webview.postMessage({kind:'credential-submitted',username:username?.value||'',password:password.value});
          },true);
          // Register on window during document creation so this runs before page
          // handlers (some sites surface their own "Ctrl+L" hint overlays).
          window.addEventListener('keydown',e=>{
            let shortcut=null;const key=e.key.toLowerCase();
            if(e.ctrlKey&&key==='tab')shortcut=e.shiftKey?'previous-tab':'next-tab';
            else if(e.ctrlKey&&!e.shiftKey&&key==='l')shortcut='focus-address';
            else if(e.ctrlKey&&!e.shiftKey&&key==='t')shortcut='new-tab';
            else if(e.ctrlKey&&!e.shiftKey&&key==='n')shortcut='new-window';
            else if(e.ctrlKey&&e.shiftKey&&key==='n')shortcut='private-window';
            else if(e.ctrlKey&&!e.shiftKey&&key==='w')shortcut='close-tab';
            else if(e.ctrlKey&&e.shiftKey&&key==='t')shortcut='reopen-tab';
            else if(e.ctrlKey&&e.shiftKey&&key==='a')shortcut='search-tabs';
            else if(e.ctrlKey&&!e.shiftKey&&key==='f')shortcut='find';
            else if(e.ctrlKey&&!e.shiftKey&&key==='d')shortcut='bookmark';
            else if(e.ctrlKey&&!e.shiftKey&&key==='h')shortcut='history';
            else if(e.ctrlKey&&!e.shiftKey&&key==='j')shortcut='downloads';
            else if(e.ctrlKey&&e.altKey&&key==='z')shortcut='sutra-save';
            else if((e.ctrlKey&&!e.shiftKey&&key==='r')||key==='f5')shortcut='reload';
            else if(e.altKey&&!e.ctrlKey&&key==='arrowleft')shortcut='back';
            else if(e.altKey&&!e.ctrlKey&&key==='arrowright')shortcut='forward';
            else if(e.ctrlKey&&(key==='+'||key==='='))shortcut='zoom-in';
            else if(e.ctrlKey&&key==='-')shortcut='zoom-out';
            else if(e.ctrlKey&&key==='0')shortcut='zoom-reset';
            else if(key==='f11')shortcut='fullscreen';
            if(shortcut){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();window.chrome.webview.postMessage({kind:'browser-shortcut',shortcut});}
          },true);
        })();
        """;

    private async Task OnWebMessageReceivedAsync(BrowserTab tab, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            if (_isWindowClosed || !_vm.Tabs.Contains(tab)) return;
            using var json = JsonDocument.Parse(e.WebMessageAsJson);
            if (!json.RootElement.TryGetProperty("kind", out var kind)) return;
            if (kind.GetString() == "dirty-form") { tab.MayHaveUnsavedFormInput = true; return; }
            if (kind.GetString() == "credential-submitted") { tab.MayHaveUnsavedFormInput = false; await HandleCredentialSubmittedAsync(tab, e.Source, json.RootElement); return; }
            var trustedNewTab = BrowserOwnedMessagePolicy.IsTrustedNewTab(tab.Url, e.Source,
                _webViews.TryGetValue(tab.Id, out var sourceView) ? sourceView.CoreWebView2?.Source : null,
                _newTabFileUri, tab.Id == _vm.SelectedTab?.Id);
            if (kind.GetString() is "new-tab-search" or "open-url" or "open-customization" or "open-bookmarks" or "new-tab-action")
            {
                if (!trustedNewTab) return;
                if (kind.GetString() == "new-tab-search" && json.RootElement.TryGetProperty("query", out var query) && query.ValueKind == JsonValueKind.String && query.GetString() is { Length: > 0 and <= 2048 } input) { Navigate(input); return; }
                if (kind.GetString() == "open-url" && json.RootElement.TryGetProperty("url", out var url) && url.ValueKind == JsonValueKind.String && url.GetString() is { Length: > 0 and <= 2048 } target) { Navigate(target); return; }
                if (kind.GetString() == "open-customization") { await ShowCustomizationAsync(); return; }
                if (kind.GetString() == "open-bookmarks") { await ShowBookmarksAsync(); return; }
                if (kind.GetString() == "new-tab-action" && json.RootElement.TryGetProperty("action", out var action) && action.ValueKind == JsonValueKind.String)
                {
                    switch (action.GetString())
                    {
                        case "library": await ShowLibrarySearchAsync(); break;
                        case "bookmarks": await ShowBookmarksAsync(); break;
                        case "history": await ShowHistoryAsync(); break;
                        case "reading": await ShowReadingListAsync(); break;
                        case "offline": await ShowOfflineLibraryAsync(); break;
                        case "notes": await ShowNotesManagerAsync(); break;
                        case "workspaces": await ShowWorkspacesAsync(); break;
                        case "downloads": await ShowDownloadsAsync(); break;
                        case "settings": await ShowSettingsAsync(); break;
                        case "commands": await ShowCommandPaletteAsync(); break;
                    }
                }
                return;
            }
            if (kind.GetString() == "retry-tab") { await RecoverTabAsync(tab); return; }
            if (kind.GetString() == "error-go-back") { if (_webViews.TryGetValue(tab.Id, out var failed) && failed.CoreWebView2 is not null && failed.CoreWebView2.CanGoBack) failed.CoreWebView2.GoBack(); else Navigate(_vm.Settings.HomePage); return; }
            if (kind.GetString() == "browser-shortcut" && json.RootElement.TryGetProperty("shortcut", out var shortcut)) HandleBrowserShortcut(shortcut.GetString());
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Debug.WriteLine($"Web message handling failed: {ex.GetType().Name}"); }
    }

    private void HandleBrowserShortcut(string? shortcut)
    {
        switch (shortcut)
        {
            case "next-tab": CycleTabWithPreview(1); break;
            case "previous-tab": CycleTabWithPreview(-1); break;
            case "focus-address": _address.Focus(FocusState.Keyboard); break;
            case "new-tab": NewTab(activate: true); break;
            case "new-window": OpenNewWindow(); break;
            case "private-window": OpenPrivateWindow(); break;
            case "close-tab": CloseTab(_vm.SelectedTab); break;
            case "reopen-tab": ReopenClosed(); break;
            case "search-tabs": _ = SearchTabsAsync(); break;
            case "find": _ = FindInPageAsync(); break;
            case "bookmark": _ = BookmarkCurrentAsync(); break;
            case "history": _ = ShowHistoryAsync(); break;
            case "downloads": _ = ShowDownloadsAsync(); break;
            case "sutra-save": _ = SutraSaveAsync(); break;
            case "reload": ReloadOrStop(); break;
            case "back": SafeGoBack(); break;
            case "forward": SafeGoForward(); break;
            case "zoom-in": Zoom(.1); break;
            case "zoom-out": Zoom(-.1); break;
            case "zoom-reset": SetZoom(1); break;
            case "fullscreen": ToggleFullScreen(); break;
        }
    }

    private async void Navigate(string input)
    {
        try
        {
            var target = AddressResolver.Resolve(input, _vm.Settings.SearchEngine, _vm.Settings.SearchAliases);
            _pendingTypedQuery = _isPrivate ? null : target.SearchQuery;
            var tab = _vm.SelectedTab ?? NewTab(activate: false);
            if (IsNativePageTab(tab))
            {
                var destination = NewTab(target.Uri.Scheme == "browser" ? "browser://newtab" : target.Uri.AbsoluteUri, activate: false);
                CloseTab(tab);
                await ActivateTabAsync(destination);
                return;
            }
            if (target.Uri.Scheme == "browser")
            {
                tab.Url = "browser://newtab";
                tab.Title = AppBrand.NewTabTitle;
                tab.Error = null;
                if (_webViews.TryGetValue(tab.Id, out var newTabWeb)) await ShowNewTabPageAsync(newTabWeb);
                _address.Text = string.Empty;
                RefreshTabLists();
                return;
            }
            if (!_webViews.TryGetValue(tab.Id, out var web) || web.CoreWebView2 is null) { tab.Url = target.Uri.AbsoluteUri; await ActivateTabAsync(tab); }
            else web.CoreWebView2.Navigate(target.Uri.AbsoluteUri);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Debug.WriteLine($"Navigate failed: {ex.GetType().Name}"); }
    }

    private void AddressTextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs e)
    {
        if (e.Reason != AutoSuggestionBoxTextChangeReason.UserInput || sender.Text.Length < 2) { sender.ItemsSource = null; return; }
        _ = LoadSuggestionsAsync(sender, sender.Text);
    }

    private async Task LoadSuggestionsAsync(AutoSuggestBox box, string query)
    {
        IReadOnlyList<HistoryEntry> history = _isPrivate ? [] : await _history.SearchAsync(query, limit: 6);
        var bookmarks = await _bookmarks.SearchAsync(query);
        var suggestions = bookmarks.Take(4).Select(x => x.Url).Concat(history.Select(x => x.Url)).Distinct().Take(8).ToList();
        if (box.Text == query) box.ItemsSource = suggestions;
    }

    private void UpdateNavigationState(WebView2 web, BrowserTab tab)
    {
        if (!ReferenceEquals(tab, _vm.SelectedTab)) return;
        _back.IsEnabled = web.CoreWebView2?.CanGoBack == true;
        _forward.IsEnabled = web.CoreWebView2?.CanGoForward == true;
        _address.Text = tab.Url == "browser://newtab" ? string.Empty : tab.Url;
        UpdateSecurity(Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) ? uri : null);
        UpdateShieldState(tab);
        _ = UpdateBookmarkButtonAsync(tab);
    }

    private void UpdateSecurity(Uri? uri)
    {
        _security.Text = uri?.Scheme == "https" ? "\uE72E" : uri?.Scheme == "http" ? "\uE7BA" : "\uE774";
        ToolTipService.SetToolTip(_security, uri?.Scheme == "https" ? "Secure HTTPS connection" : uri?.Scheme == "http" ? "Not secure" : "Local page");
    }

    private WebView2? CurrentWebView() => _vm.SelectedTab is not null && _webViews.TryGetValue(_vm.SelectedTab.Id, out var web) ? web : null;
    private void ReloadOrStop() { var web = CurrentWebView(); if (web?.CoreWebView2 is null) return; if (_vm.SelectedTab?.IsLoading == true) web.CoreWebView2.Stop(); else web.CoreWebView2.Reload(); }
    private void SafeGoBack() { try { var web = CurrentWebView(); if (web?.CoreWebView2 is { } core && core.CanGoBack) web.GoBack(); } catch { } }
    private void SafeGoForward() { try { var web = CurrentWebView(); if (web?.CoreWebView2 is { } core && core.CanGoForward) web.GoForward(); } catch { } }
    private void Zoom(double delta) { if (_vm.SelectedTab is null) return; SetZoom(_zoomFactors.GetValueOrDefault(_vm.SelectedTab.Id, 1) + delta); }
    private async void SetZoom(double value)
    {
        if (_vm.SelectedTab is null || CurrentWebView() is not { } web || web.CoreWebView2 is null) return;
        try
        {
            value = Math.Clamp(value, .25, 5);
            _zoomFactors[_vm.SelectedTab.Id] = value;
            if (SiteZoomKey(_vm.SelectedTab.Url) is { } key)
            {
                var factors = new Dictionary<string, double>(_vm.Settings.SiteZoomFactors, StringComparer.OrdinalIgnoreCase) { [key] = value };
                _vm.Settings = _vm.Settings with { SiteZoomFactors = factors };
                if (!_isPrivate) await SaveSettingsSafeAsync();
            }
            await web.ExecuteScriptAsync($"document.documentElement.style.zoom='{value.ToString(System.Globalization.CultureInfo.InvariantCulture)}'");
            ShowStatus($"Zoom {value:P0}");
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Debug.WriteLine($"SetZoom failed: {ex.GetType().Name}"); }
    }

    private async Task ApplyStoredSiteZoomAsync(BrowserTab tab, WebView2 web)
    {
        var key = SiteZoomKey(tab.Url);
        if (key is null || !_vm.Settings.SiteZoomFactors.TryGetValue(key, out var value)) return;
        _zoomFactors[tab.Id] = value;
        await web.ExecuteScriptAsync($"document.documentElement.style.zoom='{value.ToString(System.Globalization.CultureInfo.InvariantCulture)}'");
    }

    private static string? SiteZoomKey(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || string.IsNullOrWhiteSpace(uri.Host)) return null;
        return $"{uri.Scheme}://{uri.Host}{(uri.IsDefaultPort ? string.Empty : ":" + uri.Port)}";
    }
    private void CycleTab(int amount) { if (_vm.Tabs.Count < 2) return; var i = Math.Max(0, _vm.SelectedTab is null ? 0 : _vm.Tabs.IndexOf(_vm.SelectedTab)); i = (i + amount + _vm.Tabs.Count) % _vm.Tabs.Count; _ = ActivateTabAsync(_vm.Tabs[i]); }

    private async void CloseTab(BrowserTab? tab)
    {
        if (tab is null) return;
        try
        {
            if (_vm.Settings.ConfirmClosingProtectedTabs && IsProtectedTab(tab))
            {
                var reasons = new List<string>();
                if (tab.IsPinned) reasons.Add("it is pinned");
                if (tab.MayHaveUnsavedFormInput) reasons.Add("it may contain unsaved form input");
                if (tab.HasActiveDownload) reasons.Add("it has an active download");
                if (tab.IsMediaPlaying) reasons.Add("it is playing media");
                var dialog = new ContentDialog
                {
                    Title = "Close protected tab?",
                    Content = $"{tab.Title} is protected because {string.Join(" and ", reasons)}.",
                    PrimaryButtonText = "Close tab",
                    CloseButtonText = "Keep open",
                    DefaultButton = ContentDialogButton.Close,
                    XamlRoot = _root.XamlRoot
                };
                if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Close confirmation failed: {ex.GetType().Name}");
            return;
        }
        var wasNativePage = _nativePageTabs.Remove(tab.Id);
        if (wasNativePage)
        {
            // Retire this exact page instance's lifecycle callback (feature code
            // validates its own identity inside) before the visual disappears.
            if (_nativePageClosedHandlers.Remove(tab.Id, out var pageClosed)) { try { pageClosed(); } catch { } }
            try { HideNativePageVisual(); } catch { }
        }
        try { CloseMiniPlayersForTab(tab.Id); } catch { }
        _activeNavigationIds.Remove(tab.Id);
        _readerTabs.Remove(tab.Id);
        _translationOfferedTabs.Remove(tab.Id);
        _splitTabIds.Remove(tab.Id);
        if (_splitTabIds.Count < 2) { _splitTabIds.Clear(); _splitColumnFractions = null; _splitRowFractions = null; }
        if (_webViews.Remove(tab.Id, out var web)) { try { DetachWebView(web); web.Close(); } catch (Exception ex) { Debug.WriteLine($"WebView close failed: {ex.GetType().Name}"); } }
        // Tree children are orphaned, never cascade-closed: closing a parent must not destroy research.
        foreach (var child in _vm.Tabs.Where(x => x.ParentId == tab.Id).ToList()) child.ParentId = null;
        var isTemporary = tab.IsTemporary;
        var next = wasNativePage ? _vm.RemoveTransient(tab) : isTemporary ? _vm.RemoveWithoutHistory(tab) : _vm.Close(tab);
        if (!wasNativePage && !isTemporary) ShowUndoStatus($"Closed {tab.Title}", () => { ReopenClosed(); return Task.CompletedTask; });
        if (_vm.Tabs.Count == 0) next = NewTab(activate: false);
        RefreshTabLists();
        if (next is not null) _ = ActivateTabAsync(next);
    }

    private async Task HibernateTabAsync(BrowserTab tab, bool quiet = false, CancellationToken lifetimeToken = default)
    {
        if (_isWindowClosed) return;
        if (_splitTabIds.Contains(tab.Id)) { ShowStatus("Remove this tab from split screen before hibernating it."); return; }
        if (HasMiniPlayerForTab(tab.Id)) { ShowStatus("Close this tab's mini-player before hibernating it."); return; }
        if (tab.HasActiveDownload || tab.IsMediaPlaying || tab.IsInActiveCall || tab.HasPermissionPrompt || tab.MayHaveUnsavedFormInput)
        {
            if (!quiet) ShowStatus("This tab is being kept awake because it has active media, a download, a permission prompt, or unsaved input.");
            return;
        }
        if (tab == _vm.SelectedTab)
        {
            // Manual hibernation moves focus away first, so the user does not need
            // to discover an active-tab restriction before putting it to sleep.
            var destination = _vm.Tabs.FirstOrDefault(candidate => candidate.Id != tab.Id && !candidate.IsHibernated)
                ?? NewTab(activate: false);
            if (destination.Id == tab.Id) { ShowStatus("Open another tab before hibernating this one."); return; }
            await ActivateTabAsync(destination);
        }
        if (tab.IsHibernated) return;
        if (!_webViews.TryGetValue(tab.Id, out var web))
        {
            // A restored or newly-created tab can temporarily have no attached control.
            // Treat it as sleeping instead of leaving a misleading ready-state placeholder.
            MarkTabSleeping(tab);
            RefreshTabLists();
            await SaveSessionAsync();
            if (!quiet) ShowStatus($"{tab.Title} is sleeping");
            return;
        }
        try
        {
            var json = await web.ExecuteScriptAsync("window.scrollY");
            if (double.TryParse(json, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var y)) tab.ScrollPosition = y;
        }
        catch (Exception ex) { Debug.WriteLine($"Scroll capture before hibernation failed: {ex.GetType().Name}"); }
        // The window may have closed (or lifetime work been cancelled) while the
        // script result was in flight; never continue against released controls.
        if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
        if (!_vm.Tabs.Contains(tab) || tab == _vm.SelectedTab || ManualHibernateBlocked(tab) || tab.IsLoading ||
            !_webViews.TryGetValue(tab.Id, out var currentView) || !ReferenceEquals(web, currentView)) return;
        if (quiet && (IsProtectedTab(tab) || IsInNeverHibernateGroup(tab))) return;
        // Set the state before closing WebView2: Close can synchronously produce a
        // process-lifecycle callback, and the UI must never briefly show a closed tab as ready.
        MarkTabSleeping(tab);
        _activeNavigationIds.Remove(tab.Id);
        _webViews.Remove(tab.Id);
        DetachWebView(web);
        try { web.Close(); }
        catch (Exception ex) { Debug.WriteLine($"WebView close during hibernation: {ex.GetType().Name}"); }
        RefreshTabLists();
        await SaveSessionAsync();
        if (!quiet) ShowStatus($"{tab.Title} is sleeping");
    }

    private static void MarkTabSleeping(BrowserTab tab)
    {
        tab.HibernationBaselineMemoryBytes = tab.RendererMemoryBytes;
        tab.HibernatedEstimatedMemoryBytes = tab.RendererMemoryBytes is { } measured
            ? Math.Max(1L * 1024 * 1024, Math.Min(4L * 1024 * 1024, measured / 100))
            : null;
        tab.IsHibernated = true;
        tab.IsLoading = false;
        tab.IsMediaPlaying = false;
        tab.RendererMemoryBytes = null;
        tab.RendererMemoryIsShared = false;
        tab.RendererMemorySharingTabCount = 0;
        tab.RendererMemoryMeasuredAt = null;
    }

    private async Task HibernateInactiveTabsAsync(bool quiet = false, CancellationToken lifetimeToken = default)
    {
        if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
        var snapshot = Browser.Platform.Windows.Storage.SystemResourceSnapshotProvider.Capture();
        var minutes = Browser.Core.Diagnostics.AdaptiveMemoryPolicy.EffectiveInactivityMinutes(_vm.Settings.HibernationMinutes, snapshot);
        var settings = new HibernationSettings(_vm.Settings.AutomaticHibernationEnabled, minutes, _vm.Settings.NeverHibernatePinnedTabs, new HashSet<string>(_vm.Settings.HibernationExclusions, StringComparer.OrdinalIgnoreCase));
        foreach (var tab in _vm.Tabs.ToList())
        {
            if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
            if (!_splitTabIds.Contains(tab.Id) && !IsInNeverHibernateGroup(tab) && HibernationPolicy.CanHibernate(tab, _vm.SelectedTab, settings, DateTimeOffset.UtcNow))
                await HibernateTabAsync(tab, quiet, lifetimeToken);
        }
        await EnforceMemoryBudgetAsync(quiet, lifetimeToken);
    }

    private async Task EnforceMemoryBudgetAsync(bool quiet = false, CancellationToken lifetimeToken = default)
    {
        if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
        var live = _vm.Tabs.Where(tab => _webViews.ContainsKey(tab.Id) && tab.Id != _vm.SelectedTab?.Id && !_splitTabIds.Contains(tab.Id) && !IsProtectedTab(tab) && !IsInNeverHibernateGroup(tab)).ToList();
        var snapshot = Browser.Platform.Windows.Storage.SystemResourceSnapshotProvider.Capture();
        var permitted = Browser.Core.Diagnostics.AdaptiveMemoryPolicy.EffectiveTabLimit(_vm.Settings.MemorySaverTabLimit, snapshot);
        if (_vm.Settings.MemorySaverMode == MemorySaverMode.Balanced && live.Count <= permitted) return;
        if (_vm.Settings.MemorySaverMode == MemorySaverMode.Aggressive) permitted = Math.Max(3, permitted / 2);
        if (_vm.Settings.MemorySaverMode == MemorySaverMode.Maximum) permitted = 1;
        permitted = Browser.Core.Diagnostics.AdaptiveMemoryPolicy.EffectiveTabLimit(permitted, snapshot);
        foreach (var tab in live.OrderByDescending(tab => tab.RendererMemoryBytes ?? 0).ThenBy(tab => tab.LastActivatedAt).Skip(Math.Max(0, permitted - 1)).ToList())
        {
            if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
            await HibernateTabAsync(tab, quiet, lifetimeToken);
        }
    }

    private void MigrateLegacyTabGroups()
    {
        foreach (var tab in _vm.Tabs.Where(x => x.GroupId is null && !string.IsNullOrWhiteSpace(x.GroupName)))
        {
            var group = _tabGroups.Values.FirstOrDefault(x => x.Name.Equals(tab.GroupName, StringComparison.OrdinalIgnoreCase));
            if (group is null)
            {
                group = new TabGroup { Name = TabGroup.NormalizeName(tab.GroupName), Color = DefaultGroupColor(_tabGroups.Count), SortOrder = _tabGroups.Count };
                _tabGroups[group.Id] = group;
            }
            tab.GroupId = group.Id;
            tab.GroupName = group.Name;
        }
    }

    private bool IsInNeverHibernateGroup(BrowserTab tab) => tab.GroupId is { } id && _tabGroups.TryGetValue(id, out var group) && group.NeverHibernate;

    private void RefreshTabLists()
    {
        if (_refreshingTabs) return;
        _refreshingTabs = true;
        try
        {
            var liveIds = _vm.Tabs.Select(x => x.Id).ToHashSet();
            _workspaceIdentity.Text = _vm.SelectedTab?.WorkspaceName ?? "";
            _workspaceIdentity.Visibility = string.IsNullOrWhiteSpace(_workspaceIdentity.Text) ? Visibility.Collapsed : Visibility.Visible;
            ToolTipService.SetToolTip(_workspaceIdentity, $"Workspace: {_workspaceIdentity.Text}");
            foreach (var id in _horizontalTabItems.Keys.Where(x => !liveIds.Contains(x)).ToList()) _horizontalTabItems.Remove(id);
            foreach (var tab in _vm.Tabs)
            {
                if (!_horizontalTabItems.TryGetValue(tab.Id, out var item))
                {
                    item = new TabViewItem { Tag = tab };
                    item.PointerPressed += (_, e) => { if (e.GetCurrentPoint(item).Properties.IsMiddleButtonPressed) { e.Handled = true; CloseTab(tab); } };
                    item.PointerEntered += (_, _) => _ = RefreshTabMemoryUsageAsync();
                    _horizontalTabItems[tab.Id] = item;
                }
                item.ContextFlyout = BuildTabMenu(tab);
                item.Header = BuildHorizontalTabHeader(tab);
                item.IsClosable = !tab.IsPinned;
                item.IconSource = tab.Url == "browser://newtab" ? null : TabIconSource(tab);
                item.Padding = new(10, 0, 8, 0);
                item.Margin = new(2, 4, 2, 4);
                item.Background = tab.Id == _vm.SelectedTab?.Id
                    ? new SolidColorBrush(Windows.UI.Color.FromArgb(255, 21, 25, 29))
                    : new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0));
                item.BorderBrush = tab.Id == _vm.SelectedTab?.Id
                    ? ChromeBrush("SutraBorderBrush")
                    : new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0));
                item.BorderThickness = new(1);
                item.MinWidth = tab.IsPinned ? 44 : 132;
                item.MaxWidth = tab.IsPinned ? 44 : 240;
                item.Width = tab.IsPinned ? 44 : double.NaN;
                ToolTipService.SetToolTip(item, BuildTabPreview(tab));

            }
            var modelOrder = _vm.Tabs.Select(x => x.Id).ToList();
            var horizontalOrder = _horizontalTabs.TabItems.OfType<TabViewItem>().Select(x => ((BrowserTab)x.Tag).Id);
            if (!horizontalOrder.SequenceEqual(modelOrder)) { _horizontalTabs.TabItems.Clear(); foreach (var tab in _vm.Tabs) _horizontalTabs.TabItems.Add(_horizontalTabItems[tab.Id]); }
            if (_vm.SelectedTab is not null && _horizontalTabItems.TryGetValue(_vm.SelectedTab.Id, out var selectedItem)) _horizontalTabs.SelectedItem = selectedItem;
            RefreshVerticalSidebar();
            RefreshTabGroupBar();
            RefreshSplitPaneChrome();
        }
        finally { _refreshingTabs = false; }
    }

    private static string TabHeader(BrowserTab tab) => tab.Title;
    private static string TabToolTip(BrowserTab tab) => $"{tab.Title}\n{tab.Url}{(tab.IsHibernated ? "\nSleeping" : tab.IsMuted ? "\nMuted" : tab.IsMediaPlaying ? "\nPlaying audio" : string.Empty)}{(tab.IsTemporary ? "\nTemporary — closes with this window" : string.Empty)}{(tab.ParentId is not null ? "\nChild tab" : string.Empty)}";

    private FrameworkElement BuildTabPreview(BrowserTab tab)
    {
        var panel = new StackPanel { Width = 300, Spacing = 7, Padding = new(3) };
        if (!string.IsNullOrWhiteSpace(tab.ThumbnailPath) && File.Exists(tab.ThumbnailPath))
            panel.Children.Add(new Border { Height = 150, CornerRadius = new(7), Child = new Image { Source = new BitmapImage(new Uri(tab.ThumbnailPath)), Stretch = Microsoft.UI.Xaml.Media.Stretch.UniformToFill } });
        var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (!string.IsNullOrWhiteSpace(tab.FaviconPath) && File.Exists(tab.FaviconPath))
            heading.Children.Add(new Image { Source = new BitmapImage(new Uri(tab.FaviconPath)), Width = 18, Height = 18 });
        heading.Children.Add(new TextBlock { Text = tab.Title, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 265 });
        panel.Children.Add(heading);
        panel.Children.Add(new TextBlock { Text = tab.Url, FontSize = 11, Opacity = .65, TextWrapping = TextWrapping.Wrap, MaxHeight = 44 });
        var state = tab.IsHibernated ? "Sleeping" : tab.IsLoading ? "Loading" : tab.HasActiveDownload ? "Downloading" : tab.IsMuted ? "Muted" : tab.IsMediaPlaying ? "Playing media" : "Ready";
        if (tab.IsTemporary) state += " · Temporary";
        if (tab.ParentId is not null) state += " · Child tab";
        panel.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(tab.GroupName) ? state : $"{tab.GroupName}  ·  {state}", FontSize = 11, Opacity = .72 });
        panel.Children.Add(new TextBlock { Text = TabMemorySummary(tab), FontSize = 11, Opacity = .72 });
        return panel;
    }

    private static string TabMemorySummary(BrowserTab tab)
    {
        if (tab.IsHibernated)
        {
            if (tab.HibernationBaselineMemoryBytes is { } before && tab.HibernatedEstimatedMemoryBytes is { } estimate)
            {
                var reduction = Math.Clamp(1d - estimate / (double)Math.Max(1, before), 0, 1);
                return $"Estimated RAM now: {estimate / 1024d / 1024d:N1} MB (was {before / 1024d / 1024d:N0} MB; {reduction:P0} reduction)";
            }
            return "Renderer stopped while sleeping (no prior RAM sample)";
        }
        if (tab.RendererMemoryBytes is not { } bytes) return "Renderer RAM: measuring…";

        var megabytes = bytes / 1024d / 1024d;
        return tab.RendererMemoryIsShared
            ? $"Renderer RAM: {megabytes:N0} MB (shared by {tab.RendererMemorySharingTabCount} tabs)"
            : $"Renderer RAM: {megabytes:N0} MB";
    }

    /// <summary>
    /// Maps each live main frame to its WebView2 renderer process. A renderer may host
    /// more than one tab, so shared working sets are explicitly marked rather than divided.
    /// </summary>
    private async Task RefreshTabMemoryUsageAsync(CancellationToken lifetimeToken = default)
    {
        if (_tabMemoryRefreshInFlight || DateTimeOffset.UtcNow - _lastTabMemoryRefreshAt < TimeSpan.FromSeconds(10)) return;
        _tabMemoryRefreshInFlight = true;
        try
        {
            var liveTabs = _webViews
                .Where(pair => pair.Value.CoreWebView2 is not null)
                .Select(pair => (Tab: _vm.Tabs.FirstOrDefault(tab => tab.Id == pair.Key), Core: pair.Value.CoreWebView2))
                .Where(item => item.Tab is not null && item.Core.FrameId != 0)
                .Select(item => (Tab: item.Tab!, FrameId: item.Core.FrameId))
                .ToList();

            foreach (var (tab, _) in liveTabs)
            {
                tab.RendererMemoryBytes = null;
                tab.RendererMemoryIsShared = false;
                tab.RendererMemorySharingTabCount = 0;
                tab.RendererMemoryMeasuredAt = null;
            }
            if (liveTabs.Count == 0) return;

            var environment = await _environment.GetAsync();
            var processes = await environment.GetProcessExtendedInfosAsync();
            // The window may have closed while the process snapshot was in flight.
            if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
            foreach (var process in processes)
            {
                if (process.ProcessInfo.Kind != CoreWebView2ProcessKind.Renderer) continue;

                var frameIds = process.AssociatedFrameInfos
                    .Where(frame => frame.FrameKind == CoreWebView2FrameKind.MainFrame)
                    .Select(frame => frame.FrameId)
                    .ToHashSet();
                var matchingTabs = liveTabs.Where(item => frameIds.Contains(item.FrameId)).Select(item => item.Tab).Distinct().ToList();
                if (matchingTabs.Count == 0) continue;

                long workingSet;
                try
                {
                    using var renderer = Process.GetProcessById((int)process.ProcessInfo.ProcessId);
                    renderer.Refresh();
                    workingSet = renderer.WorkingSet64;
                }
                catch (ArgumentException)
                {
                    continue; // The renderer was replaced between the WebView2 snapshot and this read.
                }

                if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;

                foreach (var tab in matchingTabs)
                {
                    tab.RendererMemoryBytes = workingSet;
                    tab.RendererMemoryIsShared = matchingTabs.Count > 1;
                    tab.RendererMemorySharingTabCount = matchingTabs.Count;
                    tab.RendererMemoryMeasuredAt = DateTimeOffset.UtcNow;
                }
            }

            _lastTabMemoryRefreshAt = DateTimeOffset.UtcNow;
            if (_isWindowClosed || lifetimeToken.IsCancellationRequested) return;
            RefreshTabLists();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Tab memory snapshot unavailable: {ex.GetType().Name}");
        }
        finally
        {
            _tabMemoryRefreshInFlight = false;
        }
    }

    private FrameworkElement BuildHorizontalTabHeader(BrowserTab tab)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center, Opacity = tab.IsTemporary ? 0.82 : 1 };
        if (!tab.IsPinned && tab.Url == "browser://newtab")
            panel.Children.Add(new TextBlock { Text = "◆", Foreground = ChromeBrush("SutraAccentBrush"), FontSize = 11, VerticalAlignment = VerticalAlignment.Center });
        if (!tab.IsPinned && tab.ParentId is not null)
            panel.Children.Add(new TextBlock { Text = "↳", FontSize = 11, Opacity = 0.7, VerticalAlignment = VerticalAlignment.Center });
        if (!tab.IsPinned) panel.Children.Add(new TextBlock { Text = tab.Title + (tab.IsTemporary ? " · Temp" : string.Empty), TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 170, VerticalAlignment = VerticalAlignment.Center });
        if (!tab.IsPinned && !string.IsNullOrWhiteSpace(tab.GroupName))
            panel.Children.Insert(0, new Border { Padding = new(5, 1, 5, 1), CornerRadius = new(6), Background = ResourceBrush("AccentFillColorSecondaryBrush"), Child = new TextBlock { Text = tab.GroupName, FontSize = 10, MaxWidth = 72, TextTrimming = TextTrimming.CharacterEllipsis } });
        if (tab.IsLoading) panel.Children.Add(new ProgressRing { IsActive = true, Width = 12, Height = 12 });
        else if (tab.HasActiveDownload) panel.Children.Add(TabSymbol(Symbol.Download, 14));
        else if (tab.IsHibernated) panel.Children.Add(TabSymbol(Symbol.Clock, 14));
        else if (tab.IsMuted) panel.Children.Add(TabSymbol(Symbol.Mute, 14));
        else if (tab.IsMediaPlaying) panel.Children.Add(TabSymbol(Symbol.Volume, 14));
        return panel;
    }

    private FrameworkElement BuildVerticalTabRow(BrowserTab tab)
    {
        var row = new Grid { Height = 36, ColumnSpacing = 10, Padding = new(6, 0, 4, 0) };
        row.ColumnDefinitions.Add(new() { Width = new(20) }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        FrameworkElement icon = !string.IsNullOrWhiteSpace(tab.FaviconPath) && File.Exists(tab.FaviconPath)
            ? new Image { Source = new BitmapImage(new Uri(tab.FaviconPath)), Width = 16, Height = 16 }
            : TabSymbol(tab.IsHibernated ? Symbol.Clock : Symbol.World, 18);
        icon.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(icon);
        var text = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new TextBlock { Text = string.IsNullOrWhiteSpace(tab.GroupName) ? tab.Title : $"{tab.GroupName}  ·  {tab.Title}", TextTrimming = TextTrimming.CharacterEllipsis, FontSize = 13 });
        Grid.SetColumn(text, 1); row.Children.Add(text);
        if (tab.IsLoading || tab.IsHibernated || tab.IsMediaPlaying || tab.IsMuted || tab.HasActiveDownload)
        {
            var symbol = tab.IsLoading ? Symbol.Sync : tab.IsHibernated ? Symbol.Clock : tab.HasActiveDownload ? Symbol.Download : tab.IsMuted ? Symbol.Mute : Symbol.Volume;
            var state = TabSymbol(symbol, 14);
            state.Opacity = .75;
            Grid.SetColumn(state, 2); row.Children.Add(state);
        }
        return row;
    }

    private void RefreshVerticalSidebar()
    {
        _verticalGroupHost.Children.Clear();
        var collapsed = !SidebarExpanded;
        _verticalHeading.Text = collapsed ? string.Empty : $"Tabs · {_vm.Tabs.Count}";
        _sidebarToggle.Content = new SymbolIcon(collapsed ? Symbol.Forward : Symbol.Back);
        ToolTipService.SetToolTip(_sidebarToggle, collapsed ? "Expand sidebar" : "Collapse sidebar");
        _sidebarNavButtons.Clear();

        var pinned = _vm.Tabs.Where(x => x.IsPinned).ToList();
        if (pinned.Count > 0)
        {
            if (!collapsed) _verticalGroupHost.Children.Add(SidebarLabel("Pinned", pinned.Count));
            var grid = new Grid { Margin = new(2, 0, 2, 8), ColumnSpacing = 4, RowSpacing = 4 };
            var columns = collapsed ? 1 : 6;
            for (var i = 0; i < columns; i++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            // Grid does not create implicit rows for Grid.SetRow. Without these
            // definitions every sixth pinned tab is placed on row zero and ends
            // up hidden behind the first five.
            var rows = (int)Math.Ceiling(pinned.Count / (double)columns);
            for (var i = 0; i < rows; i++) grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            ConfigureTabDropTarget(grid, tab => { tab.IsPinned = true; tab.GroupId = null; tab.GroupName = null; }, "Drop to pin tab");
            for (var index = 0; index < pinned.Count; index++)
            {
                var item = BuildPinnedTabButton(pinned[index], collapsed);
                Grid.SetRow(item, index / columns); Grid.SetColumn(item, index % columns); grid.Children.Add(item);
            }
            _verticalGroupHost.Children.Add(grid);
        }

        var represented = new HashSet<Guid>();
        var treeSnapshots = _vm.Tabs.Select(x => x.ToSnapshot()).ToList();
        foreach (var group in _tabGroups.Values.OrderBy(x => x.SortOrder).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ToList())
        {
            var tabs = _vm.Tabs.Where(x => !x.IsPinned && x.GroupId == group.Id)
                .Where(x => !Browser.Core.Tabs.TreeTabPolicy.IsHiddenByCollapse(treeSnapshots, x.Id)).ToList();
            if (tabs.Count == 0) continue;
            represented.Add(group.Id);
            _verticalGroupHost.Children.Add(BuildGroupSection(group, tabs, collapsed));
        }

        var ungrouped = _vm.Tabs.Where(x => !x.IsPinned && (x.GroupId is null || !represented.Contains(x.GroupId.Value)))
            .Where(x => !Browser.Core.Tabs.TreeTabPolicy.IsHiddenByCollapse(treeSnapshots, x.Id)).ToList();
        if (ungrouped.Count > 0)
        {
            if (!collapsed) _verticalGroupHost.Children.Add(SidebarLabel("Other tabs", ungrouped.Count));
            var panel = new StackPanel { Spacing = 2 };
            ConfigureTabDropTarget(panel, tab => { tab.IsPinned = false; tab.GroupId = null; tab.GroupName = null; }, "Remove from group");
            foreach (var tab in ungrouped) panel.Children.Add(BuildSidebarTabButton(tab, collapsed));
            _verticalGroupHost.Children.Add(panel);
        }
    }

    private void ConfigureTabDropTarget(FrameworkElement target, Action<BrowserTab> apply, string caption)
    {
        target.AllowDrop = true;
        target.DragOver += (_, e) =>
        {
            e.AcceptedOperation = e.Data.Properties.TryGetValue(DragKindKey, out var kind) && kind is string { Length: > 0 } ? DataPackageOperation.Move : DataPackageOperation.None;
            e.DragUIOverride.Caption = caption;
        };
        target.Drop += async (_, e) =>
        {
            if (!e.Data.Properties.TryGetValue(DragTabKey, out var idText) || idText is not string text || !Guid.TryParse(text, out var id)) return;
            var tab = _vm.Tabs.FirstOrDefault(x => x.Id == id);
            if (tab is null)
            {
                var source = TabTransferTargets().FirstOrDefault(window => window._vm.Tabs.Any(x => x.Id == id));
                var sourceTab = source?._vm.Tabs.FirstOrDefault(x => x.Id == id);
                if (source is null || sourceTab is null) return;
                tab = await source.MoveTabToWindowAsync(sourceTab, this);
                if (tab is null) return;
            }
            apply(tab);
            RefreshTabLists();
            if (!_isPrivate) await SaveSessionAsync();
        };
    }

    private void ConfigureGroupDropTarget(FrameworkElement target, TabGroup targetGroup)
    {
        target.AllowDrop = true;
        target.DragOver += (_, e) =>
        {
            var valid = e.Data.Properties.TryGetValue(DragKindKey, out var kind) && kind as string == "tab";
            if (!valid && e.Data.Properties.TryGetValue(DragGroupKey, out var gid) && gid is string text && Guid.TryParse(text, out var dragged) && dragged != targetGroup.Id)
                valid = true;
            e.AcceptedOperation = valid ? DataPackageOperation.Move : DataPackageOperation.None;
            e.DragUIOverride.Caption = valid ? $"Move into {targetGroup.Name}" : string.Empty;
        };
        target.Drop += async (_, e) =>
        {
            if (e.Data.Properties.TryGetValue(DragTabKey, out var idText) && idText is string tabText && Guid.TryParse(tabText, out var id) && _vm.Tabs.FirstOrDefault(x => x.Id == id) is { } tab)
            {
                tab.IsPinned = false;
                tab.GroupId = targetGroup.Id;
                tab.GroupName = targetGroup.Name;
                RefreshTabLists();
                if (!_isPrivate) await SaveSessionAsync();
            }
            else if (e.Data.Properties.TryGetValue(DragGroupKey, out var gid) && gid is string groupText && Guid.TryParse(groupText, out var draggedId) && draggedId != targetGroup.Id && _tabGroups.TryGetValue(draggedId, out var dragged))
            {
                var ordered = _tabGroups.Values.OrderBy(x => x.SortOrder).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ToList();
                ordered.Remove(dragged);
                ordered.Insert(Math.Max(0, ordered.IndexOf(targetGroup)), dragged);
                for (var i = 0; i < ordered.Count; i++) ordered[i].SortOrder = i;
                RefreshTabLists();
                if (!_isPrivate) await SaveSessionAsync();
            }
        };
    }

    private static void StartDrag(Microsoft.UI.Xaml.DragStartingEventArgs e, string kind, Guid id)
    {
        e.Data.RequestedOperation = DataPackageOperation.Move;
        e.Data.Properties[DragKindKey] = kind;
        if (kind == "tab") e.Data.Properties[DragTabKey] = id.ToString();
        else e.Data.Properties[DragGroupKey] = id.ToString();
    }

    private void EnableSidebarArrowKeys(Button button)
    {
        button.KeyDown += (_, e) =>
        {
            var index = _sidebarNavButtons.IndexOf(button);
            if (e.Key == VirtualKey.Down && index >= 0 && index < _sidebarNavButtons.Count - 1) { _sidebarNavButtons[index + 1].Focus(FocusState.Keyboard); e.Handled = true; }
            else if (e.Key == VirtualKey.Up && index > 0) { _sidebarNavButtons[index - 1].Focus(FocusState.Keyboard); e.Handled = true; }
        };
    }

    private FrameworkElement BuildGroupSection(TabGroup group, IReadOnlyList<BrowserTab> tabs, bool sidebarCollapsed)
    {
        var panel = new StackPanel { Spacing = 0, Margin = new(0, 2, 0, 4) };
        var header = new Grid
        {
            Height = sidebarCollapsed ? 34 : 38,
            Margin = new(2, 0, 2, group.IsCollapsed ? 0 : 2),
            Background = new SolidColorBrush(ColorFromHex(group.Color, 48)),
            BorderBrush = new SolidColorBrush(ColorFromHex(group.Color, 96)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8, 8, group.IsCollapsed ? 8 : 4, group.IsCollapsed ? 8 : 4)
        };
        header.ColumnDefinitions.Add(new() { Width = new(4) });
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var stripe = new Border { Background = new SolidColorBrush(ColorFromHex(group.Color)), CornerRadius = new(3, 0, 0, 3) }; header.Children.Add(stripe);
        var chevron = new TextBlock { Text = group.IsCollapsed ? "›" : "⌄", FontSize = 19, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center, Margin = new(9, -2, 7, 0), Opacity = .86 };
        Grid.SetColumn(chevron, 1); header.Children.Add(chevron);
        var sleeping = tabs.Count(x => x.IsHibernated);
        var titleRow = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        if (!sidebarCollapsed)
        {
            var title = new TextBlock { Text = group.Name, FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 140 };
            titleRow.Children.Add(title);
            var badge = new TextBlock { Text = sleeping > 0 ? $"{tabs.Count} · {sleeping} asleep" : tabs.Count.ToString(), FontSize = 10, Opacity = .6, VerticalAlignment = VerticalAlignment.Center };
            badge.Text = sleeping > 0 ? $"{tabs.Count} tabs / {sleeping} asleep" : $"{tabs.Count} tab{(tabs.Count == 1 ? string.Empty : "s")}";
            badge.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
            titleRow.Children.Add(badge);
        }
        Grid.SetColumn(titleRow, 2); header.Children.Add(titleRow);
        var menuButton = new Button { Content = new SymbolIcon(Symbol.More), Width = 24, Height = 24, Padding = new(0), CornerRadius = new(6), VerticalAlignment = VerticalAlignment.Center, ContextFlyout = BuildGroupMenu(group) };
        menuButton.Click += (_, _) => menuButton.ContextFlyout?.ShowAt(menuButton);
        ToolTipService.SetToolTip(menuButton, $"Group actions · {tabs.Count} tabs{(sleeping > 0 ? $", {sleeping} sleeping" : string.Empty)}");
        if (!string.IsNullOrWhiteSpace(group.Note)) ToolTipService.SetToolTip(header, group.Note);
        Grid.SetColumn(menuButton, 5); header.Children.Add(menuButton);
        var toggle = new Button { Background = new SolidColorBrush(Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch };
        // This is an intentionally invisible hit target over the descriptive part of the group header.
        // Override Button's PointerOver resources too; otherwise WinUI paints a pale strip on hover.
        var transparentToggleBrush = new SolidColorBrush(Color.FromArgb(0, 0, 0, 0));
        toggle.Resources["ButtonBackground"] = transparentToggleBrush;
        toggle.Resources["ButtonBackgroundPointerOver"] = transparentToggleBrush;
        toggle.Resources["ButtonBackgroundPressed"] = transparentToggleBrush;
        toggle.Resources["ButtonBorderBrush"] = transparentToggleBrush;
        toggle.Resources["ButtonBorderBrushPointerOver"] = transparentToggleBrush;
        toggle.Resources["ButtonBorderBrushPressed"] = transparentToggleBrush;
        toggle.Click += (_, _) => { group.IsCollapsed = !group.IsCollapsed; RefreshTabLists(); _ = SaveSessionAsync(); };
        ToolTipService.SetToolTip(toggle, group.IsCollapsed ? "Expand group" : "Collapse group");
        Grid.SetColumnSpan(toggle, 3); Grid.SetColumn(toggle, 1); header.Children.Add(toggle);
        _sidebarNavButtons.Add(toggle);
        EnableSidebarArrowKeys(toggle);
        header.CanDrag = true;
        header.DragStarting += (_, e) => StartDrag(e, "group", group.Id);
        ConfigureGroupDropTarget(header, group);
        ConfigureGroupDropTarget(panel, group);
        panel.Children.Add(header);
        if (!group.IsCollapsed)
        {
            var tabContainer = new StackPanel
            {
                Spacing = 1,
                Margin = new(7, 0, 2, 2),
                Padding = new(2),
                Background = new SolidColorBrush(ColorFromHex(group.Color, 16))
            };
            foreach (var tab in tabs) tabContainer.Children.Add(BuildSidebarTabButton(tab, sidebarCollapsed, group.Color));
            panel.Children.Add(tabContainer);
        }
        return new Border
        {
            Margin = new(2, 0, 2, 2),
            Padding = new(0),
            Background = new SolidColorBrush(ColorFromHex(group.Color, 10)),
            BorderBrush = new SolidColorBrush(ColorFromHex(group.Color, 54)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Child = panel
        };
    }

    private FrameworkElement BuildPinnedTabButton(BrowserTab tab, bool sidebarCollapsed)
    {
        var button = new Button { Width = sidebarCollapsed ? 34 : double.NaN, Height = 34, Padding = new(0), CornerRadius = new(7), HorizontalAlignment = HorizontalAlignment.Stretch, ContextFlyout = BuildTabMenu(tab), Tag = tab };
        button.Click += async (_, _) => await ActivateTabAsync(tab);
        button.PointerPressed += (_, e) => { if (e.GetCurrentPoint(button).Properties.IsMiddleButtonPressed) { e.Handled = true; CloseTab(tab); } };
        button.PointerEntered += (_, _) => _ = RefreshTabMemoryUsageAsync();
        ToolTipService.SetToolTip(button, BuildTabPreview(tab));
        button.CanDrag = true;
        button.DragStarting += (_, e) => StartDrag(e, "tab", tab.Id);
        _sidebarNavButtons.Add(button);
        EnableSidebarArrowKeys(button);
        var box = new Grid();
        var icon = TabIcon(tab, 16); icon.HorizontalAlignment = HorizontalAlignment.Center; icon.VerticalAlignment = VerticalAlignment.Center; box.Children.Add(icon);
        if (tab.Id == _vm.SelectedTab?.Id) box.Children.Add(new Border { Height = 3, VerticalAlignment = VerticalAlignment.Bottom, Background = ResourceBrush("AccentFillColorDefaultBrush"), CornerRadius = new(2) });
        if (tab.IsHibernated || tab.IsLoading || tab.IsMediaPlaying)
        {
            var state = TabSymbol(tab.IsHibernated ? Symbol.Clock : tab.IsLoading ? Symbol.Sync : Symbol.Volume, 12);
            state.HorizontalAlignment = HorizontalAlignment.Right;
            state.VerticalAlignment = VerticalAlignment.Bottom;
            box.Children.Add(state);
        }
        button.Content = box;
        return button;
    }

    private FrameworkElement BuildSidebarTabButton(BrowserTab tab, bool sidebarCollapsed, string? groupColor = null)
    {
        var selected = tab.Id == _vm.SelectedTab?.Id;
        var grouped = !string.IsNullOrWhiteSpace(groupColor);
        var background = selected
            ? grouped ? new SolidColorBrush(ColorFromHex(groupColor!, 46)) : ResourceBrush("SubtleFillColorSecondaryBrush")
            : new SolidColorBrush(Color.FromArgb(0, 0, 0, 0));
        // Tree indent (#13): children shift right; temporary tabs (#19) get a dotted hint via opacity.
        var snapshots = _vm.Tabs.Select(x => x.ToSnapshot()).ToList();
        var depth = Math.Min(Browser.Core.Tabs.TreeTabPolicy.GetDepth(snapshots, tab.Id), Browser.Core.Tabs.TreeTabPolicy.MaximumDepth);
        var indent = sidebarCollapsed ? 0 : depth * 16;
        var hasChildren = _vm.Tabs.Any(x => x.ParentId == tab.Id);
        var button = new Button { Height = 36, Margin = grouped ? new Thickness(indent, 0, 0, 0) : new Thickness(2 + indent, 0, 2, 0), Padding = new(7, 2, 5, 2), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, CornerRadius = new(7), ContextFlyout = BuildTabMenu(tab), Tag = tab, Background = background, Opacity = tab.IsTemporary ? 0.78 : 1 };
        button.Click += async (_, _) => await ActivateTabAsync(tab);
        button.PointerPressed += (_, e) => { if (e.GetCurrentPoint(button).Properties.IsMiddleButtonPressed) { e.Handled = true; CloseTab(tab); } };
        button.PointerEntered += (_, _) => _ = RefreshTabMemoryUsageAsync();
        ToolTipService.SetToolTip(button, BuildTabPreview(tab));
        button.CanDrag = true;
        button.DragStarting += (_, e) => StartDrag(e, "tab", tab.Id);
        _sidebarNavButtons.Add(button);
        EnableSidebarArrowKeys(button);
        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new() { Width = new(3) }); row.ColumnDefinitions.Add(new() { Width = new(20) }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        if (grouped) row.Children.Add(new Border { Background = new SolidColorBrush(ColorFromHex(groupColor!, selected ? (byte)255 : (byte)96)), CornerRadius = new(2) });
        else if (selected) row.Children.Add(new Border { Background = ResourceBrush("AccentFillColorDefaultBrush"), CornerRadius = new(2) });
        var icon = TabIcon(tab, 16); icon.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(icon, 1); row.Children.Add(icon);
        if (!sidebarCollapsed)
        {
            var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            var title = (depth > 0 ? "↳ " : string.Empty) + tab.Title + (tab.IsTemporary ? " · Temporary" : string.Empty) + (hasChildren ? (tab.IsTreeCollapsed ? " (+)" : " (–)") : string.Empty);
            text.Children.Add(new TextBlock { Text = title, TextTrimming = TextTrimming.CharacterEllipsis, FontSize = 12, Opacity = tab.IsTemporary ? 0.85 : 1 });
            Grid.SetColumn(text, 2); row.Children.Add(text);
        }
        if (tab.IsLoading || tab.IsHibernated || tab.IsMediaPlaying || tab.IsMuted || tab.HasActiveDownload)
        {
            var symbol = tab.IsLoading ? Symbol.Sync : tab.IsHibernated ? Symbol.Clock : tab.HasActiveDownload ? Symbol.Download : tab.IsMuted ? Symbol.Mute : Symbol.Volume;
            var state = TabSymbol(symbol, 14);
            state.Opacity = .76;
            Grid.SetColumn(state, 3); row.Children.Add(state);
        }
        button.Content = row;
        return button;
    }

    private static TextBlock SidebarLabel(string text, int count) => new() { Text = $"{text.ToUpperInvariant()}  {count}", FontSize = 10, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Opacity = .62, Margin = new(8, 5, 8, 3) };
    private FrameworkElement TabIcon(BrowserTab tab, double size) => !string.IsNullOrWhiteSpace(tab.FaviconPath) && File.Exists(tab.FaviconPath)
        ? new Image { Source = new BitmapImage(new Uri(tab.FaviconPath)), Width = size, Height = size }
        : TabSymbol(tab.IsHibernated ? Symbol.Clock : tab.Url == "browser://newtab" ? Symbol.Home : Symbol.World, size + 2);

    // SymbolIcon always uses the platform's default glyph size. FontIcon lets the compact
    // tab UI size the same Windows glyph explicitly so its outline is never clipped.
    private static FontIcon TabSymbol(Symbol symbol, double boxSize) => new()
    {
        Glyph = char.ConvertFromUtf32((int)symbol),
        FontFamily = new FontFamily("Segoe MDL2 Assets"),
        Width = boxSize,
        Height = boxSize,
        FontSize = Math.Max(8, boxSize - 3),
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center
    };
    private static string DefaultGroupColor(int index) => new[] { "#4C8DFF", "#7C5CFC", "#008A78", "#D06B18", "#C43E5C", "#7593B5" }[Math.Abs(index) % 6];
    private static Color ColorFromHex(string color, byte alpha = 255)
    {
        color = TabGroup.NormalizeColor(color);
        return Color.FromArgb(alpha, Convert.ToByte(color[1..3], 16), Convert.ToByte(color[3..5], 16), Convert.ToByte(color[5..7], 16));
    }

    private IconSource TabIconSource(BrowserTab tab)
    {
        if (!string.IsNullOrWhiteSpace(tab.FaviconPath) && File.Exists(tab.FaviconPath)) return new BitmapIconSource { UriSource = new Uri(tab.FaviconPath), ShowAsMonochrome = false };
        return new SymbolIconSource { Symbol = tab.Url == "browser://newtab" ? Symbol.Home : tab.Error is not null ? Symbol.Important : Symbol.World };
    }

    private MenuFlyout BuildTabMenu(BrowserTab tab)
    {
        var flyout = new MenuFlyout();
        AddMenu(flyout, tab.IsPinned ? "Unpin tab" : "Pin tab", () => TogglePin(tab), null, Symbol.Pin);
        AddMenu(flyout, tab.IsMuted ? "Unmute tab" : "Mute tab", () => ToggleMute(tab), null, tab.IsMuted ? Symbol.Volume : Symbol.Mute);
        AddMenu(flyout, "Duplicate tab", async () => await DuplicateTabAsync(tab), null, Symbol.Copy);
        AddMenu(flyout, tab.IsTemporary ? "Keep tab (make permanent)" : "Make temporary (discard on close)", () => ToggleTemporary(tab), null, Symbol.Clock);
        AddMenu(flyout, "Open child tab (tree)", () => NewTab("browser://newtab", true, tab.IsTemporary, tab.Id), null, Symbol.Add);
        if (tab.ParentId is not null) AddMenu(flyout, "Move out to top level", () => DetachTreeTab(tab), null, Symbol.BackToWindow);
        if (_vm.Tabs.Any(x => x.ParentId == tab.Id)) AddMenu(flyout, tab.IsTreeCollapsed ? "Expand child tabs" : "Collapse child tabs", () => ToggleTreeCollapsed(tab), null, Symbol.Forward);
        AddMenu(flyout, "Add to reading list", async () => { if (_vm.SelectedTab?.Id != tab.Id) await ActivateTabAsync(tab); await AddCurrentToReadingListAsync(); }, null, Symbol.Document);
        AddMenu(flyout, "Move tab to new window", async () => await MoveTabToNewWindowAsync(tab), null, Symbol.NewWindow);
        flyout.Items.Add(BuildWindowTransferMenu(tab));
        AddMenu(flyout, tab.GroupId is null ? "Add to tab group" : "Move or edit tab group", async () => await SetTabGroupAsync(tab), null, Symbol.Tag);
        if (tab.GroupId is { } groupId && _tabGroups.TryGetValue(groupId, out var group)) AddMenu(flyout, "Manage tab group", () => BuildGroupMenu(group).ShowAt(_more), null, Symbol.Tag);
        AddMenu(flyout, _splitTabIds.Contains(tab.Id) ? "Remove from split screen" : "Show in split screen", async () => await ToggleTabInSplitAsync(tab), null, Symbol.View);
        AddMenu(flyout, tab.IsHibernated ? "Wake tab" : "Hibernate tab", async () => { if (tab.IsHibernated) await ActivateTabAsync(tab); else await HibernateTabAsync(tab); }, null, Symbol.Clock);
        var exclude = new MenuFlyoutItem { Text = "Never hibernate this site", Icon = new SymbolIcon(Symbol.ProtectedDocument), IsEnabled = Uri.TryCreate(tab.Url, UriKind.Absolute, out var site) && !string.IsNullOrWhiteSpace(site.Host) };
        exclude.Click += async (_, _) => await ExcludeFromHibernationAsync(tab);
        flyout.Items.Add(exclude);
        flyout.Items.Add(new MenuFlyoutSeparator());
        AddMenu(flyout, "Close tab", () => CloseTab(tab), "Ctrl+W", Symbol.Cancel);
        AddMenu(flyout, "Close other tabs", () => CloseOthers(tab));
        AddMenu(flyout, "Close tabs to the right", () => CloseRight(tab));
        return flyout;
    }

    private void ToggleTemporary(BrowserTab tab)
    {
        tab.IsTemporary = !tab.IsTemporary;
        if (tab.IsTemporary)
        {
            // Temporary tabs never sit in split screen and never enter recently-closed.
            _splitTabIds.Remove(tab.Id);
            if (_splitTabIds.Count < 2) { _splitTabIds.Clear(); _splitColumnFractions = null; _splitRowFractions = null; }
        }
        RefreshTabLists();
        _ = SaveSessionAsync();
        ShowStatus(tab.IsTemporary ? "Temporary tab — it closes with this window and is never saved." : "Tab will now persist across restarts.");
    }

    private void DetachTreeTab(BrowserTab tab) { tab.ParentId = null; RefreshTabLists(); _ = SaveSessionAsync(); }

    private void ToggleTreeCollapsed(BrowserTab tab) { tab.IsTreeCollapsed = !tab.IsTreeCollapsed; RefreshTabLists(); _ = SaveSessionAsync(); }

    private void TogglePin(BrowserTab tab) { tab.IsPinned = !tab.IsPinned; var ordered = TabOrdering.PinnedFirst(_vm.Tabs).ToList(); _vm.Tabs.Clear(); foreach (var item in ordered) _vm.Tabs.Add(item); RefreshTabLists(); }
    private void SynchronizeTabOrder(IEnumerable<BrowserTab> visualOrder)
    {
        if (_refreshingTabs) return;
        var ordered = TabOrdering.PinnedFirst(visualOrder).ToList();
        if (ordered.Count != _vm.Tabs.Count) return;
        _vm.Tabs.Clear();
        foreach (var tab in ordered) _vm.Tabs.Add(tab);
        RefreshTabLists();
        _ = SaveSessionAsync();
    }
    private void ToggleMute(BrowserTab tab) { tab.IsMuted = !tab.IsMuted; if (_webViews.TryGetValue(tab.Id, out var web) && web.CoreWebView2 is not null) { try { web.CoreWebView2.IsMuted = tab.IsMuted; } catch { } } RefreshTabLists(); }
    private async Task SetTabGroupAsync(BrowserTab tab)
    {
        var groups = _tabGroups.Values.OrderBy(x => x.SortOrder).ThenBy(x => x.Name).ToList();
        var choice = new ComboBox { Header = "Existing group", PlaceholderText = "Create a new group", MinWidth = 320 };
        foreach (var group in groups) choice.Items.Add(new ComboBoxItem { Content = group.Name, Tag = group.Id });
        var current = groups.FirstOrDefault(x => x.Id == tab.GroupId);
        if (current is not null) choice.SelectedItem = choice.Items.OfType<ComboBoxItem>().FirstOrDefault(x => (Guid)x.Tag == current.Id);
        var input = new TextBox { Header = "New group name", Text = current?.Name ?? "", PlaceholderText = "Research", MaxLength = 40, MinWidth = 320 };
        var color = new ComboBox { Header = "Group color", ItemsSource = new[] { "Blue", "Purple", "Teal", "Orange", "Rose", "Slate" }, SelectedIndex = 0 };
        var content = new StackPanel { Spacing = 10, Children = { choice, input, color } };
        var dialog = new ContentDialog { Title = "Organize tab", Content = content, PrimaryButtonText = "Save", SecondaryButtonText = tab.GroupId is null ? null : "Remove from group", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
        {
            var existingId = (choice.SelectedItem as ComboBoxItem)?.Tag is Guid id ? id : (Guid?)null;
            var group = existingId is { } groupId && _tabGroups.TryGetValue(groupId, out var existing)
                ? existing
                : CreateOrFindGroup(input.Text, color.SelectedIndex);
            tab.GroupId = group.Id; tab.GroupName = group.Name;
        }
        else if (result == ContentDialogResult.Secondary) { tab.GroupId = null; tab.GroupName = null; RemoveEmptyGroups(); }
        else return;
        RefreshTabLists();
        if (!_isPrivate) await SaveSessionAsync();
    }

    private TabGroup CreateOrFindGroup(string? name, int colorIndex = 0)
    {
        var normalized = TabGroup.NormalizeName(name);
        var match = _tabGroups.Values.FirstOrDefault(x => x.Name.Equals(normalized, StringComparison.OrdinalIgnoreCase));
        if (match is not null) return match;
        var group = new TabGroup { Name = normalized, Color = DefaultGroupColor(colorIndex), SortOrder = _tabGroups.Count };
        _tabGroups[group.Id] = group;
        return group;
    }

    private bool _domainGroupingPromptOpen;

    private async Task SuggestDomainGroupsAsync(bool showEmptyStatus = false)
    {
        if (_domainGroupingPromptOpen) return;
        var candidates = _vm.Tabs
            .Where(tab => !tab.IsPinned && tab.GroupId is null && !IsNativePageTab(tab))
            .Select(tab => (Tab: tab, Uri: Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? uri : null))
            .Where(item => item.Uri is not null && !string.IsNullOrWhiteSpace(item.Uri.Host))
            .GroupBy(item => item.Uri!.Host, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() >= 2)
            .ToList();
        if (candidates.Count == 0)
        {
            if (showEmptyStatus) ShowStatus("No ungrouped same-site tabs to organize.");
            return;
        }

        _domainGroupingPromptOpen = true;
        try
        {
            var summary = string.Join(Environment.NewLine, candidates.Take(8).Select(group => $"• {group.Key} – {group.Count()} tabs"));
            if (!await ConfirmAsync("Organize tabs by site?", $"Sutra found ungrouped tabs from the same sites:\n\n{summary}\n\nCreate one colored group per site?", "Create groups")) return;
            var groupedCount = 0;
            foreach (var candidate in candidates)
            {
                var group = CreateOrFindGroup(candidate.Key, _tabGroups.Count);
                foreach (var (tab, _) in candidate)
                {
                    tab.GroupId = group.Id;
                    tab.GroupName = group.Name;
                    groupedCount++;
                }
            }
            RefreshTabLists();
            if (!_isPrivate) await SaveSessionAsync();
            ShowStatus($"Organized {groupedCount} tabs into {candidates.Count} site group{(candidates.Count == 1 ? "" : "s")}", InfoBarSeverity.Success);
        }
        finally
        {
            _domainGroupingPromptOpen = false;
        }
    }

    private MenuFlyout BuildGroupMenu(TabGroup group)
    {
        var flyout = new MenuFlyout();
        AddMenu(flyout, group.IsCollapsed ? "Expand group" : "Collapse group", () => { group.IsCollapsed = !group.IsCollapsed; RefreshTabLists(); _ = SaveSessionAsync(); }, null, group.IsCollapsed ? Symbol.Back : Symbol.Forward);
        AddMenu(flyout, "New tab in group", () => _ = NewTabInGroupAsync(group), null, Symbol.Add);
        AddMenu(flyout, "Duplicate group", () => _ = DuplicateGroupAsync(group), null, Symbol.Copy);
        AddMenu(flyout, "Rename or recolor", async () => await EditGroupAsync(group), null, Symbol.Edit);
        AddMenu(flyout, "Hibernate group", async () => await HibernateGroupAsync(group), null, Symbol.Clock);
        AddMenu(flyout, "Wake group", async () => await WakeGroupAsync(group), null, Symbol.Play);
        AddMenu(flyout, "Wake all sleeping groups", async () => await WakeAllSleepingGroupsAsync(), null, Symbol.Play);
        AddMenu(flyout, group.NeverHibernate ? "Allow automatic hibernation" : "Never hibernate group", () => { group.NeverHibernate = !group.NeverHibernate; RefreshTabLists(); _ = SaveSessionAsync(); }, null, Symbol.ProtectedDocument);
        flyout.Items.Add(new MenuFlyoutSeparator());
        AddMenu(flyout, "Remove group (keep tabs)", () => RemoveGroup(group), null, Symbol.Cancel);
        // Closing a group is intentionally archival by default.  This matches the
        // browser-bar workflow: the group can be brought back later rather than
        // silently disappearing with all of its tabs.
        AddMenu(flyout, "Save group to bookmarks and close", async () => await SaveAndCloseTabGroupAsync(group), null, Symbol.Save);
        AddMenu(flyout, "Close group without saving", () => CloseTabGroup(group), null, Symbol.Delete);
        return flyout;
    }

    private async Task NewTabInGroupAsync(TabGroup group)
    {
        var tab = new BrowserTab { Url = "browser://newtab", Title = AppBrand.NewTabTitle, GroupId = group.Id, GroupName = group.Name };
        _vm.Add(tab, true);
        RefreshTabLists();
        if (!_isPrivate) await SaveSessionAsync();
        await ActivateTabAsync(tab);
    }

    private async Task DuplicateGroupAsync(TabGroup group)
    {
        var source = _vm.Tabs.Where(x => x.GroupId == group.Id).ToList();
        if (source.Count == 0) return;
        var copy = new TabGroup { Name = TabGroup.NormalizeName(group.Name is null or "" ? "Copy" : $"Copy of {group.Name}"), Color = group.Color, SortOrder = Math.Min(_tabGroups.Count, group.SortOrder + 1) };
        _tabGroups[copy.Id] = copy;
        foreach (var tab in source)
        {
            var duplicate = new BrowserTab { Title = tab.Title, Url = tab.Url, FaviconPath = tab.FaviconPath, GroupId = copy.Id, GroupName = copy.Name };
            _vm.Add(duplicate, false);
        }
        RefreshTabLists();
        if (!_isPrivate) await SaveSessionAsync();
        ShowStatus($"Duplicated {source.Count} tab{(source.Count == 1 ? "" : "s")} into {copy.Name}", InfoBarSeverity.Success);
        var fallback = _vm.Tabs.FirstOrDefault(x => x.GroupId == copy.Id) ?? _vm.SelectedTab;
        if (fallback is not null) await ActivateTabAsync(fallback);
    }

    private async Task WakeAllSleepingGroupsAsync()
    {
        var sleeping = _vm.Tabs.Where(x => x.IsHibernated).ToList();
        if (sleeping.Count == 0) { ShowStatus("No sleeping tabs to wake"); return; }
        var woken = 0;
        foreach (var tab in sleeping)
            if (!_webViews.ContainsKey(tab.Id)) { await CreateWebViewAsync(tab); tab.IsHibernated = false; woken++; }
        RefreshTabLists();
        ShowStatus($"Woke {woken} sleeping tab{(woken == 1 ? "" : "s")}");
    }

    private async Task EditGroupAsync(TabGroup group)
    {
        var name = new TextBox { Header = "Group name", Text = group.Name, MaxLength = 40, MinWidth = 300 };
        var note = new TextBox { Header = "Group note (optional)", Text = group.Note, MaxLength = 240, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 64, MinWidth = 300 };
        var color = new ComboBox { Header = "Color", ItemsSource = new[] { "Blue", "Purple", "Teal", "Orange", "Rose", "Slate" }, SelectedIndex = 0 };
        var dialog = new ContentDialog { Title = "Edit tab group", Content = new StackPanel { Spacing = 10, Children = { name, note, color } }, PrimaryButtonText = "Save", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        group.Name = TabGroup.NormalizeName(name.Text); group.Note = TabGroup.NormalizeNote(note.Text); group.Color = DefaultGroupColor(color.SelectedIndex);
        foreach (var tab in _vm.Tabs.Where(x => x.GroupId == group.Id)) tab.GroupName = group.Name;
        RefreshTabLists(); if (!_isPrivate) await SaveSessionAsync();
    }

    private async Task HibernateGroupAsync(TabGroup group)
    {
        var tabs = _vm.Tabs.Where(x => x.GroupId == group.Id && !x.IsHibernated).ToList();
        var active = tabs.FirstOrDefault(x => x.Id == _vm.SelectedTab?.Id);
        if (active is not null)
        {
            var destination = _vm.Tabs.FirstOrDefault(x => x.GroupId != group.Id && !x.IsHibernated) ?? NewTab(activate: false);
            await ActivateTabAsync(destination);
        }
        var slept = 0; var skipped = 0;
        foreach (var tab in tabs)
        {
            if (ManualHibernateBlocked(tab)) { skipped++; continue; }
            await HibernateTabAsync(tab); slept++;
        }
        ShowStatus($"{group.Name}: {slept} tab{(slept == 1 ? "" : "s")} sleeping{(skipped > 0 ? $", {skipped} kept awake" : string.Empty)}");
    }

    private async Task WakeGroupAsync(TabGroup group)
    {
        var tabs = _vm.Tabs.Where(x => x.GroupId == group.Id && x.IsHibernated).ToList();
        if (tabs.Count == 0) { ShowStatus($"{group.Name} is already awake"); return; }
        // Wake one tab visibly only when the user is already looking at this group;
        // otherwise restore every tab in the background so the current selection is not yanked away.
        var staying = _vm.SelectedTab is not null && _vm.SelectedTab.GroupId == group.Id;
        var wake = staying ? tabs[0] : null;
        foreach (var tab in staying ? tabs.Skip(1) : tabs)
            if (!_webViews.ContainsKey(tab.Id)) { await CreateWebViewAsync(tab); tab.IsHibernated = false; }
        if (wake is not null) await ActivateTabAsync(wake);
        RefreshTabLists();
        ShowStatus($"Woke {tabs.Count} tab{(tabs.Count == 1 ? "" : "s")} in {group.Name}");
    }

    private bool ManualHibernateBlocked(BrowserTab tab) => _splitTabIds.Contains(tab.Id) || HasMiniPlayerForTab(tab.Id) || tab.HasActiveDownload || tab.IsMediaPlaying || tab.IsInActiveCall || tab.HasPermissionPrompt || tab.MayHaveUnsavedFormInput;

    private void RemoveGroup(TabGroup group)
    {
        foreach (var tab in _vm.Tabs.Where(x => x.GroupId == group.Id)) { tab.GroupId = null; tab.GroupName = null; }
        _tabGroups.Remove(group.Id); RefreshTabLists(); _ = SaveSessionAsync();
    }

    private void RemoveEmptyGroups()
    {
        foreach (var group in _tabGroups.Values.Where(group => !_vm.Tabs.Any(tab => tab.GroupId == group.Id)).ToList()) _tabGroups.Remove(group.Id);
    }

    private void CloseTabGroup(TabGroup group)
    {
        var candidates = _vm.Tabs.Where(x => x.GroupId == group.Id && !IsProtectedTab(x)).ToList();
        var protectedCount = _vm.Tabs.Count(x => x.GroupId == group.Id && IsProtectedTab(x));
        if (candidates.Count > 0)
        {
            var groupId = group.Id; var groupName = group.Name; var groupColor = group.Color; var groupSort = group.SortOrder;
            var closed = candidates.Select(x => (x.Title, x.Url, x.FaviconPath, x.IsPinned)).ToList();
            foreach (var candidate in candidates)
            {
                try { CloseMiniPlayersForTab(candidate.Id); } catch { }
                _activeNavigationIds.Remove(candidate.Id);
                _readerTabs.Remove(candidate.Id);
                _translationOfferedTabs.Remove(candidate.Id);
                _splitTabIds.Remove(candidate.Id);
                if (_webViews.Remove(candidate.Id, out var web)) { try { DetachWebView(web); web.Close(); } catch { } }
                _vm.Close(candidate);
            }
            if (_splitTabIds.Count < 2) _splitTabIds.Clear();
            RefreshTabLists();
            var next = _vm.Tabs.Count == 0 ? NewTab(activate: false) : _vm.SelectedTab;
            if (next is not null) _ = ActivateTabAsync(next);
            ShowUndoStatus($"Closed {closed.Count} tab{(closed.Count == 1 ? "" : "s")} in {groupName}", () =>
            {
                _tabGroups[groupId] = new TabGroup { Id = groupId, Name = groupName, Color = groupColor, SortOrder = groupSort };
                foreach (var item in closed)
                {
                    var restored = new BrowserTab { Title = item.Title, Url = item.Url, FaviconPath = item.FaviconPath, IsPinned = item.IsPinned, GroupId = groupId, GroupName = groupName };
                    _vm.Add(restored, false);
                }
                RefreshTabLists();
                if (!_isPrivate) _ = SaveSessionAsync();
                return Task.CompletedTask;
            });
        }
        RemoveEmptyGroups();
        if (!_isPrivate) _ = SaveSessionAsync();
        if (protectedCount > 0) ShowStatus($"Kept {protectedCount} protected group tab{(protectedCount == 1 ? "" : "s")} open");
    }

    private async Task SaveAndCloseTabGroupAsync(TabGroup group)
    {
        // browser://newtab is a Sutra-only URL, so it cannot be a bookmark.
        // Preserve every real tab in its displayed group order.
        var candidates = _vm.Tabs
            .Where(tab => tab.GroupId == group.Id && !IsProtectedTab(tab))
            .Where(tab => Uri.TryCreate(tab.Url, UriKind.Absolute, out _))
            .ToList();

        if (candidates.Count == 0)
        {
            CloseTabGroup(group);
            return;
        }

        try
        {
            var folderId = await _bookmarks.AddFolderAsync(group.Name);
            foreach (var tab in candidates)
                await _bookmarks.AddAsync(string.IsNullOrWhiteSpace(tab.Title) ? tab.Url : tab.Title, tab.Url, folderId);

            await RefreshBookmarkBarAsync();
            CloseTabGroup(group);
            ShowStatus($"Saved {candidates.Count} tab{(candidates.Count == 1 ? "" : "s")} in bookmark folder '{group.Name}'", InfoBarSeverity.Success);
        }
        catch
        {
            // Do not close anything when the local archive fails.
            ShowStatus("Could not save this tab group. The tabs are still open.", InfoBarSeverity.Error);
        }
    }
    private static bool IsProtectedTab(BrowserTab tab) => TabCleanupPolicy.IsProtected(tab);
    private async Task SutraSaveAsync()
    {
        // Keep one clean replacement tab so the command never leaves the window
        // without a usable browsing surface. Protected tabs remain open by design.
        var replacement = NewTab("browser://newtab", activate: true);
        var candidates = _vm.Tabs.Where(tab => tab.Id != replacement.Id && !IsProtectedTab(tab)).ToList();
        foreach (var tab in candidates)
        {
            var wasNativePage = _nativePageTabs.Remove(tab.Id);
            if (wasNativePage)
            {
                if (_nativePageClosedHandlers.Remove(tab.Id, out var pageClosed)) { try { pageClosed(); } catch { } }
                try { HideNativePageVisual(); } catch { }
            }
            try { CloseMiniPlayersForTab(tab.Id); } catch { }
            _activeNavigationIds.Remove(tab.Id);
            _readerTabs.Remove(tab.Id);
            _translationOfferedTabs.Remove(tab.Id);
            _splitTabIds.Remove(tab.Id);
            if (_webViews.Remove(tab.Id, out var web)) { try { DetachWebView(web); web.Close(); } catch { } }
            _vm.RemoveWithoutHistory(tab);
        }
        if (_splitTabIds.Count < 2) _splitTabIds.Clear();
        RemoveEmptyGroups();
        RefreshTabLists();
        await ActivateTabAsync(replacement);
        if (!_isPrivate) await SaveSessionAsync();

        var protectedCount = _vm.Tabs.Count(tab => tab.Id != replacement.Id && IsProtectedTab(tab));
        var detail = protectedCount == 0
            ? "Sutra Save kept a fresh tab and closed the rest."
            : $"Sutra Save kept a fresh tab and {protectedCount} protected tab{(protectedCount == 1 ? "" : "s")}.";
        ShowStatus(detail, InfoBarSeverity.Success);
    }

    private void CloseOthers(BrowserTab keep)
    {
        var candidates = _vm.Tabs.Where(x => x != keep && !IsProtectedTab(x)).ToList();
        var protectedCount = _vm.Tabs.Count - 1 - candidates.Count;
        foreach (var tab in candidates) CloseTab(tab);
        if (protectedCount > 0) ShowStatus($"Kept {protectedCount} protected tab{(protectedCount == 1 ? "" : "s")} open");
    }
    private void CloseRight(BrowserTab tab)
    {
        var index = _vm.Tabs.IndexOf(tab);
        var right = _vm.Tabs.Skip(index + 1).ToList();
        foreach (var other in right.Where(x => !IsProtectedTab(x)).ToList()) CloseTab(other);
        var protectedCount = right.Count(IsProtectedTab);
        if (protectedCount > 0) ShowStatus($"Kept {protectedCount} protected tab{(protectedCount == 1 ? "" : "s")} open");
    }

    private async Task ExcludeFromHibernationAsync(BrowserTab tab)
    {
        if (!Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || string.IsNullOrWhiteSpace(uri.Host)) return;
        _vm.Settings = SettingsValidator.Validate(_vm.Settings with { HibernationExclusions = _vm.Settings.HibernationExclusions.Append(uri.Host).ToArray() });
        await SaveSettingsSafeAsync();
        ShowStatus($"{uri.Host} will stay awake");
    }

    private bool SidebarExpanded => !_vm.Settings.SidebarCollapsed || (_vm.Settings.SidebarAutoHide && _sidebarHoverExpanded);

    private void ExpandSidebarOnHover()
    {
        if (!_vm.Settings.SidebarAutoHide || _sidebarHoverExpanded || _vm.Settings.TabLayout != TabLayout.Vertical) return;
        _sidebarHoverExpanded = true;
        ApplyTabLayout(); RefreshTabLists();
    }

    private void ApplyTabLayout()
    {
        var vertical = _vm.Settings.TabLayout == TabLayout.Vertical;
        _horizontalTabs.Visibility = vertical ? Visibility.Collapsed : Visibility.Visible;
        if (_verticalPane.Parent is Grid grid) grid.ColumnDefinitions[0].Width = vertical ? new(SidebarExpanded ? _vm.Settings.SidebarWidth : 64) : new(0);
        _verticalPane.Visibility = vertical ? Visibility.Visible : Visibility.Collapsed;
    }

    private async Task ToggleTabSidebarAsync()
    {
        _vm.Settings = _vm.Settings with { SidebarCollapsed = !_vm.Settings.SidebarCollapsed, TabLayout = TabLayout.Vertical };
        ApplyTabLayout(); RefreshTabLists();
        if (!_isPrivate) await SaveSettingsSafeAsync();
    }

    /// <summary>
    /// Requests a session save through the shared persistence coordinator.
    /// Overlapping callers never write concurrently; requests that arrive mid-pass
    /// are covered by one coalesced trailing pass that serializes the live tab
    /// model. Private windows never participate in session persistence.
    /// </summary>
    private Task SaveSessionAsync()
    {
        if (_isPrivate || _isWindowClosed) return Task.CompletedTask;
        return _persistenceSaves.RunAsync(PersistencePassKind.Session, _ => SaveSessionCoreAsync());
    }

    /// <summary>Persists the current session and settings once. Returns false when the flush failed.</summary>
    private async Task<bool> SaveSessionCoreAsync()
    {
        try
        {
            if (_isPrivate || _suppressPersistence) return true;
            RemoveEmptyGroups();
            var groups = _tabGroups.Values.OrderBy(x => x.SortOrder).Select(x => x.ToSnapshot()).ToList();
            var persistedTabs = _vm.Tabs.Where(tab => !IsNativePageTab(tab) && !tab.IsTemporary).ToList();
            Guid? activeTabId = _vm.SelectedTab is { } selected && !IsNativePageTab(selected) && !selected.IsTemporary ? selected.Id : persistedTabs.FirstOrDefault()?.Id;
            var splitIds = _splitTabIds.Where(id => persistedTabs.Any(tab => tab.Id == id)).ToList();
            if (splitIds.Count < 2) splitIds.Clear();
            var (columns, rows) = CaptureSplitFractions(splitIds.Count);
            var session = new BrowserSession(persistedTabs.Select(x => x.ToSnapshot()).ToList(), activeTabId, DateTimeOffset.UtcNow, splitIds, groups, _splitLayout, columns, rows);
            // Temporary tabs never reach the database: WithoutTemporary is enforced here and again inside
            // the repositories, so a future caller cannot accidentally persist a preview tab.
            session = Browser.Core.Sessions.MultiWindowSessionPolicy.WithoutTemporary(session);
            await _sessionSnapshots.SaveAsync(_sessionWindowId, _profileName, session);
            await _windowSessions.SaveAsync(_sessionWindowId, _profileName, session);
            if (_restoreSession && (!_startupNeedsReview || _previousSessionRestored)) await _sessions.SaveAsync(session);
            await _settingsRepository.SaveAsync(_vm.Settings);
            return true;
        }
        catch (Exception ex)
        {
            // Best-effort persistence: report only a safe operation name. Raw
            // exception text could contain paths or provider details.
            Debug.WriteLine($"Sutra session save failed: {ex.GetType().Name}");
            return false;
        }
    }

    private (IReadOnlyList<double>? Columns, IReadOnlyList<double>? Rows) CaptureSplitFractions(int paneCount)
    {
        try
        {
            if (!IsSplitViewActive || paneCount < 2) return (null, null);
            var layout = Browser.Core.Tabs.SplitLayout.Create(paneCount, _splitLayout);
            // Content definitions live at even indices; odd indices are 4px separators.
            var widths = new List<double>();
            for (var i = 0; i < _browserHost.ColumnDefinitions.Count; i += 2)
            {
                var actual = _browserHost.ColumnDefinitions[i].ActualWidth;
                if (!double.IsFinite(actual) || actual <= 0) return (null, null);
                widths.Add(actual);
            }
            var heights = new List<double>();
            for (var i = 0; i < _browserHost.RowDefinitions.Count; i += 2)
            {
                var actual = _browserHost.RowDefinitions[i].ActualHeight;
                if (!double.IsFinite(actual) || actual <= 0) return (null, null);
                heights.Add(actual);
            }
            IReadOnlyList<double>? columns = widths.Count == layout.Columns
                ? Browser.Core.Tabs.SplitRatioPolicy.FromPixels(widths) : null;
            IReadOnlyList<double>? rows = heights.Count == layout.Rows && layout.Rows > 1
                ? Browser.Core.Tabs.SplitRatioPolicy.FromPixels(heights) : null;
            // Only persist genuinely custom ratios; even splits are the default and need no storage.
            if (columns is not null && !Browser.Core.Tabs.SplitRatioPolicy.IsCustom(columns, columns.Count)) columns = null;
            if (rows is not null && !Browser.Core.Tabs.SplitRatioPolicy.IsCustom(rows, rows.Count)) rows = null;
            _splitColumnFractions = columns;
            _splitRowFractions = rows;
            return (columns, rows);
        }
        catch { return (null, null); }
    }

    /// <summary>
    /// Final shutdown flush: lets in-flight coordinated passes drain, then runs one
    /// authoritative session/settings pass and waits for it. Returns true only when
    /// the final pass succeeded, so shutdown truthfulness never depends on timing.
    /// Callers must have stopped background producers before invoking this.
    /// </summary>
    private async Task<bool> FlushSessionStateBeforeExitAsync()
    {
        try
        {
            await _persistenceSaves.DrainAsync();
            var flushed = false;
            await _persistenceSaves.RunAsync(PersistencePassKind.Session, async _ => flushed = await SaveSessionCoreAsync());
            await _persistenceSaves.DrainAsync();
            return flushed;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Final session flush failed: {ex.GetType().Name}");
            return false;
        }
    }

    /// <summary>
    /// Saves settings through the shared persistence coordinator so rapid setting
    /// changes cannot produce overlapping SQLite writes with each other or with
    /// session saves. No-ops for private windows, which do not persist browser
    /// settings.
    /// </summary>
    private Task SaveSettingsSafeAsync()
    {
        if (_isPrivate || _isWindowClosed) return Task.CompletedTask;
        return _persistenceSaves.RunAsync(PersistencePassKind.SettingsOnly, async _ =>
        {
            try { await _settingsRepository.SaveAsync(_vm.Settings); }
            catch (Exception ex) { Debug.WriteLine($"Sutra settings save failed: {ex.GetType().Name}"); }
        });
    }

    private Task ShowNewTabPageAsync(WebView2 web)
    {
        try
        {
        var htmlPath = Path.Combine(AppContext.BaseDirectory, "SutraUltra", "index.html");
            web.CoreWebView2.Navigate("file:///" + htmlPath.Replace('\\', '/'));
        }
        catch { ShowNewTabFallback(web); }
        return Task.CompletedTask;
    }

    private void ShowNewTabFallback(WebView2 web)
    {
        var (colorScheme, pageBackground, pageColor) = NewTabColors();
        try
        {
            // Keep the fallback fully usable even if the local dashboard file or
            // database is unavailable. It must never leave a permanent loading screen.
            web.NavigateToString($$"""
                <!doctype html><html><head><meta name="color-scheme" content="{{colorScheme}}"><style>:root{color-scheme:{{colorScheme}};font-family:'Segoe UI Variable','Segoe UI',sans-serif;--accent:{{_vm.Settings.AccentColor}}}body{margin:0;min-height:100vh;display:grid;place-items:center;background:{{pageBackground}};color:{{pageColor}}}.shell{width:min(680px,calc(100% - 48px));text-align:center}.logo{margin:auto;width:52px;height:52px;display:grid;place-items:center;border-radius:14px;background:var(--accent);color:white;font-size:25px;font-weight:700}.name{margin-top:14px;font-size:24px;font-weight:650}.subtitle{margin:8px 0 24px;opacity:.6;font-size:13px}.search{display:flex;gap:8px;padding:6px;border:1px solid color-mix(in srgb,CanvasText 20%,transparent);border-radius:14px;background:color-mix(in srgb,CanvasText 6%,Canvas)}input{flex:1;border:0;outline:0;background:transparent;color:inherit;font:16px inherit;padding:12px 14px}button{border:0;border-radius:10px;background:var(--accent);color:white;font:600 14px inherit;padding:0 20px;cursor:pointer}.note{margin-top:20px;font-size:12px;opacity:.5}</style></head><body><main class="shell"><div class="logo">S</div><div class="name">{{(_isPrivate ? AppBrand.PrivateWindowTitle : AppBrand.Name)}}</div><div class="subtitle">Search the web or enter an address</div><form class="search"><input id="q" autofocus autocomplete="off" placeholder="Search or enter address"><button>Go</button></form><div class="note">Your local new-tab page is ready.</div></main><script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const q=document.getElementById('q').value.trim();if(q)chrome.webview.postMessage({kind:'new-tab-search',query:q})});</script></body></html>
                """);
            // CoreWebView2 is initialized for every browser tab. Keep the legacy
            // minimal fallback below only for an unusual pre-initialization case.
            if (web.CoreWebView2 is not null) return;
            web.NavigateToString($$"""
                <!doctype html><meta name="color-scheme" content="{{colorScheme}}"><style>:root{color-scheme:{{colorScheme}};font-family:'Segoe UI Variable','Segoe UI',sans-serif;--accent:{{_vm.Settings.AccentColor}}}body{margin:0;min-height:100vh;display:grid;place-items:center;background:{{pageBackground}};color:{{pageColor}}}.shell{text-align:center}.logo{margin:auto;width:48px;height:48px;display:grid;place-items:center;border-radius:12px;background:var(--accent);color:white;font-size:23px;font-weight:700}.name{margin-top:13px;font-size:20px;font-weight:650}.loading{margin-top:8px;font-size:12px;opacity:.55}</style><div class="shell"><div class="logo">S</div><div class="name">{{(_isPrivate ? AppBrand.PrivateWindowTitle : AppBrand.Name)}}</div><div class="loading">Loading your new tab…</div></div>
                """);
        }
        catch { }
    }

    private async Task RenderAttachedNewTabPagesAsync()
    {
        var tabs = IsSplitViewActive
            ? _splitTabIds.Select(FindTab).Where(tab => tab is not null && tab.Url == "browser://newtab").Cast<BrowserTab>().ToList()
            : _vm.SelectedTab is { Url: "browser://newtab" } selected ? [selected] : [];
        foreach (var newTab in tabs)
            if (_webViews.TryGetValue(newTab.Id, out var web) && web.Parent is not null)
                await ShowNewTabPageAsync(web);
    }

    private (string Scheme, string Background, string Color) NewTabColors()
    {
        if (_vm.Settings.UseCustomThemeColors)
            return ("light dark", _vm.Settings.ThemeSurfaceColor, _vm.Settings.ThemeTextColor);
        return _vm.Settings.NewTabAppearance switch
        {
            NewTabAppearance.Light => ("light", "#F5F6FA", "#1B1B1F"),
            NewTabAppearance.Dark => ("dark", "#090B0D", "#F4F4F2"),
            NewTabAppearance.FollowBrowser => ("light dark", "Canvas", "CanvasText"),
            _ => ("light dark", "color-mix(in srgb,var(--sutra-accent,var(--accent)) 10%,Canvas)", "CanvasText")
        };
    }

    private void ShowErrorPage(WebView2 web, string error) => web.NavigateToString($"<!doctype html><meta name='color-scheme' content='light dark'><body style=\"font:15px 'Segoe UI';margin:10%;max-width:700px\"><h2>This page couldn’t be reached</h2><p style='opacity:.7'>{WebUtility.HtmlEncode(error)}</p><button onclick=\"chrome.webview.postMessage({{kind:'retry-tab'}})\">Try again</button> <button onclick=\"chrome.webview.postMessage({{kind:'error-go-back'}})\">Go back</button></body>");

    private async Task RecoverTabAsync(BrowserTab tab)
    {
        _activeNavigationIds.Remove(tab.Id);
        if (_webViews.Remove(tab.Id, out var failed))
        {
            try { DetachWebView(failed); failed.Close(); } catch { }
        }
        tab.Error = null;
        tab.IsLoading = false;
        await ActivateTabAsync(tab);
    }

    private async Task UpdateFaviconAsync(BrowserTab tab, CoreWebView2 core)
    {
        try
        {
            using var randomAccessStream = await core.GetFaviconAsync(CoreWebView2FaviconImageFormat.Png);
            using var source = randomAccessStream.AsStreamForRead();
            if (source.Length == 0) return;
            var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(core.FaviconUri ?? tab.Url))).ToLowerInvariant();
            var path = Path.Combine(_faviconDirectory, $"{key}.png");
            await using (var destination = File.Create(path)) await source.CopyToAsync(destination);
            tab.FaviconPath = path;
            RefreshTabLists();
        }
        catch { tab.FaviconPath = null; RefreshTabLists(); }
    }

    private async Task UpdateTabThumbnailAsync(BrowserTab tab, WebView2 web)
    {
        try
        {
            await Task.Delay(350);
            if (tab.IsLoading || web.CoreWebView2 is null) return;
            using var randomAccess = new InMemoryRandomAccessStream();
            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, randomAccess);
            randomAccess.Seek(0);
            var path = Path.Combine(_faviconDirectory, $"thumb-{tab.Id:N}.png");
            using var source = randomAccess.AsStreamForRead();
            await using var destination = File.Create(path);
            await source.CopyToAsync(destination);
            tab.ThumbnailPath = path;
            RefreshTabLists();
        }
        catch { }
    }

    private void PurgeStaleFavicons()
    {
        if (_isPrivate) return;
        try
        {
            if (!Directory.Exists(_faviconDirectory)) return;
            var cutoff = DateTime.UtcNow.AddDays(-7);
            var inUse = _vm.Tabs.Where(t => !string.IsNullOrWhiteSpace(t.FaviconPath) || !string.IsNullOrWhiteSpace(t.ThumbnailPath))
                .SelectMany(t => new[] { t.FaviconPath, t.ThumbnailPath })
                .Where(p => !string.IsNullOrWhiteSpace(p)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var file in Directory.EnumerateFiles(_faviconDirectory))
            {
                if (inUse.Contains(file)) continue;
                try { if (File.GetLastWriteTimeUtc(file) < cutoff) File.Delete(file); }
                catch { }
            }
        }
        catch { }
    }

    private async Task RefreshBookmarkBarAsync()
    {
        _bookmarkBarItems.Children.Clear();
        _bookmarkBar.Visibility = _vm.Settings.BookmarkBarVisible ? Visibility.Visible : Visibility.Collapsed;
        _bookmarkBarAll.Visibility = Visibility.Collapsed;
        if (!_vm.Settings.BookmarkBarVisible) return;
        var items = await _bookmarks.SearchAsync();
        var folders = await _bookmarks.ListFoldersAsync();
        var rootFolders = folders.Where(folder => folder.ParentId is null).ToList();
        if (items.Count == 0 && rootFolders.Count == 0)
        {
            // Avoid reserving a full chrome row for an empty bookmark bar. The
            // bookmark manager and overflow menu remain the discoverable paths
            // until the user has actual bookmarks to pin here.
            _bookmarkBar.Visibility = Visibility.Collapsed;
            return;
        }

        // Top-level bookmark folders are kept visible as compact group buttons.
        // A saved tab group is just a normal folder, which keeps it durable and
        // makes it available in the bookmark manager and after a restart.
        const int bookmarkBarLimit = 24;
        foreach (var folder in rootFolders.Take(bookmarkBarLimit))
        {
            var folderItems = items.Where(bookmark => bookmark.FolderId == folder.Id).ToList();
            var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            content.Children.Add(new SymbolIcon(Symbol.Folder) { Width = 14, Height = 14 });
            content.Children.Add(new TextBlock { Text = folder.Name, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 150 });
            var button = new Button { Content = content, Padding = new(9, 4, 9, 4), MaxWidth = 205, CornerRadius = new(6) };
            ToolTipService.SetToolTip(button, $"Bookmark folder • {folderItems.Count} item{(folderItems.Count == 1 ? "" : "s")}");
            EnableBookmarkReordering(button, folder.Id, folder: true);
            var menu = BuildBookmarkFolderMenu(folder, folders, items);
            button.Click += (_, _) => menu.ShowAt(button);
            _bookmarkBarItems.Children.Add(button);
        }

        var rootBookmarks = items.Where(bookmark => bookmark.FolderId is null).ToList();
        foreach (var bookmark in rootBookmarks.Take(Math.Max(0, bookmarkBarLimit - rootFolders.Count)))
        {
            var content=new StackPanel{Orientation=Orientation.Horizontal,Spacing=6};
            var openTab=_vm.Tabs.FirstOrDefault(x=>x.Url==bookmark.Url&&!string.IsNullOrWhiteSpace(x.FaviconPath)&&File.Exists(x.FaviconPath));
            if(openTab is not null)content.Children.Add(new Image{Source=new BitmapImage(new Uri(openTab.FaviconPath!)),Width=14,Height=14});
            else content.Children.Add(new SymbolIcon(Symbol.World){Width=14,Height=14});
            content.Children.Add(new TextBlock{Text=bookmark.Title,TextTrimming=TextTrimming.CharacterEllipsis,MaxWidth=140});
            var button = new Button { Content = content, Padding = new(9, 4, 9, 4), MaxWidth = 190, CornerRadius = new(6) };
            ToolTipService.SetToolTip(button, bookmark.Url);
            EnableBookmarkReordering(button, bookmark.Id, folder: false);
            button.Click += (_, _) => Navigate(bookmark.Url);
            var menu = new MenuFlyout(); AddMenu(menu, "Open in new tab", () => NewTab(bookmark.Url, !_vm.Settings.OpenLinksInBackground), null, Symbol.OpenFile); button.ContextFlyout = menu;
            _bookmarkBarItems.Children.Add(button);
        }
        _bookmarkBarAll.Content = $"All ({items.Count + folders.Count:N0})";
        _bookmarkBarAll.Visibility = Visibility.Visible;
    }

    private void RefreshTabGroupBar()
    {
        _bookmarkBarGroups.Children.Clear();
        if (!_vm.Settings.BookmarkBarVisible) return;

        foreach (var group in _tabGroups.Values.OrderBy(group => group.SortOrder).ThenBy(group => group.Name, StringComparer.OrdinalIgnoreCase))
        {
            var tabs = _vm.Tabs.Where(tab => tab.GroupId == group.Id).ToList();
            if (tabs.Count == 0) continue;

            var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5 };
            label.Children.Add(new Border { Width = 5, Height = 13, CornerRadius = new(3), Background = new SolidColorBrush(ColorFromHex(group.Color)) });
            label.Children.Add(new TextBlock { Text = group.Name, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 140, FontSize = 12 });
            var button = new Button
            {
                Content = label,
                Padding = new(8, 3, 9, 3),
                CornerRadius = new(6),
                Background = new SolidColorBrush(ColorFromHex(group.Color, 42)),
                BorderBrush = new SolidColorBrush(ColorFromHex(group.Color, 96)),
                BorderThickness = new Thickness(1),
                ContextFlyout = BuildGroupMenu(group)
            };
            var sleeping = tabs.Count(tab => tab.IsHibernated);
            ToolTipService.SetToolTip(button, $"{group.Name}: {tabs.Count} tab{(tabs.Count == 1 ? string.Empty : "s")}{(sleeping == 0 ? string.Empty : $", {sleeping} sleeping")}");
            var groupId = group.Id;
            button.Click += async (_, _) =>
            {
                group.IsCollapsed = false;
                RefreshTabLists();
                // Re-query live tabs: the group may have been emptied between menu
                // build and click, and the captured list would be stale.
                var live = _vm.Tabs.Where(tab => tab.GroupId == groupId).ToList();
                if (live.Count == 0) return;
                var target = live.FirstOrDefault(tab => !tab.IsHibernated) ?? live[0];
                await ActivateTabAsync(target);
            };
            _bookmarkBarGroups.Children.Add(button);
        }
    }

    private MenuFlyout BuildBookmarkFolderMenu(BookmarkFolder folder, IReadOnlyList<BookmarkFolder> folders, IReadOnlyList<Bookmark> items)
    {
        var menu = new MenuFlyout();
        var children = items.Where(bookmark => bookmark.FolderId == folder.Id).ToList();
        AddMenu(menu, "Open all in new tabs", () =>
        {
            for (var index = 0; index < children.Count; index++)
                NewTab(children[index].Url, index == children.Count - 1);
        }, null, Symbol.OpenFile);
        AddMenu(menu, "Open folder in background", () =>
        {
            foreach (var bookmark in children)
                NewTab(bookmark.Url, false);
        }, null, Symbol.OpenFile);

        if (children.Count > 0 || folders.Any(candidate => candidate.ParentId == folder.Id))
            menu.Items.Add(new MenuFlyoutSeparator());

        foreach (var bookmark in children)
            AddMenu(menu, bookmark.Title, () => Navigate(bookmark.Url), bookmark.Url, Symbol.World);

        foreach (var childFolder in folders.Where(candidate => candidate.ParentId == folder.Id))
        {
            var child = new MenuFlyoutSubItem { Text = childFolder.Name, Icon = new SymbolIcon(Symbol.Folder) };
            foreach (var bookmark in items.Where(bookmark => bookmark.FolderId == childFolder.Id))
            {
                var item = new MenuFlyoutItem { Text = bookmark.Title, Icon = new SymbolIcon(Symbol.World) };
                item.Click += (_, _) => Navigate(bookmark.Url);
                child.Items.Add(item);
            }
            menu.Items.Add(child);
        }
        return menu;
    }

    private async Task UpdateBookmarkButtonAsync(BrowserTab tab)
    {
        if(tab.Url=="browser://newtab"){_bookmark.Content=new SymbolIcon(Symbol.OutlineStar);return;}
        var saved=(await _bookmarks.SearchAsync()).Any(x=>x.Url==tab.Url);
        if(ReferenceEquals(tab,_vm.SelectedTab))_bookmark.Content=new SymbolIcon(saved?Symbol.SolidStar:Symbol.OutlineStar);
    }
}

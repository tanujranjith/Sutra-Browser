using Browser.Core.Navigation;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel.DataTransfer;
using Windows.Graphics;

namespace Browser.App;

public sealed partial class MainWindow
{
    private void RestoreWindowPlacement()
    {
        try
        {
            AppWindow.Resize(new SizeInt32(_vm.Settings.WindowWidth, _vm.Settings.WindowHeight));
            if (_vm.Settings.WindowMaximized && AppWindow.Presenter is OverlappedPresenter presenter) presenter.Maximize();
        }
        catch { }
    }

    private void CaptureWindowPlacement()
    {
        try
        {
            var maximized = AppWindow.Presenter is OverlappedPresenter presenter && presenter.State == OverlappedPresenterState.Maximized;
            _vm.Settings = maximized
                ? _vm.Settings with { WindowMaximized = true }
                : _vm.Settings with { WindowWidth = AppWindow.Size.Width, WindowHeight = AppWindow.Size.Height, WindowMaximized = false };
        }
        catch { }
    }

    private void ConfigureAddressMenu()
    {
        var menu = new MenuFlyout();
        AddMenu(menu, "Paste and go", async () => await PasteAndNavigateAsync(false), null, Symbol.Paste);
        AddMenu(menu, "Paste and search", async () => await PasteAndNavigateAsync(true), null, Symbol.Find);
        menu.Items.Add(new MenuFlyoutSeparator());
        AddMenu(menu, "Copy clean page link", async () => await CopyCleanLinkAsync(), null, Symbol.Copy);
        _address.ContextFlyout = menu;
    }

    private async Task PasteAndNavigateAsync(bool alwaysSearch)
    {
        try
        {
            var content = Clipboard.GetContent();
            if (!content.Contains(StandardDataFormats.Text)) return;
            var text = (await content.GetTextAsync()).Trim();
            if (text.Length == 0) return;
            _address.Text = text;
            Navigate(alwaysSearch ? AddressResolver.BuildSearchUri(text, _vm.Settings.SearchEngine).AbsoluteUri : text);
        }
        catch { ShowStatus("The clipboard could not be read.", InfoBarSeverity.Warning); }
    }

    private async Task CopyCleanLinkAsync()
    {
        var url = _vm.SelectedTab?.Url;
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
        {
            ShowStatus("This page does not have a shareable web link.", InfoBarSeverity.Warning);
            return;
        }
        var clean = _vm.Settings.RemoveTrackingParametersFromCopiedLinks ? UrlSanitizer.RemoveTrackingParameters(url) : url;
        var package = new DataPackage { RequestedOperation = DataPackageOperation.Copy };
        package.SetText(clean);
        Clipboard.SetContent(package);
        Clipboard.Flush();
        ShowStatus(clean == url ? "Page link copied" : "Clean link copied without tracking parameters", InfoBarSeverity.Success);
        await Task.CompletedTask;
    }

    private void OpenCleanCopy()
    {
        var url = _vm.SelectedTab?.Url;
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
        {
            ShowStatus("This page does not have a clean web link to open.", InfoBarSeverity.Warning);
            return;
        }
        var clean = UrlSanitizer.RemoveTrackingParameters(url);
        if (clean == url) { ShowStatus("This link has no common tracking parameters to remove."); return; }
        NewTab(clean, activate: true);
        ShowStatus("Opened a clean copy without tracking parameters", InfoBarSeverity.Success);
    }

    private void ToggleFocusMode()
    {
        _focusMode = !_focusMode;
        var toolbarSurface = _toolbar.Parent as FrameworkElement;
        if (_focusMode)
        {
            _horizontalTabs.Visibility = Visibility.Collapsed;
            if (toolbarSurface is not null) toolbarSurface.Visibility = Visibility.Collapsed;
            _bookmarkBar.Visibility = Visibility.Collapsed;
            _verticalPane.Visibility = Visibility.Collapsed;
            _utilitySidebarVisibleBeforeFocus = _utilitySidebar.Visibility == Visibility.Visible;
            _utilitySidebar.Visibility = Visibility.Collapsed;
            _copilotPanel.Visibility = Visibility.Collapsed;
            _contentGrid.ColumnDefinitions[0].Width = new GridLength(0);
            _contentGrid.ColumnDefinitions[2].Width = new GridLength(0);
            ShowStatus("Focus mode on · press Ctrl+Shift+F to restore browser controls", InfoBarSeverity.Informational, 5000);
            return;
        }

        _horizontalTabs.Visibility = Visibility.Visible;
        if (toolbarSurface is not null) toolbarSurface.Visibility = Visibility.Visible;
        _bookmarkBar.Visibility = _vm.Settings.BookmarkBarVisible ? Visibility.Visible : Visibility.Collapsed;
        _utilitySidebar.Visibility = _utilitySidebarVisibleBeforeFocus ? Visibility.Visible : Visibility.Collapsed;
        _copilotPanel.Visibility = _vm.IsCopilotOpen ? Visibility.Visible : Visibility.Collapsed;
        ApplyTabLayout();
        ShowStatus("Focus mode off", InfoBarSeverity.Success);
    }

    private async Task ToggleReaderModeAsync()
    {
        var tab = _vm.SelectedTab;
        var web = CurrentWebView();
        if (tab is null || web?.CoreWebView2 is null || !Uri.TryCreate(tab.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
        {
            ShowStatus("Reader mode is available on web pages.", InfoBarSeverity.Warning);
            return;
        }
        if (_readerTabs.Remove(tab.Id))
        {
            web.Reload();
            ShowStatus("Reader mode closed");
            return;
        }

        const string script = """
            (()=>{
              const source=document.querySelector('article')||document.querySelector('main');
              if(!source)return false;
              const copy=source.cloneNode(true);
              copy.querySelectorAll('script,style,nav,aside,form,button,input,select,textarea,iframe,[aria-hidden=true]').forEach(x=>x.remove());
              const title=(document.querySelector('h1')?.innerText||document.title||'Reader view').trim();
              document.head.innerHTML=`<meta name="viewport" content="width=device-width"><title>${title.replaceAll('<','&lt;')}</title><style>html{color-scheme:light dark}body{max-width:760px;margin:48px auto;padding:0 28px;font:19px/1.7 system-ui;color:CanvasText;background:Canvas}h1{font-size:2.1em;line-height:1.15}img,video{max-width:100%;height:auto}a{color:LinkText}pre{overflow:auto;padding:16px;background:color-mix(in srgb,CanvasText 8%,Canvas)}@media(max-width:700px){body{margin:24px auto;padding:0 18px;font-size:17px}}</style>`;
              document.body.replaceChildren(Object.assign(document.createElement('h1'),{textContent:title}),copy);
              return true;
            })()
            """;
        try
        {
            var result = await web.ExecuteScriptAsync(script);
            if (result == "true") { _readerTabs.Add(tab.Id); ShowStatus("Reader mode is on. Choose Reader mode again to exit.", InfoBarSeverity.Success); }
            else ShowStatus("No article content was detected on this page.", InfoBarSeverity.Warning);
        }
        catch { ShowStatus("Reader mode could not process this page.", InfoBarSeverity.Warning); }
    }

    private void TranslateCurrentPage()
    {
        var url = _vm.SelectedTab?.Url;
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
        {
            ShowStatus("Translation is available on web pages.", InfoBarSeverity.Warning);
            return;
        }
        var translated = $"https://translate.google.com/translate?sl=auto&tl=en&u={Uri.EscapeDataString(url)}";
        NewTab(translated, activate: !_vm.Settings.OpenLinksInBackground);
        ShowStatus(_vm.Settings.OpenLinksInBackground ? "Translation opened in a background tab" : "Opening translated page");
    }

    private void ToggleFullScreen()
    {
        var fullScreen = AppWindow.Presenter.Kind == AppWindowPresenterKind.FullScreen;
        AppWindow.SetPresenter(fullScreen ? AppWindowPresenterKind.Default : AppWindowPresenterKind.FullScreen);
    }
}

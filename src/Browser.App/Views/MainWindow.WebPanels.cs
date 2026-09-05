using Browser.Core.Settings;
using Browser.Core.Tabs;
using Browser.Core.Branding;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

public sealed partial class MainWindow
{
    private Task ShowWebPanelsAsync()
    {
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, MinHeight = 180 };
        foreach (var panel in _vm.Settings.WebPanels)
        {
            var captured = panel;
            list.Items.Add(new ListViewItem { Tag = captured, Content = ManagerRow(captured.Name, captured.Url) });
        }

        var open = ActionButton("Open panel", Symbol.OpenFile, async () =>
        {
            if (list.SelectedItem is ListViewItem { Tag: WebPanelDefinition panel }) await OpenWebPanelAsync(panel);
        });
        var add = ActionButton("Add website", Symbol.Add, async () =>
        {
            var name = new TextBox { Header = "Panel name", PlaceholderText = "Calendar", MaxLength = 32 };
            var url = new TextBox { Header = "Website URL", PlaceholderText = "https://calendar.example", MinWidth = 360 };
            var form = new StackPanel { Spacing = 10, Children = { name, url } };
            var dialog = new ContentDialog { Title = "Add website panel", Content = form, PrimaryButtonText = "Add", CloseButtonText = "Cancel", XamlRoot = _root.XamlRoot };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary || !Uri.TryCreate(url.Text.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            {
                if (!string.IsNullOrWhiteSpace(url.Text)) ShowStatus("Panels need a valid HTTP or HTTPS website.", InfoBarSeverity.Warning);
                return;
            }
            var item = new WebPanelDefinition(string.IsNullOrWhiteSpace(name.Text) ? uri.Host : name.Text.Trim(), uri.AbsoluteUri);
            _vm.Settings = SettingsValidator.Validate(_vm.Settings with { WebPanels = _vm.Settings.WebPanels.Append(item).ToArray() });
            if (!_isPrivate) await SaveSettingsSafeAsync();
            HidePage(); await OpenWebPanelAsync(item);
        });
        var remove = ActionButton("Remove", Symbol.Delete, async () =>
        {
            if (list.SelectedItem is not ListViewItem { Tag: WebPanelDefinition panel }) return;
            _vm.Settings = _vm.Settings with { WebPanels = _vm.Settings.WebPanels.Where(x => !x.Url.Equals(panel.Url, StringComparison.OrdinalIgnoreCase)).ToArray() };
            if (!_isPrivate) await SaveSettingsSafeAsync();
            if (_activeWebPanelUrl?.Equals(panel.Url, StringComparison.OrdinalIgnoreCase) == true) CloseWebPanel();
            HidePage(); await ShowWebPanelsAsync();
        });
        var close = ActionButton("Close panel", Symbol.Cancel, CloseWebPanel);
        var controls = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { open, add, remove, close } };
        var note = new TextBlock { Text = "Panels are floating website views. To protect RAM, Sutra keeps only the visible panel alive; switching or closing it releases its WebView. Panels use the current browser profile and never run Sutra Copilot.", TextWrapping = TextWrapping.Wrap, Opacity = .7 };
        var body = new StackPanel { Spacing = 12, Children = { note, controls, list } };
        ShowPage("Web panels", "Keep frequently used sites one click away without keeping a background tab for each.", body);
        return Task.CompletedTask;
    }

    private async Task OpenWebPanelAsync(WebPanelDefinition panel)
    {
        if (_activeWebPanelUrl?.Equals(panel.Url, StringComparison.OrdinalIgnoreCase) == true && _utilitySidebar.Visibility == Visibility.Visible) return;
        CloseWebPanel();
        var view = new WebView2 { HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
        var environment = await _environment.GetAsync();
        if (_isPrivate)
        {
            var options = environment.CreateCoreWebView2ControllerOptions(); options.ProfileName = AppBrand.PrivateProfileName; options.IsInPrivateModeEnabled = true;
            await view.EnsureCoreWebView2Async(environment, options);
        }
        else if (!_profileName.Equals("Default", StringComparison.OrdinalIgnoreCase))
        {
            var options = environment.CreateCoreWebView2ControllerOptions(); options.ProfileName = "Sutra-" + new string(_profileName.Where(char.IsLetterOrDigit).Take(50).ToArray());
            await view.EnsureCoreWebView2Async(environment, options);
        }
        else await view.EnsureCoreWebView2Async(environment);
        var core = view.CoreWebView2;
        core.Settings.IsPasswordAutosaveEnabled = false; core.Settings.IsGeneralAutofillEnabled = false; core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        var panelTab = new BrowserTab { Url = panel.Url, Title = panel.Name };
        core.WebResourceRequested += (_, e) => OnWebResourceRequested(panelTab, core, e);
        core.NewWindowRequested += (_, e) => { e.Handled = true; DispatcherQueue.TryEnqueue(() => NewTab(e.Uri, !_vm.Settings.OpenLinksInBackground)); };
        core.Navigate(panel.Url);
        var header = new Grid { Padding = new(10, 7, 6, 7) }; header.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        header.Children.Add(new TextBlock { Text = panel.Name, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
        var dismiss = new Button { Content = new SymbolIcon(Symbol.Cancel), Width = 28, Height = 28, Padding = new(0), CornerRadius = new(6) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(dismiss, "Close panel");
        ToolTipService.SetToolTip(dismiss, "Close panel");
        dismiss.Click += (_, _) => CloseWebPanel(); Grid.SetColumn(dismiss, 1); header.Children.Add(dismiss);
        var host = new Grid(); host.RowDefinitions.Add(new() { Height = GridLength.Auto }); host.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) }); host.Children.Add(header); Grid.SetRow(view, 1); host.Children.Add(view);
        _utilitySidebar.Child = host; _utilitySidebar.Visibility = Visibility.Visible; _contentGrid.ColumnDefinitions[2].Width = new GridLength(390);
        _webPanelView = view; _activeWebPanelUrl = panel.Url;
    }

    private void CloseWebPanel()
    {
        var view = _webPanelView; _webPanelView = null; _activeWebPanelUrl = null;
        // The panel replaces any native sidebar tabs, including Notes; drop the
        // stale list reference so later note refreshes cannot touch detached UI.
        _notesSidebarList = null;
        _utilitySidebar.Child = null; _utilitySidebar.Visibility = Visibility.Collapsed; _contentGrid.ColumnDefinitions[2].Width = new GridLength(0);
        if (view is null) return;
        try { view.Close(); } catch { }
    }
}

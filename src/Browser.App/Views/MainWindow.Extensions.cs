using Browser.Core.Branding;
using System.Text.Json;
using Browser.Core.Integration;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Pickers;

namespace Browser.App;

public sealed partial class MainWindow
{
    private async Task ShowExtensionsAsync()
    {
        if (_isPrivate) return;
        var core = CurrentWebView()?.CoreWebView2;
        if (core is null)
        {
            ShowStatus("Open a browser tab before managing extensions.", InfoBarSeverity.Informational);
            return;
        }

        var list = new StackPanel { Spacing = 8, MaxWidth = 720 };
        var summary = new TextBlock
        {
            Text = $"{AppBrand.Name} loads compatible extensions from folders already on this device. Review the permission list before installation. Web Store links do not install extensions.",
            TextWrapping = TextWrapping.Wrap,
            Opacity = .72
        };
        list.Children.Add(summary);
        var installed = new StackPanel { Spacing = 8 };
        list.Children.Add(installed);
        var refresh = new Button { Content = "Refresh list", CornerRadius = new(8) };
        var install = new Button { Content = "Install local extension folder", CornerRadius = new(8) };
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { install, refresh } };
        list.Children.Add(actions);

        async Task ReloadExtensionsAsync()
        {
            installed.Children.Clear();
            try
            {
                var extensions = await core.Profile.GetBrowserExtensionsAsync();
                if (extensions.Count == 0)
                {
                    installed.Children.Add(new TextBlock { Text = "No extensions installed in this profile.", Opacity = .62, Margin = new(0, 6, 0, 0) });
                    return;
                }
                foreach (var extension in extensions)
                {
                    var row = new Grid();
                    row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                    row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                    row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                    var text = new StackPanel { Spacing = 3 };
                    text.Children.Add(new TextBlock { Text = extension.Name, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis });
                    text.Children.Add(new TextBlock { Text = extension.Id, FontSize = 11, Opacity = .6, TextTrimming = TextTrimming.CharacterEllipsis });
                    Grid.SetColumn(text, 0); row.Children.Add(text);
                    var enabled = new ToggleSwitch { Header = "Enabled", IsOn = extension.IsEnabled, Margin = new(12, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center };
                    enabled.Toggled += async (_, _) =>
                    {
                        try { await extension.EnableAsync(enabled.IsOn); }
                        catch { ShowStatus("That extension could not be changed.", InfoBarSeverity.Warning); }
                    };
                    Grid.SetColumn(enabled, 1); row.Children.Add(enabled);
                    var remove = new Button { Content = "Remove", CornerRadius = new(7), VerticalAlignment = VerticalAlignment.Center };
                    remove.Click += async (_, _) =>
                    {
                        try { await extension.RemoveAsync(); await ReloadExtensionsAsync(); ShowStatus("Extension removed from this profile.", InfoBarSeverity.Success); }
                        catch { ShowStatus("That extension could not be removed.", InfoBarSeverity.Warning); }
                    };
                    Grid.SetColumn(remove, 2); row.Children.Add(remove);
                    installed.Children.Add(new Border { Padding = new(10), CornerRadius = new(8), Background = ResourceBrush("SutraCardBrush"), Child = row });
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Extension list failed: {ex.GetType().Name}");
                installed.Children.Add(new TextBlock { Text = "Extensions are unavailable in this WebView2 Runtime.", TextWrapping = TextWrapping.Wrap, Opacity = .72 });
            }
        }

        refresh.Click += async (_, _) => await ReloadExtensionsAsync();
        install.Click += async (_, _) => await InstallLocalExtensionAsync(core, ReloadExtensionsAsync);
        await ReloadExtensionsAsync();
        ShowPage("Extensions", "Manage extensions in the active browser profile.", new ScrollViewer { Content = list });
    }

    private async Task InstallLocalExtensionAsync(CoreWebView2 core, Func<Task> refresh)
    {
        var picker = new FolderPicker { SuggestedStartLocation = PickerLocationId.Downloads };
        picker.FileTypeFilter.Add("*");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var folder = await picker.PickSingleFolderAsync();
        if (folder is null) return;

        try
        {
            var manifestPath = Path.Combine(folder.Path, "manifest.json");
            var info = new FileInfo(manifestPath);
            if (!info.Exists || info.Length > BrowserExtensionManifestPolicy.MaximumManifestBytes)
            {
                ShowStatus("The selected folder has no readable extension manifest.", InfoBarSeverity.Warning);
                return;
            }
            var json = await File.ReadAllTextAsync(manifestPath);
            if (!BrowserExtensionManifestPolicy.TryParse(json, out var manifest) || manifest is null)
            {
                ShowStatus("That extension manifest is invalid or uses unsupported version metadata.", InfoBarSeverity.Warning);
                return;
            }

            var permissionText = manifest.Permissions.Count == 0
                ? "No permissions are listed in the manifest."
                : "Requested permissions:\n" + string.Join("\n", manifest.Permissions.Take(30).Select(x => "• " + x)) +
                  (manifest.Permissions.Count > 30 ? $"\n…and {manifest.Permissions.Count - 30} more" : "");
            var detail = new StackPanel { Spacing = 9, MaxWidth = 520 };
            detail.Children.Add(new TextBlock { Text = $"{manifest.Name} · version {manifest.Version}", FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
            detail.Children.Add(new TextBlock { Text = permissionText, TextWrapping = TextWrapping.Wrap, FontFamily = new FontFamily("Consolas") });
            detail.Children.Add(new TextBlock { Text = $"Extensions run with the permissions listed above and may read or change pages you visit. Only install folders you trust. {AppBrand.Name} does not verify the extension publisher.", TextWrapping = TextWrapping.Wrap, Opacity = .75 });
            var dialog = new ContentDialog { Title = "Install local extension?", Content = new ScrollViewer { Content = detail, MaxHeight = 420 }, PrimaryButtonText = "Install extension", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close, XamlRoot = _root.XamlRoot };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
            var extension = await core.Profile.AddBrowserExtensionAsync(folder.Path);
            await refresh();
            ShowStatus($"{extension.Name} was installed in this profile.", InfoBarSeverity.Success, 6000);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Local extension install failed: {ex.GetType().Name}");
            ShowStatus("The extension could not be installed. Check its local files and WebView2 compatibility.", InfoBarSeverity.Error, 7000);
        }
    }
}

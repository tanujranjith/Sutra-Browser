using System.Security.Cryptography;
using Browser.Data.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Browser.App;

public sealed partial class MainWindow
{
    private async Task OpenDownloadedFileAsync(DownloadRecord download)
    {
        try
        {
            if (!File.Exists(download.Destination)) { ShowStatus("This file was moved or removed. Use Retry source to download a new copy.", InfoBarSeverity.Warning); return; }
            if (!await Windows.System.Launcher.LaunchFileAsync(await Windows.Storage.StorageFile.GetFileFromPathAsync(download.Destination)))
                ShowStatus("Windows could not open this file. Choose an app that supports its file type.", InfoBarSeverity.Warning);
        }
        catch { ShowStatus("The file could not be opened. It may have moved or become unavailable.", InfoBarSeverity.Warning); }
    }

    private async Task OpenDownloadFolderAsync(DownloadRecord download)
    {
        try
        {
            var folder = Path.GetDirectoryName(download.Destination);
            if (!Directory.Exists(folder)) { ShowStatus("The download folder is no longer available.", InfoBarSeverity.Warning); return; }
            await Windows.System.Launcher.LaunchFolderAsync(await Windows.Storage.StorageFolder.GetFolderFromPathAsync(folder!));
        }
        catch { ShowStatus("Windows could not open the download folder.", InfoBarSeverity.Warning); }
    }

    private MainWindow? FindDownloadOwner(Guid id) => (_isPrivate ? new[] { this } : ((App)Application.Current).BrowserWindows.Where(x => !x._isPrivate && x._profileName.Equals(_profileName, StringComparison.OrdinalIgnoreCase)))
        .FirstOrDefault(x => !x._isWindowClosed && (x._activeDownloads.ContainsKey(id) || x._resumableDownloads.ContainsKey(id)));

    private void ControlDownload(Guid id, string action)
    {
        var owner = FindDownloadOwner(id);
        if (owner is null || !(owner._activeDownloads.TryGetValue(id, out var operation) || owner._resumableDownloads.TryGetValue(id, out operation)))
        { ShowStatus("This transfer is no longer active. Open the source to start again."); return; }
        try
        {
            if (action == "pause") { owner._pausedDownloads.Add(id); operation.Pause(); }
            else if (action == "resume" && operation.CanResume) { owner._pausedDownloads.Remove(id); operation.Resume(); }
            else if (action == "cancel") { owner._pausedDownloads.Remove(id); operation.Cancel(); }
            else ShowStatus("Resume is unavailable for this transfer. Open the source to start again.");
        }
        catch (Exception ex) { if (action == "pause") owner._pausedDownloads.Remove(id); System.Diagnostics.Debug.WriteLine($"Download control: {ex.GetType().Name}"); ShowStatus("The transfer state changed. Refresh and try again."); }
    }

    private async Task ShowDownloadChecksumAsync(DownloadRecord download)
    {
        if (download.State != "Completed") return;
        try
        {
            ShowStatus("Calculating the downloaded file's SHA-256…");
            await using var stream = new FileStream(download.Destination, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, _windowLifetimeCts.Token));
            if (_isWindowClosed) return;
            var expected = new TextBox { Header = "Expected SHA-256 (optional)", PlaceholderText = "Paste the hash supplied by the publisher", MaxLength = 64 };
            var result = new TextBlock { Text = "A matching hash verifies file contents, not publisher trust.", TextWrapping = TextWrapping.Wrap, Opacity = .72 };
            expected.TextChanged += (_, _) => result.Text = string.IsNullOrWhiteSpace(expected.Text) ? "A matching hash verifies file contents, not publisher trust." : expected.Text.Length != 64 || !expected.Text.All(Uri.IsHexDigit) ? "Enter exactly 64 hexadecimal characters." : expected.Text.Equals(hash, StringComparison.OrdinalIgnoreCase) ? "Match — the downloaded bytes have the expected SHA-256." : "Mismatch — these bytes do not match the expected SHA-256.";
            await new ContentDialog { Title = "Verify downloaded file", Content = new StackPanel { Spacing = 12, Children = {
                new TextBlock { Text = download.FileName, TextWrapping = TextWrapping.Wrap },
                new TextBox { Header = "SHA-256", Text = hash, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, MaxWidth = 520 }, expected, result
            } }, CloseButtonText = "Done", XamlRoot = _root.XamlRoot }.ShowAsync();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Download checksum: {ex.GetType().Name}"); if (!_isWindowClosed) ShowStatus("The file could not be read. It may have been moved, removed, or opened exclusively by another app.", InfoBarSeverity.Warning); }
    }
}

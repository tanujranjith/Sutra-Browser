using Microsoft.UI.Xaml.Controls;

namespace Browser.App;

public sealed partial class MainWindow
{
    internal async Task WaitForStartupContentAsync()
    {
        if (_isWindowClosed) return;
        var lifetimeToken = _windowLifetimeCts.Token;
        await _ready.Task.WaitAsync(TimeSpan.FromSeconds(45), lifetimeToken);
        // Let WebView2 account for the new renderer before the app samples system
        // pressure and decides whether another saved window can safely start.
        await Task.Delay(TimeSpan.FromMilliseconds(500), lifetimeToken);
    }

    internal void ShowMemoryRestoreDeferredMessage(int savedWindows)
    {
        if (savedWindows <= 0 || _isWindowClosed) return;
        DispatcherQueue.TryEnqueue(() =>
        {
            if (_isWindowClosed) return;
            var noun = savedWindows == 1 ? "window" : "windows";
            ShowStatus($"Sutra delayed {savedWindows} saved browser {noun} to keep startup responsive. They remain saved and will be retried next time Sutra starts.",
                InfoBarSeverity.Warning, 10000);
        });
    }
}

namespace Browser.Core.BrowserEngine;

public static class WebViewInitializationPolicy
{
    /// <summary>Rejects controllers completed after their tab or window has been retired.</summary>
    public static bool KeepCreatedControl(bool windowClosed, bool tabStillExists, bool initializationCancelled)
        => !windowClosed && tabStillExists && !initializationCancelled;
}

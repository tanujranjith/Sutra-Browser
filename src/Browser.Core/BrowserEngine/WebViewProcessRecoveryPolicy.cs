namespace Browser.Core.BrowserEngine;

public enum WebViewProcessRecoveryAction
{
    RecreateControl,
    ReloadTab,
    WaitForRenderer,
    Ignore
}

/// <summary>
/// Maps WebView2 process failures to the recovery that the runtime contract
/// requires. Most auxiliary processes restart themselves and must not turn a
/// working page into an error page.
/// </summary>
public static class WebViewProcessRecoveryPolicy
{
    public static WebViewProcessRecoveryAction Decide(string? processFailedKind) => processFailedKind switch
    {
        "BrowserProcessExited" => WebViewProcessRecoveryAction.RecreateControl,
        "RenderProcessExited" => WebViewProcessRecoveryAction.ReloadTab,
        "RenderProcessUnresponsive" => WebViewProcessRecoveryAction.WaitForRenderer,
        _ => WebViewProcessRecoveryAction.Ignore
    };
}

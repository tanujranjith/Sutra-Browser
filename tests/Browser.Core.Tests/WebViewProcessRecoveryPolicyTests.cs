using Browser.Core.BrowserEngine;
using Xunit;

namespace Browser.Core.Tests;

public sealed class WebViewProcessRecoveryPolicyTests
{
    [Theory]
    [InlineData("BrowserProcessExited", WebViewProcessRecoveryAction.RecreateControl)]
    [InlineData("RenderProcessExited", WebViewProcessRecoveryAction.ReloadTab)]
    [InlineData("RenderProcessUnresponsive", WebViewProcessRecoveryAction.WaitForRenderer)]
    [InlineData("GpuProcessExited", WebViewProcessRecoveryAction.Ignore)]
    [InlineData("UtilityProcessExited", WebViewProcessRecoveryAction.Ignore)]
    [InlineData("UnknownProcessExited", WebViewProcessRecoveryAction.Ignore)]
    [InlineData(null, WebViewProcessRecoveryAction.Ignore)]
    public void ClassifiesFailuresByRequiredRecovery(string? kind, WebViewProcessRecoveryAction expected)
    {
        Assert.Equal(expected, WebViewProcessRecoveryPolicy.Decide(kind));
    }
}

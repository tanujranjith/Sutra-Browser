using Browser.Core.BrowserEngine;
using Xunit;

namespace Browser.Core.Tests;

public sealed class WebViewInitializationPolicyTests
{
    [Theory]
    [InlineData(false, true, false, true)]
    [InlineData(true, true, false, false)]
    [InlineData(false, false, false, false)]
    [InlineData(false, true, true, false)]
    public void RetainsOnlyControlsWhoseTabAndWindowAreStillAlive(
        bool windowClosed,
        bool tabStillExists,
        bool initializationCancelled,
        bool expected)
    {
        Assert.Equal(expected, WebViewInitializationPolicy.KeepCreatedControl(windowClosed, tabStillExists, initializationCancelled));
    }
}

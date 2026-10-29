using Browser.Core.Diagnostics;
using Xunit;

namespace Browser.Core.Tests;

public sealed class PrivacySafeDiagnosticRecordTests
{
    [Fact]
    public void RecordContainsOnlyBoundedDiagnosticTokensAndNeverExceptionText()
    {
        const string privateValue = "https://private.example/path?token=do-not-log";
        var exception = new InvalidOperationException(privateValue);
        var record = PrivacySafeDiagnosticRecord.Create(
            DateTimeOffset.Parse("2026-10-04T12:00:00Z"),
            "ui callback",
            exception,
            "BrowserProcessExited");

        var json = record.ToJsonLine();

        Assert.Contains("InvalidOperationException", json);
        Assert.Contains("BrowserProcessExited", json);
        Assert.Contains(exception.HResult.ToString(System.Globalization.CultureInfo.InvariantCulture), json);
        Assert.DoesNotContain(privateValue, json);
        Assert.DoesNotContain("Message", json);
        Assert.DoesNotContain("StackTrace", json);
        Assert.DoesNotContain("private.example", json);
        Assert.True(json.Length < 512);
    }

    [Fact]
    public void RecordStripsArbitraryTextFromDiagnosticTokens()
    {
        var record = PrivacySafeDiagnosticRecord.Create(
            DateTimeOffset.UtcNow,
            "process exited\r\nsecret",
            code: "Render Process Exited / https://example.test");

        Assert.Equal("processexitedsecret", record.Category);
        Assert.Equal("RenderProcessExitedhttpsexample.test", record.Code);
        Assert.Null(record.ErrorType);
        Assert.Null(record.HResult);
    }
}

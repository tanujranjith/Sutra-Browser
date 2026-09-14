using Browser.Core.Downloads;
using Browser.Core.Sessions;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using Xunit;

namespace Browser.Core.Tests;

public sealed class SplitAndDownloadTests
{
    [Theory]
    [InlineData(SplitLayoutPreset.Stacked, 2, 1, 2)]
    [InlineData(SplitLayoutPreset.SideBySide, 2, 2, 1)]
    [InlineData(SplitLayoutPreset.FocusLeft, 3, 2, 2)]
    [InlineData(SplitLayoutPreset.Automatic, 8, 4, 2)]
    public void LayoutCellsFitWithoutOverlap(SplitLayoutPreset preset, int count, int columns, int rows)
    {
        var layout = SplitLayout.Create(count, preset); Assert.Equal(columns, layout.Columns); Assert.Equal(rows, layout.Rows);
        var occupied = new HashSet<(int, int)>();
        foreach (var cell in layout.Cells)
            for (var row = cell.Row; row < cell.Row + cell.RowSpan; row++)
            { Assert.InRange(cell.Column, 0, columns - 1); Assert.InRange(row, 0, rows - 1); Assert.True(occupied.Add((cell.Column, row))); }
        Assert.Equal(count, layout.Cells.Count);
    }

    [Fact]
    public void SessionPersistsLayoutAndRejectsUnknownPresets()
    {
        var tab = new BrowserTab { Url = "https://example.com" };
        var session = new BrowserSession([tab.ToSnapshot()], tab.Id, DateTimeOffset.UtcNow, SplitLayout: SplitLayoutPreset.Stacked);
        Assert.Equal(SplitLayoutPreset.Stacked, SessionSerializer.Deserialize(SessionSerializer.Serialize(session)).SplitLayout);
        Assert.Equal(SplitLayoutPreset.Automatic, SessionSerializer.Deserialize(SessionSerializer.Serialize(session with { SplitLayout = (SplitLayoutPreset)999 })).SplitLayout);
        Assert.Equal(0, new BrowserSettings().HistoryRetentionDays);
        Assert.Equal(3650, SettingsValidator.Validate(new() { HistoryRetentionDays = int.MaxValue }).HistoryRetentionDays);
        Assert.Equal(0, SettingsValidator.Validate(new() { HistoryRetentionDays = -1 }).HistoryRetentionDays);
    }

    [Fact]
    public void DownloadGuidanceDistinguishesPauseCancellationAndUntrustedFailures()
    {
        Assert.Equal("Paused", DownloadStatus.Describe("Paused", "UserCanceled").Label);
        Assert.Equal("Canceled", DownloadStatus.Describe("Interrupted", "UserCanceled").Label);
        Assert.Equal("Storage full", DownloadStatus.Describe("Interrupted", "FileNoSpace").Label);
        var unknown = DownloadStatus.Describe("Interrupted", "secret/path/untrusted-message");
        Assert.DoesNotContain("secret", unknown.Guidance); Assert.DoesNotContain("secret", unknown.Label);
        Assert.Contains("not supported", DownloadStatus.Describe("Interrupted", "UserShutdown").Guidance);
    }
}

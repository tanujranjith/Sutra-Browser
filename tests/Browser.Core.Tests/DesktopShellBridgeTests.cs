using System.Text.Json;
using Browser.Core.Integration;
using Xunit;

namespace Browser.Core.Tests;

public sealed class DesktopShellBridgeTests
{
    private static string Message(string action, object payload) => JsonSerializer.Serialize(new { version = 1, requestId = Guid.NewGuid(), action, payload });

    [Theory]
    [InlineData("today")]
    [InlineData("homework")]
    [InlineData("notes")]
    [InlineData("timeline")]
    [InlineData("apstudy")]
    [InlineData("collegeapp")]
    [InlineData("life")]
    [InlineData("assistantview")]
    [InlineData("settings")]
    public void WorkspaceNavigationIsAllowlisted(string view)
    {
        var message = Message("workspace.navigate", new { view });
        Assert.True(SutraBridgeProtocol.TryParse(SutraBridgeProtocol.TrustedOrigin, message, out _));
        Assert.False(SutraBridgeProtocol.TryParse("https://example.com", message, out _));
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://example.com")]
    [InlineData("../../settings")]
    [InlineData("")]
    public void ArbitraryWorkspaceDestinationsAreRejected(string view) =>
        Assert.False(SutraBridgeProtocol.TryParse(SutraBridgeProtocol.TrustedOrigin, Message("workspace.navigate", new { view }), out _));

    [Theory]
    [InlineData("workspace", "dark", true)]
    [InlineData("note", "light", true)]
    [InlineData("script", "dark", false)]
    [InlineData("note", "<style>", false)]
    public void PresentationHasNoArbitraryCssOrScript(string mode, string theme, bool valid) =>
        Assert.Equal(valid, SutraBridgeProtocol.TryParse(SutraBridgeProtocol.TrustedOrigin, Message("workspace.layout", new { mode, theme }), out _));

    [Theory]
    [InlineData("easy", true)]
    [InlineData("medium", true)]
    [InlineData("hard", true)]
    [InlineData("urgent", false)]
    public void HomeworkDifficultyIsValidated(string difficulty, bool valid) =>
        Assert.Equal(valid, SutraBridgeProtocol.TryParse(SutraBridgeProtocol.TrustedOrigin, Message("capture.homework", new { title = "Assignment", url = "https://school.example/assignment", difficulty }), out _));
}

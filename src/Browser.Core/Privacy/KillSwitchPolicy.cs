namespace Browser.Core.Privacy;

public static class KillSwitchPolicy
{
    public const string Command = "kill-switch";
    public const string LaunchArgument = "--kill-switch";

    public static bool IsLaunchRequested(IEnumerable<string> arguments) =>
        arguments.Any(value => string.Equals(value, LaunchArgument, StringComparison.OrdinalIgnoreCase));

    public static bool IsAutomaticSessionKey(string key) =>
        key is "browser.session" or "browser.cleanShutdown" or "browser.startupRecovery";
}

namespace Browser.Core.Integration;

public static class SutraDesktopStartupPolicy
{
    public static Guid ResolveWindowId(Guid? restoredWindowId) =>
        restoredWindowId is { } id && id != Guid.Empty ? id : Guid.NewGuid();

    public static bool ShouldOpenWorkspace(bool isPrivate, bool hasInitialUrl, bool hasLaunchSession, bool isInitialRestoredWindow) =>
        !isPrivate && !hasInitialUrl && (!hasLaunchSession || isInitialRestoredWindow);
}

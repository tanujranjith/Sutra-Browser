namespace Browser.Core.Privacy;

public enum PrivateDataKind
{
    History,
    SearchHistory,
    Session,
    RecentlyClosed,
    DownloadMetadata,
    PermissionDecision,
    AiActionLog,
    Password,
    Bookmark,
    DownloadedFile
}

public static class PrivateBrowsingPolicy
{
    public static bool PersistsAfterWindowCloses(PrivateDataKind kind) => kind is
        PrivateDataKind.Bookmark or PrivateDataKind.DownloadedFile;

    public static bool AllowsCredentialAccess => false;
    public static bool EnablesAiByDefault => false;
}

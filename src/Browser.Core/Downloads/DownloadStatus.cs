namespace Browser.Core.Downloads;

public sealed record DownloadStatus(string Label, string Guidance)
{
    public static DownloadStatus Describe(string state, string? error) => state switch
    {
        "Completed" => new("Completed", "Ready to open or verify."),
        "InProgress" => new("Downloading", ""),
        "Paused" => new("Paused", "Resume while this browser session remains open."),
        _ => error switch
        {
            "UserPaused" => new("Paused", "Resume while this browser session remains open."),
            "UserCanceled" => new("Canceled", "Open the source to start again."),
            "UserShutdown" or "DownloadProcessCrashed" => new("Session ended", "Open the source to restart. Resuming after restart is not supported."),
            "FileNoSpace" => new("Storage full", "Free disk space or choose another download folder, then retry."),
            "FileAccessDenied" or "FileTransientError" => new("File unavailable", "Check folder permissions and whether another app is using the file."),
            "FileNameTooLong" or "FileTooLarge" => new("File cannot be saved", "Choose a shorter path or a destination that supports this file size."),
            "FileMalicious" or "FileBlockedByPolicy" or "FileSecurityCheckFailed" => new("Security check stopped download", "Review the source and Windows security information before proceeding."),
            "NetworkFailed" or "NetworkTimeout" or "NetworkDisconnected" or "NetworkServerDown" => new("Connection interrupted", "Check your connection, then resume if available or retry the source."),
            "ServerUnauthorized" or "ServerForbidden" => new("Access required", "Open the source website and check that you are signed in and have access."),
            "ServerCertificateProblem" => new("Connection could not be verified", "Return to the website and check its security information."),
            "ServerNoRange" => new("Server cannot resume", "Restart from the source if the download does not restart automatically."),
            _ => new("Interrupted", "Resume if available, or open the source to start again.")
        }
    };
}

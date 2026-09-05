namespace Browser.Data.Models;

public sealed record HistoryEntry(long Id, string Url, string Title, string Domain, DateTimeOffset LastVisitedAt, int VisitCount, string? TypedQuery);
public sealed record Bookmark(long Id, long? FolderId, string Title, string Url, int SortOrder, DateTimeOffset CreatedAt);
public sealed record BookmarkFolder(long Id, long? ParentId, string Name, int SortOrder);
public sealed record DownloadRecord(Guid Id, string FileName, string SourceUrl, string Destination, DateTimeOffset StartedAt, string State, long BytesReceived, long? TotalBytes, string? Error);
public sealed record PasswordMetadataRecord(Guid Id, string Origin, string Username, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record PermissionRecord(string Origin, string Kind, string Decision, DateTimeOffset UpdatedAt);
public sealed record AiActionLogRecord(long Id, string ActionType, string Domain, DateTimeOffset Timestamp, string Result, bool ConfirmationRequired);
public sealed record WorkspaceRecord(long Id, string Name, string SessionJson, DateTimeOffset UpdatedAt);
public sealed record ReadingListRecord(long Id, string Title, string Url, bool IsRead, DateTimeOffset AddedAt);
public sealed record PageNoteRecord(long Id, string Url, string Quote, string Note, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

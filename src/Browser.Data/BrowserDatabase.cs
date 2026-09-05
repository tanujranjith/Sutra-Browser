using Microsoft.Data.Sqlite;

namespace Browser.Data;

public sealed class BrowserDatabase
{
    private readonly string _connectionString;
    public BrowserDatabase(string path)
    {
        var directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (directory is not null) Directory.CreateDirectory(directory);
        _connectionString = new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadWriteCreate, Cache = SqliteCacheMode.Shared }.ToString();
    }

    public SqliteConnection OpenConnection() => new(_connectionString);

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = OpenConnection();
        await connection.OpenAsync(cancellationToken);
        await ExecuteAsync(connection, "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;", cancellationToken);
        await ExecuteAsync(connection, "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);", cancellationToken);
        var current = Convert.ToInt32(await ScalarAsync(connection, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;", cancellationToken));
        foreach (var migration in Migrations.All.Where(x => x.Version > current).OrderBy(x => x.Version))
        {
            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
            try
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = migration.Sql;
                await command.ExecuteNonQueryAsync(cancellationToken);
                command.CommandText = "INSERT INTO schema_migrations(version, applied_at) VALUES($version, $at);";
                command.Parameters.Clear();
                command.Parameters.AddWithValue("$version", migration.Version);
                command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
                await command.ExecuteNonQueryAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
            catch
            {
                await transaction.RollbackAsync(cancellationToken);
                throw;
            }
        }
    }

    private static async Task ExecuteAsync(SqliteConnection connection, string sql, CancellationToken ct)
    { await using var command = connection.CreateCommand(); command.CommandText = sql; await command.ExecuteNonQueryAsync(ct); }
    private static async Task<object?> ScalarAsync(SqliteConnection connection, string sql, CancellationToken ct)
    { await using var command = connection.CreateCommand(); command.CommandText = sql; return await command.ExecuteScalarAsync(ct); }
}

public sealed record Migration(int Version, string Sql);

public static class Migrations
{
    public static IReadOnlyList<Migration> All { get; } =
    [
        new(1, """
            CREATE TABLE history (
              id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
              domain TEXT NOT NULL, last_visited_at TEXT NOT NULL, visit_count INTEGER NOT NULL DEFAULT 1,
              typed_query TEXT NULL);
            CREATE INDEX ix_history_last_visited ON history(last_visited_at DESC);
            CREATE INDEX ix_history_domain ON history(domain);
            CREATE TABLE bookmark_folders (
              id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NULL REFERENCES bookmark_folders(id) ON DELETE CASCADE,
              name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE bookmarks (
              id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id INTEGER NULL REFERENCES bookmark_folders(id) ON DELETE SET NULL,
              title TEXT NOT NULL, url TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
            CREATE INDEX ix_bookmarks_url ON bookmarks(url);
            CREATE INDEX ix_bookmarks_folder_order ON bookmarks(folder_id, sort_order);
            CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE recently_closed_tabs (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_json TEXT NOT NULL, closed_at TEXT NOT NULL);
            CREATE INDEX ix_recently_closed_at ON recently_closed_tabs(closed_at DESC);
            CREATE TABLE downloads (
              id TEXT PRIMARY KEY, file_name TEXT NOT NULL, source_url TEXT NOT NULL, destination TEXT NOT NULL,
              started_at TEXT NOT NULL, state TEXT NOT NULL, bytes_received INTEGER NOT NULL DEFAULT 0,
              total_bytes INTEGER NULL, error TEXT NULL);
            CREATE TABLE password_metadata (
              id TEXT PRIMARY KEY, origin TEXT NOT NULL, username TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(origin, username));
            CREATE INDEX ix_password_origin ON password_metadata(origin);
            CREATE TABLE site_permissions (
              origin TEXT NOT NULL, kind TEXT NOT NULL, decision TEXT NOT NULL, updated_at TEXT NOT NULL,
              PRIMARY KEY(origin, kind));
            CREATE TABLE ai_action_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT, action_type TEXT NOT NULL, domain TEXT NOT NULL,
              timestamp TEXT NOT NULL, result TEXT NOT NULL, confirmation_required INTEGER NOT NULL);
            CREATE INDEX ix_ai_log_timestamp ON ai_action_logs(timestamp DESC);
            """),
        new(2, "CREATE INDEX ix_history_title ON history(title); CREATE INDEX ix_history_typed_query ON history(typed_query);"),
        new(3, """
            CREATE TABLE workspaces (
              id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
              session_json TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE INDEX ix_workspaces_updated ON workspaces(updated_at DESC);
            CREATE TABLE reading_list (
              id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
              is_read INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL);
            CREATE INDEX ix_reading_list_state_added ON reading_list(is_read, added_at DESC);
            """)
        ,new(4, """
            CREATE TABLE page_notes (
              id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, quote TEXT NOT NULL DEFAULT '', note TEXT NOT NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE INDEX ix_page_notes_url ON page_notes(url);
            CREATE TABLE offline_articles (
              id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE, archive_path TEXT NOT NULL,
              saved_at TEXT NOT NULL);
            """)
    ];
}

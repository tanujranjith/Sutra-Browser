using Microsoft.Data.Sqlite;

namespace Browser.Data;

public sealed class BrowserDatabase
{
    private readonly string _connectionString;
    private long? _privacyEpoch;
    // An initialized writer keeps its original epoch for its entire lifetime.
    // A kill switch invalidates old writers, including those in another process.
    public long PrivacyEpoch => _privacyEpoch ?? throw new InvalidOperationException("Initialize the browser database before writing history or sessions.");
    public BrowserDatabase(string path, long? writerEpoch = null)
    {
        _privacyEpoch = writerEpoch;
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
        _privacyEpoch ??= Convert.ToInt64(await ScalarAsync(connection, "SELECT epoch FROM privacy_state WHERE id=1;", cancellationToken));
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
        ,new(5, """
            ALTER TABLE offline_articles ADD COLUMN content_text TEXT NOT NULL DEFAULT '';
            CREATE INDEX ix_offline_articles_saved ON offline_articles(saved_at DESC);
            """)
        ,new(6, """
            CREATE TABLE session_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT, window_id TEXT NOT NULL,
                profile_name TEXT NOT NULL, reason TEXT NOT NULL, session_json TEXT NOT NULL,
                fingerprint TEXT NOT NULL, saved_at TEXT NOT NULL);
            CREATE INDEX ix_session_snapshots_window ON session_snapshots(window_id,id DESC);
            """)
        ,new(7, """
            ALTER TABLE workspaces ADD COLUMN color TEXT NOT NULL DEFAULT '#F47A22';
            ALTER TABLE workspaces ADD COLUMN icon TEXT NOT NULL DEFAULT 'Folder';
            ALTER TABLE workspaces ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
            CREATE TABLE workspace_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL,
                name TEXT NOT NULL, session_json TEXT NOT NULL, color TEXT NOT NULL,
                icon TEXT NOT NULL, is_template INTEGER NOT NULL, reason TEXT NOT NULL, saved_at TEXT NOT NULL);
            CREATE INDEX ix_workspace_versions_workspace ON workspace_versions(workspace_id,id DESC);
            CREATE INDEX ix_downloads_started ON downloads(started_at DESC,id);
            """)
        ,new(8, """
            CREATE TABLE privacy_state (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL);
            INSERT INTO privacy_state(id,epoch) VALUES(1,0);
            """)
        ,new(9, """
            CREATE TABLE window_sessions (
                window_id TEXT PRIMARY KEY, profile_name TEXT NOT NULL,
                session_json TEXT NOT NULL, saved_at TEXT NOT NULL);
            CREATE INDEX ix_window_sessions_profile_saved ON window_sessions(profile_name, saved_at DESC);
            """)
        ,new(10, """
            CREATE VIRTUAL TABLE history_fts USING fts5(title, url, domain, typed_query, content='history', content_rowid='id', tokenize='porter');
            CREATE TRIGGER history_ai AFTER INSERT ON history BEGIN INSERT INTO history_fts(rowid,title,url,domain,typed_query) VALUES(new.id,new.title,new.url,new.domain,new.typed_query); END;
            CREATE TRIGGER history_ad AFTER DELETE ON history BEGIN INSERT INTO history_fts(history_fts,rowid,title,url,domain,typed_query) VALUES('delete',old.id,old.title,old.url,old.domain,old.typed_query); END;
            CREATE TRIGGER history_au AFTER UPDATE ON history BEGIN INSERT INTO history_fts(history_fts,rowid,title,url,domain,typed_query) VALUES('delete',old.id,old.title,old.url,old.domain,old.typed_query); INSERT INTO history_fts(rowid,title,url,domain,typed_query) VALUES(new.id,new.title,new.url,new.domain,new.typed_query); END;
            CREATE VIRTUAL TABLE bookmarks_fts USING fts5(title, url, content='bookmarks', content_rowid='id', tokenize='porter');
            CREATE TRIGGER bookmarks_ai AFTER INSERT ON bookmarks BEGIN INSERT INTO bookmarks_fts(rowid,title,url) VALUES(new.id,new.title,new.url); END;
            CREATE TRIGGER bookmarks_ad AFTER DELETE ON bookmarks BEGIN INSERT INTO bookmarks_fts(bookmarks_fts,rowid,title,url) VALUES('delete',old.id,old.title,old.url); END;
            CREATE TRIGGER bookmarks_au AFTER UPDATE ON bookmarks BEGIN INSERT INTO bookmarks_fts(bookmarks_fts,rowid,title,url) VALUES('delete',old.id,old.title,old.url); INSERT INTO bookmarks_fts(rowid,title,url) VALUES(new.id,new.title,new.url); END;
            CREATE VIRTUAL TABLE page_notes_fts USING fts5(url, quote, note, content='page_notes', content_rowid='id', tokenize='porter');
            CREATE TRIGGER page_notes_ai AFTER INSERT ON page_notes BEGIN INSERT INTO page_notes_fts(rowid,url,quote,note) VALUES(new.id,new.url,new.quote,new.note); END;
            CREATE TRIGGER page_notes_ad AFTER DELETE ON page_notes BEGIN INSERT INTO page_notes_fts(page_notes_fts,rowid,url,quote,note) VALUES('delete',old.id,old.url,old.quote,old.note); END;
            CREATE TRIGGER page_notes_au AFTER UPDATE ON page_notes BEGIN INSERT INTO page_notes_fts(page_notes_fts,rowid,url,quote,note) VALUES('delete',old.id,old.url,old.quote,old.note); INSERT INTO page_notes_fts(rowid,url,quote,note) VALUES(new.id,new.url,new.quote,new.note); END;
            CREATE VIRTUAL TABLE offline_articles_fts USING fts5(title, url, content_text, content='offline_articles', content_rowid='id', tokenize='porter');
            CREATE TRIGGER offline_articles_ai AFTER INSERT ON offline_articles BEGIN INSERT INTO offline_articles_fts(rowid,title,url,content_text) VALUES(new.id,new.title,new.url,new.content_text); END;
            CREATE TRIGGER offline_articles_ad AFTER DELETE ON offline_articles BEGIN INSERT INTO offline_articles_fts(offline_articles_fts,rowid,title,url,content_text) VALUES('delete',old.id,old.title,old.url,old.content_text); END;
            CREATE TRIGGER offline_articles_au AFTER UPDATE ON offline_articles BEGIN INSERT INTO offline_articles_fts(offline_articles_fts,rowid,title,url,content_text) VALUES('delete',old.id,old.title,old.url,old.content_text); INSERT INTO offline_articles_fts(rowid,title,url,content_text) VALUES(new.id,new.title,new.url,new.content_text); END;
            INSERT INTO history_fts(history_fts) VALUES('rebuild');
            INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('rebuild');
            INSERT INTO page_notes_fts(page_notes_fts) VALUES('rebuild');
            INSERT INTO offline_articles_fts(offline_articles_fts) VALUES('rebuild');
            """)
    ];
}

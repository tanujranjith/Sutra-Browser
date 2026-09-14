using Browser.Core.Notes;
using Browser.Data.Models;
using Microsoft.Data.Sqlite;

namespace Browser.Data.Repositories;

public sealed partial class WorkspaceRepository(BrowserDatabase database)
{
    public async Task SaveAsync(string name, string sessionJson, CancellationToken ct = default)
    {
        name = Browser.Core.Workspaces.WorkspacePolicy.Name(name);
        sessionJson = Browser.Core.Workspaces.WorkspacePolicy.SessionJson(sessionJson);
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        using var transaction = connection.BeginTransaction(deferred: false);
        await CaptureVersionAsync(connection, transaction, "name=$match", name, "Updated tabs", ct);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO workspaces(name,session_json,updated_at) VALUES($name,$session,$updated)
            ON CONFLICT(name) DO UPDATE SET session_json=excluded.session_json,updated_at=excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$name", name);
        command.Parameters.AddWithValue("$session", sessionJson);
        command.Parameters.AddWithValue("$updated", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct);
        transaction.Commit();
    }

    public async Task<IReadOnlyList<WorkspaceRecord>> ListAsync(CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id,name,session_json,updated_at,color,icon,is_template FROM workspaces ORDER BY updated_at DESC,id DESC";
        var result = new List<WorkspaceRecord>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), DateTimeOffset.Parse(reader.GetString(3)), reader.GetString(4), reader.GetString(5), reader.GetBoolean(6)));
        return result;
    }

    public async Task DeleteAsync(long id, CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        using var transaction = connection.BeginTransaction(deferred: false);
        await CaptureVersionAsync(connection, transaction, "id=$match", id, "Deleted workspace", ct);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM workspaces WHERE id=$id";
        command.Parameters.AddWithValue("$id", id);
        await command.ExecuteNonQueryAsync(ct);
        transaction.Commit();
    }
}

public sealed class ReadingListRepository(BrowserDatabase database)
{
    public async Task AddAsync(string title, string url, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ArgumentException("Reading-list URL must be HTTP or HTTPS.", nameof(url));
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO reading_list(title,url,is_read,added_at) VALUES($title,$url,0,$added)
            ON CONFLICT(url) DO UPDATE SET title=excluded.title,is_read=0;
            """;
        command.Parameters.AddWithValue("$title", string.IsNullOrWhiteSpace(title) ? uri.Host : title.Trim());
        command.Parameters.AddWithValue("$url", uri.AbsoluteUri);
        command.Parameters.AddWithValue("$added", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<IReadOnlyList<ReadingListRecord>> SearchAsync(string query = "", CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id,title,url,is_read,added_at FROM reading_list WHERE $q='' OR title LIKE $like OR url LIKE $like ORDER BY is_read,added_at DESC";
        command.Parameters.AddWithValue("$q", query);
        command.Parameters.AddWithValue("$like", $"%{query}%");
        var result = new List<ReadingListRecord>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3) != 0, DateTimeOffset.Parse(reader.GetString(4))));
        return result;
    }

    public Task SetReadAsync(long id, bool isRead, CancellationToken ct = default) => ExecuteAsync("UPDATE reading_list SET is_read=$state WHERE id=$id", id, isRead, ct);
    public Task DeleteAsync(long id, CancellationToken ct = default) => ExecuteAsync("DELETE FROM reading_list WHERE id=$id", id, false, ct);

    private async Task ExecuteAsync(string sql, long id, bool state, CancellationToken ct)
    {
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$state", state ? 1 : 0);
        await command.ExecuteNonQueryAsync(ct);
    }
}

public sealed class PageNoteRepository(BrowserDatabase database)
{
    private const int DefaultSearchLimit = 100;
    private const int MaxListLimit = 200;
    private const int MaxPageNotes = 200;

    public async Task<long> AddAsync(string url, string quote, string note, CancellationToken ct = default)
    {
        var target = NoteTargets.Normalize(url);
        quote = NoteTargets.ClampQuote(quote);
        note = ValidateNote(note);
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO page_notes(url,quote,note,created_at,updated_at) VALUES($url,$quote,$note,$at,$at);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("$url", target);
        command.Parameters.AddWithValue("$quote", quote);
        command.Parameters.AddWithValue("$note", note);
        command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        var id = await command.ExecuteScalarAsync(ct);
        return Convert.ToInt64(id);
    }

    /// <summary>Updates a note's quotation and body. created_at is preserved and updated_at is refreshed.</summary>
    public async Task<bool> UpdateAsync(long id, string quote, string note, CancellationToken ct = default)
    {
        quote = NoteTargets.ClampQuote(quote);
        note = ValidateNote(note);
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE page_notes SET quote=$quote,note=$note,updated_at=$at WHERE id=$id";
        command.Parameters.AddWithValue("$quote", quote);
        command.Parameters.AddWithValue("$note", note);
        command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        return await command.ExecuteNonQueryAsync(ct) > 0;
    }

    public async Task<bool> DeleteAsync(long id, CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM page_notes WHERE id=$id";
        command.Parameters.AddWithValue("$id", id);
        return await command.ExecuteNonQueryAsync(ct) > 0;
    }

    /// <summary>Lists the notes attached to one normalized page target.</summary>
    public async Task<IReadOnlyList<PageNoteRecord>> ListForPageAsync(string url, CancellationToken ct = default)
    {
        var target = NoteTargets.Normalize(url);
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT id,url,quote,note,created_at,updated_at FROM page_notes WHERE url=$url ORDER BY updated_at DESC LIMIT {MaxPageNotes}";
        command.Parameters.AddWithValue("$url", target);
        return await ReadNotesAsync(command, ct);
    }

    public async Task<PageNoteRecord?> GetAsync(long id, CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id,url,quote,note,created_at,updated_at FROM page_notes WHERE id=$id";
        command.Parameters.AddWithValue("$id", id);
        var notes = await ReadNotesAsync(command, ct);
        return notes.Count == 0 ? null : notes[0];
    }

    /// <summary>
    /// Searches notes across pages with a bounded result count. The query matches
    /// URL, quotation, and note text; empty queries list recent notes.
    /// </summary>
    public async Task<IReadOnlyList<PageNoteRecord>> SearchAsync(string query = "", int limit = DefaultSearchLimit, CancellationToken ct = default)
    {
        return await SearchPagedAsync(query, 0, Math.Clamp(limit, 1, MaxListLimit), ct);
    }

    public async Task<IReadOnlyList<PageNoteRecord>> SearchPagedAsync(string query = "", int offset = 0, int limit = 50, CancellationToken ct = default)
    {
        offset = Math.Clamp(offset, 0, 100_000);
        limit = Math.Clamp(limit, 1, MaxListLimit);
        query = (query ?? string.Empty).Trim();
        if (query.Length > NoteTargets.MaxUrlLength) return [];
        var match = query.IndexOfAny(['%', '_', '\\', '"']) < 0 ? FtsQuery.Build(query) : null;
        if (match is not null)
        {
            try
            {
                await using var connection = database.OpenConnection();
                await connection.OpenAsync(ct);
                await using var command = connection.CreateCommand();
                command.CommandText = """
                    SELECT n.id,n.url,n.quote,n.note,n.created_at,n.updated_at FROM page_notes n
                    JOIN page_notes_fts ON n.id = page_notes_fts.rowid
                    WHERE page_notes_fts MATCH $match
                    ORDER BY bm25(page_notes_fts), n.updated_at DESC LIMIT $limit OFFSET $offset;
                    """;
                command.Parameters.AddWithValue("$match", match);
                command.Parameters.AddWithValue("$limit", limit);
                command.Parameters.AddWithValue("$offset", offset);
                return await ReadNotesAsync(command, ct);
            }
            catch { }
        }
        await using var fallback = database.OpenConnection();
        await fallback.OpenAsync(ct);
        await using var cmd = fallback.CreateCommand();
        cmd.CommandText = $"""
            SELECT id,url,quote,note,created_at,updated_at FROM page_notes
            WHERE $q='' OR url LIKE $like ESCAPE '{LikeEscapeCharacter}' OR quote LIKE $like ESCAPE '{LikeEscapeCharacter}' OR note LIKE $like ESCAPE '{LikeEscapeCharacter}'
            ORDER BY updated_at DESC LIMIT $limit OFFSET $offset
            """;
        cmd.Parameters.AddWithValue("$q", query);
        cmd.Parameters.AddWithValue("$like", $"%{EscapeLikePattern(query)}%");
        cmd.Parameters.AddWithValue("$limit", limit);
        cmd.Parameters.AddWithValue("$offset", offset);
        return await ReadNotesAsync(cmd, ct);
    }

    private const string LikeEscapeCharacter = @"\";

    /// <summary>
    /// Escapes SQLite LIKE wildcards for use with an explicit ESCAPE clause:
    /// the escape character first, then % and _. Never SQL-Server-style brackets;
    /// SQLite treats those as literal text.
    /// </summary>
    private static string EscapeLikePattern(string value) => value
        .Replace(LikeEscapeCharacter, LikeEscapeCharacter + LikeEscapeCharacter)
        .Replace("%", LikeEscapeCharacter + "%")
        .Replace("_", LikeEscapeCharacter + "_");

    private static string ValidateNote(string note)
    {
        if (string.IsNullOrWhiteSpace(note)) throw new ArgumentException("A note cannot be empty.", nameof(note));
        note = note.Trim();
        if (note.Length > NoteTargets.MaxNoteLength)
            throw new ArgumentException($"A note cannot exceed {NoteTargets.MaxNoteLength} characters.", nameof(note));
        return note;
    }

    private static async Task<List<PageNoteRecord>> ReadNotesAsync(SqliteCommand command, CancellationToken ct)
    {
        var result = new List<PageNoteRecord>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            result.Add(new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), DateTimeOffset.Parse(reader.GetString(4)), DateTimeOffset.Parse(reader.GetString(5))));
        return result;
    }
}

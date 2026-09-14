using Browser.Data.Models;

namespace Browser.Data.Repositories;

public sealed class BookmarkRepository(BrowserDatabase database)
{
    public async Task<long> AddAsync(string title, string url, long? folderId = null, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out _)) throw new ArgumentException("Bookmark URL must be absolute.", nameof(url));
        await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = """
            INSERT INTO bookmarks(folder_id,title,url,sort_order,created_at)
            VALUES($folder,$title,$url,COALESCE((SELECT MAX(sort_order)+1 FROM bookmarks WHERE folder_id IS $folder),0),$at);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$folder", (object?)folderId ?? DBNull.Value); cmd.Parameters.AddWithValue("$title", title.Trim());
        cmd.Parameters.AddWithValue("$url", url); cmd.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct));
    }

    public async Task<long> AddFolderAsync(string name, long? parentId = null, CancellationToken ct = default)
    {
        await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO bookmark_folders(parent_id,name,sort_order) VALUES($parent,$name,COALESCE((SELECT MAX(sort_order)+1 FROM bookmark_folders WHERE parent_id IS $parent),0)); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$parent", (object?)parentId ?? DBNull.Value); cmd.Parameters.AddWithValue("$name", name.Trim());
        return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct));
    }

    public async Task<IReadOnlyList<Bookmark>> SearchAsync(string query = "", CancellationToken ct = default, int limit = 1000)
    {
        return await SearchPagedAsync(query, 0, Math.Clamp(limit, 1, 10000), ct);
    }

    public async Task<IReadOnlyList<Bookmark>> SearchPagedAsync(string query = "", int offset = 0, int limit = 50, CancellationToken ct = default)
    {
        offset = Math.Clamp(offset, 0, 100_000);
        limit = Math.Clamp(limit, 1, 200);
        var match = query.IndexOfAny(['%', '_', '\\', '"']) < 0 ? FtsQuery.Build(query) : null;
        if (match is not null)
        {
            try
            {
                await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
                await using var command = connection.CreateCommand();
                command.CommandText = """
                    SELECT b.id,b.folder_id,b.title,b.url,b.sort_order,b.created_at FROM bookmarks b
                    JOIN bookmarks_fts ON b.id = bookmarks_fts.rowid
                    WHERE bookmarks_fts MATCH $match
                    ORDER BY bm25(bookmarks_fts), b.folder_id, b.sort_order, b.id LIMIT $limit OFFSET $offset;
                    """;
                command.Parameters.AddWithValue("$match", match);
                command.Parameters.AddWithValue("$limit", limit);
                command.Parameters.AddWithValue("$offset", offset);
                var ranked = new List<Bookmark>(); await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) ranked.Add(new(reader.GetInt64(0), reader.IsDBNull(1) ? null : reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4), DateTimeOffset.Parse(reader.GetString(5))));
                return ranked;
            }
            catch { }
        }
        await using var fallback = database.OpenConnection(); await fallback.OpenAsync(ct); await using var cmd = fallback.CreateCommand();
        var escaped = Browser.Core.Search.PagedQueryPolicy.EscapeLike(query);
        cmd.CommandText = "SELECT id,folder_id,title,url,sort_order,created_at FROM bookmarks WHERE $query='' OR title LIKE $like ESCAPE '\\' OR url LIKE $like ESCAPE '\\' ORDER BY folder_id,sort_order,id LIMIT $limit OFFSET $offset";
        cmd.Parameters.AddWithValue("$query", query); cmd.Parameters.AddWithValue("$like", $"%{escaped}%");
        cmd.Parameters.AddWithValue("$limit", limit); cmd.Parameters.AddWithValue("$offset", offset);
        var items = new List<Bookmark>(); await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) items.Add(new(r.GetInt64(0), r.IsDBNull(1) ? null : r.GetInt64(1), r.GetString(2), r.GetString(3), r.GetInt32(4), DateTimeOffset.Parse(r.GetString(5))));
        return items;
    }

    public async Task<IReadOnlyList<BookmarkFolder>> ListFoldersAsync(CancellationToken ct = default)
    {
        await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id,parent_id,name,sort_order FROM bookmark_folders ORDER BY parent_id,sort_order,id";
        var items = new List<BookmarkFolder>(); await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) items.Add(new(reader.GetInt64(0), reader.IsDBNull(1) ? null : reader.GetInt64(1), reader.GetString(2), reader.GetInt32(3)));
        return items;
    }

    public async Task MoveBeforeAsync(long id, long beforeId, bool folder = false, CancellationToken ct = default)
    {
        if (id == beforeId) return;
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        using var transaction = connection.BeginTransaction(deferred: false);
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        // Identifiers come only from this boolean, never from a drag payload.
        var table = folder ? "bookmark_folders" : "bookmarks";
        var parent = folder ? "parent_id" : "folder_id";
        command.CommandText = $"SELECT id FROM {table} WHERE {parent} IS NULL ORDER BY sort_order,id";
        var ids = new List<long>();
        await using (var reader = await command.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) ids.Add(reader.GetInt64(0));
        if (!ids.Contains(id) || !ids.Contains(beforeId)) return;
        ids.Remove(id); ids.Insert(ids.IndexOf(beforeId), id);
        command.CommandText = $"UPDATE {table} SET sort_order=$order WHERE id=$id";
        var order = command.Parameters.Add("$order", Microsoft.Data.Sqlite.SqliteType.Integer);
        var item = command.Parameters.Add("$id", Microsoft.Data.Sqlite.SqliteType.Integer);
        for (var i = 0; i < ids.Count; i++) { order.Value = i; item.Value = ids[i]; await command.ExecuteNonQueryAsync(ct); }
        await transaction.CommitAsync(ct);
    }

    public async Task UpdateAsync(long id, string title, string url, long? folderId, int sortOrder, CancellationToken ct = default)
    { await ExecuteAsync("UPDATE bookmarks SET title=$title,url=$url,folder_id=$folder,sort_order=$sort WHERE id=$id", id, title, url, folderId, sortOrder, ct); }
    public async Task DeleteAsync(long id, CancellationToken ct = default)
    { await ExecuteAsync("DELETE FROM bookmarks WHERE id=$id", id, "", "", null, 0, ct); }

    public async Task DeleteAllAsync(CancellationToken ct = default)
    {
        await using var c = database.OpenConnection();
        await c.OpenAsync(ct);
        await using var transaction = c.BeginTransaction();
        await using var bookmarks = c.CreateCommand();
        bookmarks.Transaction = transaction;
        bookmarks.CommandText = "DELETE FROM bookmarks";
        await bookmarks.ExecuteNonQueryAsync(ct);
        await using var folders = c.CreateCommand();
        folders.Transaction = transaction;
        folders.CommandText = "DELETE FROM bookmark_folders";
        await folders.ExecuteNonQueryAsync(ct);
        transaction.Commit();
    }

    public async Task UpdateFolderAsync(long id, string name, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Folder name is required.", nameof(name));
        await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE bookmark_folders SET name=$name WHERE id=$id";
        cmd.Parameters.AddWithValue("$id", id); cmd.Parameters.AddWithValue("$name", name.Trim());
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task DeleteFolderAsync(long id, CancellationToken ct = default)
    {
        await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM bookmark_folders WHERE id=$id";
        cmd.Parameters.AddWithValue("$id", id);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task ExecuteAsync(string sql, long id, string title, string url, long? folder, int sort, CancellationToken ct)
    { await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand(); cmd.CommandText = sql; cmd.Parameters.AddWithValue("$id", id); cmd.Parameters.AddWithValue("$title", title); cmd.Parameters.AddWithValue("$url", url); cmd.Parameters.AddWithValue("$folder", (object?)folder ?? DBNull.Value); cmd.Parameters.AddWithValue("$sort", sort); await cmd.ExecuteNonQueryAsync(ct); }
}

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
        await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id,folder_id,title,url,sort_order,created_at FROM bookmarks WHERE $query='' OR title LIKE $like OR url LIKE $like ORDER BY folder_id,sort_order,id LIMIT $limit";
        cmd.Parameters.AddWithValue("$query", query); cmd.Parameters.AddWithValue("$like", $"%{query}%"); cmd.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 10000));
        var items = new List<Bookmark>(); await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) items.Add(new(reader.GetInt64(0), reader.IsDBNull(1) ? null : reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4), DateTimeOffset.Parse(reader.GetString(5))));
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

using Browser.Core.Reading;
using Microsoft.Data.Sqlite;

namespace Browser.Data.Repositories;

public sealed record OfflineArticle(long Id, string Title, string Url, DateTimeOffset SavedAt, int Characters, string Text = "");

public sealed class OfflineArticleRepository(BrowserDatabase database)
{
    public async Task SaveAsync(string title, string url, string text, CancellationToken ct = default)
    {
        url = OfflineArticlePolicy.NormalizeUrl(url);
        text = OfflineArticlePolicy.ValidateText(text);
        title = OfflineArticlePolicy.NormalizeTitle(title, url);
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        // The quota check and write share an immediate transaction, including across windows.
        using var transaction = connection.BeginTransaction(deferred: false);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*),COALESCE(SUM(length(content_text)),0) FROM offline_articles WHERE url<>$url";
        command.Parameters.AddWithValue("$url", url);
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            await reader.ReadAsync(ct);
            if (reader.GetInt64(0) >= OfflineArticlePolicy.MaximumArticles || reader.GetInt64(1) + text.Length > OfflineArticlePolicy.MaximumLibraryCharacters)
                throw new InvalidOperationException("The offline library is full. Remove an article before saving another.");
        }
        command.CommandText = """
            INSERT INTO offline_articles(title,url,archive_path,saved_at,content_text) VALUES($title,$url,'',$at,$text)
            ON CONFLICT(url) DO UPDATE SET title=excluded.title,saved_at=excluded.saved_at,content_text=excluded.content_text;
            """;
        command.Parameters.AddWithValue("$title", title);
        command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$text", text);
        await command.ExecuteNonQueryAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<OfflineArticle>> SearchAsync(string query = "", CancellationToken ct = default)
    {
        return await SearchPagedAsync(query, 0, 50, ct);
    }

    public async Task<IReadOnlyList<OfflineArticle>> SearchPagedAsync(string query = "", int offset = 0, int limit = 50, CancellationToken ct = default)
    {
        offset = Math.Clamp(offset, 0, 100_000);
        limit = Math.Clamp(limit, 1, 200);
        query = (query ?? string.Empty).Trim();
        if (query.Length > 200) query = query[..200];
        var match = query.IndexOfAny(['%', '_', '\\', '"']) < 0 ? FtsQuery.Build(query) : null;
        if (match is not null)
        {
            try
            {
                await using var connection = database.OpenConnection();
                await connection.OpenAsync(ct);
                await using var command = connection.CreateCommand();
                command.CommandText = """
                    SELECT a.id,a.title,a.url,a.saved_at,length(a.content_text) FROM offline_articles a
                    JOIN offline_articles_fts ON a.id = offline_articles_fts.rowid
                    WHERE a.content_text<>'' AND offline_articles_fts MATCH $match
                    ORDER BY bm25(offline_articles_fts), a.saved_at DESC LIMIT $limit OFFSET $offset;
                    """;
                command.Parameters.AddWithValue("$match", match);
                command.Parameters.AddWithValue("$limit", limit);
                command.Parameters.AddWithValue("$offset", offset);
                var ranked = new List<OfflineArticle>();
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) ranked.Add(new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), DateTimeOffset.Parse(reader.GetString(3)), reader.GetInt32(4)));
                return ranked;
            }
            catch { }
        }
        await using var fallback = database.OpenConnection();
        await fallback.OpenAsync(ct);
        await using var cmd = fallback.CreateCommand();
        cmd.CommandText = """
            SELECT id,title,url,saved_at,length(content_text) FROM offline_articles
            WHERE content_text<>'' AND ($q='' OR instr(lower(title),lower($q))>0 OR instr(lower(url),lower($q))>0 OR instr(lower(content_text),lower($q))>0)
            ORDER BY saved_at DESC LIMIT $limit OFFSET $offset;
            """;
        cmd.Parameters.AddWithValue("$q", query);
        cmd.Parameters.AddWithValue("$limit", limit);
        cmd.Parameters.AddWithValue("$offset", offset);
        var result = new List<OfflineArticle>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) result.Add(new(r.GetInt64(0), r.GetString(1), r.GetString(2), DateTimeOffset.Parse(r.GetString(3)), r.GetInt32(4)));
        return result;
    }

    public async Task<OfflineArticle?> GetAsync(long id, CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id,title,url,saved_at,length(content_text),content_text FROM offline_articles WHERE id=$id AND content_text<>''";
        command.Parameters.AddWithValue("$id", id);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), DateTimeOffset.Parse(reader.GetString(3)), reader.GetInt32(4), reader.GetString(5)) : null;
    }

    public async Task DeleteAsync(long id, CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM offline_articles WHERE id=$id";
        command.Parameters.AddWithValue("$id", id);
        await command.ExecuteNonQueryAsync(ct);
    }
}

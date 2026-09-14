using Browser.Data.Models;

namespace Browser.Data.Repositories;

public sealed class HistoryRepository(BrowserDatabase database)
{
    public async Task RecordVisitAsync(string url, string title, string? typedQuery = null, CancellationToken ct = default)
    {
        // A URL can legally contain HTTP Basic credentials. Never persist those credentials
        // in browsing history (or expose them through history search).
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo)) return;
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO history(url,title,domain,last_visited_at,visit_count,typed_query)
            SELECT $url,$title,$domain,$at,1,$query
            WHERE (SELECT epoch FROM privacy_state WHERE id=1)=$epoch
            ON CONFLICT(url) DO UPDATE SET title=excluded.title, domain=excluded.domain,
              last_visited_at=excluded.last_visited_at, visit_count=history.visit_count+1,
              typed_query=COALESCE(excluded.typed_query, history.typed_query);
            """;
        command.Parameters.AddWithValue("$url", url); command.Parameters.AddWithValue("$title", title);
        command.Parameters.AddWithValue("$domain", uri.Host); command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$query", (object?)typedQuery ?? DBNull.Value);
        command.Parameters.AddWithValue("$epoch", database.PrivacyEpoch);
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<IReadOnlyList<HistoryEntry>> SearchAsync(string query = "", DateTimeOffset? from = null, DateTimeOffset? to = null, int limit = 100, CancellationToken ct = default)
    {
        var (offset, take) = (0, Math.Clamp(limit, 1, 1000));
        return await SearchPagedAsync(query, from, to, offset, take, ct);
    }

    public async Task<IReadOnlyList<HistoryEntry>> SearchPagedAsync(string query = "", DateTimeOffset? from = null, DateTimeOffset? to = null, int offset = 0, int limit = 50, CancellationToken ct = default)
    {
        offset = Math.Clamp(offset, 0, 100_000);
        limit = Math.Clamp(limit, 1, 200);
        // LIKE wildcards must stay literal: FTS tokenizes them away, so queries containing
        // %, _, \ or quotes always use the escaped LIKE path.
        var match = query.IndexOfAny(['%', '_', '\\', '"']) < 0 ? FtsQuery.Build(query) : null;
        if (match is not null)
        {
            try
            {
                await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
                await using var command = connection.CreateCommand();
                command.CommandText = """
                    SELECT h.id,h.url,h.title,h.domain,h.last_visited_at,h.visit_count,h.typed_query FROM history h
                    JOIN history_fts ON h.id = history_fts.rowid
                    WHERE history_fts MATCH $match
                      AND ($from IS NULL OR h.last_visited_at >= $from) AND ($to IS NULL OR h.last_visited_at <= $to)
                    ORDER BY bm25(history_fts), h.last_visited_at DESC LIMIT $limit OFFSET $offset;
                    """;
                command.Parameters.AddWithValue("$match", match);
                command.Parameters.AddWithValue("$from", (object?)from?.ToString("O") ?? DBNull.Value);
                command.Parameters.AddWithValue("$to", (object?)to?.ToString("O") ?? DBNull.Value);
                command.Parameters.AddWithValue("$limit", limit);
                command.Parameters.AddWithValue("$offset", offset);
                var ranked = new List<HistoryEntry>(); await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) ranked.Add(new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), DateTimeOffset.Parse(reader.GetString(4)), reader.GetInt32(5), reader.IsDBNull(6) ? null : reader.GetString(6)));
                return ranked;
            }
            catch { }
        }
        await using var fallback = database.OpenConnection(); await fallback.OpenAsync(ct);
        await using var cmd = fallback.CreateCommand();
        cmd.CommandText = """
            SELECT id,url,title,domain,last_visited_at,visit_count,typed_query FROM history
            WHERE ($query='' OR title LIKE $like ESCAPE '\' OR url LIKE $like ESCAPE '\' OR domain LIKE $like ESCAPE '\' OR typed_query LIKE $like ESCAPE '\')
              AND ($from IS NULL OR last_visited_at >= $from) AND ($to IS NULL OR last_visited_at <= $to)
            ORDER BY last_visited_at DESC LIMIT $limit OFFSET $offset;
            """;
        var escaped = query.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
        cmd.Parameters.AddWithValue("$query", query); cmd.Parameters.AddWithValue("$like", $"%{escaped}%");
        cmd.Parameters.AddWithValue("$from", (object?)from?.ToString("O") ?? DBNull.Value); cmd.Parameters.AddWithValue("$to", (object?)to?.ToString("O") ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$limit", limit);
        cmd.Parameters.AddWithValue("$offset", offset);
        var result = new List<HistoryEntry>(); await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) result.Add(new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), DateTimeOffset.Parse(r.GetString(4)), r.GetInt32(5), r.IsDBNull(6) ? null : r.GetString(6)));
        return result;
    }

    public Task DeleteAsync(long id, CancellationToken ct = default) => ExecuteAsync("DELETE FROM history WHERE id=$value", id, ct);
    public Task DeleteDomainAsync(string domain, CancellationToken ct = default) => ExecuteAsync("DELETE FROM history WHERE domain=$value", domain, ct);
    public Task ClearSinceAsync(DateTimeOffset since, CancellationToken ct = default) => ExecuteAsync("DELETE FROM history WHERE last_visited_at >= $value", since.ToString("O"), ct);
    public Task ClearAllAsync(CancellationToken ct = default) => ExecuteAsync("DELETE FROM history", null, ct);
    public Task DeleteOlderThanAsync(DateTimeOffset cutoff, CancellationToken ct = default) => ExecuteAsync("DELETE FROM history WHERE last_visited_at < $value", cutoff.ToUniversalTime().ToString("O"), ct);

    private async Task ExecuteAsync(string sql, object? value, CancellationToken ct)
    { await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand(); cmd.CommandText = sql; if (value is not null) cmd.Parameters.AddWithValue("$value", value); await cmd.ExecuteNonQueryAsync(ct); }
}

using Browser.Data.Models;

namespace Browser.Data.Repositories;

public sealed partial class DownloadRepository
{
    public async Task<IReadOnlyList<DownloadRecord>> SearchAsync(string query = "", string? state = null, int offset = 0, int limit = 51, CancellationToken ct = default)
    {
        query = (query ?? "").Trim(); if (query.Length > 160) query = query[..160];
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id,file_name,source_url,destination,started_at,state,bytes_received,total_bytes,error
            FROM downloads WHERE ($q='' OR instr(lower(file_name),lower($q))>0 OR instr(lower(source_url),lower($q))>0)
            AND ($state IS NULL OR state=$state) ORDER BY started_at DESC,id LIMIT $limit OFFSET $offset
            """;
        command.Parameters.AddWithValue("$q", query); command.Parameters.AddWithValue("$state", (object?)state ?? DBNull.Value);
        command.Parameters.AddWithValue("$offset", Math.Max(0, offset)); command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 201));
        var result = new List<DownloadRecord>(); await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(new(Guid.Parse(reader.GetString(0)), reader.GetString(1), reader.GetString(2), reader.GetString(3),
            DateTimeOffset.Parse(reader.GetString(4)), reader.GetString(5), reader.GetInt64(6), reader.IsDBNull(7) ? null : reader.GetInt64(7), reader.IsDBNull(8) ? null : reader.GetString(8)));
        return result;
    }
}

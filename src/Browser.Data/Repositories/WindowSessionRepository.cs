using Browser.Core.Sessions;

namespace Browser.Data.Repositories;

/// <summary>
/// Automatic multi-window sessions (#2). One row per normal window; private
/// windows never write here. Every write is fenced by the kill-switch epoch so
/// old processes cannot resurrect cleared windows, and deletions are explicit
/// (window closed) rather than inferred.
/// </summary>
public sealed class WindowSessionRepository(BrowserDatabase database)
{
    public const int MaximumWindowsPerProfile = 10;
    public const int MaximumWindowsGlobal = 100;

    public async Task SaveAsync(Guid windowId, string profileName, BrowserSession session, CancellationToken ct = default)
    {
        if (windowId == Guid.Empty) return;
        profileName = string.IsNullOrWhiteSpace(profileName) ? "Default" : profileName.Trim();
        // Private windows must never gain ordinary persistence, even if a caller forgets the guard.
        if (profileName.Equals("Private", StringComparison.OrdinalIgnoreCase)) return;
        session = MultiWindowSessionPolicy.WithoutTemporary(session);
        if (session.Tabs.Count == 0)
        {
            await DeleteAsync(windowId, ct);
            return;
        }
        var json = SessionSerializer.Serialize(session);
        if (json.Length > SessionSerializer.MaximumJsonCharacters) return;
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        using var transaction = connection.BeginTransaction(deferred: false);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT epoch FROM privacy_state WHERE id=1";
        if (Convert.ToInt64(await command.ExecuteScalarAsync(ct)) != database.PrivacyEpoch) return;
        command.CommandText = """
            INSERT INTO window_sessions(window_id, profile_name, session_json, saved_at)
            VALUES($window, $profile, $json, $at)
            ON CONFLICT(window_id) DO UPDATE SET profile_name=excluded.profile_name, session_json=excluded.session_json, saved_at=excluded.saved_at;
            """;
        command.Parameters.AddWithValue("$window", windowId.ToString());
        command.Parameters.AddWithValue("$profile", profileName);
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct);
        // Bounded retention: newest N per profile plus a global cap. Kill-switch rows are never trimmed here;
        // trimming only removes older automatic windows and never touches explicit workspaces/bookmarks.
        command.CommandText = """
            DELETE FROM window_sessions WHERE window_id IN (
              SELECT window_id FROM window_sessions WHERE profile_name=$profile ORDER BY saved_at DESC LIMIT -1 OFFSET 10);
            DELETE FROM window_sessions WHERE window_id NOT IN (
              SELECT window_id FROM window_sessions ORDER BY saved_at DESC LIMIT 100);
            """;
        await command.ExecuteNonQueryAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task DeleteAsync(Guid windowId, CancellationToken ct = default)
    {
        if (windowId == Guid.Empty) return;
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM window_sessions WHERE window_id=$window";
        command.Parameters.AddWithValue("$window", windowId.ToString());
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<IReadOnlyList<MultiWindowSessionPolicy.SavedWindow>> ListForProfileAsync(string profileName, CancellationToken ct = default)
    {
        profileName = string.IsNullOrWhiteSpace(profileName) ? "Default" : profileName.Trim();
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT window_id, profile_name, session_json, saved_at FROM window_sessions WHERE profile_name=$profile ORDER BY saved_at DESC LIMIT 10";
        command.Parameters.AddWithValue("$profile", profileName);
        var result = new List<MultiWindowSessionPolicy.SavedWindow>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            if (!Guid.TryParse(reader.GetString(0), out var windowId) || windowId == Guid.Empty) continue;
            var session = SessionSerializer.Deserialize(reader.GetString(2));
            DateTimeOffset savedAt;
            try { savedAt = DateTimeOffset.Parse(reader.GetString(3)); } catch { savedAt = DateTimeOffset.UtcNow; }
            result.Add(new(windowId, reader.GetString(1), session, savedAt));
        }
        return result;
    }

    public async Task<IReadOnlyList<MultiWindowSessionPolicy.SavedWindow>> ListAllAsync(CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT window_id, profile_name, session_json, saved_at FROM window_sessions ORDER BY saved_at DESC LIMIT 100";
        var result = new List<MultiWindowSessionPolicy.SavedWindow>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            if (!Guid.TryParse(reader.GetString(0), out var windowId) || windowId == Guid.Empty) continue;
            var session = SessionSerializer.Deserialize(reader.GetString(2));
            DateTimeOffset savedAt;
            try { savedAt = DateTimeOffset.Parse(reader.GetString(3)); } catch { savedAt = DateTimeOffset.UtcNow; }
            result.Add(new(windowId, reader.GetString(1), session, savedAt));
        }
        return result;
    }
}

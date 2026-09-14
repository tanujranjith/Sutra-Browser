using System.Security.Cryptography;
using System.Text;
using Browser.Core.Sessions;

namespace Browser.Data.Repositories;

public sealed record SessionSnapshotRecord(long Id, string ProfileName, string Reason, string SessionJson, DateTimeOffset SavedAt);

public sealed class SessionSnapshotRepository(BrowserDatabase database)
{
    public async Task SaveAsync(Guid windowId, string profileName, BrowserSession session, string reason = "Automatic", CancellationToken ct = default)
    {
        // Normalize every snapshot through the same untrusted-session boundary used by imports.
        session = SessionSerializer.Deserialize(SessionSerializer.Serialize(session));
        if (session.Tabs.Count == 0) return;
        var json = SessionSerializer.Serialize(session);
        if (json.Length > 2_000_000) return;
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(SessionSerializer.Serialize(session with { SavedAt = DateTimeOffset.UnixEpoch }))));
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        using var transaction = connection.BeginTransaction(deferred: false);
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT epoch FROM privacy_state WHERE id=1";
        if (Convert.ToInt64(await command.ExecuteScalarAsync(ct)) != database.PrivacyEpoch) return;
        command.CommandText = "SELECT fingerprint FROM session_snapshots WHERE window_id=$window ORDER BY id DESC LIMIT 1";
        command.Parameters.AddWithValue("$window", windowId.ToString());
        if (await command.ExecuteScalarAsync(ct) as string == fingerprint) return;
        command.CommandText = "INSERT INTO session_snapshots(window_id,profile_name,reason,session_json,fingerprint,saved_at) VALUES($window,$profile,$reason,$json,$hash,$at)";
        command.Parameters.AddWithValue("$profile", profileName);
        command.Parameters.AddWithValue("$reason", reason);
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$hash", fingerprint);
        command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct);
        command.CommandText = """
            DELETE FROM session_snapshots WHERE window_id=$window AND id NOT IN
                (SELECT id FROM session_snapshots WHERE window_id=$window ORDER BY id DESC LIMIT 10);
            DELETE FROM session_snapshots WHERE id NOT IN (SELECT id FROM session_snapshots ORDER BY id DESC LIMIT 100);
            """;
        await command.ExecuteNonQueryAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<SessionSnapshotRecord>> ListAsync(CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id,profile_name,reason,session_json,saved_at FROM session_snapshots ORDER BY id DESC LIMIT 100";
        var result = new List<SessionSnapshotRecord>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), DateTimeOffset.Parse(reader.GetString(4))));
        return result;
    }
}

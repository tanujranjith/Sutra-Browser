namespace Browser.Data.Repositories;

/// <summary>Atomically clears automatic browsing records and fences out older writers.</summary>
public sealed class KillSwitchRepository(BrowserDatabase database)
{
    public async Task ClearAsync(long request, CancellationToken ct = default)
    {
        if (request <= 0) throw new ArgumentOutOfRangeException(nameof(request));
        await using var connection = database.OpenConnection();
        await connection.OpenAsync(ct);
        using var transaction = connection.BeginTransaction(deferred: false);
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT epoch FROM privacy_state WHERE id=1";
        // Retrying cleanup must not delete browsing from a later launch, or roll
        // the barrier back when two processes observe successive requests.
        if (Convert.ToInt64(await command.ExecuteScalarAsync(ct)) >= request) return;
        command.CommandText = """
            UPDATE privacy_state SET epoch=$epoch WHERE id=1;
            DELETE FROM history;
            DELETE FROM recently_closed_tabs;
            DELETE FROM session_snapshots;
            DELETE FROM window_sessions;
            DELETE FROM app_state WHERE key IN ('browser.session','browser.cleanShutdown','browser.startupRecovery');
            """;
        command.Parameters.AddWithValue("$epoch", request);
        await command.ExecuteNonQueryAsync(ct);
        await transaction.CommitAsync(ct);
    }
}

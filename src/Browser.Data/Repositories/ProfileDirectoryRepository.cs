using System.Text.Json;
using Browser.Core.Profiles;
using Browser.Core.Settings;
using Microsoft.Data.Sqlite;

namespace Browser.Data.Repositories;

/// <summary>The global profile directory is independent of per-window settings snapshots.</summary>
public sealed class ProfileDirectoryRepository(BrowserDatabase database)
{
    private const string StorageKey = "browser.profileDirectory";

    public async Task<IReadOnlyList<string>> ListAsync(CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        return await ReadAsync(connection, null, ct);
    }

    public async Task<IReadOnlyList<string>> AddAsync(string name, CancellationToken ct = default)
    {
        name = ProfileIdentity.Normalize(name);
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        using var transaction = connection.BeginTransaction(deferred: false);
        var names = (await ReadAsync(connection, transaction, ct)).ToList();
        if (!names.Contains(name, StringComparer.OrdinalIgnoreCase))
        {
            if (names.Count >= 32) throw new InvalidOperationException("The profile directory is full.");
            names.Add(name);
        }
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "INSERT INTO app_state(key,value,updated_at) VALUES($key,$value,$at) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at";
        command.Parameters.AddWithValue("$key", StorageKey);
        command.Parameters.AddWithValue("$value", JsonSerializer.Serialize(names));
        command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct); transaction.Commit();
        return names;
    }

    private static async Task<IReadOnlyList<string>> ReadAsync(SqliteConnection connection, SqliteTransaction? transaction, CancellationToken ct)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT value FROM app_state WHERE key=$key";
        command.Parameters.AddWithValue("$key", StorageKey);
        var json = await command.ExecuteScalarAsync(ct) as string;
        string[]? names;
        try
        {
            if (json is not null) names = JsonSerializer.Deserialize<string[]>(json);
            else
            {
                command.Parameters["$key"].Value = "browser.settings";
                names = JsonSerializer.Deserialize<BrowserSettings>(await command.ExecuteScalarAsync(ct) as string ?? "{}")?.WebProfiles;
            }
        }
        catch (JsonException) { names = null; }
        var result = new List<string> { "Default" };
        foreach (var candidate in names ?? [])
        {
            try
            {
                var name = ProfileIdentity.Normalize(candidate);
                if (!result.Contains(name, StringComparer.OrdinalIgnoreCase)) result.Add(name);
            }
            catch (ArgumentException) { }
        }
        return result;
    }
}

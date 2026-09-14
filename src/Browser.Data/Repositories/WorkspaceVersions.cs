using Browser.Core.Workspaces;
using Browser.Data.Models;
using Microsoft.Data.Sqlite;

namespace Browser.Data.Repositories;

public sealed partial class WorkspaceRepository
{
    private static async Task CaptureVersionAsync(SqliteConnection connection, SqliteTransaction transaction, string predicate, object match, string reason, CancellationToken ct)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        // Predicate comes only from the two constant internal call sites, never from user data.
        command.CommandText = $"""
            INSERT INTO workspace_versions(workspace_id,name,session_json,color,icon,is_template,reason,saved_at)
            SELECT id,name,session_json,color,icon,is_template,$reason,$at FROM workspaces WHERE {predicate};
            DELETE FROM workspace_versions WHERE id IN (
                SELECT id FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY workspace_id ORDER BY id DESC) AS ordinal FROM workspace_versions) WHERE ordinal>20);
            DELETE FROM workspace_versions WHERE id NOT IN (SELECT id FROM workspace_versions ORDER BY id DESC LIMIT 200);
            """;
        command.Parameters.AddWithValue("$match", match); command.Parameters.AddWithValue("$reason", reason);
        command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O")); await command.ExecuteNonQueryAsync(ct);
    }

    public async Task UpdateDetailsAsync(long id, string name, string color, string icon, bool isTemplate, CancellationToken ct = default)
    {
        name = WorkspacePolicy.Name(name); color = WorkspacePolicy.Color(color); icon = WorkspacePolicy.Icon(icon);
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        using var transaction = connection.BeginTransaction(deferred: false);
        await CaptureVersionAsync(connection, transaction, "id=$match", id, "Edited details", ct);
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "UPDATE workspaces SET name=$name,color=$color,icon=$icon,is_template=$template,updated_at=$at WHERE id=$id";
        command.Parameters.AddWithValue("$name", name); command.Parameters.AddWithValue("$color", color); command.Parameters.AddWithValue("$icon", icon);
        command.Parameters.AddWithValue("$template", isTemplate); command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O")); command.Parameters.AddWithValue("$id", id);
        await command.ExecuteNonQueryAsync(ct); transaction.Commit();
    }

    public async Task<IReadOnlyList<WorkspaceVersion>> VersionsAsync(long? workspaceId = null, CancellationToken ct = default)
    {
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id,workspace_id,name,session_json,color,icon,is_template,reason,saved_at FROM workspace_versions WHERE $id IS NULL OR workspace_id=$id ORDER BY id DESC LIMIT 200";
        command.Parameters.AddWithValue("$id", (object?)workspaceId ?? DBNull.Value);
        var result = new List<WorkspaceVersion>(); await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(new(reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetString(5), reader.GetBoolean(6), reader.GetString(7), DateTimeOffset.Parse(reader.GetString(8))));
        return result;
    }

    public async Task RestoreCopyAsync(long versionId, string name, CancellationToken ct = default)
    {
        name = WorkspacePolicy.Name(name);
        await using var connection = database.OpenConnection(); await connection.OpenAsync(ct);
        using var transaction = connection.BeginTransaction(deferred: false);
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT session_json FROM workspace_versions WHERE id=$id"; command.Parameters.AddWithValue("$id", versionId);
        var json = await command.ExecuteScalarAsync(ct) as string ?? throw new InvalidOperationException("That version is no longer available.");
        json = WorkspacePolicy.SessionJson(json);
        command.CommandText = "INSERT INTO workspaces(name,session_json,updated_at,color,icon,is_template) SELECT $name,$json,$at,color,icon,is_template FROM workspace_versions WHERE id=$id";
        command.Parameters.AddWithValue("$name", name); command.Parameters.AddWithValue("$json", json); command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct); transaction.Commit();
    }
}

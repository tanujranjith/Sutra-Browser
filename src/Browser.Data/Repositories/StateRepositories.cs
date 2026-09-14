using System.Text.Json;
using Browser.Core.Settings;
using Browser.Core.Sessions;
using Browser.Data.Models;

namespace Browser.Data.Repositories;

public sealed class AppStateRepository(BrowserDatabase database)
{
    public async Task SetAsync(string key, string value, CancellationToken ct = default)
    {
        await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO app_state(key,value,updated_at) SELECT $key,$value,$at WHERE $unrestricted=1 OR (SELECT epoch FROM privacy_state WHERE id=1)=$epoch ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at";
        var automatic = Browser.Core.Privacy.KillSwitchPolicy.IsAutomaticSessionKey(key);
        cmd.Parameters.AddWithValue("$unrestricted", automatic ? 0 : 1);
        cmd.Parameters.AddWithValue("$epoch", automatic ? database.PrivacyEpoch : -1);
        cmd.Parameters.AddWithValue("$key", key); cmd.Parameters.AddWithValue("$value", value); cmd.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O")); await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task<string?> GetAsync(string key, CancellationToken ct = default)
    { await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand(); cmd.CommandText = "SELECT value FROM app_state WHERE key=$key"; cmd.Parameters.AddWithValue("$key", key); return await cmd.ExecuteScalarAsync(ct) as string; }
}

public sealed class SessionRepository(AppStateRepository state)
{
    public Task SaveAsync(BrowserSession session, CancellationToken ct = default) => state.SetAsync("browser.session", SessionSerializer.Serialize(session), ct);
    public async Task<BrowserSession> LoadAsync(CancellationToken ct = default) => SessionSerializer.Deserialize(await state.GetAsync("browser.session", ct));
}

public sealed class SettingsRepository(AppStateRepository state)
{
    public Task SaveAsync(BrowserSettings settings, CancellationToken ct = default) => state.SetAsync("browser.settings", JsonSerializer.Serialize(SettingsValidator.Validate(settings)), ct);
    public async Task<BrowserSettings> LoadAsync(CancellationToken ct = default)
    {
        try { return SettingsValidator.Validate(JsonSerializer.Deserialize<BrowserSettings>(await state.GetAsync("browser.settings", ct) ?? "{}")); }
        catch (JsonException) { return new(); }
    }
}

public sealed class PasswordMetadataRepository(BrowserDatabase database)
{
    public async Task UpsertAsync(PasswordMetadataRecord item, CancellationToken ct = default)
    {
        await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO password_metadata(id,origin,username,created_at,updated_at) VALUES($id,$origin,$username,$created,$updated) ON CONFLICT(id) DO UPDATE SET origin=excluded.origin,username=excluded.username,updated_at=excluded.updated_at";
        cmd.Parameters.AddWithValue("$id", item.Id.ToString()); cmd.Parameters.AddWithValue("$origin", item.Origin); cmd.Parameters.AddWithValue("$username", item.Username); cmd.Parameters.AddWithValue("$created", item.CreatedAt.ToString("O")); cmd.Parameters.AddWithValue("$updated", item.UpdatedAt.ToString("O")); await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task<IReadOnlyList<PasswordMetadataRecord>> SearchAsync(string query = "", CancellationToken ct = default)
    {
        await using var c = database.OpenConnection(); await c.OpenAsync(ct); await using var cmd = c.CreateCommand(); cmd.CommandText = "SELECT id,origin,username,created_at,updated_at FROM password_metadata WHERE $q='' OR origin LIKE $like OR username LIKE $like ORDER BY origin,username"; cmd.Parameters.AddWithValue("$q", query); cmd.Parameters.AddWithValue("$like", $"%{query}%");
        var items = new List<PasswordMetadataRecord>(); await using var r = await cmd.ExecuteReaderAsync(ct); while(await r.ReadAsync(ct)) items.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.GetString(2),DateTimeOffset.Parse(r.GetString(3)),DateTimeOffset.Parse(r.GetString(4)))); return items;
    }
    public async Task DeleteAsync(Guid id, CancellationToken ct = default) { await using var c=database.OpenConnection(); await c.OpenAsync(ct); await using var cmd=c.CreateCommand(); cmd.CommandText="DELETE FROM password_metadata WHERE id=$id"; cmd.Parameters.AddWithValue("$id",id.ToString()); await cmd.ExecuteNonQueryAsync(ct); }
}

public sealed partial class DownloadRepository(BrowserDatabase database)
{
    public async Task UpsertAsync(DownloadRecord item, CancellationToken ct = default)
    {
        await using var c=database.OpenConnection(); await c.OpenAsync(ct); await using var cmd=c.CreateCommand(); cmd.CommandText="""
        INSERT INTO downloads(id,file_name,source_url,destination,started_at,state,bytes_received,total_bytes,error)
        VALUES($id,$file,$source,$destination,$started,$state,$received,$total,$error)
        ON CONFLICT(id) DO UPDATE SET state=excluded.state,bytes_received=excluded.bytes_received,total_bytes=excluded.total_bytes,error=excluded.error,destination=excluded.destination;
        """;
        cmd.Parameters.AddWithValue("$id",item.Id.ToString());cmd.Parameters.AddWithValue("$file",item.FileName);cmd.Parameters.AddWithValue("$source",item.SourceUrl);cmd.Parameters.AddWithValue("$destination",item.Destination);cmd.Parameters.AddWithValue("$started",item.StartedAt.ToString("O"));cmd.Parameters.AddWithValue("$state",item.State);cmd.Parameters.AddWithValue("$received",item.BytesReceived);cmd.Parameters.AddWithValue("$total",(object?)item.TotalBytes??DBNull.Value);cmd.Parameters.AddWithValue("$error",(object?)item.Error??DBNull.Value);await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task<IReadOnlyList<DownloadRecord>> ListAsync(CancellationToken ct=default)
    {
        await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT id,file_name,source_url,destination,started_at,state,bytes_received,total_bytes,error FROM downloads ORDER BY started_at DESC";var items=new List<DownloadRecord>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))items.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.GetString(2),r.GetString(3),DateTimeOffset.Parse(r.GetString(4)),r.GetString(5),r.GetInt64(6),r.IsDBNull(7)?null:r.GetInt64(7),r.IsDBNull(8)?null:r.GetString(8)));return items;
    }
    public async Task DeleteAsync(Guid id,CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="DELETE FROM downloads WHERE id=$id";cmd.Parameters.AddWithValue("$id",id.ToString());await cmd.ExecuteNonQueryAsync(ct);}
    public async Task ClearAsync(CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="DELETE FROM downloads";await cmd.ExecuteNonQueryAsync(ct);}
}

public sealed class PermissionRepository(BrowserDatabase database)
{
    public async Task SetAsync(PermissionRecord item,CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="INSERT INTO site_permissions(origin,kind,decision,updated_at) VALUES($o,$k,$d,$u) ON CONFLICT(origin,kind) DO UPDATE SET decision=excluded.decision,updated_at=excluded.updated_at";cmd.Parameters.AddWithValue("$o",item.Origin);cmd.Parameters.AddWithValue("$k",item.Kind);cmd.Parameters.AddWithValue("$d",item.Decision);cmd.Parameters.AddWithValue("$u",item.UpdatedAt.ToString("O"));await cmd.ExecuteNonQueryAsync(ct);}
    public async Task<string?> GetAsync(string origin,string kind,CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT decision FROM site_permissions WHERE origin=$o AND kind=$k";cmd.Parameters.AddWithValue("$o",origin);cmd.Parameters.AddWithValue("$k",kind);return await cmd.ExecuteScalarAsync(ct) as string;}
    public async Task ClearAsync(CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="DELETE FROM site_permissions";await cmd.ExecuteNonQueryAsync(ct);}
    public async Task DeleteOriginAsync(string origin,CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="DELETE FROM site_permissions WHERE origin=$origin";cmd.Parameters.AddWithValue("$origin",origin);await cmd.ExecuteNonQueryAsync(ct);}
    public async Task<IReadOnlyList<PermissionRecord>> ListForOriginAsync(string origin,CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT origin,kind,decision,updated_at FROM site_permissions WHERE origin=$origin ORDER BY kind";cmd.Parameters.AddWithValue("$origin",origin);var items=new List<PermissionRecord>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))items.Add(new(r.GetString(0),r.GetString(1),r.GetString(2),DateTimeOffset.Parse(r.GetString(3))));return items;}
    public async Task<IReadOnlyList<PermissionRecord>> ListAllAsync(CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT origin,kind,decision,updated_at FROM site_permissions ORDER BY origin,kind";var items=new List<PermissionRecord>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))items.Add(new(r.GetString(0),r.GetString(1),r.GetString(2),DateTimeOffset.Parse(r.GetString(3))));return items;}
    public async Task DeleteAsync(string origin,string kind,CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="DELETE FROM site_permissions WHERE origin=$origin AND kind=$kind";cmd.Parameters.AddWithValue("$origin",origin);cmd.Parameters.AddWithValue("$kind",kind);await cmd.ExecuteNonQueryAsync(ct);}
}

public sealed class AiActionLogRepository(BrowserDatabase database)
{
    public async Task AddAsync(string actionType,string domain,string result,bool confirmationRequired,CancellationToken ct=default){await using var c=database.OpenConnection();await c.OpenAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="INSERT INTO ai_action_logs(action_type,domain,timestamp,result,confirmation_required) VALUES($a,$d,$t,$r,$c)";cmd.Parameters.AddWithValue("$a",actionType);cmd.Parameters.AddWithValue("$d",domain);cmd.Parameters.AddWithValue("$t",DateTimeOffset.UtcNow.ToString("O"));cmd.Parameters.AddWithValue("$r",result);cmd.Parameters.AddWithValue("$c",confirmationRequired?1:0);await cmd.ExecuteNonQueryAsync(ct);}
}

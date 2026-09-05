using Browser.Core.Passwords;
using Browser.Data.Models;
using Browser.Data.Repositories;

namespace Browser.Platform.Windows.Security;

public sealed class CredentialService(ISecureCredentialStore secrets, PasswordMetadataRepository metadata)
{
    public async Task<Guid> SaveAsync(string origin, string username, string password, Guid? id = null, CancellationToken ct = default)
    {
        var normalized = CredentialOrigin.Normalize(origin); var credentialId = id ?? Guid.NewGuid(); var now = DateTimeOffset.UtcNow;
        await secrets.SaveAsync(credentialId, new(username, password), ct);
        try { await metadata.UpsertAsync(new(credentialId, normalized, username, now, now), ct); }
        catch { await secrets.DeleteAsync(credentialId, ct); throw; }
        return credentialId;
    }

    public async Task<CredentialSecret?> GetForOriginAsync(Guid id, Uri page, CancellationToken ct = default)
    {
        var item = (await metadata.SearchAsync("", ct)).SingleOrDefault(x => x.Id == id);
        return item is not null && CredentialOrigin.IsExactMatch(item.Origin, page) ? await secrets.GetAsync(id, ct) : null;
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    { await secrets.DeleteAsync(id, ct); await metadata.DeleteAsync(id, ct); }
}


using Browser.Core.Passwords;
using Browser.Core.Profiles;
using Browser.Data;
using Browser.Data.Repositories;
using Browser.Platform.Windows.Security;
using Browser.Platform.Windows.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace Browser.App;

/// <summary>Website controllers still use the shared environment. Only Sutra libraries are scoped here.</summary>
internal sealed class ProfileLibraries(IServiceProvider defaults)
{
    private readonly Dictionary<string, Task<IServiceProvider>> _profiles = new(StringComparer.OrdinalIgnoreCase);

    public Task<IServiceProvider> GetAsync(string name)
    {
        name = ProfileIdentity.Normalize(name);
        if (name == "Default") return Task.FromResult(defaults);
        if (_profiles.TryGetValue(name, out var existing)) return existing;
        var created = CreateAsync(name);
        _profiles.Add(name, created);
        return created;
    }

    private async Task<IServiceProvider> CreateAsync(string name)
    {
        var root = defaults.GetRequiredService<BrowserPaths>().Root;
        var directory = Path.Combine(root, "Libraries", ProfileIdentity.DirectoryKey(name));
        var epoch = defaults.GetRequiredService<BrowserDatabase>().PrivacyEpoch;
        var database = new BrowserDatabase(Path.Combine(directory, "browser.db"), epoch);
        await database.InitializeAsync();
        if (epoch > 0) await new KillSwitchRepository(database).ClearAsync(epoch);
        var services = new ServiceCollection();
        services.AddSingleton(database);
        services.AddSingleton<AppStateRepository>(); services.AddSingleton<SettingsRepository>(); services.AddSingleton<SessionRepository>();
        services.AddSingleton<HistoryRepository>(); services.AddSingleton<BookmarkRepository>(); services.AddSingleton<DownloadRepository>();
        services.AddSingleton<WorkspaceRepository>(); services.AddSingleton<ReadingListRepository>(); services.AddSingleton<PageNoteRepository>();
        services.AddSingleton<OfflineArticleRepository>(); services.AddSingleton<SessionSnapshotRepository>();
        services.AddSingleton<WindowSessionRepository>();
        services.AddSingleton<PasswordMetadataRepository>(); services.AddSingleton<PermissionRepository>(); services.AddSingleton<AiActionLogRepository>();
        services.AddSingleton<ISecureCredentialStore>(_ => new DpapiCredentialStore(Path.Combine(directory, "Credentials")));
        services.AddSingleton<CredentialService>();
        return services.BuildServiceProvider();
    }
}

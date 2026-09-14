using System.Globalization;
using System.Text;
using Browser.Data;
using Browser.Data.Repositories;

namespace Browser.Platform.Windows.Storage;

/// <summary>
/// Local, cross-process requests. The durable request survives a crash; completion
/// is recorded only after both SQL and engine history have been cleared.
/// </summary>
public sealed class KillSwitchService(BrowserPaths paths)
{
    private string RequestPath => Path.Combine(paths.Root, "kill-switch.request");
    private string CompletedPath => Path.Combine(paths.Root, "kill-switch.completed");

    public long ReadRequest() => ReadRevision(RequestPath);

    public async Task<long> RequestAsync(CancellationToken ct = default)
    {
        using var lease = await AcquireAsync(ct).ConfigureAwait(false);
        var request = checked(ReadRequest() + 1);
        WriteRevision(RequestPath, request);
        return request;
    }

    public async Task<long> CompletePendingAsync(Func<CancellationToken, Task> clearEngineHistory, CancellationToken ct = default)
    {
        using var lease = await AcquireAsync(ct).ConfigureAwait(false);
        var request = ReadRequest();
        if (request == 0) return 0;
        // Scan inactive libraries too. Explicit artifacts, vaults and downloaded
        // files are not traversed or deleted.
        foreach (var path in DatabasePaths())
        {
            var database = new BrowserDatabase(path);
            await database.InitializeAsync(ct).ConfigureAwait(false);
            await new KillSwitchRepository(database).ClearAsync(request, ct).ConfigureAwait(false);
        }
        if (ReadRevision(CompletedPath) < request)
        {
            await WaitForOlderInstancesAsync(request, ct).ConfigureAwait(false);
            await clearEngineHistory(ct).ConfigureAwait(false);
            WriteRevision(CompletedPath, request);
        }
        return request;
    }

    public async Task<IDisposable> RegisterInstanceAsync(long revision, CancellationToken ct = default)
    {
        using var lease = await AcquireAsync(ct).ConfigureAwait(false);
        if (ReadRequest() != revision || ReadRevision(CompletedPath) < revision)
            throw new OperationCanceledException("A privacy shutdown was requested during startup.");
        var path = Path.Combine(paths.Root, $".browser-instance-{revision}-{Guid.NewGuid():N}.lock");
        return new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
    }

    private async Task WaitForOlderInstancesAsync(long request, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        while (true)
        {
            timeout.Token.ThrowIfCancellationRequested();
            var busy = false;
            foreach (var path in Directory.EnumerateFiles(paths.Root, ".browser-instance-*.lock"))
            {
                var parts = Path.GetFileName(path).Split('-');
                if (parts.Length != 4 || !long.TryParse(parts[2], out var revision) || revision >= request) continue;
                EnsureSafe(path);
                try
                {
                    using var stale = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
                }
                catch (FileNotFoundException) { }
                catch (IOException) { busy = true; }
            }
            if (!busy) return;
            await Task.Delay(50, timeout.Token).ConfigureAwait(false);
        }
    }

    private IEnumerable<string> DatabasePaths()
    {
        EnsureSafe(paths.Root);
        EnsureSafe(paths.DatabasePath);
        if (File.Exists(paths.DatabasePath)) yield return paths.DatabasePath;
        var libraries = Path.Combine(paths.Root, "Libraries");
        EnsureSafe(libraries);
        if (!Directory.Exists(libraries)) yield break;
        foreach (var directory in Directory.EnumerateDirectories(libraries))
        {
            var name = Path.GetFileName(directory);
            if (name.Length != 64 || !name.All(Uri.IsHexDigit)) continue;
            EnsureSafe(directory);
            var database = Path.Combine(directory, "browser.db");
            EnsureSafe(database);
            if (File.Exists(database)) yield return database;
        }
    }

    private async Task<FileStream> AcquireAsync(CancellationToken ct)
    {
        EnsureSafe(paths.Root);
        var path = Path.Combine(paths.Root, "kill-switch.lock");
        EnsureSafe(path);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(60));
        while (true)
        {
            timeout.Token.ThrowIfCancellationRequested();
            try { return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) { await Task.Delay(50, timeout.Token).ConfigureAwait(false); }
        }
    }

    private long ReadRevision(string path)
    {
        EnsureSafe(path);
        try
        {
            using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (file.Length is < 1 or > 20) throw new InvalidDataException("Invalid privacy request.");
            using var reader = new StreamReader(file, Encoding.ASCII);
            if (!long.TryParse(reader.ReadToEnd(), NumberStyles.None, CultureInfo.InvariantCulture, out var revision) || revision < 1)
                throw new InvalidDataException("Invalid privacy request.");
            return revision;
        }
        catch (FileNotFoundException) { return 0; }
    }

    private void WriteRevision(string path, long revision)
    {
        EnsureSafe(path);
        var temporary = Path.Combine(paths.Root, $".privacy-{Guid.NewGuid():N}.tmp");
        try
        {
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                file.Write(Encoding.ASCII.GetBytes(revision.ToString(CultureInfo.InvariantCulture)));
                file.Flush(flushToDisk: true);
            }
            File.Move(temporary, path, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private void EnsureSafe(string path)
    {
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(paths.Root));
        var full = Path.GetFullPath(path);
        if (!full.Equals(root, StringComparison.OrdinalIgnoreCase) && !full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Privacy cleanup path is outside browser storage.");
        if ((File.Exists(full) || Directory.Exists(full)) && File.GetAttributes(full).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Privacy cleanup cannot follow a redirected storage path.");
    }
}

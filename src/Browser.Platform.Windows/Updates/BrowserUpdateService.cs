using System.Diagnostics;
using System.ComponentModel;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Browser.Core.Branding;
using Browser.Core.Updates;
using Browser.Platform.Windows.Storage;

namespace Browser.Platform.Windows.Updates;

public sealed record BrowserUpdateCheck(bool IsAvailable, string Status, BrowserUpdateManifest? Manifest);
public sealed record StagedBrowserUpdate(string Version, string InstallerPath, string Sha256, string PublisherThumbprint);

/// <summary>Verifies release metadata and installer signatures before staging updates.</summary>
public sealed class BrowserUpdateService(BrowserPaths paths)
{
    private static readonly Uri FeedUri = new(AppBrand.UpdateFeedUri);
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, MaxDepth = 4 };
    private const long MaximumFeedBytes = 64 * 1024;
    private const long MaximumInstallerBytes = 1_200_000_000;
    private string PendingPath => Path.Combine(paths.UpdateDirectory, "pending-update.json");
    private string FailedUpdatePath => Path.Combine(paths.UpdateDirectory, "failed-update.sha256");

    public async Task<BrowserUpdateCheck> CheckAsync(CancellationToken cancellationToken = default)
    {
        var thumbprint = await GetAuthenticodeThumbprintAsync(Environment.ProcessPath, cancellationToken);
        if (string.IsNullOrWhiteSpace(thumbprint)) return new(false, "This installation is not signed by the Sutra release publisher.", null);
        var publisher = TryReadSignerCertificate(Environment.ProcessPath);
        if (publisher?.GetRSAPublicKey() is not { } rsa) return new(false, "The Sutra release signing key is unavailable.", null);
        using (publisher)
        using (rsa)
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
                using var response = await client.GetAsync(FeedUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                if (!response.IsSuccessStatusCode) return new(false, "The update feed is unavailable.", null);
                if (response.Content.Headers.ContentLength is > MaximumFeedBytes) return new(false, "The update feed was too large.", null);
                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                using var buffer = new MemoryStream();
                var chunk = new byte[8192];
                while (true)
                {
                    var read = await stream.ReadAsync(chunk, cancellationToken);
                    if (read == 0) break;
                    if (buffer.Length + read > MaximumFeedBytes) return new(false, "The update feed was too large.", null);
                    buffer.Write(chunk, 0, read);
                }
                var manifest = JsonSerializer.Deserialize<BrowserUpdateManifest>(buffer.ToArray(), JsonOptions);
                if (manifest is null || !manifest.Verify(rsa, FeedUri)) return new(false, "The update feed signature or release details did not verify.", null);
                if (File.Exists(FailedUpdatePath) && new FileInfo(FailedUpdatePath).Length <= 128 &&
                    File.ReadAllText(FailedUpdatePath).Trim().Equals(manifest.Sha256, StringComparison.OrdinalIgnoreCase))
                    return new(false, "The previous update could not install. Sutra restored the installed version and will check for a newer release.", null);
                if (!System.Version.TryParse(manifest.Version, out var published) || !System.Version.TryParse(AppBrand.Version, out var installed))
                    return new(false, "The browser version could not be compared.", null);
                return published > installed
                    ? new(true, $"{AppBrand.Name} {manifest.Version} is available.", manifest)
                    : new(false, $"{AppBrand.Name} is up to date.", null);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return new(false, "The update check timed out.", null); }
            catch (HttpRequestException) { return new(false, "The update feed could not be reached.", null); }
            catch (JsonException) { return new(false, "The update feed could not be read.", null); }
        }
    }

    public async Task<BrowserUpdateCheck> DownloadAndStageAsync(CancellationToken cancellationToken = default)
    {
        var check = await CheckAsync(cancellationToken);
        if (!check.IsAvailable || check.Manifest is null) return check;
        var publisherThumbprint = await GetAuthenticodeThumbprintAsync(Environment.ProcessPath, cancellationToken);
        if (string.IsNullOrWhiteSpace(publisherThumbprint)) return new(false, "The release publisher could not be verified.", null);
        Directory.CreateDirectory(paths.UpdateDirectory);
        var installerPath = Path.Combine(paths.UpdateDirectory, $"SutraBrowserSetup-{check.Manifest.Version}.exe");
        var partialPath = installerPath + ".partial";
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
            using var response = await client.GetAsync(check.Manifest.InstallerUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is > MaximumInstallerBytes) throw new InvalidDataException("Release installer exceeds the size limit.");
            await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using var destination = new FileStream(partialPath, FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, useAsync: true);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[128 * 1024];
            long total = 0;
            while (true)
            {
                var read = await source.ReadAsync(buffer, cancellationToken);
                if (read == 0) break;
                total += read;
                if (total > MaximumInstallerBytes) throw new InvalidDataException("Release installer exceeds the size limit.");
                hash.AppendData(buffer, 0, read);
                await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
            await destination.FlushAsync(cancellationToken);
            await destination.DisposeAsync(); // Signature verification and atomic promotion require a closed file handle.
            var actualHash = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
            if (!actualHash.Equals(check.Manifest.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Release installer hash did not match the signed feed.");
            var assetSigner = await GetAuthenticodeThumbprintAsync(partialPath, cancellationToken);
            if (!string.Equals(assetSigner, publisherThumbprint, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Release installer publisher did not match the signed feed.");
            File.Move(partialPath, installerPath, overwrite: true);
            var staged = new StagedBrowserUpdate(check.Manifest.Version, installerPath, actualHash, publisherThumbprint);
            var pendingTemp = PendingPath + ".new";
            await File.WriteAllTextAsync(pendingTemp, JsonSerializer.Serialize(staged), cancellationToken);
            File.Move(pendingTemp, PendingPath, overwrite: true);
            return new(false, $"{AppBrand.Name} {check.Manifest.Version} is downloaded and will install on the next restart.", check.Manifest);
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or InvalidDataException or TaskCanceledException)
        {
            try { if (File.Exists(partialPath)) File.Delete(partialPath); } catch { }
            return new(false, $"{AppBrand.Name} could not verify and stage the update. Your installed browser is unchanged.", null);
        }
    }

    public bool TryStartPendingUpdate()
    {
        try
        {
            if (!File.Exists(PendingPath)) return false;
            if (new FileInfo(PendingPath).Length > 16_384) return false;
            var staged = JsonSerializer.Deserialize<StagedBrowserUpdate>(File.ReadAllText(PendingPath), JsonOptions);
            if (staged is null || string.IsNullOrWhiteSpace(staged.Sha256) || staged.Sha256.Length != 64 ||
                string.IsNullOrWhiteSpace(staged.PublisherThumbprint) || staged.PublisherThumbprint.Length is < 40 or > 80 ||
                string.IsNullOrWhiteSpace(staged.InstallerPath) ||
                !TryGetSafeStagedPath(staged.InstallerPath, out var installer) || !File.Exists(installer)) return false;
            var expected = GetAuthenticodeThumbprintAsync(Environment.ProcessPath, CancellationToken.None).GetAwaiter().GetResult();
            if (string.IsNullOrWhiteSpace(expected) || !expected.Equals(staged.PublisherThumbprint, StringComparison.OrdinalIgnoreCase)) return false;
            var installerInfo = new FileInfo(installer);
            if (installerInfo.Length <= 0 || installerInfo.Length > MaximumInstallerBytes) return false;
            using var installerStream = new FileStream(installer, FileMode.Open, FileAccess.Read, FileShare.Read);
            var hash = Convert.ToHexString(SHA256.HashData(installerStream)).ToLowerInvariant();
            if (!hash.Equals(staged.Sha256, StringComparison.OrdinalIgnoreCase)) return false;
            var signer = GetAuthenticodeThumbprintAsync(installer, CancellationToken.None).GetAwaiter().GetResult();
            if (!expected.Equals(signer, StringComparison.OrdinalIgnoreCase)) return false;
            var updater = Path.Combine(AppContext.BaseDirectory, "Sutra.Updater.exe");
            if (!File.Exists(updater)) return false;
            var updaterSigner = GetAuthenticodeThumbprintAsync(updater, CancellationToken.None).GetAwaiter().GetResult();
            if (!expected.Equals(updaterSigner, StringComparison.OrdinalIgnoreCase)) return false;
            var installDirectory = Path.GetFullPath(AppContext.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            // Run the single-file updater outside the install tree so Setup can
            // replace the installed updater without a locked executable.
            var detachedUpdater = Path.Combine(paths.UpdateDirectory, "Sutra.Updater-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(updater, detachedUpdater, overwrite: false);
            var detachedSigner = GetAuthenticodeThumbprintAsync(detachedUpdater, CancellationToken.None).GetAwaiter().GetResult();
            if (!expected.Equals(detachedSigner, StringComparison.OrdinalIgnoreCase)) { File.Delete(detachedUpdater); return false; }
            var start = new ProcessStartInfo(detachedUpdater) { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add(Environment.ProcessId.ToString());
            start.ArgumentList.Add(installer);
            start.ArgumentList.Add(staged.Sha256);
            start.ArgumentList.Add(expected);
            start.ArgumentList.Add(installDirectory);
            start.ArgumentList.Add(Environment.ProcessPath ?? Path.Combine(installDirectory, AppBrand.ExecutableName));
            if (Process.Start(start) is null) return false;
            try { File.Delete(PendingPath); } catch { }
            return true;
        }
        catch (Exception ex) when (ex is IOException or JsonException or CryptographicException or InvalidOperationException or Win32Exception or ArgumentException or NotSupportedException or UnauthorizedAccessException) { return false; }
    }

    private bool TryGetSafeStagedPath(string path, out string resolved)
    {
        resolved = Path.GetFullPath(path);
        var root = Path.GetFullPath(paths.UpdateDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return resolved.StartsWith(root, StringComparison.OrdinalIgnoreCase);
    }

    private static X509Certificate2? TryReadSignerCertificate(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        try { return new X509Certificate2(X509Certificate.CreateFromSignedFile(path)); }
        catch (CryptographicException) { return null; }
        catch (IOException) { return null; }
    }

    private static async Task<string?> GetAuthenticodeThumbprintAsync(string? path, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return null;
        var escaped = path.Replace("'", "''", StringComparison.Ordinal);
        var command = $"$s=Get-AuthenticodeSignature -LiteralPath '{escaped}'; if($s.Status -ne 'Valid' -or $null -eq $s.SignerCertificate){{exit 1}}; [Console]::Write($s.SignerCertificate.Thumbprint)";
        var start = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("-NoLogo"); start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NonInteractive"); start.ArgumentList.Add("-Command"); start.ArgumentList.Add(command);
        using var process = Process.Start(start);
        if (process is null) return null;
        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        var output = (await outputTask).Trim();
        await errorTask;
        return process.ExitCode == 0 && output.Length is >= 40 and <= 80 ? output : null;
    }
}

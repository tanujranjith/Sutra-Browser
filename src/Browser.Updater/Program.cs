using System.Diagnostics;
using System.Security.Cryptography;

internal static class Program
{
    private const string BrowserDataFolder = "SutraBrowser.Sutra";
    private const long MaximumInstallerBytes = 1_200_000_000;

    private static async Task<int> Main(string[] args)
    {
        if (args.Length != 6 || !int.TryParse(args[0], out var parentId)) return 2;
        var installer = Path.GetFullPath(args[1]);
        var expectedHash = args[2];
        var expectedThumbprint = args[3];
        var installDirectory = Path.GetFullPath(args[4]).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var appPath = Path.GetFullPath(args[5]);
        var updatesRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), BrowserDataFolder, "Updates");
        if (!IsWithin(installer, updatesRoot) || !IsWithin(appPath, installDirectory) ||
            expectedHash.Length != 64 || !expectedHash.All(Uri.IsHexDigit) || expectedThumbprint.Length is < 40 or > 80) return 3;

        string? rollbackDirectory = null;
        var backupComplete = false;
        var setupStarted = false;
        try
        {
            if (!await WaitForParentExitAsync(parentId, TimeSpan.FromMinutes(3))) return 4;
            var info = new FileInfo(installer);
            if (!info.Exists || info.Length is <= 0 or > MaximumInstallerBytes) return RejectUpdate(5, updatesRoot, expectedHash, appPath, installDirectory);
            await using var file = new FileStream(installer, FileMode.Open, FileAccess.Read, FileShare.Read);
            var actualHash = Convert.ToHexString(await SHA256.HashDataAsync(file)).ToLowerInvariant();
            if (!actualHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase)) return RejectUpdate(6, updatesRoot, expectedHash, appPath, installDirectory);
            var signer = await GetValidAuthenticodeThumbprintAsync(installer);
            if (!expectedThumbprint.Equals(signer, StringComparison.OrdinalIgnoreCase)) return RejectUpdate(7, updatesRoot, expectedHash, appPath, installDirectory);

            // Keep a complete rollback copy outside the install directory until
            // Setup reports success. Sutra user data lives elsewhere and is not
            // part of this transaction.
            Directory.CreateDirectory(updatesRoot);
            rollbackDirectory = Path.Combine(updatesRoot, "rollback-" + Guid.NewGuid().ToString("N"));
            CopyDirectory(installDirectory, rollbackDirectory);
            backupComplete = true;

            var setup = new ProcessStartInfo(installer) { UseShellExecute = false, CreateNoWindow = true };
            setup.ArgumentList.Add("/VERYSILENT");
            setup.ArgumentList.Add("/SUPPRESSMSGBOXES");
            setup.ArgumentList.Add("/NORESTART");
            setup.ArgumentList.Add("/SP-");
            setup.ArgumentList.Add("/DIR=" + installDirectory);
            using var process = Process.Start(setup);
            if (process is null)
            {
                Directory.Delete(rollbackDirectory, recursive: true);
                RecordFailedUpdate(updatesRoot, expectedHash);
                StartApp(appPath, installDirectory);
                return 8;
            }
            setupStarted = true;
            await process.WaitForExitAsync();
            if (process.ExitCode != 0)
            {
                RestoreDirectory(rollbackDirectory, installDirectory);
                rollbackDirectory = null;
                RecordFailedUpdate(updatesRoot, expectedHash);
                StartApp(appPath, installDirectory);
                return process.ExitCode;
            }
            try { Directory.Delete(rollbackDirectory, recursive: true); } catch { }

            var pending = Path.Combine(updatesRoot, "pending-update.json");
            try { if (File.Exists(pending)) File.Delete(pending); } catch { }
            try { File.Delete(Path.Combine(updatesRoot, "failed-update.sha256")); } catch { }
            StartApp(appPath, installDirectory);
            return 0;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException or CryptographicException or System.ComponentModel.Win32Exception)
        {
            try
            {
                if (rollbackDirectory is not null && Directory.Exists(rollbackDirectory))
                {
                    if (backupComplete && setupStarted) RestoreDirectory(rollbackDirectory, installDirectory);
                    else Directory.Delete(rollbackDirectory, recursive: true);
                }
                RecordFailedUpdate(updatesRoot, expectedHash);
                StartApp(appPath, installDirectory);
            }
            catch { }
            return 9;
        }
    }

    private static void RecordFailedUpdate(string updatesRoot, string hash)
    {
        try
        {
            Directory.CreateDirectory(updatesRoot);
            File.WriteAllText(Path.Combine(updatesRoot, "failed-update.sha256"), hash);
            File.Delete(Path.Combine(updatesRoot, "pending-update.json"));
        }
        catch { }
    }

    private static int RejectUpdate(int code, string updatesRoot, string hash, string appPath, string installDirectory)
    {
        RecordFailedUpdate(updatesRoot, hash);
        StartApp(appPath, installDirectory);
        return code;
    }

    private static void StartApp(string path, string directory)
        => Process.Start(new ProcessStartInfo(path) { UseShellExecute = true, WorkingDirectory = directory });

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var entry in Directory.EnumerateFileSystemEntries(source))
        {
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Install tree contains a reparse point.");
            var target = Path.Combine(destination, Path.GetFileName(entry));
            if ((attributes & FileAttributes.Directory) != 0) CopyDirectory(entry, target);
            else File.Copy(entry, target, overwrite: false);
        }
    }

    private static void RestoreDirectory(string backup, string installDirectory)
    {
        var failedDirectory = installDirectory + ".failed-" + Guid.NewGuid().ToString("N");
        if (Directory.Exists(installDirectory)) Directory.Move(installDirectory, failedDirectory);
        try
        {
            Directory.Move(backup, installDirectory);
            try { if (Directory.Exists(failedDirectory)) Directory.Delete(failedDirectory, recursive: true); } catch { }
        }
        catch
        {
            if (!Directory.Exists(installDirectory) && Directory.Exists(failedDirectory))
                Directory.Move(failedDirectory, installDirectory);
            throw;
        }
    }

    private static async Task<bool> WaitForParentExitAsync(int id, TimeSpan timeout)
    {
        try
        {
            using var parent = Process.GetProcessById(id);
            using var cancellation = new CancellationTokenSource(timeout);
            await parent.WaitForExitAsync(cancellation.Token);
            return true;
        }
        catch (ArgumentException) { return true; }
        catch (OperationCanceledException) { return false; }
    }

    private static bool IsWithin(string path, string directory)
    {
        var root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return Path.GetFullPath(path).StartsWith(root, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<string?> GetValidAuthenticodeThumbprintAsync(string path)
    {
        var escaped = path.Replace("'", "''", StringComparison.Ordinal);
        var command = $"$s=Get-AuthenticodeSignature -LiteralPath '{escaped}'; if($s.Status -ne 'Valid' -or $null -eq $s.SignerCertificate){{exit 1}}; [Console]::Write($s.SignerCertificate.Thumbprint)";
        var start = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
        start.ArgumentList.Add("-NoLogo"); start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NonInteractive"); start.ArgumentList.Add("-Command"); start.ArgumentList.Add(command);
        using var process = Process.Start(start);
        if (process is null) return null;
        var output = await process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync();
        return process.ExitCode == 0 ? output.Trim() : null;
    }
}

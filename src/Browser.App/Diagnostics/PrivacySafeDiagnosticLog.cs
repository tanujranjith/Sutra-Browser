using System.Text;
using Browser.Core.Diagnostics;

namespace Browser.App.Diagnostics;

internal static class PrivacySafeDiagnosticLog
{
    private const long MaximumFileBytes = 128 * 1024;
    private static readonly object Gate = new();
    private static readonly string DirectoryPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        Browser.Core.Branding.AppBrand.ApplicationId,
        "Diagnostics");
    private static readonly string LogPath = Path.Combine(DirectoryPath, "faults.jsonl");
    private static readonly string PreviousPath = LogPath + ".1";

    public static void Record(string category, Exception? exception = null, string? code = null)
    {
        try
        {
            var line = PrivacySafeDiagnosticRecord.Create(DateTimeOffset.UtcNow, category, exception, code).ToJsonLine();
            var encoded = Encoding.UTF8.GetBytes(line + Environment.NewLine);
            lock (Gate)
            {
                Directory.CreateDirectory(DirectoryPath);
                if (File.Exists(LogPath) && new FileInfo(LogPath).Length + encoded.Length > MaximumFileBytes)
                {
                    if (File.Exists(PreviousPath)) File.Delete(PreviousPath);
                    File.Move(LogPath, PreviousPath);
                }

                using var stream = new FileStream(LogPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                stream.Write(encoded);
                stream.Flush(flushToDisk: true);
            }
        }
        catch (Exception loggingException)
        {
            System.Diagnostics.Debug.WriteLine($"Privacy-safe fault logging failed: {loggingException.GetType().Name}");
        }
    }
}

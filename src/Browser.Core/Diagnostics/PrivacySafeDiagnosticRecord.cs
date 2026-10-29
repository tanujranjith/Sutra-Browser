using System.Text.Json;

namespace Browser.Core.Diagnostics;

/// <summary>A deliberately small diagnostic row that never carries messages, stacks, URLs, or paths.</summary>
public sealed record PrivacySafeDiagnosticRecord(
    DateTimeOffset At,
    string Category,
    string? ErrorType,
    int? HResult,
    string? Code)
{
    public static PrivacySafeDiagnosticRecord Create(
        DateTimeOffset at,
        string category,
        Exception? exception = null,
        string? code = null) => new(
            at.ToUniversalTime(),
            SafeToken(category, "unknown"),
            exception is null ? null : SafeToken(exception.GetType().Name, "Exception"),
            exception?.HResult,
            string.IsNullOrWhiteSpace(code) ? null : SafeToken(code, "unknown"));

    public string ToJsonLine() => JsonSerializer.Serialize(this);

    private static string SafeToken(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var safe = new string(value.Take(48).Where(character =>
            char.IsAsciiLetterOrDigit(character) || character is '_' or '-' or '.').ToArray());
        return string.IsNullOrWhiteSpace(safe) ? fallback : safe;
    }
}

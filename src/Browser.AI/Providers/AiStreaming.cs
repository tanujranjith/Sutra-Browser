using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace Browser.AI.Providers;

public interface IStreamingAiProvider : IAiProvider
{
    IAsyncEnumerable<string> StreamAsync(AiRequest request, CancellationToken cancellationToken);
}

public sealed partial class OllamaProvider
{
    public async IAsyncEnumerable<string> StreamAsync(AiRequest request, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        using var message = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl.TrimEnd('/')}/api/chat")
        { Content = JsonContent.Create(new { model, stream = true, messages = request.Messages.Select(x => new { role = x.Role, content = x.Content }).ToArray() }) };
        using var response = await httpClient.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        await foreach (var delta in AiStreamDecoder.ReadAsync(stream, false, cancellationToken)) yield return delta;
    }
}

public sealed partial class OpenAiCompatibleProvider
{
    public async IAsyncEnumerable<string> StreamAsync(AiRequest request, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var key = await apiKeyProvider(cancellationToken) ?? throw new InvalidOperationException("No API key is configured in secure storage.");
        using var message = new HttpRequestMessage(HttpMethod.Post, $"{endpoint.TrimEnd('/')}/chat/completions");
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        message.Content = JsonContent.Create(new { model, stream = true, messages = request.Messages.Select(x => new { role = x.Role, content = x.Content }).ToArray() });
        using var response = await httpClient.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        await foreach (var delta in AiStreamDecoder.ReadAsync(stream, true, cancellationToken)) yield return delta;
    }
}

/// <summary>Bound line, event, response, and decoded output sizes before interpreting provider data.</summary>
public static class AiStreamDecoder
{
    public const int MaximumEventCharacters = 65_536;
    public const int MaximumOutputCharacters = 128_000;
    public static async IAsyncEnumerable<string> ReadAsync(Stream stream, bool serverSentEvents, [EnumeratorCancellation] CancellationToken ct)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, true, 4096, leaveOpen: true);
        var buffer = new char[4096]; var line = new StringBuilder(); var pending = new StringBuilder();
        var total = 0; var output = 0;
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var read = await reader.ReadAsync(buffer.AsMemory(), ct);
            if (read == 0) break;
            total += read;
            if (total > 2_000_000) throw new InvalidDataException("The AI response exceeded the response limit.");
            for (var index = 0; index < read; index++)
            {
                if (buffer[index] != '\n')
                {
                    if (line.Length >= MaximumEventCharacters) throw new InvalidDataException("The AI response exceeded the event limit.");
                    line.Append(buffer[index]); continue;
                }
                var text = line.ToString().TrimEnd('\r'); line.Clear();
                string? payload = null;
                if (!serverSentEvents) payload = text;
                else if (text.Length == 0) { payload = pending.ToString(); pending.Clear(); }
                else if (text.StartsWith("data:", StringComparison.Ordinal))
                {
                    if (pending.Length + text.Length > MaximumEventCharacters) throw new InvalidDataException("The AI response exceeded the event limit.");
                    pending.AppendLine(text[5..].TrimStart());
                }
                if (string.IsNullOrWhiteSpace(payload)) continue;
                if (payload.Trim() == "[DONE]") yield break;
                var delta = Decode(payload, serverSentEvents);
                if (string.IsNullOrEmpty(delta)) continue;
                output += delta.Length;
                if (output > MaximumOutputCharacters) throw new InvalidDataException("The AI response exceeded the output limit.");
                yield return delta;
            }
        }
        if (serverSentEvents && line.ToString().StartsWith("data:", StringComparison.Ordinal)) pending.Append(line.ToString()[5..].TrimStart());
        var final = serverSentEvents ? pending.ToString() : line.ToString();
        if (!string.IsNullOrWhiteSpace(final) && final.Trim() != "[DONE]")
        {
            if (final.Length > MaximumEventCharacters) throw new InvalidDataException("The AI response exceeded the event limit.");
            var delta = Decode(final, serverSentEvents);
            if (output + delta.Length > MaximumOutputCharacters) throw new InvalidDataException("The AI response exceeded the output limit.");
            if (delta.Length > 0) yield return delta;
        }
    }

    private static string Decode(string payload, bool openAi)
    {
        using var json = JsonDocument.Parse(payload);
        var root = json.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.TryGetProperty("error", out _)) throw new InvalidDataException("The AI provider returned an invalid response.");
        JsonElement message;
        if (openAi)
        {
            if (!root.TryGetProperty("choices", out var choices) || choices.ValueKind != JsonValueKind.Array || choices.GetArrayLength() == 0) return "";
            if (choices[0].ValueKind != JsonValueKind.Object || !choices[0].TryGetProperty("delta", out message)) return "";
        }
        else if (!root.TryGetProperty("message", out message)) return "";
        return message.ValueKind == JsonValueKind.Object && message.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.String ? content.GetString() ?? "" : "";
    }
}

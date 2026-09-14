using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Browser.AI.Providers;

public sealed record AiMessage(string Role, string Content);
public sealed record AiRequest(IReadOnlyList<AiMessage> Messages, string? PageContext = null);
public interface IAiProvider { string Name { get; } bool IsRemote { get; } Task<string> CompleteAsync(AiRequest request, CancellationToken cancellationToken); }

public sealed partial class OllamaProvider(HttpClient httpClient, string baseUrl, string model) : IStreamingAiProvider
{
    public string Name => "Ollama";
    public bool IsRemote => false;
    public async Task<string> CompleteAsync(AiRequest request, CancellationToken ct)
    {
        using var response = await httpClient.PostAsJsonAsync($"{baseUrl.TrimEnd('/')}/api/chat", new
        {
            model,
            stream = false,
            messages = request.Messages.Select(x => new { role = x.Role, content = x.Content }).ToArray()
        }, ct);
        response.EnsureSuccessStatusCode();
        try
        {
            using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            if (json.RootElement.TryGetProperty("message", out var message) &&
                message.TryGetProperty("content", out var content))
                return content.GetString() ?? string.Empty;
            return string.Empty;
        }
        catch (JsonException) { return string.Empty; }
    }
}

public sealed partial class OpenAiCompatibleProvider(HttpClient httpClient, string endpoint, string model, Func<CancellationToken, Task<string?>> apiKeyProvider) : IStreamingAiProvider
{
    public string Name => "OpenAI compatible";
    public bool IsRemote => true;
    public async Task<string> CompleteAsync(AiRequest request, CancellationToken ct)
    {
        var key = await apiKeyProvider(ct) ?? throw new InvalidOperationException("No API key is configured in secure storage.");
        using var message = new HttpRequestMessage(HttpMethod.Post, $"{endpoint.TrimEnd('/')}/chat/completions");
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        message.Content = JsonContent.Create(new { model, messages = request.Messages.Select(x => new { role = x.Role, content = x.Content }).ToArray() });
        using var response = await httpClient.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        try
        {
            using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            // Remote provider payloads are untrusted: missing/empty choices must
            // yield an empty completion, never an IndexOutOfRange/KeyNotFound crash.
            if (json.RootElement.TryGetProperty("choices", out var choices) &&
                choices.ValueKind == JsonValueKind.Array &&
                choices.GetArrayLength() > 0 &&
                choices[0].TryGetProperty("message", out var choiceMessage) &&
                choiceMessage.TryGetProperty("content", out var content))
                return content.GetString() ?? string.Empty;
            return string.Empty;
        }
        catch (JsonException) { return string.Empty; }
    }
}

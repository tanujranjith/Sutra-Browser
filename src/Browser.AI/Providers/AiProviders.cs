using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Browser.AI.Providers;

public sealed record AiMessage(string Role, string Content);
public sealed record AiRequest(IReadOnlyList<AiMessage> Messages, string? PageContext = null);
public interface IAiProvider { string Name { get; } bool IsRemote { get; } Task<string> CompleteAsync(AiRequest request, CancellationToken cancellationToken); }

public sealed class OllamaProvider(HttpClient httpClient, string baseUrl, string model) : IAiProvider
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
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return json.RootElement.GetProperty("message").GetProperty("content").GetString() ?? string.Empty;
    }
}

public sealed class OpenAiCompatibleProvider(HttpClient httpClient, string endpoint, string model, Func<CancellationToken, Task<string?>> apiKeyProvider) : IAiProvider
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
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return json.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? string.Empty;
    }
}


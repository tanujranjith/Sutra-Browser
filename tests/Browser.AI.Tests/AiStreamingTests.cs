using System.Text;
using Browser.AI.Providers;
using Xunit;

namespace Browser.AI.Tests;

public sealed class AiStreamingTests
{
    private static async Task<string> Decode(string body, bool sse, CancellationToken ct = default)
    {
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(body));
        var text = new StringBuilder();
        await foreach (var part in AiStreamDecoder.ReadAsync(stream, sse, ct)) text.Append(part);
        return text.ToString();
    }

    [Fact]
    public async Task ReadsSseDeltasAndStopsBeforeTrailingEvents()
    {
        var body = ":heartbeat\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n\ndata: [DONE]\n\ndata: invalid\n\n";
        Assert.Equal("Hello world", await Decode(body, true));
    }

    [Fact]
    public async Task ReadsOllamaIncludingLastLineWithoutNewline() =>
        Assert.Equal("One two", await Decode("{\"message\":{\"content\":\"One \"}}\n{\"message\":{\"content\":\"two\"}}", false));

    [Fact]
    public async Task RejectsOversizedLinesAndHonorsCancellation()
    {
        await Assert.ThrowsAsync<InvalidDataException>(() => Decode(new string('x', AiStreamDecoder.MaximumEventCharacters + 1), true));
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Decode("", true, cancellation.Token));
    }

    [Fact]
    public async Task ProviderErrorDoesNotExposeProviderPayload()
    {
        var error = await Assert.ThrowsAsync<InvalidDataException>(() => Decode("{\"error\":\"sensitive-provider-detail\"}\n", false));
        Assert.DoesNotContain("sensitive-provider-detail", error.Message);
    }
}

using Browser.Core.Notes;
using Browser.Data;
using Browser.Data.Repositories;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Browser.Data.Tests;

public sealed class PageNoteRepositoryTests : IAsyncLifetime
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sutra-notes-{Guid.NewGuid():N}.db");
    private BrowserDatabase _database = null!;
    private PageNoteRepository _notes = null!;

    public async Task InitializeAsync()
    {
        _database = new(_path);
        await _database.InitializeAsync();
        _notes = new(_database);
    }

    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        if (File.Exists(_path)) File.Delete(_path);
        return Task.CompletedTask;
    }

    [Fact]
    public async Task AddListAndDeleteNotesForOnePage()
    {
        var id = await _notes.AddAsync("https://example.com/article", "selected sentence", "Check the numbers here");
        Assert.True(id > 0);
        var notes = await _notes.ListForPageAsync("https://example.com/article");
        var note = Assert.Single(notes);
        Assert.Equal("https://example.com/article", note.Url);
        Assert.Equal("selected sentence", note.Quote);
        Assert.Equal("Check the numbers here", note.Note);
        Assert.True(await _notes.DeleteAsync(id));
        Assert.Empty(await _notes.ListForPageAsync("https://example.com/article"));
    }

    [Fact]
    public async Task FragmentDifferencesStillFindTheSamePage()
    {
        await _notes.AddAsync("https://example.com/guide#intro", "", "Read this first");
        var notes = await _notes.ListForPageAsync("https://example.com/guide#step-3");
        Assert.Single(notes);
    }

    [Fact]
    public async Task UpdatePreservesCreatedAtAndRefreshesUpdatedAt()
    {
        var id = await _notes.AddAsync("https://example.com/a", "quote one", "first body");
        var original = (await _notes.ListForPageAsync("https://example.com/a")).Single();
        await Task.Delay(20);
        Assert.True(await _notes.UpdateAsync(id, "quote two", "second body"));
        var updated = await _notes.GetAsync(id);
        Assert.NotNull(updated);
        Assert.Equal(original.CreatedAt, updated!.CreatedAt);
        Assert.True(updated.UpdatedAt >= original.UpdatedAt);
        Assert.Equal("quote two", updated.Quote);
        Assert.Equal("second body", updated.Note);
    }

    [Fact]
    public async Task UpdateMissingNoteReturnsFalse()
    {
        Assert.False(await _notes.UpdateAsync(987654321, "q", "note"));
        Assert.False(await _notes.DeleteAsync(987654321));
        Assert.Null(await _notes.GetAsync(987654321));
    }

    [Fact]
    public async Task PagesStayIsolated()
    {
        await _notes.AddAsync("https://a.example/page", "", "alpha page note");
        await _notes.AddAsync("https://b.example/page", "", "beta page note");
        Assert.Single(await _notes.ListForPageAsync("https://a.example/page"));
        Assert.Single(await _notes.ListForPageAsync("https://b.example/page"));
        // Same host, different path: not the same target.
        Assert.Empty(await _notes.ListForPageAsync("https://a.example/other"));
    }

    [Fact]
    public async Task SearchFindsUrlQuoteAndNoteTextWithBoundedResults()
    {
        await _notes.AddAsync("https://weather.example/forecast", "", "umbrella advice");
        await _notes.AddAsync("https://books.example/reviews", "a storm of praise", "worth rereading");
        await _notes.AddAsync("https://example.org/misc", "", "unrelated");

        Assert.Contains((await _notes.SearchAsync("umbrella")), x => x.Note == "umbrella advice");
        Assert.Contains((await _notes.SearchAsync("storm")), x => x.Quote!.Contains("storm"));
        Assert.Contains((await _notes.SearchAsync("weather.example")), x => x.Url.StartsWith("https://weather.example"));

        for (var i = 0; i < 25; i++)
            await _notes.AddAsync($"https://example.com/bulk/{i}", "", $"bulk {i}");
        Assert.Equal(10, (await _notes.SearchAsync("", limit: 10)).Count);
        Assert.True((await _notes.SearchAsync("bulk", limit: 200)).Count <= 200);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   \t ")]
    public async Task EmptyNoteBodiesAreRejected(string body)
    {
        await Assert.ThrowsAsync<ArgumentException>(() => _notes.AddAsync("https://example.com/", "", body));
    }

    [Fact]
    public async Task OversizedNoteBodiesAreRejected()
    {
        var tooLong = new string('n', NoteTargets.MaxNoteLength + 1);
        await Assert.ThrowsAsync<ArgumentException>(() => _notes.AddAsync("https://example.com/", "", tooLong));
        var id = await _notes.AddAsync("https://example.com/", "", new string('n', NoteTargets.MaxNoteLength));
        Assert.True(id > 0);

        var overUpdate = new string('u', NoteTargets.MaxNoteLength + 1);
        await Assert.ThrowsAsync<ArgumentException>(() => _notes.UpdateAsync(id, "", overUpdate));
    }

    [Fact]
    public async Task OversizedQuotesAreClampedNotRejected()
    {
        var hugeQuote = new string('q', NoteTargets.MaxQuoteLength + 999);
        var id = await _notes.AddAsync("https://example.com/clamp", hugeQuote, "kept with a clamped quote");
        var stored = await _notes.GetAsync(id);
        Assert.Equal(NoteTargets.MaxQuoteLength, stored!.Quote.Length);
    }

    [Theory]
    [InlineData("javascript:alert(document.domain)")]
    [InlineData("file:///etc/passwd")]
    [InlineData("https://user:pass@example.com/secret")]
    [InlineData("data:text/html,<script>1</script>")]
    public async Task UnsafeTargetsAreRejectedBeforeSqlRuns(string url)
    {
        await Assert.ThrowsAsync<ArgumentException>(() => _notes.AddAsync(url, "", "should never be written"));
        Assert.Empty(await _notes.SearchAsync("should never be written"));
    }

    [Fact]
    public async Task HostileTextRoundTripsAsPlainText()
    {
        const string hostile = "<script>alert('x')</script> \"quotes\" 'single' --; DROP TABLE page_notes; %like_ 100%";
        var id = await _notes.AddAsync("https://example.com/hostile", hostile, hostile + " tail");
        var stored = await _notes.GetAsync(id);
        Assert.NotNull(stored);
        Assert.StartsWith("<script>", stored!.Quote);
        // The quote is clamped to the documented bound but keeps its content prefix.
        Assert.True(stored.Quote.Length <= NoteTargets.MaxQuoteLength);
        Assert.Contains("DROP TABLE page_notes;", stored.Note);
        // The table still exists and still works after the hostile payload.
        Assert.NotEmpty(await _notes.ListForPageAsync("https://example.com/hostile"));
    }

    [Fact]
    public async Task SearchIgnoresLikeWildcardsInQuery()
    {
        await _notes.AddAsync("https://example.com/plain", "", "plain text note");
        // A bare '%' would match everything without escaping; escaped it matches nothing.
        Assert.Empty(await _notes.SearchAsync("%%"));
    }

    [Fact]
    public async Task LiteralPercentUnderscoreAndEscapeCharactersMatchExactly()
    {
        await _notes.AddAsync("https://example.com/percent", "", "progress 100% complete");
        await _notes.AddAsync("https://example.com/underscore", "", "snake_case_name here");
        await _notes.AddAsync("https://example.com/escape-char", "", @"path with \ backslash inside");
        await _notes.AddAsync("https://example.com/combined", "", "task 50%_done today");
        await _notes.AddAsync("https://example.com/other", "", "nothing wildcardy at all");

        // '%' must be a literal, not an any-substring wildcard: only notes that
        // actually contain a percent character may match.
        var percent = await _notes.SearchAsync("%");
        Assert.Equal(2, percent.Count);
        Assert.All(percent, x => Assert.Contains("%", x.Note));
        Assert.DoesNotContain(percent, x => x.Url == "https://example.com/other");

        // '_' must be a literal single-character placeholder only when written as text.
        var underscore = await _notes.SearchAsync("snake_case_name");
        Assert.Single(underscore);
        Assert.Equal("https://example.com/underscore", underscore[0].Url);
        Assert.DoesNotContain((await _notes.SearchAsync("_")), x => x.Url == "https://example.com/other");

        // The escape character itself is searchable literally.
        var backslash = await _notes.SearchAsync(@"\");
        Assert.Single(backslash);
        Assert.Equal("https://example.com/escape-char", backslash[0].Url);

        // Combinations keep literal semantics.
        var combined = await _notes.SearchAsync("50%_done");
        Assert.Single(combined);
        Assert.Contains("50%_done", combined[0].Note);

        // Ordinary text searches are unaffected by the ESCAPE clause.
        Assert.NotEmpty(await _notes.SearchAsync("complete"));
        Assert.NotEmpty(await _notes.SearchAsync("wildcardy"));
    }

    [Fact]
    public async Task CancellationStopsPendingRepositoryWork()
    {
        using var cts = new CancellationTokenSource(1);
        await Task.Delay(30);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => _notes.AddAsync("https://example.com/cancel", "", "never lands", cts.Token));
        Assert.Empty(await _notes.SearchAsync("never lands"));
    }
}

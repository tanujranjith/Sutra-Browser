using Browser.Core.Notes;
using Browser.Core.Runtime;
using Browser.Core.Search;
using Xunit;

namespace Browser.Core.Tests;

public sealed class NoteTargetTests
{
    [Theory]
    [InlineData("https://example.com/article", "https://example.com/article")]
    [InlineData("http://example.com/", "http://example.com/")]
    [InlineData("HTTPS://EXAMPLE.COM/Docs", "https://example.com/Docs")]
    [InlineData("https://example.com/search?q=notes+x&lang=en", "https://example.com/search?q=notes+x&lang=en")]
    [InlineData("https://example.com/page#section-2", "https://example.com/page")]
    [InlineData("  https://example.com/page  ", "https://example.com/page")]
    [InlineData("https://example.com:443/a", "https://example.com/a")]
    [InlineData("http://example.com:80/a", "http://example.com/a")]
    public void NormalizesWebPageTargets(string input, string expected)
    {
        Assert.True(NoteTargets.TryNormalize(input, out var normalized));
        Assert.Equal(expected, normalized);
        Assert.Equal(expected, NoteTargets.Normalize(input));
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,hello")]
    [InlineData("file:///C:/Windows")]
    [InlineData("ftp://example.com/file")]
    [InlineData("about:blank")]
    [InlineData("browser://newtab")]
    [InlineData("https://user@example.com/private")]
    [InlineData("https://user:password@example.com/private")]
    [InlineData("//example.com/relative")]
    [InlineData("not a url")]
    [InlineData("")]
    [InlineData("   ")]
    public void RejectsUnsafeOrInvalidTargets(string input)
    {
        Assert.False(NoteTargets.TryNormalize(input, out var normalized));
        Assert.Equal(string.Empty, normalized);
        Assert.Throws<ArgumentException>(() => NoteTargets.Normalize(input));
    }

    [Fact]
    public void RejectsOverlongUrlsInsteadOfTruncating()
    {
        var longUrl = "https://example.com/" + new string('a', NoteTargets.MaxUrlLength);
        Assert.True(longUrl.Length > NoteTargets.MaxUrlLength);
        Assert.False(NoteTargets.TryNormalize(longUrl, out _));
    }

    [Fact]
    public void AcceptsUrlsUpToTheDocumentedLimit()
    {
        var path = new string('a', NoteTargets.MaxUrlLength - "https://example.com/".Length);
        Assert.True(NoteTargets.TryNormalize("https://example.com/" + path, out _));
    }

    [Fact]
    public void QuoteClampingIsBoundedAndTrimmed()
    {
        Assert.Equal(string.Empty, NoteTargets.ClampQuote(null));
        Assert.Equal("selected", NoteTargets.ClampQuote("  selected \r\n "));
        var clamped = NoteTargets.ClampQuote(new string('x', NoteTargets.MaxQuoteLength + 500));
        Assert.Equal(NoteTargets.MaxQuoteLength, clamped.Length);
    }

    [Theory]
    [InlineData("https://example.com/a#frag1", "https://example.com/a#frag2")]
    public void FragmentNeverSplitsOnePageIntoTwoTargets(string first, string second)
    {
        Assert.Equal(NoteTargets.Normalize(first), NoteTargets.Normalize(second));
    }
}

public sealed class TextMatchRankingTests
{
    [Fact]
    public void EmptyQueryMatchesEverythingEqually()
    {
        Assert.Equal(0, TextMatchRanking.Rank("Anything", "hint", ""));
        Assert.Equal(0, TextMatchRanking.Rank(null, null, "   "));
    }

    [Fact]
    public void ExactAndPrefixBeatSubstring()
    {
        var exact = TextMatchRanking.Rank("New tab", "", "new tab");
        var prefix = TextMatchRanking.Rank("Table of contents", "", "tab");
        var word = TextMatchRanking.Rank("Add page note", "", "page");
        var substring = TextMatchRanking.Rank("Notable mentions", "", "tab");
        var noMatch = TextMatchRanking.Rank("Bookmarks", "", "tab");
        Assert.True(exact > prefix);
        Assert.True(prefix > word);
        Assert.True(word > substring);
        Assert.True(substring > noMatch);
        Assert.Equal(TextMatchRanking.NoMatch, noMatch);
    }

    [Fact]
    public void SecondaryTextMatchesBelowPrimaryMatches()
    {
        var primaryContains = TextMatchRanking.Rank("Sutra Save", "", "save");
        var secondaryOnly = TextMatchRanking.Rank("History", "Ctrl+H saves nothing", "save");
        Assert.True(primaryContains > secondaryOnly);
        Assert.True(secondaryOnly > TextMatchRanking.NoMatch);
    }

    [Fact]
    public void WordBoundaryBeatsInteriorSubstring()
    {
        Assert.True(
            TextMatchRanking.Rank("Open page notes", "", "note")
            > TextMatchRanking.Rank("Annotated", "", "note"));
    }

    [Fact]
    public void OrderingIsStableForEqualRanks()
    {
        var query = "re";
        var candidates = new[] { "Reader mode", "Recent tabs", "Reload" };
        var ranked = candidates
            .Select(name => (Name: name, Rank: TextMatchRanking.Rank(name, "", query)))
            .Where(x => x.Rank != TextMatchRanking.NoMatch)
            .OrderByDescending(x => x.Rank)
            .ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .Select(x => x.Name)
            .ToList();
        // All three start with the query prefix, so alphabetical order decides.
        Assert.Equal(["Reader mode", "Recent tabs", "Reload"], ranked);
    }
}

public sealed class PersistencePassCoordinatorTests
{
    private static TaskCompletionSource NewGate() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private sealed class ConcurrencyProbe
    {
        private int _active;
        private int _max;
        public void Enter()
        {
            var now = Interlocked.Increment(ref _active);
            int observed;
            do
            {
                observed = Volatile.Read(ref _max);
                if (now <= observed) return;
            }
            while (Interlocked.CompareExchange(ref _max, now, observed) != observed);
        }
        public void Exit() => Interlocked.Decrement(ref _active);
        public int Max => Volatile.Read(ref _max);
    }

    [Fact]
    public async Task ConcurrentRequestsNeverOverlapAndEachDelegateRunsAtMostOncePerBurst()
    {
        var coordinator = new PersistencePassCoordinator();
        var probe = new ConcurrencyProbe();
        var entered = NewGate();
        var release = NewGate();
        var ownerRuns = 0;
        var waiterRuns = 0;

        var owner = coordinator.RunAsync(PersistencePassKind.SettingsOnly, async _ =>
        {
            probe.Enter();
            try
            {
                Interlocked.Increment(ref ownerRuns);
                entered.TrySetResult();
                await release.Task;
            }
            finally { probe.Exit(); }
        });

        await entered.Task;
        var waiter = coordinator.RunAsync(PersistencePassKind.SettingsOnly, _ =>
        {
            probe.Enter();
            try { Interlocked.Increment(ref waiterRuns); return Task.CompletedTask; }
            finally { probe.Exit(); }
        });
        await Task.Delay(50);

        release.TrySetResult();
        await Task.WhenAll(owner, waiter);

        Assert.Equal(1, ownerRuns);
        Assert.Equal(1, waiterRuns);          // the trailing pass ran the waiter's own delegate once
        Assert.Equal(1, probe.Max);           // writes never overlapped
        Assert.False(coordinator.IsBusy);
    }

    [Fact]
    public async Task EqualKindBurstsCoalesceIntoOneTrailingRunOfTheEarliestWaiter()
    {
        var coordinator = new PersistencePassCoordinator();
        var entered = NewGate();
        var release = NewGate();
        var executions = 0;
        var perWaiter = new int[5];

        var owner = coordinator.RunAsync(PersistencePassKind.Session, async _ =>
        {
            Interlocked.Increment(ref executions);
            entered.TrySetResult();
            await release.Task;
        });

        await entered.Task;
        var waiters = Enumerable.Range(0, 5).Select(i =>
            coordinator.RunAsync(PersistencePassKind.Session, _ => { Interlocked.Increment(ref perWaiter[i]); return Task.CompletedTask; })).ToList();

        release.TrySetResult();
        await owner;
        await Task.WhenAll(waiters);

        // Exactly one trailing pass: the earliest queued delegate covers all five.
        Assert.Equal(2, Volatile.Read(ref executions) + perWaiter.Sum());
        Assert.Equal(1, perWaiter.Sum());
        Assert.Contains(1, perWaiter);
        Assert.False(coordinator.IsBusy);
    }

    [Fact]
    public async Task SettingsOwnerCannotCoverQueuedSessionRequest()
    {
        // Required regression: a session request queued behind a settings-only
        // owner must be executed by its own pass, never "covered" by a repeated
        // settings delegate.
        var coordinator = new PersistencePassCoordinator();
        var probe = new ConcurrencyProbe();
        var entered = NewGate();
        var release = NewGate();
        var settingsRuns = 0;
        var sessionRuns = 0;

        var settingsOwner = coordinator.RunAsync(PersistencePassKind.SettingsOnly, async _ =>
        {
            probe.Enter();
            try
            {
                Interlocked.Increment(ref settingsRuns);
                entered.TrySetResult();
                await release.Task;
            }
            finally { probe.Exit(); }
        });

        await entered.Task;
        var sessionCaller = coordinator.RunAsync(PersistencePassKind.Session, _ =>
        {
            probe.Enter();
            try { Interlocked.Increment(ref sessionRuns); return Task.CompletedTask; }
            finally { probe.Exit(); }
        });
        await Task.Delay(50);
        Assert.Equal(0, Volatile.Read(ref sessionRuns)); // still queued, not yet executed

        release.TrySetResult();
        await settingsOwner;
        await sessionCaller;                              // completes only after its own pass ran

        Assert.True(Volatile.Read(ref sessionRuns) >= 1); // the session action actually executed
        Assert.Equal(1, Volatile.Read(ref settingsRuns)); // no redundant rerun of the weaker delegate
        Assert.Equal(1, probe.Max);
        Assert.False(coordinator.IsBusy);
    }

    [Fact]
    public async Task SessionOwnerKeepsQueuedSettingsRequestSafe()
    {
        // Inverse case: a settings request queued behind a session owner is never
        // lost or weakened. It is satisfied either by the strong session pass or
        // by one cheap trailing settings pass that runs after it — both are safe,
        // because a pass that started before the arrival cannot prove coverage.
        var coordinator = new PersistencePassCoordinator();
        var probe = new ConcurrencyProbe();
        var entered = NewGate();
        var release = NewGate();
        var sessionRuns = 0;
        var settingsRuns = 0;

        var sessionOwner = coordinator.RunAsync(PersistencePassKind.Session, async _ =>
        {
            probe.Enter();
            try
            {
                Interlocked.Increment(ref sessionRuns);
                entered.TrySetResult();
                await release.Task;
            }
            finally { probe.Exit(); }
        });

        await entered.Task;
        var settingsCaller = coordinator.RunAsync(PersistencePassKind.SettingsOnly, _ =>
        {
            probe.Enter();
            try { Interlocked.Increment(ref settingsRuns); return Task.CompletedTask; }
            finally { probe.Exit(); }
        });
        await Task.Delay(50);

        release.TrySetResult();
        await sessionOwner;
        await settingsCaller;

        Assert.Equal(1, Volatile.Read(ref sessionRuns));
        Assert.InRange(Volatile.Read(ref settingsRuns), 0, 1); // covered or one trailing pass; both safe
        Assert.Equal(1, probe.Max);
        Assert.False(coordinator.IsBusy);
    }

    [Fact]
    public async Task StrongerRequestUpgradesAnAlreadyQueuedWeakerRequest()
    {
        var coordinator = new PersistencePassCoordinator();
        var entered = NewGate();
        var release = NewGate();
        var runs = 0;

        var owner = coordinator.RunAsync(PersistencePassKind.SettingsOnly, async _ =>
        {
            entered.TrySetResult();
            await release.Task;
        });

        await entered.Task;
        var weak = coordinator.RunAsync(PersistencePassKind.SettingsOnly, _ => { Interlocked.Increment(ref runs); return Task.CompletedTask; });
        var strong = coordinator.RunAsync(PersistencePassKind.Session, _ => { Interlocked.Increment(ref runs); return Task.CompletedTask; });

        release.TrySetResult();
        await Task.WhenAll(owner, weak, strong);

        // The queued weak request was upgraded to the strong one: exactly one
        // trailing execution total (the strong delegate).
        Assert.Equal(1, Volatile.Read(ref runs));
        Assert.False(coordinator.IsBusy);
    }

    [Fact]
    public async Task DrainAsyncWaitsForQuiescence()
    {
        var coordinator = new PersistencePassCoordinator();
        var entered = NewGate();
        var release = NewGate();

        var running = coordinator.RunAsync(PersistencePassKind.Session, async _ =>
        {
            entered.TrySetResult();
            await release.Task;
        });
        var queued = coordinator.RunAsync(PersistencePassKind.Session, _ => Task.CompletedTask);

        await entered.Task;
        var drain = coordinator.DrainAsync();
        // The first pass is blocked on a gate, so quiescence has not been reached.
        await Task.Delay(50);
        Assert.False(drain.IsCompleted);
        release.TrySetResult();
        await running;
        await queued;
        await drain; // completes only after everything drained
        Assert.True(drain.IsCompletedSuccessfully);
        Assert.False(coordinator.IsBusy);
    }

    [Fact]
    public async Task FailedPassPropagatesToOwnerWithoutBlockingLaterRequests()
    {
        var coordinator = new PersistencePassCoordinator();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            coordinator.RunAsync(PersistencePassKind.Session, _ => throw new InvalidOperationException()));

        var ran = false;
        await coordinator.RunAsync(PersistencePassKind.Session, _ => { ran = true; return Task.CompletedTask; });
        Assert.True(ran);
        Assert.False(coordinator.IsBusy);
    }

    [Fact]
    public async Task FailedSettingsOwnerStillUnblocksQueuedSessionCaller()
    {
        // Truthful failure semantics: the failed owner observes the exception and
        // coalesced retries are abandoned; the queued caller is not left hanging.
        var coordinator = new PersistencePassCoordinator();
        var entered = NewGate();
        var release = NewGate();

        var failingOwner = coordinator.RunAsync(PersistencePassKind.SettingsOnly, async _ =>
        {
            entered.TrySetResult();
            await release.Task;
            throw new InvalidOperationException();
        });
        await entered.Task;
        var queuedSession = coordinator.RunAsync(PersistencePassKind.Session, _ => Task.CompletedTask);

        release.TrySetResult();
        await Assert.ThrowsAsync<InvalidOperationException>(() => failingOwner);
        await queuedSession; // quiescence reached; next explicit request starts fresh
        Assert.False(coordinator.IsBusy);

        var recovered = false;
        await coordinator.RunAsync(PersistencePassKind.Session, _ => { recovered = true; return Task.CompletedTask; });
        Assert.True(recovered);
    }

    [Fact]
    public async Task CancellationSurfacesToOwnerAndUnblocksTheCoordinator()
    {
        var coordinator = new PersistencePassCoordinator();
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            coordinator.RunAsync(PersistencePassKind.Session, ct => { ct.ThrowIfCancellationRequested(); return Task.CompletedTask; }, cts.Token));
        Assert.False(coordinator.IsBusy);
    }

    [Fact]
    public async Task TrailingPassObservesLatestState()
    {
        var coordinator = new PersistencePassCoordinator();
        var state = 0;
        var observed = new List<int>();
        var entered = NewGate();
        var release = NewGate();

        // Both requests share one lambda shape that reads live state when it runs,
        // mirroring how the browser serializes its current session.
        Task PersistState(CancellationToken _) { observed.Add(Volatile.Read(ref state)); return Task.CompletedTask; }

        Volatile.Write(ref state, 1);
        var first = coordinator.RunAsync(PersistencePassKind.Session, async ct =>
        {
            await PersistState(ct);  // persist the current state (1)
            entered.TrySetResult();
            await release.Task;      // simulate slow persistence work
        });
        await entered.Task;

        // A second request arrives while pass one is still open, and the state
        // it cares about changes before anything else can run.
        var second = coordinator.RunAsync(PersistencePassKind.Session, PersistState);
        Volatile.Write(ref state, 42);

        release.TrySetResult();
        await Task.WhenAll(first, second);
        Assert.Equal([1, 42], observed);
    }

    [Fact]
    public async Task StressEveryConcurrentCallerIsCoveredByAPersistedSnapshot()
    {
        // The persisted snapshot must contain every writer's final value once all
        // callers have returned; a lost or weakened request would leave slots stale.
        var coordinator = new PersistencePassCoordinator();
        const int writers = 48;
        var state = new int[writers];
        var snapshots = new List<int[]>();

        Task Persist(CancellationToken _)
        {
            lock (snapshots) snapshots.Add((int[])state.Clone());
            return Task.CompletedTask;
        }

        var callers = Enumerable.Range(0, writers).Select(async i =>
        {
            await Task.Delay(i % 9);
            Volatile.Write(ref state[i], i + 1);
            await coordinator.RunAsync(PersistencePassKind.Session, Persist);
        }).ToList();

        await Task.WhenAll(callers);
        await coordinator.DrainAsync();

        var final = snapshots[^1];
        for (var i = 0; i < writers; i++) Assert.Equal(i + 1, final[i]);
        Assert.False(coordinator.IsBusy);
    }
}

public sealed class ExpiryLeaseTrackerTests
{
    [Fact]
    public void NewestLeaseDismissesOlderExpirations()
    {
        var tracker = new ExpiryLeaseTracker();
        var first = tracker.Arm();
        Assert.True(tracker.ShouldDismiss(first));

        var second = tracker.Arm();
        Assert.False(tracker.ShouldDismiss(first));  // an older expiry never acts
        Assert.True(tracker.ShouldDismiss(second));  // the newest dismisses
    }

    [Fact]
    public void UnknownOrStaleGenerationsNeverDismiss()
    {
        var tracker = new ExpiryLeaseTracker();
        Assert.False(tracker.ShouldDismiss(0));
        Assert.False(tracker.ShouldDismiss(99));
        tracker.Arm(); tracker.Arm(); tracker.Arm();
        Assert.False(tracker.ShouldDismiss(1));
        Assert.False(tracker.ShouldDismiss(2));
        Assert.Equal(3, tracker.CurrentGeneration);
    }

    [Fact]
    public void RepeatedArmingMatchesNotificationAndSwitcherReuse()
    {
        // Simulates: show A (lifetime X), superseded by B, then C. Only C's
        // expiration may close anything; each later notification still expires.
        var tracker = new ExpiryLeaseTracker();
        var a = tracker.Arm();
        var b = tracker.Arm();
        Assert.False(tracker.ShouldDismiss(a));
        var c = tracker.Arm();
        Assert.False(tracker.ShouldDismiss(b));
        Assert.True(tracker.ShouldDismiss(c));
    }
}

public sealed class BackgroundWorkTrackerTests
{
    [Fact]
    public async Task DrainAwaitsTheTrackedTaskBeforeCompletion()
    {
        var tracker = new BackgroundWorkTracker();
        Assert.False(await tracker.DrainAsync());   // nothing tracked

        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var work = Task.Run(async () => { entered.TrySetResult(); await release.Task; });
        tracker.Track(work);

        Assert.True(tracker.IsActive);
        var drain = tracker.DrainAsync();
        release.TrySetResult();
        Assert.True(await drain);
        Assert.False(tracker.IsActive);
    }

    [Fact]
    public async Task DrainHonorsCancellationWithoutTouchingTheWork()
    {
        var tracker = new BackgroundWorkTracker();
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var work = Task.Run(async () => await gate.Task);
        tracker.Track(work);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => tracker.DrainAsync(cts.Token));
        Assert.True(tracker.IsActive);              // the work itself is untouched
        gate.TrySetResult();
    }

    [Fact]
    public void CompletedWorkIsImmediatelyInactive()
    {
        var tracker = new BackgroundWorkTracker();
        tracker.Track(Task.CompletedTask);
        Assert.False(tracker.IsActive);
    }
}

public sealed class NoteTargetSelectionTests
{
    [Fact]
    public void EditingAlwaysUsesTheStoredRecordTarget()
    {
        // The active surface in this scenario is the native notes manager page,
        // whose URL can never carry a note; editing must not consult it at all.
        const string activeManagerSurface = "sutra://page/notes";
        Assert.NotEqual(activeManagerSurface, NoteTargets.Normalize("https://example.com/article#frag"));
        var target = NoteTargetSelection.ResolveEditTarget("https://example.com/article#frag");
        Assert.Equal("https://example.com/article", target);
    }

    [Fact]
    public void EditingRejectsRecordsWhoseUrlIsNoLongerAWebPage()
    {
        Assert.Throws<ArgumentException>(() => NoteTargetSelection.ResolveEditTarget("javascript:alert(1)"));
    }

    [Theory]
    [InlineData("sutra://page/notes")]
    [InlineData("browser://newtab")]
    [InlineData("data:text/html,error")]
    [InlineData(null)]
    public void AddingFromNativeSurfacesYieldsNoTarget(string? activeSurface)
    {
        Assert.Null(NoteTargetSelection.TryResolveAddTarget(activeSurface));
    }

    [Fact]
    public void AddingFromARealPageNormalizesTheTarget()
    {
        Assert.Equal("https://example.com/page", NoteTargetSelection.TryResolveAddTarget("HTTPS://EXAMPLE.COM/page#top"));
    }
}

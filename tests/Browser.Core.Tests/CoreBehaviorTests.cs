using Browser.Core.Navigation;
using Browser.Core.Onboarding;
using Browser.Core.Bookmarks;
using Browser.Core.Passwords;
using Browser.Core.Privacy;
using Browser.Core.Integration;
using Browser.Core.Updates;
using System.Security.Cryptography;
using Browser.Core.Sessions;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using System.Text.Json;
using Xunit;

namespace Browser.Core.Tests;

public sealed class AddressResolverTests
{
    [Theory]
    [InlineData("example.com", "https://example.com/")]
    [InlineData("localhost:8080/path", "http://localhost:8080/path")]
    [InlineData("127.0.0.1:5000", "http://127.0.0.1:5000/")]
    [InlineData("https://example.com/a", "https://example.com/a")]
    public void DetectsUrls(string input, string expected) { var result=AddressResolver.Resolve(input); Assert.False(result.IsSearch); Assert.Equal(expected,result.Uri.AbsoluteUri); }

    [Theory]
    [InlineData("weather tomorrow")]
    [InlineData("not a domain")]
    [InlineData("hello_world")]
    public void DetectsSearches(string input) { var result=AddressResolver.Resolve(input); Assert.True(result.IsSearch); Assert.Equal(input,result.SearchQuery); }

    [Fact]
    public void BuildsAllSearchEnginesAndEscapesQuery()
    {
        Assert.Equal("www.google.com",AddressResolver.BuildSearchUri("a & b",SearchEngine.Google).Host);
        Assert.Equal("www.bing.com",AddressResolver.BuildSearchUri("a & b",SearchEngine.Bing).Host);
        Assert.Equal("duckduckgo.com",AddressResolver.BuildSearchUri("a & b",SearchEngine.DuckDuckGo).Host);
        Assert.All(Enum.GetValues<SearchEngine>(), e => Assert.Contains("a%20%26%20b", AddressResolver.BuildSearchUri("a & b",e).Query));
    }

    [Fact]
    public void InternalNewTabAddressIsNeverSentToSearch()
    {
        var result=AddressResolver.Resolve("browser://newtab",SearchEngine.Google);
        Assert.False(result.IsSearch);Assert.Equal("browser",result.Uri.Scheme);Assert.Equal("newtab",result.Uri.Host);
    }
}

public sealed class NavigationConvenienceTests
{
    [Theory]
    [InlineData("https://accounts.google.com/gsi/transform", true)]
    [InlineData("https://login.microsoftonline.com/common/oauth2", true)]
    [InlineData("https://appleid.apple.com/auth/authorize", true)]
    [InlineData("http://accounts.google.com/gsi", false)]
    [InlineData("https://accounts.google.com.attacker.example/gsi", false)]
    [InlineData("https://example.com/oauth", false)]
    public void OnlyTrustedHttpsIdentityProvidersUseAuthenticationWindows(string url, bool expected)
        => Assert.Equal(expected, AuthenticationPopupPolicy.ShouldOpenInAuthenticationWindow(url));

    [Theory]
    [InlineData("@g winui webview2", "google.com", "winui webview2")]
    [InlineData("!b fluent design", "bing.com", "fluent design")]
    [InlineData("!ddg private search", "duckduckgo.com", "private search")]
    public void SearchShortcutsOverrideDefaultEngine(string input, string host, string query)
    {
        var target = AddressResolver.Resolve(input, SearchEngine.Google);
        Assert.True(target.IsSearch);
        Assert.Contains(host, target.Uri.Host);
        Assert.Equal(query, target.SearchQuery);
    }

    [Fact]
    public void CustomSearchAliasUsesEscapedQueryAndBeatsDefaultSearch()
    {
        var aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["yt"] = "https://www.youtube.com/results?search_query={query}"
        };
        var target = AddressResolver.Resolve("yt cats & dogs", SearchEngine.Google, aliases);
        Assert.True(target.IsSearch);
        Assert.Equal("www.youtube.com", target.Uri.Host);
        Assert.Contains("cats%20%26%20dogs", target.Uri.Query);
        Assert.Equal("cats & dogs", target.SearchQuery);
    }

    [Fact]
    public void CleanLinkRemovesKnownTrackingWithoutLosingPageState()
    {
        var clean = UrlSanitizer.RemoveTrackingParameters("https://example.com/page?utm_source=x&item=42&fbclid=secret#details");
        Assert.Equal("https://example.com/page?item=42#details", clean);
    }

    [Fact]
    public void CleanLinkLeavesNonWebAndNormalParametersUnchanged()
    {
        Assert.Equal("about:blank", UrlSanitizer.RemoveTrackingParameters("about:blank"));
        Assert.Equal("https://example.com/?q=hello", UrlSanitizer.RemoveTrackingParameters("https://example.com/?q=hello"));
    }

    [Fact]
    public void BookmarkImportRejectsCredentialBearingUrls()
    {
        var html = "<a href='https://user:password@example.com'>Unsafe</a>";
        Assert.Empty(BookmarkHtml.Parse(html));
    }
}

public sealed class BookmarkHtmlTests
{
    [Fact]
    public void StandardBookmarkHtmlRoundTripsAndRejectsUnsafeSchemes()
    {
        var html=BookmarkHtml.Export([new("Example & docs","https://example.com/docs?q=1&x=2")],"Sutra bookmarks")+"<a href='javascript:alert(1)'>Bad</a>";
        var parsed=BookmarkHtml.Parse(html);
        Assert.Single(parsed);Assert.Equal("Example & docs",parsed[0].Title);Assert.Equal("https://example.com/docs?q=1&x=2",parsed[0].Url);
    }
}

public sealed class ChromeBookmarkImportTests
{
    [Fact]
    public void PreservesFolderAndBookmarkOrder()
    {
        using var document = JsonDocument.Parse("""{"roots":{"bookmark_bar":{"name":"Bookmarks bar","children":[{"type":"folder","name":"School","children":[{"type":"url","name":"First","url":"https://first.example"},{"type":"url","name":"Second","url":"https://second.example"}]},{"type":"url","name":"Third","url":"https://third.example"}]},"other":{"name":"Other bookmarks","children":[{"type":"url","name":"Fourth","url":"https://fourth.example"}]}}}""");
        var roots = ChromeBookmarkImport.ParseRoots(document.RootElement);
        var bar = Assert.IsType<ChromeBookmarkFolder>(roots[0]);
        Assert.Equal("Bookmarks bar", bar.Name);
        var school = Assert.IsType<ChromeBookmarkFolder>(bar.Children[0]);
        Assert.Equal("School", school.Name);
        Assert.Equal("First", Assert.IsType<ChromeBookmarkLink>(school.Children[0]).Title);
        Assert.Equal("Second", Assert.IsType<ChromeBookmarkLink>(school.Children[1]).Title);
        Assert.Equal("Third", Assert.IsType<ChromeBookmarkLink>(bar.Children[1]).Title);
        Assert.Equal("Other bookmarks", Assert.IsType<ChromeBookmarkFolder>(roots[1]).Name);
        Assert.Equal(4, ChromeBookmarkImport.CountLinks(roots));
    }
}

public sealed class TabTests
{
    [Fact]
    public void PinnedTabsRemainFirstWithoutReorderingGroups()
    {
        var a=new BrowserTab{Title="A"};var b=new BrowserTab{Title="B",IsPinned=true};var c=new BrowserTab{Title="C",IsPinned=true};var d=new BrowserTab{Title="D"};
        Assert.Equal(["B","C","A","D"],TabOrdering.PinnedFirst([a,b,c,d]).Select(x=>x.Title));
    }

    [Fact]
    public void HibernationIsConservative()
    {
        var now=DateTimeOffset.UtcNow;var active=new BrowserTab();var candidate=new BrowserTab{Url="https://example.com",LastActivatedAt=now.AddHours(-2)};var settings=new HibernationSettings(true,30,true,new HashSet<string>());
        Assert.True(HibernationPolicy.CanHibernate(candidate,active,settings,now));
        candidate.MayHaveUnsavedFormInput=true;Assert.False(HibernationPolicy.CanHibernate(candidate,active,settings,now));
        candidate.MayHaveUnsavedFormInput=false;candidate.IsMediaPlaying=true;Assert.False(HibernationPolicy.CanHibernate(candidate,active,settings,now));
        candidate.IsMediaPlaying=false;Assert.False(HibernationPolicy.CanHibernate(active,active,settings,now));
    }

    [Fact]
    public void ExclusionsMatchSubdomainsButNotLookalikes()
    {
        var now=DateTimeOffset.UtcNow;var active=new BrowserTab();var s=new HibernationSettings(true,1,false,new HashSet<string>{"example.com"});
        Assert.False(HibernationPolicy.CanHibernate(new(){Url="https://mail.example.com",LastActivatedAt=now.AddHours(-1)},active,s,now));
        Assert.True(HibernationPolicy.CanHibernate(new(){Url="https://notexample.com",LastActivatedAt=now.AddHours(-1)},active,s,now));
    }

    [Fact]
    public void HibernatedStateRoundTrips()
    {
        var groupId=Guid.NewGuid();var tab=new BrowserTab{Url="https://example.com",Title="Example",IsHibernated=true,ScrollPosition=812.5,IsPinned=true,GroupName="Research",GroupId=groupId};
        var restored=BrowserTab.FromSnapshot(tab.ToSnapshot());
        Assert.True(restored.IsHibernated);Assert.True(restored.IsPinned);Assert.Equal(812.5,restored.ScrollPosition);Assert.Equal(tab.Id,restored.Id);Assert.Equal("Research",restored.GroupName);Assert.Equal(groupId,restored.GroupId);
    }

    [Theory]
    [InlineData("about:blank")]
    [InlineData("data:text/html,old-error-page")]
    public void BrowserOwnedBlankPagesRestoreAsNewTabs(string savedUrl)
    {
        var restored=BrowserTab.FromSnapshot(new BrowserTab{Url=savedUrl,Title=savedUrl}.ToSnapshot());
        Assert.Equal("browser://newtab",restored.Url);Assert.Equal("New tab",restored.Title);
    }
}

public sealed class SessionAndSettingsTests
{
    [Fact]
    public void SessionRoundTripsAndRejectsCorruption()
    {
        var tab=new BrowserTab{Url="https://example.com",Title="One"};var second=new BrowserTab{Url="https://example.org",Title="Two"};var session=new BrowserSession([tab.ToSnapshot(),second.ToSnapshot()],tab.Id,DateTimeOffset.UtcNow,[tab.Id,second.Id]);
        var restored=SessionSerializer.Deserialize(SessionSerializer.Serialize(session));
        Assert.Equal(2,restored.Tabs.Count);Assert.Equal(tab.Id,restored.ActiveTabId);Assert.Equal([tab.Id,second.Id],restored.SplitTabIds);Assert.Empty(SessionSerializer.Deserialize("{oops").Tabs);
    }

    [Fact]
    public void SessionDropsInvalidAndSinglePaneSplitState()
    {
        var tab=new BrowserTab{Url="https://example.com"};var unknown=Guid.NewGuid();
        var restored=SessionSerializer.Deserialize(SessionSerializer.Serialize(new([tab.ToSnapshot()],tab.Id,DateTimeOffset.UtcNow,[tab.Id,unknown])));
        Assert.Empty(restored.SplitTabIds!);
    }

    [Fact]
    public void SessionPersistsGroupsAndDropsUnknownGroupAssignments()
    {
        var group=new TabGroup{ Name="Study", Note="SAT research", Color="#7c5cfc", IsCollapsed=true, NeverHibernate=true, SortOrder=2};
        var tab=new BrowserTab{Url="https://example.com",GroupId=group.Id,GroupName=group.Name};
        var restored=SessionSerializer.Deserialize(SessionSerializer.Serialize(new([tab.ToSnapshot()],tab.Id,DateTimeOffset.UtcNow,[],[group.ToSnapshot()])));
        Assert.Single(restored.Groups!);Assert.Equal("#7C5CFC",restored.Groups![0].Color);Assert.Equal("SAT research",restored.Groups[0].Note);Assert.True(restored.Groups[0].NeverHibernate);Assert.Equal(group.Id,restored.Tabs[0].GroupId);
        var withoutGroup=SessionSerializer.Deserialize(SessionSerializer.Serialize(new([tab.ToSnapshot()],tab.Id,DateTimeOffset.UtcNow,[],[])));
        Assert.Null(withoutGroup.Tabs[0].GroupId);
    }

    [Fact]
    public void SessionDropsGroupsWithNoRemainingTabs()
    {
        var orphan=new TabGroup{Name="Orphan",Color="#C43E5C"};
        var live=new TabGroup{Name="Live",Color="#4C8DFF"};
        var tab=new BrowserTab{Url="https://example.com",GroupId=live.Id,GroupName=live.Name};
        var restored=SessionSerializer.Deserialize(SessionSerializer.Serialize(new([tab.ToSnapshot()],tab.Id,DateTimeOffset.UtcNow,[],[orphan.ToSnapshot(),live.ToSnapshot()])));
        Assert.Single(restored.Groups!);Assert.Equal("Live",restored.Groups![0].Name);Assert.Equal(live.Id,restored.Tabs[0].GroupId);
    }

    [Fact]
    public void SettingsAreClampedAndMalformedValuesReplaced()
    {
        var result=SettingsValidator.Validate(new(){HibernationMinutes=-5,AiMaximumActions=999,AiActionTimeoutSeconds=0,HomePage="not url",OllamaBaseUrl="file:///bad",DarkThemeStartHour=99,WindowWidth=100,ThemeSurfaceColor="invalid",ThemeTextColor="#FFFFFF"});
        Assert.Equal(1,result.HibernationMinutes);Assert.Equal(50,result.AiMaximumActions);Assert.Equal(2,result.AiActionTimeoutSeconds);Assert.Equal("browser://newtab",result.HomePage);Assert.Equal("http://localhost:11434",result.OllamaBaseUrl);Assert.Equal(23,result.DarkThemeStartHour);Assert.Equal(720,result.WindowWidth);
        Assert.Equal(12,result.ToolbarOrder.Length);Assert.Equal("Address",result.ToolbarOrder[4]);
        Assert.Equal(Browser.Core.Branding.AppBrand.AccentColor, result.ThemeSurfaceColor);Assert.Equal("#FFFFFF", result.ThemeTextColor);
    }

    [Fact]
    public void SiteZoomPreferencesAreNormalizedToOriginsAndSafeBounds()
    {
        var settings = SettingsValidator.Validate(new() { SiteZoomFactors = new Dictionary<string, double>
        {
            ["https://Example.com/path"] = 9,
            ["http://localhost:8080/anything"] = .1,
            ["file:///private"] = 2
        }});
        Assert.Equal(5, settings.SiteZoomFactors["https://example.com"]);
        Assert.Equal(.25, settings.SiteZoomFactors["http://localhost:8080"]);
        Assert.DoesNotContain(settings.SiteZoomFactors, x => x.Key.StartsWith("file:", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void SearchAliasesRequireAQueryPlaceholderAndHttpTemplate()
    {
        var result = SettingsValidator.Validate(new BrowserSettings
        {
            SearchAliases = new Dictionary<string, string>
            {
                ["yt"] = "https://youtube.com/results?search_query={query}",
                ["bad alias"] = "https://example.com/?q={query}",
                ["file"] = "file:///private/{query}",
                ["missing"] = "https://example.com/"
            }
        });
        Assert.Single(result.SearchAliases);
        Assert.Contains("yt", result.SearchAliases.Keys);
    }

    [Theory]
    [InlineData(21, BrowserTheme.Dark)]
    [InlineData(2, BrowserTheme.Dark)]
    [InlineData(12, BrowserTheme.Light)]
    public void ScheduledThemeHandlesMidnight(int hour, BrowserTheme expected)
    {
        var settings=new BrowserSettings{UseScheduledTheme=true,DarkThemeStartHour=20,LightThemeStartHour=7};
        Assert.Equal(expected,ThemeSchedule.Resolve(settings,hour));
    }

    [Theory]
    [InlineData("Ctrl+Shift+P", "P", true, true, false)]
    [InlineData("Alt+F8", "F8", false, false, true)]
    public void CustomShortcutsAreParsedAndNormalized(string text,string key,bool control,bool shift,bool alt)
    {
        Assert.True(ShortcutDefinition.TryParse(text,out var shortcut));Assert.Equal(key,shortcut.Key);Assert.Equal(control,shortcut.Control);Assert.Equal(shift,shortcut.Shift);Assert.Equal(alt,shortcut.Alt);
        Assert.False(ShortcutDefinition.TryParse("Ctrl+Shift",out _));Assert.False(ShortcutDefinition.TryParse("Ctrl+NotAKey",out _));
    }

    [Fact]
    public void SutraSaveShortcutCanBeConfigured()
    {
        var settings = SettingsValidator.Validate(new BrowserSettings
        {
            CustomShortcuts = new Dictionary<string, string> { ["SutraSave"] = "Ctrl+Alt+Z" }
        });
        Assert.Equal("Ctrl+Alt+Z", settings.CustomShortcuts["SutraSave"]);
    }
}

public sealed class OnboardingTests
{
    [Fact]
    public void FreshRegularLaunchIsEligible()
    {
        Assert.True(OnboardingEligibility.ShouldShow(false, false, true, false, false, null));
    }

    [Theory]
    [InlineData(true, false, true, false, false)]
    [InlineData(false, true, true, false, false)]
    [InlineData(false, false, false, false, false)]
    [InlineData(false, false, true, true, false)]
    [InlineData(false, false, true, false, true)]
    public void PrivateExistingOrNonRegularLaunchIsNotEligible(bool isPrivate, bool hasInitialUrl, bool regularWindow, bool hasSettings, bool hasSession)
    {
        Assert.False(OnboardingEligibility.ShouldShow(isPrivate, hasInitialUrl, regularWindow, hasSettings, hasSession, null));
    }

    [Fact]
    public void CompletedOrSkippedStateIsNotEligible()
    {
        var completed = OnboardingState.Create(OnboardingCompletion.Completed, DateTimeOffset.UnixEpoch);
        var skipped = OnboardingState.Create(OnboardingCompletion.Skipped, DateTimeOffset.UnixEpoch);

        Assert.False(OnboardingEligibility.ShouldShow(false, false, true, false, false, completed));
        Assert.False(OnboardingEligibility.ShouldShow(false, false, true, false, false, skipped));
        Assert.True(OnboardingEligibility.IsFinished(completed));
    }

    [Theory]
    [InlineData(OnboardingCompletion.Completed)]
    [InlineData(OnboardingCompletion.Skipped)]
    public void StateRoundTrips(OnboardingCompletion completion)
    {
        var original = OnboardingState.Create(completion, DateTimeOffset.UnixEpoch);
        var json = OnboardingState.Serialize(original);

        Assert.True(OnboardingState.TryDeserialize(json, out var restored));
        Assert.Equal(original, restored);
    }

    [Theory]
    [InlineData("")]
    [InlineData("{oops")]
    [InlineData("{\"Version\":2,\"Completion\":0,\"RecordedAt\":\"1970-01-01T00:00:00+00:00\"}")]
    [InlineData("{\"Version\":1,\"Completion\":99,\"RecordedAt\":\"1970-01-01T00:00:00+00:00\"}")]
    public void MalformedOrUnsupportedStateFallsBack(string value)
    {
        Assert.False(OnboardingState.TryDeserialize(value, out var state));
        Assert.Null(state);
    }
}

public sealed class CredentialTests
{
    [Fact]
    public void OriginMatchingRequiresExactHttpsOrigin()
    {
        Assert.True(CredentialOrigin.IsExactMatch("https://example.com",new Uri("https://example.com/login")));
        Assert.False(CredentialOrigin.IsExactMatch("https://example.com",new Uri("https://sub.example.com/login")));
        Assert.False(CredentialOrigin.IsExactMatch("https://example.com",new Uri("http://example.com/login")));
        Assert.Throws<ArgumentException>(()=>CredentialOrigin.Normalize("http://example.com"));
    }

    [Fact]
    public async Task SecureStorageAbstractionCanBeTestedWithoutSecretsOnDisk()
    {
        var store=new MemoryStore();var id=Guid.NewGuid();await store.SaveAsync(id,new("user","secret"));
        Assert.Equal("secret",(await store.GetAsync(id))!.Password);await store.DeleteAsync(id);Assert.Null(await store.GetAsync(id));
    }

    private sealed class MemoryStore:ISecureCredentialStore
    { private readonly Dictionary<Guid,CredentialSecret> _items=[];public Task SaveAsync(Guid id,CredentialSecret secret,CancellationToken c=default){_items[id]=secret;return Task.CompletedTask;}public Task<CredentialSecret?> GetAsync(Guid id,CancellationToken c=default)=>Task.FromResult(_items.GetValueOrDefault(id));public Task DeleteAsync(Guid id,CancellationToken c=default){_items.Remove(id);return Task.CompletedTask;} }
}

public sealed class PrivateBrowsingTests
{
    [Fact]
    public void PrivateWindowPersistsOnlyExplicitUserArtifacts()
    {
        Assert.True(PrivateBrowsingPolicy.PersistsAfterWindowCloses(PrivateDataKind.Bookmark));
        Assert.True(PrivateBrowsingPolicy.PersistsAfterWindowCloses(PrivateDataKind.DownloadedFile));
        Assert.False(PrivateBrowsingPolicy.PersistsAfterWindowCloses(PrivateDataKind.History));
        Assert.False(PrivateBrowsingPolicy.PersistsAfterWindowCloses(PrivateDataKind.Session));
        Assert.False(PrivateBrowsingPolicy.PersistsAfterWindowCloses(PrivateDataKind.DownloadMetadata));
        Assert.False(PrivateBrowsingPolicy.PersistsAfterWindowCloses(PrivateDataKind.PermissionDecision));
        Assert.False(PrivateBrowsingPolicy.PersistsAfterWindowCloses(PrivateDataKind.AiActionLog));
    }

    [Fact]
    public void PrivateWindowStartsWithCredentialsAndAiDisabled()
    {
        Assert.False(PrivateBrowsingPolicy.AllowsCredentialAccess);
        Assert.False(PrivateBrowsingPolicy.EnablesAiByDefault);
    }
}

public sealed class ContentBlockerTests
{
    [Fact]
    public void ParsesNetworkExceptionsAndSubdomains()
    {
        var rules=ContentBlockRuleSet.Parse(["||ads.example.com^","@@||allowed.ads.example.com^"]);
        Assert.True(rules.ShouldBlock(new Uri("https://cdn.ads.example.com/banner.js")));
        Assert.False(rules.ShouldBlock(new Uri("https://allowed.ads.example.com/banner.js")));
        Assert.False(rules.ShouldBlock(new Uri("https://notads.example.com/banner.js")));
    }

    [Fact]
    public void PathRulesBlockOnlyMatchingPaths()
    {
        var rules=ContentBlockRuleSet.Parse(["||www.google.com/pagead/", "@@||www.google.com/pagead/allowed", "||ads.example.com^"]);
        Assert.False(rules.ShouldBlock(new Uri("https://www.google.com/search?q=test")));
        Assert.True(rules.ShouldBlock(new Uri("https://www.google.com/pagead/banner.js")));
        Assert.False(rules.ShouldBlock(new Uri("https://www.google.com/pagead/allowed?id=1")));
        Assert.True(rules.ShouldBlock(new Uri("https://ads.example.com/banner.js")));
    }

    [Fact]
    public void CosmeticRulesAreScopedAndUnsafeSelectorsIgnored()
    {
        var rules=ContentBlockRuleSet.Parse(["##.global-ad","example.com##.sponsor","example.com##body{display:none}"]);
        Assert.Equal([".global-ad",".sponsor"],rules.CosmeticSelectorsFor("news.example.com").Order());
        Assert.Equal([".global-ad"],rules.CosmeticSelectorsFor("other.test"));
    }

    [Fact]
    public void BuiltInFallbackBlocksCommonAdInfrastructure()
    {
        var rules = ContentBlockRuleSet.Parse(BuiltInContentFilters.Rules);
        Assert.True(rules.ShouldBlock(new Uri("https://securepubads.g.doubleclick.net/tag/js/gpt.js")));
        Assert.True(rules.ShouldBlock(new Uri("https://ads.pubmatic.com/AdServer/js/showad.js")));
        Assert.Contains("[data-ad-slot]", rules.CosmeticSelectorsFor("news.example.com"));
    }

    [Fact]
    public void BuiltInFiltersIncludeYoutubeBlockingRules()
    {
        var rules = ContentBlockRuleSet.Parse(BuiltInContentFilters.Rules);
        var selectors = rules.CosmeticSelectorsFor("www.youtube.com");
        Assert.Contains("ytd-promoted-video-renderer", selectors);
        Assert.DoesNotContain(".ytp-ad-skip-button", selectors);
        Assert.DoesNotContain(".ad-showing", selectors);
        Assert.DoesNotContain(".ytp-ad-module", selectors);
        Assert.False(rules.ShouldBlock(new Uri("https://youtubei.googleapis.com/youtubei/v1/next?key=abc")));
        Assert.False(rules.ShouldBlock(new Uri("https://youtubei.googleapis.com/youtubei/v1/player?key=abc")));
        Assert.True(rules.ShouldBlock(new Uri("https://www.youtube.com/api/stats/ads?something")));
        Assert.False(rules.ShouldBlock(new Uri("https://www.youtube.com/get_video_info")));
        Assert.False(rules.ShouldBlock(new Uri("https://www.youtube.com/watch?v=dQw4w9WgXcQ")));
    }
}

public sealed class SutraIntegrationBoundaryTests
{
    [Fact]
    public void StandardFilterOptionsScopeRulesAndExceptionsWin()
    {
        var rules = ContentBlockRuleSet.Parse([
            "||ads.example.net^$script,third-party,domain=example.com",
            "@@||ads.example.net/allowed.js$script"
        ]);
        Assert.True(rules.ShouldBlock(new Uri("https://ads.example.net/banner.js"), "news.example.com", "script"));
        Assert.False(rules.ShouldBlock(new Uri("https://ads.example.net/banner.png"), "news.example.com", "image"));
        Assert.False(rules.ShouldBlock(new Uri("https://ads.example.net/banner.js"), "other.test", "script"));
        Assert.False(rules.ShouldBlock(new Uri("https://ads.example.net/allowed.js"), "news.example.com", "script"));
    }

    [Fact]
    public void StandardSeparatorAndDomainAnchorsMatchOnlyTheIntendedResource()
    {
        var rules = ContentBlockRuleSet.Parse(["||ads.example.net/banner*^", "||tracking.example.net/pixel^"]);
        Assert.True(rules.ShouldBlock(new Uri("https://ads.example.net/banner-1.png")));
        Assert.True(rules.ShouldBlock(new Uri("https://ads.example.net/banner1png"))); // ^ also matches the end of the URL.
        Assert.False(rules.ShouldBlock(new Uri("https://ads.example.net/images/banner1png")));
        Assert.True(rules.ShouldBlock(new Uri("https://tracking.example.net/pixel?id=2")));
        Assert.False(rules.ShouldBlock(new Uri("https://tracking.example.net/images/pixel")));
    }

    [Fact]
    public void CosmeticExceptionsWinRegardlessOfListOrder()
    {
        var rules = ContentBlockRuleSet.Parse(["example.com#@#.sponsor", "##.sponsor"]);
        Assert.DoesNotContain(".sponsor", rules.CosmeticSelectorsFor("news.example.com"));
    }

    [Fact]
    public void StandardTypeCaseEndAnchorAndExcludedCosmeticDomainsAreRespected()
    {
        var rules = ContentBlockRuleSet.Parse(["||ads.example.net/Upper.js|$script,match-case", "||tracking.example.net^$xmlhttprequest", "~safe.example.com##.ad", "news.example.com,~sports.news.example.com##[id^='ad-']"]);
        Assert.True(rules.ShouldBlock(new Uri("https://ads.example.net/Upper.js"), "news.example.com", "script"));
        Assert.False(rules.ShouldBlock(new Uri("https://ads.example.net/upper.js"), "news.example.com", "script"));
        Assert.False(rules.ShouldBlock(new Uri("https://ads.example.net/Upper.js?v=1"), "news.example.com", "script"));
        Assert.True(rules.ShouldBlock(new Uri("https://tracking.example.net/t"), "news.example.com", "fetch"));
        Assert.DoesNotContain(".ad", rules.CosmeticSelectorsFor("safe.example.com"));
        Assert.Contains(".ad", rules.CosmeticSelectorsFor("news.example.com"));
        Assert.Contains("[id^='ad-']", rules.CosmeticSelectorsFor("news.example.com"));
        Assert.DoesNotContain("[id^='ad-']", rules.CosmeticSelectorsFor("sports.news.example.com"));
        var unsupported = ContentBlockRuleSet.Parse(["||ads.example.net^$removeparam=id", "||ads.example.net^$domain=not-a-domain"]);
        Assert.False(unsupported.ShouldBlock(new Uri("https://ads.example.net/t")));
    }

    [Fact]
    public void ThirdPartyFiltersRespectPublicSuffixesAndBoundedRegexRules()
    {
        var rules = ContentBlockRuleSet.Parse(["||ads.vendor.co.uk^$third-party", "/advert[0-9]+\\.js/$script", "||ads.example.net:8443/pixel^"]);
        Assert.True(rules.ShouldBlock(new Uri("https://ads.vendor.co.uk/pixel"), "news.publisher.co.uk", "image"));
        Assert.False(rules.ShouldBlock(new Uri("https://ads.vendor.co.uk/pixel"), "www.vendor.co.uk", "image"));
        Assert.True(rules.ShouldBlock(new Uri("https://example.com/advert42.js"), "example.com", "script"));
        Assert.False(rules.ShouldBlock(new Uri("https://example.com/advert42.js"), "example.com", "image"));
        Assert.True(rules.ShouldBlock(new Uri("https://ads.example.net:8443/pixel?id=1")));
        Assert.Equal("one.github.io", PublicSuffixDomains.RegistrableDomain("one.github.io"));
        Assert.Equal("city.kawasaki.jp", PublicSuffixDomains.RegistrableDomain("www.city.kawasaki.jp"));
        Assert.Equal("a.b.ck", PublicSuffixDomains.RegistrableDomain("a.b.ck"));
    }

    [Theory]
    [InlineData("/advert[0-9]+\\.js$/")]
    [InlineData("/advert[0-9]+\\.js$/$script")]
    public void RegexEndAnchorsDoNotBecomeFilterOptions(string filter)
    {
        var rules = ContentBlockRuleSet.Parse([filter]);
        Assert.Equal(1, rules.NetworkRuleCount);
        Assert.True(rules.ShouldBlock(new Uri("https://example.com/advert42.js"), "example.com", "script"));
        Assert.False(rules.ShouldBlock(new Uri("https://example.com/advert42.js?keep=1"), "example.com", "script"));
    }

    [Theory]
    [InlineData("Default")]
    [InlineData("SutraWorkspace")]
    [InlineData("SutraPrivate")]
    [InlineData("School")]
    public void WebsiteProfilesCannotAliasTheSutraWorkspace(string profileName)
    {
        Assert.NotEqual(SutraBridgeProtocol.WorkspaceProfileName, Browser.Core.Profiles.ProfileIdentity.WebViewName(profileName));
    }

    [Fact]
    public void ElementHideRulesAreScopedPersistentAndUndoable()
    {
        var rules = ElementHideRuleSet.Add([], "news.example.com", "article:nth-of-type(2) > .sponsor");
        var serialized = JsonSerializer.Serialize(rules);
        var restored = JsonSerializer.Deserialize<ElementHideRule[]>(serialized)!;
        Assert.Equal(["article:nth-of-type(2) > .sponsor"], ElementHideRuleSet.ForHost(restored, "news.example.com"));
        Assert.Empty(ElementHideRuleSet.ForHost(restored, "example.com"));
        Assert.Empty(ElementHideRuleSet.Remove(restored, "news.example.com", "article:nth-of-type(2) > .sponsor"));
        var twoRules = ElementHideRuleSet.Add(restored, "news.example.com", "#newsletter");
        var otherSite = ElementHideRuleSet.Add(twoRules, "other.example.com", ".popup");
        Assert.Equal(2, ElementHideRuleSet.ForHost(otherSite, "news.example.com").Count);
        Assert.Single(ElementHideRuleSet.ForHost(ElementHideRuleSet.Remove(otherSite, "news.example.com", "#newsletter"), "news.example.com"));
        Assert.Single(ElementHideRuleSet.ForHost(otherSite, "other.example.com"));
        Assert.Equal(restored, ElementHideRuleSet.Add(restored, "news.example.com", "body{display:none}"));
    }

    [Fact]
    public void NativeBridgeRequiresTrustedOriginVersionAllowlistedActionAndBoundedPayload()
    {
        var id = Guid.NewGuid();
        var valid = JsonSerializer.Serialize(new { version = 1, requestId = id, action = "open.external", payload = new { url = "https://example.com/path" } });
        Assert.True(SutraBridgeProtocol.TryParse("https://sutra.local/Sutra.html", valid, out var request));
        Assert.Equal("open.external", request!.Action);
        Assert.False(SutraBridgeProtocol.TryParse("https://sutra.local.attacker.test/Sutra.html", valid, out _));
        Assert.False(SutraBridgeProtocol.TryParse("https://sutra.local/Sutra.html", valid.Replace("\"version\":1", "\"version\":2"), out _));
        var unsafeUrl = JsonSerializer.Serialize(new { version = 1, requestId = id, action = "open.external", payload = new { url = "javascript:alert(1)" } });
        Assert.False(SutraBridgeProtocol.TryParse("https://sutra.local/Sutra.html", unsafeUrl, out _));
        var oversizedSourceAnnotation = JsonSerializer.Serialize(new { version = 1, requestId = id, action = "capture.source", payload = new { title = "A source", url = "https://example.com", excerpt = "", note = new string('x', 2001) } });
        Assert.False(SutraBridgeProtocol.TryParse("https://sutra.local/Sutra.html", oversizedSourceAnnotation, out _));
        var unknownAction = JsonSerializer.Serialize(new { version = 1, requestId = id, action = "run.script", payload = new { code = "x" } });
        Assert.False(SutraBridgeProtocol.TryParse("https://sutra.local/Sutra.html", unknownAction, out _));
    }

    [Fact]
    public void BrowserRestoresPreviousTabsByDefault()
    {
        Assert.Equal(StartupBehavior.RestorePreviousSession, new BrowserSettings().StartupBehavior);
    }

    [Fact]
    public void FilterRecoveryUsesLastKnownGoodWhenCurrentListIsImplausible()
    {
        var lastKnownGood = Enumerable.Range(0, 30).Select(i => $"||tracker{i}.example.net^").ToArray();
        var rules = ContentFilterRecoveryPolicy.Load(BuiltInContentFilters.Rules, ["this is not a filter"], lastKnownGood);
        Assert.True(rules.ShouldBlock(new Uri("https://tracker12.example.net/pixel")));
        Assert.Equal(ContentBlockRuleSet.Parse(BuiltInContentFilters.Rules.Concat(lastKnownGood)).NetworkRuleCount, rules.NetworkRuleCount);
        Assert.True(ContentFilterRecoveryPolicy.Load(BuiltInContentFilters.Rules, null, lastKnownGood).ShouldBlock(new Uri("https://tracker12.example.net/pixel")));
        Assert.Equal(ContentBlockRuleSet.Parse(BuiltInContentFilters.Rules).NetworkRuleCount, ContentFilterRecoveryPolicy.Load(BuiltInContentFilters.Rules, ["broken"], ["broken"]).NetworkRuleCount);
    }

    [Theory]
    [InlineData(false, false, false, false, true)]
    [InlineData(false, false, true, true, true)]
    [InlineData(false, false, true, false, false)]
    [InlineData(true, false, false, true, false)]
    [InlineData(false, true, false, true, false)]
    public void DesktopStartsInWorkspaceWhileExtraRestoredWindowsKeepTheirBrowserViews(bool isPrivate, bool hasUrl, bool hasSession, bool isInitialWindow, bool expected)
    {
        Assert.Equal(expected, SutraDesktopStartupPolicy.ShouldOpenWorkspace(isPrivate, hasUrl, hasSession, isInitialWindow));
    }

    [Fact]
    public void RestoredWindowsKeepTheirPersistenceIdentityAcrossRestarts()
    {
        var original = SutraDesktopStartupPolicy.ResolveWindowId(null);
        Assert.NotEqual(Guid.Empty, original);
        Assert.Equal(original, SutraDesktopStartupPolicy.ResolveWindowId(original));
        Assert.NotEqual(Guid.Empty, SutraDesktopStartupPolicy.ResolveWindowId(Guid.Empty));
        Assert.NotEqual(original, SutraDesktopStartupPolicy.ResolveWindowId(null));
    }

    [Fact]
    public void PdfImportRequiresAnExactNativeImportOriginAndToken()
    {
        var id = Guid.NewGuid();
        string Message(string url) => JsonSerializer.Serialize(new { version = 1, requestId = id, action = "capture.pdf", payload = new { title = "Paper", fileName = "Paper.pdf", importUrl = url, sourceUrl = "" } });
        Assert.True(SutraBridgeProtocol.TryParse(SutraBridgeProtocol.TrustedOrigin, Message($"https://sutra.local/__desktop_import/{Guid.NewGuid():N}.pdf"), out _));
        Assert.False(SutraBridgeProtocol.TryParse(SutraBridgeProtocol.TrustedOrigin, Message("file:///C:/secret.pdf"), out _));
        Assert.False(SutraBridgeProtocol.TryParse(SutraBridgeProtocol.TrustedOrigin, Message($"https://sutra.local.attacker.test/__desktop_import/{Guid.NewGuid():N}.pdf"), out _));
        Assert.False(SutraBridgeProtocol.TryParse(SutraBridgeProtocol.TrustedOrigin, Message("https://sutra.local/__desktop_import/arbitrary.pdf"), out _));
    }

    [Fact]
    public void RestorePolicyRejectsPrivateWindowsAndCrashLoopRestores()
    {
        var settings = new BrowserSettings { StartupBehavior = StartupBehavior.RestorePreviousSession };
        Assert.False(MultiWindowSessionPolicy.ShouldRestoreAutomatically(settings, isPrivate: true, hasLaunchSession: false, hasInitialUrl: false, crashNeedsReview: false));
        Assert.True(MultiWindowSessionPolicy.ShouldRestoreAutomatically(settings, isPrivate: false, hasLaunchSession: false, hasInitialUrl: false, crashNeedsReview: false));
        var now = DateTimeOffset.UtcNow;
        var recovery = StartupRecoveryPolicy.Begin(JsonSerializer.Serialize(new StartupRecoveryState(1, now.AddMinutes(-1))), previousShutdownWasClean: false, now);
        Assert.True(recovery.NeedsReview);
        Assert.False(MultiWindowSessionPolicy.ShouldRestoreAutomatically(settings, isPrivate: false, hasLaunchSession: false, hasInitialUrl: false, crashNeedsReview: recovery.NeedsReview));
    }

    [Fact]
    public void UpdateManifestRequiresValidSignatureAndReleaseAsset()
    {
        using var signer = RSA.Create(2048);
        var unsigned = new BrowserUpdateManifest("0.4.12", "https://github.com/tanujranjith/Sutra-Browser/releases/download/v1/SutraBrowserSetup.exe", new string('a', 64), new string('b', 40), DateTimeOffset.UtcNow.ToString("O"), "");
        var signature = Convert.ToBase64String(signer.SignData(System.Text.Encoding.UTF8.GetBytes(unsigned.SignedPayload), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        var signed = unsigned with { Signature = signature };
        Assert.True(signed.Verify(signer, new Uri("https://github.com")));
        Assert.False((signed with { Sha256 = new string('c', 64) }).Verify(signer, new Uri("https://github.com")));
        Assert.False((signed with { InstallerUrl = "https://evil.example/SutraBrowserSetup.exe" }).Verify(signer, new Uri("https://github.com")));
    }

    [Fact]
    public void ExtensionManifestSummaryIsBoundedAndIncludesHostPermissions()
    {
        const string manifest = """{"manifest_version":3,"name":"Reader","version":"1.2.0","permissions":["storage"],"host_permissions":["https://*.example.com/*"]}""";
        Assert.True(BrowserExtensionManifestPolicy.TryParse(manifest, out var summary));
        Assert.Equal("Reader", summary!.Name);
        Assert.Contains("storage", summary.Permissions);
        Assert.Contains("https://*.example.com/*", summary.Permissions);
        Assert.False(BrowserExtensionManifestPolicy.TryParse("{}", out _));
        Assert.False(BrowserExtensionManifestPolicy.TryParse(new string('x', BrowserExtensionManifestPolicy.MaximumManifestBytes + 1), out _));
    }

    [Theory]
    [InlineData("\"3\"")]
    [InlineData("null")]
    [InlineData("true")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("3.5")]
    [InlineData("2147483648")]
    public void ExtensionManifestRejectsInvalidVersionTypes(string version)
    {
        var json = "{\"manifest_version\":" + version + ",\"name\":\"Reader\",\"version\":\"1.2.0\"}";
        Assert.False(BrowserExtensionManifestPolicy.TryParse(json, out var summary));
        Assert.Null(summary);
    }
}

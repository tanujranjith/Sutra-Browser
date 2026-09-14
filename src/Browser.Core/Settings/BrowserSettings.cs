using Browser.Core.Navigation;

namespace Browser.Core.Settings;

public enum TabLayout { Horizontal, Vertical }
public enum StartupBehavior { NewTab, RestorePreviousSession }
public enum AiProviderKind { Ollama, OpenAiCompatible }
public enum BrowserTheme { System, Light, Dark }
public enum ToolbarDensity { Comfortable, Compact }
public enum NewTabAppearance { AccentTint, FollowBrowser, Light, Dark }
public enum MemorySaverMode { Balanced, Aggressive, Maximum }
public sealed record WebPanelDefinition(string Name, string Url);

public sealed record BrowserSettings
{
    public TabLayout TabLayout { get; init; } = TabLayout.Horizontal;
    public bool SidebarCollapsed { get; init; }
    public bool SidebarAutoHide { get; init; }
    public int SidebarWidth { get; init; } = 248;
    public Dictionary<string, double> SiteZoomFactors { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public BrowserTheme Theme { get; init; } = BrowserTheme.Dark;
    public bool UseScheduledTheme { get; init; }
    public int DarkThemeStartHour { get; init; } = 20;
    public int LightThemeStartHour { get; init; } = 7;
    public StartupBehavior StartupBehavior { get; init; } = StartupBehavior.NewTab;
    public SearchEngine SearchEngine { get; init; } = SearchEngine.DuckDuckGo;
    /// <summary>Local address-bar shortcuts such as "yt" → a URL template containing {query}.</summary>
    public Dictionary<string, string> SearchAliases { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public string HomePage { get; init; } = "browser://newtab";
    public bool HistoryEnabled { get; init; } = true;
    /// <summary>Zero keeps history until explicit deletion.</summary>
    public int HistoryRetentionDays { get; init; }
    public bool BookmarkBarVisible { get; init; }
    public bool OpenToolbarTabsInBackground { get; init; } = false;
    public bool OpenLinksInBackground { get; init; } = true;
    public bool PreventDuplicateTabs { get; init; } = true;
    public bool SuggestTabGroupsByDomain { get; init; }
    public bool ConfirmClosingProtectedTabs { get; init; } = true;
    public ToolbarDensity ToolbarDensity { get; init; } = ToolbarDensity.Comfortable;
    public bool ShowHomeButton { get; init; } = true;
    public bool ShowBookmarkButton { get; init; } = true;
    public bool ShowAiButton { get; init; } = true;
    public bool ShowSplitButton { get; init; } = true;
    public bool ShowMediaButton { get; init; } = true;
    public string[] ToolbarOrder { get; init; } = ["Back", "Forward", "Reload", "Home", "Address", "Bookmark", "Ai", "Menu"];
    public string[] WebProfiles { get; init; } = ["Default"];
    public Dictionary<string, string> CustomShortcuts { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public string AccentColor { get; init; } = "#F47A22";
    public bool UseCustomThemeColors { get; init; }
    public string ThemeSurfaceColor { get; init; } = "#101316";
    public string ThemeTextColor { get; init; } = "#F4F4F2";
    public string NewTabBackgroundPath { get; init; } = "";
    public NewTabAppearance NewTabAppearance { get; init; } = NewTabAppearance.Dark;
    public bool ShowPinnedBookmarksOnNewTab { get; init; } = true;
    public bool ShowFrequentSitesOnNewTab { get; init; } = true;
    public bool ShowRecentlyClosedOnNewTab { get; init; } = true;
    public bool AdBlockingEnabled { get; init; } = true;
    public bool CosmeticFilteringEnabled { get; init; } = true;
    public string[] AdBlockAllowlist { get; init; } = [];
    public string[] FilterListUrls { get; init; } = ["https://easylist.to/easylist/easylist.txt", "https://easylist.to/easylist/easyprivacy.txt"];
    public bool RemoveTrackingParametersFromCopiedLinks { get; init; } = true;
    public bool AutomaticHibernationEnabled { get; init; } = true;
    public int HibernationMinutes { get; init; } = 30;
    public MemorySaverMode MemorySaverMode { get; init; } = MemorySaverMode.Balanced;
    public int MemorySaverTabLimit { get; init; } = 18;
    public bool NeverHibernatePinnedTabs { get; init; } = true;
    public string[] HibernationExclusions { get; init; } = [];
    /// <summary>Website panels are definitions only. A panel WebView exists only while that panel is visible.</summary>
    public WebPanelDefinition[] WebPanels { get; init; } = [];
    public string DownloadFolder { get; init; } = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + "\\Downloads";
    public string OllamaBaseUrl { get; init; } = "http://localhost:11434";
    public string OllamaModel { get; init; } = "llama3.2";
    public string OpenAiEndpoint { get; init; } = "https://api.openai.com/v1";
    public string OpenAiModel { get; init; } = "gpt-4.1-mini";
    public AiProviderKind AiProvider { get; init; } = AiProviderKind.Ollama;
    public int AiMaximumActions { get; init; } = 20;
    public int AiActionTimeoutSeconds { get; init; } = 20;
    public int WindowWidth { get; init; } = 1400;
    public int WindowHeight { get; init; } = 900;
    public bool WindowMaximized { get; init; }
}

public static class SettingsValidator
{
    public static BrowserSettings Validate(BrowserSettings? value)
    {
        value ??= new();
        var home = value.HomePage == "browser://newtab" || Uri.TryCreate(value.HomePage, UriKind.Absolute, out _) ? value.HomePage : "browser://newtab";
        return value with
        {
            Theme = Enum.IsDefined(value.Theme) ? value.Theme : BrowserTheme.System,
            NewTabAppearance = Enum.IsDefined(value.NewTabAppearance) ? value.NewTabAppearance : NewTabAppearance.AccentTint,
            TabLayout = Enum.IsDefined(value.TabLayout) ? value.TabLayout : TabLayout.Horizontal,
            ToolbarDensity = Enum.IsDefined(value.ToolbarDensity) ? value.ToolbarDensity : ToolbarDensity.Comfortable,
            MemorySaverMode = Enum.IsDefined(value.MemorySaverMode) ? value.MemorySaverMode : MemorySaverMode.Balanced,
            HomePage = home,
            DarkThemeStartHour = Math.Clamp(value.DarkThemeStartHour, 0, 23),
            LightThemeStartHour = Math.Clamp(value.LightThemeStartHour, 0, 23),
            HibernationMinutes = Math.Clamp(value.HibernationMinutes, 1, 10080),
            HistoryRetentionDays = Math.Clamp(value.HistoryRetentionDays, 0, 3650),
            MemorySaverTabLimit = Math.Clamp(value.MemorySaverTabLimit, 4, 100),
            SidebarWidth = Math.Clamp(value.SidebarWidth, 180, 520),
            SiteZoomFactors = NormalizeSiteZoomFactors(value.SiteZoomFactors),
            SearchAliases = NormalizeSearchAliases(value.SearchAliases),
            AiMaximumActions = Math.Clamp(value.AiMaximumActions, 1, 50),
            AiActionTimeoutSeconds = Math.Clamp(value.AiActionTimeoutSeconds, 2, 120),
            OllamaBaseUrl = ValidHttp(value.OllamaBaseUrl, "http://localhost:11434"),
            OpenAiEndpoint = ValidHttp(value.OpenAiEndpoint, "https://api.openai.com/v1"),
            HibernationExclusions = CleanDomains(value.HibernationExclusions),
            WebPanels = NormalizeWebPanels(value.WebPanels),
            AdBlockAllowlist = CleanDomains(value.AdBlockAllowlist),
            FilterListUrls = value.FilterListUrls.Where(IsSafeHttpUri).Distinct().Take(8).ToArray(),
            AccentColor = ValidColor(value.AccentColor),
            ThemeSurfaceColor = ValidColor(value.ThemeSurfaceColor),
            ThemeTextColor = ValidColor(value.ThemeTextColor),
            ToolbarOrder = NormalizeToolbarOrder(value.ToolbarOrder),
            WebProfiles = NormalizeProfiles(value.WebProfiles),
            CustomShortcuts = NormalizeShortcuts(value.CustomShortcuts),
            NewTabBackgroundPath = value.NewTabBackgroundPath is { Length: < 2048 } ? value.NewTabBackgroundPath.Trim() : "",
            WindowWidth = Math.Clamp(value.WindowWidth, 720, 7680),
            WindowHeight = Math.Clamp(value.WindowHeight, 520, 4320)
        };
    }

    private static string ValidHttp(string value, string fallback) => IsSafeHttpUri(value) ? value.TrimEnd('/') : fallback;
    private static bool IsSafeHttpUri(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme is "http" or "https" && string.IsNullOrEmpty(uri.UserInfo);
    private static string[] CleanDomains(IEnumerable<string> values) => values.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim().TrimStart('.').ToLowerInvariant()).Where(x => !x.Contains('/') && !x.Contains(' ')).Distinct().ToArray();
    private static string ValidColor(string value) => value is { Length: 7 } && value[0] == '#' && value.Skip(1).All(Uri.IsHexDigit) ? value.ToUpperInvariant() : "#F47A22";
    private static string[] NormalizeToolbarOrder(IEnumerable<string>? values)
    {
        string[] allowed = ["Back", "Forward", "Reload", "Home", "Address", "Security", "Shield", "Bookmark", "Ai", "Split", "Media", "Menu"];
        var result = (values ?? []).Where(x => allowed.Contains(x, StringComparer.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        result.AddRange(allowed.Where(x => !result.Contains(x, StringComparer.OrdinalIgnoreCase)));
        return result.ToArray();
    }
    private static string[] NormalizeProfiles(IEnumerable<string>? values)
    {
        var result = (values ?? []).Select(x => x.Trim()).Where(x => x.Length is > 0 and <= 40 && x.All(c => char.IsLetterOrDigit(c) || c is ' ' or '-' or '_')).Distinct(StringComparer.OrdinalIgnoreCase).Take(8).ToList();
        if (!result.Contains("Default", StringComparer.OrdinalIgnoreCase)) result.Insert(0, "Default");
        return result.ToArray();
    }
    private static Dictionary<string, string> NormalizeShortcuts(IReadOnlyDictionary<string, string>? values)
    {
        string[] commands = ["CommandPalette", "Workspaces", "Sidebar", "Media", "ReadingList", "PageTools", "SutraSave"];
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (command, value) in values ?? new Dictionary<string, string>())
            if (commands.Contains(command, StringComparer.OrdinalIgnoreCase) && ShortcutDefinition.TryParse(value, out var shortcut)) result[command] = shortcut.ToString();
        return result;
    }

    private static Dictionary<string, double> NormalizeSiteZoomFactors(IReadOnlyDictionary<string, double>? values)
    {
        var result = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var (origin, factor) in values ?? new Dictionary<string, double>())
            if (Uri.TryCreate(origin, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && !string.IsNullOrWhiteSpace(uri.Host))
                result[$"{uri.Scheme}://{uri.Host}{(uri.IsDefaultPort ? string.Empty : ":" + uri.Port)}"] = Math.Clamp(factor, .25, 5);
        return result;
    }

    private static WebPanelDefinition[] NormalizeWebPanels(IEnumerable<WebPanelDefinition>? values) => (values ?? [])
        .Where(x => x is not null && IsSafeHttpUri(x.Url))
        .Select(x => new WebPanelDefinition(string.IsNullOrWhiteSpace(x.Name) ? new Uri(x.Url).Host : x.Name.Trim()[..Math.Min(32, x.Name.Trim().Length)], x.Url.Trim()))
        .GroupBy(x => x.Url, StringComparer.OrdinalIgnoreCase).Select(x => x.First()).Take(12).ToArray();

    private static Dictionary<string, string> NormalizeSearchAliases(IReadOnlyDictionary<string, string>? values)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (rawAlias, rawTemplate) in values ?? new Dictionary<string, string>())
        {
            var alias = rawAlias.Trim().TrimStart('@', '!').ToLowerInvariant();
            var template = rawTemplate.Trim();
            if (alias.Length is < 1 or > 24 || !alias.All(char.IsLetterOrDigit)) continue;
            if (!template.Contains("{query}", StringComparison.OrdinalIgnoreCase)) continue;
            var probe = template.Replace("{query}", "test", StringComparison.OrdinalIgnoreCase);
            if (!Uri.TryCreate(probe, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) continue;
            result[alias] = template;
            if (result.Count == 20) break;
        }
        return result;
    }
}

public static class ThemeSchedule
{
    public static BrowserTheme Resolve(BrowserSettings settings, int localHour)
    {
        if (!settings.UseScheduledTheme || settings.DarkThemeStartHour == settings.LightThemeStartHour) return settings.Theme;
        localHour = Math.Clamp(localHour, 0, 23);
        var dark = settings.DarkThemeStartHour < settings.LightThemeStartHour
            ? localHour >= settings.DarkThemeStartHour && localHour < settings.LightThemeStartHour
            : localHour >= settings.DarkThemeStartHour || localHour < settings.LightThemeStartHour;
        return dark ? BrowserTheme.Dark : BrowserTheme.Light;
    }
}

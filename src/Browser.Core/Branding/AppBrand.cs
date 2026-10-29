namespace Browser.Core.Branding;

public static class AppBrand
{
    public const string Name = "Sutra";
    public const string ShortName = Name;
    public const string ExecutableName = Name + ".exe";
    public const string AssistantName = "Sutra Assistant";
    public const string AccentColor = "#6252F5";
    public const string ChromeColor = "#090F1B";
    public const string SurfaceColor = "#111B2C";
    public const string DesktopIconUri = "ms-appx:///Sutra/assets/brand/sutra/generated/sutra-icon-128.png";
    public const string ApplicationId = "SutraBrowser.Sutra";
    public static string Version => typeof(AppBrand).Assembly.GetName().Version?.ToString(3) ?? "0.3.0";
    public const string UpdateFeedUri = "https://github.com/tanujranjith/Sutra-Browser/releases/latest/download/update.json";
    public const string NewTabTitle = "New tab";
    public const string PrivateWindowTitle = "Sutra Private";
    public const string PrivateProfileName = "SutraPrivate";
    public const string IconRelativePath = "Assets\\sutra.ico";
}

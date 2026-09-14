namespace Browser.Core.Navigation;

public static class BrowserOwnedMessagePolicy
{
    public static bool IsTrustedNewTab(string? logicalUrl, string? messageSource, string? currentSource, string expectedFileUri, bool isSelected) =>
        isSelected && logicalUrl == "browser://newtab" &&
        !string.IsNullOrEmpty(messageSource) && string.Equals(messageSource, currentSource, StringComparison.OrdinalIgnoreCase) &&
        (messageSource == "about:blank" || string.Equals(messageSource, expectedFileUri, StringComparison.OrdinalIgnoreCase));
}

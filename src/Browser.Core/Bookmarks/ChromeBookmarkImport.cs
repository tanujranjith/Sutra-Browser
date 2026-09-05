using System.Text.Json;

namespace Browser.Core.Bookmarks;

/// <summary>Lossless, local representation of Chrome's bookmark tree.  Folder and child order are retained.</summary>
public abstract record ChromeBookmarkNode;
public sealed record ChromeBookmarkFolder(string Name, IReadOnlyList<ChromeBookmarkNode> Children) : ChromeBookmarkNode;
public sealed record ChromeBookmarkLink(string Title, string Url) : ChromeBookmarkNode;

public static class ChromeBookmarkImport
{
    public static IReadOnlyList<ChromeBookmarkNode> ParseRoots(JsonElement document)
    {
        if (document.ValueKind != JsonValueKind.Object || !document.TryGetProperty("roots", out var roots) || roots.ValueKind != JsonValueKind.Object)
            return [];

        var result = new List<ChromeBookmarkNode>();
        // Chrome writes its root folders as properties. Enumerate them in file order, and preserve each children array order.
        foreach (var root in roots.EnumerateObject())
        {
            var parsed = ParseNode(root.Value, root.Name);
            if (parsed is ChromeBookmarkFolder folder && folder.Children.Count > 0)
                result.Add(folder);
        }
        return result;
    }

    public static int CountLinks(IEnumerable<ChromeBookmarkNode> nodes) => nodes.Sum(CountLinks);

    private static int CountLinks(ChromeBookmarkNode node) => node switch
    {
        ChromeBookmarkLink => 1,
        ChromeBookmarkFolder folder => folder.Children.Sum(CountLinks),
        _ => 0
    };

    private static ChromeBookmarkNode? ParseNode(JsonElement node, string fallbackName)
    {
        if (node.ValueKind != JsonValueKind.Object) return null;
        var type = node.TryGetProperty("type", out var typeValue) ? typeValue.GetString() : null;
        var name = node.TryGetProperty("name", out var nameValue) ? nameValue.GetString() : null;
        var displayName = string.IsNullOrWhiteSpace(name) ? fallbackName : name.Trim();

        if (type == "url" && node.TryGetProperty("url", out var urlValue))
        {
            var url = urlValue.GetString();
            if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(parsed.UserInfo)) return null;
            return new ChromeBookmarkLink(displayName, parsed.AbsoluteUri);
        }

        if (node.TryGetProperty("children", out var children) && children.ValueKind == JsonValueKind.Array)
        {
            var parsedChildren = new List<ChromeBookmarkNode>();
            foreach (var child in children.EnumerateArray())
            {
                var parsed = ParseNode(child, "Untitled folder");
                if (parsed is not null) parsedChildren.Add(parsed);
            }
            return new ChromeBookmarkFolder(displayName, parsedChildren);
        }

        return null;
    }
}

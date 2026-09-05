using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace Browser.Core.Bookmarks;

public sealed record BookmarkHtmlEntry(string Title, string Url);

public static partial class BookmarkHtml
{
    [GeneratedRegex("<a\\s+[^>]*href\\s*=\\s*[\"'](?<url>[^\"']+)[\"'][^>]*>(?<title>.*?)</a>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex AnchorPattern();
    [GeneratedRegex("<[^>]+>")]
    private static partial Regex TagPattern();

    public static IReadOnlyList<BookmarkHtmlEntry> Parse(string html)
    {
        if (string.IsNullOrWhiteSpace(html)) return [];
        var entries = new List<BookmarkHtmlEntry>();
        foreach (Match match in AnchorPattern().Matches(html))
        {
            var url = WebUtility.HtmlDecode(match.Groups["url"].Value).Trim();
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo)) continue;
            var title = WebUtility.HtmlDecode(TagPattern().Replace(match.Groups["title"].Value, "")).Trim();
            entries.Add(new(string.IsNullOrWhiteSpace(title) ? uri.Host : title, uri.AbsoluteUri));
        }
        return entries.DistinctBy(x => x.Url, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public static string Export(IEnumerable<BookmarkHtmlEntry> entries, string title)
    {
        var builder = new StringBuilder("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<meta charset=\"UTF-8\">\n<title>");
        builder.Append(WebUtility.HtmlEncode(title)).Append("</title>\n<h1>").Append(WebUtility.HtmlEncode(title)).Append("</h1>\n<dl><p>\n");
        foreach (var entry in entries)
            builder.Append("  <dt><a href=\"").Append(WebUtility.HtmlEncode(entry.Url)).Append("\">").Append(WebUtility.HtmlEncode(entry.Title)).Append("</a>\n");
        return builder.Append("</dl><p>\n").ToString();
    }
}

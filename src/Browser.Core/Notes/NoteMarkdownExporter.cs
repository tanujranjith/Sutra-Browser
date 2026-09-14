using System.Text;

namespace Browser.Core.Notes;

public sealed record NoteExportItem(string Url, string Quote, string Note, DateTimeOffset UpdatedAt);

public static class NoteMarkdownExporter
{
    public static string Export(IEnumerable<NoteExportItem> notes)
    {
        var output = new StringBuilder("# Page notes\n\n");
        foreach (var note in notes)
        {
            var url = NoteTargets.Normalize(note.Url);
            output.Append("## ").Append(Escape(new Uri(url).Host)).Append("\n\n");
            output.Append("Source: ").Append(Escape(url)).Append("\n\nUpdated: ").Append(note.UpdatedAt.ToString("u")).Append("\n\n");
            if (!string.IsNullOrWhiteSpace(note.Quote))
                output.Append("> ").Append(Escape(note.Quote).Replace("\n", "\n> ")).Append("\n\n");
            output.Append(Escape(note.Note)).Append("\n\n---\n\n");
        }
        return output.ToString();
    }

    private static string Escape(string text)
    {
        var output = new StringBuilder();
        foreach (var character in text.Replace("\r\n", "\n").Replace('\r', '\n'))
        {
            if (character == '<') output.Append("&lt;");
            else if (character == '>') output.Append("&gt;");
            else if (character == '&') output.Append("&amp;");
            else { if ("\\`*_{}[]()#+.!|-".Contains(character)) output.Append('\\'); output.Append(character); }
        }
        return output.ToString();
    }
}

namespace Browser.Core.Settings;

public static class ShortcutConflictPolicy
{
    public static IReadOnlyDictionary<string, string> BuiltIn { get; } = new Dictionary<string, string>
    {
        ["Ctrl+L"] = "Address bar", ["Ctrl+T"] = "New tab", ["Ctrl+K"] = "Library",
        ["Ctrl+N"] = "New window", ["Ctrl+Shift+N"] = "Private window", ["Ctrl+W"] = "Close tab",
        ["Ctrl+Shift+T"] = "Reopen closed tab", ["Ctrl+F"] = "Find in page",
        ["Ctrl+Shift+P"] = "Command palette", ["Ctrl+P"] = "Print", ["Ctrl+D"] = "Bookmark page",
        ["Ctrl+H"] = "History", ["Ctrl+J"] = "Downloads", ["Ctrl+R"] = "Reload",
        ["Ctrl+0"] = "Reset zoom", ["Ctrl+Shift+A"] = "Search tabs", ["Ctrl+Shift+F"] = "Focus mode",
        ["Ctrl+Alt+Z"] = "Sutra Save", ["Ctrl+Shift+Alt+K"] = "Kill switch",
        ["Alt+F4"] = "Close window", ["Alt+F"] = "Browser menu"
    };

    public static IReadOnlyList<string> Validate(IReadOnlyDictionary<string, string> shortcuts)
    {
        var errors = new List<string>();
        var used = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (command, raw) in shortcuts)
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            if (!ShortcutDefinition.TryParse(raw, out var parsed)) { errors.Add($"{command}: enter a supported key combination."); continue; }
            var normalized = parsed.ToString();
            if (BuiltIn.TryGetValue(normalized, out var action)) errors.Add($"{command}: {normalized} is reserved for {action}.");
            if (used.TryGetValue(normalized, out var other)) errors.Add($"{command}: {normalized} is also assigned to {other}.");
            else used[normalized] = command;
        }
        return errors;
    }
}

namespace Browser.Core.Settings;

public sealed record ShortcutDefinition(string Key, bool Control, bool Shift, bool Alt)
{
    public static bool TryParse(string? value, out ShortcutDefinition shortcut)
    {
        shortcut = new("", false, false, false);
        if (string.IsNullOrWhiteSpace(value)) return false;
        var parts = value.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length is < 2 or > 4) return false;
        var control = false; var shift = false; var alt = false; string? key = null;
        foreach (var raw in parts)
        {
            var part = raw.ToUpperInvariant();
            if (part is "CTRL" or "CONTROL") control = true;
            else if (part == "SHIFT") shift = true;
            else if (part == "ALT") alt = true;
            else if (key is null && ValidKey(part)) key = part;
            else return false;
        }
        if (key is null || !(control || shift || alt)) return false;
        shortcut = new(key, control, shift, alt); return true;
    }

    public override string ToString() => string.Join('+', new[] { Control ? "Ctrl" : null, Shift ? "Shift" : null, Alt ? "Alt" : null, Key }.Where(x => x is not null));

    private static bool ValidKey(string key) => key.Length == 1 && char.IsLetterOrDigit(key[0]) ||
        key.Length is 2 or 3 && key[0] == 'F' && int.TryParse(key[1..], out var number) && number is >= 1 and <= 12;
}

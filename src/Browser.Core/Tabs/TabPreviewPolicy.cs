namespace Browser.Core.Tabs;

public static class TabPreviewPolicy
{
    public static (int Start, int Count) Window(int total, int selected, int capacity = 7)
    {
        total = Math.Max(0, total);
        capacity = Math.Clamp(capacity, 1, 15);
        var count = Math.Min(total, capacity);
        selected = Math.Clamp(selected, 0, Math.Max(0, total - 1));
        return (Math.Clamp(selected - count / 2, 0, total - count), count);
    }
}

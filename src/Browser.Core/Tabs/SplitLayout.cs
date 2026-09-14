namespace Browser.Core.Tabs;

public enum SplitLayoutPreset { Automatic, SideBySide, Stacked, FocusLeft }
public sealed record SplitCell(int Column, int Row, int RowSpan = 1);
public sealed record SplitLayout(int Columns, int Rows, IReadOnlyList<SplitCell> Cells, bool WideFirstColumn = false)
{
    public static SplitLayout Create(int count, SplitLayoutPreset preset)
    {
        count = Math.Clamp(count, 2, 8);
        if (preset == SplitLayoutPreset.FocusLeft && count == 3)
            return new(2, 2, [new(0, 0, 2), new(1, 0), new(1, 1)], true);
        var columns = preset == SplitLayoutPreset.Stacked && count == 2 ? 1 : count switch { 2 => 2, 3 => 3, 4 => 2, <= 6 => 3, _ => 4 };
        return new(columns, (int)Math.Ceiling(count / (double)columns), Enumerable.Range(0, count).Select(i => new SplitCell(i % columns, i / columns)).ToList());
    }
}

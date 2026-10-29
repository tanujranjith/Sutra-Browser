using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Browser.Platform.Windows.WebView;

/// <summary>Overrides native tracking minimums without capping maximize or monitor size.</summary>
public sealed class NativeWindowResizeLimits : IDisposable
{
    private const uint GetMinMaxInfo = 0x0024;
    private const uint NonClientDestroy = 0x0082;
    private const nuint SubclassId = 0x53555452;
    private static readonly SubclassProcedure Callback = WindowProcedure;
    private nint _window;

    public NativeWindowResizeLimits(nint window, int minimumWidth, int minimumHeight)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(minimumWidth);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(minimumHeight);
        if (window == 0) throw new ArgumentException("A native window is required.", nameof(window));
        var size = (nuint)(uint)minimumWidth | ((nuint)(uint)minimumHeight << 32);
        if (!SetWindowSubclass(window, Callback, SubclassId, size))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        _window = window;
    }

    public void Dispose()
    {
        if (_window == 0) return;
        RemoveWindowSubclass(_window, Callback, SubclassId);
        _window = 0;
    }

    public static void BeginMove(nint window)
    {
        if (window == 0 || !GetCursorPos(out var position)) return;
        ReleaseCapture();
        var coordinates = (nint)((position.X & 0xffff) | ((position.Y & 0xffff) << 16));
        SendMessageW(window, 0x00A1, 2, coordinates); // WM_NCLBUTTONDOWN, HTCAPTION
    }

    private static nint WindowProcedure(nint window, uint message, nuint wParam, nint lParam, nuint id, nuint size)
    {
        if (message == NonClientDestroy) RemoveWindowSubclass(window, Callback, id);
        var result = DefSubclassProc(window, message, wParam, lParam);
        if (message == GetMinMaxInfo && lParam != 0)
        {
            // Apply after WinUI's procedure; otherwise its default minimum wins.
            var info = Marshal.PtrToStructure<MinMaxInfo>(lParam);
            info.MinimumTrack.X = (int)(uint)size;
            info.MinimumTrack.Y = (int)(uint)(size >> 32);
            Marshal.StructureToPtr(info, lParam, false);
        }
        return result;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public Point Reserved;
        public Point MaximumSize;
        public Point MaximumPosition;
        public Point MinimumTrack;
        public Point MaximumTrack;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate nint SubclassProcedure(nint window, uint message, nuint wParam, nint lParam, nuint id, nuint data);

    [DllImport("comctl32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowSubclass(nint window, SubclassProcedure procedure, nuint id, nuint data);
    [DllImport("comctl32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RemoveWindowSubclass(nint window, SubclassProcedure procedure, nuint id);
    [DllImport("comctl32.dll")]
    private static extern nint DefSubclassProc(nint window, uint message, nuint wParam, nint lParam);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out Point position);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReleaseCapture();
    [DllImport("user32.dll")]
    private static extern nint SendMessageW(nint window, uint message, nuint wParam, nint lParam);
}

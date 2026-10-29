using System.Runtime.InteropServices;
using Browser.Platform.Windows.WebView;
using Xunit;

namespace Browser.Platform.Windows.Tests;

public sealed class NativeWindowResizeLimitsTests
{
    [Fact]
    public void NativeTrackingMinimumCanBeSmallerThanInitialWindowAndIsRemovedOnDispose()
    {
        var window = CreateWindowExW(0, "STATIC", "Resize test", 0x00CF0000, 0, 0, 480, 300, 0, 0, 0, 0);
        Assert.NotEqual(nint.Zero, window);
        var buffer = Marshal.AllocHGlobal(40);
        // Model WinUI's existing size constraint, including a maximum that the
        // mini-player override must preserve.
        Procedure originalLimits = (handle, message, wParam, lParam, id, data) =>
        {
            var result = DefSubclassProc(handle, message, wParam, lParam);
            if (message == 0x0024)
            {
                Marshal.WriteInt32(lParam, 24, 480);
                Marshal.WriteInt32(lParam, 28, 300);
                Marshal.WriteInt32(lParam, 32, 1920);
                Marshal.WriteInt32(lParam, 36, 1080);
            }
            return result;
        };
        Assert.True(SetWindowSubclass(window, originalLimits, 1, 0));
        try
        {
            int[] ReadLimits()
            {
                Marshal.Copy(new int[10], 0, buffer, 10);
                SendMessageW(window, 0x0024, 0, buffer);
                var limits = new int[10];
                Marshal.Copy(buffer, limits, 0, 10);
                return limits;
            }
            var before = ReadLimits();
            Assert.Equal(480, before[6]);
            Assert.Equal(300, before[7]);
            using (new NativeWindowResizeLimits(window, 96, 64))
            {
                var after = ReadLimits();
                Assert.Equal(96, after[6]);
                Assert.Equal(64, after[7]);
                Assert.Equal(before[8..10], after[8..10]);
            }
            Assert.Equal(before, ReadLimits());
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
            DestroyWindow(window);
            GC.KeepAlive(originalLimits);
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern nint CreateWindowExW(uint extendedStyle, string className, string title, uint style, int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [DllImport("user32.dll")]
    private static extern nint SendMessageW(nint window, uint message, nuint wParam, nint lParam);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyWindow(nint window);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate nint Procedure(nint window, uint message, nuint wParam, nint lParam, nuint id, nuint data);
    [DllImport("comctl32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowSubclass(nint window, Procedure procedure, nuint id, nuint data);
    [DllImport("comctl32.dll")]
    private static extern nint DefSubclassProc(nint window, uint message, nuint wParam, nint lParam);
}

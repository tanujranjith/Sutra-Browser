using System.Runtime.InteropServices;
using Browser.Core.Diagnostics;

namespace Browser.Platform.Windows.Storage;

/// <summary>OS memory-pressure + battery snapshot (#6). Read-only, no persistence, never throws.</summary>
public static class SystemResourceSnapshotProvider
{
    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint Length; public uint MemoryLoad; public ulong TotalPhys; public ulong AvailPhys;
        public ulong TotalPageFile; public ulong AvailPageFile; public ulong TotalVirtual; public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemPowerStatus
    {
        public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent;
        public byte SystemStatusFlag; public int BatteryLifeTime; public int BatteryFullLifeTime;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);

    public static SystemResourceSnapshot Capture()
    {
        try
        {
            var mem = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
            var ok = GlobalMemoryStatusEx(ref mem);
            var load = ok ? mem.MemoryLoad : 0;
            var availMb = ok ? (long)(mem.AvailPhys / 1024 / 1024) : -1;
            var pressure = load >= 90 ? MemoryPressureLevel.Critical : load >= 75 ? MemoryPressureLevel.Elevated : MemoryPressureLevel.Normal;
            var saver = false;
            try
            {
                if (GetSystemPowerStatus(out var power))
                    saver = power.SystemStatusFlag == 1;
            }
            catch { }
            return new(pressure, saver, availMb);
        }
        catch { return new(MemoryPressureLevel.Normal, false, -1); }
    }
}

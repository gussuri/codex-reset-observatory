using System;
using System.Windows.Forms;

namespace CodexUsageMonitor;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var instanceMutex = new Mutex(
            initiallyOwned: true,
            name: @"Local\CodexUsageMonitor",
            createdNew: out var createdNew);
        if (!createdNew) return;

        ApplicationConfiguration.Initialize();
        try
        {
            Application.Run(new MainForm());
        }
        finally
        {
            instanceMutex.ReleaseMutex();
        }
    }
}

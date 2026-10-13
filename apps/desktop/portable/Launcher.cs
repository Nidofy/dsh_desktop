// Full portable directory entrypoint; product data stays at one dedicated stable absolute root.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher
{
    private const string Marker = "nidofy-portable-data-v1.txt";
    private const string Identity = "Nidofy DSH portable data v1\n";

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string appDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app");
            string executable = Path.Combine(appDirectory, "Nidofy DSH Desktop.exe");
            if (!File.Exists(executable) || !File.Exists(Path.Combine(appDirectory, "resources", "app.asar")))
                throw new InvalidOperationException("Keep the complete portable directory together. The app runtime is missing.");
            string dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NidofyDSHPortable", "data-v1");
            if (args.Length > 1 || (args.Length == 1 && !args[0].StartsWith("--data-root=", StringComparison.Ordinal)))
                throw new InvalidOperationException("Only --data-root=<dedicated absolute directory> is supported.");
            if (args.Length == 1)
            {
                dataRoot = args[0].Substring("--data-root=".Length);
                bool fullyQualified = dataRoot.StartsWith("\\\\", StringComparison.Ordinal)
                    || (dataRoot.Length >= 3 && Char.IsLetter(dataRoot[0]) && dataRoot[1] == ':'
                        && (dataRoot[2] == '\\' || dataRoot[2] == '/'));
                if (!fullyQualified || dataRoot.IndexOf('"') >= 0)
                    throw new InvalidOperationException("The portable data directory must be an absolute Windows path.");
            }
            dataRoot = Path.GetFullPath(dataRoot);
            string marker = Path.Combine(dataRoot, Marker);
            if (Directory.Exists(dataRoot))
            {
                if (!File.Exists(marker) || File.ReadAllText(marker) != Identity)
                    throw new InvalidOperationException("This directory is not marked as DSH portable data. Choose a new empty dedicated directory; existing data will not be adopted.");
            }
            else
            {
                Directory.CreateDirectory(dataRoot);
                using (var stream = new FileStream(marker, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
                using (var writer = new StreamWriter(stream)) writer.Write(Identity);
            }
            var start = new ProcessStartInfo(executable);
            start.WorkingDirectory = appDirectory;
            start.UseShellExecute = false;
            start.Arguments = "--nidofy-desktop-portable \"--nidofy-desktop-data-root=" + dataRoot.TrimEnd(Path.DirectorySeparatorChar) + "\"";
            foreach (string key in new string[] { "DSH_HOME", "NIDOFY_DESKTOP_DATA_ROOT", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS" })
                start.EnvironmentVariables.Remove(key);
            Process.Start(start);
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "DSH portable launch", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

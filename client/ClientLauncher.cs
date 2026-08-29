using System;
using System.Diagnostics;
using System.IO;

namespace WorkGuard
{
    static class ClientLauncher
    {
        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string agentJs = Path.Combine(baseDir, "src", "agent.js");
                
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "node.exe";
                psi.Arguments = "\"" + agentJs + "\" " + string.Join(" ", args);
                psi.WorkingDirectory = baseDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                Process.Start(psi);
            }
            catch { }
        }
    }
}

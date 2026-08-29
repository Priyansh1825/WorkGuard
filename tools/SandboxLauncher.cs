using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace WorkGuardSandbox
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string vbsPath = Path.Combine(baseDir, "start-both-ui.vbs");

                if (File.Exists(vbsPath))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = "wscript.exe";
                    psi.Arguments = "\"" + vbsPath + "\"";
                    psi.WorkingDirectory = baseDir;
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    Process.Start(psi);
                }
                else
                {
                    // Fallback direct execution
                    string adminExe = Path.Combine(baseDir, "dist", "WorkGuard-Admin-Station", "WorkGuard-Admin.exe");
                    string clientExe = Path.Combine(baseDir, "dist", "WorkGuard-Client-Agent", "Employee-Hub.exe");
                    string inspectorExe = Path.Combine(baseDir, "dist", "WorkGuard-Inspector", "WorkGuard-Inspector.exe");

                    if (File.Exists(adminExe)) Process.Start(adminExe);
                    if (File.Exists(clientExe)) Process.Start(clientExe);
                    if (File.Exists(inspectorExe)) Process.Start(inspectorExe);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not launch WorkGuard: " + ex.Message, "WorkGuard 1-Click", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}

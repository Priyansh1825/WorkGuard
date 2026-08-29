using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace WorkGuard
{
    static class AdminLauncher
    {
        [STAThread]
        static void Main()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string adminDir = Path.Combine(baseDir, "admin");
                string electronCmd = Path.Combine(adminDir, "node_modules", ".bin", "electron.cmd");
                
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.WorkingDirectory = adminDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                if (File.Exists(electronCmd))
                {
                    psi.FileName = "cmd.exe";
                    psi.Arguments = "/c \"" + electronCmd + "\" .";
                }
                else
                {
                    psi.FileName = "cmd.exe";
                    psi.Arguments = "/c npm.cmd start";
                }

                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to launch WorkGuard Admin: " + ex.Message, "WorkGuard Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}

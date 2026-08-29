using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace WorkGuard
{
    static class ClientInstaller
    {
        [STAThread]
        static void Main()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string exePath = Path.Combine(baseDir, "WorkGuard-Client.exe");
                
                // If WorkGuard-Client.exe exists, register it in startup
                RegistryKey rk = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
                if (rk != null)
                {
                    rk.SetValue("WorkGuard Client", "\"" + exePath + "\"");
                }

                // Start the agent immediately in the background
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = exePath;
                psi.WorkingDirectory = baseDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);

                MessageBox.Show(
                    "WorkGuard Client Agent has been successfully installed!\n\n" +
                    "• The agent is now running silently in the background.\n" +
                    "• It will auto-start with Windows on every boot.\n" +
                    "• It will automatically connect to your Admin station over the LAN.",
                    "WorkGuard Installation Complete",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show("Installation Error: " + ex.Message, "WorkGuard Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}

using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace WorkGuardInspector
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string nodePath = "node.exe";

                // Check for embedded node or system node
                if (!File.Exists(nodePath))
                {
                    string sysPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
                    if (File.Exists(sysPath)) nodePath = sysPath;
                }

                string scriptPath = Path.Combine(baseDir, "inspector_server.js");
                if (!File.Exists(scriptPath))
                {
                    scriptPath = Path.Combine(baseDir, "..", "inspector", "inspector_server.js");
                }

                if (File.Exists(scriptPath))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = nodePath;
                    psi.Arguments = "\"" + scriptPath + "\"";
                    psi.WorkingDirectory = Path.GetDirectoryName(scriptPath);
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    Process.Start(psi);
                }
                else
                {
                    // Direct HTML fallback
                    string htmlPath = Path.Combine(baseDir, "index.html");
                    if (!File.Exists(htmlPath)) htmlPath = Path.Combine(baseDir, "..", "inspector", "index.html");
                    if (File.Exists(htmlPath))
                    {
                        Process.Start(htmlPath);
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not launch Inspector: " + ex.Message, "WorkGuard Inspector", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}

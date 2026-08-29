using System;
using System.Diagnostics;
using System.IO;

namespace WorkGuard
{
    static class ClientHub
    {
        [STAThread]
        static void Main()
        {
            try
            {
                string url = "http://127.0.0.1:38282";

                string[] candidates = new string[]
                {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                    "msedge.exe",
                    "chrome.exe"
                };

                bool launched = false;
                foreach (string path in candidates)
                {
                    if (File.Exists(path) || path.EndsWith(".exe"))
                    {
                        try
                        {
                            ProcessStartInfo psi = new ProcessStartInfo();
                            psi.FileName = path;
                            psi.Arguments = "--app=\"" + url + "\" --window-size=500,680 --disable-features=Translate,OptimizationHints";
                            psi.UseShellExecute = true;
                            Process.Start(psi);
                            launched = true;
                            break;
                        }
                        catch { }
                    }
                }

                if (!launched)
                {
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                }
            }
            catch { }
        }
    }
}

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
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "msedge.exe";
                psi.Arguments = "--app=\"" + url + "\" --window-size=520,640";
                psi.UseShellExecute = true;

                try
                {
                    Process.Start(psi);
                }
                catch
                {
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                }
            }
            catch { }
        }
    }
}

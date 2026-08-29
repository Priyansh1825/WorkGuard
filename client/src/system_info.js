const os = require('os');
const { exec } = require('child_process');

let cachedActiveInfo = {
  processName: 'explorer.exe',
  windowTitle: 'Desktop',
  cpuUsage: 0,
  ramUsage: 0,
  lastUpdated: 0
};

// PowerShell snippet to query foreground window and process without flashing console
const PS_GET_FOREGROUND = `
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class ActiveWin {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue

$hwnd = [ActiveWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[ActiveWin]::GetWindowText($hwnd, $sb, 512) | Out-Null

$pidVal = 0
[ActiveWin]::GetWindowThreadProcessId($hwnd, [ref]$pidVal) | Out-Null
$pName = "explorer.exe"
if ($pidVal -gt 0) {
    $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
    if ($proc) { $pName = $proc.ProcessName + ".exe" }
}

[PSCustomObject]@{
    ProcessName = $pName
    WindowTitle = $sb.ToString()
} | ConvertTo-Json -Compress
`.replace(/\r?\n/g, ' ');

function getActiveWindowInfo() {
  return new Promise((resolve) => {
    // If updated less than 1.5 seconds ago, return cached
    if (Date.now() - cachedActiveInfo.lastUpdated < 1500) {
      return resolve(cachedActiveInfo);
    }

    if (process.platform === 'win32') {
      exec(`powershell -NoProfile -NonInteractive -Command "${PS_GET_FOREGROUND}"`, { timeout: 3000 }, (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim());
            cachedActiveInfo.processName = (parsed.ProcessName || 'explorer.exe').toLowerCase();
            cachedActiveInfo.windowTitle = parsed.WindowTitle || 'Desktop';
          } catch (e) {}
        }
        cachedActiveInfo.cpuUsage = getCpuUsage();
        cachedActiveInfo.ramUsage = getRamUsage();
        cachedActiveInfo.lastUpdated = Date.now();
        resolve(cachedActiveInfo);
      });
    } else {
      // Linux/macOS fallback
      cachedActiveInfo.cpuUsage = getCpuUsage();
      cachedActiveInfo.ramUsage = getRamUsage();
      cachedActiveInfo.lastUpdated = Date.now();
      resolve(cachedActiveInfo);
    }
  });
}

function getCpuUsage() {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return 10;
  let totalIdle = 0;
  let totalTick = 0;
  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });
  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = Math.round(100 - (100 * idle / total));
  return Math.min(100, Math.max(0, isNaN(usage) ? 15 : usage));
}

function getRamUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100);
}

module.exports = {
  getActiveWindowInfo,
  getCpuUsage,
  getRamUsage
};

' WorkGuard 1-Click Silent Launcher for All 3 Software Programs (Zero Command Prompts)
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' 1. Silently kill any previous processes on ports 3000, 38282 & 38283
WshShell.Run "powershell -WindowStyle Hidden -Command ""Get-NetTCPConnection -LocalPort 3000,38282,38283 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }""", 0, True

' 2. Launch Software #1: WorkGuard Admin Desktop Station Silently
WshShell.CurrentDirectory = ScriptDir & "\admin"
WshShell.Run "cmd /c ""npm.cmd start""", 0, False

WScript.Sleep 2500

' 3. Launch Software #2: WorkGuard Client Agent & Employee Hub UI Silently
WshShell.CurrentDirectory = ScriptDir & "\client"
WshShell.Run "cmd /c ""node.exe src\agent.js --open-ui""", 0, False

WScript.Sleep 1500

' 4. Launch Software #3: WorkGuard Network & Fleet Inspector Silently
WshShell.CurrentDirectory = ScriptDir & "\inspector"
WshShell.Run "cmd /c ""node.exe inspector_server.js""", 0, False

' Done - All 3 software programs (Admin, Employee Hub, Inspector) will open on the desktop with ZERO command prompts!

' WorkGuard 1-Click Silent Launcher (Zero Command Prompts)
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' 1. Silently kill any previous processes on ports 3000 & 38282
WshShell.Run "powershell -WindowStyle Hidden -Command ""Get-NetTCPConnection -LocalPort 3000,38282 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }""", 0, True

' 2. Launch WorkGuard Admin Desktop Station Silently
WshShell.CurrentDirectory = ScriptDir & "\admin"
WshShell.Run "cmd /c ""npm.cmd start""", 0, False

WScript.Sleep 2500

' 3. Launch WorkGuard Client Agent & Employee Hub UI Silently
WshShell.CurrentDirectory = ScriptDir & "\client"
WshShell.Run "cmd /c ""node.exe src\agent.js --open-ui""", 0, False

' Done - Both UIs will open on the desktop directly with ZERO cmd windows!

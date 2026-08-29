' WorkGuard 1-Click Dual Launcher for Developers (Admin Station + Employee Agent)
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' 1. Silently clear any stale processes on ports 3000 & 38282
WshShell.Run "powershell -WindowStyle Hidden -Command ""Get-NetTCPConnection -LocalPort 3000,38282 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }""", 0, True

' 2. Launch Software #1: WorkGuard Admin Station
WshShell.CurrentDirectory = ScriptDir & "\admin"
WshShell.Run "cmd /c ""npm.cmd start""", 0, False

WScript.Sleep 2000

' 3. Launch Software #2: WorkGuard Client Agent & Employee Hub Window
WshShell.CurrentDirectory = ScriptDir & "\client"
WshShell.Run "cmd /c ""node.exe src\agent.js --open-ui""", 0, False

' Done - Both Admin Management Station and Employee Client Hub are open and connected!

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
rootDir = FSO.GetParentFolderName(WScript.ScriptFullName)
clientDir = FSO.BuildPath(rootDir, "client")

' Run node src\agent.js completely hidden with window style 0
WshShell.Run "cmd.exe /c cd /d """ & clientDir & """ && node src\agent.js", 0, False

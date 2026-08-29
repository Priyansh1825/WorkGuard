Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' Run node src\agent.js completely hidden with window style 0
WshShell.Run "cmd.exe /c cd /d """ & scriptDir & """ && node src\agent.js", 0, False

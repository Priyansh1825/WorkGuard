const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const appData = process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
const startupFolder = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const shortcutPath = path.join(startupFolder, 'WorkGuardAgent.lnk');
const targetScript = path.join(__dirname, '..', 'start-client-silent.vbs');
const workingDir = path.join(__dirname, '..', 'client');

console.log('Target Script:', targetScript);
console.log('Shortcut Path:', shortcutPath);

const psScript = `
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\')}')
$sc.TargetPath = 'wscript.exe'
$sc.Arguments = '"${targetScript.replace(/\\/g, '\\\\')}"'
$sc.WorkingDirectory = '${workingDir.replace(/\\/g, '\\\\')}'
$sc.WindowStyle = 7
$sc.Description = 'WorkGuard Silent Employee Monitoring Agent'
$sc.Save()
`;

try {
  fs.writeFileSync(path.join(__dirname, 'temp_create_sc.ps1'), psScript, 'utf8');
  execSync(`powershell -ExecutionPolicy Bypass -File "${path.join(__dirname, 'temp_create_sc.ps1')}"`, { stdio: 'inherit' });
  fs.unlinkSync(path.join(__dirname, 'temp_create_sc.ps1'));
  
  if (fs.existsSync(shortcutPath)) {
    console.log('✅ Auto-Start shortcut successfully installed in Windows Startup folder!');
    console.log('Location:', shortcutPath);
  } else {
    console.error('❌ Shortcut file was not found.');
  }
} catch (e) {
  console.error('Error creating shortcut:', e.message);
}

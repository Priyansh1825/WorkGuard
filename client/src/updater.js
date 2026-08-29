const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const config = require('./config');

class ClientUpdater {
  constructor() {
    this.isUpdating = false;
    this.clientRoot = path.join(__dirname, '..');
    this.tempDir = path.join(this.clientRoot, 'temp_update');
  }

  async handleOTAUpdate(msg, ws) {
    if (this.isUpdating) {
      console.log('[OTA Updater] Update already in progress, ignoring duplicate trigger.');
      return;
    }

    const targetVersion = msg.version || '1.2.0';
    console.log(`[OTA Updater] 🚀 Received OTA update command: v${config.AGENT_VERSION} -> v${targetVersion}`);

    if (config.AGENT_VERSION === targetVersion && !msg.force) {
      console.log('[OTA Updater] Agent is already on the requested version.');
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'OTA_UPDATE_PROGRESS',
          status: 'already_latest',
          version: config.AGENT_VERSION,
          message: `Workstation is already running latest v${config.AGENT_VERSION}`
        }));
      }
      return;
    }

    this.isUpdating = true;

    try {
      // 1. Prepare temp directory
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(this.tempDir, { recursive: true });

      const downloadPath = path.join(this.tempDir, 'update.zip');
      const downloadUrl = `${config.SERVER_HTTP_URL}${msg.download_url || '/api/updates/download/latest'}`;

      console.log(`[OTA Updater] 📥 Downloading update package from ${downloadUrl}...`);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'OTA_UPDATE_PROGRESS',
          status: 'downloading',
          percent: 10,
          version: targetVersion,
          message: 'Downloading latest agent bundle from Admin...'
        }));
      }

      // 2. Download package
      await this.downloadFile(downloadUrl, downloadPath, (percent) => {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'OTA_UPDATE_PROGRESS',
            status: 'downloading',
            percent,
            version: targetVersion,
            message: `Downloading: ${percent}%`
          }));
        }
      });

      console.log('[OTA Updater] ✅ Download complete. Preparing self-extraction script...');
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'OTA_UPDATE_PROGRESS',
          status: 'installing',
          percent: 90,
          version: targetVersion,
          message: 'Extracting and installing update bundle...'
        }));
      }

      // 3. Create standalone Windows Batch Update Worker
      const batchScriptPath = path.join(this.clientRoot, 'apply_update.bat');
      const batchScript = `@echo off
echo =======================================================
echo WorkGuard Client Agent Remote OTA Self-Updater
echo =======================================================
timeout /t 2 /nobreak >nul

cd /d "${this.clientRoot}"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${downloadPath.replace(/\\/g, '\\\\')}' -DestinationPath '${path.join(this.tempDir, 'extracted').replace(/\\/g, '\\\\')}' -Force"

if exist "${path.join(this.tempDir, 'extracted')}" (
    xcopy /E /Y /I "${path.join(this.tempDir, 'extracted')}\\*" "${this.clientRoot}\\" >nul 2>&1
)

rmdir /s /q "${this.tempDir}" >nul 2>&1

echo Relaunching WorkGuard Agent...
if exist "${path.join(this.clientRoot, 'WorkGuard-Agent.exe')}" (
    start "" "${path.join(this.clientRoot, 'WorkGuard-Agent.exe')}"
) else (
    start "" node "${path.join(this.clientRoot, 'src', 'agent.js')}"
)

del "%~f0"
exit
`;
      fs.writeFileSync(batchScriptPath, batchScript, 'utf8');

      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'OTA_UPDATE_PROGRESS',
          status: 'restarting',
          percent: 100,
          version: targetVersion,
          message: 'Restarting agent daemon with updated version...'
        }));
      }

      console.log('[OTA Updater] 🔄 Spawning updater worker and exiting current process...');
      setTimeout(() => {
        const child = spawn('cmd.exe', ['/c', batchScriptPath], {
          cwd: this.clientRoot,
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        process.exit(0);
      }, 600);

    } catch (err) {
      console.error('[OTA Updater] ❌ Update failed:', err.message);
      this.isUpdating = false;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'OTA_UPDATE_PROGRESS',
          status: 'error',
          version: targetVersion,
          message: `Update failed: ${err.message}`
        }));
      }
    }
  }

  downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      http.get(url, (response) => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`Server returned HTTP ${response.statusCode}`));
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && onProgress) {
            const percent = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));
            onProgress(percent);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close(() => resolve());
        });
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    });
  }
}

module.exports = new ClientUpdater();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class UpdatesManager {
  constructor() {
    this.updatesDir = path.join(__dirname, '..', '..', 'storage', 'updates');
    this.distZipPath = path.join(__dirname, '..', '..', 'dist', 'WorkGuard-Client-Agent.zip');
    this.versionFile = path.join(this.updatesDir, 'version.json');
    this.latestZipPath = path.join(this.updatesDir, 'client-agent-latest.zip');

    if (!fs.existsSync(this.updatesDir)) {
      fs.mkdirSync(this.updatesDir, { recursive: true });
    }

    this.init();
  }

  init() {
    // If version.json doesn't exist, create it
    if (!fs.existsSync(this.versionFile)) {
      const defaultInfo = {
        version: '1.2.0',
        release_notes: 'Performance improvements, real-time telemetry optimization & zero-delay hardware screen capture.',
        released_at: new Date().toISOString(),
        bundle_size: 0,
        sha256: ''
      };
      fs.writeFileSync(this.versionFile, JSON.stringify(defaultInfo, null, 2));
    }

    // Auto-sync package from dist/WorkGuard-Client-Agent.zip if available
    this.syncDistPackage();
  }

  syncDistPackage() {
    try {
      if (fs.existsSync(this.distZipPath)) {
        const stats = fs.statSync(this.distZipPath);
        const buffer = fs.readFileSync(this.distZipPath);
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');

        fs.writeFileSync(this.latestZipPath, buffer);

        const currentVersion = this.getVersionInfo();
        currentVersion.bundle_size = stats.size;
        currentVersion.sha256 = hash;
        currentVersion.updated_at = new Date().toISOString();
        fs.writeFileSync(this.versionFile, JSON.stringify(currentVersion, null, 2));
      }
    } catch (e) {
      console.error('[UpdatesManager] syncDistPackage error:', e.message);
    }
  }

  getVersionInfo() {
    try {
      if (fs.existsSync(this.versionFile)) {
        return JSON.parse(fs.readFileSync(this.versionFile, 'utf8'));
      }
    } catch (e) {}
    return {
      version: '1.2.0',
      release_notes: 'Standard Client Agent Release',
      released_at: new Date().toISOString(),
      bundle_size: 0,
      sha256: ''
    };
  }

  setVersionInfo(newVersion, releaseNotes) {
    const info = this.getVersionInfo();
    if (newVersion) info.version = newVersion;
    if (releaseNotes) info.release_notes = releaseNotes;
    info.released_at = new Date().toISOString();
    fs.writeFileSync(this.versionFile, JSON.stringify(info, null, 2));
    return info;
  }

  getLatestZipPath() {
    if (fs.existsSync(this.latestZipPath)) {
      return this.latestZipPath;
    }
    if (fs.existsSync(this.distZipPath)) {
      return this.distZipPath;
    }
    return null;
  }

  saveUploadedBundle(buffer, filename, version, notes) {
    fs.writeFileSync(this.latestZipPath, buffer);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    const info = {
      version: version || '1.2.0',
      release_notes: notes || `Custom uploaded update package: ${filename}`,
      released_at: new Date().toISOString(),
      bundle_size: buffer.length,
      sha256: hash
    };
    fs.writeFileSync(this.versionFile, JSON.stringify(info, null, 2));
    return info;
  }
}

module.exports = new UpdatesManager();

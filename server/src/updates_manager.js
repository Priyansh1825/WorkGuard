const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

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

  // --- Version Comparison (SemVer) ---
  compareVersions(v1, v2) {
    if (!v1 && !v2) return 0;
    if (!v1) return -1;
    if (!v2) return 1;

    const clean1 = String(v1).replace(/^v/i, '').trim();
    const clean2 = String(v2).replace(/^v/i, '').trim();

    const parts1 = clean1.split('.').map(n => parseInt(n, 10) || 0);
    const parts2 = clean2.split('.').map(n => parseInt(n, 10) || 0);

    const maxLen = Math.max(parts1.length, parts2.length);
    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
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
    if (newVersion) info.version = newVersion.replace(/^v/i, '').trim();
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
      version: (version ? version.replace(/^v/i, '').trim() : null) || '1.2.0',
      release_notes: notes || `Custom uploaded update package: ${filename}`,
      released_at: new Date().toISOString(),
      bundle_size: buffer.length,
      sha256: hash
    };
    fs.writeFileSync(this.versionFile, JSON.stringify(info, null, 2));
    return info;
  }

  // --- Fetch Remote Release Bundle from Cloud URL (S3, CDN, GitHub, or Web Server) ---
  fetchCloudRelease(cloudUrl, customVersion = null, customNotes = null) {
    return new Promise((resolve, reject) => {
      if (!cloudUrl || typeof cloudUrl !== 'string') {
        return reject(new Error('Cloud URL must be a valid HTTP or HTTPS string'));
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(cloudUrl);
      } catch (err) {
        return reject(new Error(`Invalid URL format: ${err.message}`));
      }

      const downloadHelper = (targetUrl, redirectCount = 0) => {
        if (redirectCount > 5) {
          return reject(new Error('Too many HTTP redirects following cloud URL'));
        }

        const client = targetUrl.startsWith('https:') ? https : http;
        const request = client.get(targetUrl, { headers: { 'User-Agent': 'WorkGuard-Updates-Server/1.2.0' } }, (res) => {
          // Follow 301, 302, 307, 308 redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, targetUrl).toString();
            return downloadHelper(redirectUrl, redirectCount + 1);
          }

          if (res.statusCode !== 200) {
            return reject(new Error(`Cloud server returned HTTP ${res.statusCode}: ${res.statusMessage}`));
          }

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (buffer.length < 100) {
              return reject(new Error('Downloaded file is too small to be a valid release package.'));
            }

            // Verify ZIP header (PK\x03\x04 or PK\x05\x06)
            const isZip = (buffer[0] === 0x50 && buffer[1] === 0x4B);
            if (!isZip) {
              return reject(new Error('Downloaded payload is not a valid ZIP archive (Missing PK header).'));
            }

            fs.writeFileSync(this.latestZipPath, buffer);
            const hash = crypto.createHash('sha256').update(buffer).digest('hex');

            // Extract version from filename or query param if not explicitly passed
            let inferredVersion = customVersion;
            if (!inferredVersion) {
              const urlPath = parsedUrl.pathname;
              const match = urlPath.match(/v?(\d+\.\d+\.\d+)/i);
              inferredVersion = match ? match[1] : '1.3.0';
            }

            const info = {
              version: inferredVersion.replace(/^v/i, '').trim(),
              release_notes: customNotes || `Imported remote release package from ${parsedUrl.hostname}`,
              released_at: new Date().toISOString(),
              bundle_size: buffer.length,
              sha256: hash,
              source_cloud_url: cloudUrl
            };

            fs.writeFileSync(this.versionFile, JSON.stringify(info, null, 2));
            resolve(info);
          });
        });

        request.on('error', (err) => reject(new Error(`Cloud download network error: ${err.message}`)));
        request.setTimeout(30000, () => {
          request.destroy();
          reject(new Error('Cloud download request timed out after 30 seconds'));
        });
      };

      downloadHelper(cloudUrl, 0);
    });
  }
}

module.exports = new UpdatesManager();

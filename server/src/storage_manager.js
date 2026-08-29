const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const LOCAL_STORAGE_DIR = path.join(__dirname, '..', 'storage', 'screenshots');

if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
  fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
}

class StorageManager {
  constructor() {
    this.config = this.loadConfig();
  }

  loadConfig() {
    let cfg = {
      storage_type: 'local', // 'local' or 'cloud'
      local_storage_path: LOCAL_STORAGE_DIR, // Custom path chosen by admin
      cloud_storage_url: '', // e.g. https://my-bucket.s3.amazonaws.com or custom cloud API
      database_url: '',      // e.g. postgres://... or mongodb+srv://...
      retention_days: 20     // Auto-delete older than 15-20 days
    };

    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        cfg = { ...cfg, ...JSON.parse(raw) };
      } catch (e) {
        console.error('[StorageManager] Error reading server config.json:', e.message);
      }
    } else {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    }

    if (!cfg.local_storage_path || cfg.local_storage_path.trim() === '') {
      cfg.local_storage_path = LOCAL_STORAGE_DIR;
    }

    // Override with environment variables if present
    if (process.env.LOCAL_STORAGE_PATH) cfg.local_storage_path = process.env.LOCAL_STORAGE_PATH;
    if (process.env.CLOUD_STORAGE_URL) cfg.cloud_storage_url = process.env.CLOUD_STORAGE_URL;
    if (process.env.DATABASE_URL) cfg.database_url = process.env.DATABASE_URL;
    if (process.env.RETENTION_DAYS) cfg.retention_days = parseInt(process.env.RETENTION_DAYS, 10);

    // Auto-detect cloud mode if URL is provided
    if (cfg.cloud_storage_url && cfg.cloud_storage_url.trim() !== '') {
      cfg.storage_type = 'cloud';
    } else {
      cfg.storage_type = 'local';
    }

    // Ensure local directory exists
    try {
      if (!fs.existsSync(cfg.local_storage_path)) {
        fs.mkdirSync(cfg.local_storage_path, { recursive: true });
      }
    } catch (e) {
      console.error('[StorageManager] Error ensuring storage directory:', e.message);
    }

    return cfg;
  }

  getLocalStorageDir() {
    return this.config.local_storage_path || LOCAL_STORAGE_DIR;
  }

  saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    if (this.config.cloud_storage_url && this.config.cloud_storage_url.trim() !== '') {
      this.config.storage_type = 'cloud';
    } else {
      this.config.storage_type = 'local';
    }

    if (!this.config.local_storage_path || this.config.local_storage_path.trim() === '') {
      this.config.local_storage_path = LOCAL_STORAGE_DIR;
    }

    try {
      if (!fs.existsSync(this.config.local_storage_path)) {
        fs.mkdirSync(this.config.local_storage_path, { recursive: true });
      }
    } catch (e) {
      console.error('[StorageManager] Failed to create custom storage directory:', e.message);
    }

    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.error('[StorageManager] Failed to write server config.json:', e.message);
    }
    return this.config;
  }

  getStorageInfo() {
    return {
      storage_type: this.config.storage_type,
      cloud_storage_url: this.config.cloud_storage_url || '',
      database_url: this.config.database_url ? 'Configured (Cloud Database)' : 'Local JSON Database (database.json)',
      retention_days: this.config.retention_days || 20,
      localStoragePath: this.getLocalStorageDir()
    };
  }

  /**
   * Saves a screenshot. If cloud_storage_url is set, forwards to cloud; otherwise saves locally.
   */
  async saveScreenshot(clientId, dateStr, filename, fileBuffer) {
    if (this.config.storage_type === 'cloud' && this.config.cloud_storage_url) {
      return await this.uploadToCloudStorage(clientId, dateStr, filename, fileBuffer);
    } else {
      return this.saveToLocalStorage(clientId, dateStr, filename, fileBuffer);
    }
  }

  saveToLocalStorage(clientId, dateStr, filename, fileBuffer) {
    const baseDir = this.getLocalStorageDir();
    const targetDir = path.join(baseDir, clientId, dateStr);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const fullPath = path.join(targetDir, filename);
    fs.writeFileSync(fullPath, fileBuffer);
    const relativePath = `/screenshots-raw/${clientId}/${dateStr}/${filename}`;
    return {
      filepath: relativePath,
      storage_type: 'local',
      size: fileBuffer.length
    };
  }

  async uploadToCloudStorage(clientId, dateStr, filename, fileBuffer) {
    return new Promise((resolve) => {
      try {
        const cloudUrl = new URL(this.config.cloud_storage_url);
        const isHttps = cloudUrl.protocol === 'https:';
        const clientLib = isHttps ? https : http;

        const options = {
          hostname: cloudUrl.hostname,
          port: cloudUrl.port || (isHttps ? 443 : 80),
          path: `${cloudUrl.pathname.replace(/\/$/, '')}/${clientId}/${dateStr}/${filename}`,
          method: 'PUT',
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': fileBuffer.length
          },
          timeout: 8000
        };

        const req = clientLib.request(options, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const publicUrl = `${this.config.cloud_storage_url.replace(/\/$/, '')}/${clientId}/${dateStr}/${filename}`;
            resolve({
              filepath: publicUrl,
              storage_type: 'cloud',
              size: fileBuffer.length
            });
          } else {
            console.warn(`[StorageManager] Cloud upload returned ${res.statusCode}. Falling back to local storage.`);
            resolve(this.saveToLocalStorage(clientId, dateStr, filename, fileBuffer));
          }
        });

        req.on('error', (err) => {
          console.warn('[StorageManager] Cloud upload failed:', err.message, '. Storing locally.');
          resolve(this.saveToLocalStorage(clientId, dateStr, filename, fileBuffer));
        });

        req.write(fileBuffer);
        req.end();
      } catch (e) {
        console.warn('[StorageManager] Cloud URL error, saving locally:', e.message);
        resolve(this.saveToLocalStorage(clientId, dateStr, filename, fileBuffer));
      }
    });
  }
}

module.exports = new StorageManager();

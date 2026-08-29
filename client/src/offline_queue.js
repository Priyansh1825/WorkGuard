const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');

class OfflineQueue {
  constructor() {
    this.bufferDir = config.BUFFER_DIR;
    this.isFlushing = false;
  }

  getPendingCount() {
    try {
      const files = fs.readdirSync(this.bufferDir).filter(f => f.startsWith('buf_') && f.endsWith('.json'));
      return files.length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Attempts immediate upload; if offline, saves to disk buffer.
   */
  async enqueueAndUpload(imageBuffer, metadata) {
    const success = await this.uploadScreenshot(imageBuffer, metadata);
    if (!success) {
      this.saveToDiskBuffer(imageBuffer, metadata);
    }
  }

  async uploadScreenshot(imageBuffer, metadata) {
    try {
      const form = new FormData();
      form.append('client_id', metadata.client_id || config.CLIENT_ID);
      form.append('active_app', metadata.active_app || 'Unknown');
      form.append('active_window', metadata.active_window || 'Desktop');
      form.append('timestamp', metadata.timestamp || new Date().toISOString());
      form.append('screenshot', imageBuffer, {
        filename: `shot_${Date.now()}.jpg`,
        contentType: 'image/jpeg'
      });

      const res = await axios.post(`${config.SERVER_HTTP_URL}/api/screenshots/upload`, form, {
        headers: form.getHeaders(),
        timeout: 5000
      });

      return res.status === 200 && res.data.success;
    } catch (err) {
      // Server unreachable or network error
      return false;
    }
  }

  saveToDiskBuffer(imageBuffer, metadata) {
    try {
      const timestamp = Date.now();
      const imgPath = path.join(this.bufferDir, `buf_${timestamp}.jpg`);
      const metaPath = path.join(this.bufferDir, `buf_${timestamp}.json`);

      fs.writeFileSync(imgPath, imageBuffer);
      fs.writeFileSync(metaPath, JSON.stringify(metadata), 'utf8');

      // Prune old files if exceeded maximum offline buffer count
      const files = fs.readdirSync(this.bufferDir).filter(f => f.startsWith('buf_'));
      if (files.length > config.MAX_OFFLINE_BUFFER_COUNT * 2) {
        const sorted = files.sort();
        const toDelete = sorted.slice(0, 10);
        toDelete.forEach(f => {
          try { fs.unlinkSync(path.join(this.bufferDir, f)); } catch (e) {}
        });
      }
    } catch (e) {
      console.error('Failed to write to local offline buffer:', e.message);
    }
  }

  /**
   * Flushes any queued offline captures to the server.
   */
  async flushQueue() {
    if (this.isFlushing) return;
    this.isFlushing = true;

    try {
      const files = fs.readdirSync(this.bufferDir).filter(f => f.startsWith('buf_') && f.endsWith('.json'));
      if (files.length === 0) {
        this.isFlushing = false;
        return;
      }

      console.log(`[Offline Sync] Found ${files.length} buffered captures. Syncing to server...`);

      for (const metaFile of files) {
        const metaPath = path.join(this.bufferDir, metaFile);
        const imgPath = metaPath.replace('.json', '.jpg');

        if (fs.existsSync(imgPath)) {
          const metaRaw = fs.readFileSync(metaPath, 'utf8');
          const metadata = JSON.parse(metaRaw);
          const imgBuffer = fs.readFileSync(imgPath);

          const uploaded = await this.uploadScreenshot(imgBuffer, metadata);
          if (uploaded) {
            fs.unlinkSync(metaPath);
            fs.unlinkSync(imgPath);
          } else {
            // Still offline, stop flushing
            break;
          }
        } else {
          fs.unlinkSync(metaPath);
        }
      }
    } catch (err) {
      console.error('[Offline Sync] Error during queue flush:', err.message);
    } finally {
      this.isFlushing = false;
    }
  }
}

module.exports = new OfflineQueue();

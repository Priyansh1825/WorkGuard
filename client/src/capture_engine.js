const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const screenshot = require('screenshot-desktop');

const NATIVE_BIN = path.join(__dirname, '..', 'bin', 'screengrab.exe');

class CaptureEngine {
  constructor() {
    this.isCapturing = false;
    this.hasNativeBin = fs.existsSync(NATIVE_BIN);
  }

  /**
   * Captures the entire desktop display buffer silently.
   * Uses high-performance native compiled C# screengrab.exe with DPI awareness & CAPTUREBLT hardware bypass.
   * @param {number} quality JPEG quality (1-100), default 75
   * @param {string} display 'primary' | 'virtual' | 'all'
   * @returns {Promise<Buffer>} JPEG image buffer
   */
  async captureScreen(quality = 75, display = 'primary') {
    if (this.isCapturing) return null;
    this.isCapturing = true;

    try {
      // Approach 1: Native compiled screengrab.exe (Sub-15ms execution time, full DPI aware & CAPTUREBLT)
      if (this.hasNativeBin) {
        const nativeBuf = await this.captureViaNativeBin(quality, display);
        if (nativeBuf && nativeBuf.length > 0) {
          this.isCapturing = false;
          return nativeBuf;
        }
      }
    } catch (e) {
      // Fallback if native execution has an issue
    }

    try {
      // Approach 2: Fallback to screenshot-desktop
      const imgBuffer = await screenshot({ format: 'jpg' });
      this.isCapturing = false;
      return imgBuffer;
    } catch (err) {
      this.isCapturing = false;
      console.error('[Capture] All capture methods failed:', err.message);
      return null;
    }
  }

  captureViaNativeBin(quality = 75, display = 'primary') {
    return new Promise((resolve, reject) => {
      execFile(NATIVE_BIN, ['stdout', quality.toString(), display], {
        maxBuffer: 30 * 1024 * 1024,
        windowsHide: true,
        timeout: 3500
      }, (err, stdout, stderr) => {
        if (err || !stdout || stdout.trim().length === 0) {
          return reject(err || new Error('Empty screengrab.exe output: ' + stderr));
        }
        try {
          const buffer = Buffer.from(stdout.trim(), 'base64');
          resolve(buffer);
        } catch (convErr) {
          reject(convErr);
        }
      });
    });
  }
}

module.exports = new CaptureEngine();

const captureEngine = require('./capture_engine');

class LiveStreamer {
  constructor() {
    this.isStreaming = false;
    this.streamTimer = null;
    this.ws = null;
    this.targetFps = 15;
    this.quality = 65;
  }

  setWebSocket(ws) {
    this.ws = ws;
  }

  startStreaming(options = {}) {
    if (this.isStreaming) return;
    this.isStreaming = true;
    this.targetFps = options.fps || 15;
    this.quality = options.quality || 65;
    const intervalMs = Math.max(40, Math.floor(1000 / this.targetFps));

    console.log(`[Stream] Live screen stream started @ ${this.targetFps} FPS (Quality: ${this.quality}%)`);

    const streamLoop = async () => {
      if (!this.isStreaming) return;

      const startTime = Date.now();
      try {
        const frameBuffer = await captureEngine.captureScreen(this.quality);
        if (frameBuffer && this.ws && this.ws.readyState === 1) { // 1 = OPEN
          this.ws.send(frameBuffer, { binary: true });
        }
      } catch (err) {
        console.error('[Stream] Frame error:', err.message);
      }

      if (this.isStreaming) {
        const elapsed = Date.now() - startTime;
        const delay = Math.max(10, intervalMs - elapsed);
        this.streamTimer = setTimeout(streamLoop, delay);
      }
    };

    streamLoop();
  }

  stopStreaming() {
    if (!this.isStreaming) return;
    this.isStreaming = false;
    if (this.streamTimer) {
      clearTimeout(this.streamTimer);
      this.streamTimer = null;
    }
    console.log('[Stream] Live screen stream stopped (Idle mode)');
  }
}

module.exports = new LiveStreamer();

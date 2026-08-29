const dgram = require('dgram');

class DiscoveryBeacon {
  constructor(port = 3000, broadcastPort = 38281) {
    this.serverPort = port;
    this.broadcastPort = broadcastPort;
    this.socket = null;
    this.intervalId = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.warn('[AutoDiscovery] UDP socket error:', err.message);
      });

      this.socket.bind(() => {
        try {
          this.socket.setBroadcast(true);
          console.log(`[AutoDiscovery] 📡 UDP Broadcast Beacon started on port ${this.broadcastPort}`);

          // Broadcast every 2.5 seconds
          this.intervalId = setInterval(() => {
            this.broadcast();
          }, 2500);

          // Immediate first broadcast
          this.broadcast();
        } catch (e) {
          console.warn('[AutoDiscovery] Failed to enable UDP broadcast:', e.message);
        }
      });
    } catch (e) {
      console.warn('[AutoDiscovery] UDP initialization error:', e.message);
    }
  }

  broadcast() {
    if (!this.socket || !this.isRunning) return;

    const message = JSON.stringify({
      service: 'WORKGUARD_SERVER',
      version: '1.0.0',
      port: this.serverPort,
      timestamp: Date.now()
    });

    const buffer = Buffer.from(message, 'utf8');

    // Broadcast to LAN subnet
    this.socket.send(buffer, 0, buffer.length, this.broadcastPort, '255.255.255.255', (err) => {
      if (err && err.code !== 'ENETUNREACH') {
        // Suppress benign network errors
      }
    });
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
    console.log('[AutoDiscovery] Broadcast Beacon stopped.');
  }
}

module.exports = DiscoveryBeacon;

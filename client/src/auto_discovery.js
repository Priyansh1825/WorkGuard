const dgram = require('dgram');
const EventEmitter = require('events');

class ClientAutoDiscovery extends EventEmitter {
  constructor(broadcastPort = 38281) {
    super();
    this.broadcastPort = broadcastPort;
    this.socket = null;
    this.isListening = false;
    this.lastDiscovered = null;
  }

  start() {
    if (this.isListening) return;
    this.isListening = true;

    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.warn('[AutoDiscovery] UDP listener warning:', err.message);
      });

      this.socket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString('utf8'));
          if (data.service === 'WORKGUARD_SERVER') {
            const host = rinfo.address;
            const port = data.port || 3000;

            const isNew = !this.lastDiscovered ||
              this.lastDiscovered.host !== host ||
              this.lastDiscovered.port !== port;

            this.lastDiscovered = { host, port, lastSeen: Date.now() };

            if (isNew) {
              console.log(`[AutoDiscovery] 🎯 Found WorkGuard Server automatically at http://${host}:${port}`);
              this.emit('discovered', {
                host,
                port,
                httpUrl: `http://${host}:${port}`,
                wsUrl: `ws://${host}:${port}/ws`
              });
            } else {
              this.emit('heartbeat', this.lastDiscovered);
            }
          }
        } catch (e) {
          // Ignore invalid UDP noise
        }
      });

      this.socket.bind(this.broadcastPort, () => {
        console.log(`[AutoDiscovery] 👂 Listening for Server UDP Beacons on port ${this.broadcastPort}...`);
      });
    } catch (e) {
      console.warn('[AutoDiscovery] Could not bind UDP discovery socket:', e.message);
    }
  }

  stop() {
    this.isListening = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
  }
}

module.exports = new ClientAutoDiscovery();

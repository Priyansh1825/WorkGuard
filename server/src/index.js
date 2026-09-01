const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const apiRoutes = require('./routes/api');
const WebSocketServerHandler = require('./websocket');
const DiscoveryBeacon = require('./discovery_beacon');
const storageManager = require('./storage_manager');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS with LAN support
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-agent-auth']
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Forward legacy /screenshots-raw requests to authenticated API endpoint
app.use('/screenshots-raw/:clientId/:date/:filename', (req, res) => {
  const { clientId, date, filename } = req.params;
  const token = req.query.token || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : '');
  res.redirect(`/api/screenshots/raw/${clientId}/${date}/${filename}?token=${encodeURIComponent(token)}`);
});

// Serve Admin Web Dashboard Static Assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount Main API Routes
app.use('/api', apiRoutes);

// Catch-all for SPA client routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/screenshots-raw')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Create HTTP Server and bind WebSocket relay
const server = http.createServer(app);
const wsHandler = new WebSocketServerHandler(server, app);
const beacon = new DiscoveryBeacon(PORT);
let cleanupInterval = null;

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    server.listen(port, '0.0.0.0', () => {
      beacon.start();
      
      // Run automatic screenshot retention cleaner on startup & every 6 hours
      try {
        db.purgeExpiredScreenshots();
      } catch (e) {}

      if (cleanupInterval) clearInterval(cleanupInterval);
      cleanupInterval = setInterval(() => {
        try {
          db.purgeExpiredScreenshots();
        } catch (e) {}
      }, 6 * 60 * 60 * 1000);

      console.log(`=======================================================`);
      console.log(`🛡️ WorkGuard Secure Admin Coordinator Started`);
      console.log(`📡 Local Network Port:   ${port}`);
      console.log(`🔌 WebSocket Relay:      ws://0.0.0.0:${port}/ws`);
      console.log(`🔐 Admin Security:       ${db.isPasswordSet() ? 'Password Protected' : 'Setup Required (Unprotected)'}`);
      console.log(`🗄️ AES-256 Storage:      ${db.isEncryptionEnabled() ? 'ENABLED (Encrypted at Rest)' : 'Standard'}`);
      console.log(`📁 Screenshot Storage:   ${storageManager.getLocalStorageDir()}`);
      console.log(`🧹 Auto-Cleanup Policy:  Active (Deletes > 15-20 Days)`);
      console.log(`=======================================================`);
      resolve({ server, port, app });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    try {
      beacon.stop();
      if (wsHandler && wsHandler.wss) {
        wsHandler.wss.clients.forEach(client => client.terminate());
        wsHandler.wss.close();
      }
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    } catch (e) {}
    server.close(() => {
      resolve();
    });
  });
}

// If run directly via node index.js
if (require.main === module) {
  startServer(PORT).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down server gracefully...');
    stopServer().then(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    stopServer().then(() => process.exit(0));
  });
}

module.exports = {
  app,
  server,
  startServer,
  stopServer,
  PORT
};

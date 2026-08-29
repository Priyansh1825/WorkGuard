const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const UI_DIR = path.join(__dirname, 'ui');
const DEFAULT_UI_PORT = 38282;

class ClientUIServer {
  constructor(agentContext) {
    this.agent = agentContext;
    this.port = DEFAULT_UI_PORT;
    this.server = null;
    this.isOnBreak = false;
  }

  start(port = DEFAULT_UI_PORT) {
    this.port = port;
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[Client UI] 🖥️ Employee Desktop Hub active at http://127.0.0.1:${this.port}`);
        resolve(this.port);
      }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          // Try next port if port 38282 is busy
          this.server.listen(0, '127.0.0.1', () => {
            this.port = this.server.address().port;
            console.log(`[Client UI] 🖥️ Employee Desktop Hub active at http://127.0.0.1:${this.port}`);
            resolve(this.port);
          });
        }
      });
    });
  }

  handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;

    // CORS for local loopback
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // API Routes
    if (pathname === '/api/profile' && req.method === 'GET') {
      const profile = this.agent.getProfile ? this.agent.getProfile() : { employee_name: '', department: '' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(profile));
    }

    if (pathname === '/api/profile' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (this.agent.saveProfile) {
            const updated = this.agent.saveProfile(parsed.employee_name, parsed.department);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, profile: updated }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      const status = this.agent.getLiveStatus ? this.agent.getLiveStatus() : {};
      status.isOnBreak = this.isOnBreak;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(status));
    }

    if (pathname === '/api/break' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          this.isOnBreak = !!parsed.onBreak;
          if (this.agent.setBreakMode) {
            this.agent.setBreakMode(this.isOnBreak);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ onBreak: this.isOnBreak }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (pathname === '/api/sync-now' && req.method === 'POST') {
      if (this.agent.flushOfflineQueue) {
        this.agent.flushOfflineQueue();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }

    // Serve Static UI Assets
    let filePath = path.join(UI_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(UI_DIR, 'index.html');
    }

    const ext = path.extname(filePath);
    let contentType = 'text/html';
    if (ext === '.css') contentType = 'text/css';
    if (ext === '.js') contentType = 'application/javascript';
    if (ext === '.json') contentType = 'application/json';
    if (ext === '.png') contentType = 'image/png';
    if (ext === '.svg') contentType = 'image/svg+xml';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  }

  openWindow() {
    const url = `http://127.0.0.1:${this.port}`;
    if (process.platform === 'win32') {
      // Launch as dedicated app-window without browser toolbar
      exec(`start msedge.exe --app="${url}" --window-size=520,640 || start "" "${url}"`);
    } else {
      exec(`start "" "${url}"`);
    }
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = ClientUIServer;

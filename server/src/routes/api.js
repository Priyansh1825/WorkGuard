const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');

const SCREENSHOTS_DIR = path.join(__dirname, '..', '..', 'storage', 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const storageManager = require('../storage_manager');

// Storage engine for multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB limit
});

// --- Storage & Cloud Settings Endpoints ---
router.get('/settings/storage', (req, res) => {
  res.json({ success: true, ...storageManager.getStorageInfo() });
});

router.post('/settings/storage', (req, res) => {
  try {
    const updated = storageManager.saveConfig(req.body);
    res.json({ success: true, ...storageManager.getStorageInfo() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/settings/open-storage-folder', (req, res) => {
  try {
    const { exec } = require('child_process');
    const dir = storageManager.getLocalStorageDir();
    if (process.platform === 'win32') {
      exec(`explorer.exe "${dir}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${dir}"`);
    } else {
      exec(`xdg-open "${dir}"`);
    }
    res.json({ success: true, path: dir });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Clients Endpoints ---
router.get('/clients', (req, res) => {
  const clients = db.getClients();
  res.json({ success: true, clients });
});

router.get('/clients/:id', (req, res) => {
  const client = db.getClient(req.params.id);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });
  res.json({ success: true, client });
});

router.put('/clients/:id/profile', (req, res) => {
  const { employee_name, department } = req.body || {};
  const client = db.updateClientProfile(req.params.id, { employee_name, department });
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  // Broadcast update to connected agent daemon
  const updateAgent = req.app.get('updateAgentProfile');
  if (updateAgent) {
    updateAgent(req.params.id, { employee_name: client.employee_name, department: client.department });
  }

  res.json({ success: true, client });
});

router.post('/clients/:id/message', (req, res) => {
  const { title, message } = req.body || {};
  const broadcastMsg = req.app.get('sendClientMessage');
  if (broadcastMsg) {
    broadcastMsg(req.params.id, { title, message });
  }
  res.json({ success: true, message: 'Message queued for dispatch' });
});

router.post('/clients/:id/capture', (req, res) => {
  const triggerCapture = req.app.get('requestInstantScreenshot');
  if (triggerCapture) {
    triggerCapture(req.params.id);
  }
  res.json({ success: true, message: 'Instant capture triggered' });
});

// --- Export Endpoints ---
router.get('/export/csv', (req, res) => {
  try {
    const clients = db.getClients();
    const stats = db.getStats();
    
    let csv = 'Workstation ID,Employee Name,Department,Hostname,IP Address,Status,Active Application,Foreground Window,Total Screenshots,Last Seen\n';
    clients.forEach(c => {
      csv += `"${c.id}","${c.employee_name || ''}","${c.department || 'General'}","${c.hostname}","${c.ip}","${c.status}","${c.current_app || ''}","${(c.current_window || '').replace(/"/g, '""')}","${c.total_screenshots || 0}","${c.last_seen || ''}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="workguard-fleet-report-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Analytics Endpoints ---
router.get('/analytics', (req, res) => {
  try {
    const clients = db.getClients();
    const appCounts = {};
    const deptCounts = {};
    let totalOnline = 0;

    clients.forEach(c => {
      if (c.status === 'online') totalOnline++;
      const app = c.current_app || 'Idle';
      appCounts[app] = (appCounts[app] || 0) + 1;
      const dept = c.department || 'General';
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    });

    const topApps = Object.entries(appCounts)
      .map(([name, count]) => ({ name, count, percent: Math.round((count / (clients.length || 1)) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const departments = Object.entries(deptCounts)
      .map(([name, count]) => ({ name, count }));

    res.json({
      success: true,
      total_clients: clients.length,
      total_online: totalOnline,
      top_apps: topApps,
      departments
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Screenshots Endpoints ---
router.post('/screenshots/upload', upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No screenshot file provided' });
    }

    const { client_id, active_app, active_window, timestamp } = req.body;
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `${Date.now()}.jpg`;

    // Save screenshot via StorageManager (local hard drive or cloud URL)
    const saved = await storageManager.saveScreenshot(client_id || 'unknown', dateStr, filename, req.file.buffer);

    const record = db.addScreenshot({
      client_id: client_id || 'unknown',
      filepath: saved.filepath,
      filename: filename,
      timestamp: timestamp || new Date().toISOString(),
      active_app: active_app || 'Unknown',
      active_window: active_window || 'Desktop',
      file_size: saved.size || req.file.size
    });

    res.json({ success: true, screenshot: record });
  } catch (err) {
    console.error('Screenshot upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/screenshots', (req, res) => {
  const { client_id, date, limit } = req.query;
  const screenshots = db.getScreenshots({ client_id, date, limit });
  res.json({ success: true, count: screenshots.length, screenshots });
});

router.post('/screenshots/cleanup', (req, res) => {
  try {
    const days = req.body && req.body.days !== undefined ? parseInt(req.body.days, 10) : null;
    const result = db.purgeExpiredScreenshots(days);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Policies Endpoints ---
router.get('/policies', (req, res) => {
  const policy = db.getPolicy('default');
  res.json({ success: true, policy });
});

router.put('/policies', (req, res) => {
  try {
    const updated = db.updatePolicy('default', req.body);
    // Broadcast policy change notification via global WS broadcaster if attached
    if (req.app.get('broadcastPolicyUpdate')) {
      req.app.get('broadcastPolicyUpdate')(updated);
    }
    res.json({ success: true, policy: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Logs & Violations ---
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = db.getLogs(limit);
  res.json({ success: true, logs });
});

router.post('/logs/violation', (req, res) => {
  const { client_id, event_type, details } = req.body;
  const log = db.addLog(client_id, event_type || 'VIOLATION', details || 'Rule breached');
  
  if (req.app.get('broadcastViolation')) {
    req.app.get('broadcastViolation')(log);
  }

  res.json({ success: true, log });
});

// --- Statistics & Overview ---
router.get('/stats', (req, res) => {
  const stats = db.getStats();
  res.json({ success: true, stats });
});

// --- OTA Remote Client Updates Endpoints ---
const updatesManager = require('../updates_manager');

router.get('/updates/status', (req, res) => {
  try {
    updatesManager.syncDistPackage();
    const versionInfo = updatesManager.getVersionInfo();
    const clients = db.getClients();
    
    // Count outdated clients
    const fleetStatus = {
      total: clients.length,
      online: clients.filter(c => c.status === 'online').length,
      up_to_date: clients.filter(c => (c.agent_version || '1.0.0') === versionInfo.version).length,
      outdated: clients.filter(c => (c.agent_version || '1.0.0') !== versionInfo.version).length,
      clients: clients.map(c => ({
        id: c.id,
        hostname: c.hostname,
        username: c.username,
        employee_name: c.employee_name,
        department: c.department,
        status: c.status,
        agent_version: c.agent_version || '1.0.0',
        is_latest: (c.agent_version || '1.0.0') === versionInfo.version
      }))
    };

    res.json({
      success: true,
      latest_version: versionInfo.version,
      release_notes: versionInfo.release_notes,
      released_at: versionInfo.released_at,
      bundle_size: versionInfo.bundle_size,
      bundle_available: !!updatesManager.getLatestZipPath(),
      fleet: fleetStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/updates/deploy', (req, res) => {
  try {
    const { target_client_id, target_version, force } = req.body;
    const versionInfo = updatesManager.getVersionInfo();
    const zipPath = updatesManager.getLatestZipPath();

    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(404).json({ success: false, error: 'No update package bundle (.zip) available to deploy. Please build or upload one first.' });
    }

    const deployVersion = target_version || versionInfo.version;
    const dispatchFn = req.app.get('deployOTAUpdate');

    if (dispatchFn) {
      const dispatchedCount = dispatchFn({
        target_client_id: target_client_id || 'all',
        version: deployVersion,
        sha256: versionInfo.sha256,
        release_notes: versionInfo.release_notes,
        force: !!force
      });

      res.json({
        success: true,
        message: `OTA Update v${deployVersion} dispatched to ${dispatchedCount} connected agent(s).`,
        dispatched_count: dispatchedCount,
        version: deployVersion
      });
    } else {
      res.status(500).json({ success: false, error: 'WebSocket OTA dispatcher not initialized.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/updates/download/latest', (req, res) => {
  try {
    const zipPath = updatesManager.getLatestZipPath();
    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(404).json({ success: false, error: 'Update archive not found on server.' });
    }

    const versionInfo = updatesManager.getVersionInfo();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="WorkGuard-Client-Agent-v${versionInfo.version}.zip"`);
    res.setHeader('X-Agent-Version', versionInfo.version);
    res.setHeader('X-Agent-SHA256', versionInfo.sha256 || '');

    const fileStream = fs.createReadStream(zipPath);
    fileStream.pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/updates/upload-bundle', upload.single('bundle'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No update bundle zip file provided.' });
    }

    const version = req.body.version || '1.2.0';
    const notes = req.body.release_notes || `Uploaded package: ${req.file.originalname}`;

    const info = updatesManager.saveUploadedBundle(req.file.buffer, req.file.originalname, version, notes);
    res.json({ success: true, message: 'Update bundle uploaded and staged successfully!', info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

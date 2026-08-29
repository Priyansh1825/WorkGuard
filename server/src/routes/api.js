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

module.exports = router;

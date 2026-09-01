const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const storageManager = require('../storage_manager');
const securityAuth = require('../security_auth');
const alertManager = require('../alert_manager');
const privacyManager = require('../privacy_manager');

// Storage engine for multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB limit
});

// Rate limiters
const loginRateLimiter = securityAuth.createRateLimiter({ windowMs: 60000, maxRequests: 10 });
const apiRateLimiter = securityAuth.createRateLimiter({ windowMs: 60000, maxRequests: 300 });

// --- Authentication & Authorization Middlewares ---
function requireAdminAuth(req, res, next) {
  // If master password is not yet configured, allow initial setup
  if (!db.isPasswordSet()) {
    req.isAdmin = true;
    req.adminSession = { role: 'superadmin', sub: 'admin', allowed_departments: ['ALL'] };
    return next();
  }

  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Admin authentication token required' });
  }

  const session = securityAuth.verifySessionToken(token, db.getSessionSecret());
  if (!session) {
    return res.status(401).json({ success: false, error: 'Session expired or invalid. Please log in again.' });
  }

  req.adminSession = session;
  req.isAdmin = true;
  next();
}

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    requireAdminAuth(req, res, () => {
      const userRole = (req.adminSession && req.adminSession.role) || 'superadmin';
      if (allowedRoles.length > 0 && !allowedRoles.includes(userRole) && userRole !== 'superadmin') {
        return res.status(403).json({ success: false, error: `Forbidden: This action requires [${allowedRoles.join(', ')}] role` });
      }
      next();
    });
  };
}

function requireAgentAuth(req, res, next) {
  const provided = req.headers['x-agent-auth'] || (req.body && req.body.auth_token) || (req.query && req.query.auth_token);
  const expected = db.getAgentSecretKey();

  if (!securityAuth.verifyAgentKey(provided, expected)) {
    return res.status(403).json({ success: false, error: 'Forbidden: Invalid or missing agent pre-shared key' });
  }

  next();
}

// Apply general API rate limiter
router.use(apiRateLimiter);

// --- Auth Endpoints ---
router.get('/auth/status', (req, res) => {
  res.json({
    success: true,
    is_password_set: db.isPasswordSet(),
    encryption_enabled: db.isEncryptionEnabled()
  });
});

router.post('/auth/setup', (req, res) => {
  try {
    if (db.isPasswordSet()) {
      return res.status(400).json({ success: false, error: 'Master password is already set. Use change-password instead.' });
    }
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }

    db.setAdminPassword(password);
    const token = securityAuth.generateSessionToken(
      { role: 'superadmin', sub: 'admin' },
      db.getSessionSecret(),
      (db.getSecurityConfig().session_timeout_minutes || 15) * 60
    );

    res.json({ success: true, message: 'Master password configured successfully', token });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/auth/login', loginRateLimiter, (req, res) => {
  try {
    const { username, password } = req.body || {};

    // 1. Try RBAC Admin Users Table First
    if (username) {
      const adminUser = db.getAdminUserByUsername(username);
      if (adminUser && adminUser.is_active) {
        const isMatch = securityAuth.verifyPassword(password, adminUser.password_hash, adminUser.salt);
        if (isMatch) {
          db.recordAdminLogin(adminUser.id);
          const timeoutMin = db.getSecurityConfig().session_timeout_minutes || 30;
          const token = securityAuth.generateSessionToken(
            { 
              role: adminUser.role, 
              sub: adminUser.username, 
              allowed_departments: adminUser.allowed_departments, 
              user_id: adminUser.id, 
              full_name: adminUser.full_name 
            },
            db.getSessionSecret(),
            timeoutMin * 60
          );

          db.addLog('SECURITY', 'ADMIN_LOGGED_IN', `Admin '${adminUser.username}' (${adminUser.role}) logged in from IP ${req.ip}`);
          return res.json({
            success: true,
            token,
            expires_in: timeoutMin * 60,
            user: { 
              username: adminUser.username, 
              full_name: adminUser.full_name, 
              role: adminUser.role, 
              allowed_departments: adminUser.allowed_departments 
            }
          });
        }
      }
    }

    // 2. Fallback to Master Password
    if (!db.isPasswordSet()) {
      return res.status(400).json({ success: false, error: 'Admin password not set. Please run initial setup.' });
    }

    const isValid = db.verifyAdminPassword(password);
    if (!isValid) {
      db.addLog('SECURITY', 'FAILED_LOGIN_ATTEMPT', `Failed login attempt for '${username || 'admin'}' from IP ${req.ip}`);
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const timeoutMin = db.getSecurityConfig().session_timeout_minutes || 15;
    const token = securityAuth.generateSessionToken(
      { role: 'superadmin', sub: username || 'admin', allowed_departments: ['ALL'], full_name: 'Master Administrator' },
      db.getSessionSecret(),
      timeoutMin * 60
    );

    db.addLog('SECURITY', 'ADMIN_LOGGED_IN', `Master Admin logged in successfully from IP ${req.ip}`);
    res.json({
      success: true,
      token,
      expires_in: timeoutMin * 60,
      user: { username: 'admin', full_name: 'Master Administrator', role: 'superadmin', allowed_departments: ['ALL'] }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/auth/verify', requireAdminAuth, (req, res) => {
  res.json({ success: true, valid: true, user: req.adminSession });
});

router.post('/auth/change-password', requireAdminAuth, (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    
    if (db.isPasswordSet()) {
      if (!db.verifyAdminPassword(current_password)) {
        return res.status(401).json({ success: false, error: 'Current password does not match' });
      }
    }

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long.' });
    }

    db.setAdminPassword(new_password);
    const timeoutMin = db.getSecurityConfig().session_timeout_minutes || 15;
    const token = securityAuth.generateSessionToken(
      { role: 'superadmin', sub: 'admin' },
      db.getSessionSecret(),
      timeoutMin * 60
    );

    res.json({ success: true, message: 'Password updated successfully', token });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Security Settings Endpoints ---
router.get('/security/settings', requireAdminAuth, (req, res) => {
  res.json({ success: true, ...db.getSecurityConfig() });
});

router.post('/security/settings', requireAdminAuth, (req, res) => {
  try {
    const updated = db.updateSecurityConfig(req.body);
    res.json({ success: true, security: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Storage & Cloud Settings Endpoints ---
router.get('/settings/storage', requireAdminAuth, (req, res) => {
  res.json({ success: true, ...storageManager.getStorageInfo() });
});

router.post('/settings/storage', requireAdminAuth, (req, res) => {
  try {
    storageManager.saveConfig(req.body);
    res.json({ success: true, ...storageManager.getStorageInfo() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/settings/open-storage-folder', requireAdminAuth, (req, res) => {
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
router.get('/clients', requireAdminAuth, (req, res) => {
  let clients = db.getClients();
  const session = req.adminSession;
  if (session && session.role === 'dept_manager' && !session.allowed_departments.includes('ALL')) {
    clients = clients.filter(c => session.allowed_departments.includes(c.department));
  }
  res.json({ success: true, clients });
});

router.get('/clients/:id', requireAdminAuth, (req, res) => {
  const safeId = securityAuth.sanitizeFilename(req.params.id);
  const client = db.getClient(safeId);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  const session = req.adminSession;
  if (session && session.role === 'dept_manager' && !session.allowed_departments.includes('ALL')) {
    if (!session.allowed_departments.includes(client.department)) {
      return res.status(403).json({ success: false, error: 'Access to this department is restricted' });
    }
  }

  res.json({ success: true, client });
});

router.put('/clients/:id/profile', requireAdminAuth, (req, res) => {
  const safeId = securityAuth.sanitizeFilename(req.params.id);
  const { employee_name, department } = req.body || {};
  const client = db.updateClientProfile(safeId, { 
    employee_name: securityAuth.sanitizeText(employee_name),
    department: securityAuth.sanitizeText(department)
  });
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  // Broadcast update to connected agent daemon
  const updateAgent = req.app.get('updateAgentProfile');
  if (updateAgent) {
    updateAgent(safeId, { employee_name: client.employee_name, department: client.department });
  }

  res.json({ success: true, client });
});

router.post('/clients/:id/message', requireAdminAuth, (req, res) => {
  const safeId = securityAuth.sanitizeFilename(req.params.id);
  const { title, message } = req.body || {};
  const broadcastMsg = req.app.get('sendClientMessage');
  if (broadcastMsg) {
    broadcastMsg(safeId, { 
      title: securityAuth.sanitizeText(title),
      message: securityAuth.sanitizeText(message)
    });
  }
  res.json({ success: true, message: 'Message queued for dispatch' });
});

router.post('/clients/:id/capture', requireAdminAuth, (req, res) => {
  const safeId = securityAuth.sanitizeFilename(req.params.id);
  const triggerCapture = req.app.get('requestInstantScreenshot');
  if (triggerCapture) {
    triggerCapture(safeId);
  }
  res.json({ success: true, message: 'Instant capture triggered' });
});

// --- Export Endpoints ---
router.get('/export/csv', requireAdminAuth, (req, res) => {
  try {
    let clients = db.getClients();
    const session = req.adminSession;
    if (session && session.role === 'dept_manager' && !session.allowed_departments.includes('ALL')) {
      clients = clients.filter(c => session.allowed_departments.includes(c.department));
    }

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
router.get('/analytics', requireAdminAuth, (req, res) => {
  try {
    let clients = db.getClients();
    const session = req.adminSession;
    if (session && session.role === 'dept_manager' && !session.allowed_departments.includes('ALL')) {
      clients = clients.filter(c => session.allowed_departments.includes(c.department));
    }

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

// --- Authenticated & Decrypted Screenshot Streaming Endpoint ---
router.get('/screenshots/raw/:clientId/:date/:filename', requireAdminAuth, (req, res) => {
  try {
    const { clientId, date, filename } = req.params;
    const fileBuffer = storageManager.readScreenshotFile(clientId, date, filename);
    
    if (!fileBuffer) {
      return res.status(404).send('Screenshot not found');
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(fileBuffer);
  } catch (err) {
    res.status(500).send('Error retrieving screenshot');
  }
});

// --- Screenshot Upload (Protected by Agent PSK) with Smart Privacy & Alert Evaluation ---
router.post('/screenshots/upload', requireAgentAuth, upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No screenshot file provided' });
    }

    const { client_id, active_app, active_window, timestamp } = req.body;
    const safeClientId = securityAuth.sanitizeFilename(client_id || 'unknown');
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `${Date.now()}.jpg`;

    // 1. Evaluate Privacy Shield Rules on Application and Window Title
    const privacyEval = privacyManager.evaluatePrivacy(active_app, active_window);
    
    // If capture is paused for privacy, drop capture gracefully
    if (privacyEval.action === 'pause_capture') {
      return res.json({ success: true, paused: true, message: 'Screenshot capture paused by privacy rule' });
    }

    // Apply auto-blur redaction if active
    let imageBufferToSave = req.file.buffer;
    if (privacyEval.action === 'blur_screenshot') {
      imageBufferToSave = privacyManager.applyPrivacyRedaction(req.file.buffer, privacyEval);
    }

    const sanitizedWindow = privacyManager.maskWindowTitle(active_window, privacyEval);

    // 2. Trigger Application Alert Engine in background
    const clientRecord = db.getClient(safeClientId) || { id: safeClientId, hostname: safeClientId, department: 'General' };
    alertManager.processWorkstationActivity(clientRecord, active_app, sanitizedWindow).catch(e => {
      console.warn('[AlertManager] Background alert processing error:', e.message);
    });

    // 3. Save screenshot via StorageManager (local hard drive or cloud URL, encrypted if active)
    const saved = await storageManager.saveScreenshot(safeClientId, dateStr, filename, imageBufferToSave);

    const record = db.addScreenshot({
      client_id: safeClientId,
      filepath: saved.filepath,
      filename: filename,
      timestamp: timestamp || new Date().toISOString(),
      active_app: securityAuth.sanitizeText(active_app) || 'Unknown',
      active_window: securityAuth.sanitizeText(sanitizedWindow) || 'Desktop',
      file_size: saved.size || req.file.size,
      is_encrypted: !!saved.is_encrypted
    });

    res.json({ success: true, screenshot: record });
  } catch (err) {
    console.error('Screenshot upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/screenshots', requireAdminAuth, (req, res) => {
  const { client_id, date, limit } = req.query;
  let screenshots = db.getScreenshots({ client_id, date, limit });
  const session = req.adminSession;
  
  if (session && session.role === 'dept_manager' && !session.allowed_departments.includes('ALL')) {
    const clients = db.getClients();
    const allowedClientIds = new Set(
      clients.filter(c => session.allowed_departments.includes(c.department)).map(c => c.id)
    );
    screenshots = screenshots.filter(s => allowedClientIds.has(s.client_id));
  }

  res.json({ success: true, count: screenshots.length, screenshots });
});

router.post('/screenshots/cleanup', requireRole(['superadmin']), (req, res) => {
  try {
    const days = req.body && req.body.days !== undefined ? parseInt(req.body.days, 10) : null;
    const result = db.purgeExpiredScreenshots(days);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Policies Endpoints ---
router.get('/policies', requireAdminAuth, (req, res) => {
  const policy = db.getPolicy('default');
  res.json({ success: true, policy });
});

router.put('/policies', requireAdminAuth, (req, res) => {
  try {
    const updated = db.updatePolicy('default', req.body);
    if (req.app.get('broadcastPolicyUpdate')) {
      req.app.get('broadcastPolicyUpdate')(updated);
    }
    res.json({ success: true, policy: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Logs & Violations ---
router.get('/logs', requireAdminAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = db.getLogs(limit);
  res.json({ success: true, logs });
});

router.post('/logs/violation', requireAgentAuth, (req, res) => {
  const { client_id, event_type, details } = req.body;
  const safeClientId = securityAuth.sanitizeFilename(client_id || 'unknown');
  const log = db.addLog(safeClientId, event_type || 'VIOLATION', details || 'Rule breached');
  
  if (req.app.get('broadcastViolation')) {
    req.app.get('broadcastViolation')(log);
  }

  res.json({ success: true, log });
});

// --- Statistics & Overview ---
router.get('/stats', requireAdminAuth, (req, res) => {
  const stats = db.getStats();
  res.json({ success: true, stats });
});

// --- OTA Remote Client Updates Endpoints ---
const updatesManager = require('../updates_manager');

router.get('/updates/status', requireAdminAuth, (req, res) => {
  try {
    updatesManager.syncDistPackage();
    const versionInfo = updatesManager.getVersionInfo();
    const clients = db.getClients();
    const autoUpdateEnabled = db.isAutoUpdateEnabled();
    const zipPath = updatesManager.getLatestZipPath();
    
    let outdatedCount = 0;
    clients.forEach(c => {
      if (c.agent_version && updatesManager.compareVersions(c.agent_version, versionInfo.version) < 0) {
        outdatedCount++;
      }
    });

    res.json({
      success: true,
      ...versionInfo,
      package_available: !!(zipPath && fs.existsSync(zipPath)),
      auto_update_on_connect: autoUpdateEnabled,
      total_clients: clients.length,
      outdated_count: outdatedCount,
      clients: clients.map(c => ({
        id: c.id,
        hostname: c.hostname,
        username: c.username,
        employee_name: c.employee_name,
        department: c.department,
        ip: c.ip,
        agent_version: c.agent_version || '1.0.0',
        status: c.status
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cloud URL Release Fetcher
router.post('/updates/fetch-cloud', requireAdminAuth, async (req, res) => {
  try {
    const { cloud_url, version, release_notes, auto_deploy } = req.body || {};
    if (!cloud_url || typeof cloud_url !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid Cloud URL is required.' });
    }

    const info = await updatesManager.fetchCloudRelease(cloud_url, version, release_notes);
    db.addLog('SYSTEM', 'OTA_CLOUD_RELEASE_IMPORTED', `Imported new client release v${info.version} from cloud URL: ${cloud_url}`);

    let dispatched = 0;
    if (auto_deploy) {
      const deployFunc = req.app.get('deployOTAUpdate');
      if (deployFunc) {
        dispatched = deployFunc({
          target_client_id: 'all',
          version: info.version,
          sha256: info.sha256,
          release_notes: info.release_notes,
          force: false
        });
      }
    }

    res.json({
      success: true,
      message: `Successfully fetched and verified release package v${info.version} from Cloud URL!`,
      info,
      dispatched
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manual ZIP Upload
router.post('/updates/upload-bundle', requireAdminAuth, upload.single('bundle'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No .ZIP archive file was uploaded.' });
    }

    const buffer = req.file.buffer;
    // Check ZIP header
    if (buffer.length < 100 || buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
      return res.status(400).json({ success: false, error: 'Uploaded file is not a valid ZIP archive.' });
    }

    const version = req.body.version || '1.3.0';
    const notes = req.body.release_notes || `Uploaded package: ${req.file.originalname}`;

    const info = updatesManager.saveUploadedBundle(buffer, req.file.originalname, version, notes);
    db.addLog('SYSTEM', 'OTA_BUNDLE_UPLOADED', `Admin uploaded new client update package v${info.version}`);

    res.json({
      success: true,
      message: `Update package v${info.version} uploaded & ready for deployment!`,
      info
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle Auto-Update on Connect
router.post('/updates/config', requireAdminAuth, (req, res) => {
  try {
    const { auto_update_on_connect } = req.body || {};
    if (typeof auto_update_on_connect === 'boolean') {
      db.setAutoUpdateEnabled(auto_update_on_connect);
      db.addLog('SYSTEM', 'OTA_CONFIG_UPDATED', `Auto-update clients on connect set to ${auto_update_on_connect}`);
    }
    res.json({
      success: true,
      auto_update_on_connect: db.isAutoUpdateEnabled()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manual Trigger / Push Deploy
router.post('/updates/deploy', requireAdminAuth, (req, res) => {
  try {
    const { target_client_id, force } = req.body || {};
    const versionInfo = updatesManager.getVersionInfo();
    const zipPath = updatesManager.getLatestZipPath();
    
    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(400).json({ success: false, error: 'No update package found on server. Please upload a ZIP or fetch from Cloud first.' });
    }

    const deployFunc = req.app.get('deployOTAUpdate');
    let dispatched = 0;
    if (deployFunc) {
      dispatched = deployFunc({
        target_client_id: target_client_id || 'all',
        version: versionInfo.version,
        sha256: versionInfo.sha256,
        release_notes: versionInfo.release_notes,
        force: !!force
      });
    }

    db.addLog('SYSTEM', 'OTA_DEPLOY_TRIGGERED', `OTA Update v${versionInfo.version} dispatched to ${dispatched} connected agent(s)`);
    res.json({ success: true, dispatched, version: versionInfo.version, message: `Update command sent to ${dispatched} workstation(s).` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download Latest Client Update Archive
router.get('/updates/download/latest', (req, res) => {
  try {
    const zipPath = updatesManager.getLatestZipPath();
    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(404).send('Update package not found on server');
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="workguard-client-latest.zip"');
    res.sendFile(zipPath);
  } catch (err) {
    res.status(500).send('Error downloading update');
  }
});

// --- Database Studio & Management Endpoints ---
router.get('/database/stats', requireAdminAuth, (req, res) => {
  try {
    const stats = db.getDatabaseStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/database/table/:name', requireAdminAuth, (req, res) => {
  try {
    const tableName = req.params.name;
    const { page, limit, search, sortBy, sortOrder } = req.query;
    const result = db.getTableRecords(tableName, { page, limit, search, sortBy, sortOrder });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/database/table/:name', requireAdminAuth, (req, res) => {
  try {
    const tableName = req.params.name;
    const record = req.body || {};
    const result = db.insertRecord(tableName, record);
    res.json({ success: true, message: `Record inserted into ${tableName}`, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/database/table/:name/:id', requireAdminAuth, (req, res) => {
  try {
    const tableName = req.params.name;
    const recordId = req.params.id;
    const record = req.body || {};
    const result = db.updateRecord(tableName, recordId, record);
    res.json({ success: true, message: `Record '${recordId}' updated in ${tableName}`, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/database/table/:name/:id', requireAdminAuth, (req, res) => {
  try {
    const tableName = req.params.name;
    const recordId = req.params.id;
    const result = db.deleteRecord(tableName, recordId);
    res.json({ success: true, message: `Record '${recordId}' deleted from ${tableName}`, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/database/purge-retention', requireAdminAuth, (req, res) => {
  try {
    const { retention_days } = req.body || {};
    const days = retention_days !== undefined ? parseInt(retention_days, 10) : null;
    const result = db.purgeExpiredScreenshots(days);
    res.json({
      success: true,
      message: `Cleaned up ${result.deletedCount} expired screenshots (${(result.freedBytes / (1024 * 1024)).toFixed(2)} MB disk space freed).`,
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/database/export/sqlite', requireAdminAuth, (req, res) => {
  try {
    const dbPath = path.join(__dirname, '..', '..', 'storage', 'workguard.db');
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ success: false, error: 'SQLite database file not found' });
    }
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', 'attachment; filename="workguard-backup.db"');
    res.sendFile(dbPath);
  } catch (err) {
    res.status(500).send('Error downloading SQLite backup');
  }
});

router.get('/database/export/json', requireAdminAuth, (req, res) => {
  try {
    const fullData = db.exportFullJson();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="workguard-database-export.json"');
    res.send(JSON.stringify(fullData, null, 2));
  } catch (err) {
    res.status(500).send('Error downloading JSON database export');
  }
});

// ==========================================
// RBAC & MULTI-ADMIN USER MANAGEMENT ENDPOINTS
// ==========================================
router.get('/rbac/users', requireRole(['superadmin']), (req, res) => {
  try {
    const users = db.getAdminUsers();
    res.json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/rbac/users', requireRole(['superadmin']), (req, res) => {
  try {
    const { username, password, full_name, role, allowed_departments } = req.body || {};
    const created = db.createAdminUser({ username, password, full_name, role, allowed_departments });
    res.json({ success: true, user: created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/rbac/users/:id', requireRole(['superadmin']), (req, res) => {
  try {
    const updated = db.updateAdminUser(req.params.id, req.body || {});
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/rbac/users/:id', requireRole(['superadmin']), (req, res) => {
  try {
    const result = db.deleteAdminUser(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// REAL-TIME ALERTS & WEBHOOKS ENDPOINTS
// ==========================================
router.get('/alerts/webhooks', requireRole(['superadmin', 'dept_manager']), (req, res) => {
  try {
    const webhooks = db.getAlertWebhooks();
    res.json({ success: true, count: webhooks.length, webhooks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/alerts/webhooks', requireRole(['superadmin']), (req, res) => {
  try {
    const saved = db.saveAlertWebhook(req.body || {});
    res.json({ success: true, webhook: saved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/alerts/webhooks/:id', requireRole(['superadmin']), (req, res) => {
  try {
    const result = db.deleteAlertWebhook(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/alerts/test', requireRole(['superadmin']), async (req, res) => {
  try {
    const { url, type } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: 'Webhook URL is required' });
    const testResult = await alertManager.testWebhook(url, type || 'slack');
    res.json({ success: true, message: 'Test notification sent successfully', result: testResult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/alerts/recent', requireAdminAuth, (req, res) => {
  try {
    const alerts = alertManager.getRecentAlerts(50);
    res.json({ success: true, count: alerts.length, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// APPLICATION ALERT RULES ENDPOINTS ("ADD APPLICATION TOOL")
// ==========================================
router.get('/alerts/app-rules', requireAdminAuth, (req, res) => {
  try {
    const rules = db.getAlertAppRules();
    res.json({ success: true, count: rules.length, rules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/alerts/app-rules', requireRole(['superadmin']), (req, res) => {
  try {
    const added = db.addAlertAppRule(req.body || {});
    res.json({ success: true, rule: added });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/alerts/app-rules/:id', requireRole(['superadmin']), (req, res) => {
  try {
    const updated = db.updateAlertAppRule(req.params.id, req.body || {});
    res.json({ success: true, rule: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/alerts/app-rules/:id', requireRole(['superadmin']), (req, res) => {
  try {
    const result = db.deleteAlertAppRule(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==========================================
// SMART PRIVACY SHIELD & SENSITIVE DATA RULES ENDPOINTS
// ==========================================
router.get('/privacy/rules', requireAdminAuth, (req, res) => {
  try {
    const rules = db.getPrivacyRules();
    res.json({ success: true, count: rules.length, rules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/privacy/rules', requireRole(['superadmin']), (req, res) => {
  try {
    const saved = db.savePrivacyRule(req.body || {});
    res.json({ success: true, rule: saved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/privacy/rules/:id', requireRole(['superadmin']), (req, res) => {
  try {
    const result = db.deletePrivacyRule(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;



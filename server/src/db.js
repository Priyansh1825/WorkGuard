const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { DatabaseSync } = require('node:sqlite');
const securityAuth = require('./security_auth');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'storage');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'database.json');
const SQLITE_FILE = process.env.SQLITE_FILE || path.join(DATA_DIR, 'workguard.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default initial policies and configuration
const defaultPolicy = {
  id: 'default',
  name: 'Standard Workplace Policy',
  allowed_apps: [
    'code.exe', 'devenv.exe', 'notepad.exe', 'notepad++.exe', 
    'slack.exe', 'teams.exe', 'zoom.exe', 'outlook.exe',
    'chrome.exe', 'msedge.exe', 'firefox.exe', 'explorer.exe',
    'cmd.exe', 'powershell.exe', 'windowsterminal.exe', 'git.exe',
    'taskmgr.exe', 'excel.exe', 'winword.exe', 'powerpnt.exe'
  ],
  allowed_domains: [
    'github.com', 'gitlab.com', 'stackoverflow.com', 'google.com',
    'microsoft.com', 'atlassian.net', 'jira.com', 'confluence.com',
    'slack.com', 'zoom.us', 'office.com', 'internal.local'
  ],
  sensitive_apps: [
    '1password.exe', 'bitwarden.exe', 'keepass.exe', 'lastpass.exe',
    'authy.exe', 'nordpass.exe', 'kdbx.exe', 'authenticator.exe'
  ],
  sensitive_keywords: [
    'password', 'bitwarden', '1password', 'keepass', 'bank',
    'banking', 'netbanking', 'credit card', 'debit card', 'checkout',
    'paypal', 'medical portal', 'hsa', 'mychart'
  ],
  pause_on_sensitive: 1,
  work_hours_start: '00:00',
  work_hours_end: '23:59',
  capture_interval_sec: 600,
  stream_fps: 15,
  policy_mode: 'audit-alert',
  retention_days: 20,
  active_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
};

class Database {
  constructor(customDbPath = null) {
    this.dbPath = customDbPath || SQLITE_FILE;
    this.sqlite = new DatabaseSync(this.dbPath);
    this.initTables();
    this.migrateFromJsonIfEmpty();
    this.ensureSecurityDefaults();
  }

  initTables() {
    // Enable WAL mode for high concurrency and crash resistance
    try {
      this.sqlite.exec('PRAGMA journal_mode = WAL;');
      this.sqlite.exec('PRAGMA synchronous = NORMAL;');
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
    } catch (e) {
      console.warn('[Database] Pragmas note:', e.message);
    }

    // 1. Security Settings (Key-Value Store)
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS security_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      );
    `);

    // 2. Clients Table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        hostname TEXT,
        username TEXT,
        employee_name TEXT,
        department TEXT,
        ip TEXT,
        os TEXT,
        status TEXT DEFAULT 'offline',
        agent_version TEXT DEFAULT '1.0.0',
        current_app TEXT DEFAULT 'None',
        current_window TEXT DEFAULT 'Desktop',
        cpu_usage REAL DEFAULT 0,
        ram_usage REAL DEFAULT 0,
        first_seen TEXT,
        last_seen TEXT,
        total_screenshots INTEGER DEFAULT 0,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
      CREATE INDEX IF NOT EXISTS idx_clients_last_seen ON clients(last_seen);
    `);

    // 3. Screenshots Table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS screenshots (
        id TEXT PRIMARY KEY,
        client_id TEXT,
        filepath TEXT,
        filename TEXT,
        timestamp TEXT,
        active_app TEXT,
        active_window TEXT,
        file_size INTEGER DEFAULT 0,
        is_encrypted INTEGER DEFAULT 0,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_screenshots_client_time ON screenshots(client_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_screenshots_time ON screenshots(timestamp);
    `);

    // 4. Workplace Policies Table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS policies (
        id TEXT PRIMARY KEY,
        name TEXT,
        allowed_apps_json TEXT,
        allowed_domains_json TEXT,
        sensitive_apps_json TEXT,
        sensitive_keywords_json TEXT,
        pause_on_sensitive INTEGER DEFAULT 1,
        work_hours_start TEXT DEFAULT '00:00',
        work_hours_end TEXT DEFAULT '23:59',
        capture_interval_sec INTEGER DEFAULT 600,
        stream_fps INTEGER DEFAULT 15,
        policy_mode TEXT DEFAULT 'audit-alert',
        retention_days INTEGER DEFAULT 20,
        active_days_json TEXT,
        updated_at TEXT
      );
    `);

    // 5. Audit Logs Table (Tamper-evident chain)
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        client_id TEXT,
        event_type TEXT,
        details TEXT,
        timestamp TEXT,
        prev_hash TEXT,
        hash TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    `);

    // 6. Admin Users (RBAC) Table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT,
        salt TEXT,
        full_name TEXT,
        role TEXT DEFAULT 'dept_manager',
        allowed_departments TEXT DEFAULT '["ALL"]',
        is_active INTEGER DEFAULT 1,
        created_at TEXT,
        last_login TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
    `);

    // 7. Alert Webhooks Table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS alert_webhooks (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT DEFAULT 'slack',
        webhook_url TEXT,
        events TEXT DEFAULT '["blacklisted_app","tamper_detected"]',
        is_enabled INTEGER DEFAULT 1,
        created_at TEXT
      );
    `);

    // 8. Alert Application Rules Table (Custom App Triggers)
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS alert_app_rules (
        id TEXT PRIMARY KEY,
        app_name TEXT,
        severity TEXT DEFAULT 'warning',
        action TEXT DEFAULT 'alert_only',
        custom_message TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alert_app_rules_app ON alert_app_rules(app_name);
    `);

    // 9. Privacy Shield & Auto-Blur Rules Table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS privacy_rules (
        id TEXT PRIMARY KEY,
        rule_type TEXT DEFAULT 'app_name',
        pattern TEXT,
        action TEXT DEFAULT 'blur_screenshot',
        is_active INTEGER DEFAULT 1,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_privacy_rules_pattern ON privacy_rules(pattern);
    `);

    // Seed default alert & privacy rules if empty
    this.seedDefaultRulesIfEmpty();
  }

  seedDefaultRulesIfEmpty() {
    try {
      const appRuleCount = this.sqlite.prepare('SELECT COUNT(*) as count FROM alert_app_rules').get().count;
      if (appRuleCount === 0) {
        const insertAppRule = this.sqlite.prepare(`
          INSERT INTO alert_app_rules (id, app_name, severity, action, custom_message, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)
        `);
        const now = new Date().toISOString();
        const defaultAppRules = [
          { id: uuidv4(), app_name: 'utorrent.exe', severity: 'critical', action: 'alert_only', custom_message: 'Unauthorized P2P/Torrent client launched' },
          { id: uuidv4(), app_name: 'bittorrent.exe', severity: 'critical', action: 'alert_only', custom_message: 'Unauthorized P2P/Torrent client launched' },
          { id: uuidv4(), app_name: 'poker.exe', severity: 'warning', action: 'alert_only', custom_message: 'Gambling/Gaming software detected during work hours' },
          { id: uuidv4(), app_name: 'cheatengine.exe', severity: 'critical', action: 'alert_only', custom_message: 'Memory injection / Tamper tool detected' },
          { id: uuidv4(), app_name: 'wireshark.exe', severity: 'warning', action: 'alert_only', custom_message: 'Packet sniffing tool executed' }
        ];
        for (const r of defaultAppRules) {
          insertAppRule.run(r.id, r.app_name, r.severity, r.action, r.custom_message, now);
        }
      }

      const privacyRuleCount = this.sqlite.prepare('SELECT COUNT(*) as count FROM privacy_rules').get().count;
      if (privacyRuleCount === 0) {
        const insertPrivacy = this.sqlite.prepare(`
          INSERT INTO privacy_rules (id, rule_type, pattern, action, is_active, created_at)
          VALUES (?, ?, ?, ?, 1, ?)
        `);
        const now = new Date().toISOString();
        const defaultPrivacyRules = [
          { id: uuidv4(), rule_type: 'app_name', pattern: '1password.exe', action: 'blur_screenshot' },
          { id: uuidv4(), rule_type: 'app_name', pattern: 'bitwarden.exe', action: 'blur_screenshot' },
          { id: uuidv4(), rule_type: 'app_name', pattern: 'keepass.exe', action: 'blur_screenshot' },
          { id: uuidv4(), rule_type: 'window_keyword', pattern: '*bank*', action: 'blur_screenshot' },
          { id: uuidv4(), rule_type: 'window_keyword', pattern: '*payroll*', action: 'blur_screenshot' },
          { id: uuidv4(), rule_type: 'window_keyword', pattern: '*medical*', action: 'pause_capture' }
        ];
        for (const pr of defaultPrivacyRules) {
          insertPrivacy.run(pr.id, pr.rule_type, pr.pattern, pr.action, now);
        }
      }
    } catch (e) {
      console.warn('[Database] Seed default rules error:', e.message);
    }
  }

  // --- Automatic One-Time Migration from database.json ---
  migrateFromJsonIfEmpty() {
    try {
      const clientCount = this.sqlite.prepare('SELECT COUNT(*) as count FROM clients').get().count;
      const policyCount = this.sqlite.prepare('SELECT COUNT(*) as count FROM policies').get().count;

      if (clientCount === 0 && policyCount === 0 && fs.existsSync(DB_FILE)) {
        console.log('[Database] 🔄 Performing zero-loss migration from database.json to SQLite...');
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const json = JSON.parse(raw);

        this.sqlite.exec('BEGIN TRANSACTION;');

        // 1. Migrate Security Settings
        if (json.security) {
          const insertSec = this.sqlite.prepare('INSERT OR REPLACE INTO security_settings (key, value, updated_at) VALUES (?, ?, ?)');
          for (const [k, v] of Object.entries(json.security)) {
            insertSec.run(k, typeof v === 'object' ? JSON.stringify(v) : String(v !== null ? v : ''), new Date().toISOString());
          }
        }

        // 2. Migrate Policies
        if (json.policies) {
          const insertPolicy = this.sqlite.prepare(`
            INSERT OR REPLACE INTO policies (
              id, name, allowed_apps_json, allowed_domains_json, sensitive_apps_json,
              sensitive_keywords_json, pause_on_sensitive, work_hours_start, work_hours_end,
              capture_interval_sec, stream_fps, policy_mode, retention_days, active_days_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const [pId, p] of Object.entries(json.policies)) {
            insertPolicy.run(
              pId,
              p.name || 'Workplace Policy',
              JSON.stringify(p.allowed_apps || defaultPolicy.allowed_apps),
              JSON.stringify(p.allowed_domains || defaultPolicy.allowed_domains),
              JSON.stringify(p.sensitive_apps || defaultPolicy.sensitive_apps),
              JSON.stringify(p.sensitive_keywords || defaultPolicy.sensitive_keywords),
              p.pause_on_sensitive !== false ? 1 : 0,
              p.work_hours_start || '00:00',
              p.work_hours_end || '23:59',
              p.capture_interval_sec || 600,
              p.stream_fps || 15,
              p.policy_mode || 'audit-alert',
              p.retention_days || 20,
              JSON.stringify(p.active_days || defaultPolicy.active_days),
              p.updated_at || new Date().toISOString()
            );
          }
        }

        // 3. Migrate Clients
        if (json.clients) {
          const insertClient = this.sqlite.prepare(`
            INSERT OR REPLACE INTO clients (
              id, hostname, username, employee_name, department, ip, os,
              status, agent_version, current_app, current_window, cpu_usage,
              ram_usage, first_seen, last_seen, total_screenshots, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const c of Object.values(json.clients)) {
            insertClient.run(
              c.id,
              c.hostname || 'Unknown-PC',
              c.username || 'Unknown',
              c.employee_name || c.username || 'Employee',
              c.department || 'General',
              c.ip || '127.0.0.1',
              c.os || 'Windows',
              c.status || 'offline',
              c.agent_version || '1.0.0',
              c.current_app || 'None',
              c.current_window || 'Desktop',
              c.cpu_usage || 0,
              c.ram_usage || 0,
              c.first_seen || new Date().toISOString(),
              c.last_seen || new Date().toISOString(),
              c.total_screenshots || 0,
              '{}'
            );
          }
        }

        // 4. Migrate Screenshots
        if (Array.isArray(json.screenshots)) {
          const insertScreenshot = this.sqlite.prepare(`
            INSERT OR REPLACE INTO screenshots (
              id, client_id, filepath, filename, timestamp, active_app,
              active_window, file_size, is_encrypted, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const s of json.screenshots) {
            insertScreenshot.run(
              s.id || uuidv4(),
              s.client_id || 'UNKNOWN',
              s.filepath || '',
              s.filename || '',
              s.timestamp || new Date().toISOString(),
              s.active_app || 'Unknown',
              s.active_window || 'Desktop',
              s.file_size || 0,
              s.is_encrypted ? 1 : 0,
              s.timestamp || new Date().toISOString()
            );
          }
        }

        // 5. Migrate Logs
        if (Array.isArray(json.logs)) {
          const insertLog = this.sqlite.prepare(`
            INSERT OR REPLACE INTO audit_logs (
              id, client_id, event_type, details, timestamp, prev_hash, hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `);

          for (const l of json.logs) {
            insertLog.run(
              l.id || uuidv4(),
              l.client_id || 'SYSTEM',
              l.event_type || 'INFO',
              l.details || '',
              l.timestamp || new Date().toISOString(),
              l.prev_hash || '0000000000000000000000000000000000000000000000000000000000000000',
              l.hash || ''
            );
          }
        }

        this.sqlite.exec('COMMIT;');
        console.log('✅ [Database] Zero-loss migration to SQLite completed successfully!');
        
        // Make a safety backup of database.json
        try {
          fs.copyFileSync(DB_FILE, path.join(DATA_DIR, 'database.json.bak'));
        } catch (e) {}
      }
    } catch (err) {
      try { this.sqlite.exec('ROLLBACK;'); } catch (e) {}
      console.error('[Database] Migration error:', err.message);
    }
  }

  ensureSecurityDefaults() {
    const getSetting = (k) => {
      const row = this.sqlite.prepare('SELECT value FROM security_settings WHERE key = ?').get(k);
      return row ? row.value : null;
    };

    const setSetting = (k, v) => {
      this.sqlite.prepare('INSERT OR REPLACE INTO security_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run(k, String(v), new Date().toISOString());
    };

    if (!getSetting('agent_secret_key')) {
      setSetting('agent_secret_key', 'workguard-lan-secret-key-2026');
    }
    if (!getSetting('session_secret')) {
      setSetting('session_secret', crypto.randomBytes(32).toString('hex'));
    }
    if (!getSetting('encryption_key')) {
      setSetting('encryption_key', crypto.randomBytes(32).toString('hex'));
    }
    if (getSetting('encryption_enabled') === null) {
      setSetting('encryption_enabled', 'false');
    }
    if (getSetting('auto_update_clients') === null) {
      setSetting('auto_update_clients', 'true');
    }
    if (getSetting('session_timeout_minutes') === null) {
      setSetting('session_timeout_minutes', '15');
    }
    if (getSetting('login_rate_limit_enabled') === null) {
      setSetting('login_rate_limit_enabled', 'true');
    }

    // Ensure default policy exists
    const defaultPol = this.sqlite.prepare('SELECT id FROM policies WHERE id = ?').get('default');
    if (!defaultPol) {
      this.sqlite.prepare(`
        INSERT INTO policies (
          id, name, allowed_apps_json, allowed_domains_json, sensitive_apps_json,
          sensitive_keywords_json, pause_on_sensitive, work_hours_start, work_hours_end,
          capture_interval_sec, stream_fps, policy_mode, retention_days, active_days_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'default',
        defaultPolicy.name,
        JSON.stringify(defaultPolicy.allowed_apps),
        JSON.stringify(defaultPolicy.allowed_domains),
        JSON.stringify(defaultPolicy.sensitive_apps),
        JSON.stringify(defaultPolicy.sensitive_keywords),
        defaultPolicy.pause_on_sensitive,
        defaultPolicy.work_hours_start,
        defaultPolicy.work_hours_end,
        defaultPolicy.capture_interval_sec,
        defaultPolicy.stream_fps,
        defaultPolicy.policy_mode,
        defaultPolicy.retention_days,
        JSON.stringify(defaultPolicy.active_days),
        new Date().toISOString()
      );
    }
  }

  // --- Security & Authentication Operations ---
  isPasswordSet() {
    const row = this.sqlite.prepare("SELECT value FROM security_settings WHERE key = 'admin_password_hash'").get();
    return !!(row && row.value && row.value.trim() !== '');
  }

  setAdminPassword(newPassword) {
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }
    const { hash, salt } = securityAuth.hashPassword(newPassword);
    const now = new Date().toISOString();
    
    this.sqlite.prepare("INSERT OR REPLACE INTO security_settings (key, value, updated_at) VALUES ('admin_password_hash', ?, ?)").run(hash, now);
    this.sqlite.prepare("INSERT OR REPLACE INTO security_settings (key, value, updated_at) VALUES ('admin_password_salt', ?, ?)").run(salt, now);
    
    this.addLog('SYSTEM', 'ADMIN_PASSWORD_CHANGED', 'Admin master password updated successfully.');
    return true;
  }

  verifyAdminPassword(password) {
    if (!this.isPasswordSet()) return false;
    const hashRow = this.sqlite.prepare("SELECT value FROM security_settings WHERE key = 'admin_password_hash'").get();
    const saltRow = this.sqlite.prepare("SELECT value FROM security_settings WHERE key = 'admin_password_salt'").get();
    if (!hashRow || !saltRow) return false;

    return securityAuth.verifyPassword(password, hashRow.value, saltRow.value);
  }

  getSecurityConfig() {
    const getVal = (k) => {
      const row = this.sqlite.prepare('SELECT value FROM security_settings WHERE key = ?').get(k);
      return row ? row.value : null;
    };

    return {
      is_password_set: this.isPasswordSet(),
      agent_secret_key: getVal('agent_secret_key') || 'workguard-lan-secret-key-2026',
      encryption_enabled: getVal('encryption_enabled') === 'true',
      session_timeout_minutes: parseInt(getVal('session_timeout_minutes') || '15', 10),
      auto_update_clients: getVal('auto_update_clients') !== 'false'
    };
  }

  updateSecurityConfig(updates = {}) {
    const setVal = (k, v) => {
      this.sqlite.prepare('INSERT OR REPLACE INTO security_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run(k, String(v), new Date().toISOString());
    };

    if (updates.agent_secret_key && typeof updates.agent_secret_key === 'string' && updates.agent_secret_key.trim()) {
      setVal('agent_secret_key', updates.agent_secret_key.trim());
    }
    if (typeof updates.encryption_enabled === 'boolean') {
      setVal('encryption_enabled', updates.encryption_enabled ? 'true' : 'false');
    }
    if (typeof updates.auto_update_clients === 'boolean') {
      setVal('auto_update_clients', updates.auto_update_clients ? 'true' : 'false');
    }
    if (updates.session_timeout_minutes && Number(updates.session_timeout_minutes) > 0) {
      const minutes = Math.max(1, Math.min(1440, Number(updates.session_timeout_minutes)));
      setVal('session_timeout_minutes', minutes);
    }
    this.addLog('SYSTEM', 'SECURITY_CONFIG_UPDATED', 'Security and privacy configuration updated.');
    return this.getSecurityConfig();
  }

  isAutoUpdateEnabled() {
    const row = this.sqlite.prepare("SELECT value FROM security_settings WHERE key = 'auto_update_clients'").get();
    return row ? row.value !== 'false' : true;
  }

  setAutoUpdateEnabled(enabled) {
    this.sqlite.prepare("INSERT OR REPLACE INTO security_settings (key, value, updated_at) VALUES ('auto_update_clients', ?, ?)")
      .run(enabled ? 'true' : 'false', new Date().toISOString());
    return !!enabled;
  }

  getAgentSecretKey() {
    const row = this.sqlite.prepare("SELECT value FROM security_settings WHERE key = 'agent_secret_key'").get();
    return row ? row.value : 'workguard-lan-secret-key-2026';
  }

  getSessionSecret() {
    const row = this.sqlite.prepare("SELECT value FROM security_settings WHERE key = 'session_secret'").get();
    return row ? row.value : null;
  }

  getEncryptionKey() {
    const row = this.sqlite.prepare("SELECT value FROM security_settings WHERE key = 'encryption_key'").get();
    return row ? row.value : null;
  }

  isEncryptionEnabled() {
    const row = this.sqlite.prepare("SELECT value FROM security_settings WHERE key = 'encryption_enabled'").get();
    return row ? row.value === 'true' : false;
  }

  // --- Clients Operations ---
  upsertClient(clientInfo) {
    const { id, hostname, username, employee_name, department, ip, os, current_app, current_window, cpu_usage, ram_usage, agent_version } = clientInfo;
    const now = new Date().toISOString();
    
    const existing = this.sqlite.prepare('SELECT * FROM clients WHERE id = ?').get(id);

    if (!existing) {
      const cleanHost = securityAuth.sanitizeText(hostname) || 'Unknown-PC';
      const cleanUser = securityAuth.sanitizeText(username) || 'Unknown';
      const cleanEmp = securityAuth.sanitizeText(employee_name) || cleanUser || 'Employee';
      const cleanDept = securityAuth.sanitizeText(department) || 'General';
      const cleanApp = securityAuth.sanitizeText(current_app) || 'None';
      const cleanWin = securityAuth.sanitizeText(current_window) || 'Desktop';

      this.sqlite.prepare(`
        INSERT INTO clients (
          id, hostname, username, employee_name, department, ip, os,
          status, agent_version, current_app, current_window, cpu_usage,
          ram_usage, first_seen, last_seen, total_screenshots, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, cleanHost, cleanUser, cleanEmp, cleanDept, ip || '127.0.0.1', os || 'Windows',
        'online', agent_version || '1.0.0', cleanApp, cleanWin, cpu_usage || 0,
        ram_usage || 0, now, now, 0, '{}'
      );

      this.addLog(id, 'AGENT_CONNECTED', `Agent registered: ${cleanEmp} from ${cleanHost} (${ip}) - v${agent_version || '1.0.0'}`);
    } else {
      const cleanHost = hostname ? securityAuth.sanitizeText(hostname) : existing.hostname;
      const cleanUser = username ? securityAuth.sanitizeText(username) : existing.username;
      const cleanEmp = employee_name ? securityAuth.sanitizeText(employee_name) : (existing.employee_name || cleanUser);
      const cleanDept = department ? securityAuth.sanitizeText(department) : (existing.department || 'General');
      const cleanApp = current_app !== undefined ? securityAuth.sanitizeText(current_app) : existing.current_app;
      const cleanWin = current_window !== undefined ? securityAuth.sanitizeText(current_window) : existing.current_window;

      this.sqlite.prepare(`
        UPDATE clients SET
          hostname = ?, username = ?, employee_name = ?, department = ?,
          ip = ?, status = 'online', agent_version = ?, current_app = ?,
          current_window = ?, cpu_usage = ?, ram_usage = ?, last_seen = ?
        WHERE id = ?
      `).run(
        cleanHost, cleanUser, cleanEmp, cleanDept, ip || existing.ip,
        agent_version || existing.agent_version || '1.0.0', cleanApp, cleanWin,
        cpu_usage !== undefined ? cpu_usage : existing.cpu_usage,
        ram_usage !== undefined ? ram_usage : existing.ram_usage,
        now, id
      );
    }

    return this.getClient(id);
  }

  updateClientProfile(id, { employee_name, department }) {
    const existing = this.getClient(id);
    if (!existing) return null;

    const cleanEmp = employee_name ? securityAuth.sanitizeText(employee_name) : existing.employee_name;
    const cleanDept = department ? securityAuth.sanitizeText(department) : existing.department;
    const now = new Date().toISOString();

    this.sqlite.prepare('UPDATE clients SET employee_name = ?, department = ?, last_seen = ? WHERE id = ?')
      .run(cleanEmp, cleanDept, now, id);

    this.addLog(id, 'PROFILE_UPDATED_BY_ADMIN', `Admin updated profile: Name="${cleanEmp}", Dept="${cleanDept}"`);
    return this.getClient(id);
  }

  setClientStatus(id, status) {
    const existing = this.getClient(id);
    if (existing) {
      const now = new Date().toISOString();
      this.sqlite.prepare('UPDATE clients SET status = ?, last_seen = ? WHERE id = ?').run(status, now, id);
      if (status === 'offline') {
        this.addLog(id, 'AGENT_DISCONNECTED', 'Agent disconnected');
      }
    }
  }

  getClients() {
    const rows = this.sqlite.prepare('SELECT * FROM clients ORDER BY last_seen DESC').all();
    const now = Date.now();

    // Auto-mark clients as offline if no ping in 45 seconds
    const offlineStmt = this.sqlite.prepare("UPDATE clients SET status = 'offline' WHERE id = ?");
    for (const client of rows) {
      const lastSeenMs = new Date(client.last_seen).getTime();
      if (now - lastSeenMs > 45000 && client.status === 'online') {
        client.status = 'offline';
        offlineStmt.run(client.id);
      }
    }
    return rows;
  }

  getClient(id) {
    return this.sqlite.prepare('SELECT * FROM clients WHERE id = ?').get(id) || null;
  }

  deleteClient(id) {
    this.sqlite.exec('BEGIN TRANSACTION;');
    try {
      this.sqlite.prepare('DELETE FROM clients WHERE id = ?').run(id);
      this.sqlite.prepare('DELETE FROM screenshots WHERE client_id = ?').run(id);
      this.sqlite.prepare('DELETE FROM audit_logs WHERE client_id = ?').run(id);
      this.sqlite.exec('COMMIT;');
      return true;
    } catch (e) {
      this.sqlite.exec('ROLLBACK;');
      throw e;
    }
  }

  // --- Screenshots Operations ---
  addScreenshot(entry) {
    const id = uuidv4();
    const now = entry.timestamp || new Date().toISOString();
    const cleanApp = securityAuth.sanitizeText(entry.active_app) || 'Unknown';
    const cleanWin = securityAuth.sanitizeText(entry.active_window) || 'Desktop';
    const isEncrypted = entry.is_encrypted ? 1 : 0;
    const fileSize = entry.file_size || 0;

    this.sqlite.prepare(`
      INSERT INTO screenshots (
        id, client_id, filepath, filename, timestamp, active_app,
        active_window, file_size, is_encrypted, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, entry.client_id, entry.filepath, entry.filename, now,
      cleanApp, cleanWin, fileSize, isEncrypted, now
    );

    // Update client stats
    this.sqlite.prepare(`
      UPDATE clients SET
        total_screenshots = total_screenshots + 1,
        last_seen = ?,
        current_app = ?,
        current_window = ?
      WHERE id = ?
    `).run(now, cleanApp, cleanWin, entry.client_id);

    return {
      id,
      client_id: entry.client_id,
      filepath: entry.filepath,
      filename: entry.filename,
      timestamp: now,
      active_app: cleanApp,
      active_window: cleanWin,
      file_size: fileSize,
      is_encrypted: !!isEncrypted
    };
  }

  getScreenshots(filter = {}) {
    let query = 'SELECT * FROM screenshots WHERE 1=1';
    const params = [];

    if (filter.client_id && filter.client_id !== 'all') {
      query += ' AND client_id = ?';
      params.push(filter.client_id);
    }
    if (filter.date) {
      query += ' AND timestamp LIKE ?';
      params.push(`${filter.date}%`);
    }

    query += ' ORDER BY timestamp DESC';
    const limit = parseInt(filter.limit, 10) || 100;
    query += ` LIMIT ${limit}`;

    const rows = this.sqlite.prepare(query).all(...params);
    return rows.map(r => ({
      ...r,
      is_encrypted: !!r.is_encrypted
    }));
  }

  // --- Automatic Screenshot Cleanup & Secure File Shredding ---
  purgeExpiredScreenshots(retentionDays = null) {
    const policy = this.getPolicy('default');
    const days = retentionDays !== null ? retentionDays : (policy.retention_days !== undefined ? policy.retention_days : 20);
    
    if (days <= 0) {
      return { deletedCount: 0, freedBytes: 0, retentionDays: 0 };
    }

    const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);
    const cutoffIso = new Date(cutoffMs).toISOString();

    const expired = this.sqlite.prepare('SELECT id, filepath, file_size FROM screenshots WHERE timestamp < ?').all(cutoffIso);
    
    if (expired.length === 0) {
      return { deletedCount: 0, freedBytes: 0, retentionDays: days };
    }

    let deletedCount = 0;
    let freedBytes = 0;
    const baseStorage = path.join(__dirname, '..', 'storage');

    for (const s of expired) {
      deletedCount++;
      freedBytes += (s.file_size || 0);

      if (s.filepath) {
        const rel = s.filepath
          .replace('/api/screenshots/raw/', 'screenshots/')
          .replace('/screenshots-raw/', 'screenshots/')
          .replace(/^\/+/, '');
        const fullPath = path.join(baseStorage, rel);
        try {
          if (fs.existsSync(fullPath)) {
            // Secure data shredding: Overwrite bytes with zeroes before unlinking
            try {
              const stat = fs.statSync(fullPath);
              const zeroBuf = Buffer.alloc(Math.min(stat.size, 512 * 1024), 0);
              fs.writeFileSync(fullPath, zeroBuf);
            } catch (shredErr) {}
            fs.unlinkSync(fullPath);
          }
        } catch (e) {
          console.error(`[AutoClean] Error deleting ${fullPath}:`, e.message);
        }
      }
    }

    // Delete records from database atomically
    this.sqlite.prepare('DELETE FROM screenshots WHERE timestamp < ?').run(cutoffIso);

    if (deletedCount > 0) {
      console.log(`[AutoClean] 🧹 Securely shredded ${deletedCount} screenshots older than ${days} days (${(freedBytes / (1024 * 1024)).toFixed(1)} MB freed).`);
      this.addLog('SYSTEM', 'STORAGE_CLEANUP', `Securely auto-shredded ${deletedCount} expired screenshots older than ${days} days.`);
    }

    return { deletedCount, freedBytes, retentionDays: days };
  }

  // --- Policies Operations ---
  getPolicy(policyId = 'default') {
    const row = this.sqlite.prepare('SELECT * FROM policies WHERE id = ?').get(policyId);
    if (!row) {
      return { ...defaultPolicy, id: policyId };
    }

    return {
      id: row.id,
      name: row.name,
      allowed_apps: JSON.parse(row.allowed_apps_json || '[]'),
      allowed_domains: JSON.parse(row.allowed_domains_json || '[]'),
      sensitive_apps: JSON.parse(row.sensitive_apps_json || '[]'),
      sensitive_keywords: JSON.parse(row.sensitive_keywords_json || '[]'),
      pause_on_sensitive: row.pause_on_sensitive !== 0,
      work_hours_start: row.work_hours_start,
      work_hours_end: row.work_hours_end,
      capture_interval_sec: row.capture_interval_sec,
      stream_fps: row.stream_fps,
      policy_mode: row.policy_mode,
      retention_days: row.retention_days,
      active_days: JSON.parse(row.active_days_json || '[]'),
      updated_at: row.updated_at
    };
  }

  updatePolicy(policyId = 'default', updates) {
    const existing = this.getPolicy(policyId);
    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };

    this.sqlite.prepare(`
      INSERT OR REPLACE INTO policies (
        id, name, allowed_apps_json, allowed_domains_json, sensitive_apps_json,
        sensitive_keywords_json, pause_on_sensitive, work_hours_start, work_hours_end,
        capture_interval_sec, stream_fps, policy_mode, retention_days, active_days_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      policyId,
      updated.name,
      JSON.stringify(updated.allowed_apps),
      JSON.stringify(updated.allowed_domains),
      JSON.stringify(updated.sensitive_apps),
      JSON.stringify(updated.sensitive_keywords),
      updated.pause_on_sensitive ? 1 : 0,
      updated.work_hours_start,
      updated.work_hours_end,
      updated.capture_interval_sec,
      updated.stream_fps,
      updated.policy_mode,
      updated.retention_days,
      JSON.stringify(updated.active_days),
      updated.updated_at
    );

    this.addLog('SYSTEM', 'POLICY_UPDATED', `Policy '${policyId}' updated`);
    return this.getPolicy(policyId);
  }

  getPolicies() {
    const rows = this.sqlite.prepare('SELECT id FROM policies').all();
    const result = {};
    for (const r of rows) {
      result[r.id] = this.getPolicy(r.id);
    }
    return result;
  }

  // --- Cryptographic Tamper-Evident Logs ---
  addLog(client_id, event_type, details) {
    const latest = this.sqlite.prepare('SELECT hash FROM audit_logs ORDER BY timestamp DESC LIMIT 1').get();
    const prevHash = latest && latest.hash ? latest.hash : '0000000000000000000000000000000000000000000000000000000000000000';
    
    const id = uuidv4();
    const now = new Date().toISOString();
    const cleanDetails = securityAuth.sanitizeText(details, 500);

    const logEntry = {
      id,
      client_id: client_id || 'UNKNOWN',
      event_type,
      details: cleanDetails,
      timestamp: now,
      prev_hash: prevHash
    };
    logEntry.hash = securityAuth.computeLogHash(logEntry, prevHash);

    this.sqlite.prepare(`
      INSERT INTO audit_logs (id, client_id, event_type, details, timestamp, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, logEntry.client_id, event_type, cleanDetails, now, prevHash, logEntry.hash);

    return logEntry;
  }

  getLogs(limit = 100) {
    const lim = Math.max(1, Math.min(1000, parseInt(limit, 10) || 100));
    return this.sqlite.prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ${lim}`).all();
  }

  verifyAuditLogChain() {
    const logs = this.sqlite.prepare('SELECT * FROM audit_logs ORDER BY timestamp ASC').all();
    if (logs.length === 0) return { valid: true, count: 0 };

    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const expectedHash = securityAuth.computeLogHash(log, prevHash);
      if (log.hash !== expectedHash) {
        return { valid: false, brokenIndex: i, logId: log.id, count: logs.length };
      }
      prevHash = log.hash;
    }
    return { valid: true, count: logs.length };
  }

  // --- Statistics & Overview ---
  getStats() {
    const clients = this.getClients();
    const onlineClients = clients.filter(c => c.status === 'online').length;
    const totalScreenshots = this.sqlite.prepare('SELECT COUNT(*) as count FROM screenshots').get().count;
    
    const todayStr = new Date().toISOString().split('T')[0];
    const todayScreenshots = this.sqlite.prepare("SELECT COUNT(*) as count FROM screenshots WHERE timestamp LIKE ?").get(`${todayStr}%`).count;
    
    const violations = this.sqlite.prepare("SELECT COUNT(*) as count FROM audit_logs WHERE event_type IN ('APP_BLOCKED', 'DOMAIN_BLOCKED')").get().count;

    const policy = this.getPolicy('default');

    return {
      total_clients: clients.length,
      online_clients: onlineClients,
      total_screenshots: totalScreenshots,
      today_screenshots: todayScreenshots,
      total_violations: violations,
      active_policy_mode: policy.policy_mode,
      is_password_set: this.isPasswordSet(),
      encryption_enabled: this.isEncryptionEnabled()
    };
  }

  // --- Database Studio & Management Methods ---
  getDatabaseStats() {
    let dbSize = 0;
    try {
      if (fs.existsSync(this.dbPath)) {
        dbSize = fs.statSync(this.dbPath).size;
      }
    } catch (e) {}

    const tableCounts = {
      clients: this.sqlite.prepare('SELECT COUNT(*) as count FROM clients').get().count,
      screenshots: this.sqlite.prepare('SELECT COUNT(*) as count FROM screenshots').get().count,
      policies: this.sqlite.prepare('SELECT COUNT(*) as count FROM policies').get().count,
      audit_logs: this.sqlite.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count,
      security_settings: this.sqlite.prepare('SELECT COUNT(*) as count FROM security_settings').get().count
    };

    // Calculate total screenshot file size from DB
    const storageSum = this.sqlite.prepare('SELECT SUM(file_size) as total_size FROM screenshots').get();
    const screenshotBytes = storageSum && storageSum.total_size ? storageSum.total_size : 0;

    const policy = this.getPolicy('default');

    return {
      engine: 'SQLite (WAL Mode)',
      db_path: this.dbPath,
      db_file_size_bytes: dbSize,
      db_file_size_formatted: `${(dbSize / (1024 * 1024)).toFixed(2)} MB`,
      screenshot_storage_bytes: screenshotBytes,
      screenshot_storage_formatted: `${(screenshotBytes / (1024 * 1024)).toFixed(2)} MB`,
      table_counts: tableCounts,
      retention_days: policy.retention_days || 20,
      tables: ['clients', 'screenshots', 'policies', 'audit_logs', 'security_settings']
    };
  }

  getTableRecords(tableName, { page = 1, limit = 20, search = '', sortBy = '', sortOrder = 'DESC' } = {}) {
    const validTables = ['clients', 'screenshots', 'policies', 'audit_logs', 'security_settings'];
    if (!validTables.includes(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const offset = (p - 1) * l;

    let whereClause = '1=1';
    const params = [];

    if (search && typeof search === 'string' && search.trim() !== '') {
      const term = `%${search.trim()}%`;
      if (tableName === 'clients') {
        whereClause += ' AND (id LIKE ? OR hostname LIKE ? OR username LIKE ? OR employee_name LIKE ? OR department LIKE ? OR ip LIKE ?)';
        params.push(term, term, term, term, term, term);
      } else if (tableName === 'screenshots') {
        whereClause += ' AND (id LIKE ? OR client_id LIKE ? OR active_app LIKE ? OR active_window LIKE ? OR timestamp LIKE ?)';
        params.push(term, term, term, term, term);
      } else if (tableName === 'policies') {
        whereClause += ' AND (id LIKE ? OR name LIKE ? OR policy_mode LIKE ?)';
        params.push(term, term, term);
      } else if (tableName === 'audit_logs') {
        whereClause += ' AND (id LIKE ? OR client_id LIKE ? OR event_type LIKE ? OR details LIKE ? OR timestamp LIKE ?)';
        params.push(term, term, term, term, term);
      } else if (tableName === 'security_settings') {
        whereClause += ' AND (key LIKE ? OR value LIKE ?)';
        params.push(term, term);
      }
    }

    const totalCount = this.sqlite.prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE ${whereClause}`).get(...params).count;

    let orderClause = '';
    const safeOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    if (sortBy && /^[a-zA-Z0-9_]+$/.test(sortBy)) {
      orderClause = `ORDER BY ${sortBy} ${safeOrder}`;
    } else {
      if (tableName === 'screenshots' || tableName === 'audit_logs') {
        orderClause = `ORDER BY timestamp ${safeOrder}`;
      } else if (tableName === 'clients') {
        orderClause = `ORDER BY last_seen ${safeOrder}`;
      }
    }

    const rows = this.sqlite.prepare(`SELECT * FROM ${tableName} WHERE ${whereClause} ${orderClause} LIMIT ${l} OFFSET ${offset}`).all(...params);

    return {
      table: tableName,
      page: p,
      limit: l,
      total_records: totalCount,
      total_pages: Math.ceil(totalCount / l) || 1,
      records: rows
    };
  }

  insertRecord(tableName, data) {
    const validTables = ['clients', 'policies', 'security_settings'];
    if (!validTables.includes(tableName)) {
      throw new Error(`Direct inserts are not allowed for table: ${tableName}`);
    }

    const keys = Object.keys(data).filter(k => /^[a-zA-Z0-9_]+$/.test(k));
    if (keys.length === 0) throw new Error('No valid columns provided');

    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map(k => data[k]);

    this.sqlite.prepare(`INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`).run(...values);
    this.addLog('SYSTEM', 'DATABASE_RECORD_INSERTED', `Inserted record into table '${tableName}'`);
    return { success: true };
  }

  updateRecord(tableName, id, data) {
    const validTables = ['clients', 'policies', 'security_settings', 'screenshots'];
    if (!validTables.includes(tableName)) {
      throw new Error(`Updates are not allowed for table: ${tableName}`);
    }

    const primaryKey = tableName === 'security_settings' ? 'key' : 'id';
    const keys = Object.keys(data).filter(k => k !== primaryKey && /^[a-zA-Z0-9_]+$/.test(k));
    if (keys.length === 0) throw new Error('No valid columns to update');

    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k]);
    values.push(id);

    this.sqlite.prepare(`UPDATE ${tableName} SET ${setClause} WHERE ${primaryKey} = ?`).run(...values);
    this.addLog('SYSTEM', 'DATABASE_RECORD_UPDATED', `Updated record '${id}' in table '${tableName}'`);
    return { success: true };
  }

  deleteRecord(tableName, id) {
    const validTables = ['clients', 'screenshots', 'policies', 'audit_logs', 'security_settings'];
    if (!validTables.includes(tableName)) {
      throw new Error(`Deletions are not allowed for table: ${tableName}`);
    }

    const primaryKey = tableName === 'security_settings' ? 'key' : 'id';
    this.sqlite.prepare(`DELETE FROM ${tableName} WHERE ${primaryKey} = ?`).run(id);
    this.addLog('SYSTEM', 'DATABASE_RECORD_DELETED', `Deleted record '${id}' from table '${tableName}'`);
    return { success: true };
  }

  exportFullJson() {
    const clients = this.sqlite.prepare('SELECT * FROM clients').all();
    const clientsMap = {};
    for (const c of clients) {
      clientsMap[c.id] = c;
    }

    const policies = this.getPolicies();
    const screenshots = this.sqlite.prepare('SELECT * FROM screenshots ORDER BY timestamp DESC LIMIT 5000').all();
    const logs = this.sqlite.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 2000').all();

    const secRows = this.sqlite.prepare('SELECT key, value FROM security_settings').all();
    const security = {};
    for (const r of secRows) {
      if (r.key === 'encryption_enabled' || r.key === 'auto_update_clients' || r.key === 'login_rate_limit_enabled') {
        security[r.key] = r.value === 'true';
      } else if (r.key === 'session_timeout_minutes') {
        security[r.key] = parseInt(r.value, 10);
      } else {
        security[r.key] = r.value;
      }
    }

    return {
      exported_at: new Date().toISOString(),
      security,
      clients: clientsMap,
      policies,
      screenshots,
      logs
    };
  }

  // ==========================================
  // RBAC & MULTI-ADMIN USER MANAGEMENT
  // ==========================================
  getAdminUsers() {
    const rows = this.sqlite.prepare('SELECT id, username, full_name, role, allowed_departments, is_active, created_at, last_login FROM admin_users ORDER BY created_at ASC').all();
    return rows.map(r => ({
      ...r,
      allowed_departments: (() => {
        try { return JSON.parse(r.allowed_departments); } catch (e) { return ['ALL']; }
      })(),
      is_active: r.is_active === 1
    }));
  }

  getAdminUserByUsername(username) {
    const r = this.sqlite.prepare('SELECT * FROM admin_users WHERE username = ? COLLATE NOCASE').get(username);
    if (!r) return null;
    return {
      ...r,
      allowed_departments: (() => {
        try { return JSON.parse(r.allowed_departments); } catch (e) { return ['ALL']; }
      })(),
      is_active: r.is_active === 1
    };
  }

  getAdminUserById(id) {
    const r = this.sqlite.prepare('SELECT id, username, full_name, role, allowed_departments, is_active, created_at, last_login FROM admin_users WHERE id = ?').get(id);
    if (!r) return null;
    return {
      ...r,
      allowed_departments: (() => {
        try { return JSON.parse(r.allowed_departments); } catch (e) { return ['ALL']; }
      })(),
      is_active: r.is_active === 1
    };
  }

  createAdminUser({ username, password, full_name, role = 'dept_manager', allowed_departments = ['ALL'] }) {
    if (!username || !password) throw new Error('Username and password are required');
    const existing = this.getAdminUserByUsername(username);
    if (existing) throw new Error(`User with username '${username}' already exists`);

    const { hash, salt } = securityAuth.hashPassword(password);
    const id = uuidv4();
    const now = new Date().toISOString();
    const deptsJson = JSON.stringify(Array.isArray(allowed_departments) ? allowed_departments : [allowed_departments]);

    this.sqlite.prepare(`
      INSERT INTO admin_users (id, username, password_hash, salt, full_name, role, allowed_departments, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, username.trim().toLowerCase(), hash, salt, full_name || username, role, deptsJson, now);

    this.addLog('SYSTEM', 'ADMIN_USER_CREATED', `Created admin account '${username}' with role '${role}'`);
    return this.getAdminUserById(id);
  }

  updateAdminUser(id, { full_name, role, allowed_departments, is_active, password }) {
    const user = this.sqlite.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
    if (!user) throw new Error(`User with ID '${id}' not found`);

    let hash = user.password_hash;
    let salt = user.salt;
    if (password && password.trim().length > 0) {
      const hashed = securityAuth.hashPassword(password.trim());
      hash = hashed.hash;
      salt = hashed.salt;
    }

    const deptsJson = allowed_departments !== undefined ? 
      JSON.stringify(Array.isArray(allowed_departments) ? allowed_departments : [allowed_departments]) : 
      user.allowed_departments;

    this.sqlite.prepare(`
      UPDATE admin_users 
      SET full_name = ?, role = ?, allowed_departments = ?, is_active = ?, password_hash = ?, salt = ?
      WHERE id = ?
    `).run(
      full_name !== undefined ? full_name : user.full_name,
      role !== undefined ? role : user.role,
      deptsJson,
      is_active !== undefined ? (is_active ? 1 : 0) : user.is_active,
      hash,
      salt,
      id
    );

    this.addLog('SYSTEM', 'ADMIN_USER_UPDATED', `Updated admin account '${user.username}'`);
    return this.getAdminUserById(id);
  }

  deleteAdminUser(id) {
    const user = this.sqlite.prepare('SELECT username, role FROM admin_users WHERE id = ?').get(id);
    if (!user) throw new Error(`User with ID '${id}' not found`);
    if (user.role === 'superadmin') {
      const superCount = this.sqlite.prepare("SELECT COUNT(*) as count FROM admin_users WHERE role = 'superadmin' AND is_active = 1").get().count;
      if (superCount <= 1) {
        throw new Error('Cannot delete the last active SuperAdmin account');
      }
    }

    this.sqlite.prepare('DELETE FROM admin_users WHERE id = ?').run(id);
    this.addLog('SYSTEM', 'ADMIN_USER_DELETED', `Deleted admin account '${user.username}'`);
    return { success: true };
  }

  recordAdminLogin(id) {
    const now = new Date().toISOString();
    this.sqlite.prepare('UPDATE admin_users SET last_login = ? WHERE id = ?').run(now, id);
  }

  // ==========================================
  // REAL-TIME ALERTS & WEBHOOKS MANAGEMENT
  // ==========================================
  getAlertWebhooks() {
    const rows = this.sqlite.prepare('SELECT * FROM alert_webhooks ORDER BY created_at DESC').all();
    return rows.map(r => ({
      ...r,
      events: (() => {
        try { return JSON.parse(r.events); } catch (e) { return ['blacklisted_app']; }
      })(),
      is_enabled: r.is_enabled === 1
    }));
  }

  getAlertWebhookById(id) {
    const r = this.sqlite.prepare('SELECT * FROM alert_webhooks WHERE id = ?').get(id);
    if (!r) return null;
    return {
      ...r,
      events: (() => {
        try { return JSON.parse(r.events); } catch (e) { return ['blacklisted_app']; }
      })(),
      is_enabled: r.is_enabled === 1
    };
  }

  saveAlertWebhook({ id, name, type = 'slack', webhook_url, events = ['blacklisted_app'], is_enabled = true }) {
    if (!name || !webhook_url) throw new Error('Webhook name and URL are required');
    const existing = id ? this.sqlite.prepare('SELECT id FROM alert_webhooks WHERE id = ?').get(id) : null;
    const eventsJson = JSON.stringify(Array.isArray(events) ? events : [events]);
    const enabledInt = is_enabled ? 1 : 0;

    if (existing) {
      this.sqlite.prepare(`
        UPDATE alert_webhooks 
        SET name = ?, type = ?, webhook_url = ?, events = ?, is_enabled = ?
        WHERE id = ?
      `).run(name, type, webhook_url, eventsJson, enabledInt, id);
      this.addLog('SYSTEM', 'WEBHOOK_UPDATED', `Updated alert webhook '${name}' (${type})`);
      return this.getAlertWebhookById(id);
    } else {
      const newId = uuidv4();
      const now = new Date().toISOString();
      this.sqlite.prepare(`
        INSERT INTO alert_webhooks (id, name, type, webhook_url, events, is_enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(newId, name, type, webhook_url, eventsJson, enabledInt, now);
      this.addLog('SYSTEM', 'WEBHOOK_CREATED', `Created alert webhook '${name}' (${type})`);
      return this.getAlertWebhookById(newId);
    }
  }

  deleteAlertWebhook(id) {
    this.sqlite.prepare('DELETE FROM alert_webhooks WHERE id = ?').run(id);
    this.addLog('SYSTEM', 'WEBHOOK_DELETED', `Deleted alert webhook '${id}'`);
    return { success: true };
  }

  // ==========================================
  // APPLICATION ALERT RULES ("ADD APPLICATION TOOL")
  // ==========================================
  getAlertAppRules() {
    const rows = this.sqlite.prepare('SELECT * FROM alert_app_rules ORDER BY created_at DESC').all();
    return rows.map(r => ({
      ...r,
      is_active: r.is_active === 1
    }));
  }

  addAlertAppRule({ app_name, severity = 'warning', action = 'alert_only', custom_message = '' }) {
    if (!app_name) throw new Error('Application name is required (e.g., torrent.exe)');
    const id = uuidv4();
    const now = new Date().toISOString();
    const cleanApp = app_name.trim().toLowerCase();

    this.sqlite.prepare(`
      INSERT INTO alert_app_rules (id, app_name, severity, action, custom_message, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(id, cleanApp, severity, action, custom_message || `Detected prohibited application: ${cleanApp}`, now);

    this.addLog('SYSTEM', 'APP_ALERT_RULE_ADDED', `Added alert trigger for application '${cleanApp}' (${severity})`);
    return this.sqlite.prepare('SELECT * FROM alert_app_rules WHERE id = ?').get(id);
  }

  updateAlertAppRule(id, { app_name, severity, action, custom_message, is_active }) {
    const rule = this.sqlite.prepare('SELECT * FROM alert_app_rules WHERE id = ?').get(id);
    if (!rule) throw new Error(`App alert rule '${id}' not found`);

    this.sqlite.prepare(`
      UPDATE alert_app_rules
      SET app_name = ?, severity = ?, action = ?, custom_message = ?, is_active = ?
      WHERE id = ?
    `).run(
      app_name !== undefined ? app_name.trim().toLowerCase() : rule.app_name,
      severity !== undefined ? severity : rule.severity,
      action !== undefined ? action : rule.action,
      custom_message !== undefined ? custom_message : rule.custom_message,
      is_active !== undefined ? (is_active ? 1 : 0) : rule.is_active,
      id
    );

    this.addLog('SYSTEM', 'APP_ALERT_RULE_UPDATED', `Updated alert trigger for application '${rule.app_name}'`);
    return this.sqlite.prepare('SELECT * FROM alert_app_rules WHERE id = ?').get(id);
  }

  deleteAlertAppRule(id) {
    this.sqlite.prepare('DELETE FROM alert_app_rules WHERE id = ?').run(id);
    this.addLog('SYSTEM', 'APP_ALERT_RULE_DELETED', `Deleted alert trigger rule '${id}'`);
    return { success: true };
  }

  checkAppAlertRule(appName) {
    if (!appName) return null;
    const cleanApp = appName.trim().toLowerCase();
    const rule = this.sqlite.prepare('SELECT * FROM alert_app_rules WHERE app_name = ? AND is_active = 1').get(cleanApp);
    return rule || null;
  }

  // ==========================================
  // SMART PRIVACY SHIELD & SENSITIVE DATA RULES
  // ==========================================
  getPrivacyRules() {
    const rows = this.sqlite.prepare('SELECT * FROM privacy_rules ORDER BY created_at DESC').all();
    return rows.map(r => ({
      ...r,
      is_active: r.is_active === 1
    }));
  }

  savePrivacyRule({ id, rule_type = 'app_name', pattern, action = 'blur_screenshot', is_active = true }) {
    if (!pattern) throw new Error('Pattern is required (e.g. 1password.exe or *bank*)');
    const existing = id ? this.sqlite.prepare('SELECT id FROM privacy_rules WHERE id = ?').get(id) : null;
    const cleanPattern = pattern.trim().toLowerCase();
    const activeInt = is_active ? 1 : 0;

    if (existing) {
      this.sqlite.prepare(`
        UPDATE privacy_rules
        SET rule_type = ?, pattern = ?, action = ?, is_active = ?
        WHERE id = ?
      `).run(rule_type, cleanPattern, action, activeInt, id);
      this.addLog('SYSTEM', 'PRIVACY_RULE_UPDATED', `Updated privacy rule for '${cleanPattern}' (${action})`);
      return this.sqlite.prepare('SELECT * FROM privacy_rules WHERE id = ?').get(id);
    } else {
      const newId = uuidv4();
      const now = new Date().toISOString();
      this.sqlite.prepare(`
        INSERT INTO privacy_rules (id, rule_type, pattern, action, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(newId, rule_type, cleanPattern, action, activeInt, now);
      this.addLog('SYSTEM', 'PRIVACY_RULE_CREATED', `Created privacy rule for '${cleanPattern}' (${action})`);
      return this.sqlite.prepare('SELECT * FROM privacy_rules WHERE id = ?').get(newId);
    }
  }

  deletePrivacyRule(id) {
    this.sqlite.prepare('DELETE FROM privacy_rules WHERE id = ?').run(id);
    this.addLog('SYSTEM', 'PRIVACY_RULE_DELETED', `Deleted privacy rule '${id}'`);
    return { success: true };
  }
}

module.exports = new Database();

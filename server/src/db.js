const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'storage');
const DB_FILE = path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial database schema
const defaultData = {
  clients: {},
  screenshots: [],
  policies: {
    default: {
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
      work_hours_start: '00:00', // Configurable 24h format (e.g. 09:00)
      work_hours_end: '23:59',   // e.g. 18:00
      capture_interval_sec: 600, // Take silent screenshot every 10 minutes (600s)
      stream_fps: 15,            // Default live stream FPS
      policy_mode: 'audit-alert',// 'audit-alert' (logs & alerts) or 'strict-block' (kills process)
      retention_days: 20,        // Auto-delete screenshots older than 15-20 days
      active_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      updated_at: new Date().toISOString()
    }
  },
  logs: []
};

class Database {
  constructor() {
    this.data = this.load();
    this.saveDebounceTimer = null;
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        return { ...defaultData, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.error('Error loading database file, initializing defaults:', err.message);
    }
    return JSON.parse(JSON.stringify(defaultData));
  }

  save() {
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (err) {
        console.error('Failed to save database:', err.message);
      }
    }, 150);
  }

  // --- Clients ---
  upsertClient(clientInfo) {
    const { id, hostname, username, employee_name, department, ip, os, current_app, current_window, cpu_usage, ram_usage, agent_version } = clientInfo;
    const now = new Date().toISOString();
    
    if (!this.data.clients[id]) {
      this.data.clients[id] = {
        id,
        hostname: hostname || 'Unknown-PC',
        username: username || 'Unknown',
        employee_name: employee_name || username || 'Employee',
        department: department || 'General',
        ip: ip || '127.0.0.1',
        os: os || 'Windows',
        status: 'online',
        agent_version: agent_version || '1.0.0',
        current_app: current_app || 'None',
        current_window: current_window || 'Desktop',
        cpu_usage: cpu_usage || 0,
        ram_usage: ram_usage || 0,
        first_seen: now,
        last_seen: now,
        total_screenshots: 0
      };
      this.addLog(id, 'AGENT_CONNECTED', `Agent registered: ${employee_name || username} from ${hostname} (${ip}) - v${agent_version || '1.0.0'}`);
    } else {
      this.data.clients[id] = {
        ...this.data.clients[id],
        hostname: hostname || this.data.clients[id].hostname,
        username: username || this.data.clients[id].username,
        employee_name: employee_name || this.data.clients[id].employee_name || username,
        department: department || this.data.clients[id].department || 'General',
        ip: ip || this.data.clients[id].ip,
        status: 'online',
        agent_version: agent_version || this.data.clients[id].agent_version || '1.0.0',
        current_app: current_app !== undefined ? current_app : this.data.clients[id].current_app,
        current_window: current_window !== undefined ? current_window : this.data.clients[id].current_window,
        cpu_usage: cpu_usage !== undefined ? cpu_usage : this.data.clients[id].cpu_usage,
        ram_usage: ram_usage !== undefined ? ram_usage : this.data.clients[id].ram_usage,
        last_seen: now
      };
    }
    this.save();
    return this.data.clients[id];
  }

  updateClientProfile(id, { employee_name, department }) {
    if (!this.data.clients[id]) return null;
    if (employee_name) this.data.clients[id].employee_name = employee_name.trim();
    if (department) this.data.clients[id].department = department.trim();
    this.data.clients[id].last_seen = new Date().toISOString();
    this.addLog(id, 'PROFILE_UPDATED_BY_ADMIN', `Admin updated profile: Name="${this.data.clients[id].employee_name}", Dept="${this.data.clients[id].department}"`);
    this.save();
    return this.data.clients[id];
  }

  setClientStatus(id, status) {
    if (this.data.clients[id]) {
      this.data.clients[id].status = status;
      this.data.clients[id].last_seen = new Date().toISOString();
      if (status === 'offline') {
        this.addLog(id, 'AGENT_DISCONNECTED', `Agent disconnected`);
      }
      this.save();
    }
  }

  getClients() {
    const now = Date.now();
    // Auto-mark clients as offline if no ping in 45 seconds
    Object.values(this.data.clients).forEach(client => {
      const lastSeenMs = new Date(client.last_seen).getTime();
      if (now - lastSeenMs > 45000 && client.status === 'online') {
        client.status = 'offline';
      }
    });
    return Object.values(this.data.clients);
  }

  getClient(id) {
    return this.data.clients[id] || null;
  }

  // --- Screenshots ---
  addScreenshot(entry) {
    const id = uuidv4();
    const item = {
      id,
      client_id: entry.client_id,
      filepath: entry.filepath,
      filename: entry.filename,
      timestamp: entry.timestamp || new Date().toISOString(),
      active_app: entry.active_app || 'Unknown',
      active_window: entry.active_window || 'Desktop',
      file_size: entry.file_size || 0
    };
    
    this.data.screenshots.unshift(item);
    // Keep max 5000 records in memory/db
    if (this.data.screenshots.length > 5000) {
      this.data.screenshots.pop();
    }
    
    if (this.data.clients[entry.client_id]) {
      this.data.clients[entry.client_id].total_screenshots = (this.data.clients[entry.client_id].total_screenshots || 0) + 1;
      this.data.clients[entry.client_id].last_seen = new Date().toISOString();
      this.data.clients[entry.client_id].current_app = entry.active_app;
      this.data.clients[entry.client_id].current_window = entry.active_window;
    }

    this.save();
    return item;
  }

  getScreenshots(filter = {}) {
    let list = [...this.data.screenshots];
    if (filter.client_id && filter.client_id !== 'all') {
      list = list.filter(s => s.client_id === filter.client_id);
    }
    if (filter.date) {
      list = list.filter(s => s.timestamp.startsWith(filter.date));
    }
    const limit = parseInt(filter.limit) || 100;
    return list.slice(0, limit);
  }

  // --- Automatic Screenshot Cleanup / Retention Policy (15-20 days) ---
  purgeExpiredScreenshots(retentionDays = null) {
    const policy = this.getPolicy('default');
    const days = retentionDays !== null ? retentionDays : (policy.retention_days !== undefined ? policy.retention_days : 20);
    
    // If days <= 0, auto-retention is disabled
    if (days <= 0) {
      return { deletedCount: 0, freedBytes: 0, retentionDays: 0 };
    }

    const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);
    const cutoffIso = new Date(cutoffMs).toISOString();

    let deletedCount = 0;
    let freedBytes = 0;

    const keptScreenshots = [];
    const baseStorage = path.join(__dirname, '..', 'storage');

    for (const s of this.data.screenshots) {
      if (s.timestamp && s.timestamp < cutoffIso) {
        deletedCount++;
        freedBytes += (s.file_size || 0);

        // Delete physical file from disk
        if (s.filepath) {
          const rel = s.filepath.replace('/screenshots-raw/', 'screenshots/').replace(/^\/+/, '');
          const fullPath = path.join(baseStorage, rel);
          try {
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
            }
          } catch (e) {
            console.error(`[AutoClean] Error deleting ${fullPath}:`, e.message);
          }
        }
      } else {
        keptScreenshots.push(s);
      }
    }

    this.data.screenshots = keptScreenshots;

    if (deletedCount > 0) {
      console.log(`[AutoClean] 🧹 Removed ${deletedCount} screenshots older than ${days} days (${(freedBytes / (1024 * 1024)).toFixed(1)} MB freed).`);
      this.addLog('SYSTEM', 'STORAGE_CLEANUP', `Auto-deleted ${deletedCount} expired screenshots older than ${days} days.`);
      this.save();
    }

    return { deletedCount, freedBytes, retentionDays: days };
  }

  // --- Policies ---
  getPolicy(policyId = 'default') {
    return this.data.policies[policyId] || this.data.policies.default;
  }

  updatePolicy(policyId = 'default', updates) {
    if (!this.data.policies[policyId]) {
      this.data.policies[policyId] = { ...defaultData.policies.default, id: policyId };
    }
    this.data.policies[policyId] = {
      ...this.data.policies[policyId],
      ...updates,
      updated_at: new Date().toISOString()
    };
    this.addLog('SYSTEM', 'POLICY_UPDATED', `Policy '${policyId}' updated`);
    this.save();
    return this.data.policies[policyId];
  }

  // --- Logs ---
  addLog(client_id, event_type, details) {
    const log = {
      id: uuidv4(),
      client_id: client_id || 'UNKNOWN',
      event_type,
      details,
      timestamp: new Date().toISOString()
    };
    this.data.logs.unshift(log);
    if (this.data.logs.length > 2000) {
      this.data.logs.pop();
    }
    this.save();
    return log;
  }

  getLogs(limit = 100) {
    return this.data.logs.slice(0, limit);
  }

  getStats() {
    const clients = this.getClients();
    const onlineClients = clients.filter(c => c.status === 'online').length;
    const totalScreenshots = this.data.screenshots.length;
    const todayStr = new Date().toISOString().split('T')[0];
    const todayScreenshots = this.data.screenshots.filter(s => s.timestamp.startsWith(todayStr)).length;
    const violationLogs = this.data.logs.filter(l => l.event_type === 'APP_BLOCKED' || l.event_type === 'DOMAIN_BLOCKED').length;

    return {
      total_clients: clients.length,
      online_clients: onlineClients,
      total_screenshots: totalScreenshots,
      today_screenshots: todayScreenshots,
      total_violations: violationLogs,
      active_policy_mode: this.data.policies.default.policy_mode
    };
  }
}

module.exports = new Database();

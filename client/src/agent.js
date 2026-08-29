const WebSocket = require('ws');
const config = require('./config');
const captureEngine = require('./capture_engine');
const liveStreamer = require('./live_streamer');
const appController = require('./app_controller');
const webController = require('./web_controller');
const offlineQueue = require('./offline_queue');
const autoDiscovery = require('./auto_discovery');
const ClientUIServer = require('./ui_server');
const { getActiveWindowInfo } = require('./system_info');

console.log(`=======================================================`);
console.log(`🛡️  WorkGuard Client Agent Initializing...`);
console.log(`💻 Client ID:   ${config.CLIENT_ID}`);
console.log(`🖥️  Host / User: ${config.HOSTNAME} (${config.USERNAME})`);
console.log(`📡 Server URL:  ${config.SERVER_HTTP_URL} (Auto-discovery: ${config.AUTO_DISCOVER ? 'ON' : 'OFF'})`);
console.log(`🖥️  Employee UI: ${config.ENABLE_UI ? 'Enabled' : 'Disabled (Stealth)'}`);
console.log(`=======================================================`);

// Local active policy state
let currentPolicy = {
  allowed_apps: [],
  allowed_domains: [],
  work_hours_start: '00:00',
  work_hours_end: '23:59',
  capture_interval_sec: config.DEFAULT_CAPTURE_INTERVAL_SEC,
  policy_mode: 'audit-alert'
};

let ws = null;
let captureTimer = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let isConnecting = false;
let isEmployeeOnBreak = false;
let lastSysInfo = { processName: 'Idle', windowTitle: 'Desktop', cpuUsage: 0, ramUsage: 0 };

function isWithinWorkHours() {
  if (isEmployeeOnBreak) {
    return false; // Break mode suspends monitoring
  }
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = (currentPolicy.work_hours_start || '00:00').split(':').map(Number);
  const [endH, endM] = (currentPolicy.work_hours_end || '23:59').split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // Crosses midnight
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

function connectToServer() {
  if (isConnecting) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  isConnecting = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log(`[Network] Connecting to server WebSocket: ${config.SERVER_WS_URL}...`);
  try {
    ws = new WebSocket(config.SERVER_WS_URL);
  } catch (e) {
    console.error('[Network] Connection initiation failed:', e.message);
    isConnecting = false;
    scheduleReconnect();
    return;
  }

  liveStreamer.setWebSocket(ws);

  ws.on('open', async () => {
    isConnecting = false;
    console.log('[Network] ✅ Connected to monitoring server.');

    // Fetch initial system state
    const sys = await getActiveWindowInfo();

    // Register with server
    ws.send(JSON.stringify({
      type: 'AGENT_REGISTER',
      client_id: config.CLIENT_ID,
      hostname: config.HOSTNAME,
      username: config.USERNAME,
      employee_name: config.EMPLOYEE_NAME,
      department: config.DEPARTMENT,
      os: config.OS_TYPE,
      current_app: sys.processName,
      current_window: sys.windowTitle,
      cpu_usage: sys.cpuUsage,
      ram_usage: sys.ramUsage
    }));

    // Trigger flush of any offline queued captures
    offlineQueue.flushQueue();
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case 'REGISTER_OK':
        case 'POLICY_UPDATE':
          if (msg.policy) {
            currentPolicy = { ...currentPolicy, ...msg.policy };
            console.log(`[Policy] Updated: Interval=${currentPolicy.capture_interval_sec}s, Mode=${currentPolicy.policy_mode}`);
            resetCaptureTimer();
          }
          break;

        case 'UPDATE_EMPLOYEE_PROFILE':
          if (msg.employee_name || msg.department) {
            config.setProfile(msg.employee_name, msg.department);
            console.log(`[Agent] Profile updated remotely: Name="${config.EMPLOYEE_NAME}", Department="${config.DEPARTMENT}"`);
          }
          break;

        case 'START_STREAMING':
          if (isWithinWorkHours()) {
            liveStreamer.startStreaming({
              fps: msg.fps || 15,
              quality: msg.quality || 70
            });
          }
          break;

        case 'STOP_STREAMING':
          liveStreamer.stopStreaming();
          break;

        case 'CAPTURE_INSTANT_SCREENSHOT':
          await takeSilentScreenshot();
          break;

        default:
          break;
      }
    } catch (e) {
      console.error('[Network] Message parse error:', e.message);
    }
  });

  ws.on('close', () => {
    isConnecting = false;
    console.log('[Network] ⚠️ Connection closed. Reconnecting in 5s...');
    liveStreamer.stopStreaming();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    isConnecting = false;
    console.error('[Network] WS Error:', err.message);
  });
}

function scheduleReconnect(delay = 5000) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectToServer();
  }, delay);
}

// Auto-Discovery Listener
if (config.AUTO_DISCOVER) {
  autoDiscovery.on('discovered', (serverInfo) => {
    console.log(`[Network] 🔄 Auto-Discovery update: Switching to ${serverInfo.httpUrl}`);
    config.setServerEndpoint(serverInfo.host, serverInfo.port);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (ws) {
        try { ws.terminate(); } catch (e) {}
      }
      isConnecting = false;
      connectToServer();
    }
  });

  autoDiscovery.start();
}


/**
 * Captures a silent screenshot and hands it to the offline queue.
 * Operates without popups, flashes, or window disturbance.
 */
async function takeSilentScreenshot() {
  if (!isWithinWorkHours()) {
    return;
  }

  try {
    const sys = await getActiveWindowInfo();
    const imageBuffer = await captureEngine.captureScreen();

    if (imageBuffer) {
      const metadata = {
        client_id: config.CLIENT_ID,
        active_app: sys.processName,
        active_window: sys.windowTitle,
        timestamp: new Date().toISOString()
      };

      // Upload or buffer locally if offline
      await offlineQueue.enqueueAndUpload(imageBuffer, metadata);
    }
  } catch (err) {
    console.error('[Capture] Error during silent capture:', err.message);
  }
}

function resetCaptureTimer() {
  if (captureTimer) clearInterval(captureTimer);
  const intervalMs = Math.max(5, currentPolicy.capture_interval_sec || config.DEFAULT_CAPTURE_INTERVAL_SEC) * 1000;
  
  captureTimer = setInterval(() => {
    takeSilentScreenshot();
  }, intervalMs);
}

// Background evaluation loop: heartbeats & process/website whitelisting
function startMonitoringLoop() {
  heartbeatTimer = setInterval(async () => {
    try {
      const sys = await getActiveWindowInfo();
      lastSysInfo = sys;

      // 1. Send Heartbeat to server if connected
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'AGENT_HEARTBEAT',
          current_app: isEmployeeOnBreak ? '☕ On Break' : sys.processName,
          current_window: isEmployeeOnBreak ? 'Break Mode Active' : sys.windowTitle,
          cpu_usage: sys.cpuUsage,
          ram_usage: sys.ramUsage
        }));
      }

      // 2. Evaluate Application Whitelist
      if (isWithinWorkHours()) {
        appController.evaluateProcess(sys.processName, sys.windowTitle, currentPolicy, (violation) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'AGENT_LOG',
              event_type: violation.event_type,
              details: violation.details
            }));
          }
        });

        // 3. Evaluate Website Whitelist
        webController.evaluateWebActivity(sys.processName, sys.windowTitle, currentPolicy, (violation) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'AGENT_LOG',
              event_type: violation.event_type,
              details: violation.details
            }));
          }
        });
      }
    } catch (e) {
      console.error('[Monitor] Loop error:', e.message);
    }
  }, 3000);
}

function setBreakMode(onBreak) {
  isEmployeeOnBreak = onBreak;
  console.log(`[Agent] Employee Break Mode: ${onBreak ? '☕ ON (Monitoring Suspended)' : '🟢 OFF (Active)'}`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'AGENT_LOG',
      event_type: onBreak ? 'BREAK_STARTED' : 'BREAK_ENDED',
      details: `Employee ${config.USERNAME} ${onBreak ? 'paused work for a break' : 'resumed work'}`
    }));
  }
}

function getProfile() {
  return {
    employee_name: config.EMPLOYEE_NAME,
    department: config.DEPARTMENT,
    is_configured: !!(config.EMPLOYEE_NAME && config.EMPLOYEE_NAME !== config.USERNAME)
  };
}

function saveProfile(name, dept) {
  config.setProfile(name, dept);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'AGENT_PROFILE_UPDATE',
      employee_name: config.EMPLOYEE_NAME,
      department: config.DEPARTMENT
    }));
  }
  return getProfile();
}

function getLiveStatus() {
  return {
    isConnected: ws && ws.readyState === WebSocket.OPEN,
    clientId: config.CLIENT_ID,
    hostname: config.HOSTNAME,
    username: config.USERNAME,
    employeeName: config.EMPLOYEE_NAME,
    department: config.DEPARTMENT,
    serverUrl: config.SERVER_HTTP_URL,
    currentApp: isEmployeeOnBreak ? '☕ On Break' : (lastSysInfo.processName || 'Desktop'),
    currentWindow: isEmployeeOnBreak ? 'Break Mode (Capture Paused)' : (lastSysInfo.windowTitle || 'Idle'),
    pendingBufferCount: offlineQueue.getPendingCount(),
    policy: currentPolicy,
    isOnBreak: isEmployeeOnBreak
  };
}

// Start Client UI Server if enabled
let clientUI = null;
if (config.ENABLE_UI) {
  clientUI = new ClientUIServer({
    getLiveStatus,
    setBreakMode,
    getProfile,
    saveProfile,
    flushOfflineQueue: () => offlineQueue.flushQueue()
  });

  clientUI.start().then(() => {
    // Open UI automatically if requested
    if (process.argv.includes('--open-ui') || process.argv.includes('--ui')) {
      clientUI.openWindow();
    }
  });
}

// Initialize Agent
connectToServer();
resetCaptureTimer();
startMonitoringLoop();

// Initial immediate screenshot
setTimeout(takeSilentScreenshot, 2000);

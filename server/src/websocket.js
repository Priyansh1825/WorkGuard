const WebSocket = require('ws');
const fs = require('fs');
const db = require('./db');
const securityAuth = require('./security_auth');
const alertManager = require('./alert_manager');

class WebSocketServerHandler {
  constructor(server, app) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.app = app;

    // Maps to track active connections
    // client_id -> WebSocket (Agent)
    this.agents = new Map();
    // Set of WebSocket (Admins)
    this.admins = new Set();
    // client_id -> Set of WebSocket (Admins currently viewing this client's live stream)
    this.streamSubscribers = new Map();

    this.init();
  }

  init() {
    this.wss.on('connection', (ws, req) => {
      ws.isAlive = true;
      ws.clientType = null; // 'agent' or 'admin'
      ws.clientId = null;
      ws.isAdminAuthenticated = false;

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message, isBinary) => {
        this.handleMessage(ws, message, isBinary, req);
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (err) => {
        console.error('WS Error:', err.message);
      });
    });

    // Heartbeat ping interval to clean dead connections
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 25000);

    // Attach broadcast helpers to express app for REST API triggers
    this.app.set('broadcastPolicyUpdate', (policy) => {
      this.broadcastPolicy(policy);
    });

    this.app.set('broadcastViolation', (log) => {
      this.broadcastToAdmins({
        type: 'VIOLATION_ALERT',
        log
      });
    });

    this.app.set('updateAgentProfile', (clientId, profile) => {
      const agentWs = this.agents.get(clientId);
      if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify({
          type: 'UPDATE_EMPLOYEE_PROFILE',
          employee_name: profile.employee_name,
          department: profile.department
        }));
      }
      this.broadcastFleetUpdate();
    });

    this.app.set('sendClientMessage', (clientId, { title, message }) => {
      const payload = JSON.stringify({
        type: 'ADMIN_NOTIFICATION',
        title: title || 'Manager Notice',
        message: message || 'Please check your workstation tasks.'
      });

      if (clientId === 'ALL') {
        this.agents.forEach((agentWs) => {
          if (agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(payload);
          }
        });
      } else {
        const agentWs = this.agents.get(clientId);
        if (agentWs && agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(payload);
        }
      }
    });

    this.app.set('requestInstantScreenshot', (clientId) => {
      const agentWs = this.agents.get(clientId);
      if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify({ type: 'CAPTURE_INSTANT_SCREENSHOT' }));
      }
    });

    this.app.set('deployOTAUpdate', ({ target_client_id, version, sha256, release_notes, force }) => {
      let count = 0;
      const payload = JSON.stringify({
        type: 'OTA_UPDATE_COMMAND',
        version,
        sha256,
        release_notes,
        force,
        download_url: '/api/updates/download/latest'
      });

      if (target_client_id === 'all') {
        this.agents.forEach((agentWs) => {
          if (agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(payload);
            count++;
          }
        });
      } else {
        const agentWs = this.agents.get(target_client_id);
        if (agentWs && agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(payload);
          count++;
        }
      }
      return count;
    });
  }

  handleMessage(ws, message, isBinary, req) {
    // 1. Binary Stream Frame from Agent -> forward to viewing Admins
    if (isBinary) {
      if (ws.clientType === 'agent' && ws.clientId) {
        const viewers = this.streamSubscribers.get(ws.clientId);
        if (viewers && viewers.size > 0) {
          viewers.forEach((adminWs) => {
            if (adminWs.readyState === WebSocket.OPEN && adminWs.isAdminAuthenticated) {
              adminWs.send(message, { binary: true });
            }
          });
        }
      }
      return;
    }

    // 2. JSON Control Messages
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        // --- Agent Identification & Heartbeat (Protected by PSK) ---
        case 'AGENT_REGISTER': {
          const expectedSecret = db.getAgentSecretKey();
          const providedToken = data.auth_token || data.token;

          // Validate Agent Pre-Shared Key
          if (!securityAuth.verifyAgentKey(providedToken, expectedSecret)) {
            console.warn(`[Security] 🚫 Rejected unauthenticated agent connection from ${req.socket.remoteAddress} (Invalid or missing auth_token)`);
            ws.send(JSON.stringify({
              type: 'AUTH_FAILED',
              error: 'Invalid or missing agent authentication token'
            }));
            return ws.close(4001, 'Unauthorized');
          }

          ws.clientType = 'agent';
          ws.clientId = data.client_id;
          this.agents.set(data.client_id, ws);

          const ip = req.socket.remoteAddress || '127.0.0.1';
          const clientData = db.upsertClient({
            id: data.client_id,
            hostname: data.hostname,
            username: data.username,
            employee_name: data.employee_name,
            department: data.department,
            ip: ip.replace('::ffff:', ''),
            os: data.os,
            agent_version: data.agent_version || '1.0.0',
            current_app: data.current_app,
            current_window: data.current_window,
            cpu_usage: data.cpu_usage,
            ram_usage: data.ram_usage
          });

          // Send back registration confirmation & active policy
          const activePolicy = db.getPolicy('default');
          const updatesManager = require('./updates_manager');
          const versionInfo = updatesManager.getVersionInfo();
          const isOutdated = updatesManager.compareVersions(clientData.agent_version, versionInfo.version) < 0;
          const autoUpdateEnabled = db.isAutoUpdateEnabled();
          const zipPath = updatesManager.getLatestZipPath();

          ws.send(JSON.stringify({
            type: 'REGISTER_OK',
            client: clientData,
            policy: activePolicy,
            latest_version: versionInfo.version,
            update_available: isOutdated,
            auto_update_enabled: autoUpdateEnabled
          }));

          // Notify admins of updated fleet status
          this.broadcastFleetUpdate();

          // If Auto-Update on Connect is active and client is outdated, auto-dispatch OTA upgrade
          if (autoUpdateEnabled && isOutdated && zipPath && fs.existsSync(zipPath)) {
            console.log(`[AutoUpdate] 🚀 Outdated client connected: ${data.client_id} (v${clientData.agent_version} -> v${versionInfo.version}). Automatically pushing update...`);
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'OTA_UPDATE_COMMAND',
                  version: versionInfo.version,
                  sha256: versionInfo.sha256,
                  release_notes: versionInfo.release_notes,
                  force: true,
                  download_url: '/api/updates/download/latest'
                }));
              }
            }, 1200);
          }
          break;
        }

        case 'OTA_UPDATE_PROGRESS': {
          if (ws.clientId) {
            this.broadcastToAdmins({
              type: 'OTA_UPDATE_PROGRESS',
              client_id: ws.clientId,
              status: data.status,
              percent: data.percent,
              message: data.message,
              version: data.version
            });
            if (data.status === 'updated' && data.version) {
              db.upsertClient({
                id: ws.clientId,
                agent_version: data.version
              });
              this.broadcastFleetUpdate();
            }
          }
          break;
        }

        case 'AGENT_PROFILE_UPDATE': {
          if (ws.clientId) {
            db.updateClientProfile(ws.clientId, {
              employee_name: data.employee_name,
              department: data.department
            });
            this.broadcastFleetUpdate();
          }
          break;
        }

        case 'AGENT_HEARTBEAT': {
          if (ws.clientId) {
            const updatedClient = db.upsertClient({
              id: ws.clientId,
              current_app: data.current_app,
              current_window: data.current_window,
              cpu_usage: data.cpu_usage,
              ram_usage: data.ram_usage
            });
            this.broadcastFleetUpdate();

            // Real-time prohibited application check on heartbeat
            if (data.current_app) {
              alertManager.processWorkstationActivity(updatedClient, data.current_app, data.current_window).catch(() => {});
            }
          }
          break;
        }

        case 'AGENT_LOG': {
          if (ws.clientId) {
            const log = db.addLog(ws.clientId, data.event_type, data.details);
            this.broadcastToAdmins({
              type: 'NEW_LOG',
              log
            });
          }
          break;
        }

        // --- Admin Dashboard Identification & Control (Protected by Session Tokens) ---
        case 'ADMIN_REGISTER': {
          ws.clientType = 'admin';
          const isPassSet = db.isPasswordSet();
          
          if (!isPassSet) {
            // First time setup: allow connection to set initial password
            ws.isAdminAuthenticated = true;
          } else {
            // Check session token
            const sessionSecret = db.getSessionSecret();
            const session = securityAuth.verifySessionToken(data.session_token, sessionSecret);
            if (session) {
              ws.isAdminAuthenticated = true;
            } else {
              ws.isAdminAuthenticated = false;
              ws.send(JSON.stringify({
                type: 'ADMIN_AUTH_REQUIRED',
                message: 'Admin session required'
              }));
              return;
            }
          }

          this.admins.add(ws);
          ws.send(JSON.stringify({
            type: 'ADMIN_CONNECTED',
            authenticated: true,
            stats: db.getStats(),
            clients: db.getClients(),
            security: db.getSecurityConfig()
          }));
          break;
        }

        case 'START_VIEW_STREAM': {
          if (!ws.isAdminAuthenticated) {
            return ws.send(JSON.stringify({ type: 'UNAUTHORIZED' }));
          }

          const targetClientId = data.target_client_id;
          if (!targetClientId) return;

          if (!this.streamSubscribers.has(targetClientId)) {
            this.streamSubscribers.set(targetClientId, new Set());
          }
          this.streamSubscribers.get(targetClientId).add(ws);

          // Tell the agent to start capturing & streaming
          const agentWs = this.agents.get(targetClientId);
          if (agentWs && agentWs.readyState === WebSocket.OPEN) {
            const policy = db.getPolicy('default');
            agentWs.send(JSON.stringify({
              type: 'START_STREAMING',
              fps: data.fps || policy.stream_fps || 15,
              quality: data.quality || 65
            }));
          }
          break;
        }

        case 'STOP_VIEW_STREAM': {
          const targetClientId = data.target_client_id;
          if (targetClientId && this.streamSubscribers.has(targetClientId)) {
            const viewers = this.streamSubscribers.get(targetClientId);
            viewers.delete(ws);

            if (viewers.size === 0) {
              const agentWs = this.agents.get(targetClientId);
              if (agentWs && agentWs.readyState === WebSocket.OPEN) {
                agentWs.send(JSON.stringify({ type: 'STOP_STREAMING' }));
              }
            }
          }
          break;
        }

        case 'REQUEST_INSTANT_SCREENSHOT': {
          if (!ws.isAdminAuthenticated) return;
          const targetClientId = data.target_client_id;
          const agentWs = this.agents.get(targetClientId);
          if (agentWs && agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(JSON.stringify({ type: 'CAPTURE_INSTANT_SCREENSHOT' }));
          }
          break;
        }

        case 'SEND_CLIENT_MESSAGE': {
          if (!ws.isAdminAuthenticated) return;
          const targetClientId = data.target_client_id;
          const payload = JSON.stringify({
            type: 'ADMIN_NOTIFICATION',
            title: securityAuth.sanitizeText(data.title) || 'Manager Notice',
            message: securityAuth.sanitizeText(data.message) || 'Please check your workstation tasks.'
          });

          if (targetClientId === 'ALL') {
            this.agents.forEach((agentWs) => {
              if (agentWs.readyState === WebSocket.OPEN) {
                agentWs.send(payload);
              }
            });
          } else {
            const agentWs = this.agents.get(targetClientId);
            if (agentWs && agentWs.readyState === WebSocket.OPEN) {
              agentWs.send(payload);
            }
          }
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e.message);
    }
  }

  handleDisconnect(ws) {
    if (ws.clientType === 'agent' && ws.clientId) {
      this.agents.delete(ws.clientId);
      db.setClientStatus(ws.clientId, 'offline');
      this.broadcastFleetUpdate();

      const viewers = this.streamSubscribers.get(ws.clientId);
      if (viewers) {
        viewers.forEach((adminWs) => {
          if (adminWs.readyState === WebSocket.OPEN) {
            adminWs.send(JSON.stringify({
              type: 'STREAM_ENDED',
              client_id: ws.clientId,
              reason: 'Agent disconnected'
            }));
          }
        });
        this.streamSubscribers.delete(ws.clientId);
      }
    } else if (ws.clientType === 'admin') {
      this.admins.delete(ws);
      this.streamSubscribers.forEach((viewers, clientId) => {
        if (viewers.has(ws)) {
          viewers.delete(ws);
          if (viewers.size === 0) {
            const agentWs = this.agents.get(clientId);
            if (agentWs && agentWs.readyState === WebSocket.OPEN) {
              agentWs.send(JSON.stringify({ type: 'STOP_STREAMING' }));
            }
          }
        }
      });
    }
  }

  broadcastPolicy(policy) {
    const payload = JSON.stringify({
      type: 'POLICY_UPDATE',
      policy
    });
    this.agents.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
    this.broadcastToAdmins({
      type: 'POLICY_SAVED',
      policy
    });
  }

  broadcastFleetUpdate() {
    this.broadcastToAdmins({
      type: 'FLEET_UPDATE',
      clients: db.getClients(),
      stats: db.getStats()
    });
  }

  broadcastToAdmins(payload) {
    const msg = JSON.stringify(payload);
    this.admins.forEach((adminWs) => {
      if (adminWs.readyState === WebSocket.OPEN && adminWs.isAdminAuthenticated) {
        adminWs.send(msg);
      }
    });
  }
}

module.exports = WebSocketServerHandler;

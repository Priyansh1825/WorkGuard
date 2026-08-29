const WebSocket = require('ws');
const db = require('./db');

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
  }

  handleMessage(ws, message, isBinary, req) {
    // 1. Binary Stream Frame from Agent -> forward to viewing Admins
    if (isBinary) {
      if (ws.clientType === 'agent' && ws.clientId) {
        const viewers = this.streamSubscribers.get(ws.clientId);
        if (viewers && viewers.size > 0) {
          viewers.forEach((adminWs) => {
            if (adminWs.readyState === WebSocket.OPEN) {
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
        // --- Agent Identification & Heartbeat ---
        case 'AGENT_REGISTER': {
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
            current_app: data.current_app,
            current_window: data.current_window,
            cpu_usage: data.cpu_usage,
            ram_usage: data.ram_usage
          });

          // Send back registration confirmation & active policy
          const activePolicy = db.getPolicy('default');
          ws.send(JSON.stringify({
            type: 'REGISTER_OK',
            client: clientData,
            policy: activePolicy
          }));

          // Notify admins of updated fleet status
          this.broadcastFleetUpdate();
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
            db.upsertClient({
              id: ws.clientId,
              current_app: data.current_app,
              current_window: data.current_window,
              cpu_usage: data.cpu_usage,
              ram_usage: data.ram_usage
            });
            this.broadcastFleetUpdate();
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

        // --- Admin Dashboard Identification & Control ---
        case 'ADMIN_REGISTER': {
          ws.clientType = 'admin';
          this.admins.add(ws);
          ws.send(JSON.stringify({
            type: 'ADMIN_CONNECTED',
            stats: db.getStats(),
            clients: db.getClients()
          }));
          break;
        }

        case 'START_VIEW_STREAM': {
          // Admin requests live screen stream for a specific client
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

            // If no more admins are watching this client, signal agent to stop capture
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
          const targetClientId = data.target_client_id;
          const agentWs = this.agents.get(targetClientId);
          if (agentWs && agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(JSON.stringify({ type: 'CAPTURE_INSTANT_SCREENSHOT' }));
          }
          break;
        }

        case 'SEND_CLIENT_MESSAGE': {
          const targetClientId = data.target_client_id;
          const payload = JSON.stringify({
            type: 'ADMIN_NOTIFICATION',
            title: data.title || 'Manager Notice',
            message: data.message || 'Please check your workstation tasks.'
          });

          if (targetClientId === 'ALL') {
            // Broadcast to all connected agents
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

      // Notify any viewers that agent went offline
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
      // Remove admin from all stream subscriber lists
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
    // Send to all connected agents
    this.agents.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
    // Send to all admins
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
      if (adminWs.readyState === WebSocket.OPEN) {
        adminWs.send(msg);
      }
    });
  }
}

module.exports = WebSocketServerHandler;

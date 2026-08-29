const os = require('os');
const path = require('path');
const fs = require('fs');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const DATA_DIR = path.join(__dirname, '..', 'storage_buffer');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default config
let serverHost = '127.0.0.1';
let serverPort = 3000;
let autoDiscover = true;
let enableUi = true;

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const userCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (userCfg.server_host) serverHost = userCfg.server_host;
    if (userCfg.server_port) serverPort = userCfg.server_port;
    if (typeof userCfg.auto_discover === 'boolean') autoDiscover = userCfg.auto_discover;
    if (typeof userCfg.enable_ui === 'boolean') enableUi = userCfg.enable_ui;
  } catch (e) {}
} else {
  // Create default config.json for user convenience
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    auto_discover: true,
    server_host: "127.0.0.1",
    server_port: 3000,
    enable_ui: true
  }, null, 2), 'utf8');
}

// Override with env variables if provided
if (process.env.SERVER_HOST) serverHost = process.env.SERVER_HOST;
if (process.env.SERVER_PORT) serverPort = parseInt(process.env.SERVER_PORT, 10);
if (process.env.AUTO_DISCOVER) autoDiscover = process.env.AUTO_DISCOVER === 'true';
if (process.env.ENABLE_UI) enableUi = process.env.ENABLE_UI === 'true';

// Generate persistent unique Client ID
const ID_FILE = path.join(DATA_DIR, 'client_id.txt');
let clientId = '';

try {
  if (fs.existsSync(ID_FILE)) {
    clientId = fs.readFileSync(ID_FILE, 'utf8').trim();
  }
} catch (e) {}

if (!clientId) {
  clientId = 'client-' + Math.random().toString(36).substring(2, 9);
  try {
    fs.writeFileSync(ID_FILE, clientId, 'utf8');
  } catch (e) {}
}

const config = {
  CLIENT_ID: clientId,
  HOSTNAME: os.hostname(),
  USERNAME: os.userInfo ? os.userInfo().username : 'Employee',
  OS_TYPE: os.type() + ' ' + os.release(),
  AUTO_DISCOVER: autoDiscover,
  ENABLE_UI: enableUi,
  SERVER_HOST: serverHost,
  SERVER_PORT: serverPort,
  get SERVER_HTTP_URL() {
    return `http://${this.SERVER_HOST}:${this.SERVER_PORT}`;
  },
  get SERVER_WS_URL() {
    return `ws://${this.SERVER_HOST}:${this.SERVER_PORT}/ws`;
  },
  setServerEndpoint(host, port) {
    this.SERVER_HOST = host;
    if (port) this.SERVER_PORT = port;
  },
  BUFFER_DIR: DATA_DIR,
  DEFAULT_CAPTURE_INTERVAL_SEC: 600,
  MAX_OFFLINE_BUFFER_COUNT: 200
};

module.exports = config;

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const { startServer, stopServer, PORT, STORAGE_DIR } = require('../server/src/index.js');

// Hardware GPU Acceleration switches for ultra-smooth 60FPS Live Streaming Canvas
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let serverInstance = null;

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const k2 in interfaces[k]) {
      const address = interfaces[k][k2];
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push(address.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

async function createWindow() {
  const iconPath = path.join(__dirname, '..', 'server', 'public', 'icon-192.png');
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 890,
    minWidth: 1080,
    minHeight: 720,
    title: 'WorkGuard Admin - Employee Monitoring & Fleet Station',
    icon: appIcon,
    backgroundColor: '#0b0f19',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  // Remove default menu bar for modern clean look
  mainWindow.setMenuBarVisibility(false);

  // Auto-retry if server is still spinning up
  mainWindow.webContents.on('did-fail-load', (event, errorCode) => {
    if (errorCode === -102 || errorCode === -105 || errorCode === -106) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(`http://localhost:${PORT}`);
        }
      }, 800);
    }
  });

  // Load Admin Dashboard
  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Fallback show in case ready-to-show takes too long
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 2500);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: 'WorkGuard Admin Running in Background',
          body: 'The monitoring server and live fleet relay remain active in your system tray.',
          icon: appIcon
        }).show();
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'server', 'public', 'icon-192.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip('WorkGuard Admin Station (Server Active)');

  const localIPs = getLocalIPs();
  const primaryIP = localIPs[0] || '127.0.0.1';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `🟢 Server Active (Port ${PORT})`,
      enabled: false
    },
    {
      label: `📡 LAN IP: ${primaryIP}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: '📊 Open Admin Dashboard',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '📁 Open Screenshots Storage',
      click: () => {
        const screenshotsPath = path.join(__dirname, '..', 'server', 'storage', 'screenshots');
        shell.openPath(screenshotsPath);
      }
    },
    { type: 'separator' },
    {
      label: '🔄 Minimize to Tray',
      click: () => {
        if (mainWindow) mainWindow.hide();
      }
    },
    {
      label: '❌ Exit WorkGuard Admin',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// IPC Handlers
ipcMain.on('app:notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    const iconPath = path.join(__dirname, '..', 'server', 'public', 'icon-192.png');
    new Notification({
      title: title || 'WorkGuard Alert',
      body: body || '',
      icon: nativeImage.createFromPath(iconPath)
    }).show();
  }
});

ipcMain.on('app:minimize-tray', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('app:open-storage-folder', () => {
  const screenshotsPath = path.join(__dirname, '..', 'server', 'storage', 'screenshots');
  shell.openPath(screenshotsPath);
});

ipcMain.on('app:toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.handle('app:get-server-info', () => {
  return {
    port: PORT,
    ips: getLocalIPs(),
    status: 'online',
    isElectron: true
  };
});

app.whenReady().then(async () => {
  console.log('[WorkGuard Admin Desktop] Booting embedded monitoring backend...');
  try {
    serverInstance = await startServer(PORT);
  } catch (err) {
    console.error('[WorkGuard Admin Desktop] Server startup warning:', err.message);
  }

  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', async () => {
  isQuitting = true;
  console.log('[WorkGuard Admin Desktop] Shutting down embedded server...');
  try {
    await stopServer();
  } catch (e) {}
});

app.on('window-all-closed', () => {
  // Keep app active in system tray on Windows/macOS unless quit explicitly
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

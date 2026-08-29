const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  sendNotification: (title, body) => {
    ipcRenderer.send('app:notification', { title, body });
  },
  minimizeToTray: () => {
    ipcRenderer.send('app:minimize-tray');
  },
  openStorageFolder: () => {
    ipcRenderer.send('app:open-storage-folder');
  },
  toggleFullscreen: () => {
    ipcRenderer.send('app:toggle-fullscreen');
  },
  getServerInfo: () => {
    return ipcRenderer.invoke('app:get-server-info');
  }
});

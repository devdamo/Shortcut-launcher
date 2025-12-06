const { contextBridge, ipcRenderer } = require('electron');

console.log('🔧 Preload script starting...');

try {
  // Expose protected methods that allow the renderer process to use
  // the ipcRenderer without exposing the entire object
  contextBridge.exposeInMainWorld('electronAPI', {
    // FIXED: Window controls - More reliable close methods
    closeApp: () => {
      console.log('📤 IPC: closeApp called from renderer');
      // Use both methods for maximum reliability
      ipcRenderer.send('close-app');
      return ipcRenderer.invoke('close-app');
    },
    
    // Emergency close for Ctrl+Q
    forceClose: () => {
      console.log('📤 IPC: forceClose called from renderer');
      ipcRenderer.send('force-close');
    },
    
    // PC info
    getPCInfo: () => ipcRenderer.invoke('get-pc-info'),
    
    // File operations
    checkSoftwareExists: (path) => ipcRenderer.invoke('check-software-exists', path),
    browseFile: () => ipcRenderer.invoke('browse-file'),

    // NEW: Background image browsing
    browseBackgroundImage: () => ipcRenderer.invoke('browse-background-image'),

    // NEW: Icon image browsing
    browseIconImage: () => ipcRenderer.invoke('browse-icon-image'),

    // Shortcut operations
    openShortcut: (path, isUrl) => ipcRenderer.invoke('open-shortcut', path, isUrl),
    
    // Icon extraction (now returns file path, not base64)
    extractWebsiteIcon: (url, shortcutName) => ipcRenderer.invoke('extract-website-icon', url, shortcutName),
    extractAppIcon: (path, shortcutName) => ipcRenderer.invoke('extract-app-icon', path, shortcutName),

    // Load icon from file path
    loadIcon: (iconPath) => ipcRenderer.invoke('load-icon', iconPath),
    
    // NEW: RustDesk installation
    installRustDesk: () => ipcRenderer.invoke('install-rustdesk'),

    // NEW: Remotely installation
    installRemotely: () => ipcRenderer.invoke('install-remotely'),
    
    // NEW: Window mode control
    setDesktopMode: (enabled) => ipcRenderer.invoke('set-desktop-mode', enabled),

    // NEW: Taskbar - get open windows
    getOpenWindows: () => ipcRenderer.invoke('get-open-windows'),

    // NEW: Taskbar - focus/switch to window
    focusWindow: (processId) => ipcRenderer.invoke('focus-window', processId),

    // NEW: Get icon from process executable
    getProcessIcon: (exePath) => ipcRenderer.invoke('get-process-icon', exePath),

    // NEW: Auto-update functionality
    downloadUpdate: (url, fileName) => ipcRenderer.invoke('download-update', url, fileName),
    installUpdate: (filePath) => ipcRenderer.invoke('install-update', filePath),

    // Auto-launch on boot
    getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
    setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),

    // Server connection
    serverConnect: (url) => ipcRenderer.invoke('server-connect', url),
    serverDisconnect: () => ipcRenderer.invoke('server-disconnect'),
    serverStatus: () => ipcRenderer.invoke('server-status'),
    serverTest: (url) => ipcRenderer.invoke('server-test', url),

    // Server event listeners
    onServerAddShortcut: (callback) => ipcRenderer.on('server-add-shortcut', (event, data) => callback(data)),
    onServerRemoveShortcut: (callback) => ipcRenderer.on('server-remove-shortcut', (event, id) => callback(id)),
    onServerSyncSettings: (callback) => ipcRenderer.on('server-sync-settings', () => callback()),
    onServerCustomCommand: (callback) => ipcRenderer.on('server-custom-command', (event, data) => callback(data)),

    // Screen share event listeners
    onScreenShareSession: (callback) => ipcRenderer.on('screenshare-session', callback),
    onScreenShareOffer: (callback) => ipcRenderer.on('screenshare-offer', callback),
    onScreenShareIce: (callback) => ipcRenderer.on('screenshare-ice', callback),

    // Screen share actions (send data back to server)
    sendScreenShareAnswer: (data) => ipcRenderer.invoke('screenshare-answer', data)
  });
  
  console.log('✅ electronAPI exposed successfully');
  
  // Database API - expose database manager globally
  contextBridge.exposeInMainWorld('dbAPI', {
    connect: () => {
      console.log('📤 IPC: db-connect called');
      return ipcRenderer.invoke('db-connect');
    },
    getShortcuts: () => ipcRenderer.invoke('db-get-shortcuts'),
    addShortcut: (name, path, type, iconData) => ipcRenderer.invoke('db-add-shortcut', name, path, type, iconData),
    updateShortcut: (id, name, path, type, iconPath) => ipcRenderer.invoke('db-update-shortcut', id, name, path, type, iconPath),
    deleteShortcut: (id) => ipcRenderer.invoke('db-delete-shortcut', id),
    updateShortcutExistence: (id, exists) => ipcRenderer.invoke('db-update-shortcut-existence', id, exists),

    // NEW: Shortcut sizing
    updateShortcutSize: (id, width, height) => ipcRenderer.invoke('db-update-shortcut-size', id, width, height),
    
    // NEW: Settings for background
    getSetting: (key) => ipcRenderer.invoke('db-get-setting', key),
    setSetting: (key, value) => ipcRenderer.invoke('db-set-setting', key, value),
    
    getPCInfo: () => ipcRenderer.invoke('db-get-pc-info'),
    getAllPCs: () => ipcRenderer.invoke('db-get-all-pcs'),
    getConnectionStatus: () => ipcRenderer.invoke('db-get-connection-status')
  });
  
  console.log('✅ dbAPI exposed successfully');
  
  // Utility API for debugging and diagnostics
  contextBridge.exposeInMainWorld('utilAPI', {
    log: (message) => console.log('🖥️ Renderer:', message),
    error: (message) => console.error('❌ Renderer:', message),
    warn: (message) => console.warn('⚠️ Renderer:', message)
  });
  
  console.log('✅ utilAPI exposed successfully');
  console.log('🎉 Preload script loaded successfully');
  
} catch (error) {
  console.error('❌ Error in preload script:', error);
}

// Additional security: Remove any potential security risks
delete window.require;
delete window.exports;
delete window.module;

console.log('🔒 Security cleanup completed');

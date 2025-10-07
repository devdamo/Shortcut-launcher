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
    
    // Shortcut operations
    openShortcut: (path, isUrl) => ipcRenderer.invoke('open-shortcut', path, isUrl),
    
    // Icon extraction
    extractWebsiteIcon: (url) => ipcRenderer.invoke('extract-website-icon', url),
    extractAppIcon: (path) => ipcRenderer.invoke('extract-app-icon', path),
    
    // NEW: RustDesk installation
    installRustDesk: () => ipcRenderer.invoke('install-rustdesk'),
    
    // NEW: Window mode control
    setDesktopMode: (enabled) => ipcRenderer.invoke('set-desktop-mode', enabled)
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

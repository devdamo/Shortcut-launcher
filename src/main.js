const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, net, screen } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { io } = require('socket.io-client');

// Pure Electron wallpaper mode (no native dependencies required!)
console.log('🎮 Pure Electron wallpaper mode loaded - no compilation needed!');

let mainWindow;
let screenShareWindow = null; // Screen share viewer window
let sharpAvailable = false;
let shouldClose = false;
let dbConnection = null;
let pcInfo = null;
let isDbConnected = false;
let isWallpaperMode = false;
let iconsDir = null; // Directory for storing icons locally
let processIconCache = new Map(); // Cache for process icons

// Server connection variables (Socket.IO based)
let serverUrl = null;
let clientId = null;
let socket = null;
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Screen share session info
let currentScreenShareSession = null;

// Pure Electron wallpaper mode functions (no native compilation required!)
function enableWallpaperMode() {
  if (!mainWindow) {
    console.log('⚠️ Main window not available');
    return false;
  }

  try {
    // FIXED: Exit fullscreen mode first before enabling wallpaper mode
    mainWindow.setFullScreen(false);

    // Use Electron's built-in methods for wallpaper-like behavior
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setSkipTaskbar(true);

    // Move to background and make it behave like wallpaper
    mainWindow.blur();

    // Set window level to desktop/background
    if (process.platform === 'darwin') {
      // macOS: Set to desktop level
      mainWindow.setLevel('desktop');
    } else {
      // Windows/Linux: Use minimize/restore trick to send to back
      const originalBounds = mainWindow.getBounds();
      mainWindow.minimize();

      setTimeout(() => {
        mainWindow.restore();
        mainWindow.setBounds(originalBounds);
        mainWindow.blur();

        // Continuously keep window in background
        const keepInBackground = () => {
          if (isWallpaperMode && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.blur();
            setTimeout(keepInBackground, 2000); // Check every 2 seconds
          }
        };
        keepInBackground();

      }, 200);
    }

    console.log('✅ Wallpaper mode enabled - fullscreen disabled, window in background');
    isWallpaperMode = true;
    return true;

  } catch (error) {
    console.error('❌ Error enabling wallpaper mode:', error);
    return false;
  }
}

function disableWallpaperMode() {
  if (!mainWindow) {
    return false;
  }

  try {
    // FIXED: Restore to fullscreen mode (hides taskbar, allows apps on top)
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.focus();

    console.log('✅ Wallpaper mode disabled - window restored to FULLSCREEN MODE');
    isWallpaperMode = false;
    return true;
    
  } catch (error) {
    console.error('❌ Error disabling wallpaper mode:', error);
    return false;
  }
}

// Check if sharp is available
try {
  const sharp = require('sharp');
  sharpAvailable = true;
  console.log('Sharp is available for image processing');
} catch (error) {
  console.log('Sharp not available, using fallback image processing');
}

// Initialize icons directory
async function initializeIconsDirectory() {
  try {
    // Use app's userData directory for persistent storage
    const userDataPath = app.getPath('userData');
    iconsDir = path.join(userDataPath, 'icons');

    // Create icons directory if it doesn't exist
    await fs.ensureDir(iconsDir);
    console.log(`✅ Icons directory initialized: ${iconsDir}`);

    return iconsDir;
  } catch (error) {
    console.error('❌ Error initializing icons directory:', error);
    return null;
  }
}

// Save icon locally and return the file path
async function saveIconLocally(iconBuffer, shortcutName) {
  try {
    if (!iconsDir) {
      await initializeIconsDirectory();
    }

    // Generate unique filename using hash + name
    const hash = crypto.createHash('md5').update(iconBuffer).digest('hex').substring(0, 8);
    const sanitizedName = shortcutName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const filename = `${sanitizedName}_${hash}.png`;
    const filePath = path.join(iconsDir, filename);

    // Save the icon as PNG
    await fs.writeFile(filePath, iconBuffer);
    console.log(`✅ Icon saved locally: ${filename}`);

    return filePath;
  } catch (error) {
    console.error('❌ Error saving icon locally:', error);
    return null;
  }
}

// Load icon from local path
async function loadIconLocally(iconPath) {
  try {
    if (!iconPath || !await fs.pathExists(iconPath)) {
      console.warn('⚠️ Icon file not found:', iconPath);
      return null;
    }

    const buffer = await fs.readFile(iconPath);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error('❌ Error loading icon locally:', error);
    return null;
  }
}

// Delete old icon file
async function deleteIconFile(iconPath) {
  try {
    if (iconPath && await fs.pathExists(iconPath)) {
      await fs.unlink(iconPath);
      console.log(`✅ Deleted old icon: ${iconPath}`);
    }
  } catch (error) {
    console.error('❌ Error deleting icon file:', error);
  }
}

function createWindow() {
  // Create the browser window - let fullscreen handle the sizing
  mainWindow = new BrowserWindow({
    frame: false,
    fullscreen: true,               // True fullscreen mode (hides taskbar)
    kiosk: false,                   // Not kiosk mode (allows other apps on top)
    webPreferences: {
      nodeIntegration: false,        // SECURE: Disable node integration
      contextIsolation: true,        // SECURE: Enable context isolation
      preload: path.join(__dirname, '..', 'preload.js'), // Use preload script
      enableRemoteModule: false,     // SECURE: Disable remote module
      sandbox: false,                // Allow access to Node APIs in preload
      devTools: process.env.NODE_ENV === 'development' // DISABLE DevTools in production
    },
    backgroundColor: '#000000',
    show: false,
    resizable: false,               // Prevent resizing
    minimizable: false,             // Disable minimize
    maximizable: false,             // Disable maximize
    closable: true,                 // Allow closing (but only via admin)
    alwaysOnTop: false,             // FIXED: Allow other apps to appear on top
    skipTaskbar: true,              // Hide from Windows taskbar
    autoHideMenuBar: true,          // Hide menu bar
    hasShadow: false                // Remove window shadow
  });

  // Load the HTML file
  mainWindow.loadFile('renderer/index.html');

  // Block keyboard shortcuts that could exit fullscreen mode or open DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // FIXED: Block F11 from toggling fullscreen
    if (input.key === 'F11') {
      event.preventDefault();
      console.log('🚫 F11 blocked - fullscreen toggle disabled');
      return;
    }

    // Block DevTools shortcuts in production
    if (process.env.NODE_ENV !== 'development') {
      if (
        input.key === 'F12' ||
        (input.control && input.shift && input.key === 'I') ||
        (input.control && input.shift && input.key === 'J') ||
        (input.control && input.key === 'U')
      ) {
        event.preventDefault();
        console.log('🚫 DevTools access blocked in production mode');
      }
    }
  });

  // Open DevTools ONLY in development
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
    console.log('🔧 DevTools opened in development mode');
  } else {
    console.log('🔒 DevTools disabled in production mode');
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    // Force fullscreen before showing
    mainWindow.setFullScreen(true);
    mainWindow.show();

    console.log('✅ Window shown in FULLSCREEN MODE');

    // Reinforce fullscreen multiple times to ensure it sticks
    const reinforceFullscreen = () => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(true);
        console.log('✅ Fullscreen mode reinforced');
      }
    };

    setTimeout(reinforceFullscreen, 100);
    setTimeout(reinforceFullscreen, 500);
    setTimeout(reinforceFullscreen, 1000);
  });

  // FIXED: Simplified close handling - only prevent accidental closes, not button closes
  mainWindow.on('close', (event) => {
    console.log(`🔴 Window close event triggered. shouldClose: ${shouldClose}`);
    // Don't prevent close if it was initiated by our close button
    if (!shouldClose) {
      console.log('❌ Close prevented - use close button or Ctrl+Q to exit');
      event.preventDefault();
      return false;
    }
    console.log('✅ Window closing allowed');
  });

  // Handle when window is closed
  mainWindow.on('closed', () => {
    console.log('🔴 Window closed');
    mainWindow = null;
  });

  // Auto-connect to database when app is ready
  setTimeout(() => {
    connectToDatabase();
  }, 1000);
}

// Auto-start on boot configuration
function setupAutoLaunch() {
  // Enable auto-start on boot by default
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: false, // Show window on startup
    path: process.execPath,
    args: []
  });
  console.log('✅ Auto-start on boot enabled');
}

// Get auto-launch status
function getAutoLaunchStatus() {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
}

// Set auto-launch status
function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false,
    path: process.execPath,
    args: []
  });
  console.log(`✅ Auto-start on boot ${enabled ? 'enabled' : 'disabled'}`);
  return enabled;
}

// IPC handlers for auto-launch
ipcMain.handle('get-auto-launch', async () => {
  return getAutoLaunchStatus();
});

ipcMain.handle('set-auto-launch', async (event, enabled) => {
  return setAutoLaunch(enabled);
});

// App event handlers
app.whenReady().then(async () => {
  // Initialize icons directory first
  await initializeIconsDirectory();

  // Setup auto-launch on boot
  setupAutoLaunch();

  createWindow();
});

app.on('window-all-closed', () => {
  console.log('🔴 All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  console.log('🔴 App before-quit event');
  shouldClose = true;
});

// Database helper functions
function sanitizeTableName(hostname) {
  return hostname.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

async function connectToDatabase() {
  console.log('🔌 Attempting to connect to database...');
  try {
    // Add timeout to prevent hanging
    const connectionPromise = mysql.createConnection({
      host: '82.68.47.66',
      port: 6644,
      user: 'damodb',
      password: '123DAMIAn123',
      database: 'damodb',
      connectTimeout: 10000,  // 10 second timeout
      acquireTimeout: 10000,
      timeout: 10000,
      ssl: false
    });
    
    // Race against timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database connection timeout after 10 seconds')), 10000)
    );
    
    console.log('🔌 Creating MySQL connection...');
    dbConnection = await Promise.race([connectionPromise, timeoutPromise]);

    console.log('🔌 Testing connection...');
    await dbConnection.ping();
    
    isDbConnected = true;
    console.log('✅ Database connected successfully');
    
    // Get PC info and ensure tables exist
    console.log('🔌 Initializing PC tables...');
    await initializePCTables();
    
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    isDbConnected = false;
    dbConnection = null;
    return false;
  }
}

async function initializePCTables() {
  try {
    // Get PC information
    pcInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      username: os.userInfo().username
    };
    
    // Create main PCs table if it doesn't exist
    await dbConnection.execute(`
      CREATE TABLE IF NOT EXISTS pcs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        hostname VARCHAR(255) UNIQUE NOT NULL,
        platform VARCHAR(50),
        arch VARCHAR(50),
        username VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Insert or update current PC
    await dbConnection.execute(`
      INSERT INTO pcs (hostname, platform, arch, username) 
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        platform = VALUES(platform),
        arch = VALUES(arch),
        username = VALUES(username),
        last_seen = CURRENT_TIMESTAMP
    `, [pcInfo.hostname, pcInfo.platform, pcInfo.arch, pcInfo.username]);

    // Create shortcuts table for this PC
    const shortcutsTableName = `shortcuts_${sanitizeTableName(pcInfo.hostname)}`;
    await dbConnection.execute(`
      CREATE TABLE IF NOT EXISTS ${shortcutsTableName} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        path TEXT NOT NULL,
        type ENUM('software', 'website') NOT NULL,
        icon_path TEXT,
        exists_on_pc BOOLEAN DEFAULT TRUE,
        position_x INT DEFAULT 0,
        position_y INT DEFAULT 0,
        width INT DEFAULT 250,
        height INT DEFAULT 700,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // MIGRATION: Add icon_path column if it doesn't exist (for existing databases)
    try {
      // Check if icon_path column exists
      const [columns] = await dbConnection.execute(`
        SHOW COLUMNS FROM ${shortcutsTableName} LIKE 'icon_path'
      `);

      if (columns.length === 0) {
        console.log('');
        console.log('═══════════════════════════════════════════════');
        console.log('📦 DATABASE MIGRATION REQUIRED');
        console.log('═══════════════════════════════════════════════');
        console.log('Adding icon_path column to shortcuts table...');

        // Add icon_path column
        await dbConnection.execute(`
          ALTER TABLE ${shortcutsTableName}
          ADD COLUMN icon_path TEXT AFTER type
        `);

        console.log('✅ Migration complete: icon_path column added');
        console.log('✅ High-resolution icons are now supported!');
        console.log('');
        console.log('📝 Note: Existing shortcuts will use emoji icons.');
        console.log('📝 Edit shortcuts and extract icons to get high-res versions.');
        console.log('═══════════════════════════════════════════════');
        console.log('');
      } else {
        console.log('✅ Database schema up to date (icon_path column exists)');
      }
    } catch (migrationError) {
      console.error('⚠️ Migration warning:', migrationError.message);
      // Continue anyway - table might be fine
    }

    // Create settings table for this PC - NEW for background settings
    const settingsTableName = `settings_${sanitizeTableName(pcInfo.hostname)}`;
    await dbConnection.execute(`
      CREATE TABLE IF NOT EXISTS ${settingsTableName} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(255) UNIQUE NOT NULL,
        setting_value LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    console.log(`✅ Initialized tables for PC: ${pcInfo.hostname}`);

    // Load server settings and auto-connect
    setTimeout(() => {
      loadServerSettings();
    }, 500);

    return true;
  } catch (error) {
    console.error('❌ Error initializing PC tables:', error);
    return false;
  }
}

// Helper function to fetch data using Electron's net module
async function fetchData(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: options.method || 'GET',
      url: url,
      timeout: options.timeout || 5000
    });

    if (options.headers) {
      Object.keys(options.headers).forEach(key => {
        request.setHeader(key, options.headers[key]);
      });
    }

    let responseData = Buffer.alloc(0);

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.on('data', (chunk) => {
        responseData = Buffer.concat([responseData, chunk]);
      });

      response.on('end', () => {
        resolve(responseData);
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}

// Helper function to download large files
async function downloadFile(url, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: url,
      timeout: options.timeout || 30000 // 30 second timeout for large files
    });

    if (options.headers) {
      Object.keys(options.headers).forEach(key => {
        request.setHeader(key, options.headers[key]);
      });
    }

    const writeStream = require('fs').createWriteStream(outputPath);
    let downloadedBytes = 0;
    let totalBytes = 0;

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        writeStream.destroy();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      totalBytes = parseInt(response.headers['content-length']) || 0;
      console.log(`Downloading ${url} (${Math.round(totalBytes / 1024 / 1024)}MB)...`);

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        writeStream.write(chunk);
        
        if (totalBytes > 0) {
          const progress = Math.round((downloadedBytes / totalBytes) * 100);
          if (progress % 10 === 0) {
            console.log(`Download progress: ${progress}%`);
          }
        }
      });

      response.on('end', () => {
        writeStream.end();
        console.log('Download completed successfully');
        resolve(outputPath);
      });
    });

    request.on('error', (error) => {
      writeStream.destroy();
      reject(error);
    });

    writeStream.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}

// ============================================================
// SERVER CONNECTION FUNCTIONS (Socket.IO)
// ============================================================

// Get current shortcuts from database for heartbeat
async function getCurrentShortcuts() {
  try {
    if (!dbConnection || !pcInfo) return [];
    const tableName = `shortcuts_${pcInfo.hostname.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const [rows] = await dbConnection.execute(`SELECT id, name, path, type FROM \`${tableName}\``);
    return rows;
  } catch (error) {
    console.error('❌ Error getting shortcuts for heartbeat:', error);
    return [];
  }
}

// Execute a command from the server
async function executeCommand(command) {
  console.log(`⚡ Executing command: ${command.type}`);
  let success = true;
  let error = null;

  try {
    switch (command.type) {
      case 'OPEN_SHORTCUT':
        if (command.payload && command.payload.path) {
          const isUrl = command.payload.isUrl || command.payload.type === 'website';
          if (isUrl) {
            await require('electron').shell.openExternal(command.payload.path);
          } else {
            await require('electron').shell.openPath(command.payload.path);
          }
          console.log(`✅ Opened shortcut: ${command.payload.path}`);
        }
        break;

      case 'ADD_SHORTCUT':
        if (command.payload && mainWindow) {
          mainWindow.webContents.send('server-add-shortcut', command.payload);
          console.log(`✅ Add shortcut command sent to renderer`);
        }
        break;

      case 'REMOVE_SHORTCUT':
        if (command.payload && command.payload.shortcutId && mainWindow) {
          mainWindow.webContents.send('server-remove-shortcut', command.payload.shortcutId);
          console.log(`✅ Remove shortcut command sent to renderer`);
        }
        break;

      case 'UPDATE_SETTINGS':
      case 'REFRESH_SHORTCUTS':
        if (mainWindow) {
          mainWindow.webContents.send('server-sync-settings');
          console.log(`✅ Settings sync command sent to renderer`);
        }
        break;

      case 'RESTART_APP':
        console.log('🔄 Restarting app...');
        app.relaunch();
        app.exit(0);
        break;

      case 'SHUTDOWN':
        console.log('🔌 Shutting down app...');
        forceCloseApp();
        break;

      case 'CUSTOM':
        if (command.payload && mainWindow) {
          mainWindow.webContents.send('server-custom-command', command.payload);
          console.log(`✅ Custom command sent to renderer`);
        }
        break;

      case 'SCREEN_SHARE_START':
        if (command.payload) {
          console.log(`📺 Screen share start command received`);
          createScreenShareWindow(
            command.payload.sessionId,
            command.payload.includeAudio
          );
        }
        break;

      case 'SCREEN_SHARE_STOP':
        console.log(`📺 Screen share stop command received`);
        closeScreenShareWindow();
        break;

      case 'SCREEN_SHARE_OFFER':
        if (command.payload && screenShareWindow && !screenShareWindow.isDestroyed()) {
          screenShareWindow.webContents.send('screenshare-offer', command.payload);
          console.log(`📺 Screen share offer forwarded to viewer`);
        }
        break;

      case 'SCREEN_SHARE_ICE':
        if (command.payload && screenShareWindow && !screenShareWindow.isDestroyed()) {
          screenShareWindow.webContents.send('screenshare-ice', command.payload);
          console.log(`📺 ICE candidate forwarded to viewer`);
        }
        break;

      default:
        console.log(`⚠️ Unknown command type: ${command.type}`);
    }
  } catch (err) {
    console.error(`❌ Error executing command ${command.type}:`, err);
    success = false;
    error = err.message;
  }

  // Send response back to server
  if (socket && socket.connected) {
    socket.emit('command:response', {
      commandType: command.type,
      success,
      error
    });
  }
}

// Send heartbeat with shortcuts info
async function sendHeartbeat() {
  if (!socket || !socket.connected) {
    return;
  }

  const packageJson = require('../package.json');
  const shortcuts = await getCurrentShortcuts();

  socket.emit('heartbeat', {
    version: packageJson.version,
    shortcuts
  });

  console.log('💓 Heartbeat sent');
}

// Start heartbeat interval
function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  // Send initial heartbeat
  sendHeartbeat();

  // Set up interval
  heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  console.log(`💓 Heartbeat started (every ${HEARTBEAT_INTERVAL / 1000}s)`);
}

// Stop heartbeat interval
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log('💔 Heartbeat stopped');
  }
}

// Disconnect from server
function disconnectFromServer() {
  stopHeartbeat();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  clientId = null;
  console.log('🔌 Disconnected from server');
}

// Connect to server using Socket.IO
async function connectToServer() {
  if (!serverUrl) {
    console.log('⚠️ No server URL configured');
    return false;
  }

  // Disconnect existing connection if any
  if (socket) {
    disconnectFromServer();
  }

  console.log(`🌐 Connecting to server: ${serverUrl}`);

  return new Promise((resolve) => {
    try {
      socket = io(serverUrl, {
        path: '/ws',
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000
      });

      socket.on('connect', () => {
        console.log('✅ Socket.IO connected');

        // Register with server
        const packageJson = require('../package.json');
        socket.emit('register', {
          hostname: pcInfo ? pcInfo.hostname : os.hostname(),
          platform: process.platform,
          arch: process.arch,
          version: packageJson.version
        });
      });

      socket.on('registered', (data) => {
        clientId = data.clientId;
        console.log(`✅ Registered with server. Client ID: ${clientId}`);
        startHeartbeat();
        resolve(true);
      });

      socket.on('command', (command) => {
        console.log(`📬 Received command: ${command.type}`);
        executeCommand(command);
      });

      socket.on('disconnect', (reason) => {
        console.log(`🔌 Disconnected from server: ${reason}`);
        stopHeartbeat();
      });

      socket.on('connect_error', (error) => {
        console.error('❌ Socket.IO connection error:', error.message);
        resolve(false);
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (!socket.connected) {
          console.error('❌ Connection timeout');
          socket.disconnect();
          resolve(false);
        }
      }, 15000);

    } catch (error) {
      console.error('❌ Error creating socket connection:', error);
      resolve(false);
    }
  });
}

// Test server connection
async function testServerConnection(url) {
  return new Promise((resolve) => {
    try {
      const testSocket = io(url, {
        path: '/ws',
        reconnection: false,
        timeout: 5000
      });

      const timeout = setTimeout(() => {
        testSocket.disconnect();
        resolve(false);
      }, 5000);

      testSocket.on('connect', () => {
        clearTimeout(timeout);
        testSocket.disconnect();
        resolve(true);
      });

      testSocket.on('connect_error', () => {
        clearTimeout(timeout);
        testSocket.disconnect();
        resolve(false);
      });
    } catch (error) {
      resolve(false);
    }
  });
}

// Get server connection status
function getServerStatus() {
  return {
    connected: socket ? socket.connected : false,
    clientId: clientId,
    serverUrl: serverUrl
  };
}

// ============================================================
// END SERVER CONNECTION FUNCTIONS
// ============================================================

// ============================================================
// SCREEN SHARE FUNCTIONS
// ============================================================

// Create screen share viewer window
function createScreenShareWindow(sessionId, includeAudio) {
  if (screenShareWindow && !screenShareWindow.isDestroyed()) {
    console.log('📺 Screen share window already exists, focusing...');
    screenShareWindow.focus();
    return;
  }

  console.log('📺 Creating screen share viewer window...');

  // Get primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  screenShareWindow = new BrowserWindow({
    width: Math.floor(width * 0.8),
    height: Math.floor(height * 0.8),
    minWidth: 640,
    minHeight: 480,
    frame: true,
    title: 'Screen Share - Receiving...',
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
      sandbox: false
    },
    show: false,
    center: true
  });

  // Store session info
  currentScreenShareSession = {
    sessionId,
    includeAudio
  };

  // Load the screen share viewer HTML
  screenShareWindow.loadFile(path.join(__dirname, '..', 'renderer', 'screenshare-viewer.html'));

  // Show when ready
  screenShareWindow.once('ready-to-show', () => {
    screenShareWindow.show();
    screenShareWindow.focus();
    console.log('📺 Screen share viewer window opened');

    // Send session info to the viewer
    screenShareWindow.webContents.send('screenshare-session', {
      sessionId,
      includeAudio,
      serverUrl
    });
  });

  // Handle window close
  screenShareWindow.on('closed', () => {
    console.log('📺 Screen share viewer window closed');
    screenShareWindow = null;
    currentScreenShareSession = null;
  });
}

// Close screen share window
function closeScreenShareWindow() {
  if (screenShareWindow && !screenShareWindow.isDestroyed()) {
    console.log('📺 Closing screen share viewer window...');
    screenShareWindow.close();
    screenShareWindow = null;
    currentScreenShareSession = null;
  }
}

// IPC handler for screen share answer (send back to server)
ipcMain.handle('screenshare-answer', async (event, data) => {
  if (!serverUrl || !currentScreenShareSession) {
    console.log('⚠️ Cannot send screen share answer: no active session');
    return { success: false };
  }

  try {
    const response = await serverRequest('/api/screenshare', 'POST', {
      action: data.type, // 'answer' or 'candidate'
      sessionId: currentScreenShareSession.sessionId,
      clientId: clientId,
      answer: data.answer,
      candidate: data.candidate
    });

    return { success: !!response };
  } catch (error) {
    console.error('❌ Error sending screen share answer:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================
// END SCREEN SHARE FUNCTIONS
// ============================================================

// Helper function to resize image to ULTRA HIGH RESOLUTION with AI upscaling
async function resizeImage(buffer, size = 512) { // INCREASED from 256 to 512!
  if (sharpAvailable) {
    try {
      const sharp = require('sharp');

      // Get original image metadata
      const metadata = await sharp(buffer).metadata();
      const originalWidth = metadata.width;
      const originalHeight = metadata.height;

      console.log(`📐 Original icon size: ${originalWidth}x${originalHeight}`);

      // If image is very small (< 64px), use Lanczos3 for better upscaling
      const kernel = (originalWidth < 64 || originalHeight < 64) ? sharp.kernel.lanczos3 : sharp.kernel.lanczos2;

      console.log(`🎨 Resizing to ${size}x${size} with ${kernel === sharp.kernel.lanczos3 ? 'Lanczos3 (AI upscaling)' : 'Lanczos2'}`);

      // Create ULTRA high-res icon (512x512) with best quality
      return await sharp(buffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          kernel: kernel, // Use Lanczos3 for small images (best quality upscaling)
          withoutEnlargement: false // Allow upscaling
        })
        .png({
          compressionLevel: 6, // Balance between quality and file size
          adaptiveFiltering: true, // Better quality
          palette: false // True color, no palette
        })
        .toBuffer();
    } catch (error) {
      console.log('Sharp resize failed, using fallback:', error.message);
    }
  }

  // Fallback: Use Electron's nativeImage for resizing
  try {
    const image = nativeImage.createFromBuffer(buffer);
    const resized = image.resize({ width: size, height: size, quality: 'best' });
    return resized.toPNG();
  } catch (error) {
    console.log('Fallback resize failed, returning original');
    return buffer;
  }
}

// FIXED: Better close handlers with immediate flag setting
ipcMain.handle('close-app', async () => {
  console.log('🔴 Close app requested via IPC handle');
  return closeApp();
});

ipcMain.on('close-app', () => {
  console.log('🔴 Close app requested via IPC on');
  closeApp();
});

// EMERGENCY close handler
ipcMain.on('force-close', () => {
  console.log('🔴 FORCE CLOSE requested');
  forceCloseApp();
});

// FIXED: More reliable close function
function closeApp() {
  console.log('🔴 closeApp() called');
  
  // Set flag IMMEDIATELY before attempting close
  shouldClose = true;
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('🔴 Attempting graceful close...');
    
    // Try graceful close first
    mainWindow.close();
    
    // If graceful close fails after 2 seconds, force close
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('🔴 Graceful close failed, forcing close...');
        mainWindow.destroy();
        app.quit();
      }
    }, 2000);
  } else {
    console.log('🔴 Main window already destroyed, quitting app...');
    app.quit();
  }
}

// FIXED: Force close function - INSTANT
function forceCloseApp() {
  console.log('🔴 forceCloseApp() - INSTANT EXIT');
  shouldClose = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }

  // Use app.exit() for instant termination (no cleanup, immediate)
  app.exit(0);
}

// PC info IPC handlers
ipcMain.handle('get-pc-info', () => {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    username: os.userInfo().username
  };
});

// File operation IPC handlers
ipcMain.handle('check-software-exists', async (event, softwarePath) => {
  try {
    return await fs.pathExists(softwarePath);
  } catch (error) {
    return false;
  }
});

ipcMain.handle('browse-file', async () => {
  // Platform-specific file filters
  let filters;
  if (process.platform === 'win32') {
    filters = [
      { name: 'Executables', extensions: ['exe', 'lnk'] },
      { name: 'All Files', extensions: ['*'] }
    ];
  } else if (process.platform === 'linux') {
    filters = [
      { name: 'Applications', extensions: ['desktop', 'sh', 'AppImage', 'appimage'] },
      { name: 'All Files', extensions: ['*'] }
    ];
  } else if (process.platform === 'darwin') {
    filters = [
      { name: 'Applications', extensions: ['app', 'sh'] },
      { name: 'All Files', extensions: ['*'] }
    ];
  } else {
    filters = [
      { name: 'All Files', extensions: ['*'] }
    ];
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters
  });

  return result.canceled ? null : result.filePaths[0];
});

// NEW: Browse for background image
ipcMain.handle('browse-background-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  return result.canceled ? null : result.filePaths[0];
});

// NEW: Browse for custom icon image
ipcMain.handle('browse-icon-image', async () => {
  console.log('🖼️ Opening icon image browser...');

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'ico'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    title: 'Select Icon Image'
  });

  if (result.canceled || !result.filePaths[0]) {
    console.log('❌ Icon image selection canceled');
    return null;
  }

  const selectedPath = result.filePaths[0];
  console.log('📁 Selected icon image:', selectedPath);

  try {
    // Read the selected image file
    const imageBuffer = await fs.readFile(selectedPath);
    console.log('📥 Image loaded, size:', imageBuffer.length, 'bytes');

    // Process the image (resize to ULTRA high-res 512x512 with AI upscaling)
    const processedBuffer = await resizeImage(imageBuffer, 512);

    if (!processedBuffer) {
      throw new Error('Failed to process image');
    }

    console.log('✅ Image processed to ULTRA high-res (512x512)');

    // Save to icons directory
    const fileName = path.basename(selectedPath, path.extname(selectedPath));
    const iconPath = await saveIconLocally(processedBuffer, fileName);

    console.log('✅ Icon saved:', iconPath);
    return iconPath;

  } catch (error) {
    console.error('❌ Error processing icon image:', error);
    throw error;
  }
});

// NEW: Install RustDesk handler
ipcMain.handle('install-rustdesk', async () => {
  console.log('🚀 Installing RustDesk...');

  // Linux installation
  if (process.platform === 'linux') {
    try {
      const arch = os.arch();
      let rustdeskUrl;
      let downloadPath;

      if (arch === 'x64') {
        rustdeskUrl = 'https://github.com/rustdesk/rustdesk/releases/download/1.4.1/rustdesk-1.4.1-x86_64.deb';
        downloadPath = path.join(os.tmpdir(), 'rustdesk-installer.deb');
      } else if (arch === 'arm64') {
        rustdeskUrl = 'https://github.com/rustdesk/rustdesk/releases/download/1.4.1/rustdesk-1.4.1-aarch64.deb';
        downloadPath = path.join(os.tmpdir(), 'rustdesk-installer.deb');
      } else {
        return { success: false, error: `Unsupported architecture: ${arch}` };
      }

      console.log('📥 Downloading RustDesk from:', rustdeskUrl);
      console.log('📁 Download path:', downloadPath);

      // Download the file
      await downloadFile(rustdeskUrl, downloadPath, {
        timeout: 120000, // 2 minutes timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        }
      });

      console.log('✅ Download completed, starting installation...');

      // Install using pkexec for privilege escalation
      return new Promise((resolve, reject) => {
        const installer = spawn('pkexec', ['dpkg', '-i', downloadPath], {
          stdio: 'pipe'
        });

        let errorOutput = '';
        let stdOutput = '';

        installer.stdout.on('data', (data) => {
          stdOutput += data.toString();
        });

        installer.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        installer.on('close', (code) => {
          // Clean up downloaded file
          fs.unlink(downloadPath, (err) => {
            if (err) console.log('Warning: Could not clean up installer file:', err.message);
          });

          console.log(`dpkg exit code: ${code}`);

          if (code === 0) {
            console.log('✅ RustDesk installation completed successfully');
            resolve({
              success: true,
              message: 'RustDesk installed successfully!'
            });
          } else {
            // Try to fix dependencies
            console.log('⚠️ Attempting to fix dependencies...');
            const fixDeps = spawn('pkexec', ['apt-get', 'install', '-f', '-y'], {
              stdio: 'pipe'
            });

            fixDeps.on('close', (fixCode) => {
              if (fixCode === 0) {
                resolve({
                  success: true,
                  message: 'RustDesk installed successfully (dependencies fixed)!'
                });
              } else {
                reject(new Error(`Installation failed. Please install manually: sudo dpkg -i ${downloadPath} && sudo apt-get install -f`));
              }
            });
          }
        });

        installer.on('error', (error) => {
          console.error('❌ Installation process error:', error);
          fs.unlink(downloadPath, () => {});
          reject(new Error(`Installation process failed: ${error.message}. Try: sudo dpkg -i <downloaded-file>`));
        });
      });

    } catch (error) {
      console.error('❌ RustDesk installation error (Linux):', error);
      return { success: false, error: error.message };
    }
  }

  // Windows installation
  if (process.platform !== 'win32') {
    return { success: false, error: 'RustDesk installation only supported on Windows and Linux' };
  }

  try {
    const rustdeskUrl = 'https://github.com/rustdesk/rustdesk/releases/download/1.4.1/rustdesk-1.4.1-x86_64.msi';
    const tempDir = os.tmpdir();
    const downloadPath = path.join(tempDir, 'rustdesk-installer.msi');

    console.log('📥 Downloading RustDesk from:', rustdeskUrl);
    console.log('📁 Download path:', downloadPath);

    // Download the file
    await downloadFile(rustdeskUrl, downloadPath, {
      timeout: 60000, // 60 seconds timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    console.log('✅ Download completed, starting installation...');

    // Execute the MSI installer with elevated privileges
    return new Promise((resolve, reject) => {
      // Use PowerShell to run the installer with elevated privileges
      const powershellCommand = `Start-Process -FilePath "msiexec.exe" -ArgumentList "/i","${downloadPath}","/quiet","/norestart" -Verb RunAs -Wait`;

      const installer = spawn('powershell.exe', ['-Command', powershellCommand], {
        stdio: 'pipe',
        windowsHide: true
      });

      let errorOutput = '';
      let stdOutput = '';

      installer.stdout.on('data', (data) => {
        stdOutput += data.toString();
      });

      installer.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      installer.on('close', (code) => {
        // Clean up downloaded file
        fs.unlink(downloadPath, (err) => {
          if (err) console.log('Warning: Could not clean up installer file:', err.message);
        });

        console.log(`PowerShell exit code: ${code}`);
        console.log(`Stdout: ${stdOutput}`);
        console.log(`Stderr: ${errorOutput}`);

        if (code === 0) {
          console.log('✅ RustDesk installation completed successfully');
          resolve({
            success: true,
            message: 'RustDesk installed successfully! You may need to restart your computer.'
          });
        } else {
          // Check for specific error conditions
          if (errorOutput.includes('declined the elevation prompt') || errorOutput.includes('cancelled')) {
            reject(new Error('Installation cancelled: Administrator privileges required but declined by user.'));
          } else if (code === 1) {
            // Exit code 1 might still be success in some cases for PowerShell
            console.log('⚠️ PowerShell returned exit code 1, but this might be normal');
            resolve({
              success: true,
              message: 'RustDesk installation completed. Please check if it was installed successfully.'
            });
          } else {
            console.error(`❌ Installation failed with exit code: ${code}`);
            reject(new Error(`Installation failed with exit code: ${code}. ${errorOutput || stdOutput}`));
          }
        }
      });

      installer.on('error', (error) => {
        console.error('❌ Installation process error:', error);
        // Clean up downloaded file
        fs.unlink(downloadPath, () => {});
        reject(new Error(`Installation process failed: ${error.message}`));
      });
    });
    
  } catch (error) {
    console.error('❌ RustDesk installation error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Install Remotely agent handler (Windows only)
ipcMain.handle('install-remotely', async () => {
  console.log('🚀 Installing Remotely agent...');

  if (process.platform !== 'win32') {
    return { success: false, error: 'Remotely is only supported on Windows' };
  }

  try {
    // PowerShell command to download and run the Remotely installer
    const powershellCommand = `
      Invoke-WebRequest -Uri 'https://remotely.oth.zone/api/ClientDownloads/WindowsInstaller/613dd6f8-787a-4ebe-8e47-6d0675787703' -OutFile "\${env:TEMP}\\Install-Remotely.ps1" -UseBasicParsing;
      Start-Process -FilePath 'powershell.exe' -ArgumentList ('-executionpolicy', 'bypass', '-f', "\${env:TEMP}\\Install-Remotely.ps1") -Verb RunAs
    `;

    return new Promise((resolve, reject) => {
      const installer = spawn('powershell.exe', [
        '-ExecutionPolicy', 'Bypass',
        '-Command', powershellCommand
      ], {
        stdio: 'pipe',
        windowsHide: true
      });

      let errorOutput = '';
      let stdOutput = '';

      installer.stdout.on('data', (data) => {
        stdOutput += data.toString();
        console.log('Remotely stdout:', data.toString());
      });

      installer.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.log('Remotely stderr:', data.toString());
      });

      installer.on('close', (code) => {
        console.log(`Remotely installer exit code: ${code}`);

        if (code === 0) {
          console.log('✅ Remotely installation started successfully');
          resolve({
            success: true,
            message: 'Remotely installation started. Please complete the UAC prompt if shown.'
          });
        } else {
          console.error(`❌ Remotely installation failed with code: ${code}`);
          resolve({
            success: false,
            error: `Installation failed with exit code: ${code}. ${errorOutput || 'Unknown error'}`
          });
        }
      });

      installer.on('error', (error) => {
        console.error('❌ Remotely installation error:', error);
        resolve({
          success: false,
          error: error.message
        });
      });
    });

  } catch (error) {
    console.error('❌ Remotely installation error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Shortcut operation IPC handlers
ipcMain.handle('open-shortcut', async (event, shortcutPath, isUrl = false) => {
  try {
    if (isUrl) {
      await shell.openExternal(shortcutPath);
    } else {
      await shell.openPath(shortcutPath);
    }
    return true;
  } catch (error) {
    console.error('Error opening shortcut:', error);
    return false;
  }
});

// Icon extraction IPC handlers - NOW SAVES LOCALLY IN ULTRA HIGH RES
ipcMain.handle('extract-website-icon', async (event, url, shortcutName) => {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.origin;

    // Try to get ULTRA high-res favicon (512x512 is the goal!)
    const faviconSources = [
      `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=512`, // ULTRA High-res Google favicon
      `${domain}/apple-touch-icon-precomposed.png`, // Usually 180x180
      `${domain}/apple-touch-icon.png`,
      `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=256`, // Fallback to 256
      `https://icons.duckduckgo.com/ip3/${urlObj.hostname}.ico`,
      `${domain}/favicon-194x194.png`,
      `${domain}/favicon-96x96.png`,
      `${domain}/favicon.png`,
      `${domain}/favicon.ico`,
      `https://favicon.yandex.net/favicon/${urlObj.hostname}`
    ];

    for (const faviconUrl of faviconSources) {
      try {
        console.log(`Trying to fetch ULTRA HIGH-RES favicon from: ${faviconUrl}`);

        const buffer = await fetchData(faviconUrl, {
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        if (buffer && buffer.length > 0) {
          // Resize to ULTRA high-res 512x512 with AI upscaling
          const resizedBuffer = await resizeImage(buffer, 512);

          // Save locally and return file path
          const iconPath = await saveIconLocally(resizedBuffer, shortcutName || urlObj.hostname);

          if (iconPath) {
            console.log(`✅ ULTRA high-res website icon saved (512x512): ${iconPath}`);
            return iconPath; // Return file path instead of base64
          }
        }
      } catch (error) {
        console.log(`Failed to fetch favicon from ${faviconUrl}:`, error.message);
        continue;
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting website icon:', error);
    return null;
  }
});

// Helper function to parse Linux .desktop files
async function parseDesktopFile(desktopPath) {
  try {
    const content = await fs.readFile(desktopPath, 'utf8');
    const lines = content.split('\n');
    const result = {};

    for (const line of lines) {
      if (line.includes('=')) {
        const [key, ...valueParts] = line.split('=');
        result[key.trim()] = valueParts.join('=').trim();
      }
    }

    return result;
  } catch (error) {
    console.log('Could not parse .desktop file:', error.message);
    return null;
  }
}

// Helper function to find Linux icon by name
async function findLinuxIcon(iconName) {
  if (!iconName) return null;

  // If it's already an absolute path, return it
  if (path.isAbsolute(iconName) && await fs.pathExists(iconName)) {
    return iconName;
  }

  // Common icon directories to search
  const iconDirs = [
    '/usr/share/icons/hicolor/512x512/apps',
    '/usr/share/icons/hicolor/256x256/apps',
    '/usr/share/icons/hicolor/128x128/apps',
    '/usr/share/icons/hicolor/96x96/apps',
    '/usr/share/icons/hicolor/64x64/apps',
    '/usr/share/icons/hicolor/48x48/apps',
    '/usr/share/icons/hicolor/scalable/apps',
    '/usr/share/pixmaps',
    path.join(os.homedir(), '.local/share/icons/hicolor/512x512/apps'),
    path.join(os.homedir(), '.local/share/icons/hicolor/256x256/apps'),
    path.join(os.homedir(), '.local/share/icons/hicolor/128x128/apps'),
    path.join(os.homedir(), '.local/share/icons'),
    '/usr/share/icons',
    '/var/lib/flatpak/exports/share/icons/hicolor/512x512/apps',
    '/var/lib/flatpak/exports/share/icons/hicolor/256x256/apps',
    '/var/lib/flatpak/exports/share/icons/hicolor/128x128/apps',
    path.join(os.homedir(), '.local/share/flatpak/exports/share/icons/hicolor/512x512/apps'),
    path.join(os.homedir(), '.local/share/flatpak/exports/share/icons/hicolor/256x256/apps'),
  ];

  // Extensions to try
  const extensions = ['', '.png', '.svg', '.xpm', '.ico'];

  for (const dir of iconDirs) {
    for (const ext of extensions) {
      const iconPath = path.join(dir, iconName + ext);
      try {
        if (await fs.pathExists(iconPath)) {
          console.log(`✅ Found Linux icon: ${iconPath}`);
          return iconPath;
        }
      } catch (e) {
        // Continue searching
      }
    }
  }

  console.log(`⚠️ Could not find Linux icon: ${iconName}`);
  return null;
}

ipcMain.handle('extract-app-icon', async (event, appPath, shortcutName) => {
  try {
    let targetPath = appPath;
    let iconBuffer = null;

    // Windows: Handle .lnk shortcuts
    if (process.platform === 'win32' && path.extname(appPath).toLowerCase() === '.lnk') {
      try {
        const shortcutDetails = shell.readShortcutLink(appPath);
        targetPath = shortcutDetails.target;
      } catch (error) {
        console.log('Could not resolve shortcut:', error.message);
      }
    }

    // Linux: Handle .desktop files
    if (process.platform === 'linux' && path.extname(appPath).toLowerCase() === '.desktop') {
      try {
        const desktopEntry = await parseDesktopFile(appPath);
        if (desktopEntry) {
          // Get the Exec path for the target
          if (desktopEntry.Exec) {
            // Extract the executable path (remove arguments)
            targetPath = desktopEntry.Exec.split(' ')[0].replace(/%[a-zA-Z]/g, '').trim();
          }

          // Get the icon
          if (desktopEntry.Icon) {
            const iconPath = await findLinuxIcon(desktopEntry.Icon);
            if (iconPath) {
              try {
                iconBuffer = await fs.readFile(iconPath);
                console.log(`📥 Loaded Linux icon from: ${iconPath}`);
              } catch (e) {
                console.log('Could not read icon file:', e.message);
              }
            }
          }
        }
      } catch (error) {
        console.log('Could not parse .desktop file:', error.message);
      }
    }

    // If no icon buffer yet, try platform methods
    if (!iconBuffer) {
      try {
        // Get icon from the file (works on Windows, may work on Linux/macOS)
        const icon = await app.getFileIcon(targetPath, { size: 'large' });
        iconBuffer = icon.toPNG();

        // Windows: Try to get higher resolution if possible
        if (process.platform === 'win32') {
          const image = nativeImage.createFromPath(targetPath);
          if (!image.isEmpty()) {
            const size = image.getSize();
            console.log(`📐 Original app icon size: ${size.width}x${size.height}`);

            // If we got a high-res icon, use it
            if (size.width >= 128) {
              iconBuffer = image.toPNG();
            }
          }
        }
      } catch (error) {
        console.log('Could not extract app icon via getFileIcon:', error.message);
      }
    }

    // Linux: If still no icon, try to find it by app name
    if (!iconBuffer && process.platform === 'linux') {
      const appName = path.basename(targetPath, path.extname(targetPath)).toLowerCase();
      const iconPath = await findLinuxIcon(appName);
      if (iconPath) {
        try {
          iconBuffer = await fs.readFile(iconPath);
        } catch (e) {
          console.log('Could not read icon file:', e.message);
        }
      }
    }

    if (iconBuffer) {
      // Resize to ULTRA high-res 512x512 with AI upscaling
      const resizedBuffer = await resizeImage(iconBuffer, 512);

      // Save locally and return file path
      const savedIconPath = await saveIconLocally(resizedBuffer, shortcutName || path.basename(targetPath, path.extname(targetPath)));

      if (savedIconPath) {
        console.log(`✅ ULTRA high-res app icon saved (512x512): ${savedIconPath}`);
        return savedIconPath; // Return file path instead of base64
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting app icon:', error);
    return null;
  }
});

// Database IPC handlers
ipcMain.handle('db-connect', async () => {
  console.log('📢 IPC Handler: db-connect called');
  try {
    const result = await connectToDatabase();
    console.log(`📢 IPC Handler: db-connect returning ${result}`);
    return result;
  } catch (error) {
    console.error('❌ IPC Handler: db-connect error:', error);
    return false;
  }
});

ipcMain.handle('db-get-shortcuts', async () => {
  try {
    if (!isDbConnected || !pcInfo) return [];

    const tableName = `shortcuts_${sanitizeTableName(pcInfo.hostname)}`;
    const [rows] = await dbConnection.execute(`
      SELECT * FROM ${tableName} ORDER BY created_at ASC
    `);

    // Check if software still exists on PC
    for (let shortcut of rows) {
      if (shortcut.type === 'software') {
        const exists = await fs.pathExists(shortcut.path);
        if (shortcut.exists_on_pc !== exists) {
          await dbConnection.execute(`
            UPDATE ${tableName} SET exists_on_pc = ? WHERE id = ?
          `, [exists, shortcut.id]);
          shortcut.exists_on_pc = exists;
        }
      }
    }

    return rows;
  } catch (error) {
    console.error('Error getting shortcuts:', error);
    return [];
  }
});

ipcMain.handle('db-add-shortcut', async (event, name, path, type, iconPath = null) => {
  try {
    if (!isDbConnected || !pcInfo) return false;

    const tableName = `shortcuts_${sanitizeTableName(pcInfo.hostname)}`;

    let existsOnPc = true;
    if (type === 'software') {
      existsOnPc = await fs.pathExists(path);
    }

    await dbConnection.execute(`
      INSERT INTO ${tableName} (name, path, type, icon_path, exists_on_pc, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [name, path, type, iconPath, existsOnPc, 250, 700]); // NEW: Default size 250x700

    console.log(`✅ Added shortcut: ${name} with icon: ${iconPath}`);
    return true;
  } catch (error) {
    console.error('❌ Error adding shortcut:', error);
    return false;
  }
});

// NEW: Update shortcut size
ipcMain.handle('db-update-shortcut-size', async (event, id, width, height) => {
  try {
    if (!isDbConnected || !pcInfo) return false;

    const tableName = `shortcuts_${sanitizeTableName(pcInfo.hostname)}`;
    await dbConnection.execute(`
      UPDATE ${tableName} SET width = ?, height = ? WHERE id = ?
    `, [width, height, id]);

    console.log(`✅ Updated shortcut size: ${id} -> ${width}x${height}`);
    return true;
  } catch (error) {
    console.error('❌ Error updating shortcut size:', error);
    return false;
  }
});

// NEW: Update shortcut details (name, path, type, icon)
ipcMain.handle('db-update-shortcut', async (event, id, name, path, type, newIconPath = null) => {
  try {
    if (!isDbConnected || !pcInfo) return false;

    const tableName = `shortcuts_${sanitizeTableName(pcInfo.hostname)}`;

    // Get current shortcut to check if icon changed
    const [rows] = await dbConnection.execute(`
      SELECT icon_path FROM ${tableName} WHERE id = ?
    `, [id]);

    const oldIconPath = rows.length > 0 ? rows[0].icon_path : null;

    // Check if software path exists
    let existsOnPc = true;
    if (type === 'software') {
      existsOnPc = await fs.pathExists(path);
    }

    // Update shortcut details
    await dbConnection.execute(`
      UPDATE ${tableName}
      SET name = ?, path = ?, type = ?, icon_path = ?, exists_on_pc = ?
      WHERE id = ?
    `, [name, path, type, newIconPath, existsOnPc, id]);

    // Delete old icon file if icon was changed and it exists
    if (newIconPath && oldIconPath && newIconPath !== oldIconPath) {
      await deleteIconFile(oldIconPath);
    }

    console.log(`✅ Updated shortcut: ${id} -> ${name}`);
    return true;
  } catch (error) {
    console.error('❌ Error updating shortcut:', error);
    return false;
  }
});

ipcMain.handle('db-delete-shortcut', async (event, id) => {
  try {
    if (!isDbConnected || !pcInfo) return false;

    const tableName = `shortcuts_${sanitizeTableName(pcInfo.hostname)}`;

    // Get the shortcut to find the icon path
    const [rows] = await dbConnection.execute(`
      SELECT icon_path FROM ${tableName} WHERE id = ?
    `, [id]);

    // Delete the icon file if it exists
    if (rows.length > 0 && rows[0].icon_path) {
      await deleteIconFile(rows[0].icon_path);
    }

    // Delete the shortcut from database
    await dbConnection.execute(`
      DELETE FROM ${tableName} WHERE id = ?
    `, [id]);

    console.log(`✅ Deleted shortcut with ID: ${id}`);
    return true;
  } catch (error) {
    console.error('❌ Error deleting shortcut:', error);
    return false;
  }
});

ipcMain.handle('db-update-shortcut-existence', async (event, id, exists) => {
  try {
    if (!isDbConnected || !pcInfo) return false;

    const tableName = `shortcuts_${sanitizeTableName(pcInfo.hostname)}`;
    await dbConnection.execute(`
      UPDATE ${tableName} SET exists_on_pc = ? WHERE id = ?
    `, [exists, id]);

    return true;
  } catch (error) {
    console.error('Error updating shortcut existence:', error);
    return false;
  }
});

// NEW: Load icon from local file path
ipcMain.handle('load-icon', async (event, iconPath) => {
  try {
    return await loadIconLocally(iconPath);
  } catch (error) {
    console.error('Error loading icon:', error);
    return null;
  }
});

// NEW: Settings handlers for background
ipcMain.handle('db-get-setting', async (event, key) => {
  try {
    if (!isDbConnected || !pcInfo) return null;

    const tableName = `settings_${sanitizeTableName(pcInfo.hostname)}`;
    const [rows] = await dbConnection.execute(`
      SELECT setting_value FROM ${tableName} WHERE setting_key = ?
    `, [key]);

    if (rows.length > 0) {
      return rows[0].setting_value;
    }
    return null;
  } catch (error) {
    console.error('Error getting setting:', error);
    return null;
  }
});

ipcMain.handle('db-set-setting', async (event, key, value) => {
  try {
    if (!isDbConnected || !pcInfo) return false;

    const tableName = `settings_${sanitizeTableName(pcInfo.hostname)}`;
    await dbConnection.execute(`
      INSERT INTO ${tableName} (setting_key, setting_value) 
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE 
        setting_value = VALUES(setting_value),
        updated_at = CURRENT_TIMESTAMP
    `, [key, value]);

    console.log(`✅ Updated setting: ${key}`);
    return true;
  } catch (error) {
    console.error('❌ Error setting value:', error);
    return false;
  }
});

ipcMain.handle('db-get-pc-info', async () => {
  return pcInfo;
});

ipcMain.handle('db-get-all-pcs', async () => {
  try {
    if (!isDbConnected) return [];

    const [rows] = await dbConnection.execute(`
      SELECT * FROM pcs ORDER BY last_seen DESC
    `);

    return rows;
  } catch (error) {
    console.error('Error getting all PCs:', error);
    return [];
  }
});

ipcMain.handle('db-get-connection-status', async () => {
  return {
    connected: isDbConnected,
    hostname: pcInfo?.hostname || 'Unknown',
    tableName: pcInfo ? `shortcuts_${sanitizeTableName(pcInfo.hostname)}` : 'None'
  };
});

// ============================================================
// SERVER IPC HANDLERS
// ============================================================

// Set server URL and connect
ipcMain.handle('server-connect', async (event, url) => {
  try {
    if (!url) {
      stopHeartbeat();
      serverUrl = null;
      clientId = null;
      return { success: false, message: 'No URL provided' };
    }

    // Clean URL (remove trailing slash)
    serverUrl = url.replace(/\/$/, '');
    console.log(`🌐 Server URL set to: ${serverUrl}`);

    // Save to database settings
    if (isDbConnected && pcInfo) {
      const settingsTableName = `settings_${sanitizeTableName(pcInfo.hostname)}`;
      await dbConnection.execute(`
        INSERT INTO ${settingsTableName} (setting_key, setting_value)
        VALUES ('server_url', ?)
        ON DUPLICATE KEY UPDATE
          setting_value = VALUES(setting_value),
          updated_at = CURRENT_TIMESTAMP
      `, [serverUrl]);
    }

    // Try to connect
    const connected = await connectToServer();
    return {
      success: connected,
      message: connected ? 'Connected to server' : 'Failed to connect to server',
      clientId: clientId
    };
  } catch (error) {
    console.error('❌ Error connecting to server:', error);
    return { success: false, message: error.message };
  }
});

// Disconnect from server
ipcMain.handle('server-disconnect', async () => {
  disconnectFromServer();
  serverUrl = null;
  return { success: true };
});

// Get server connection status
ipcMain.handle('server-status', async () => {
  return getServerStatus();
});

// Test server connection using Socket.IO
ipcMain.handle('server-test', async (event, url) => {
  try {
    const testUrl = url.replace(/\/$/, '');
    const isReachable = await testServerConnection(testUrl);
    return {
      success: isReachable,
      message: isReachable ? 'Server is reachable' : 'Cannot connect to server'
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Load server URL from settings on startup
async function loadServerSettings() {
  if (!isDbConnected || !pcInfo) return;

  try {
    const settingsTableName = `settings_${sanitizeTableName(pcInfo.hostname)}`;
    const [rows] = await dbConnection.execute(`
      SELECT setting_value FROM ${settingsTableName} WHERE setting_key = 'server_url'
    `);

    if (rows.length > 0 && rows[0].setting_value) {
      serverUrl = rows[0].setting_value;
      console.log(`🌐 Loaded server URL from settings: ${serverUrl}`);

      // Auto-connect to server
      setTimeout(() => {
        connectToServer();
      }, 2000);
    }
  } catch (error) {
    console.error('⚠️ Error loading server settings:', error.message);
  }
}

// ============================================================
// END SERVER IPC HANDLERS
// ============================================================

// NEW: Window mode control
ipcMain.handle('set-desktop-mode', async (event, enabled) => {
  console.log(`Setting wallpaper mode: ${enabled}`);
  
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (enabled) {
        // Enable pure Electron wallpaper mode (exits fullscreen mode)
        const success = enableWallpaperMode();
        if (success) {
          console.log('✅ Wallpaper mode enabled - launcher is now behind everything');
          return { success: true, message: 'Wallpaper mode enabled! Launcher will stay behind other windows.' };
        } else {
          console.log('⚠️ Failed to enable wallpaper mode, falling back to desktop mode');
          // Fallback: exit fullscreen and set to background
          mainWindow.setFullScreen(false);
          mainWindow.setAlwaysOnTop(false);
          mainWindow.blur();
          return { success: true, message: 'Desktop mode enabled (basic background behavior)' };
        }
      } else {
        // Disable wallpaper mode - restore to FULLSCREEN MODE
        const success = disableWallpaperMode();
        if (success || !isWallpaperMode) {
          console.log('✅ Fullscreen mode restored - apps can show on top');
          return { success: true, message: 'Fullscreen mode enabled!' };
        } else {
          console.log('❌ Failed to disable wallpaper mode');
          return { success: false, message: 'Failed to disable wallpaper mode' };
        }
      }
    } else {
      console.error('❌ Main window not available');
      return { success: false, message: 'Main window not available' };
    }
  } catch (error) {
    console.error('❌ Error setting window mode:', error);
    return { success: false, message: 'Error setting window mode: ' + error.message };
  }
});

// NEW: Get open windows for taskbar
ipcMain.handle('get-open-windows', async () => {
  try {
    console.log('🪟 Getting open windows...');

    // Linux: Use wmctrl to get window list
    if (process.platform === 'linux') {
      return new Promise((resolve) => {
        const child = spawn('wmctrl', ['-l', '-p'], {
          stdio: 'pipe'
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        child.on('close', async (code) => {
          if (code !== 0) {
            console.log('⚠️ wmctrl not available or failed. Install with: sudo apt install wmctrl');
            resolve([]);
            return;
          }

          try {
            const lines = output.trim().split('\n');
            const windows = [];

            for (const line of lines) {
              if (line.trim()) {
                // wmctrl -l -p format: window_id desktop_id pid hostname title
                const parts = line.split(/\s+/);
                if (parts.length >= 5) {
                  const windowId = parts[0];
                  const processId = parseInt(parts[2]);
                  const windowTitle = parts.slice(4).join(' ');

                  // Get process name and exe path from /proc
                  let processName = '';
                  let exePath = '';
                  try {
                    exePath = await fs.readlink(`/proc/${processId}/exe`);
                    processName = path.basename(exePath);
                  } catch (e) {
                    // Process may have ended or we don't have permission
                    processName = 'unknown';
                  }

                  // Filter out our own window
                  if (windowTitle &&
                      !windowTitle.includes('Shortcut Launcher') &&
                      processName !== 'electron') {
                    windows.push({
                      windowId: windowId,
                      processId: processId,
                      processName: processName,
                      windowTitle: windowTitle,
                      exePath: exePath
                    });
                  }
                }
              }
            }

            console.log(`✅ Found ${windows.length} open windows (Linux)`);
            resolve(windows);
          } catch (error) {
            console.error('Error parsing wmctrl output:', error);
            resolve([]);
          }
        });

        child.on('error', (error) => {
          console.log('⚠️ wmctrl not found. Install with: sudo apt install wmctrl');
          resolve([]);
        });
      });
    }

    // Windows: Use PowerShell to get visible windows with executable paths
    if (process.platform === 'win32') {
      const powershellScript = `
        Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | ForEach-Object {
            $processId = $_.Id
            $processName = $_.ProcessName
            $windowTitle = $_.MainWindowTitle
            $exePath = ""

            try {
                $exePath = $_.Path
            } catch {
                $exePath = ""
            }

            # Output as JSON
            @{
                processId = $processId
                processName = $processName
                windowTitle = $windowTitle
                exePath = $exePath
            } | ConvertTo-Json -Compress
        }
      `;

      return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          powershellScript
        ], {
          stdio: 'pipe',
          windowsHide: true
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        child.on('close', (code) => {
          if (code !== 0) {
            console.error('PowerShell error:', errorOutput);
            resolve([]);
            return;
          }

          try {
            // Parse the JSON lines
            const lines = output.trim().split('\n');
            const windows = [];

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const windowInfo = JSON.parse(line);
                  // Filter out our own window
                  if (windowInfo.windowTitle &&
                      !windowInfo.windowTitle.includes('Shortcut Launcher') &&
                      windowInfo.processName !== 'electron') {
                    windows.push({
                      ...windowInfo,
                      exePath: windowInfo.exePath || ''
                    });
                  }
                } catch (parseError) {
                  console.log('Failed to parse line:', line);
                }
              }
            }

            console.log(`✅ Found ${windows.length} open windows`);
            resolve(windows);
          } catch (error) {
            console.error('Error parsing window list:', error);
            resolve([]);
          }
        });

        child.on('error', (error) => {
          console.error('Error running PowerShell:', error);
          resolve([]);
        });
      });
    }

    // Unsupported platform
    console.log('⚠️ Window listing not supported on this platform');
    return [];
  } catch (error) {
    console.error('❌ Error getting open windows:', error);
    return [];
  }
});

// NEW: Focus/switch to a window by process ID (Windows) or window ID (Linux)
ipcMain.handle('focus-window', async (event, processIdOrWindowId, windowId = null) => {
  try {
    console.log(`🎯 Focusing window: ${processIdOrWindowId}`);

    // Linux: Use wmctrl to activate window by window ID
    if (process.platform === 'linux') {
      // On Linux, we can receive either windowId directly or as second parameter
      const linuxWindowId = windowId || processIdOrWindowId;

      return new Promise((resolve) => {
        const child = spawn('wmctrl', ['-i', '-a', linuxWindowId], {
          stdio: 'pipe'
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true, message: 'Window focused' });
          } else {
            // Try with xdotool as fallback
            const xdotoolChild = spawn('xdotool', ['windowactivate', linuxWindowId], {
              stdio: 'pipe'
            });

            xdotoolChild.on('close', (xdoCode) => {
              if (xdoCode === 0) {
                resolve({ success: true, message: 'Window focused' });
              } else {
                resolve({ success: false, message: 'Could not focus window. Install wmctrl or xdotool.' });
              }
            });

            xdotoolChild.on('error', () => {
              resolve({ success: false, message: 'wmctrl/xdotool not available. Install with: sudo apt install wmctrl xdotool' });
            });
          }
        });

        child.on('error', () => {
          // Try xdotool if wmctrl not found
          const xdotoolChild = spawn('xdotool', ['windowactivate', linuxWindowId], {
            stdio: 'pipe'
          });

          xdotoolChild.on('close', (xdoCode) => {
            if (xdoCode === 0) {
              resolve({ success: true, message: 'Window focused' });
            } else {
              resolve({ success: false, message: 'Could not focus window' });
            }
          });

          xdotoolChild.on('error', () => {
            resolve({ success: false, message: 'wmctrl/xdotool not available. Install with: sudo apt install wmctrl xdotool' });
          });
        });
      });
    }

    // Windows: Use PowerShell to bring window to foreground
    if (process.platform === 'win32') {
      const processId = processIdOrWindowId;
      const powershellScript = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
            [DllImport("user32.dll")]
            public static extern bool SetForegroundWindow(IntPtr hWnd);

            [DllImport("user32.dll")]
            public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

            [DllImport("user32.dll")]
            public static extern bool IsIconic(IntPtr hWnd);
        }
"@

        $process = Get-Process -Id ${processId} -ErrorAction SilentlyContinue
        if ($process) {
            $hwnd = $process.MainWindowHandle
            if ($hwnd -ne 0) {
                # If minimized, restore it
                if ([Win32]::IsIconic($hwnd)) {
                    [Win32]::ShowWindow($hwnd, 9) # SW_RESTORE = 9
                }
                # Bring to foreground
                [Win32]::SetForegroundWindow($hwnd)
                Write-Output "success"
            } else {
                Write-Output "no_window"
            }
        } else {
            Write-Output "not_found"
        }
      `;

      return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          powershellScript
        ], {
          stdio: 'pipe',
          windowsHide: true
        });

        let output = '';

        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.on('close', (code) => {
          const result = output.trim();
          if (result === 'success') {
            resolve({ success: true, message: 'Window focused' });
          } else if (result === 'no_window') {
            resolve({ success: false, message: 'Process has no window' });
          } else {
            resolve({ success: false, message: 'Process not found' });
          }
        });

        child.on('error', (error) => {
          reject(error);
        });
      });
    }

    return { success: false, message: 'Platform not supported' };
  } catch (error) {
    console.error('❌ Error focusing window:', error);
    return { success: false, message: error.message };
  }
});

// NEW: Extract icon from process executable
ipcMain.handle('get-process-icon', async (event, exePath) => {
  try {
    if (!exePath) {
      return null;
    }

    // Check cache first
    if (processIconCache.has(exePath)) {
      return processIconCache.get(exePath);
    }

    // Check if file exists
    if (!await fs.pathExists(exePath)) {
      return null;
    }

    // Extract icon from executable
    const icon = await app.getFileIcon(exePath, { size: 'large' });
    const iconBuffer = icon.toPNG();

    // Resize to 32x32 for taskbar
    let resizedBuffer = iconBuffer;
    if (sharpAvailable) {
      try {
        const sharp = require('sharp');
        resizedBuffer = await sharp(iconBuffer)
          .resize(32, 32, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .png()
          .toBuffer();
      } catch (e) {
        // Use original if resize fails
      }
    }

    // Convert to base64 data URL
    const base64Icon = `data:image/png;base64,${resizedBuffer.toString('base64')}`;

    // Cache it
    processIconCache.set(exePath, base64Icon);

    return base64Icon;
  } catch (error) {
    console.error('Error extracting process icon:', error.message);
    return null;
  }
});

// Download update from GitHub
ipcMain.handle('download-update', async (event, downloadUrl, fileName) => {
  try {
    console.log('📥 Downloading update from:', downloadUrl);

    const https = require('https');
    const http = require('http');
    const downloadsPath = app.getPath('downloads');
    const filePath = path.join(downloadsPath, fileName);

    return new Promise((resolve, reject) => {
      const protocol = downloadUrl.startsWith('https') ? https : http;

      const request = protocol.get(downloadUrl, {
        headers: { 'User-Agent': 'Shortcut-Launcher-Updater' }
      }, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          console.log('📥 Redirecting to:', redirectUrl);

          const redirectProtocol = redirectUrl.startsWith('https') ? https : http;
          redirectProtocol.get(redirectUrl, {
            headers: { 'User-Agent': 'Shortcut-Launcher-Updater' }
          }, (redirectResponse) => {
            const file = require('fs').createWriteStream(filePath);
            redirectResponse.pipe(file);

            file.on('finish', () => {
              file.close();
              console.log('✅ Download complete:', filePath);
              resolve({ success: true, filePath });
            });
          }).on('error', (err) => {
            reject({ success: false, error: err.message });
          });
          return;
        }

        if (response.statusCode !== 200) {
          reject({ success: false, error: `HTTP ${response.statusCode}` });
          return;
        }

        const file = require('fs').createWriteStream(filePath);
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('✅ Download complete:', filePath);
          resolve({ success: true, filePath });
        });
      });

      request.on('error', (err) => {
        console.error('❌ Download error:', err);
        reject({ success: false, error: err.message });
      });

      request.setTimeout(60000, () => {
        request.destroy();
        reject({ success: false, error: 'Download timeout' });
      });
    });
  } catch (error) {
    console.error('❌ Download update error:', error);
    return { success: false, error: error.message };
  }
});

// Install update (run the downloaded file)
ipcMain.handle('install-update', async (event, filePath) => {
  try {
    console.log('📦 Installing update from:', filePath);

    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return { success: false, error: 'Update file not found' };
    }

    // Run the installer
    const { exec } = require('child_process');

    if (filePath.endsWith('.exe') || filePath.endsWith('.msi')) {
      // Run installer and quit app
      exec(`start "" "${filePath}"`, (error) => {
        if (error) {
          console.error('❌ Failed to start installer:', error);
          return;
        }
        // Quit app after starting installer
        setTimeout(() => {
          app.exit(0);
        }, 1000);
      });

      return { success: true, message: 'Installer started' };
    } else if (filePath.endsWith('.zip')) {
      // Open the downloads folder for manual extraction
      shell.showItemInFolder(filePath);
      return { success: true, message: 'Downloaded to folder' };
    } else {
      shell.showItemInFolder(filePath);
      return { success: true, message: 'File downloaded' };
    }
  } catch (error) {
    console.error('❌ Install update error:', error);
    return { success: false, error: error.message };
  }
});

// Prevent navigation away from app
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    if (parsedUrl.origin !== 'file://') {
      event.preventDefault();
    }
  });
  
  // DISABLE right-click context menu in production (prevents DevTools access)
  if (process.env.NODE_ENV !== 'development') {
    contents.on('context-menu', (event) => {
      event.preventDefault();
      console.log('🚫 Context menu blocked in production mode');
    });
  }
});

// Prevent external link opening in app
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

console.log('✅ Main process initialized');

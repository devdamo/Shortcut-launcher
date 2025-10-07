const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, net, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');

// Pure Electron wallpaper mode (no native dependencies required!)
console.log('🎮 Pure Electron wallpaper mode loaded - no compilation needed!');

let mainWindow;
let sharpAvailable = false;
let shouldClose = false;
let dbConnection = null;
let pcInfo = null;
let isDbConnected = false;
let isWallpaperMode = false;

// Pure Electron wallpaper mode functions (no native compilation required!)
function enableWallpaperMode() {
  if (!mainWindow) {
    console.log('⚠️ Main window not available');
    return false;
  }
  
  try {
    // Use Electron's built-in methods for wallpaper-like behavior
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setSkipTaskbar(false);
    
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
    
    console.log('✅ Wallpaper mode enabled - using pure Electron methods');
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
    // Restore normal window behavior
    if (process.platform === 'darwin') {
      mainWindow.setLevel('normal');
    }
    
    mainWindow.setAlwaysOnTop(false);
    mainWindow.focus();
    mainWindow.moveTop();
    
    console.log('✅ Wallpaper mode disabled - window restored to normal');
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

function createWindow() {
  // Get screen dimensions excluding taskbar
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const { x, y } = primaryDisplay.workArea;

  // Create the browser window with secure settings
  mainWindow = new BrowserWindow({
    x: x,
    y: y,
    width: width,
    height: height,
    frame: false,
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
    minimizable: true,              // Allow minimize to see desktop
    maximizable: false,             // Disable maximize since we're using workArea
    closable: true,                 // Allow closing
    alwaysOnTop: false,             // Don't force always on top
    skipTaskbar: false,             // Show in taskbar
    type: 'desktop'                 // NEW: Set as desktop-type window (acts like wallpaper)
  });

  // Load the HTML file
  mainWindow.loadFile('renderer/index.html');

  // DISABLE DevTools shortcuts in production
  if (process.env.NODE_ENV !== 'development') {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
      if (
        input.key === 'F12' ||
        (input.control && input.shift && input.key === 'I') ||
        (input.control && input.shift && input.key === 'J') ||
        (input.control && input.key === 'U')
      ) {
        event.preventDefault();
        console.log('🚫 DevTools access blocked in production mode');
      }
    });
  }

  // Open DevTools ONLY in development
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
    console.log('🔧 DevTools opened in development mode');
  } else {
    console.log('🔒 DevTools disabled in production mode');
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    
    // Set window to be behind other windows but above desktop
    setTimeout(() => {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.moveTop(); // Move to top of z-order initially
      
      // Then move it behind all other windows
      setTimeout(() => {
        mainWindow.blur(); // Remove focus to send it back
      }, 100);
    }, 100);
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

// App event handlers
app.whenReady().then(() => {
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
        icon_data LONGTEXT,
        exists_on_pc BOOLEAN DEFAULT TRUE,
        position_x INT DEFAULT 0,
        position_y INT DEFAULT 0,
        width INT DEFAULT 250,
        height INT DEFAULT 700,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

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

// Helper function to resize image
async function resizeImage(buffer) {
  if (sharpAvailable) {
    try {
      const sharp = require('sharp');
      return await sharp(buffer)
        .resize(64, 64, { 
          fit: 'contain', 
          background: { r: 0, g: 0, b: 0, alpha: 0 } 
        })
        .png()
        .toBuffer();
    } catch (error) {
      console.log('Sharp resize failed, using original image');
    }
  }
  
  // Fallback: return original buffer
  return buffer;
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

// FIXED: Force close function (already working)
function forceCloseApp() {
  console.log('🔴 forceCloseApp() called');
  shouldClose = true;
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('🔴 Force destroying main window...');
    mainWindow.destroy();
  }
  
  console.log('🔴 Force quitting app...');
  app.quit();
  
  // Nuclear option - force exit
  setTimeout(() => {
    console.log('🔴 Nuclear option - process.exit()');
    process.exit(0);
  }, 500);
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
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: ['exe', 'lnk'] },
      { name: 'All Files', extensions: ['*'] }
    ]
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

// NEW: Install RustDesk handler
ipcMain.handle('install-rustdesk', async () => {
  console.log('🚀 Installing RustDesk...');
  
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

// Icon extraction IPC handlers
ipcMain.handle('extract-website-icon', async (event, url) => {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.origin;
    
    const faviconSources = [
      `${domain}/favicon.ico`,
      `${domain}/favicon.png`,
      `${domain}/apple-touch-icon.png`,
      `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`,
      `https://favicon.yandex.net/favicon/${urlObj.hostname}`,
      `https://icons.duckduckgo.com/ip3/${urlObj.hostname}.ico`
    ];

    for (const faviconUrl of faviconSources) {
      try {
        console.log(`Trying to fetch favicon from: ${faviconUrl}`);
        
        const buffer = await fetchData(faviconUrl, {
          timeout: 3000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (buffer && buffer.length > 0) {
          const resizedBuffer = await resizeImage(buffer);
          return `data:image/png;base64,${resizedBuffer.toString('base64')}`;
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

ipcMain.handle('extract-app-icon', async (event, appPath) => {
  try {
    let targetPath = appPath;
    if (path.extname(appPath).toLowerCase() === '.lnk') {
      try {
        const shortcutDetails = shell.readShortcutLink(appPath);
        targetPath = shortcutDetails.target;
      } catch (error) {
        console.log('Could not resolve shortcut:', error.message);
      }
    }

    try {
      const icon = await app.getFileIcon(targetPath, { size: 'large' });
      const iconBuffer = icon.toPNG();
      
      const resizedBuffer = await resizeImage(iconBuffer);
      return `data:image/png;base64,${resizedBuffer.toString('base64')}`;
    } catch (error) {
      console.log('Could not extract app icon:', error.message);
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

ipcMain.handle('db-add-shortcut', async (event, name, path, type, iconData = null) => {
  try {
    if (!isDbConnected || !pcInfo) return false;

    const tableName = `shortcuts_${sanitizeTableName(pcInfo.hostname)}`;
    
    let existsOnPc = true;
    if (type === 'software') {
      existsOnPc = await fs.pathExists(path);
    }

    await dbConnection.execute(`
      INSERT INTO ${tableName} (name, path, type, icon_data, exists_on_pc, width, height) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [name, path, type, iconData, existsOnPc, 250, 700]); // NEW: Default size 250x700

    console.log(`✅ Added shortcut: ${name}`);
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

ipcMain.handle('db-delete-shortcut', async (event, id) => {
  try {
    if (!isDbConnected || !pcInfo) return false;

    const tableName = `shortcuts_${sanitizeTableName(pcInfo.hostname)}`;
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

// NEW: Window mode control
ipcMain.handle('set-desktop-mode', async (event, enabled) => {
  console.log(`Setting wallpaper mode: ${enabled}`);
  
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (enabled) {
        // Enable pure Electron wallpaper mode
        const success = enableWallpaperMode();
        if (success) {
          console.log('✅ Wallpaper mode enabled - launcher is now behind everything');
          return { success: true, message: 'Wallpaper mode enabled! Launcher will stay behind other windows.' };
        } else {
          console.log('⚠️ Failed to enable wallpaper mode, falling back to desktop mode');
          // Fallback to previous desktop mode
          mainWindow.setAlwaysOnTop(false);
          mainWindow.blur();
          return { success: true, message: 'Desktop mode enabled (basic background behavior)' };
        }
      } else {
        // Disable wallpaper mode
        const success = disableWallpaperMode();
        if (success || !isWallpaperMode) {
          // Also do normal window restoration
          mainWindow.setAlwaysOnTop(false);
          mainWindow.focus();
          mainWindow.moveTop();
          console.log('✅ Normal mode enabled - window restored to normal behavior');
          return { success: true, message: 'Normal mode enabled' };
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

// NEW: Screen capture sources for screen sharing
ipcMain.handle('get-desktop-sources', async () => {
  try {
    console.log('📺 Getting desktop capture sources...');
    const sources = await desktopCapturer.getSources({ 
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 } // Don't generate thumbnails - too large for IPC
    });
    
    console.log(`✅ Found ${sources.length} sources`);
    
    // Filter out non-capturable sources and return only essential data
    const capturableSources = sources
      .filter(source => {
        // Filter out non-capturable windows
        const name = source.name.toLowerCase();
        // Skip Windows system dialogs and protected windows
        if (name.includes('task switching') || 
            name.includes('program manager') ||
            name.includes('settings') ||
            source.id.includes('window:0:0')) {
          return false;
        }
        return true;
      })
      .map(source => ({
        id: source.id,
        name: source.name,
        // Don't send thumbnail - too large for IPC
      }));
    
    console.log(`✅ Returning ${capturableSources.length} capturable sources`);
    return capturableSources;
  } catch (error) {
    console.error('❌ Error getting desktop sources:', error);
    throw error;
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

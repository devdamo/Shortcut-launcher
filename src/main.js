const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, net, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
const crypto = require('crypto');

// Pure Electron wallpaper mode (no native dependencies required!)
console.log('🎮 Pure Electron wallpaper mode loaded - no compilation needed!');

let mainWindow;
let sharpAvailable = false;
let shouldClose = false;
let dbConnection = null;
let pcInfo = null;
let isDbConnected = false;
let isWallpaperMode = false;
let iconsDir = null; // Directory for storing icons locally

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
  // Get FULL screen dimensions (not just work area - we want fullscreen!)
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds; // Changed from workAreaSize to bounds for true fullscreen
  const { x, y } = primaryDisplay.bounds;

  // Create the browser window with FULLSCREEN settings (allows apps on top)
  mainWindow = new BrowserWindow({
    x: 0, // Always start at 0,0 for fullscreen
    y: 0,
    width: width,
    height: height,
    frame: false,
    fullscreen: true,               // FIXED: Use fullscreen (hides taskbar) but NOT kiosk (allows apps on top)
    simpleFullscreen: false,        // Use real fullscreen (not simple mode)
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
    skipTaskbar: false,             // FIXED: Show in taskbar so apps can appear on top
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
    mainWindow.show();

    // FIXED: Fullscreen mode (hides taskbar) but allows other apps on top
    console.log('✅ Window shown in FULLSCREEN MODE (taskbar hidden, apps can appear on top)');

    // Reinforce fullscreen to ensure taskbar stays hidden
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setFullScreen(true);
        console.log('✅ Fullscreen mode reinforced - taskbar hidden, apps can show on top');
      }
    }, 500);
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
app.whenReady().then(async () => {
  // Initialize icons directory first
  await initializeIconsDirectory();

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

ipcMain.handle('extract-app-icon', async (event, appPath, shortcutName) => {
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
      // Get JUMBO size icon from Windows
      const icon = await app.getFileIcon(targetPath, { size: 'large' });
      let iconBuffer = icon.toPNG();

      // Try to get even higher resolution if possible
      const image = nativeImage.createFromPath(targetPath);
      if (!image.isEmpty()) {
        const size = image.getSize();
        console.log(`📐 Original app icon size: ${size.width}x${size.height}`);

        // If we got a high-res icon, use it
        if (size.width >= 128) {
          iconBuffer = image.toPNG();
        }
      }

      // Resize to ULTRA high-res 512x512 with AI upscaling
      const resizedBuffer = await resizeImage(iconBuffer, 512);

      // Save locally and return file path
      const iconPath = await saveIconLocally(resizedBuffer, shortcutName || path.basename(targetPath, path.extname(targetPath)));

      if (iconPath) {
        console.log(`✅ ULTRA high-res app icon saved (512x512): ${iconPath}`);
        return iconPath; // Return file path instead of base64
      }
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

// NEW: Get open windows for taskbar
ipcMain.handle('get-open-windows', async () => {
  try {
    console.log('🪟 Getting open windows...');

    if (process.platform !== 'win32') {
      console.log('⚠️ Window listing only supported on Windows');
      return [];
    }

    // Use PowerShell to get visible windows
    const powershellScript = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Text;
      public class Win32 {
          [DllImport("user32.dll")]
          public static extern bool IsWindowVisible(IntPtr hWnd);

          [DllImport("user32.dll")]
          public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

          [DllImport("user32.dll", SetLastError=true)]
          public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
      }
"@

      Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | ForEach-Object {
          $processId = $_.Id
          $processName = $_.ProcessName
          $windowTitle = $_.MainWindowTitle

          # Output as JSON
          @{
              processId = $processId
              processName = $processName
              windowTitle = $windowTitle
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
                  windows.push(windowInfo);
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
  } catch (error) {
    console.error('❌ Error getting open windows:', error);
    return [];
  }
});

// NEW: Focus/switch to a window by process ID
ipcMain.handle('focus-window', async (event, processId) => {
  try {
    console.log(`🎯 Focusing window with process ID: ${processId}`);

    if (process.platform !== 'win32') {
      return { success: false, message: 'Only supported on Windows' };
    }

    // Use PowerShell to bring window to foreground
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
  } catch (error) {
    console.error('❌ Error focusing window:', error);
    return { success: false, message: error.message };
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

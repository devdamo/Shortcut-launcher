@echo off
REM Screen Share Relay Server - Windows Deployment Script

echo ====================================================
echo    Screen Share Relay Server - Deployment Script
echo ====================================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js 16 or higher from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [OK] Node.js found: %NODE_VERSION%
echo.

REM Install dependencies
echo [INSTALL] Installing dependencies...
call npm install

if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

echo [OK] Dependencies installed
echo.

REM Get port configuration
set /p PORT="Enter port number (default: 9090): "
if "%PORT%"=="" set PORT=9090

echo.
echo Configuration Summary:
echo   - Port: %PORT%
echo.

REM Firewall configuration
echo ====================================================
echo                Firewall Configuration
echo ====================================================
echo.
echo You need to allow port %PORT% in Windows Firewall.
echo.
echo To configure Windows Firewall:
echo   1. Open Windows Defender Firewall with Advanced Security
echo   2. Click "Inbound Rules" - New Rule
echo   3. Select "Port" - Next
echo   4. Select TCP and enter %PORT% - Next
echo   5. Select "Allow the connection" - Next
echo   6. Apply to all profiles - Next
echo   7. Name: "Screen Share Relay" - Finish
echo.
echo Or run this command as Administrator:
echo   netsh advfirewall firewall add rule name="Screen Share Relay" dir=in action=allow protocol=TCP localport=%PORT%
echo.

set /p FIREWALL_OK="Have you configured Windows Firewall? (y/n): "
if /i not "%FIREWALL_OK%"=="y" (
    echo [WARNING] Please configure Windows Firewall before continuing
    pause
    exit /b 0
)

echo.

REM Check if PM2 is installed
where pm2 >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] PM2 not found. Installing PM2 globally...
    call npm install -g pm2
    
    if %errorlevel% neq 0 (
        echo [WARNING] PM2 installation failed
        echo You can still run the server manually with: npm start
        set USE_PM2=false
    ) else (
        set USE_PM2=true
        echo [OK] PM2 installed successfully
    )
) else (
    set USE_PM2=true
    echo [OK] PM2 found
)

echo.

REM Start the server
if "%USE_PM2%"=="true" (
    echo [START] Starting server with PM2...
    
    REM Stop existing instance if any
    pm2 delete screen-share-relay 2>nul
    
    REM Start server
    pm2 start server.js --name "screen-share-relay" -- --port=%PORT%
    
    if %errorlevel% equ 0 (
        echo [OK] Server started successfully!
        echo.
        
        REM Save PM2 configuration
        pm2 save
        
        REM Install PM2 Windows service
        echo [SETUP] Setting up PM2 as Windows service...
        pm2-startup install
        
        echo.
        echo Server Status:
        pm2 status
        
        echo.
        echo ====================================================
        echo                   Useful Commands
        echo ====================================================
        echo   - View logs:    pm2 logs screen-share-relay
        echo   - Restart:      pm2 restart screen-share-relay
        echo   - Stop:         pm2 stop screen-share-relay
        echo   - Status:       pm2 status
        echo   - Delete:       pm2 delete screen-share-relay
        echo ====================================================
        
    ) else (
        echo [ERROR] Failed to start server with PM2
        pause
        exit /b 1
    )
) else (
    echo [START] Starting server manually...
    echo To stop, press Ctrl+C
    echo.
    set PORT=%PORT%
    npm start
)

echo.
echo ====================================================
echo              Deployment Complete!
echo ====================================================
echo.
echo Server Information:
echo   - WebSocket URL: ws://YOUR_PC_IP:%PORT%
echo   - Health Check: http://YOUR_PC_IP:%PORT%/health
echo.
echo To find your IP address:
echo   - Run: ipconfig
echo   - Look for "IPv4 Address" under your active network adapter
echo.
echo Client Configuration:
echo   1. Open Shortcut Launcher
echo   2. Click the "Screen Share" button
echo   3. Enter: ws://YOUR_PC_IP:%PORT%
echo   4. Enter your username
echo   5. Click Connect
echo.
echo Security Recommendations:
echo   - Only allow connections from trusted IPs
echo   - Use VPN for remote access if possible
echo   - Monitor server logs regularly
echo   - Consider using authentication in production
echo.
echo Done! Press any key to exit...
pause >nul

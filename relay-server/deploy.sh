#!/bin/bash

# Screen Share Relay Server - Deployment Script
# This script helps you deploy the relay server to a Linux VPS

echo "🚀 Screen Share Relay Server - Deployment Script"
echo "================================================"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    echo "⚠️  Warning: Running as root. Consider using a non-root user."
    echo ""
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js 16 or higher first:"
    echo "  - Ubuntu/Debian: sudo apt install nodejs npm"
    echo "  - CentOS/RHEL: sudo yum install nodejs npm"
    echo "  - Or visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js found: $NODE_VERSION"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "🔧 PM2 not found. Installing PM2 globally..."
    sudo npm install -g pm2
    
    if [ $? -ne 0 ]; then
        echo "⚠️  PM2 installation failed. You can still run the server manually with 'npm start'"
        USE_PM2=false
    else
        USE_PM2=true
        echo "✅ PM2 installed successfully"
    fi
else
    USE_PM2=true
    echo "✅ PM2 found"
fi
echo ""

# Get server configuration
echo "⚙️  Server Configuration"
echo "----------------------"

read -p "Enter port number (default: 9090): " PORT
PORT=${PORT:-9090}

# Update port in server.js if needed
if [ "$PORT" != "9090" ]; then
    echo "Updating port in server.js..."
    sed -i "s/const PORT = process.env.PORT || 9090;/const PORT = process.env.PORT || $PORT;/g" server.js
fi

echo ""
echo "📝 Configuration Summary:"
echo "  - Port: $PORT"
echo ""

# Firewall configuration
echo "🔥 Firewall Configuration"
echo "------------------------"
echo "You need to open port $PORT in your firewall."
echo ""
echo "For UFW (Ubuntu/Debian):"
echo "  sudo ufw allow $PORT/tcp"
echo "  sudo ufw reload"
echo ""
echo "For firewalld (CentOS/RHEL):"
echo "  sudo firewall-cmd --permanent --add-port=$PORT/tcp"
echo "  sudo firewall-cmd --reload"
echo ""
echo "For cloud providers (AWS, DigitalOcean, etc.):"
echo "  - Add inbound rule for TCP port $PORT in security groups/firewall"
echo ""

read -p "Have you configured your firewall? (y/n): " FIREWALL_OK
if [ "$FIREWALL_OK" != "y" ]; then
    echo "⚠️  Please configure your firewall before continuing"
    exit 1
fi

echo ""

# Start the server
if [ "$USE_PM2" = true ]; then
    echo "🚀 Starting server with PM2..."
    
    # Stop existing instance if any
    pm2 delete screen-share-relay 2>/dev/null
    
    # Start server
    PORT=$PORT pm2 start server.js --name "screen-share-relay"
    
    if [ $? -eq 0 ]; then
        echo "✅ Server started successfully!"
        echo ""
        
        # Save PM2 configuration
        pm2 save
        
        # Set up PM2 to start on boot
        echo "🔧 Setting up auto-start on system boot..."
        pm2 startup
        
        echo ""
        echo "📊 Server Status:"
        pm2 status
        
        echo ""
        echo "📝 Useful PM2 Commands:"
        echo "  - View logs: pm2 logs screen-share-relay"
        echo "  - Restart: pm2 restart screen-share-relay"
        echo "  - Stop: pm2 stop screen-share-relay"
        echo "  - Status: pm2 status"
        
    else
        echo "❌ Failed to start server with PM2"
        exit 1
    fi
else
    echo "🚀 Starting server manually..."
    echo "To run in background, use: nohup npm start &"
    echo "To stop, use: pkill -f 'node server.js'"
    echo ""
    npm start
fi

echo ""
echo "✅ Deployment Complete!"
echo ""
echo "🌐 Server Information:"
echo "  - WebSocket URL: ws://YOUR_SERVER_IP:$PORT"
echo "  - Health Check: http://YOUR_SERVER_IP:$PORT/health"
echo ""
echo "📱 Client Configuration:"
echo "  1. Open Shortcut Launcher"
echo "  2. Click 📺 Screen Share button"
echo "  3. Enter: ws://YOUR_SERVER_IP:$PORT"
echo "  4. Enter your username"
echo "  5. Click Connect"
echo ""
echo "🔒 Security Recommendations:"
echo "  - Use HTTPS/WSS in production"
echo "  - Add authentication layer"
echo "  - Use firewall rules to restrict access"
echo "  - Monitor server logs regularly"
echo ""

# Get server IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null)
if [ ! -z "$SERVER_IP" ]; then
    echo "🌍 Your Server IP: $SERVER_IP"
    echo "   WebSocket URL: ws://$SERVER_IP:$PORT"
    echo ""
fi

echo "Done! 🎉"

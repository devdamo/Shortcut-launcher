# Screen Share Relay Server

WebRTC signaling server for the Shortcut Launcher screen sharing feature.

## Setup

1. Install dependencies:
```bash
cd relay-server
npm install
```

2. Start the server:
```bash
npm start
```

The server will run on port 9090 by default.

## Configuration

- **Port**: Set via `PORT` environment variable (default: 9090)
- **Host**: Server listens on `0.0.0.0` (all interfaces)

## Endpoints

- **WebSocket**: `ws://YOUR_SERVER_IP:9090` - Main signaling connection
- **Health Check**: `http://YOUR_SERVER_IP:9090/health` - Server status

## Running on a VPS/Cloud Server

1. Install Node.js 16+ on your server
2. Upload the `relay-server` folder
3. Run `npm install`
4. Start with `npm start` or use a process manager like PM2:
```bash
npm install -g pm2
pm2 start server.js --name "screen-share-relay"
pm2 save
pm2 startup
```

## Firewall Configuration

Make sure port 9090 is open:
- TCP port 9090 for WebSocket connections
- Allow inbound connections from your client IPs

## Security Considerations

This is a basic relay server. For production use, consider:
- Adding authentication/authorization
- Using WSS (WebSocket Secure) with SSL/TLS
- Rate limiting connections
- IP whitelisting
- Monitoring and logging

const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const PORT = process.env.PORT || 9090;

// Create Express app for health checks
const app = express();
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    clients: clients.size,
    timestamp: new Date().toISOString()
  });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients with their metadata
const clients = new Map();

console.log(`🚀 Screen Share Relay Server starting...`);

wss.on('connection', (ws) => {
  const clientId = generateId();
  console.log(`✅ New connection: ${clientId}`);
  
  // Initialize client data
  clients.set(clientId, {
    ws,
    username: 'Anonymous',
    isSharing: false,
    connectedAt: new Date()
  });
  
  // Send client their ID
  send(ws, {
    type: 'connected',
    clientId,
    message: 'Connected to relay server'
  });
  
  // Broadcast updated user list
  broadcastUserList();
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(clientId, message);
    } catch (error) {
      console.error(`❌ Error parsing message from ${clientId}:`, error);
    }
  });
  
  ws.on('close', () => {
    console.log(`🔌 Client disconnected: ${clientId}`);
    clients.delete(clientId);
    broadcastUserList();
  });
  
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${clientId}:`, error);
    clients.delete(clientId);
    broadcastUserList();
  });
});

function handleMessage(senderId, message) {
  const client = clients.get(senderId);
  if (!client) return;
  
  switch (message.type) {
    case 'set-username':
      // Update username
      client.username = message.username || 'Anonymous';
      console.log(`📝 ${senderId} set username to: ${client.username}`);
      broadcastUserList();
      break;
      
    case 'start-sharing':
      // User started sharing their screen
      client.isSharing = true;
      console.log(`📺 ${client.username} (${senderId}) started sharing`);
      broadcastUserList();
      break;
      
    case 'stop-sharing':
      // User stopped sharing
      client.isSharing = false;
      console.log(`🛑 ${client.username} (${senderId}) stopped sharing`);
      broadcastUserList();
      break;
      
    case 'request-stream':
      // Client wants to view someone's stream
      const targetId = message.targetId;
      const target = clients.get(targetId);
      
      if (target && target.isSharing) {
        // Forward request to the sharing client
        send(target.ws, {
          type: 'stream-request',
          viewerId: senderId,
          viewerUsername: client.username
        });
        console.log(`👁️ ${client.username} requested stream from ${target.username}`);
      }
      break;
      
    case 'offer':
    case 'answer':
    case 'ice-candidate':
      // WebRTC signaling messages - forward to target peer
      const recipientId = message.targetId;
      const recipient = clients.get(recipientId);
      
      if (recipient) {
        send(recipient.ws, {
          ...message,
          senderId
        });
      }
      break;
      
    default:
      console.warn(`⚠️ Unknown message type: ${message.type}`);
  }
}

function broadcastUserList() {
  const userList = Array.from(clients.entries()).map(([id, data]) => ({
    id,
    username: data.username,
    isSharing: data.isSharing,
    connectedAt: data.connectedAt
  }));
  
  const message = {
    type: 'user-list',
    users: userList
  };
  
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      send(client.ws, message);
    }
  });
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Relay server running on port ${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`\n🎮 Ready to accept connections!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔴 SIGTERM received, shutting down gracefully...');
  wss.close(() => {
    server.close(() => {
      console.log('✅ Server shut down');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('\n🔴 SIGINT received, shutting down gracefully...');
  wss.close(() => {
    server.close(() => {
      console.log('✅ Server shut down');
      process.exit(0);
    });
  });
});

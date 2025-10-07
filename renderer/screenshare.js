// Screen Share Manager
class ScreenShareManager {
    constructor() {
        this.ws = null;
        this.clientId = null;
        this.username = '';
        this.isConnected = false;
        this.isSharing = false;
        this.localStream = null;
        this.peerConnections = new Map(); // Map of viewerId -> RTCPeerConnection
        this.users = [];
        
        // WebRTC configuration
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ]
        };
        
        // Load saved settings
        this.loadSettings();
        
        // Set up event listeners
        this.setupEventListeners();
        
        console.log('📺 Screen Share Manager initialized');
    }
    
    loadSettings() {
        try {
            const savedServer = localStorage.getItem('screenshare_server');
            const savedUsername = localStorage.getItem('screenshare_username');
            
            if (savedServer) {
                document.getElementById('server-url').value = savedServer;
            }
            if (savedUsername) {
                document.getElementById('username').value = savedUsername;
                this.username = savedUsername;
            }
        } catch (error) {
            console.error('Error loading screen share settings:', error);
        }
    }
    
    saveSettings() {
        try {
            const serverUrl = document.getElementById('server-url').value;
            const username = document.getElementById('username').value;
            
            if (serverUrl) localStorage.setItem('screenshare_server', serverUrl);
            if (username) localStorage.setItem('screenshare_username', username);
        } catch (error) {
            console.error('Error saving screen share settings:', error);
        }
    }
    
    setupEventListeners() {
        // Connect/Disconnect buttons
        document.getElementById('connect-btn').addEventListener('click', () => this.connect());
        document.getElementById('disconnect-btn').addEventListener('click', () => this.disconnect());
        
        // Share buttons
        document.getElementById('start-share-btn').addEventListener('click', () => this.startSharing());
        document.getElementById('stop-share-btn').addEventListener('click', () => this.stopSharing());
        
        // Video player close
        document.getElementById('close-video-btn').addEventListener('click', () => this.closeVideoPlayer());
        
        // Auto-hide video controls
        this.setupVideoControls();
    }
    
    setupVideoControls() {
        const videoPlayer = document.getElementById('video-player');
        const videoControls = document.getElementById('video-controls');
        let hideTimeout;
        
        const showControls = () => {
            videoControls.style.opacity = '1';
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(() => {
                videoControls.style.opacity = '0';
            }, 3000);
        };
        
        videoPlayer.addEventListener('mousemove', showControls);
        videoPlayer.addEventListener('mouseenter', showControls);
        
        // Show controls initially
        showControls();
    }
    
    async connect() {
        const serverUrl = document.getElementById('server-url').value.trim();
        const username = document.getElementById('username').value.trim();
        
        if (!serverUrl) {
            alert('Please enter a relay server URL');
            return;
        }
        
        if (!username) {
            alert('Please enter a username');
            return;
        }
        
        try {
            this.username = username;
            this.saveSettings();
            
            // Connect to WebSocket server
            this.ws = new WebSocket(serverUrl);
            
            this.ws.onopen = () => {
                console.log('✅ Connected to relay server');
                this.isConnected = true;
                this.updateConnectionUI();
            };
            
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                this.handleServerMessage(message);
            };
            
            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                alert('Failed to connect to relay server. Check the URL and try again.');
                this.disconnect();
            };
            
            this.ws.onclose = () => {
                console.log('🔌 Disconnected from relay server');
                this.isConnected = false;
                this.updateConnectionUI();
                this.cleanup();
            };
            
        } catch (error) {
            console.error('Connection error:', error);
            alert('Connection error: ' + error.message);
        }
    }
    
    disconnect() {
        if (this.isSharing) {
            this.stopSharing();
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
        this.clientId = null;
        this.users = [];
        
        this.updateConnectionUI();
        this.updateUsersUI();
    }
    
    handleServerMessage(message) {
        console.log('📨 Server message:', message.type);
        
        switch (message.type) {
            case 'connected':
                this.clientId = message.clientId;
                this.sendMessage({
                    type: 'set-username',
                    username: this.username
                });
                console.log(`✅ Assigned client ID: ${this.clientId}`);
                break;
                
            case 'user-list':
                this.users = message.users;
                this.updateUsersUI();
                break;
                
            case 'stream-request':
                // Someone wants to view our stream
                this.handleStreamRequest(message.viewerId, message.viewerUsername);
                break;
                
            case 'offer':
                // Received WebRTC offer (we are the viewer)
                this.handleOffer(message.senderId, message.offer);
                break;
                
            case 'answer':
                // Received WebRTC answer (we are the sharer)
                this.handleAnswer(message.senderId, message.answer);
                break;
                
            case 'ice-candidate':
                // Received ICE candidate
                this.handleIceCandidate(message.senderId, message.candidate);
                break;
        }
    }
    
    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }
    
    updateConnectionUI() {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');
        const connectBtn = document.getElementById('connect-btn');
        const disconnectBtn = document.getElementById('disconnect-btn');
        const shareSection = document.getElementById('share-section');
        const usersSection = document.getElementById('users-section');
        
        if (this.isConnected) {
            indicator.className = 'indicator connected';
            text.textContent = `Connected as ${this.username}`;
            connectBtn.style.display = 'none';
            disconnectBtn.style.display = 'inline-block';
            shareSection.style.display = 'block';
            usersSection.style.display = 'block';
        } else {
            indicator.className = 'indicator disconnected';
            text.textContent = 'Disconnected';
            connectBtn.style.display = 'inline-block';
            disconnectBtn.style.display = 'none';
            shareSection.style.display = 'none';
            usersSection.style.display = 'none';
        }
    }
    
    updateUsersUI() {
        const usersList = document.getElementById('users-list');
        if (!usersList) return;
        
        // Filter out ourselves
        const otherUsers = this.users.filter(u => u.id !== this.clientId);
        
        if (otherUsers.length === 0) {
            usersList.innerHTML = '<p style="color: #999;">No other users connected</p>';
            return;
        }
        
        let html = '';
        otherUsers.forEach(user => {
            const sharingBadge = user.isSharing ? '<span class="sharing-badge">📺 Sharing</span>' : '';
            const viewButton = user.isSharing ? 
                `<button class="view-btn" onclick="screenShareManager.viewUser('${user.id}', '${user.username}')">View</button>` : '';
            
            html += `
                <div class="user-item">
                    <div class="user-info">
                        <strong>${this.escapeHtml(user.username)}</strong>
                        ${sharingBadge}
                    </div>
                    ${viewButton}
                </div>
            `;
        });
        
        usersList.innerHTML = html;
    }
    
    async startSharing() {
        try {
            console.log('🎥 Starting screen share...');
            
            // Request screen capture with audio
            this.localStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    displaySurface: 'monitor'
                },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            
            console.log('✅ Screen capture started');
            
            // Notify server we're sharing
            this.sendMessage({
                type: 'start-sharing'
            });
            
            this.isSharing = true;
            this.updateShareUI();
            
            // Handle when user stops sharing via browser UI
            this.localStream.getVideoTracks()[0].onended = () => {
                console.log('Screen sharing stopped by user');
                this.stopSharing();
            };
            
        } catch (error) {
            console.error('❌ Error starting screen share:', error);
            alert('Failed to start screen sharing: ' + error.message);
        }
    }
    
    stopSharing() {
        console.log('🛑 Stopping screen share...');
        
        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        // Close all peer connections
        this.peerConnections.forEach((pc, viewerId) => {
            pc.close();
        });
        this.peerConnections.clear();
        
        // Notify server
        if (this.isConnected) {
            this.sendMessage({
                type: 'stop-sharing'
            });
        }
        
        this.isSharing = false;
        this.updateShareUI();
    }
    
    updateShareUI() {
        const indicator = document.getElementById('share-indicator');
        const text = document.getElementById('share-text');
        const startBtn = document.getElementById('start-share-btn');
        const stopBtn = document.getElementById('stop-share-btn');
        
        if (this.isSharing) {
            indicator.className = 'indicator sharing';
            text.textContent = 'Sharing your screen';
            startBtn.style.display = 'none';
            stopBtn.style.display = 'inline-block';
        } else {
            indicator.className = 'indicator';
            text.textContent = 'Not sharing';
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
        }
    }
    
    async handleStreamRequest(viewerId, viewerUsername) {
        console.log(`👁️ ${viewerUsername} requested to view stream`);
        
        if (!this.isSharing || !this.localStream) {
            console.warn('Not sharing or no local stream available');
            return;
        }
        
        try {
            // Create peer connection for this viewer
            const pc = new RTCPeerConnection(this.rtcConfig);
            this.peerConnections.set(viewerId, pc);
            
            // Add local stream tracks to peer connection
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
            
            // Handle ICE candidates
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendMessage({
                        type: 'ice-candidate',
                        targetId: viewerId,
                        candidate: event.candidate
                    });
                }
            };
            
            // Create and send offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            this.sendMessage({
                type: 'offer',
                targetId: viewerId,
                offer: offer
            });
            
            console.log(`✅ Sent offer to ${viewerUsername}`);
            
        } catch (error) {
            console.error('Error handling stream request:', error);
        }
    }
    
    async handleOffer(senderId, offer) {
        console.log(`📨 Received offer from ${senderId}`);
        
        try {
            // Create peer connection for the sharer
            const pc = new RTCPeerConnection(this.rtcConfig);
            this.peerConnections.set(senderId, pc);
            
            // Handle incoming stream
            pc.ontrack = (event) => {
                console.log('📺 Receiving remote stream');
                const remoteVideo = document.getElementById('remote-video');
                remoteVideo.srcObject = event.streams[0];
            };
            
            // Handle ICE candidates
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendMessage({
                        type: 'ice-candidate',
                        targetId: senderId,
                        candidate: event.candidate
                    });
                }
            };
            
            // Set remote description and create answer
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            this.sendMessage({
                type: 'answer',
                targetId: senderId,
                answer: answer
            });
            
            console.log('✅ Sent answer');
            
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }
    
    async handleAnswer(senderId, answer) {
        console.log(`📨 Received answer from ${senderId}`);
        
        const pc = this.peerConnections.get(senderId);
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
                console.log('✅ Set remote description');
            } catch (error) {
                console.error('Error handling answer:', error);
            }
        }
    }
    
    async handleIceCandidate(senderId, candidate) {
        const pc = this.peerConnections.get(senderId);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        }
    }
    
    viewUser(userId, username) {
        console.log(`👁️ Requesting to view ${username}'s stream`);
        
        // Show video player
        document.getElementById('video-player').style.display = 'block';
        document.getElementById('viewing-username').textContent = username;
        
        // Request stream from server
        this.sendMessage({
            type: 'request-stream',
            targetId: userId
        });
    }
    
    closeVideoPlayer() {
        const videoPlayer = document.getElementById('video-player');
        const remoteVideo = document.getElementById('remote-video');
        
        // Stop video
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
        
        // Close peer connections (as viewer)
        this.peerConnections.forEach((pc, peerId) => {
            pc.close();
        });
        this.peerConnections.clear();
        
        videoPlayer.style.display = 'none';
    }
    
    cleanup() {
        // Clean up everything
        if (this.isSharing) {
            this.stopSharing();
        }
        
        this.closeVideoPlayer();
        this.users = [];
        this.updateUsersUI();
    }
    
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
}

// Initialize screen share manager when DOM is ready
let screenShareManager;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        screenShareManager = new ScreenShareManager();
    });
} else {
    screenShareManager = new ScreenShareManager();
}

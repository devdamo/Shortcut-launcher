// Direct P2P Screen Share Manager with Connection Codes (like Discord)
// NO RELAY SERVER NEEDED!

class ScreenShareManager {
    constructor() {
        this.peer = null;
        this.myCode = null;
        this.isConnected = false;
        this.isSharing = false;
        this.localStream = null;
        this.activeCall = null; // Current P2P call
        this.activeConnection = null; // Data connection for signaling

        // Load saved settings
        this.loadSettings();

        // Set up event listeners
        this.setupEventListeners();

        console.log('📺 Direct P2P Screen Share Manager initialized');
    }

    loadSettings() {
        try {
            const savedUsername = localStorage.getItem('screenshare_username');
            if (savedUsername) {
                document.getElementById('username').value = savedUsername;
            }
        } catch (error) {
            console.error('Error loading screen share settings:', error);
        }
    }

    saveSettings() {
        try {
            const username = document.getElementById('username').value;
            if (username) localStorage.setItem('screenshare_username', username);
        } catch (error) {
            console.error('Error saving screen share settings:', error);
        }
    }

    setupEventListeners() {
        // Generate Code button
        document.getElementById('connect-btn').addEventListener('click', () => this.generateCode());

        // Join with Code button
        document.getElementById('join-code-btn').addEventListener('click', () => this.connectToCode());

        // Disconnect button
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

    generateCode() {
        const username = document.getElementById('username').value.trim();

        if (!username) {
            alert('Please enter a username');
            return;
        }

        this.saveSettings();

        // Generate a random 6-character code
        this.myCode = this.generateRandomCode(6);

        console.log(`🔑 Your connection code: ${this.myCode}`);

        // Initialize PeerJS with the code as ID (using public PeerJS server)
        this.peer = new Peer(this.myCode, {
            debug: 2, // Enable debug logs
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });

        this.peer.on('open', (id) => {
            console.log(`✅ Connected with code: ${id}`);
            this.isConnected = true;
            this.updateConnectionUI();

            // Show the code to the user
            this.showConnectionCode();
        });

        this.peer.on('error', (error) => {
            console.error('❌ PeerJS error:', error);
            if (error.type === 'unavailable-id') {
                alert('Code already in use. Please try again to get a new code.');
                this.disconnect();
            } else {
                alert('Connection error: ' + error.message);
            }
        });

        // Handle incoming calls (someone wants to view our screen)
        this.peer.on('call', (call) => {
            console.log('📞 Incoming call from viewer');

            if (!this.isSharing || !this.localStream) {
                console.warn('Not sharing, rejecting call');
                call.close();
                return;
            }

            // Answer with our screen stream
            call.answer(this.localStream);
            console.log('✅ Answered call with screen stream');

            this.activeCall = call;
        });

        // Handle incoming data connections
        this.peer.on('connection', (conn) => {
            console.log('📡 Incoming data connection');

            conn.on('open', () => {
                console.log('✅ Data connection opened');
                this.activeConnection = conn;

                // Send our info
                conn.send({
                    type: 'info',
                    username: username,
                    isSharing: this.isSharing
                });
            });

            conn.on('data', (data) => {
                this.handlePeerData(data);
            });

            conn.on('close', () => {
                console.log('❌ Data connection closed');
                this.activeConnection = null;
            });
        });

        this.peer.on('disconnected', () => {
            console.log('🔌 Disconnected from PeerJS server');
            this.isConnected = false;
            this.updateConnectionUI();
        });

        this.peer.on('close', () => {
            console.log('🔴 Peer connection closed');
            this.cleanup();
        });
    }

    generateRandomCode(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < length; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    showConnectionCode() {
        // Update the server URL field to show the connection code
        const serverUrlField = document.getElementById('server-url');
        const usernameField = document.getElementById('username');

        // Hide username field, show code
        usernameField.disabled = true;
        serverUrlField.value = this.myCode;
        serverUrlField.placeholder = 'Your Connection Code (Share this!)';
        serverUrlField.readOnly = true;
        serverUrlField.style.fontSize = '24px';
        serverUrlField.style.fontWeight = 'bold';
        serverUrlField.style.textAlign = 'center';
        serverUrlField.style.letterSpacing = '3px';

        // Add copy button functionality
        serverUrlField.addEventListener('click', () => {
            serverUrlField.select();
            document.execCommand('copy');
            alert(`Connection code copied: ${this.myCode}\n\nShare this code with someone to let them view your screen!`);
        });
    }

    async connectToCode() {
        const code = prompt('Enter the connection code:');
        if (!code) return;

        const username = document.getElementById('username').value.trim();
        if (!username) {
            alert('Please enter a username first');
            return;
        }

        this.saveSettings();

        console.log(`🔗 Connecting to code: ${code}`);

        // Initialize our own peer
        if (!this.peer || this.peer.destroyed) {
            const myRandomId = 'viewer_' + this.generateRandomCode(8);
            this.peer = new Peer(myRandomId, {
                debug: 2,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' }
                    ]
                }
            });

            await new Promise((resolve) => {
                this.peer.on('open', () => {
                    console.log('✅ Viewer peer initialized');
                    resolve();
                });
            });
        }

        // Establish data connection
        const conn = this.peer.connect(code);

        conn.on('open', () => {
            console.log('✅ Connected to sharer');
            this.activeConnection = conn;

            // Send our info
            conn.send({
                type: 'info',
                username: username,
                isViewer: true
            });

            // Request their stream
            console.log('📞 Calling for stream...');
            const call = this.peer.call(code, new MediaStream()); // Empty stream as placeholder

            call.on('stream', (remoteStream) => {
                console.log('📺 Receiving remote stream');

                // Show video player
                document.getElementById('video-player').style.display = 'block';
                document.getElementById('viewing-username').textContent = 'Remote Screen';

                const remoteVideo = document.getElementById('remote-video');
                remoteVideo.srcObject = remoteStream;
                remoteVideo.play().catch(e => console.error('Error playing video:', e));

                this.activeCall = call;
            });

            call.on('close', () => {
                console.log('❌ Call closed');
                this.closeVideoPlayer();
            });
        });

        conn.on('error', (error) => {
            console.error('❌ Connection error:', error);
            alert('Failed to connect. Make sure the code is correct and the other person is online.');
        });

        conn.on('data', (data) => {
            this.handlePeerData(data);
        });
    }

    handlePeerData(data) {
        console.log('📨 Received data:', data);

        if (data.type === 'info') {
            console.log(`ℹ️ Peer info: ${data.username}, Sharing: ${data.isSharing}`);
        }
    }

    disconnect() {
        if (this.isSharing) {
            this.stopSharing();
        }

        if (this.activeCall) {
            this.activeCall.close();
            this.activeCall = null;
        }

        if (this.activeConnection) {
            this.activeConnection.close();
            this.activeConnection = null;
        }

        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }

        this.isConnected = false;
        this.myCode = null;

        // Reset UI
        const serverUrlField = document.getElementById('server-url');
        const usernameField = document.getElementById('username');
        serverUrlField.value = '';
        serverUrlField.placeholder = 'ws://your-server.com:9090';
        serverUrlField.readOnly = false;
        serverUrlField.style.fontSize = '';
        serverUrlField.style.fontWeight = '';
        serverUrlField.style.textAlign = '';
        serverUrlField.style.letterSpacing = '';
        usernameField.disabled = false;

        this.updateConnectionUI();
        this.closeVideoPlayer();
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
            text.textContent = `Connected - Code: ${this.myCode}`;
            connectBtn.style.display = 'none';
            disconnectBtn.style.display = 'inline-block';
            shareSection.style.display = 'block';
            usersSection.style.display = 'none'; // Not needed for P2P
        } else {
            indicator.className = 'indicator disconnected';
            text.textContent = 'Disconnected';
            connectBtn.style.display = 'inline-block';
            disconnectBtn.style.display = 'none';
            shareSection.style.display = 'none';
            usersSection.style.display = 'none';
        }
    }

    async startSharing() {
        try {
            console.log('🎥 Starting screen share...');

            // Check if Electron API is available
            if (!window.electronAPI || !window.electronAPI.getDesktopSources) {
                throw new Error('Screen capture not supported in this environment');
            }

            // Get available sources from Electron
            const sources = await window.electronAPI.getDesktopSources();

            if (!sources || sources.length === 0) {
                throw new Error('No screen sources available');
            }

            console.log(`📺 Found ${sources.length} sources`);

            // Prefer screens over windows
            const primaryScreen = sources.find(source => source.id.startsWith('screen')) || sources[0];
            console.log(`📺 Selected: ${primaryScreen.name}`);

            // Capture screen with HIGH QUALITY settings for live streaming
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: primaryScreen.id,
                        minWidth: 1920,
                        maxWidth: 1920,
                        minHeight: 1080,
                        maxHeight: 1080,
                        frameRate: { ideal: 60, max: 60 } // 60 FPS for smooth streaming
                    }
                }
            });

            console.log('✅ Screen captured successfully (High Quality 60FPS)');
            this.localStream = stream;
            this.isSharing = true;
            this.updateShareUI();

            // Notify peer if connected
            if (this.activeConnection) {
                this.activeConnection.send({
                    type: 'sharing-started'
                });
            }

            // Handle when user stops sharing
            this.localStream.getVideoTracks()[0].onended = () => {
                console.log('Screen sharing stopped by user');
                this.stopSharing();
            };

            alert(`✅ Screen sharing started!\n\nYour code: ${this.myCode}\n\nShare this code with someone to let them view your screen.`);

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

        // Close call if active
        if (this.activeCall) {
            this.activeCall.close();
            this.activeCall = null;
        }

        // Notify peer if connected
        if (this.activeConnection) {
            this.activeConnection.send({
                type: 'sharing-stopped'
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

    closeVideoPlayer() {
        const videoPlayer = document.getElementById('video-player');
        const remoteVideo = document.getElementById('remote-video');

        // Stop video
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }

        // Close call
        if (this.activeCall) {
            this.activeCall.close();
            this.activeCall = null;
        }

        videoPlayer.style.display = 'none';
    }

    cleanup() {
        if (this.isSharing) {
            this.stopSharing();
        }

        this.closeVideoPlayer();
        this.isConnected = false;
        this.myCode = null;
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

# Shortcut Launcher - Quick Start Guide

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the application:
```bash
npm start
```

## Features

### 1. Shortcuts Management
- Click **+** button to add shortcuts (software or websites)
- Click shortcuts to launch them
- Resizable shortcuts (drag bottom-right corner)
- Auto-saves positions and sizes
- Missing software detection

### 2. Admin Panel
- **Window Settings**: Wallpaper mode (stays behind other windows)
- **Background Settings**: Solid, gradient, or image backgrounds
- **PC Information**: View system details
- **Database Status**: Connection and sync status
- **Shortcuts Management**: View all saved shortcuts

### 3. Screen Sharing ✨ NEW!
- Share your screen and audio with others
- View other users' screens in real-time
- High-quality WebRTC streaming
- YouTube-style video player with auto-hiding controls

#### Screen Sharing Setup:
1. Set up the relay server (see `SCREENSHARE_GUIDE.md`)
2. Click **📺 Screen Share** button
3. Enter relay server URL and username
4. Click **Connect**
5. Start sharing or view others!

### 4. RustDesk Integration
- One-click RustDesk installation
- Remote desktop access

## Keyboard Shortcuts

- **Ctrl+Q**: Emergency close application
- **Ctrl+A**: Add new shortcut
- **Alt+A**: Open admin panel
- **Esc**: Close modals
- **Arrow Keys**: Navigate shortcuts
- **Enter**: Launch focused shortcut
- **Tab/Shift+Tab**: Cycle through shortcuts

## Database

The app uses MySQL for syncing shortcuts across devices:
- Host: Configured in `src/main.js`
- Auto-creates tables for each PC
- Syncs shortcuts, positions, sizes, and settings

## File Structure

```
Shortcut-launcher/
├── src/
│   └── main.js              # Electron main process
├── renderer/
│   ├── index.html           # UI layout
│   ├── app.js               # Main application logic
│   ├── screenshare.js       # Screen sharing manager
│   └── styles.css           # Styling
├── relay-server/            # WebRTC signaling server
│   ├── server.js
│   ├── package.json
│   └── README.md
├── preload.js               # Electron preload script
├── package.json             # App dependencies
├── SCREENSHARE_GUIDE.md     # Detailed screen share docs
└── README.md                # This file
```

## Development

Run in development mode:
```bash
npm run dev
```

This enables:
- DevTools
- Hot reload (restart to see changes)
- Console logging

## Building

Build for production:
```bash
npm run build
```

Creates distributable packages in `dist/` folder.

## Configuration

### Database Connection
Edit `src/main.js` to change database settings:
```javascript
dbConnection = await mysql.createConnection({
  host: 'YOUR_HOST',
  port: YOUR_PORT,
  user: 'YOUR_USER',
  password: 'YOUR_PASSWORD',
  database: 'YOUR_DATABASE'
});
```

### Screen Share Relay
See `relay-server/README.md` for server setup and configuration.

## Troubleshooting

### App won't close
- Use **Ctrl+Q** (emergency close)
- Double-click the **×** button (force close)

### Database connection fails
- App continues in offline mode
- Shortcuts won't be saved
- Click "Retry Connection" in admin panel

### Screen sharing not working
- Check relay server is running
- Verify WebSocket URL format: `ws://server:port`
- Check firewall settings
- See `SCREENSHARE_GUIDE.md` for detailed troubleshooting

### Wallpaper mode not working
- Try toggling it off and on
- Restart the application
- Check admin panel for status

## Support & Issues

For detailed screen sharing setup and troubleshooting, see `SCREENSHARE_GUIDE.md`.

For relay server setup, see `relay-server/README.md`.

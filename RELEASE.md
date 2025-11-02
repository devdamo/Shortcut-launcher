# Release Guide for Shortcut Launcher

This guide explains how to publish builds to GitHub and create releases.

## Prerequisites

1. **GitHub Repository**
   - Create a repository on GitHub for this project
   - Update `package.json` with your repository info:
     ```json
     "repository": {
       "type": "git",
       "url": "https://github.com/YOUR_USERNAME/shortcut-launcher.git"
     }
     ```
   - Update the `publish.owner` field in `package.json` to your GitHub username

2. **GitHub Token**
   - For local publishing, create a GitHub Personal Access Token:
     - Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
     - Click "Generate new token (classic)"
     - Select scopes: `repo` (full control of private repositories)
     - Copy the token
   - Set environment variable:
     ```bash
     # Windows (PowerShell)
     $env:GH_TOKEN="your_token_here"

     # Windows (CMD)
     set GH_TOKEN=your_token_here

     # Linux/Mac
     export GH_TOKEN=your_token_here
     ```

3. **Application Icons**
   - Add icons to the `assets/` folder:
     - `icon.ico` (Windows)
     - `icon.png` (Linux)
     - `icon.icns` (macOS)
   - See `assets/README.md` for icon requirements and creation tips

## Building Locally

### Build for Current Platform
```bash
npm run build
```

### Build for Specific Platform
```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux

# All platforms (requires running on macOS)
npm run build:all
```

Output files will be in the `dist/` folder.

## Publishing Releases

### Method 1: Automated GitHub Actions (Recommended)

This is the easiest method - builds happen automatically in the cloud!

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Prepare for release"
   git push
   ```

2. **Create a version tag**
   ```bash
   # Update version in package.json first (e.g., to 1.0.1)
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. **GitHub Actions will automatically:**
   - Build for Windows, macOS, and Linux
   - Create a GitHub Release
   - Upload all build artifacts
   - Generate release notes

4. **Check your release**
   - Go to your GitHub repository
   - Click "Releases" on the right sidebar
   - Your release should appear with all the build files

### Method 2: Manual Local Publishing

If you prefer to build and publish from your local machine:

1. **Set up GitHub token** (see Prerequisites above)

2. **Update version** in `package.json`:
   ```json
   {
     "version": "1.0.1"
   }
   ```

3. **Commit version change**
   ```bash
   git add package.json
   git commit -m "Bump version to 1.0.1"
   git push
   ```

4. **Create and push tag**
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

5. **Build and publish**
   ```bash
   # Publish for Windows
   npm run publish:win

   # Or publish for all platforms
   npm run publish
   ```

6. **electron-builder will:**
   - Build the application
   - Create a GitHub Release
   - Upload the build artifacts

## Version Management

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR.MINOR.PATCH** (e.g., 1.2.3)
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

Update version in `package.json`:
```json
{
  "version": "1.2.3"
}
```

## Build Outputs

### Windows
- `Shortcut Launcher Setup x.x.x.exe` - NSIS installer
- `Shortcut Launcher x.x.x.exe` - Portable executable
- `latest.yml` - Auto-update metadata

### Linux
- `shortcut-launcher-x.x.x.AppImage` - AppImage (portable)
- `shortcut-launcher_x.x.x_amd64.deb` - Debian package
- `latest-linux.yml` - Auto-update metadata

### macOS
- `Shortcut Launcher-x.x.x.dmg` - DMG installer
- `Shortcut Launcher-x.x.x-mac.zip` - ZIP archive
- `latest-mac.yml` - Auto-update metadata

## Troubleshooting

### Build fails with "icon not found"
- Make sure icons exist in the `assets/` folder
- Check icon file names match those in `package.json`
- See `assets/README.md` for icon creation help

### GitHub publish fails with 401 error
- Verify your `GH_TOKEN` environment variable is set
- Make sure the token has `repo` scope
- Check that the repository URL in `package.json` is correct

### Build works locally but fails in GitHub Actions
- Check that all files are committed and pushed
- Verify GitHub Actions has permission to create releases
- Check the Actions tab for detailed error logs

### macOS build fails on Windows/Linux
- macOS builds require running on macOS
- Use GitHub Actions for cross-platform builds
- Or only build for your current platform

## GitHub Actions Workflow

The workflow (`.github/workflows/build-release.yml`) is triggered by:
- **Tags**: Creating a tag like `v1.0.0` triggers a full build and release
- **Push to main/master**: Builds artifacts but doesn't create a release
- **Pull requests**: Builds to verify changes work
- **Manual**: Can be triggered manually from GitHub Actions tab

## Quick Release Checklist

- [ ] Update version in `package.json`
- [ ] Commit changes: `git commit -am "Release v1.0.x"`
- [ ] Push to GitHub: `git push`
- [ ] Create tag: `git tag v1.0.x`
- [ ] Push tag: `git push origin v1.0.x`
- [ ] Wait for GitHub Actions to complete
- [ ] Check GitHub Releases page
- [ ] Download and test installers
- [ ] Announce release!

## Distribution

After publishing:
1. Share the GitHub Release URL with users
2. Users can download the installer for their platform
3. Windows users can run the `.exe` installer or use portable version
4. Linux users can run the `.AppImage` or install the `.deb` package
5. macOS users can mount the `.dmg` and drag to Applications

## Auto-Updates (Future Enhancement)

The build configuration includes auto-update metadata files. To enable auto-updates:
1. Implement update checking in the app
2. Use `electron-updater` package
3. App will automatically check for new releases on GitHub

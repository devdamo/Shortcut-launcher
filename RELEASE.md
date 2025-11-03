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

All build commands create installers **without publishing** to GitHub (uses `--publish never`).

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

**Note:** These commands only build - they don't publish to GitHub. Use `npm run publish` to build AND publish.

## Publishing Releases

### Method 1: Automated GitHub Actions (Recommended)

This is the easiest method - builds happen automatically in the cloud!

**First-time setup:**
1. **Update `package.json`** - Replace `YOUR_USERNAME` with your actual GitHub username:
   - Line 8: `"url": "https://github.com/YOUR_USERNAME/shortcut-launcher.git"`
   - Line 65: `"owner": "YOUR_USERNAME"`
2. **Create the repository** on GitHub with the name `shortcut-launcher`
3. **Push your code** to the repository

**To create a release:**

1. **Update version in `package.json`**
   ```json
   {
     "version": "1.0.0"
   }
   ```

2. **Commit and push**
   ```bash
   git add .
   git commit -m "Release v1.0.0"
   git push
   ```

3. **Create and push version tag**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

4. **GitHub Actions will automatically:**
   - Build for Windows, macOS, and Linux (without publishing)
   - Upload build artifacts
   - Create a GitHub Release with all files
   - Generate release notes

5. **Check your release**
   - Go to your GitHub repository
   - Click "Releases" on the right sidebar
   - Your release will appear with downloadable installers

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
- `Shortcut Launcher Setup x.x.x.exe` - NSIS installer (.exe)
- `Shortcut Launcher x.x.x.msi` - MSI installer (Windows Installer)
- `Shortcut Launcher x.x.x.exe` - Portable executable (no install)
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

### npm ci fails in GitHub Actions (Windows)
**Error:** `EPERM: operation not permitted` or `command failed`

**Solutions:**
1. The workflow clears npm cache before installation
2. Uses `--prefer-offline` flag to use cached packages
3. Check if node_modules is in `.gitignore` (it should be)
4. Re-run the workflow (sometimes GitHub runners have transient issues)
5. Try the simpler workflow: Actions tab → Build Simple → Run workflow

### Electron installation fails
**Error:** `electron install.js failed`

**Solutions:**
1. Workflow uses `--prefer-offline` flag to use cached packages
2. Verifies electron installation before building
3. Re-run the workflow (Electron downloads can timeout)
4. Check Actions logs for detailed error messages

### Build works locally but fails in GitHub Actions
- Check that all files are committed and pushed
- Verify GitHub Actions has permission to create releases
- Check the Actions tab for detailed error logs
- Try running the "Build Simple" workflow for debugging
- Check if `node_modules/` is properly ignored in `.gitignore`

### macOS build fails on Windows/Linux
- macOS builds require running on macOS
- Use GitHub Actions for cross-platform builds
- Or only build for your current platform

### "No artifacts found" error
- Make sure the build completes successfully
- Check that `dist/` folder contains build outputs
- Verify file patterns match your build outputs
- Build outputs are configured to fail if no files are found (catches build issues early)

### Ubuntu: "SUID sandbox helper binary" error
**Error:** `FATAL:setuid_sandbox_host.cc(158)] The SUID sandbox helper binary was found`

**This is normal and can be ignored:**
- Occurs during Electron verification step on Ubuntu
- Workflow automatically handles this with `--no-sandbox` flag
- The actual build will work fine (electron-builder handles sandbox properly)
- Just a verification warning, not a build failure

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

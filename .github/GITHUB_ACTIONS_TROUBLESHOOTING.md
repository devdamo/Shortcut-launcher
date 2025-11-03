# GitHub Actions Troubleshooting Guide

## Common Issues and Solutions

### Issue 1: npm ci fails with EPERM errors on Windows

**Symptoms:**
```
npm warn cleanup Failed to remove some directories
npm error code 3221225786
npm error path D:\a\...\node_modules\electron
npm error command failed
```

**Why this happens:**
- Windows file locking issues in GitHub Actions runners
- Electron binary download/extraction failures
- Permission issues with node_modules cleanup

**Solutions implemented in the workflow:**
1. ✅ **Prefer offline mode** - Uses cached packages when possible
2. ✅ **Windows-specific cache clearing** - Clears npm cache before installation
3. ✅ **Timeout protection** - 10-minute timeout for installation
4. ✅ **Verification step** - Checks electron installation before building

**Manual fixes:**
- Re-run the workflow (GitHub runners sometimes have transient issues)
- Use the "Build Simple" workflow (manual trigger)
- Check that `node_modules/` is in `.gitignore`

---

### Issue 2: Electron installation fails

**Symptoms:**
```
npm error command C:\Windows\system32\cmd.exe /d /s /c node install.js
```

**Solutions:**
1. Workflow verifies electron installation: `npx electron --version`
2. Uses `--prefer-offline` to avoid download issues
3. Re-run the workflow if it fails (transient download issues are common)

---

### Issue 3: Build succeeds but artifacts not uploaded

**Symptoms:**
- Build completes successfully
- No files in "Artifacts" section

**Check:**
1. Look for `dist/` folder in build logs
2. Verify files were created: `ls -la dist/`
3. Check artifact upload step didn't fail

**Solutions:**
- Workflow now uploads entire `dist/` folder
- Set to error if no files found
- 90-day retention period

---

### Issue 4: Release not created after tag push

**Checklist:**
- [ ] Tag starts with `v` (e.g., `v1.0.0`)
- [ ] Tag was pushed to GitHub: `git push origin v1.0.0`
- [ ] All build jobs completed successfully
- [ ] GitHub Actions has permission to create releases

**How to check:**
1. Go to Actions tab
2. Find the workflow run for your tag
3. Check if all jobs (Windows, Linux, macOS) succeeded
4. Check "release" job ran and succeeded

---

## Workflow Files

### Main Workflow: `build-release.yml`
- **Automatic builds** on push to main/master
- **Automatic releases** on version tags (v*)
- **Cross-platform builds** (Windows, Linux, macOS)
- **Retry logic** for installation failures
- **Artifact management** with 90-day retention

### Simple Workflow: `build-simple.yml`
- **Manual trigger only** (workflow_dispatch)
- **Single platform** builds
- **Simpler logic** for debugging
- **No external dependencies**

Use the simple workflow when:
- Main workflow keeps failing
- Need to debug installation issues
- Want to build just one platform
- Testing workflow changes

---

## How to Use Simple Workflow

1. Go to your GitHub repository
2. Click "Actions" tab
3. Click "Build Simple" in the left sidebar
4. Click "Run workflow" button
5. Select platform (Windows/Linux/macOS/all)
6. Click green "Run workflow" button
7. Wait for build to complete
8. Download artifacts from the workflow run

---

## Debugging Failed Builds

### Step 1: Check the logs
1. Go to Actions tab
2. Click on the failed workflow run
3. Click on the failed job (Windows/Linux/macOS)
4. Expand the failed step
5. Read the error message

### Step 2: Common error patterns

**Pattern:** Permission denied, EPERM
→ **Fix:** Retry workflow (it has automatic retry logic)

**Pattern:** Electron download timeout
→ **Fix:** Wait 5 minutes and retry

**Pattern:** Icon file not found
→ **Fix:** Add icons to `assets/` folder or remove icon references from `package.json`

**Pattern:** Cannot find module 'X'
→ **Fix:** Check if dependency is in `package.json`, run `npm install` locally

### Step 3: Test locally
```bash
# Test build locally first
npm ci
npm run build

# If that works, the issue is GitHub Actions-specific
# If that fails, fix local build first
```

---

## Performance Tips

### Speed up builds
1. Use npm caching (already configured)
2. Use `--prefer-offline` flag (already configured)
3. Minimize dependencies
4. Use `fail-fast: false` to build all platforms even if one fails

### Reduce Action minutes
1. Only trigger on tags for releases
2. Use manual trigger for testing
3. Build only needed platforms locally
4. Use matrix strategy to parallelize (already configured)

---

## Getting Help

### Check these first:
1. ✅ Are all files committed? `git status`
2. ✅ Is package.json valid? `npm run build` locally
3. ✅ Do icons exist? Check `assets/` folder
4. ✅ Is GitHub username correct in package.json?
5. ✅ Are you pushing tags? `git push origin --tags`

### Still stuck?
1. Check GitHub Actions logs in detail
2. Try the "Build Simple" workflow
3. Test build locally: `npm run build`
4. Check npm cache: `npm cache clean --force`
5. Review recent changes: `git log`

---

## Best Practices

### Do:
- ✅ Test builds locally before pushing
- ✅ Use semantic versioning (v1.2.3)
- ✅ Add icons before first release
- ✅ Review workflow logs after each run
- ✅ Keep dependencies updated

### Don't:
- ❌ Push directly to main without testing
- ❌ Skip version number in package.json
- ❌ Commit node_modules folder
- ❌ Use non-standard tag formats
- ❌ Ignore workflow warnings

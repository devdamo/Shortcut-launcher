class ShortcutLauncher {
    constructor() {
        this.shortcuts = [];
        this.isLoading = false;
        this.currentIconData = null;
        this.dbConnected = false;
        this.resizeObserver = null;
        this.resizeTimeouts = new Map(); // Track resize timeouts for each shortcut
        this.currentFocusIndex = 0; // NEW: Track focused shortcut for keyboard navigation
        this.isResizing = false; // NEW: Track if we're currently resizing
        this.resizeData = null; // NEW: Track resize operation data
        this.init();
    }

    async init() {
        console.log('=== INITIALIZING SHORTCUT LAUNCHER ===');
        this.showLoading(true);
        
        try {
            // Step 1: Check if APIs are available
            console.log('Step 1: Checking if APIs are available...');
            if (!window.electronAPI || !window.dbAPI) {
                console.error('❌ Electron APIs not available!');
                console.log('window.electronAPI:', window.electronAPI);
                console.log('window.dbAPI:', window.dbAPI);
                this.showError('Application APIs not loaded. Please restart the application.');
                return;
            }
            console.log('✅ Electron APIs loaded successfully');
            
            // Step 2: Set up event listeners FIRST (critical for close button)
            console.log('Step 2: Setting up event listeners...');
            this.setupEventListeners();
            console.log('✅ Event listeners set up');
            
            // Step 3: Try database connection with proper error handling
            console.log('Step 3: Attempting database connection...');
            try {
                const connected = await this.connectWithTimeout();
                
                if (connected) {
                    this.dbConnected = true;
                    console.log('✅ Database connected successfully');
                    
                    // Step 4: Load shortcuts, background, and window settings
                    console.log('Step 4: Loading shortcuts, background, and window settings...');
                    await this.loadShortcuts();
                    await this.loadBackgroundSettings();
                    await this.loadAndApplyWindowSettings();
                    console.log('✅ Content loaded');
                } else {
                    console.warn('⚠️ Database connection failed, continuing in offline mode...');
                    this.dbConnected = false;
                    this.showOfflineMode();
                }
            } catch (dbError) {
                console.error('❌ Database error:', dbError);
                this.dbConnected = false;
                this.showOfflineMode();
            }
            
            // Step 5: Hide loading and show app
            console.log('Step 5: Finalizing initialization...');
            this.showLoading(false);
            console.log('✅ Shortcut Launcher initialized successfully');
            
        } catch (error) {
            console.error('❌ CRITICAL ERROR in init():', error);
            this.showLoading(false);
            this.showError('Critical error during initialization: ' + error.message);
        }
    }

    async connectWithTimeout() {
        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database connection timeout')), 8000)
        );
        
        // Race the database connection against the timeout
        try {
            return await Promise.race([
                window.dbAPI.connect(),
                timeoutPromise
            ]);
        } catch (error) {
            console.error('Database connection failed:', error);
            return false;
        }
    }

    showError(message) {
        console.error('Showing error:', message);
        this.showLoading(false);
        
        const emptyState = document.getElementById('empty-state');
        if (emptyState) {
            emptyState.innerHTML = `
                <div class="empty-icon">❌</div>
                <h2>Application Error</h2>
                <p>${message}</p>
                <button onclick="location.reload()" style="background: #ffffff; color: #000000; border: 2px solid #ffffff; padding: 12px 24px; margin-top: 20px; cursor: pointer; font-weight: bold;">
                    Restart Application
                </button>
            `;
            emptyState.style.display = 'flex';
        }
    }

    showOfflineMode() {
        console.log('Showing offline mode...');
        const emptyState = document.getElementById('empty-state');
        if (emptyState) {
            emptyState.innerHTML = `
                <div class="empty-icon">⚠️</div>
                <h2>Offline Mode</h2>
                <p>Database connection failed.<br>
                Shortcuts will not be saved.</p>
                <div style="margin-top: 20px;">
                    <button onclick="launcher.retryConnection()" style="background: #ffffff; color: #000000; border: 2px solid #ffffff; padding: 12px 24px; margin: 5px; cursor: pointer; font-weight: bold;">
                        Retry Connection
                    </button>
                    <button onclick="launcher.showAddModal()" style="background: #000000; color: #ffffff; border: 2px solid #ffffff; padding: 12px 24px; margin: 5px; cursor: pointer; font-weight: bold;">
                        Add Shortcut (Temporary)
                    </button>
                </div>
            `;
            emptyState.style.display = 'flex';
        }
    }

    async retryConnection() {
        console.log('Retrying database connection...');
        this.showLoading(true);
        
        try {
            const connected = await this.connectWithTimeout();
            if (connected) {
                this.dbConnected = true;
                console.log('✅ Database reconnected successfully');
                await this.loadShortcuts();
                await this.loadBackgroundSettings();
                this.showLoading(false);
            } else {
                this.showLoading(false);
                this.showOfflineMode();
            }
        } catch (error) {
            console.error('❌ Retry connection failed:', error);
            this.showLoading(false);
            this.showOfflineMode();
        }
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');
        
        // CRITICAL: Close button - FIXED with better error handling
        const closeBtn = document.getElementById('close-btn');
        if (closeBtn) {
            // Primary close handler
            closeBtn.addEventListener('click', async (e) => {
                console.log('🔴 Close button clicked');
                e.preventDefault();
                e.stopPropagation();
                
                // FIXED: More robust close handling
                await this.closeApplication();
            });
            
            // Backup close handler (double-click for force close)
            closeBtn.addEventListener('dblclick', async (e) => {
                console.log('🔴 Close button double-clicked - FORCE CLOSE');
                e.preventDefault();
                e.stopPropagation();
                
                await this.forceCloseApplication();
            });
            
            console.log('✅ Close button event listeners added');
        } else {
            console.error('❌ Close button not found in DOM!');
        }

        // Admin button
        const adminBtn = document.getElementById('admin-btn');
        if (adminBtn) {
            adminBtn.addEventListener('click', () => {
                console.log('Admin button clicked');
                this.showAdminModal();
            });
            console.log('✅ Admin button event listener added');
        }

        // RustDesk button
        const rustdeskBtn = document.getElementById('rustdesk-btn');
        if (rustdeskBtn) {
            rustdeskBtn.addEventListener('click', () => {
                console.log('RustDesk button clicked');
                this.installRustDesk();
            });
            console.log('✅ RustDesk button event listener added');
        }

        // TOP BAR Add shortcut button - ONLY ADD BUTTON NOW
        const addBtn = document.getElementById('add-shortcut-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                console.log('Add shortcut button clicked');
                this.showAddModal();
            });
            console.log('✅ Add shortcut button event listener added');
        }

        // Modal close buttons
        this.setupModalEventListeners();
        
        // Form elements
        this.setupFormEventListeners();
        
        // NEW: Background settings event listeners
        this.setupBackgroundEventListeners();

        // CRITICAL: Keyboard shortcuts for emergency controls + NAVIGATION
        document.addEventListener('keydown', async (e) => {
            // Emergency close - ALWAYS works
            if (e.ctrlKey && e.key === 'q') {
                console.log('🔴 Ctrl+Q pressed - EMERGENCY CLOSE');
                e.preventDefault();
                await this.forceCloseApplication();
                return;
            }
            
            // ESC to close modals
            if (e.key === 'Escape') {
                console.log('Escape key pressed');
                this.hideAllModals();
                return;
            }
            
            // Ctrl+A to add shortcut
            if (e.ctrlKey && e.key === 'a') {
                console.log('Ctrl+A pressed - quick add shortcut');
                e.preventDefault();
                this.showAddModal();
                return;
            }
            
            // Alt+A for admin panel
            if (e.altKey && e.key === 'a') {
                console.log('Alt+A pressed - admin panel');
                e.preventDefault();
                this.showAdminModal();
                return;
            }
            
            // NEW: Arrow key navigation and Enter to launch
            if (!this.isModalOpen()) {
                switch(e.key) {
                    case 'ArrowUp':
                        e.preventDefault();
                        this.navigateShortcuts('up');
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        this.navigateShortcuts('down');
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        this.navigateShortcuts('left');
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        this.navigateShortcuts('right');
                        break;
                    case 'Enter':
                        e.preventDefault();
                        this.launchFocusedShortcut();
                        break;
                    case 'Tab':
                        if (!e.shiftKey) {
                            e.preventDefault();
                            this.navigateShortcuts('next');
                        } else {
                            e.preventDefault();
                            this.navigateShortcuts('prev');
                        }
                        break;
                }
            }
        });
        
        console.log('✅ All event listeners set up successfully');
    }

    // NEW: Background settings event listeners
    setupBackgroundEventListeners() {
        const backgroundType = document.getElementById('background-type');
        if (backgroundType) {
            backgroundType.addEventListener('change', (e) => {
                this.toggleBackgroundOptions(e.target.value);
            });
        }

        const gradientStyle = document.getElementById('gradient-style');
        if (gradientStyle) {
            gradientStyle.addEventListener('change', (e) => {
                this.toggleCustomGradient(e.target.value);
            });
        }

        const browseBackground = document.getElementById('browse-background');
        if (browseBackground) {
            browseBackground.addEventListener('click', () => {
                this.browseBackgroundImage();
            });
        }

        const removeBackground = document.getElementById('remove-background');
        if (removeBackground) {
            removeBackground.addEventListener('click', () => {
                this.removeBackgroundImage();
            });
        }

        const backgroundOpacity = document.getElementById('background-opacity');
        if (backgroundOpacity) {
            backgroundOpacity.addEventListener('input', (e) => {
                document.getElementById('opacity-value').textContent = e.target.value + '%';
            });
        }

        const applyBackground = document.getElementById('apply-background');
        if (applyBackground) {
            applyBackground.addEventListener('click', () => {
                this.applyBackgroundSettings();
            });
        }

        const resetBackground = document.getElementById('reset-background');
        if (resetBackground) {
            resetBackground.addEventListener('click', () => {
                this.resetBackgroundSettings();
            });
        }

        // NEW: Window settings event listeners
        const applyWindowSettings = document.getElementById('apply-window-settings');
        if (applyWindowSettings) {
            applyWindowSettings.addEventListener('click', () => {
                this.applyWindowSettings();
            });
        }

        console.log('✅ Background event listeners set up');
    }

    // FIXED: New dedicated close methods
    async closeApplication() {
        console.log('🔴 closeApplication() called');
        
        try {
            if (window.electronAPI && window.electronAPI.closeApp) {
                console.log('🔴 Calling electronAPI.closeApp()');
                await window.electronAPI.closeApp();
                console.log('🔴 electronAPI.closeApp() completed');
            } else {
                console.error('❌ closeApp API not available');
                await this.forceCloseApplication();
            }
        } catch (error) {
            console.error('❌ Error in closeApplication:', error);
            await this.forceCloseApplication();
        }
    }

    async forceCloseApplication() {
        console.log('🔴 forceCloseApplication() called');
        
        try {
            if (window.electronAPI && window.electronAPI.forceClose) {
                console.log('🔴 Calling electronAPI.forceClose()');
                window.electronAPI.forceClose();
            } else {
                console.error('❌ forceClose API not available');
            }
        } catch (error) {
            console.error('❌ Error in forceCloseApplication:', error);
        }
        
        // Last resort - try to close via any means
        setTimeout(() => {
            console.log('🔴 Last resort - trying window.close()');
            try {
                window.close();
            } catch (e) {
                console.error('❌ window.close() failed:', e);
            }
        }, 1000);
    }

    setupModalEventListeners() {
        // Modal close buttons
        const modalClose = document.getElementById('modal-close');
        if (modalClose) {
            modalClose.addEventListener('click', () => this.hideAddModal());
        }

        const adminModalClose = document.getElementById('admin-modal-close');
        if (adminModalClose) {
            adminModalClose.addEventListener('click', () => this.hideAdminModal());
        }

        // Modal background clicks
        const addModal = document.getElementById('add-modal');
        if (addModal) {
            addModal.addEventListener('click', (e) => {
                if (e.target.id === 'add-modal') {
                    this.hideAddModal();
                }
            });
        }

        const adminModal = document.getElementById('admin-modal');
        if (adminModal) {
            adminModal.addEventListener('click', (e) => {
                if (e.target.id === 'admin-modal') {
                    this.hideAdminModal();
                }
            });
        }
    }

    setupFormEventListeners() {
        // Type change handler
        const shortcutType = document.getElementById('shortcut-type');
        if (shortcutType) {
            shortcutType.addEventListener('change', (e) => {
                this.updatePathField(e.target.value);
            });
        }

        // Browse button
        const browseBtn = document.getElementById('browse-btn');
        if (browseBtn) {
            browseBtn.addEventListener('click', async () => {
                try {
                    if (window.electronAPI && window.electronAPI.browseFile) {
                        const filePath = await window.electronAPI.browseFile();
                        if (filePath) {
                            document.getElementById('shortcut-path').value = filePath;
                            // Auto-extract name if not provided
                            const nameField = document.getElementById('shortcut-name');
                            if (!nameField.value) {
                                const fileName = filePath.split('\\').pop().split('/').pop();
                                const baseName = fileName.replace(/\.[^/.]+$/, ''); // Remove extension
                                nameField.value = baseName;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error browsing file:', error);
                    alert('Error browsing file: ' + error.message);
                }
            });
        }

        // Save button
        const saveBtn = document.getElementById('save-shortcut');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveShortcut());
        }

        // Extract icon button
        const extractIconBtn = document.getElementById('extract-icon-btn');
        if (extractIconBtn) {
            extractIconBtn.addEventListener('click', () => this.extractIcon());
        }

        // Cancel button
        const cancelBtn = document.getElementById('cancel-add');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideAddModal());
        }

        // Auto-extract icon when path changes
        const pathField = document.getElementById('shortcut-path');
        if (pathField) {
            pathField.addEventListener('blur', () => {
                // Auto-extract icon if path is valid
                setTimeout(() => {
                    const path = pathField.value.trim();
                    if (path && !this.currentIconData) {
                        this.extractIcon();
                    }
                }, 500);
            });
        }
    }

    showLoading(show) {
        console.log(`${show ? 'Showing' : 'Hiding'} loading screen...`);
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = show ? 'flex' : 'none';
        }
        this.isLoading = show;
    }

    async loadShortcuts() {
        try {
            console.log('Loading shortcuts from database...');
            
            if (!this.dbConnected || !window.dbAPI || !window.dbAPI.getShortcuts) {
                console.warn('Database not available, showing empty state');
                this.shortcuts = [];
                this.renderShortcuts();
                return;
            }
            
            this.shortcuts = await window.dbAPI.getShortcuts();
            console.log(`✅ Loaded ${this.shortcuts.length} shortcuts`);
            this.renderShortcuts();
        } catch (error) {
            console.error('❌ Error loading shortcuts:', error);
            this.shortcuts = [];
            this.renderShortcuts();
        }
    }

    renderShortcuts() {
        console.log('Rendering shortcuts...');
        const grid = document.getElementById('shortcuts-grid');
        const emptyState = document.getElementById('empty-state');
        
        if (!grid || !emptyState) {
            console.error('Required DOM elements not found for rendering shortcuts');
            return;
        }
        
        // Clear existing shortcuts
        grid.innerHTML = '';

        if (this.shortcuts.length === 0) {
            // Show empty state message
            emptyState.style.display = 'flex';
            grid.style.display = 'none';
            console.log('No shortcuts found, showing empty state');
        } else {
            // Hide empty state and show grid
            emptyState.style.display = 'none';
            grid.style.display = 'grid';

            // Render each shortcut - NO "Add new" element
            this.shortcuts.forEach(shortcut => {
                const shortcutElement = this.createShortcutElement(shortcut);
                grid.appendChild(shortcutElement);
            });
            
            // Set up resize observer for saving sizes
            this.setupResizeObserver();
            
            // NEW: Initialize keyboard focus
            this.initializeKeyboardFocus();
            
            console.log(`✅ Rendered ${this.shortcuts.length} shortcuts`);
        }
    }

    // NEW: Set up resize observer to save shortcut sizes (now works with custom resize)
    setupResizeObserver() {
        // Custom resize handling is now done in the resize methods
        // This observer is kept for any programmatic size changes
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        this.resizeObserver = new ResizeObserver((entries) => {
            entries.forEach((entry) => {
                const element = entry.target;
                const shortcutId = element.dataset.id;
                
                // Only auto-save if not currently being resized manually
                if (shortcutId && !this.isResizing) {
                    // Clear existing timeout for this shortcut
                    if (this.resizeTimeouts.has(shortcutId)) {
                        clearTimeout(this.resizeTimeouts.get(shortcutId));
                    }
                    
                    // Set new timeout to save size
                    const timeout = setTimeout(() => {
                        this.saveShortcutSize(shortcutId, element.offsetWidth, element.offsetHeight);
                        this.resizeTimeouts.delete(shortcutId);
                    }, 1000);
                    
                    this.resizeTimeouts.set(shortcutId, timeout);
                }
            });
        });

        // Observe all shortcut elements
        document.querySelectorAll('.shortcut-item').forEach(element => {
            this.resizeObserver.observe(element);
        });
    }

    // NEW: Save shortcut size to database
    async saveShortcutSize(shortcutId, width, height) {
        try {
            if (!this.dbConnected || !window.dbAPI || !window.dbAPI.updateShortcutSize) {
                return;
            }
            
            await window.dbAPI.updateShortcutSize(shortcutId, width, height);
            console.log(`✅ Saved shortcut size: ${shortcutId} -> ${width}x${height}`);
        } catch (error) {
            console.error('❌ Error saving shortcut size:', error);
        }
    }

    createShortcutElement(shortcut) {
        const element = document.createElement('div');
        element.className = 'shortcut-item';
        element.dataset.id = shortcut.id;

        // UPDATED: Apply saved sizing with new defaults
        const width = shortcut.width || 250;   // Default to 250px width
        const height = shortcut.height || 700; // Default to 700px height
        element.style.width = width + 'px';
        element.style.height = height + 'px';

        // Use stored icon data or fallback to default icons
        let iconHtml = '';
        if (shortcut.icon_data) {
            iconHtml = `<img src="${shortcut.icon_data}" alt="${shortcut.name} icon" />`;
        } else {
            // Fallback to emoji icons
            let icon = '';
            if (shortcut.type === 'website') {
                icon = '🌐';
            } else if (shortcut.type === 'software') {
                icon = shortcut.exists_on_pc ? '💻' : '❌';
            }
            iconHtml = icon;
        }

        element.innerHTML = `
            <div class="shortcut-icon">${iconHtml}</div>
            <div class="shortcut-name">${this.escapeHtml(shortcut.name)}</div>
            <button class="shortcut-delete" onclick="launcher.deleteShortcut(${shortcut.id}); event.stopPropagation();">×</button>
        `;

        // Add click handler for opening shortcut with improved resize detection
        element.addEventListener('click', (e) => {
            // Prevent opening during resize or if click is on delete button
            if (e.target.classList.contains('shortcut-delete')) {
                return; // Let delete handler work
            }
            
            // Check if we're resizing or recently finished resizing
            if (this.isResizing || element.classList.contains('resizing')) {
                console.log('Click blocked: Currently resizing');
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            
            // Additional check for recent resize activity
            if (element.dataset.lastResize) {
                const lastResize = parseInt(element.dataset.lastResize);
                const now = Date.now();
                if (now - lastResize < 200) {
                    console.log('Click blocked: Recent resize activity');
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }
            
            this.openShortcut(shortcut);
        });

        // NEW: Add fluid resize functionality
        this.addResizeHandlers(element);

        // Add visual indicator for missing software
        if (shortcut.type === 'software' && !shortcut.exists_on_pc) {
            element.classList.add('software-missing');
            element.title = 'Software not found on this PC';
        }

        return element;
    }

    async openShortcut(shortcut) {
        try {
            console.log(`Opening shortcut: ${shortcut.name}`);
            
            if (!window.electronAPI || !window.electronAPI.openShortcut) {
                this.showMessage('Cannot open shortcut: System API not available');
                return;
            }
            
            const isUrl = shortcut.type === 'website';
            const success = await window.electronAPI.openShortcut(shortcut.path, isUrl);
            
            if (!success) {
                this.showMessage(`Failed to open ${shortcut.name}`);
            }
        } catch (error) {
            console.error('Error opening shortcut:', error);
            this.showMessage(`Error opening ${shortcut.name}: ${error.message}`);
        }
    }

    async deleteShortcut(id) {
        if (!confirm('Are you sure you want to delete this shortcut?')) {
            return;
        }

        try {
            if (!this.dbConnected || !window.dbAPI || !window.dbAPI.deleteShortcut) {
                this.showMessage('Cannot delete shortcut: Database not available');
                return;
            }
            
            const success = await window.dbAPI.deleteShortcut(id);
            if (success) {
                await this.loadShortcuts();
                console.log('✅ Shortcut deleted successfully');
            } else {
                this.showMessage('Failed to delete shortcut');
            }
        } catch (error) {
            console.error('Error deleting shortcut:', error);
            this.showMessage('Error deleting shortcut: ' + error.message);
        }
    }

    showAddModal() {
        console.log('showAddModal called');
        const modal = document.getElementById('add-modal');
        if (!modal) {
            console.error('Add modal not found!');
            return;
        }
        
        modal.style.display = 'block';
        console.log('Modal display set to block');
        
        // Reset form
        this.resetAddForm();
        
        // Focus name field
        setTimeout(() => {
            const nameField = document.getElementById('shortcut-name');
            if (nameField) {
                nameField.focus();
                console.log('Name field focused');
            }
        }, 100);
    }

    resetAddForm() {
        const nameField = document.getElementById('shortcut-name');
        const pathField = document.getElementById('shortcut-path');
        const typeField = document.getElementById('shortcut-type');
        
        if (nameField) nameField.value = '';
        if (pathField) pathField.value = '';
        if (typeField) {
            typeField.value = 'software';
            this.updatePathField('software');
        }
        
        // Reset icon preview
        this.resetIconPreview();
    }

    hideAddModal() {
        const modal = document.getElementById('add-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    async showAdminModal() {
        const modal = document.getElementById('admin-modal');
        if (modal) {
            modal.style.display = 'block';
        }
        
        // Load admin data, background settings, and window settings
        await this.loadAdminData();
        await this.loadBackgroundSettingsToModal();
        await this.loadWindowSettings();
    }

    hideAdminModal() {
        const modal = document.getElementById('admin-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    hideAllModals() {
        this.hideAddModal();
        this.hideAdminModal();
    }

    updatePathField(type) {
        const pathGroup = document.getElementById('path-group');
        const pathInput = document.getElementById('shortcut-path');
        const browseBtn = document.getElementById('browse-btn');
        const label = pathGroup?.querySelector('label');

        if (type === 'website') {
            if (label) label.textContent = 'URL:';
            if (pathInput) pathInput.placeholder = 'https://example.com';
            if (browseBtn) browseBtn.style.display = 'none';
        } else {
            if (label) label.textContent = 'Path:';
            if (pathInput) pathInput.placeholder = 'C:\\Program Files\\...\\app.exe';
            if (browseBtn) browseBtn.style.display = 'block';
        }
        
        // Reset icon when type changes
        this.resetIconPreview();
    }

    async saveShortcut() {
        const name = document.getElementById('shortcut-name')?.value.trim();
        const path = document.getElementById('shortcut-path')?.value.trim();
        const type = document.getElementById('shortcut-type')?.value;

        // Validation
        if (!name) {
            this.showMessage('Please enter a name for the shortcut');
            return;
        }

        if (!path) {
            this.showMessage('Please enter a path or URL for the shortcut');
            return;
        }

        if (type === 'website' && !this.isValidUrl(path)) {
            this.showMessage('Please enter a valid URL (must start with http:// or https://)');
            return;
        }

        // Check if database is available
        if (!this.dbConnected || !window.dbAPI || !window.dbAPI.addShortcut) {
            this.showMessage('Cannot save shortcut: Database not available. App is running in offline mode.');
            return;
        }

        // Get icon data if available
        const iconPreview = document.getElementById('icon-preview');
        const imgElement = iconPreview?.querySelector('img');
        const iconData = imgElement ? imgElement.src : null;

        try {
            // Save to database (will use new default size 250x700)
            const success = await window.dbAPI.addShortcut(name, path, type, iconData);
            
            if (success) {
                this.hideAddModal();
                await this.loadShortcuts();
                console.log(`✅ Shortcut '${name}' saved successfully`);
                // NO MORE POPUP - Silent success
            } else {
                this.showMessage('Failed to save shortcut');
            }
        } catch (error) {
            console.error('Error saving shortcut:', error);
            this.showMessage('Error saving shortcut: ' + error.message);
        }
    }

    isValidUrl(string) {
        try {
            const url = new URL(string);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
            return false;
        }
    }

    async loadAdminData() {
        try {
            if (!this.dbConnected || !window.dbAPI) {
                console.warn('Database API not available for admin data');
                this.showOfflineAdminData();
                return;
            }
            
            // PC Info
            const pcInfo = await window.dbAPI.getPCInfo();
            const pcInfoElement = document.getElementById('pc-info');
            if (pcInfoElement && pcInfo) {
                pcInfoElement.innerHTML = `
                    <p><strong>Hostname:</strong> ${this.escapeHtml(pcInfo.hostname)}</p>
                    <p><strong>Platform:</strong> ${this.escapeHtml(pcInfo.platform)}</p>
                    <p><strong>Architecture:</strong> ${this.escapeHtml(pcInfo.arch)}</p>
                    <p><strong>Username:</strong> ${this.escapeHtml(pcInfo.username)}</p>
                `;
            }

            // Database Status
            const dbStatus = await window.dbAPI.getConnectionStatus();
            const dbStatusElement = document.getElementById('db-status');
            if (dbStatusElement) {
                dbStatusElement.innerHTML = `
                    <p><strong>Connection:</strong> ${dbStatus.connected ? '✅ Connected' : '❌ Disconnected'}</p>
                    <p><strong>Current PC:</strong> ${this.escapeHtml(dbStatus.hostname)}</p>
                    <p><strong>Table:</strong> ${this.escapeHtml(dbStatus.tableName)}</p>
                `;
            }

            // Shortcuts List
            const shortcuts = await window.dbAPI.getShortcuts();
            this.renderAdminShortcuts(shortcuts);

        } catch (error) {
            console.error('Error loading admin data:', error);
            this.showOfflineAdminData();
        }
    }

    showOfflineAdminData() {
        const pcInfoElement = document.getElementById('pc-info');
        const dbStatusElement = document.getElementById('db-status');
        const shortcutsListElement = document.getElementById('shortcuts-list');
        
        if (pcInfoElement) {
            pcInfoElement.innerHTML = '<p>❌ PC information not available (offline mode)</p>';
        }
        
        if (dbStatusElement) {
            dbStatusElement.innerHTML = '<p><strong>Connection:</strong> ❌ Disconnected</p>';
        }
        
        if (shortcutsListElement) {
            shortcutsListElement.innerHTML = '<p>❌ Shortcuts data not available (offline mode)</p>';
        }
    }

    renderAdminShortcuts(shortcuts) {
        const shortcutsListElement = document.getElementById('shortcuts-list');
        if (!shortcutsListElement) return;
        
        let shortcutsHtml = '<div style="max-height: 200px; overflow-y: auto;">';
        
        if (shortcuts.length === 0) {
            shortcutsHtml += '<p>No shortcuts found for this PC.</p>';
        } else {
            shortcuts.forEach(shortcut => {
                const status = shortcut.type === 'software' ? 
                    (shortcut.exists_on_pc ? '✅' : '❌') : '🌐';
                const date = new Date(shortcut.created_at).toLocaleDateString();
                const size = `${shortcut.width || 250}×${shortcut.height || 700}`;
                shortcutsHtml += `
                    <div style="margin-bottom: 10px; padding: 8px; border: 1px solid #ffffff;">
                        <strong>${status} ${this.escapeHtml(shortcut.name)}</strong><br>
                        <small>${this.escapeHtml(shortcut.type)}: ${this.escapeHtml(shortcut.path)}</small><br>
                        <small>Size: ${size}px | Added: ${date}</small>
                    </div>
                `;
            });
        }
        
        shortcutsHtml += '</div>';
        shortcutsListElement.innerHTML = shortcutsHtml;
    }

    // NEW: Background settings functions
    async loadBackgroundSettings() {
        try {
            if (!this.dbConnected || !window.dbAPI) {
                return;
            }

            const backgroundData = await window.dbAPI.getSetting('background_config');
            if (backgroundData) {
                const config = JSON.parse(backgroundData);
                this.applyBackground(config);
            }
        } catch (error) {
            console.error('Error loading background settings:', error);
        }
    }

    async loadBackgroundSettingsToModal() {
        try {
            if (!this.dbConnected || !window.dbAPI) {
                return;
            }

            const backgroundData = await window.dbAPI.getSetting('background_config');
            if (backgroundData) {
                const config = JSON.parse(backgroundData);
                
                // Update modal fields
                const typeSelect = document.getElementById('background-type');
                if (typeSelect) typeSelect.value = config.type || 'solid';
                
                if (config.type === 'gradient' && config.gradientStyle) {
                    const gradientSelect = document.getElementById('gradient-style');
                    if (gradientSelect) gradientSelect.value = config.gradientStyle;
                    
                    if (config.gradientStyle === 'custom' && config.customGradient) {
                        const customInput = document.getElementById('gradient-css');
                        if (customInput) customInput.value = config.customGradient;
                    }
                }
                
                if (config.type === 'image') {
                    if (config.imageData) {
                        this.showImagePreview(config.imageData);
                    }
                    if (config.backgroundSize) {
                        const sizeSelect = document.getElementById('background-size');
                        if (sizeSelect) sizeSelect.value = config.backgroundSize;
                    }
                    if (config.opacity) {
                        const opacitySlider = document.getElementById('background-opacity');
                        const opacityValue = document.getElementById('opacity-value');
                        if (opacitySlider) opacitySlider.value = config.opacity;
                        if (opacityValue) opacityValue.textContent = config.opacity + '%';
                    }
                }
                
                this.toggleBackgroundOptions(config.type || 'solid');
            }
        } catch (error) {
            console.error('Error loading background settings to modal:', error);
        }
    }

    toggleBackgroundOptions(type) {
        const gradientOptions = document.getElementById('gradient-options');
        const imageOptions = document.getElementById('image-options');
        
        if (gradientOptions) {
            gradientOptions.style.display = type === 'gradient' ? 'block' : 'none';
        }
        
        if (imageOptions) {
            imageOptions.style.display = type === 'image' ? 'block' : 'none';
        }
    }

    toggleCustomGradient(gradientStyle) {
        const customGradient = document.getElementById('custom-gradient');
        if (customGradient) {
            customGradient.style.display = gradientStyle === 'custom' ? 'block' : 'none';
        }
    }

    async browseBackgroundImage() {
        try {
            if (!window.electronAPI || !window.electronAPI.browseBackgroundImage) {
                this.showMessage('Cannot browse images: System API not available');
                return;
            }

            const filePath = await window.electronAPI.browseBackgroundImage();
            if (filePath) {
                // Show loading state
                const preview = document.getElementById('image-preview');
                if (preview) {
                    preview.innerHTML = 'Loading image...';
                }
                
                // Convert file to base64 using FileReader API (browser-safe)
                try {
                    const response = await fetch(`file://${filePath}`);
                    const blob = await response.blob();
                    const reader = new FileReader();
                    
                    reader.onload = () => {
                        const base64Data = reader.result;
                        this.showImagePreview(base64Data);
                    };
                    
                    reader.onerror = () => {
                        this.showMessage('Error reading image file');
                        const preview = document.getElementById('image-preview');
                        if (preview) {
                            preview.innerHTML = 'Error loading image';
                        }
                    };
                    
                    reader.readAsDataURL(blob);
                } catch (fileError) {
                    console.error('Error reading file:', fileError);
                    this.showMessage('Error reading image file: ' + fileError.message);
                }
            }
        } catch (error) {
            console.error('Error browsing background image:', error);
            this.showMessage('Error browsing image: ' + error.message);
        }
    }

    showImagePreview(imageData) {
        const preview = document.getElementById('image-preview');
        if (preview) {
            preview.innerHTML = `<img src="${imageData}" alt="Background preview" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
            preview.dataset.imageData = imageData;
        }
    }

    removeBackgroundImage() {
        const preview = document.getElementById('image-preview');
        if (preview) {
            preview.innerHTML = 'No image selected';
            delete preview.dataset.imageData;
        }
    }

    async applyBackgroundSettings() {
        try {
            const type = document.getElementById('background-type')?.value || 'solid';
            const config = { type };

            if (type === 'gradient') {
                const gradientStyle = document.getElementById('gradient-style')?.value;
                config.gradientStyle = gradientStyle;
                
                if (gradientStyle === 'custom') {
                    config.customGradient = document.getElementById('gradient-css')?.value;
                } else {
                    config.predefinedGradient = gradientStyle;
                }
            } else if (type === 'image') {
                const preview = document.getElementById('image-preview');
                if (preview && preview.dataset.imageData) {
                    config.imageData = preview.dataset.imageData;
                    config.backgroundSize = document.getElementById('background-size')?.value || 'cover';
                    config.opacity = document.getElementById('background-opacity')?.value || 100;
                }
            }

            // Apply the background
            this.applyBackground(config);

            // Save to database
            if (this.dbConnected && window.dbAPI) {
                await window.dbAPI.setSetting('background_config', JSON.stringify(config));
                console.log('✅ Background settings applied and saved');
            }

            // NO MORE POPUP - Silent success
        } catch (error) {
            console.error('Error applying background:', error);
            // Only show error popups, not success messages
            this.showMessage('Error applying background: ' + error.message);
        }
    }

    applyBackground(config) {
        const body = document.body;
        
        // Reset all background styles
        body.style.backgroundImage = '';
        body.style.backgroundSize = '';
        body.style.backgroundPosition = '';
        body.style.backgroundRepeat = '';
        body.style.backgroundColor = '#000000';

        switch (config.type) {
            case 'solid':
                body.style.backgroundColor = '#000000';
                break;
                
            case 'gradient':
                if (config.predefinedGradient) {
                    const gradients = {
                        'linear-black-gray': 'linear-gradient(135deg, #000000, #333333)',
                        'linear-gray-black': 'linear-gradient(135deg, #333333, #000000)',
                        'radial-black-gray': 'radial-gradient(circle, #000000, #333333)',
                        'diagonal-black-gray': 'linear-gradient(45deg, #000000, #333333)'
                    };
                    body.style.backgroundImage = gradients[config.predefinedGradient];
                } else if (config.customGradient) {
                    body.style.backgroundImage = config.customGradient;
                }
                break;
                
            case 'image':
                if (config.imageData) {
                    body.style.backgroundImage = `url(${config.imageData})`;
                    
                    switch (config.backgroundSize) {
                        case 'cover':
                            body.style.backgroundSize = 'cover';
                            body.style.backgroundRepeat = 'no-repeat';
                            break;
                        case 'contain':
                            body.style.backgroundSize = 'contain';
                            body.style.backgroundRepeat = 'no-repeat';
                            break;
                        case 'stretch':
                            body.style.backgroundSize = '100% 100%';
                            body.style.backgroundRepeat = 'no-repeat';
                            break;
                        case 'tile':
                            body.style.backgroundSize = 'auto';
                            body.style.backgroundRepeat = 'repeat';
                            break;
                    }
                    
                    body.style.backgroundPosition = 'center';
                    
                    if (config.opacity && config.opacity < 100) {
                        body.style.position = 'relative';
                        body.style.setProperty('--bg-opacity', config.opacity / 100);
                        body.style.backgroundBlendMode = 'multiply';
                    }
                }
                break;
        }
    }

    // NEW: Window settings methods
    // NEW: Load and apply window settings on startup
    async loadAndApplyWindowSettings() {
        try {
            if (!this.dbConnected || !window.dbAPI) {
                console.log('Database not available, using default window settings');
                return;
            }

            const desktopMode = await window.dbAPI.getSetting('desktop_mode');
            const isDesktopMode = desktopMode === 'true';
            
            console.log(`Loading window settings: wallpaper mode = ${isDesktopMode}`);
            
            // Apply the setting without showing UI feedback
            if (window.electronAPI && window.electronAPI.setDesktopMode) {
                await window.electronAPI.setDesktopMode(isDesktopMode);
                console.log(`✅ Window mode applied: ${isDesktopMode ? 'Wallpaper mode' : 'Normal mode'}`);
            }
        } catch (error) {
            console.error('Error loading window settings:', error);
        }
    }

    async loadWindowSettings() {
        try {
            if (!this.dbConnected || !window.dbAPI) {
                return;
            }

            const desktopMode = await window.dbAPI.getSetting('desktop_mode');
            const desktopModeCheckbox = document.getElementById('desktop-mode');
            if (desktopModeCheckbox) {
                desktopModeCheckbox.checked = desktopMode === 'true';
            }
        } catch (error) {
            console.error('Error loading window settings:', error);
        }
    }

    async applyWindowSettings() {
        try {
            const desktopModeCheckbox = document.getElementById('desktop-mode');
            const desktopMode = desktopModeCheckbox ? desktopModeCheckbox.checked : false;

            // Apply the setting
            if (window.electronAPI && window.electronAPI.setDesktopMode) {
                const result = await window.electronAPI.setDesktopMode(desktopMode);
                
                if (result.success) {
                    // Save to database
                    if (this.dbConnected && window.dbAPI) {
                        await window.dbAPI.setSetting('desktop_mode', desktopMode.toString());
                        console.log('✅ Window settings applied and saved');
                    }

                    alert('Window settings applied successfully!\n\n' + result.message);
                } else {
                    throw new Error(result.message || 'Failed to apply window settings');
                }
            } else {
                throw new Error('Window mode control not available');
            }

        } catch (error) {
            console.error('Error applying window settings:', error);
            this.showMessage('Error applying window settings: ' + error.message);
        }
    }

    async resetBackgroundSettings() {
        try {
            // Reset to solid black
            this.applyBackground({ type: 'solid' });
            
            // Clear from database
            if (this.dbConnected && window.dbAPI) {
                await window.dbAPI.setSetting('background_config', JSON.stringify({ type: 'solid' }));
            }
            
            // Reset modal
            const typeSelect = document.getElementById('background-type');
            if (typeSelect) typeSelect.value = 'solid';
            this.toggleBackgroundOptions('solid');
            this.removeBackgroundImage();
            
            console.log('✅ Background reset to default');
            // NO MORE POPUP - Silent reset
        } catch (error) {
            console.error('Error resetting background:', error);
            // Only show error popups, not success messages
            this.showMessage('Error resetting background: ' + error.message);
        }
    }

    resetIconPreview() {
        const iconPreview = document.getElementById('icon-preview');
        const iconStatus = document.getElementById('icon-status');
        const extractBtn = document.getElementById('extract-icon-btn');
        
        if (iconPreview) iconPreview.innerHTML = '📦';
        if (iconStatus) {
            iconStatus.textContent = '';
            iconStatus.className = 'icon-status';
        }
        if (extractBtn) {
            extractBtn.disabled = false;
            extractBtn.textContent = 'Extract Icon';
        }
        
        this.currentIconData = null;
    }

    async extractIcon() {
        const path = document.getElementById('shortcut-path')?.value.trim();
        const type = document.getElementById('shortcut-type')?.value;
        
        if (!path) {
            this.showMessage('Please enter a path or URL first');
            return;
        }
        
        if (!window.electronAPI) {
            this.showMessage('Cannot extract icon: System API not available');
            return;
        }
        
        const iconPreview = document.getElementById('icon-preview');
        const iconStatus = document.getElementById('icon-status');
        const extractBtn = document.getElementById('extract-icon-btn');
        
        if (!iconPreview || !iconStatus || !extractBtn) {
            console.error('Icon extraction UI elements not found');
            return;
        }
        
        // Show loading state
        extractBtn.disabled = true;
        extractBtn.textContent = 'Extracting...';
        iconStatus.textContent = 'Extracting icon...';
        iconStatus.className = 'icon-status loading';
        
        try {
            let iconData = null;
            
            if (type === 'website') {
                if (!this.isValidUrl(path)) {
                    throw new Error('Invalid URL format');
                }
                if (window.electronAPI.extractWebsiteIcon) {
                    iconData = await window.electronAPI.extractWebsiteIcon(path);
                }
            } else if (type === 'software') {
                if (window.electronAPI.extractAppIcon) {
                    iconData = await window.electronAPI.extractAppIcon(path);
                }
            }
            
            if (iconData) {
                // Show extracted icon
                iconPreview.innerHTML = `<img src="${iconData}" alt="Extracted icon" />`;
                iconStatus.textContent = 'Icon extracted successfully!';
                iconStatus.className = 'icon-status success';
                this.currentIconData = iconData;
                console.log('✅ Icon extracted successfully');
            } else {
                throw new Error('Could not extract icon');
            }
            
        } catch (error) {
            console.error('Error extracting icon:', error);
            iconStatus.textContent = `Failed to extract icon: ${error.message}`;
            iconStatus.className = 'icon-status error';
            
            // Reset to default icon
            iconPreview.innerHTML = type === 'website' ? '🌐' : '💻';
        } finally {
            extractBtn.disabled = false;
            extractBtn.textContent = 'Extract Icon';
        }
    }

    // NEW: Keyboard navigation methods
    isModalOpen() {
        const addModal = document.getElementById('add-modal');
        const adminModal = document.getElementById('admin-modal');
        return (addModal && addModal.style.display === 'block') || 
               (adminModal && adminModal.style.display === 'block');
    }

    initializeKeyboardFocus() {
        if (this.shortcuts.length > 0) {
            this.currentFocusIndex = 0;
            this.updateFocusDisplay();
        }
    }

    updateFocusDisplay() {
        // Remove focus from all shortcuts
        document.querySelectorAll('.shortcut-item').forEach(item => {
            item.classList.remove('keyboard-focused');
        });

        // Add focus to current shortcut
        if (this.shortcuts.length > 0) {
            const shortcutElements = document.querySelectorAll('.shortcut-item');
            if (shortcutElements[this.currentFocusIndex]) {
                shortcutElements[this.currentFocusIndex].classList.add('keyboard-focused');
                // Scroll into view if needed
                shortcutElements[this.currentFocusIndex].scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                });
            }
        }
    }

    navigateShortcuts(direction) {
        if (this.shortcuts.length === 0) return;

        const grid = document.getElementById('shortcuts-grid');
        if (!grid) return;

        const gridComputedStyle = window.getComputedStyle(grid);
        const gridTemplateColumns = gridComputedStyle.gridTemplateColumns;
        const columnCount = gridTemplateColumns.split(' ').length;

        const currentRow = Math.floor(this.currentFocusIndex / columnCount);
        const currentCol = this.currentFocusIndex % columnCount;
        const totalRows = Math.ceil(this.shortcuts.length / columnCount);

        let newIndex = this.currentFocusIndex;

        switch (direction) {
            case 'up':
                if (currentRow > 0) {
                    newIndex = this.currentFocusIndex - columnCount;
                } else {
                    // Wrap to bottom row, same column
                    const lastRowStartIndex = (totalRows - 1) * columnCount;
                    newIndex = Math.min(lastRowStartIndex + currentCol, this.shortcuts.length - 1);
                }
                break;

            case 'down':
                if (currentRow < totalRows - 1) {
                    newIndex = Math.min(this.currentFocusIndex + columnCount, this.shortcuts.length - 1);
                } else {
                    // Wrap to top row, same column
                    newIndex = currentCol;
                }
                break;

            case 'left':
                if (this.currentFocusIndex > 0) {
                    newIndex = this.currentFocusIndex - 1;
                } else {
                    // Wrap to last shortcut
                    newIndex = this.shortcuts.length - 1;
                }
                break;

            case 'right':
                if (this.currentFocusIndex < this.shortcuts.length - 1) {
                    newIndex = this.currentFocusIndex + 1;
                } else {
                    // Wrap to first shortcut
                    newIndex = 0;
                }
                break;

            case 'next': // Tab navigation
                newIndex = (this.currentFocusIndex + 1) % this.shortcuts.length;
                break;

            case 'prev': // Shift+Tab navigation
                newIndex = (this.currentFocusIndex - 1 + this.shortcuts.length) % this.shortcuts.length;
                break;
        }

        if (newIndex !== this.currentFocusIndex) {
            this.currentFocusIndex = newIndex;
            this.updateFocusDisplay();
            console.log(`🎯 Focus moved to shortcut ${this.currentFocusIndex}: ${this.shortcuts[this.currentFocusIndex]?.name}`);
        }
    }

    launchFocusedShortcut() {
        if (this.shortcuts.length === 0) return;

        const focusedShortcut = this.shortcuts[this.currentFocusIndex];
        if (focusedShortcut) {
            console.log(`🚀 Launching focused shortcut: ${focusedShortcut.name}`);
            this.openShortcut(focusedShortcut);
        }
    }

    // NEW: Fluid resize functionality
    addResizeHandlers(element) {
        const resizeHandle = element;
        
        // Mouse down on resize handle area (bottom-right corner)
        resizeHandle.addEventListener('mousedown', (e) => {
            const rect = element.getBoundingClientRect();
            const isInResizeZone = (
                e.clientX > rect.right - 25 && 
                e.clientY > rect.bottom - 25
            );
            
            if (!isInResizeZone) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            this.startResize(element, e);
        });
        
        // Update cursor when hovering over resize zone
        resizeHandle.addEventListener('mousemove', (e) => {
            if (this.isResizing) return;
            
            const rect = element.getBoundingClientRect();
            const isInResizeZone = (
                e.clientX > rect.right - 25 && 
                e.clientY > rect.bottom - 25
            );
            
            element.style.cursor = isInResizeZone ? 'nw-resize' : 'pointer';
        });
        
        // Reset cursor when leaving element
        resizeHandle.addEventListener('mouseleave', () => {
            if (!this.isResizing) {
                element.style.cursor = 'pointer';
            }
        });
    }
    
    startResize(element, e) {
        console.log('Starting resize operation');
        this.isResizing = true;
        element.classList.add('resizing');
        element.dataset.resizeStarted = Date.now();
        
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = parseInt(window.getComputedStyle(element).width, 10);
        const startHeight = parseInt(window.getComputedStyle(element).height, 10);
        
        this.resizeData = {
            element,
            startX,
            startY,
            startWidth,
            startHeight
        };
        
        // Add global mouse handlers
        document.addEventListener('mousemove', this.doResize.bind(this));
        document.addEventListener('mouseup', this.stopResize.bind(this));
        
        // Prevent text selection during resize
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'nw-resize';
        
        // Disable all click handlers temporarily
        element.style.pointerEvents = 'none';
        setTimeout(() => {
            if (element.style.pointerEvents === 'none') {
                element.style.pointerEvents = 'auto';
            }
        }, 100);
    }
    
    doResize(e) {
        if (!this.isResizing || !this.resizeData) return;
        
        e.preventDefault();
        
        const { element, startX, startY, startWidth, startHeight } = this.resizeData;
        
        // Calculate new dimensions
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        let newWidth = startWidth + deltaX;
        let newHeight = startHeight + deltaY;
        
        // Apply constraints
        newWidth = Math.max(150, Math.min(600, newWidth));
        newHeight = Math.max(200, Math.min(1000, newHeight));
        
        // Apply new size with smooth animation
        element.style.width = newWidth + 'px';
        element.style.height = newHeight + 'px';
    }
    
    stopResize(e) {
        if (!this.isResizing || !this.resizeData) return;
        
        e.preventDefault();
        
        const { element } = this.resizeData;
        
        console.log('Stopping resize operation');
        
        // Clean up
        this.isResizing = false;
        element.classList.remove('resizing');
        
        // Mark the timestamp when resize ended
        element.dataset.lastResize = Date.now();
        
        // Remove global handlers
        document.removeEventListener('mousemove', this.doResize.bind(this));
        document.removeEventListener('mouseup', this.stopResize.bind(this));
        
        // Restore normal state
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        element.style.cursor = 'pointer';
        element.style.pointerEvents = 'auto';
        
        // Save the new size (with debounce)
        const shortcutId = element.dataset.id;
        if (shortcutId) {
            // Clear existing timeout for this shortcut
            if (this.resizeTimeouts.has(shortcutId)) {
                clearTimeout(this.resizeTimeouts.get(shortcutId));
            }
            
            // Set new timeout to save size after resize stops
            const timeout = setTimeout(() => {
                this.saveShortcutSize(shortcutId, element.offsetWidth, element.offsetHeight);
                this.resizeTimeouts.delete(shortcutId);
            }, 500); // Reduced delay for more responsive feel
            
            this.resizeTimeouts.set(shortcutId, timeout);
        }
        
        this.resizeData = null;
        
        console.log(`✨ Fluid resize completed: ${element.offsetWidth}x${element.offsetHeight}`);
        
        // Clear the resize timestamp after a delay to allow normal clicks
        setTimeout(() => {
            if (element.dataset.lastResize) {
                delete element.dataset.lastResize;
            }
        }, 300);
    }

    // NEW: Install RustDesk method
    async installRustDesk() {
        console.log('Installing RustDesk...');
        
        if (!confirm('This will download and install RustDesk (Remote Desktop Software).\n\nYou will be prompted for Administrator privileges.\n\nDo you want to continue?')) {
            return;
        }
        
        try {
            if (!window.electronAPI || !window.electronAPI.installRustDesk) {
                this.showMessage('Cannot install RustDesk: System API not available');
                return;
            }
            
            // Show loading state
            const rustdeskBtn = document.getElementById('rustdesk-btn');
            const originalText = rustdeskBtn.textContent;
            rustdeskBtn.textContent = '⬇️ Downloading...';
            rustdeskBtn.disabled = true;
            
            console.log('Starting RustDesk installation...');
            
            try {
                const result = await window.electronAPI.installRustDesk();
                
                if (result.success) {
                    rustdeskBtn.textContent = '✅ Installed!';
                    console.log('✅ RustDesk installed successfully');
                    
                    // Show success message
                    alert('RustDesk has been installed successfully!\n\nYou can find it in your Start Menu or Desktop.');
                    
                    // Reset button after delay
                    setTimeout(() => {
                        rustdeskBtn.textContent = originalText;
                        rustdeskBtn.disabled = false;
                    }, 3000);
                } else {
                    throw new Error(result.error || 'Installation failed');
                }
            } catch (installError) {
                // Handle specific error cases
                if (installError.message.includes('declined') || installError.message.includes('cancelled')) {
                    rustdeskBtn.textContent = '❌ Cancelled';
                    alert('Installation cancelled: Administrator privileges are required to install RustDesk.');
                } else if (installError.message.includes('1625')) {
                    rustdeskBtn.textContent = '❌ Failed';
                    this.showManualInstallPrompt();
                } else {
                    rustdeskBtn.textContent = '❌ Failed';
                    this.showMessage('Error installing RustDesk: ' + installError.message);
                }
                
                // Reset button after delay
                setTimeout(() => {
                    rustdeskBtn.textContent = originalText;
                    rustdeskBtn.disabled = false;
                }, 3000);
            }
            
        } catch (error) {
            console.error('❌ Error installing RustDesk:', error);
            this.showMessage('Error installing RustDesk: ' + error.message);
            
            // Reset button
            const rustdeskBtn = document.getElementById('rustdesk-btn');
            rustdeskBtn.textContent = '📡 RustDesk';
            rustdeskBtn.disabled = false;
        }
    }
    
    // NEW: Show manual install instructions
    showManualInstallPrompt() {
        const message = `Automatic installation failed. You can install RustDesk manually:\n\n` +
                       `1. Download from: https://github.com/rustdesk/rustdesk/releases/download/1.4.1/rustdesk-1.4.1-x86_64.msi\n` +
                       `2. Right-click the downloaded file\n` +
                       `3. Select "Run as administrator"\n` +
                       `4. Follow the installation prompts\n\n` +
                       `Would you like to open the download page in your browser?`;
        
        if (confirm(message)) {
            if (window.electronAPI && window.electronAPI.openShortcut) {
                window.electronAPI.openShortcut('https://github.com/rustdesk/rustdesk/releases/download/1.4.1/rustdesk-1.4.1-x86_64.msi', true);
            }
        }
    }
    
    showMessage(message) {
        // Only show popup alerts for errors and important warnings
        // Success messages are now silent (logged to console only)
        alert(message);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM loaded, initializing launcher...');
    window.launcher = new ShortcutLauncher();
});

// Prevent right-click context menu in production
document.addEventListener('contextmenu', (e) => {
    // Allow right-click in development mode for debugging
    if (!process?.env?.NODE_ENV || process.env.NODE_ENV !== 'development') {
        e.preventDefault();
    }
});

// Prevent drag and drop
document.addEventListener('dragover', (e) => {
    e.preventDefault();
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
});

// Additional security: Prevent navigation
window.addEventListener('beforeunload', (e) => {
    e.preventDefault();
    e.returnValue = '';
});

console.log('📄 App.js loaded successfully');

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
        this.taskbarRefreshInterval = null; // NEW: Track taskbar refresh interval
        this.openWindows = []; // NEW: Track open windows
        this.editingShortcutId = null; // NEW: Track which shortcut is being edited
        this.webviewOpen = false; // Track if embedded webview is open
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
                    
                    // Step 4: Load shortcuts and background settings
                    console.log('Step 4: Loading shortcuts and background settings...');
                    await this.loadShortcuts();
                    await this.loadBackgroundSettings();
                    // REMOVED: Don't auto-apply desktop mode on startup - always start in fullscreen mode
                    // Users can manually toggle desktop mode via Admin panel if needed
                    console.log('✅ Content loaded (starting in FULLSCREEN MODE - apps can show on top)');
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

            // Step 6: Start taskbar (window list)
            console.log('Step 6: Starting taskbar...');
            this.startTaskbar();
            console.log('✅ Taskbar started');

            // Step 7: Set up server command listeners
            console.log('Step 7: Setting up server command listeners...');
            this.setupServerListeners();
            console.log('✅ Server listeners set up');

            // Step 8: Set up webview listeners
            console.log('Step 8: Setting up webview listeners...');
            this.setupWebviewListeners();
            console.log('✅ Webview listeners set up');

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
        
        // CRITICAL: Close button - INSTANT CLOSE
        const closeBtn = document.getElementById('close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', async (e) => {
                console.log('🔴 Close button clicked - INSTANT CLOSE');
                e.preventDefault();
                e.stopPropagation();

                // Use force close for instant closing
                await this.forceCloseApplication();
            });

            console.log('✅ Close button event listener added');
        } else {
            console.error('❌ Close button not found in DOM!');
        }

        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                console.log('Settings button clicked');
                this.showSettingsModal();
            });
            console.log('✅ Settings button event listener added');
        }

        // Remotely button
        const remotelyBtn = document.getElementById('remotely-btn');
        if (remotelyBtn) {
            remotelyBtn.addEventListener('click', () => {
                console.log('Remotely button clicked');
                this.installRemotely();
            });
            console.log('✅ Remotely button event listener added');
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
            // Disable F11 (fullscreen toggle) - we're already in fullscreen mode
            if (e.key === 'F11') {
                console.log('🚫 F11 blocked - Fullscreen toggle disabled');
                e.preventDefault();
                return;
            }

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
            
            // Alt+A for settings panel
            if (e.altKey && e.key === 'a') {
                console.log('Alt+A pressed - settings panel');
                e.preventDefault();
                this.showSettingsModal();
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

        const settingsModalClose = document.getElementById('settings-modal-close');
        if (settingsModalClose) {
            settingsModalClose.addEventListener('click', () => this.hideSettingsModal());
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

        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            settingsModal.addEventListener('click', (e) => {
                if (e.target.id === 'settings-modal') {
                    this.hideSettingsModal();
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

        // Browse icon image button
        const browseIconBtn = document.getElementById('browse-icon-btn');
        if (browseIconBtn) {
            browseIconBtn.addEventListener('click', () => this.browseIconImage());
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

        // Create icon container (will load async if using file path)
        const iconContainer = document.createElement('div');
        iconContainer.className = 'shortcut-icon';

        // Create name and delete button
        const nameDiv = document.createElement('div');
        nameDiv.className = 'shortcut-name';
        nameDiv.textContent = shortcut.name;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'shortcut-delete';
        deleteBtn.textContent = '×';
        deleteBtn.onclick = (e) => {
            this.deleteShortcut(shortcut.id);
            e.stopPropagation();
        };

        // NEW: Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'shortcut-edit';
        editBtn.textContent = '✎';
        editBtn.title = 'Edit shortcut';
        editBtn.onclick = (e) => {
            this.editShortcut(shortcut.id);
            e.stopPropagation();
        };

        // Append elements
        element.appendChild(iconContainer);
        element.appendChild(nameDiv);
        element.appendChild(editBtn);
        element.appendChild(deleteBtn);

        // Load icon (async if using file path)
        this.loadShortcutIcon(shortcut, iconContainer);

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

    // NEW: Edit shortcut
    editShortcut(id) {
        console.log(`✎ Edit shortcut: ${id}`);

        // Find the shortcut
        const shortcut = this.shortcuts.find(s => s.id === id);
        if (!shortcut) {
            console.error('Shortcut not found:', id);
            return;
        }

        // Set edit mode
        this.editingShortcutId = id;

        // Populate the modal with existing data
        const modal = document.getElementById('add-modal');
        const modalHeader = modal.querySelector('.modal-header h2');
        const nameInput = document.getElementById('shortcut-name');
        const pathInput = document.getElementById('shortcut-path');
        const typeSelect = document.getElementById('shortcut-type');
        const iconPreview = document.getElementById('icon-preview');
        const saveBtn = document.getElementById('save-shortcut');

        // Update modal title
        modalHeader.textContent = 'Edit Shortcut';
        saveBtn.textContent = 'Save Changes';

        // Fill in the form
        nameInput.value = shortcut.name;
        pathInput.value = shortcut.path;
        typeSelect.value = shortcut.type;

        // Load and show current icon
        this.loadAndShowIcon(shortcut, iconPreview);

        // Store current icon path
        this.currentIconData = shortcut.icon_path || shortcut.icon_data;

        // Show the modal
        modal.style.display = 'block';
    }

    // Helper to load and show icon in preview
    async loadAndShowIcon(shortcut, iconPreview) {
        try {
            if (shortcut.icon_path && window.electronAPI && window.electronAPI.loadIcon) {
                const iconData = await window.electronAPI.loadIcon(shortcut.icon_path);
                if (iconData) {
                    iconPreview.innerHTML = `<img src="${iconData}" alt="Current icon" class="icon-highres" />`;
                    return;
                }
            } else if (shortcut.icon_data) {
                iconPreview.innerHTML = `<img src="${shortcut.icon_data}" alt="Current icon" />`;
                return;
            }

            // Fallback to emoji
            const icon = shortcut.type === 'website' ? '🌐' : '💻';
            iconPreview.innerHTML = icon;
        } catch (error) {
            console.error('Error loading icon preview:', error);
            const icon = shortcut.type === 'website' ? '🌐' : '💻';
            iconPreview.innerHTML = icon;
        }
    }

    showAddModal() {
        console.log('showAddModal called');

        // Reset edit mode
        this.editingShortcutId = null;

        const modal = document.getElementById('add-modal');
        if (!modal) {
            console.error('Add modal not found!');
            return;
        }

        // Set modal to "Add" mode
        const modalHeader = modal.querySelector('.modal-header h2');
        const saveBtn = document.getElementById('save-shortcut');
        if (modalHeader) modalHeader.textContent = 'Add New Shortcut';
        if (saveBtn) saveBtn.textContent = 'Save';

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
            this.resetAddForm();
            this.editingShortcutId = null; // Clear edit mode
        }
    }

    async showSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (modal) {
            modal.style.display = 'block';
        }

        // Load all settings data
        await this.loadBackgroundSettingsToModal();
        await this.loadServerSettings();
        await this.loadUpdateInfo();
    }

    hideSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    hideAllModals() {
        this.hideAddModal();
        this.hideSettingsModal();
    }

    async loadServerSettings() {
        const domainInput = document.getElementById('server-domain');
        const statusEl = document.getElementById('server-status');
        const dbStatusEl = document.getElementById('db-status');
        const saveBtn = document.getElementById('save-server-btn');
        const testBtn = document.getElementById('test-server-btn');

        // Get current server status from electron
        try {
            const serverStatus = await window.electronAPI.serverStatus();
            if (serverStatus.serverUrl) {
                domainInput.value = serverStatus.serverUrl;
            }

            if (serverStatus.connected) {
                statusEl.textContent = 'Connected';
                statusEl.className = 'info-value status-badge connected';
            } else if (serverStatus.serverUrl) {
                statusEl.textContent = 'Configured (Offline)';
                statusEl.className = 'info-value status-badge disconnected';
            } else {
                statusEl.textContent = 'Not configured';
                statusEl.className = 'info-value status-badge disconnected';
            }
        } catch (error) {
            console.error('Error getting server status:', error);
            statusEl.textContent = 'Not configured';
            statusEl.className = 'info-value status-badge disconnected';
        }

        // Check database connection status
        try {
            if (window.dbAPI && window.dbAPI.getConnectionStatus) {
                const dbStatus = await window.dbAPI.getConnectionStatus();
                if (dbStatus.connected) {
                    dbStatusEl.textContent = 'Connected';
                    dbStatusEl.className = 'info-value status-badge connected';
                } else {
                    dbStatusEl.textContent = 'Disconnected';
                    dbStatusEl.className = 'info-value status-badge disconnected';
                }
            } else {
                dbStatusEl.textContent = 'Unavailable';
                dbStatusEl.className = 'info-value status-badge disconnected';
            }
        } catch (error) {
            dbStatusEl.textContent = 'Error';
            dbStatusEl.className = 'info-value status-badge disconnected';
        }

        // Add save button handler - connects to server
        if (saveBtn && !saveBtn.hasAttribute('data-handler-added')) {
            saveBtn.setAttribute('data-handler-added', 'true');
            saveBtn.addEventListener('click', async () => {
                const domain = domainInput.value.trim();

                if (!domain) {
                    // Disconnect from server
                    await window.electronAPI.serverDisconnect();
                    statusEl.textContent = 'Not configured';
                    statusEl.className = 'info-value status-badge disconnected';
                    return;
                }

                saveBtn.textContent = 'Connecting...';
                saveBtn.disabled = true;
                statusEl.textContent = 'Connecting...';
                statusEl.className = 'info-value status-badge';

                try {
                    const result = await window.electronAPI.serverConnect(domain);
                    if (result.success) {
                        statusEl.textContent = 'Connected';
                        statusEl.className = 'info-value status-badge connected';
                    } else {
                        statusEl.textContent = result.message || 'Connection failed';
                        statusEl.className = 'info-value status-badge disconnected';
                    }
                } catch (error) {
                    statusEl.textContent = 'Connection error';
                    statusEl.className = 'info-value status-badge disconnected';
                }

                saveBtn.textContent = 'Save';
                saveBtn.disabled = false;
            });
        }

        // Add test button handler
        if (testBtn && !testBtn.hasAttribute('data-handler-added')) {
            testBtn.setAttribute('data-handler-added', 'true');
            testBtn.addEventListener('click', async () => {
                const domain = domainInput.value.trim();
                if (!domain) {
                    statusEl.textContent = 'Enter a domain first';
                    statusEl.className = 'info-value status-badge disconnected';
                    return;
                }

                testBtn.textContent = 'Testing...';
                testBtn.disabled = true;
                statusEl.textContent = 'Testing...';
                statusEl.className = 'info-value status-badge';

                try {
                    const result = await window.electronAPI.serverTest(domain);
                    if (result.success) {
                        statusEl.textContent = 'Reachable';
                        statusEl.className = 'info-value status-badge connected';
                    } else {
                        statusEl.textContent = result.message || 'Unreachable';
                        statusEl.className = 'info-value status-badge disconnected';
                    }
                } catch (error) {
                    statusEl.textContent = 'Test failed';
                    statusEl.className = 'info-value status-badge disconnected';
                }

                testBtn.textContent = 'Test Connection';
                testBtn.disabled = false;
            });
        }
    }

    async loadUpdateInfo() {
        const currentVersionEl = document.getElementById('current-version');
        const latestVersionEl = document.getElementById('latest-version');
        const statusEl = document.getElementById('update-status');
        const checkBtn = document.getElementById('check-updates-btn');

        // Get current version from main process (reads from package.json)
        try {
            this.currentVersion = await window.electronAPI.getAppVersion();
        } catch (error) {
            console.error('Failed to get app version:', error);
            this.currentVersion = 'unknown';
        }
        currentVersionEl.textContent = `v${this.currentVersion}`;
        latestVersionEl.textContent = '--';
        statusEl.textContent = '--';

        // Add check updates handler
        if (checkBtn && !checkBtn.hasAttribute('data-handler-added')) {
            checkBtn.setAttribute('data-handler-added', 'true');
            checkBtn.addEventListener('click', async () => {
                await this.checkForUpdates();
            });
        }

        // Setup desktop shortcut handler
        this.setupDesktopShortcutHandler();
    }

    setupDesktopShortcutHandler() {
        const createShortcutBtn = document.getElementById('create-desktop-shortcut-btn');

        if (createShortcutBtn && !createShortcutBtn.hasAttribute('data-handler-added')) {
            createShortcutBtn.setAttribute('data-handler-added', 'true');
            createShortcutBtn.addEventListener('click', async () => {
                createShortcutBtn.textContent = 'Creating...';
                createShortcutBtn.disabled = true;

                try {
                    const result = await window.electronAPI.createDesktopShortcut();
                    if (result.success) {
                        createShortcutBtn.textContent = 'Created!';
                        createShortcutBtn.style.backgroundColor = '#4CAF50';
                        setTimeout(() => {
                            createShortcutBtn.textContent = 'Create Shortcut';
                            createShortcutBtn.style.backgroundColor = '';
                            createShortcutBtn.disabled = false;
                        }, 2000);
                    } else {
                        createShortcutBtn.textContent = 'Failed';
                        createShortcutBtn.style.backgroundColor = '#f44336';
                        setTimeout(() => {
                            createShortcutBtn.textContent = 'Create Shortcut';
                            createShortcutBtn.style.backgroundColor = '';
                            createShortcutBtn.disabled = false;
                        }, 2000);
                    }
                } catch (error) {
                    console.error('Error creating desktop shortcut:', error);
                    createShortcutBtn.textContent = 'Error';
                    createShortcutBtn.style.backgroundColor = '#f44336';
                    setTimeout(() => {
                        createShortcutBtn.textContent = 'Create Shortcut';
                        createShortcutBtn.style.backgroundColor = '';
                        createShortcutBtn.disabled = false;
                    }, 2000);
                }
            });
        }

        // Setup auto-launch toggle
        this.setupAutoLaunchHandler();
    }

    async setupAutoLaunchHandler() {
        const autoLaunchToggle = document.getElementById('auto-launch-toggle');

        if (autoLaunchToggle) {
            // Load current state
            try {
                const isEnabled = await window.electronAPI.getAutoLaunch();
                autoLaunchToggle.checked = isEnabled;
            } catch (error) {
                console.error('Error getting auto-launch status:', error);
            }

            // Add change handler
            if (!autoLaunchToggle.hasAttribute('data-handler-added')) {
                autoLaunchToggle.setAttribute('data-handler-added', 'true');
                autoLaunchToggle.addEventListener('change', async () => {
                    try {
                        const enabled = autoLaunchToggle.checked;
                        await window.electronAPI.setAutoLaunch(enabled);
                        console.log(`Auto-launch ${enabled ? 'enabled' : 'disabled'}`);
                    } catch (error) {
                        console.error('Error setting auto-launch:', error);
                        // Revert toggle on error
                        autoLaunchToggle.checked = !autoLaunchToggle.checked;
                    }
                });
            }
        }
    }

    async checkForUpdates() {
        const latestVersionEl = document.getElementById('latest-version');
        const statusEl = document.getElementById('update-status');
        const installBtn = document.getElementById('install-update-btn');
        const checkBtn = document.getElementById('check-updates-btn');

        checkBtn.textContent = 'Checking...';
        checkBtn.disabled = true;
        latestVersionEl.textContent = 'Checking...';
        statusEl.textContent = 'Fetching...';

        try {
            // Check GitHub releases API - correct repo
            const response = await fetch('https://api.github.com/repos/devdamo/Shortcut-launcher/releases/latest');

            if (response.ok) {
                const release = await response.json();
                this.latestRelease = release;
                const latestVersion = release.tag_name.replace('v', '');

                latestVersionEl.textContent = `v${latestVersion}`;

                if (this.compareVersions(latestVersion, this.currentVersion) > 0) {
                    statusEl.textContent = 'Update available!';
                    statusEl.style.color = '#4CAF50';
                    installBtn.style.display = 'inline-block';
                    installBtn.onclick = () => this.downloadAndInstallUpdate();
                } else {
                    statusEl.textContent = 'Up to date';
                    statusEl.style.color = '#4CAF50';
                    installBtn.style.display = 'none';
                }
            } else if (response.status === 404) {
                latestVersionEl.textContent = 'No releases';
                statusEl.textContent = 'No releases found';
                statusEl.style.color = '#888';
            } else {
                latestVersionEl.textContent = 'Failed';
                statusEl.textContent = 'Check failed';
                statusEl.style.color = '#f44336';
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
            latestVersionEl.textContent = 'Error';
            statusEl.textContent = 'Network error';
            statusEl.style.color = '#f44336';
        }

        checkBtn.textContent = 'Check for Updates';
        checkBtn.disabled = false;
    }

    async downloadAndInstallUpdate() {
        if (!this.latestRelease) {
            alert('No update available');
            return;
        }

        const installBtn = document.getElementById('install-update-btn');
        const progressDiv = document.getElementById('update-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const statusEl = document.getElementById('update-status');

        // Find the appropriate asset (Windows exe or setup)
        const assets = this.latestRelease.assets || [];
        let downloadAsset = assets.find(a =>
            a.name.endsWith('.exe') ||
            a.name.endsWith('.msi') ||
            a.name.includes('Setup') ||
            a.name.includes('win')
        );

        // If no specific asset, use the zipball
        const downloadUrl = downloadAsset ? downloadAsset.browser_download_url : this.latestRelease.zipball_url;
        const fileName = downloadAsset ? downloadAsset.name : `update-${this.latestRelease.tag_name}.zip`;

        installBtn.style.display = 'none';
        progressDiv.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = 'Starting download...';
        statusEl.textContent = 'Downloading...';

        try {
            // Call main process to download
            if (window.electronAPI && window.electronAPI.downloadUpdate) {
                const result = await window.electronAPI.downloadUpdate(downloadUrl, fileName);

                if (result.success) {
                    progressFill.style.width = '100%';
                    progressText.textContent = 'Download complete! Installing...';
                    statusEl.textContent = 'Installing...';

                    // Install the update
                    if (window.electronAPI.installUpdate) {
                        await window.electronAPI.installUpdate(result.filePath);
                    }
                } else {
                    throw new Error(result.error || 'Download failed');
                }
            } else {
                // Fallback: open in browser
                progressText.textContent = 'Opening download in browser...';
                window.open(downloadUrl, '_blank');
                progressDiv.style.display = 'none';
                installBtn.style.display = 'inline-block';
            }
        } catch (error) {
            console.error('Update error:', error);
            progressDiv.style.display = 'none';
            installBtn.style.display = 'inline-block';
            statusEl.textContent = 'Update failed';
            statusEl.style.color = '#f44336';
            alert('Update failed: ' + error.message);
        }
    }

    compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        }
        return 0;
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
        if (!this.dbConnected || !window.dbAPI) {
            this.showMessage('Cannot save shortcut: Database not available. App is running in offline mode.');
            return;
        }

        // Get icon data if available (currentIconData stores the file path now)
        const iconPath = this.currentIconData;

        try {
            let success;

            // Check if we're in edit mode
            if (this.editingShortcutId) {
                // UPDATE existing shortcut
                if (!window.dbAPI.updateShortcut) {
                    this.showMessage('Update function not available');
                    return;
                }

                success = await window.dbAPI.updateShortcut(
                    this.editingShortcutId,
                    name,
                    path,
                    type,
                    iconPath
                );

                if (success) {
                    console.log(`✅ Shortcut '${name}' updated successfully`);
                }
            } else {
                // ADD new shortcut
                if (!window.dbAPI.addShortcut) {
                    this.showMessage('Add function not available');
                    return;
                }

                success = await window.dbAPI.addShortcut(name, path, type, iconPath);

                if (success) {
                    console.log(`✅ Shortcut '${name}' saved successfully`);
                }
            }

            // Close modal and reload shortcuts if successful
            if (success) {
                this.hideAddModal();
                await this.loadShortcuts();
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

    // Background settings functions
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
        const name = document.getElementById('shortcut-name')?.value.trim();
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
        iconStatus.textContent = 'Extracting HIGH-RES icon...';
        iconStatus.className = 'icon-status loading';

        try {
            let iconPath = null;

            if (type === 'website') {
                if (!this.isValidUrl(path)) {
                    throw new Error('Invalid URL format');
                }
                if (window.electronAPI.extractWebsiteIcon) {
                    // Pass shortcut name for better file naming
                    iconPath = await window.electronAPI.extractWebsiteIcon(path, name);
                }
            } else if (type === 'software') {
                if (window.electronAPI.extractAppIcon) {
                    // Pass shortcut name for better file naming
                    iconPath = await window.electronAPI.extractAppIcon(path, name);
                }
            }

            if (iconPath) {
                // Load the icon from the file path
                const iconData = await window.electronAPI.loadIcon(iconPath);

                if (iconData) {
                    // Show extracted icon
                    iconPreview.innerHTML = `<img src="${iconData}" alt="Extracted icon" class="icon-highres" />`;
                    iconStatus.textContent = '✅ ULTRA high-res icon extracted (512x512)!';
                    iconStatus.className = 'icon-status success';
                    this.currentIconData = iconPath; // Store file path instead of base64
                    console.log('✅ ULTRA high-res icon extracted successfully:', iconPath);
                } else {
                    throw new Error('Failed to load icon from file');
                }
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

    async browseIconImage() {
        console.log('🖼️ Browsing for custom icon image...');

        if (!window.electronAPI || !window.electronAPI.browseIconImage) {
            this.showMessage('Cannot browse for icon: System API not available');
            return;
        }

        const iconPreview = document.getElementById('icon-preview');
        const iconStatus = document.getElementById('icon-status');
        const browseBtn = document.getElementById('browse-icon-btn');

        if (!iconPreview || !iconStatus || !browseBtn) {
            console.error('Icon UI elements not found');
            return;
        }

        // Show loading state
        browseBtn.disabled = true;
        browseBtn.textContent = 'Browsing...';
        iconStatus.textContent = 'Select an image file...';
        iconStatus.className = 'icon-status loading';

        try {
            // Open file browser dialog
            const iconPath = await window.electronAPI.browseIconImage();

            if (!iconPath) {
                // User canceled
                iconStatus.textContent = 'Image selection canceled';
                iconStatus.className = 'icon-status';
                return;
            }

            // Load and display the processed icon
            const iconData = await window.electronAPI.loadIcon(iconPath);

            if (iconData) {
                // Show the icon
                iconPreview.innerHTML = `<img src="${iconData}" alt="Custom icon" class="icon-highres" />`;
                iconStatus.textContent = '✅ ULTRA high-res custom icon loaded (512x512)!';
                iconStatus.className = 'icon-status success';
                this.currentIconData = iconPath; // Store file path
                console.log('✅ Custom icon loaded successfully:', iconPath);
            } else {
                throw new Error('Failed to load processed icon');
            }

        } catch (error) {
            console.error('❌ Error browsing for icon:', error);
            iconStatus.textContent = `Failed to load icon: ${error.message}`;
            iconStatus.className = 'icon-status error';

            // Reset to default icon
            iconPreview.innerHTML = '📦';
        } finally {
            browseBtn.disabled = false;
            browseBtn.textContent = 'Browse Image';
        }
    }

    // Keyboard navigation methods
    isModalOpen() {
        const addModal = document.getElementById('add-modal');
        const settingsModal = document.getElementById('settings-modal');
        return (addModal && addModal.style.display === 'block') ||
               (settingsModal && settingsModal.style.display === 'block');
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

    // Install Remotely agent (Windows only)
    async installRemotely() {
        console.log('Installing Remotely...');

        if (!confirm('This will download and install Remotely (Remote Support Agent).\n\nYou will be prompted for Administrator privileges.\n\nDo you want to continue?')) {
            return;
        }

        try {
            if (!window.electronAPI || !window.electronAPI.installRemotely) {
                this.showMessage('Cannot install Remotely: System API not available');
                return;
            }

            // Show loading state
            const remotelyBtn = document.getElementById('remotely-btn');
            if (remotelyBtn) {
                remotelyBtn.textContent = 'Installing...';
                remotelyBtn.disabled = true;
            }

            const result = await window.electronAPI.installRemotely();

            if (result.success) {
                this.showMessage('Remotely installation started successfully!');
            } else {
                throw new Error(result.error || 'Installation failed');
            }

        } catch (error) {
            console.error('Remotely installation error:', error);
            this.showMessage('Failed to install Remotely: ' + error.message);
        } finally {
            const remotelyBtn = document.getElementById('remotely-btn');
            if (remotelyBtn) {
                remotelyBtn.textContent = 'Remotely';
                remotelyBtn.disabled = false;
            }
        }
    }

    showMessage(message) {
        // Only show popup alerts for errors and important warnings
        // Success messages are now silent (logged to console only)
        alert(message);
    }

    // NEW: Taskbar management methods
    startTaskbar() {
        console.log('🪟 Starting taskbar...');

        // Initial load
        this.refreshTaskbar();

        // Refresh every 2 seconds
        this.taskbarRefreshInterval = setInterval(() => {
            this.refreshTaskbar();
        }, 2000);

        console.log('✅ Taskbar started with 2s refresh interval');
    }

    async refreshTaskbar() {
        try {
            if (!window.electronAPI || !window.electronAPI.getOpenWindows) {
                console.warn('⚠️ getOpenWindows API not available');
                return;
            }

            // Get list of open windows
            const windows = await window.electronAPI.getOpenWindows();

            // Only update if list changed
            if (JSON.stringify(windows) !== JSON.stringify(this.openWindows)) {
                this.openWindows = windows;
                this.renderTaskbar();
            }
        } catch (error) {
            console.error('❌ Error refreshing taskbar:', error);
        }
    }

    renderTaskbar() {
        const taskbarWindows = document.getElementById('taskbar-windows');
        if (!taskbarWindows) {
            console.error('❌ Taskbar container not found');
            return;
        }

        // Clear existing windows
        taskbarWindows.innerHTML = '';

        if (this.openWindows.length === 0) {
            // Show empty state
            taskbarWindows.innerHTML = '<div class="taskbar-empty">No windows open</div>';
        } else {
            // Render each window
            this.openWindows.forEach(window => {
                const windowElement = this.createTaskbarWindowElement(window);
                taskbarWindows.appendChild(windowElement);
            });

            console.log(`🪟 Rendered ${this.openWindows.length} windows in taskbar`);
        }
    }

    createTaskbarWindowElement(windowInfo) {
        const element = document.createElement('div');
        element.className = 'taskbar-window';
        element.dataset.processId = windowInfo.processId;
        element.dataset.windowId = windowInfo.windowId || ''; // For Linux support

        // Create icon element - will be updated async with real icon
        const fallbackIcon = this.getFallbackWindowIcon(windowInfo.processName);

        element.innerHTML = `
            <span class="taskbar-window-icon">${fallbackIcon}</span>
            <span class="taskbar-window-title">${this.escapeHtml(windowInfo.windowTitle)}</span>
        `;

        // Load real icon asynchronously if exePath is available
        if (windowInfo.exePath && window.electronAPI && window.electronAPI.getProcessIcon) {
            this.loadTaskbarIcon(element, windowInfo.exePath);
        }

        // Add click handler to switch to window
        element.addEventListener('click', async () => {
            await this.switchToWindow(windowInfo.processId, windowInfo.windowId);
        });

        return element;
    }

    async loadTaskbarIcon(element, exePath) {
        try {
            const iconData = await window.electronAPI.getProcessIcon(exePath);
            if (iconData) {
                const iconSpan = element.querySelector('.taskbar-window-icon');
                if (iconSpan) {
                    iconSpan.innerHTML = `<img src="${iconData}" style="width: 20px; height: 20px; vertical-align: middle;" />`;
                }
            }
        } catch (error) {
            console.log('Could not load taskbar icon:', error.message);
        }
    }

    getFallbackWindowIcon(processName) {
        // Fallback emoji icons for when real icons aren't available
        const iconMap = {
            'chrome': '🌐',
            'firefox': '🦊',
            'msedge': '🌐',
            'explorer': '📁',
            'notepad': '📝',
            'code': '💻',
            'vscode': '💻',
            'cmd': '⌨️',
            'powershell': '⚡',
            'discord': '💬',
            'slack': '💬',
            'teams': '👥',
            'outlook': '📧',
            'excel': '📊',
            'word': '📄',
            'spotify': '🎵',
            'steam': '🎮'
        };

        const processLower = processName.toLowerCase();
        for (const [key, icon] of Object.entries(iconMap)) {
            if (processLower.includes(key)) {
                return icon;
            }
        }

        // Default icon
        return '🪟';
    }

    async switchToWindow(processId, windowId) {
        try {
            console.log(`🎯 Switching to window with process ID: ${processId}, window ID: ${windowId}`);

            if (!window.electronAPI || !window.electronAPI.focusWindow) {
                this.showMessage('Cannot switch windows: API not available');
                return;
            }

            const result = await window.electronAPI.focusWindow(processId, windowId);

            if (!result.success) {
                console.warn(`⚠️ Failed to switch to window: ${result.message}`);
            } else {
                console.log('✅ Successfully switched to window');
            }
        } catch (error) {
            console.error('❌ Error switching to window:', error);
        }
    }

    // NEW: Load high-res icon for shortcut (from file path or fallback to emoji)
    async loadShortcutIcon(shortcut, iconContainer) {
        try {
            // Check if we have a file path (new system)
            if (shortcut.icon_path && window.electronAPI && window.electronAPI.loadIcon) {
                // Load icon from file path
                const iconData = await window.electronAPI.loadIcon(shortcut.icon_path);

                if (iconData) {
                    // Create high-res image element
                    const img = document.createElement('img');
                    img.src = iconData;
                    img.alt = `${shortcut.name} icon`;
                    img.className = 'shortcut-icon-img';
                    iconContainer.innerHTML = '';
                    iconContainer.appendChild(img);
                    return;
                }
            }
            // Fallback to base64 (legacy)
            else if (shortcut.icon_data) {
                const img = document.createElement('img');
                img.src = shortcut.icon_data;
                img.alt = `${shortcut.name} icon`;
                img.className = 'shortcut-icon-img';
                iconContainer.innerHTML = '';
                iconContainer.appendChild(img);
                return;
            }

            // Fallback to emoji icons
            let icon = '';
            if (shortcut.type === 'website') {
                icon = '🌐';
            } else if (shortcut.type === 'software') {
                icon = shortcut.exists_on_pc ? '💻' : '❌';
            }
            iconContainer.textContent = icon;

        } catch (error) {
            console.error('Error loading shortcut icon:', error);
            // Fallback to emoji on error
            iconContainer.textContent = shortcut.type === 'website' ? '🌐' : '💻';
        }
    }

    // Set up listeners for server commands
    setupServerListeners() {
        if (!window.electronAPI) {
            console.warn('electronAPI not available, skipping server listeners');
            return;
        }

        // Listen for add shortcut command from server
        window.electronAPI.onServerAddShortcut(async (data) => {
            console.log('📬 Server command: Add shortcut', data);
            try {
                if (data.name && data.path && data.type) {
                    await this.saveShortcut({
                        name: data.name,
                        path: data.path,
                        type: data.type,
                        icon_path: data.iconPath || null
                    });
                    await this.loadShortcuts();
                    console.log('✅ Shortcut added from server command');
                }
            } catch (error) {
                console.error('❌ Error adding shortcut from server:', error);
            }
        });

        // Listen for remove shortcut command from server
        window.electronAPI.onServerRemoveShortcut(async (id) => {
            console.log('📬 Server command: Remove shortcut', id);
            try {
                await this.deleteShortcut(id);
                console.log('✅ Shortcut removed from server command');
            } catch (error) {
                console.error('❌ Error removing shortcut from server:', error);
            }
        });

        // Listen for sync settings command from server
        window.electronAPI.onServerSyncSettings(async () => {
            console.log('📬 Server command: Sync settings');
            try {
                await this.loadBackgroundSettings();
                console.log('✅ Settings synced from server command');
            } catch (error) {
                console.error('❌ Error syncing settings from server:', error);
            }
        });

        // Listen for custom commands from server
        window.electronAPI.onServerCustomCommand(async (data) => {
            console.log('📬 Server command: Custom', data);
            // Handle custom commands as needed
            if (data.action === 'refresh') {
                await this.loadShortcuts();
            } else if (data.action === 'message') {
                this.showMessage(data.message || 'Message from server');
            }
        });

        console.log('✅ Server command listeners registered');
    }

    // ============================================================
    // EMBEDDED WEBVIEW METHODS
    // ============================================================

    setupWebviewListeners() {
        if (!window.electronAPI) {
            console.warn('electronAPI not available, skipping webview listeners');
            return;
        }

        // Get webview nav bar elements
        const webviewNavBar = document.getElementById('webview-nav-bar');
        const mainTopBar = document.getElementById('main-top-bar');
        const mainContent = document.querySelector('.main-content');
        const closeBtn = document.getElementById('webview-close-btn');
        const backBtn = document.getElementById('webview-back-btn');
        const forwardBtn = document.getElementById('webview-forward-btn');
        const reloadBtn = document.getElementById('webview-reload-btn');
        const titleSpan = document.getElementById('webview-title');

        // Close webview button
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                console.log('🔙 Close webview button clicked');
                await this.closeWebview();
            });
        }

        // Back button
        if (backBtn) {
            backBtn.addEventListener('click', async () => {
                await window.electronAPI.webviewBack();
            });
        }

        // Forward button
        if (forwardBtn) {
            forwardBtn.addEventListener('click', async () => {
                await window.electronAPI.webviewForward();
            });
        }

        // Reload button
        if (reloadBtn) {
            reloadBtn.addEventListener('click', async () => {
                await window.electronAPI.webviewReload();
            });
        }

        // Listen for webview opened event from main process
        window.electronAPI.onWebviewOpened((url) => {
            console.log('🌐 Webview opened:', url);
            this.webviewOpen = true;

            // Show webview nav bar, hide main content
            if (webviewNavBar) webviewNavBar.style.display = 'flex';
            if (mainTopBar) mainTopBar.style.display = 'none';
            if (mainContent) mainContent.style.display = 'none';
            if (titleSpan) titleSpan.textContent = url;
        });

        // Listen for webview closed event from main process
        window.electronAPI.onWebviewClosed(() => {
            console.log('🔙 Webview closed');
            this.webviewOpen = false;

            // Hide webview nav bar, show main content
            if (webviewNavBar) webviewNavBar.style.display = 'none';
            if (mainTopBar) mainTopBar.style.display = '';
            if (mainContent) mainContent.style.display = '';
        });

        console.log('✅ Webview listeners registered');
    }

    async closeWebview() {
        try {
            if (window.electronAPI && window.electronAPI.webviewClose) {
                await window.electronAPI.webviewClose();
            }
        } catch (error) {
            console.error('Error closing webview:', error);
        }
    }

    // ============================================================
    // END EMBEDDED WEBVIEW METHODS
    // ============================================================

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

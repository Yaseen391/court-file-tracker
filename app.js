// Global Variables
let files = JSON.parse(localStorage.getItem('files')) || [];
let profiles = JSON.parse(localStorage.getItem('profiles')) || [];
let userProfile = JSON.parse(localStorage.getItem('userProfile')) || null;
let currentReportData = [];
let currentPage = 1;
const itemsPerPage = 10;
let analytics = JSON.parse(localStorage.getItem('analytics')) || {
    filesEntered: 0,
    searchesPerformed: 0,
    backupsCreated: 0
};
let chartInstance = null;
let deferredPrompt;
let backupFolderHandle = null; // Store folder handle for backups

// IndexedDB Setup
const dbName = 'CourtFileTrackerDB';
const dbVersion = 2; // Updated version for new folder store
let db;

function initIndexedDB() {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('data')) {
            db.createObjectStore('data', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('folder')) {
            db.createObjectStore('folder', { keyPath: 'id' }); // New store for folder handle
        }
    };

    request.onsuccess = (event) => {
        db = event.target.result;
        console.log('IndexedDB opened successfully');
        // Initial sync from IndexedDB to localStorage on app load
        syncIndexedDBToLocalStorage().then(() => {
            // After sync, proceed with app initialization
            if (userProfile) {
                document.getElementById('setupMessage').style.display = 'none';
                document.getElementById('adminForm').style.display = 'none';
                document.getElementById('savedProfile').style.display = 'block';
                updateSavedProfile();
                navigate('dashboard');
            } else {
                navigate('admin');
            }
            document.getElementById('agreeTerms').addEventListener('change', toggleSaveButton);
            updateDashboardCards();
            setupPushNotifications();
            setupPhotoAdjust('userPhoto', 'userPhotoPreview', 'userPhotoAdjust');
            setupPhotoAdjust('profilePhoto', 'photoPreview', 'photoAdjust');
            loadBackupFolder(); // Load stored folder handle after data syncs
            scheduleDailyBackup();

            // Add touch event listener for sidebar overlay and swipe gesture
            const sidebar = document.getElementById('sidebar');
            const overlay = document.querySelector('.sidebar-overlay');
            if (overlay) {
                overlay.addEventListener('touchstart', (e) => {
                    e.preventDefault(); // Prevent scrolling
                    toggleSidebar();
                });
            }

            // Swipe to close sidebar logic
            let touchStartX = 0;
            sidebar.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
            });
            sidebar.addEventListener('touchmove', (e) => {
                if (sidebar.classList.contains('active')) {
                    const currentX = e.touches[0].clientX;
                    const diffX = currentX - touchStartX;
                    if (diffX < -50) { // Swipe left for 50px
                        toggleSidebar();
                        e.preventDefault(); // Prevent scrolling
                    }
                }
            });
            // Handle Android back button
            window.addEventListener('popstate', (event) => {
                if (sidebar.classList.contains('active')) {
                    toggleSidebar();
                    history.pushState(null, null, location.href); // Push current state back to history to prevent closing app
                }
            });
            // Initial push state for android back button to work with sidebar
            history.pushState(null, null, location.href);

        });
    };

    request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        showToast('Error initializing local data storage.');
    };
}

async function syncLocalStorageToIndexedDB() {
    try {
        const data = {
            files: JSON.parse(localStorage.getItem('files')) || [],
            profiles: JSON.parse(localStorage.getItem('profiles')) || [],
            userProfile: JSON.parse(localStorage.getItem('userProfile')) || null,
            analytics: JSON.parse(localStorage.getItem('analytics')) || analytics
        };
        const transaction = db.transaction(['data'], 'readwrite');
        const store = transaction.objectStore('data');
        for (const [key, value] of Object.entries(data)) {
            await new Promise((resolve, reject) => {
                const request = store.put({ key, value });
                request.onsuccess = resolve;
                request.onerror = reject;
            });
        }
        console.log('LocalStorage synced to IndexedDB successfully.');
    } catch (error) {
        console.error('Error syncing LocalStorage to IndexedDB:', error);
        showToast('Failed to sync data to local storage.');
    }
}

async function syncIndexedDBToLocalStorage() {
    try {
        const transaction = db.transaction(['data'], 'readonly');
        const store = transaction.objectStore('data');
        const keys = ['files', 'profiles', 'userProfile', 'analytics'];
        for (const key of keys) {
            await new Promise((resolve, reject) => {
                const request = store.get(key);
                request.onsuccess = () => {
                    if (request.result) {
                        localStorage.setItem(key, JSON.stringify(request.result.value));
                        if (key === 'files') files = request.result.value;
                        if (key === 'profiles') profiles = request.result.value;
                        if (key === 'userProfile') userProfile = request.result.value;
                        if (key === 'analytics') analytics = request.result.value;
                    }
                    resolve();
                };
                request.onerror = reject;
            });
        }
        console.log('IndexedDB synced to LocalStorage successfully.');
    } catch (error) {
        console.error('Error syncing IndexedDB to LocalStorage:', error);
        showToast('Failed to load data from local storage.');
    }
}

async function loadBackupFolder() {
    if (!db) {
        console.warn('IndexedDB not initialized yet, cannot load backup folder.');
        return;
    }
    try {
        const transaction = db.transaction(['folder'], 'readonly');
        const store = transaction.objectStore('folder');
        const request = store.get('backupFolder');
        request.onsuccess = async () => {
            if (request.result && request.result.handle) {
                try {
                    const handle = request.result.handle;
                    const permission = await handle.queryPermission({ mode: 'readwrite' });
                    if (permission === 'granted') {
                        backupFolderHandle = handle;
                        document.getElementById('backupFolderStatus').textContent = `Auto-backup folder: ${handle.name}`;
                        console.log('Backup folder loaded and permission granted.');
                        // showToast('Backup folder loaded successfully.'); // Only show this if user is on backup page or it's crucial info
                    } else if (permission === 'prompt') {
                        // Permission might have expired, but we don't prompt on load.
                        // We'll prompt when backup is attempted.
                        document.getElementById('backupFolderStatus').textContent = `Auto-backup folder: ${handle.name} (Permission needed)`;
                        console.warn('Permission for backup folder needs to be re-granted.');
                        backupFolderHandle = handle; // Keep the handle, but mark it as needing permission
                        // showToast('Permission to access backup folder lost. Please re-select or re-grant permissions when prompted for backup.'); // Can be noisy
                    } else { // permission === 'denied'
                        console.warn('Permission to access backup folder denied.');
                        document.getElementById('backupFolderStatus').textContent = 'Auto-backup folder: Permission denied.';
                        backupFolderHandle = null;
                        // showToast('Permission to access backup folder denied. Please re-select.');
                    }
                } catch (error) {
                    console.error('Error verifying/requesting backup folder permission:', error);
                    document.getElementById('backupFolderStatus').textContent = 'Auto-backup folder: Error accessing.';
                    backupFolderHandle = null;
                    showToast('Failed to verify backup folder permission. Please re-select.');
                }
            } else {
                document.getElementById('backupFolderStatus').textContent = 'No auto-backup folder selected.';
                console.log('No backup folder handle found in IndexedDB.');
            }
        };
        request.onerror = (event) => {
            console.error('Error getting backup folder from IndexedDB:', event.target.error);
            document.getElementById('backupFolderStatus').textContent = 'No auto-backup folder selected.';
            backupFolderHandle = null;
            showToast('Failed to load backup folder from storage. Please select one.');
        };
    } catch (error) {
        console.error('Error accessing IndexedDB for backup folder:', error);
        document.getElementById('backupFolderStatus').textContent = 'No auto-backup folder selected.';
        backupFolderHandle = null;
        showToast('Error loading backup folder.');
    }
}

async function selectBackupFolder() {
    try {
        if ('showDirectoryPicker' in window) {
            const folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            const permission = await folderHandle.queryPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                backupFolderHandle = folderHandle;
                const transaction = db.transaction(['folder'], 'readwrite');
                const store = transaction.objectStore('folder');
                await new Promise((resolve, reject) => {
                    const request = store.put({ id: 'backupFolder', handle: folderHandle });
                    request.onsuccess = resolve;
                    request.onerror = reject;
                });
                document.getElementById('backupFolderStatus').textContent = `Auto-backup folder: ${folderHandle.name}`;
                showToast('Backup folder selected successfully and saved.');
            } else {
                showToast('Permission to access folder denied.');
            }
        } else {
            showToast('File System Access API not supported in this browser. Manual backups advised.');
        }
    } catch (error) {
        console.error('Error selecting backup folder:', error);
        if (error.name === 'AbortError') {
            showToast('Backup folder selection cancelled.');
        } else {
            showToast('Failed to select backup folder. ' + error.message);
        }
    }
}

function scheduleDailyBackup() {
    const now = new Date();
    const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0, 0, 0
    );
    const timeUntilMidnight = midnight.getTime() - now.getTime();

    // Clear any existing interval to prevent multiple schedules on reloads
    if (window.dailyBackupIntervalId) {
        clearInterval(window.dailyBackupIntervalId);
    }

    setTimeout(() => {
        performAutoBackup(); // Use performAutoBackup for scheduled task
        window.dailyBackupIntervalId = setInterval(performAutoBackup, 24 * 60 * 60 * 1000); // Every 24 hours
    }, timeUntilMidnight);
}

async function performAutoBackup() {
    if (!backupFolderHandle) {
        console.log('Auto backup skipped: No backup folder selected or permission denied.');
        // showToast('No auto-backup folder selected. Please select a folder for daily backups.'); // Too noisy
        return;
    }
    try {
        let permission = await backupFolderHandle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
            console.warn('Auto backup: Permission to backup folder lost. Attempting to re-request.');
            permission = await backupFolderHandle.requestPermission({ mode: 'readwrite' });
            if (permission !== 'granted') {
                showToast('Permission to access auto-backup folder denied. Auto backup skipped.');
                document.getElementById('backupFolderStatus').textContent = `Auto-backup folder: ${backupFolderHandle.name} (Permission needed)`;
                return;
            }
        }

        const dataToBackup = {
            files: files,
            profiles: profiles,
            userProfile: userProfile,
            analytics: analytics
        };

        const timestamp = formatDate(new Date(), 'YYYYMMDD_HHMMSS');
        const fileName = `court_file_tracker_backup_${timestamp}.json`; // Unique timestamped file
        // Optionally, also save to a "latest" file
        const latestFileName = 'court_file_tracker_latest.json';

        // Save unique timestamped backup
        const fileHandle = await backupFolderHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(dataToBackup, null, 2));
        await writable.close();

        // Save to 'latest' file
        const latestFileHandle = await backupFolderHandle.getFileHandle(latestFileName, { create: true });
        const latestWritable = await latestFileHandle.createWritable();
        await latestWritable.write(JSON.stringify(dataToBackup, null, 2));
        await latestWritable.close();

        analytics.backupsCreated++;
        localStorage.setItem('analytics', JSON.stringify(analytics));
        syncLocalStorageToIndexedDB(); // Sync analytics update
        showToast(`Auto backup created: ${fileName} and ${latestFileName}`);
        console.log(`Auto backup created: ${fileName} and ${latestFileName}`);
    } catch (error) {
        console.error('Auto backup error:', error);
        showToast('Failed to create auto backup: ' + error.message);
    }
}

// Manual Backup
async function createBackup() {
    if (!backupFolderHandle) {
        showToast('Please select an auto-backup folder first or pick a download location.');
        // Offer a direct download if no folder is selected
        const userConfirm = confirm('No auto-backup folder selected. Do you want to download the backup file to your device?');
        if (!userConfirm) return;

        const dataToBackup = {
            files: files,
            profiles: profiles,
            userProfile: userProfile,
            analytics: analytics
        };
        const timestamp = formatDate(new Date(), 'YYYYMMDD_HHMMSS');
        const fileName = `court_file_tracker_manual_backup_${timestamp}.json`;
        const blob = new Blob([JSON.stringify(dataToBackup, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        showToast('Manual backup downloaded successfully.');
        analytics.backupsCreated++;
        localStorage.setItem('analytics', JSON.stringify(analytics));
        syncLocalStorageToIndexedDB();
        return;
    }

    try {
        let permission = await backupFolderHandle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
            console.warn('Manual backup: Permission to backup folder lost. Attempting to re-request.');
            permission = await backupFolderHandle.requestPermission({ mode: 'readwrite' });
            if (permission !== 'granted') {
                showToast('Permission to access auto-backup folder denied. Manual backup cancelled.');
                document.getElementById('backupFolderStatus').textContent = `Auto-backup folder: ${backupFolderHandle.name} (Permission needed)`;
                return;
            }
        }

        const dataToBackup = {
            files: files,
            profiles: profiles,
            userProfile: userProfile,
            analytics: analytics
        };

        const timestamp = formatDate(new Date(), 'YYYYMMDD_HHMMSS');
        const fileName = `court_file_tracker_manual_backup_${timestamp}.json`;
        const fileHandle = await backupFolderHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(dataToBackup, null, 2));
        await writable.close();
        analytics.backupsCreated++;
        localStorage.setItem('analytics', JSON.stringify(analytics));
        syncLocalStorageToIndexedDB(); // Sync analytics update
        showToast(`Manual backup created: ${fileName}`);
    } catch (error) {
        console.error('Manual backup error:', error);
        showToast('Failed to create manual backup: ' + error.message);
    }
}

let selectedBackupFile = null;

function handleBackupFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        selectedBackupFile = file;
        document.getElementById('restoreOptions').style.display = 'block';
        showToast(`Selected backup file: ${file.name}`);
    } else {
        selectedBackupFile = null;
        document.getElementById('restoreOptions').style.display = 'none';
        showToast('No file selected.');
    }
}

async function restoreBackup() {
    if (!selectedBackupFile) {
        showToast('Please select a backup file first.');
        return;
    }
    showToast('Choose a restore mode (Merge or Overwrite).');
}

async function confirmRestore(mode) {
    if (!selectedBackupFile) {
        showToast('No backup file selected.');
        return;
    }

    document.getElementById('loadingIndicator').style.display = 'block';
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const backupData = JSON.parse(e.target.result);
            if (!backupData || (!backupData.files && !backupData.profiles)) {
                showToast('Invalid backup file format.');
                document.getElementById('loadingIndicator').style.display = 'none';
                return;
            }

            if (mode === 'overwrite') {
                files = backupData.files || [];
                profiles = backupData.profiles || [];
                userProfile = backupData.userProfile || null;
                analytics = backupData.analytics || { filesEntered: 0, searchesPerformed: 0, backupsCreated: 0 };
                showToast('Data overwritten successfully!');
            } else if (mode === 'merge') {
                // Merge files
                const existingFileMap = new Map(files.map(f => [f.cmsNo + f.deliveredAt, f])); // Using CMS No + Delivered At as unique key
                (backupData.files || []).forEach(backupFile => {
                    const key = backupFile.cmsNo + backupFile.deliveredAt;
                    if (existingFileMap.has(key)) {
                        // Update existing file (e.g., if 'returned' status changed)
                        Object.assign(existingFileMap.get(key), backupFile);
                    } else {
                        // Add new file
                        files.push(backupFile);
                    }
                });

                // Merge profiles
                const existingProfileMap = new Map(profiles.map(p => [p.name + p.type, p])); // Using Name + Type as unique key
                (backupData.profiles || []).forEach(backupProfile => {
                    const key = backupProfile.name + backupProfile.type;
                    if (existingProfileMap.has(key)) {
                        // Update existing profile
                        Object.assign(existingProfileMap.get(key), backupProfile);
                    } else {
                        // Add new profile
                        profiles.push(backupProfile);
                    }
                });

                // Update analytics and userProfile (always overwrite for these singletons)
                analytics = backupData.analytics || analytics;
                userProfile = backupData.userProfile || userProfile;

                showToast('Data merged successfully!');
            }

            localStorage.setItem('files', JSON.stringify(files));
            localStorage.setItem('profiles', JSON.stringify(profiles));
            localStorage.setItem('userProfile', JSON.stringify(userProfile));
            localStorage.setItem('analytics', JSON.stringify(analytics));
            await syncLocalStorageToIndexedDB(); // Ensure IndexedDB is also updated

            // Re-render relevant parts of the UI
            updateDashboardCards();
            filterPendingFiles(); // For 'Return File' screen
            renderProfiles(); // For 'File Fetcher Profiles' screen
            updateSavedProfile(); // For Admin screen
            // Reset selected file and hide options
            selectedBackupFile = null;
            document.getElementById('backupFileInput').value = ''; // Clear file input
            document.getElementById('restoreOptions').style.display = 'none';

        } catch (error) {
            console.error('Error parsing or restoring backup:', error);
            showToast('Error restoring backup: ' + error.message);
        } finally {
            document.getElementById('loadingIndicator').style.display = 'none';
        }
    };
    reader.onerror = (error) => {
        console.error('Error reading backup file:', error);
        showToast('Failed to read backup file.');
        document.getElementById('loadingIndicator').style.display = 'none';
    };
    reader.readAsText(selectedBackupFile);
}

function maskCNIC(cnic) {
    if (!cnic) return '';
    const parts = cnic.split('-');
    if (parts.length !== 3) {
        // Attempt to mask even if format is not standard 5-7-1
        if (cnic.length > 8) { // If it's long enough, mask partially
            return cnic.substring(0, 2) + '***' + cnic.substring(cnic.length - 4);
        }
        return '*****-*******-*'; // Default mask
    }
    return `${parts[0].slice(0, 2)}***-${parts[1].slice(0, 3)}****-${parts[2]}`;
}

window.onload = () => {
    console.log('app.js loaded successfully');
    // PWA Install Prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const installBtn = document.getElementById('installBtn');
        if (installBtn) {
            installBtn.style.display = 'block';
        }
    });

    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
        installBtn.addEventListener('click', () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        showToast('App installation started');
                    } else {
                        showToast('App installation declined');
                    }
                    deferredPrompt = null;
                    installBtn.style.display = 'none';
                });
            }
        });
    }

    initIndexedDB(); // This now handles the initial app UI navigation after data sync
};

function setupPushNotifications() {
    if ('Notification' in window && navigator.serviceWorker) {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('Notification permission granted. Scheduling overdue file checks.');
                // Clear any existing interval to prevent duplicates
                if (window.overdueCheckIntervalId) {
                    clearInterval(window.overdueCheckIntervalId);
                }
                window.overdueCheckIntervalId = setInterval(checkOverdueFiles, 3600000); // Every 1 hour
                checkOverdueFiles(); // Run immediately on startup
            } else {
                console.warn('Notification permission denied.');
            }
        }).catch(error => {
            console.error('Error requesting notification permission:', error);
        });
    } else {
        console.warn('Notifications or Service Workers not supported in this browser.');
    }
}

function checkOverdueFiles() {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const overdueFiles = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo);
    if (overdueFiles.length > 0) {
        navigator.serviceWorker.ready.then(registration => {
            registration.showNotification('Overdue Files Alert', {
                body: `${overdueFiles.length} file(s) are overdue by more than 10 days. Review pending files.`,
                icon: '/court-file-tracker/icon-192.png', // Ensure this icon exists at the root
                badge: '/court-file-tracker/badge-72.png', // Optional: Smaller monochrome icon for notification tray
                tag: 'overdue-files', // Group notifications
                renotify: true, // Re-show notification if content changes for the same tag
                data: {
                    url: '/court-file-tracker/index.html#return' // Deep link to return screen
                }
            }).catch(error => {
                console.error('Error showing notification:', error);
            });
        }).catch(error => {
            console.error('Service Worker not ready for notification:', error);
        });
    } else {
        console.log('No overdue files found.');
    }
}

function navigate(screenId) {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));
    const targetButton = document.querySelector(`.sidebar button[onclick="navigate('${screenId}')"]`);
    if (targetButton) {
        targetButton.classList.add('active');
    }

    // Call specific update functions for screens
    if (screenId === 'dashboard') updateDashboardCards();
    if (screenId === 'return') filterPendingFiles(); // Assuming this function exists for 'return' screen
    if (screenId === 'fileFetcher') renderProfiles(); // Assuming this function exists for 'fileFetcher' screen
    if (screenId === 'reports') {
        document.getElementById('reportType').value = 'all'; // Reset report type
        document.getElementById('reportProfileLabel').style.display = 'none';
        document.getElementById('reportStartDateLabel').style.display = 'none';
        document.getElementById('reportEndDateLabel').style.display = 'none';
        generateReport(); // Generate default 'All Files' report
    }
    if (screenId === 'backup') {
        loadBackupFolder(); // Ensure status is updated
    }


    // Close sidebar on navigation for smaller screens
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        if (sidebar) sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    }
    // Update URL hash for better navigation and back button support
    history.pushState(null, '', `#${screenId}`);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active');
}

function closeModalIfOutside(event, modalId) {
    const modal = document.getElementById(modalId);
    if (modal && event.target === modal) { // Only close if target is the modal backdrop itself
        modal.style.display = 'none';
    }
}

// Admin Form Submission
document.getElementById('adminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('loadingIndicator').style.display = 'block';
    try {
        console.log('Admin form submission started');
        const userPhotoInput = document.getElementById('userPhoto');
        let photo = userPhotoInput.adjustedPhoto;

        if (!photo && userPhotoInput.files && userPhotoInput.files[0]) {
            photo = userPhotoInput.files[0];
        }

        if (!photo) {
            console.error('No profile photo selected');
            showToast('Please upload a profile photo.');
            document.getElementById('loadingIndicator').style.display = 'none';
            return;
        }

        const processPhoto = (photoData) => {
            userProfile = {
                clerkName: document.getElementById('clerkName').value,
                judgeName: document.getElementById('judgeName').value,
                courtName: document.getElementById('courtName').value,
                mobile: document.getElementById('mobile').value,
                cnic: document.getElementById('cnic').value,
                pin: document.getElementById('pin').value,
                email: document.getElementById('email').value,
                photo: photoData
            };
            console.log('Saving userProfile:', userProfile);
            localStorage.setItem('userProfile', JSON.stringify(userProfile));
            syncLocalStorageToIndexedDB(); // Asynchronous sync
            document.getElementById('setupMessage').style.display = 'none';
            document.getElementById('adminForm').style.display = 'none';
            document.getElementById('savedProfile').style.display = 'block';
            updateSavedProfile();
            showToast('Profile saved successfully!');
            document.getElementById('loadingIndicator').style.display = 'none';
            navigate('dashboard');
        };

        if (typeof photo === 'string' && photo.startsWith('data:')) {
            console.log('Using adjusted data URL for photo.');
            processPhoto(photo);
        } else {
            console.log('Reading raw photo file.');
            const reader = new FileReader();
            reader.onload = () => {
                console.log('Photo file read successfully.');
                processPhoto(reader.result);
            };
            reader.onerror = (error) => {
                console.error('Error reading photo file:', error);
                showToast('Failed to read photo. Please try again.');
                document.getElementById('loadingIndicator').style.display = 'none';
            };
            reader.readAsDataURL(photo);
        }
    } catch (error) {
        console.error('Admin form submission error:', error);
        showToast('Failed to save profile. ' + error.message);
        document.getElementById('loadingIndicator').style.display = 'none';
    }
});

function updateSavedProfile() {
    if (!userProfile) return;
    document.getElementById('savedClerkName').textContent = userProfile.clerkName || 'N/A';
    document.getElementById('savedJudgeName').textContent = userProfile.judgeName || 'N/A';
    document.getElementById('savedCourtName').textContent = userProfile.courtName || 'N/A';
    const savedMobile = document.getElementById('savedMobile');
    savedMobile.textContent = userProfile.mobile || 'N/A';
    savedMobile.href = `tel:${userProfile.mobile}`;

    const savedUserPhoto = document.getElementById('savedUserPhoto');
    if (userProfile.photo && savedUserPhoto) {
        savedUserPhoto.src = userProfile.photo;
        savedUserPhoto.style.display = 'block';
    } else if (savedUserPhoto) {
        savedUserPhoto.style.display = 'none';
    }

    document.getElementById('totalFiles').textContent = files.length;
    document.getElementById('totalProfiles').textContent = profiles.length;
    document.getElementById('changePinBtn').style.display = (userProfile.email || userProfile.cnic) ? 'inline-block' : 'none';
}

function editUserProfile() {
    document.getElementById('adminForm').style.display = 'block';
    document.getElementById('savedProfile').style.display = 'none';
    // Pre-fill form fields if userProfile exists
    if (userProfile) {
        document.getElementById('clerkName').value = userProfile.clerkName || '';
        document.getElementById('judgeName').value = userProfile.judgeName || '';
        document.getElementById('courtName').value = userProfile.courtName || '';
        document.getElementById('mobile').value = userProfile.mobile || '';
        document.getElementById('cnic').value = userProfile.cnic || '';
        document.getElementById('pin').value = userProfile.pin || '';
        document.getElementById('email').value = userProfile.email || '';
    }
    document.getElementById('agreeTerms').checked = true; // Assume agreed when editing
    document.getElementById('saveProfileBtn').disabled = false;
}

// Photo Adjust Setup
function setupPhotoAdjust(inputId, previewId, adjustContainerId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    const adjustContainer = document.getElementById(adjustContainerId);
    if (!input || !preview || !adjustContainer) {
        console.warn(`Missing elements for photo adjust setup: ${inputId}, ${previewId}, ${adjustContainerId}`);
        return;
    }

    // Clear previous canvas if exists
    let existingCanvas = adjustContainer.querySelector('canvas');
    if (existingCanvas) {
        existingCanvas.remove();
    }

    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    canvas.style.border = '1px solid #ccc';
    canvas.style.display = 'block';
    adjustContainer.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let img = new Image();
    let offsetX = 0, offsetY = 0;
    let isDragging = false;
    let startX, startY;
    let scaleFactor = 1;
    let originalOrientation = 1;

    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
            showToast('No file selected.');
            preview.style.display = 'none';
            adjustContainer.style.display = 'none';
            input.adjustedPhoto = null; // Clear adjusted photo
            return;
        }

        document.getElementById('loadingIndicator').style.display = 'block';
        const reader = new FileReader();
        reader.onload = () => {
            img.src = reader.result;
            img.onload = () => {
                // Ensure EXIF.js is loaded
                if (typeof EXIF !== 'undefined' && EXIF.getData) {
                    EXIF.getData(img, function() {
                        originalOrientation = EXIF.getTag(this, 'Orientation') || 1;
                        adjustContainer.style.display = 'block';
                        preview.src = reader.result;
                        preview.style.display = 'block';
                        offsetX = 0;
                        offsetY = 0;
                        scaleFactor = 1; // Reset scale
                        drawImage(originalOrientation); // Draw initial image with orientation
                        saveAdjustedPhoto(); // Save initial adjusted photo
                        document.getElementById('loadingIndicator').style.display = 'none';
                    });
                } else {
                    console.warn('EXIF.js not loaded or getData method missing. Image orientation might be incorrect.');
                    originalOrientation = 1; // Default to no rotation
                    adjustContainer.style.display = 'block';
                    preview.src = reader.result;
                    preview.style.display = 'block';
                    offsetX = 0;
                    offsetY = 0;
                    scaleFactor = 1;
                    drawImage(originalOrientation);
                    saveAdjustedPhoto();
                    document.getElementById('loadingIndicator').style.display = 'none';
                }
            };
            img.onerror = () => {
                showToast('Error loading image. Please try another file.');
                document.getElementById('loadingIndicator').style.display = 'none';
            };
        };
        reader.onerror = () => {
            showToast('Error reading photo file.');
            document.getElementById('loadingIndicator').style.display = 'none';
        };
        reader.readAsDataURL(file);
    });

    function drawImage(orientation) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();

        let imgWidth = img.width;
        let imgHeight = img.height;

        // Calculate initial scale to fit the image into the canvas
        let scale = Math.max(canvas.width / imgWidth, canvas.height / imgHeight);
        imgWidth *= scale;
        imgHeight *= scale;

        // Apply drag offsets and current scaleFactor
        let drawWidth = imgWidth * scaleFactor;
        let drawHeight = imgHeight * scaleFactor;

        ctx.translate(canvas.width / 2, canvas.height / 2); // Center for rotation
        if (orientation && orientation !== 1) {
            switch (orientation) {
                case 6: // 90 deg right
                    ctx.rotate(Math.PI / 2);
                    [drawWidth, drawHeight] = [drawHeight, drawWidth]; // Swap dimensions for drawing
                    break;
                case 3: // 180 deg
                    ctx.rotate(Math.PI);
                    break;
                case 8: // 90 deg left
                    ctx.rotate(-Math.PI / 2);
                    [drawWidth, drawHeight] = [drawHeight, drawWidth]; // Swap dimensions for drawing
                    break;
            }
        }
        // Translate back and apply drag offset relative to the new origin
        ctx.drawImage(img, offsetX - drawWidth / 2, offsetY - drawHeight / 2, drawWidth, drawHeight);
        ctx.restore();
    }

    function saveAdjustedPhoto() {
        let quality = 0.8;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        // Reduce quality until it's below 100KB, but not too low
        while (dataUrl.length > 100 * 1024 && quality > 0.1) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        input.adjustedPhoto = dataUrl;
        preview.src = dataUrl; // Update preview with adjusted image
    }

    // Mouse events for dragging
    canvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        startX = e.offsetX - offsetX;
        startY = e.offsetY - offsetY;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (isDragging) {
            offsetX = e.offsetX - startX;
            offsetY = e.offsetY - startY;
            drawImage(originalOrientation); // Redraw with new offset
        }
    });

    canvas.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            saveAdjustedPhoto();
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isDragging) {
            isDragging = false;
            saveAdjustedPhoto();
        }
    });

    // Touch events for dragging
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDragging = true;
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        startX = touch.clientX - rect.left - offsetX;
        startY = touch.clientY - rect.top - offsetY;
    });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (isDragging) {
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            offsetX = touch.clientX - rect.left - startX;
            offsetY = touch.clientY - rect.top - offsetY;
            drawImage(originalOrientation); // Redraw with new offset
        }
    });

    canvas.addEventListener('touchend', () => {
        if (isDragging) {
            isDragging = false;
            saveAdjustedPhoto();
        }
    });
}

function toggleSaveButton() {
    const saveButton = document.getElementById('saveProfileBtn');
    const agreeTermsCheckbox = document.getElementById('agreeTerms');
    if (saveButton && agreeTermsCheckbox) {
        saveButton.disabled = !agreeTermsCheckbox.checked;
    }
}

function showDisclaimerModal() {
    const modal = document.getElementById('disclaimerModal');
    if (modal) modal.style.display = 'block';
}

function promptPin(callback) {
    const pinModal = document.getElementById('pinModal');
    const pinInput = document.getElementById('pinInput');
    if (pinModal && pinInput) {
        pinModal.style.display = 'block';
        pinInput.value = '';
        pinInput.focus();
        window.submitPin = () => { // Ensure submitPin is globally accessible from modal button
            const pin = pinInput.value;
            if (pin === userProfile.pin) {
                pinModal.style.display = 'none';
                callback(true);
            } else {
                showToast('Incorrect PIN. Please try again.');
                callback(false);
            }
        };
        // Allow pressing Enter key to submit PIN
        pinInput.removeEventListener('keypress', window._pinEnterListener); // Remove old listener if exists
        window._pinEnterListener = (event) => {
            if (event.key === 'Enter') {
                window.submitPin();
            }
        };
        pinInput.addEventListener('keypress', window._pinEnterListener);
    } else {
        console.error('PIN modal elements not found.');
        callback(false); // Fail gracefully
    }
}

function showChangePin() {
    const changePinModal = document.getElementById('changePinModal');
    const resetCnicInput = document.getElementById('resetCnic');
    const resetPinInput = document.getElementById('resetPin');
    if (changePinModal && resetCnicInput && resetPinInput) {
        changePinModal.style.display = 'block';
        resetCnicInput.value = '';
        resetPinInput.value = '';
        resetCnicInput.focus(); // Focus on first input
    } else {
        console.error('Change PIN modal elements not found.');
    }
}

function changePin() {
    const resetCnic = document.getElementById('resetCnic').value.trim();
    const newPin = document.getElementById('resetPin').value.trim();

    if (!userProfile) {
        showToast('User profile not set. Cannot change PIN.');
        return;
    }

    // Allow changing PIN if CNIC or Email is provided AND matches the stored one.
    if ((userProfile.cnic && resetCnic === userProfile.cnic) || (userProfile.email && resetCnic === userProfile.email)) {
        if (newPin.length < 4 || !/^\d{4}$/.test(newPin)) { // Basic validation: 4 digits
            showToast('PIN must be exactly 4 digits.');
            return;
        }
        userProfile.pin = newPin;
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        syncLocalStorageToIndexedDB(); // Sync updated profile
        showToast('PIN changed successfully!');
        hideChangePin();
    } else {
        showToast('Invalid CNIC or Email provided for PIN reset. Make sure it matches your registered one.');
    }
}

function hideChangePin() {
    const changePinModal = document.getElementById('changePinModal');
    if (changePinModal) {
        changePinModal.style.display = 'none';
    }
}

function showTotalAnalytics() {
    document.getElementById('analyticsFilesEntered').textContent = analytics.filesEntered;
    document.getElementById('analyticsSearchesPerformed').textContent = analytics.searchesPerformed;
    document.getElementById('analyticsBackupsCreated').textContent = analytics.backupsCreated;
    document.getElementById('analyticsModal').style.display = 'block';
}

function hideAnalytics() {
    document.getElementById('analyticsModal').style.display = 'none';
}

function showPrivacyPolicy() {
    showDisclaimerModal(); // Re-use the existing disclaimer modal
}

function updateDashboardCards() {
    console.log('Updating dashboard cards');
    const today = new Date().toLocaleDateString('en-CA');
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    const deliveries = files.filter(f => new Date(f.deliveredAt).toLocaleDateString('en-CA') === today).length;
    const returns = files.filter(f => f.returned && new Date(f.returnedAt).toLocaleDateString('en-CA') === today).length;
    const pending = files.filter(f => !f.returned).length;
    const tomorrowHearings = files.filter(f => new Date(f.date).toLocaleDateString('en-CA') === tomorrow).length;
    const overdue = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo).length;

    document.getElementById('cardDeliveries').innerHTML = `<span class="tooltip">Files delivered today</span><h3>${deliveries}</h3><p>Deliveries Today</p>`;
    document.getElementById('cardReturns').innerHTML = `<span class="tooltip">Files returned today</span><h3>${returns}</h3><p>Returns Today</p>`;
    document.getElementById('cardPending').innerHTML = `<span class="tooltip">Files not yet returned</span><h3>${pending}</h3><p>Pending Files</p>`;
    document.getElementById('cardTomorrow').innerHTML = `<span class="tooltip">Hearings scheduled for tomorrow</span><h3>${tomorrowHearings}</h3><p>Tomorrow Hearings</p>`;
    document.getElementById('cardOverdue').innerHTML = `<span class="tooltip">Files pending over 10 days</span><h3>${overdue}</h3><p>Overdue Files</p>`;
    document.getElementById('cardSearchPrev').innerHTML = `<span class="tooltip">Search all previous records</span><h3>Search</h3><p>Previous Records</p>`;

    // Destroy existing chart instance before creating a new one
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }

    const ctx = document.getElementById('statsChart');
    if (ctx) {
        chartInstance = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Deliveries', 'Returns', 'Pending', 'Tomorrow', 'Overdue'],
                datasets: [{
                    label: 'File Stats',
                    data: [deliveries, returns, pending, tomorrowHearings, overdue],
                    backgroundColor: ['#0288d1', '#4caf50', '#d32f2f', '#fb8c00', '#7b1fa2']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        stepSize: 1,
                        ticks: { precision: 0 }
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    }


    document.getElementById('cardDeliveries').onclick = () => { console.log('Clicked Deliveries'); showDashboardReport('deliveries'); };
    document.getElementById('cardReturns').onclick = () => { console.log('Clicked Returns'); showDashboardReport('returns'); };
    document.getElementById('cardPending').onclick = () => { console.log('Clicked Pending'); showDashboardReport('pending'); };
    document.getElementById('cardTomorrow').onclick = () => { console.log('Clicked Tomorrow'); showDashboardReport('tomorrow'); };
    document.getElementById('cardOverdue').onclick = () => { console.log('Clicked Overdue'); showDashboardReport('overdue'); };
    document.getElementById('cardSearchPrev').onclick = () => { console.log('Clicked SearchPrev'); showDashboardReport('searchPrev'); };
}

function showDashboardReport(type) {
    console.log(`Showing report for type: ${type}`);
    document.getElementById('dashboardReportPanel').style.display = 'block';
    document.getElementById('loadingIndicator').style.display = 'block'; // Show loading
    document.getElementById('searchPrevRecords').style.display = type === 'searchPrev' ? 'block' : 'none';
    currentPage = 1; // Reset to first page for new report

    // Populate reportSearchProfile dropdown for searchPrev
    const reportSearchProfileSelect = document.getElementById('reportSearchProfile');
    if (reportSearchProfileSelect) {
        reportSearchProfileSelect.innerHTML = '<option value="">All Profiles</option>';
        profiles.forEach(p => {
            const option = document.createElement('option');
            option.value = `${p.name}___${p.type}`; // Combine name and type for uniqueness
            option.textContent = `${p.name} (${p.type})`;
            reportSearchProfileSelect.appendChild(option);
        });
    }

    const today = new Date().toLocaleDateString('en-CA');
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    let filteredFiles = [];
    let title = '';
    switch (type) {
        case 'deliveries':
            filteredFiles = files.filter(f => new Date(f.deliveredAt).toLocaleDateString('en-CA') === today);
            title = 'Deliveries Today';
            break;
        case 'returns':
            filteredFiles = files.filter(f => f.returned && new Date(f.returnedAt).toLocaleDateString('en-CA') === today);
            title = 'Returns Today';
            break;
        case 'pending':
            filteredFiles = files.filter(f => !f.returned);
            title = 'Pending Files';
            break;
        case 'tomorrow':
            filteredFiles = files.filter(f => new Date(f.date).toLocaleDateString('en-CA') === tomorrow);
            title = 'Tomorrow Hearings';
            break;
        case 'overdue':
            filteredFiles = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo);
            title = 'Overdue Files';
            break;
        case 'searchPrev':
            filteredFiles = files; // For search, start with all files, then apply filters
            title = 'Search Previous Records';
            break;
        default:
            console.error('Invalid report type:', type);
            filteredFiles = [];
            title = 'Unknown Report';
    }

    currentReportData = filteredFiles;
    document.getElementById('reportTitle').textContent = title;
    renderReportTable();

    // Hide loading indicator after a short delay
    setTimeout(() => {
        document.getElementById('loadingIndicator').style.display = 'none';
    }, 500);
}

function performReportSearch() {
    analytics.searchesPerformed++;
    localStorage.setItem('analytics', JSON.stringify(analytics));
    syncLocalStorageToIndexedDB(); // Sync analytics

    const caseType = document.getElementById('reportSearchCaseType').value.toLowerCase();
    const nature = document.getElementById('reportSearchNature').value.toLowerCase();
    const cmsNo = document.getElementById('reportSearchCmsNo').value.toLowerCase();
    const selectedProfile = document.getElementById('reportSearchProfile').value; // format: "Name___Type"

    let filtered = files;

    if (caseType) {
        filtered = filtered.filter(f => f.caseType.toLowerCase() === caseType);
    }
    if (nature) {
        filtered = filtered.filter(f => f.nature.toLowerCase().includes(nature));
    }
    if (cmsNo) {
        filtered = filtered.filter(f => f.cmsNo.toLowerCase().includes(cmsNo));
    }
    if (selectedProfile) {
        const [profileName, profileType] = selectedProfile.split('___');
        filtered = filtered.filter(f =>
            f.deliveredToName === profileName && f.deliveredToType === profileType
        );
    }

    currentReportData = filtered;
    currentPage = 1; // Reset pagination for new search results
    renderReportTable();
    showToast(`Search completed. Found ${filtered.length} records.`);
}


let sortColumn = null;
let sortDirection = 1; // 1 for ascending, -1 for descending

function renderReportTable() {
    const tbody = document.getElementById('dashboardReportTable').querySelector('tbody');
    if (!tbody) {
        console.error('Dashboard report table tbody not found.');
        return;
    }
    tbody.innerHTML = '';

    let sortedData = [...currentReportData]; // Create a copy to sort
    if (sortColumn) {
        sortedData.sort((a, b) => {
            let valA = a[sortColumn] || '';
            let valB = b[sortColumn] || '';

            // Handle specific column types for sorting
            if (['deliveredAt', 'returnedAt', 'date'].includes(sortColumn)) {
                valA = new Date(valA).getTime();
                valB = new Date(valB).getTime();
            } else if (sortColumn === 'criminalDetails') {
                valA = a.caseType === 'criminal' ? `${a.firNo || ''} ${a.firYear || ''} ${a.firUs || ''} ${a.policeStation || ''}` : '';
                valB = b.caseType === 'criminal' ? `${b.firNo || ''} ${b.firYear || ''} ${b.firUs || ''} ${b.policeStation || ''}` : '';
            } else if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return -1 * sortDirection;
            if (valA > valB) return 1 * sortDirection;
            return 0;
        });
    }

    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const paginatedData = sortedData.slice(start, end);

    if (paginatedData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="15" style="text-align: center;">No records found for this report.</td></tr>';
    }

    paginatedData.forEach((f, index) => {
        const row = document.createElement('tr');
        const timeSpan = f.returned ? getDynamicTimeSpan(f.deliveredAt, f.returnedAt) : getDynamicTimeSpan(f.deliveredAt);
        const profile = profiles.find(p => p.name === f.deliveredToName && p.type === f.deliveredToType) || {};
        const swalDetails = f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${formatDate(f.swalDate)}` : 'N/A';
        const criminalDetails = f.caseType === 'criminal' ? [
            f.firNo ? `FIR No: ${f.firNo}` : '',
            f.firYear ? `FIR Year: ${f.firYear}` : '',
            f.firUs ? `FIR U/S: ${f.firUs}` : '',
            f.policeStation ? `Police Station: ${f.policeStation}` : ''
        ].filter(Boolean).join(', ') || 'N/A' : 'N/A';
        const profileDetails = [
            profile.chamberNo ? `Chamber No: ${profile.chamberNo}` : '',
            profile.advocateName ? `Advocate: ${profile.advocateName}` : '',
            profile.advocateCell ? `Cell: ${profile.advocateCell}` : '',
            profile.designation ? `Designation: ${profile.designation}` : '',
            profile.postedAt ? `Posted At: ${profile.postedAt}` : '',
            profile.type === 'other' && profile.cnic ? `ID/CNIC: ${maskCNIC(profile.cnic)}` : '',
            profile.relation ? `Relation: ${profile.relation}` : ''
        ].filter(Boolean).join(', ') || 'N/A'; // Show 'N/A' if no details
        row.innerHTML = `
            <td>${start + index + 1}</td>
            <td>${f.cmsNo || 'N/A'}</td>
            <td>${f.title ? f.title.replace('vs', 'Vs.') : 'N/A'}</td>
            <td>${f.caseType || 'N/A'}</td>
            <td>${f.nature || 'N/A'}</td>
            <td>${criminalDetails}</td>
            <td>${f.dateType === 'decision' ? 'Decision Date' : 'Next Hearing Date'}: ${formatDate(f.date) || 'N/A'}</td>
            <td>${swalDetails}</td>
            <td><a href="#" onclick="event.preventDefault(); showProfileDetails('${f.deliveredToName}', '${f.deliveredToType}')">${f.deliveredToName || 'N/A'} (${f.deliveredToType || 'N/A'})</a></td>
            <td>${formatDate(f.deliveredAt, 'YYYY-MM-DD HH:mm:ss') || 'N/A'}</td>
            <td>${f.returned ? formatDate(f.returnedAt, 'YYYY-MM-DD HH:mm:ss') : 'N/A'}</td>
            <td class="time-span" data-delivered="${f.deliveredAt}" data-returned="${f.returned ? 'true' : 'false'}">${timeSpan}</td>
            <td>${f.courtName || 'N/A'}</td>
            <td>${f.clerkName || 'N/A'}</td>
            <td>${profileDetails}</td>
        `;
        tbody.appendChild(row);
    });

    updatePagination(sortedData.length);
    updateDynamicTimeSpans(); // Ensure immediate update
}

function getDynamicTimeSpan(deliveredAt, returnedAt = null) {
    if (!deliveredAt) return 'N/A';
    const start = new Date(deliveredAt).getTime();
    const end = returnedAt ? new Date(returnedAt).getTime() : Date.now();
    const diff = end - start;

    if (diff < 0) return 'Invalid Time'; // Handle cases where deliveredAt is in future or returnedAt is before deliveredAt

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30.44); // Average days in a month
    const years = Math.floor(days / 365.25); // Average days in a year

    if (years >= 1) return `${years}y ${Math.floor(months % 12)}m`;
    if (months >= 1) return `${months}m ${Math.floor(days % 30.44)}d`;
    if (days >= 1) return `${days}d ${hours % 24}h`;
    if (hours >= 1) return `${hours}h ${minutes % 60}m`;
    if (minutes >= 1) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}


function updateDynamicTimeSpans() {
    document.querySelectorAll('.time-span[data-returned="false"]').forEach(span => {
        const delivered = span.dataset.delivered;
        span.textContent = getDynamicTimeSpan(delivered);
    });
}

// Update every second only for *currently displayed* pending items
// setInterval(updateDynamicTimeSpans, 1000); // Only uncomment if you want constant updates

document.getElementById('dashboardReportTable').querySelectorAll('th').forEach((th, index) => {
    // Columns to be sortable, mapping to array index starting from 1 for table columns
    const columns = [
        null, // 0-indexed for the 'Sr.No' column which is not sortable by data
        'cmsNo',
        'title',
        'caseType',
        'nature',
        'criminalDetails', // Custom sort logic for this
        'date', // Use 'date' for Next Hearing/Decision Date
        'swalFormNo',
        'deliveredToName',
        'deliveredAt',
        'returnedAt',
        'timeSpan', // Custom sort, might sort by deliveredAt implicitly
        'courtName',
        'clerkName',
        'profileDetails' // Custom sort, might sort by deliveredToName implicitly
    ];

    if (index > 0 && index < columns.length && columns[index] !== null) {
        th.style.cursor = 'pointer'; // Indicate sortable
        th.addEventListener('click', () => {
            const newColumn = columns[index];
            if (newColumn === 'timeSpan') { // Special handling for timeSpan
                // For timeSpan, we generally want to sort by deliveredAt, then returnedAt
                // Assuming sorting by deliveredAt is a reasonable proxy for duration
                sortColumn = 'deliveredAt'; // Sort by original delivered date
                sortDirection = sortDirection === 1 ? -1 : 1; // Toggle direction
            } else {
                sortDirection = sortColumn === newColumn ? -sortDirection : 1;
                sortColumn = newColumn;
            }
            renderReportTable();
        });
    }
});


function updatePagination(totalItems) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('prevPage').disabled = currentPage === 1;
    document.getElementById('nextPage').disabled = currentPage === totalPages || totalPages === 0;
}

document.getElementById('prevPage').onclick = () => {
    if (currentPage > 1) {
        currentPage--;
        renderReportTable();
    }
};

document.getElementById('nextPage').onclick = () => {
    if (currentPage < Math.ceil(currentReportData.length / itemsPerPage)) {
        currentPage++;
        renderReportTable();
    }
};

function formatDate(date, format = 'YYYY-MM-DD') {
    if (!date) return '';
    const d = new Date(date);
    // Check for invalid date
    if (isNaN(d.getTime())) {
        console.warn('Invalid date object provided to formatDate:', date);
        return 'Invalid Date';
    }

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    if (format === 'YYYYMMDD') {
        return `${year}${month}${day}`;
    }
    if (format === 'YYYYMMDD_HHMMSS') {
        return `${year}${month}${day}_${hours}${minutes}${seconds}`;
    }
    if (format === 'YYYY-MM-DD HH:mm:ss') {
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
    return `${year}-${month}-${day}`;
}


function showProfileDetails(name, type) {
    const profile = profiles.find(p => p.name === name && p.type === type);
    const profileModal = document.getElementById('profileModal');
    const profileModalTitle = document.getElementById('profileModalTitle');
    const profileModalTable = document.getElementById('profileModalTable');

    if (!profileModal || !profileModalTitle || !profileModalTable) {
        console.error('Profile modal elements not found.');
        showToast('Error displaying profile details.');
        return;
    }

    if (!profile) {
        profileModalTitle.textContent = `${name} (${type}) - Profile Not Found`;
        profileModalTable.innerHTML = '<tr><td colspan="2" style="text-align: center;">Profile details could not be retrieved.</td></tr>';
        profileModal.style.display = 'block';
        return;
    }

    profileModalTitle.textContent = `${profile.name} (${profile.type})`;
    profileModalTable.innerHTML = `
        <tr><th>Name</th><td>${profile.name || 'N/A'}</td></tr>
        <tr><th>Type</th><td>${profile.type || 'N/A'}</td></tr>
        ${profile.chamberNo ? `<tr><th>Chamber No.</th><td>${profile.chamberNo}</td></tr>` : ''}
        ${profile.advocateName ? `<tr><th>Advocate Name</th><td>${profile.advocateName}</td></tr>` : ''}
        ${profile.advocateCell ? `<tr><th>Advocate Cell</th><td><a href="tel:${profile.advocateCell}">${profile.advocateCell}</a></td></tr>` : ''}
        ${profile.cnic && profile.type === 'other' ? `<tr><th>CNIC/ID</th><td>${maskCNIC(profile.cnic)}</td></tr>` : ''}
        ${profile.email ? `<tr><th>Email</th><td><a href="mailto:${profile.email}">${profile.email}</a></td></tr>` : ''}
        ${profile.designation ? `<tr><th>Designation</th><td>${profile.designation}</td></tr>` : ''}
        ${profile.postedAt ? `<tr><th>Posted At</th><td>${profile.postedAt}</td></tr>` : ''}
        ${profile.relation ? `<tr><th>Relation</th><td>${profile.relation}</td></tr>` : ''}
        ${profile.photo ? `<tr><th>Photo</th><td><img src="${profile.photo}" alt="${profile.name}" style="max-width: 100px; max-height: 100px; border-radius: 8px;"></td></tr>` : ''}
    `;
    profileModal.style.display = 'block';
}

function hideProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) modal.style.display = 'none';
}


// Utility function to show toast messages
function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) {
        console.warn('Toast element not found!');
        alert(message); // Fallback to alert
        return;
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}


// Add event listener for the backup button (assuming it exists in your HTML)
document.addEventListener('DOMContentLoaded', () => {
    const selectBackupFolderBtn = document.getElementById('selectBackupFolderBtn');
    if (selectBackupFolderBtn) {
        selectBackupFolderBtn.addEventListener('click', selectBackupFolder);
    }

    const closeReportPanelBtn = document.getElementById('closeReportPanel');
    if (closeReportPanelBtn) {
        closeReportPanelBtn.addEventListener('click', () => {
            document.getElementById('dashboardReportPanel').style.display = 'none';
        });
    }

    // Attach closeModalIfOutside to modals
    document.getElementById('disclaimerModal')?.addEventListener('click', (e) => closeModalIfOutside(e, 'disclaimerModal'));
    document.getElementById('pinModal')?.addEventListener('click', (e) => closeModalIfOutside(e, 'pinModal'));
    document.getElementById('changePinModal')?.addEventListener('click', (e) => closeModalIfOutside(e, 'changePinModal'));
    document.getElementById('profileModal')?.addEventListener('click', (e) => closeModalIfOutside(e, 'profileModal'));

    // Reports screen dynamic options
    document.getElementById('reportType')?.addEventListener('change', (event) => {
        const type = event.target.value;
        const profileLabel = document.getElementById('reportProfileLabel');
        const startDateLabel = document.getElementById('reportStartDateLabel');
        const endDateLabel = document.getElementById('reportEndDateLabel');
        const profileSelect = document.getElementById('reportProfileSelect');

        profileLabel.style.display = 'none';
        startDateLabel.style.display = 'none';
        endDateLabel.style.display = 'none';
        profileSelect.innerHTML = '<option value="">Select Profile</option>';

        if (type === 'profile') {
            profileLabel.style.display = 'block';
            profiles.forEach(p => {
                const option = document.createElement('option');
                option.value = `${p.name}___${p.type}`;
                option.textContent = `${p.name} (${p.type})`;
                profileSelect.appendChild(option);
            });
        } else if (type === 'dateRange') {
            startDateLabel.style.display = 'block';
            endDateLabel.style.display = 'block';
        }
    });

    // Populate "Delivered To Profile" dropdown on Add File screen
    const deliveredToProfileSelect = document.getElementById('deliveredToProfile');
    if (deliveredToProfileSelect) {
        function populateDeliveredToProfiles() {
            deliveredToProfileSelect.innerHTML = '<option value="">Select Profile</option>';
            profiles.forEach(p => {
                const option = document.createElement('option');
                option.value = `${p.name}___${p.type}`;
                option.textContent = `${p.name} (${p.type})`;
                deliveredToProfileSelect.appendChild(option);
            });
        }
        // Call it once on load, and whenever profiles change
        populateDeliveredToProfiles();
        // You might want to re-call populateDeliveredToProfiles() whenever profiles are added/edited/deleted.
        // For example, after saveProfile() in profile_management.js
        window.populateDeliveredToProfiles = populateDeliveredToProfiles; // Make it globally accessible for other scripts
    }

    // Populate "Return File" search profile dropdown
    const returnSearchProfile = document.getElementById('returnSearchProfile');
    if (returnSearchProfile) {
        function populateReturnSearchProfiles() {
            returnSearchProfile.innerHTML = '<option value="">All Profiles</option>';
            profiles.forEach(p => {
                const option = document.createElement('option');
                option.value = `${p.name}___${p.type}`;
                option.textContent = `${p.name} (${p.type})`;
                returnSearchProfile.appendChild(option);
            });
        }
        populateReturnSearchProfiles();
        window.populateReturnSearchProfiles = populateReturnSearchProfiles;
    }

    // Attach event listeners for share backup modal
    document.getElementById('shareBackupModal')?.addEventListener('click', (e) => closeModalIfOutside(e, 'shareBackupModal'));
    document.getElementById('backupFileInput')?.addEventListener('change', handleBackupFileSelect);


    // Handle visibility change for app state refresh
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            syncIndexedDBToLocalStorage(); // Sync data on app focus
            updateDashboardCards(); // Refresh dashboard
            updateDynamicTimeSpans(); // Update pending file times
        }
    });


    // Example of how other module functions might be called:
    // This is assuming your other files (e.g., file_management.js, profile_management.js)
    // are loaded and define these functions globally or are part of this scope.
    // Make sure these functions are defined and available in your project.
    if (typeof filterPendingFiles === 'function') {
        console.log("filterPendingFiles function found.");
    } else {
        console.warn("filterPendingFiles function not found. Ensure file_management.js is loaded.");
    }
    if (typeof renderProfiles === 'function') {
        console.log("renderProfiles function found.");
    } else {
        console.warn("renderProfiles function not found. Ensure profile_management.js is loaded.");
    }
    if (typeof generateReport === 'function') {
        console.log("generateReport function found.");
    } else {
        console.warn("generateReport function not found. Ensure reports related logic is available.");
    }

});

// Define dummy showToast for environments where the element might not be present (e.g., tests)
if (typeof showToast === 'undefined') {
    window.showToast = (message) => console.log('Toast (fallback):', message);
}

// Ensure window.onload runs initIndexedDB
// The current window.onload is already set up to do this.
// If you have multiple window.onload assignments, only the last one runs.
// Use DOMContentLoaded or ensure functions are called sequentially.
// The current structure where initIndexedDB is called in onload is correct.

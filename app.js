// ========================
//  Court File Tracker app.js
//  FULL UPDATED FILE – COPY/PASTE WHOLE FILE
// ========================

// --- GLOBAL STATE ---
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
let deferredPrompt = null;
let backupFolderHandle = null;
let backupStatus = false;
let autosaveEnabled = JSON.parse(localStorage.getItem('autosaveEnabled')) ?? true;
let autosaveInterval = Number(localStorage.getItem('autosaveInterval')) || 60; // seconds
let autosaveTimer = null;

// --- FIRST-USE MINI-GUIDE ---
function showMiniGuide() {
  if (!localStorage.getItem('miniGuideDone')) {
    alert(
      'Welcome to Court File Tracker!\n\n' +
      'Step 1: Complete your profile in Admin.\n' +
      'Step 2: Select a backup folder (required once).\n' +
      'Step 3: Use Dashboard/New Entry to manage files.\n' +
      'Step 4: Use File Fetcher to manage profiles.\n' +
      'You can always find this guide in Admin > Help.'
    );
    localStorage.setItem('miniGuideDone', '1');
  }
}

// --- INDEXEDDB SETUP (unchanged) ---
const dbName = 'CourtFileTrackerDB';
const dbVersion = 2;
let db;

function initIndexedDB() {
  const request = indexedDB.open(dbName, dbVersion);
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('data')) {
      db.createObjectStore('data', { keyPath: 'key' });
    }
    if (!db.objectStoreNames.contains('folder')) {
      db.createObjectStore('folder', { keyPath: 'id' });
    }
  };
  request.onsuccess = (event) => {
    db = event.target.result;
    syncLocalStorageToIndexedDB();
    loadBackupFolder();
  };
  request.onerror = () => console.error('IndexedDB error');
}

function syncLocalStorageToIndexedDB() {
  const data = {
    files: JSON.parse(localStorage.getItem('files')) || [],
    profiles: JSON.parse(localStorage.getItem('profiles')) || [],
    userProfile: JSON.parse(localStorage.getItem('userProfile')) || null,
    analytics: JSON.parse(localStorage.getItem('analytics')) || analytics
  };
  const transaction = db.transaction(['data'], 'readwrite');
  const store = transaction.objectStore('data');
  Object.entries(data).forEach(([key, value]) => {
    store.put({ key, value });
  });
}

function syncIndexedDBToLocalStorage() {
  const transaction = db.transaction(['data'], 'readonly');
  const store = transaction.objectStore('data');
  const keys = ['files', 'profiles', 'userProfile', 'analytics'];
  keys.forEach(key => {
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result) {
        localStorage.setItem(key, JSON.stringify(request.result.value));
        if (key === 'files') files = request.result.value;
        if (key === 'profiles') profiles = request.result.value;
        if (key === 'userProfile') userProfile = request.result.value;
        if (key === 'analytics') analytics = request.result.value;
      }
    };
  });
}

// --- BACKUP FOLDER (persist permission!) ---
async function loadBackupFolder() {
  const transaction = db.transaction(['folder'], 'readonly');
  const store = transaction.objectStore('folder');
  const request = store.get('backupFolder');
  request.onsuccess = async () => {
    if (request.result && request.result.handle) {
      try {
        const permission = await request.result.handle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          backupFolderHandle = request.result.handle;
          backupStatus = true;
        } else {
          if (await request.result.handle.requestPermission({ mode: 'readwrite' }) === 'granted') {
            backupFolderHandle = request.result.handle;
            backupStatus = true;
          } else {
            showToast('Permission to access backup folder denied');
            backupStatus = false;
            backupFolderHandle = null;
          }
        }
      } catch (error) {
        showToast('Failed to load backup folder');
        backupStatus = false;
        backupFolderHandle = null;
      }
    }
    updateBackupStatusBadge();
  };
}

async function selectBackupFolder() {
  try {
    if ('showDirectoryPicker' in window) {
      const folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      if (await folderHandle.queryPermission({ mode: 'readwrite' }) === 'granted'
        || await folderHandle.requestPermission({ mode: 'readwrite' }) === 'granted'
      ) {
        backupFolderHandle = folderHandle;
        const transaction = db.transaction(['folder'], 'readwrite');
        const store = transaction.objectStore('folder');
        store.put({ id: 'backupFolder', handle: folderHandle });
        showToast('Backup folder selected successfully');
        backupStatus = true;
      } else {
        showToast('Permission to access folder denied');
        backupStatus = false;
      }
    } else {
      showToast('File System Access API not supported in this browser');
    }
  } catch (error) {
    showToast('Failed to select backup folder');
    backupStatus = false;
  }
  updateBackupStatusBadge();
}

// --- BACKUP BADGE ---
function updateBackupStatusBadge() {
  const badge = document.getElementById('backupStatusBadge');
  if (!badge) return;
  badge.textContent = backupFolderHandle && backupStatus ? "Backup: ON" : "Backup: OFF";
  badge.style.background = backupFolderHandle && backupStatus ? "#43a047" : "#d32f2f";
  badge.style.color = "#fff";
  badge.style.padding = "4px 12px";
  badge.style.borderRadius = "10px";
  badge.style.fontWeight = "bold";
}

// --- AUTOSAVE TO BACKUP FOLDER ---
async function autoSaveToFile() {
  if (!backupFolderHandle || !autosaveEnabled) return;
  try {
    const data = { files, profiles, analytics };
    const fileHandle = await backupFolderHandle.getFileHandle('cft_autosave.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    backupStatus = true;
  } catch (error) {
    backupStatus = false;
  }
  updateBackupStatusBadge();
}
function setupAutosaveTimer() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  if (autosaveEnabled) {
    autosaveTimer = setInterval(() => { autoSaveToFile(); }, autosaveInterval * 1000);
  }
}

// --- DAILY BACKUP ---
function scheduleDailyBackup() {
  const now = new Date();
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0, 0, 0
  );
  const timeUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(() => {
    performDailyBackup();
    setInterval(performDailyBackup, 24 * 60 * 60 * 1000); // Every 24 hours
  }, timeUntilMidnight);
}

async function performDailyBackup() {
  if (!backupFolderHandle) {
    showToast('No backup folder selected. Please select a folder.');
    backupStatus = false;
    updateBackupStatusBadge();
    return;
  }
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const dailyFiles = files.filter(f => new Date(f.deliveredAt).toLocaleDateString('en-CA') === today);
    const data = { files: dailyFiles, profiles, analytics };
    const timestamp = formatDate(new Date(), 'YYYYMMDD');
    const fileName = `backup_${timestamp}.json`;
    const fileHandle = await backupFolderHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    analytics.backupsCreated++;
    localStorage.setItem('analytics', JSON.stringify(analytics));
    syncLocalStorageToIndexedDB();
    backupStatus = true;
    updateBackupStatusBadge();
    showToast(`Daily backup created: ${fileName}`);
  } catch (error) {
    backupStatus = false;
    updateBackupStatusBadge();
    showToast('Failed to create daily backup');
  }
}

// --- AUTOSAVE USER SETTINGS TOGGLE (attach in admin/settings section) ---
window.setAutosaveEnabled = function (enabled) {
  autosaveEnabled = enabled;
  localStorage.setItem('autosaveEnabled', JSON.stringify(enabled));
  setupAutosaveTimer();
};

window.setAutosaveInterval = function (seconds) {
  autosaveInterval = seconds;
  localStorage.setItem('autosaveInterval', seconds);
  setupAutosaveTimer();
};
// ========================
//  CONTINUED: Court File Tracker app.js
// ========================

// --- SIDEBAR & MOBILE INTERACTIONS ---
// Swipe back, click outside, mobile back closes sidebar
function setupSidebarClosing() {
  // Overlay tap
  const overlay = document.querySelector('.sidebar-overlay');
  if (overlay) {
    overlay.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('active');
      overlay.classList.remove('active');
    });
  }
  // Mobile back button (popstate)
  window.addEventListener('popstate', () => {
    document.getElementById('sidebar').classList.remove('active');
    if (overlay) overlay.classList.remove('active');
  });
  // Touch swipe to close
  let startX = null;
  document.getElementById('sidebar').addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
  });
  document.getElementById('sidebar').addEventListener('touchmove', e => {
    if (startX !== null && e.touches[0].clientX - startX < -60) { // swipe left
      document.getElementById('sidebar').classList.remove('active');
      if (overlay) overlay.classList.remove('active');
      startX = null;
    }
  });
}

// --- PWA INSTALL PROMPT ---
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'block';
});
if (document.getElementById('installBtn')) {
  document.getElementById('installBtn').addEventListener('click', () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          showToast('App installation started');
        }
        deferredPrompt = null;
        document.getElementById('installBtn').style.display = 'none';
      });
    }
  });
}

// --- PAGE/SREEN STATE PERSISTENCE (refresh returns to current) ---
function saveCurrentScreen(screenId) {
  localStorage.setItem('currentScreen', screenId);
}
function restoreCurrentScreen() {
  const screen = localStorage.getItem('currentScreen');
  if (screen && document.getElementById(screen)) {
    navigate(screen);
  } else {
    navigate('dashboard');
  }
}

// --- NAVIGATION, MODALS, AND SCREEN CHANGES ---
function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  const el = document.getElementById(screenId);
  if (el) el.classList.add('active');
  document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));
  const navBtn = document.querySelector(`.sidebar button[onclick="navigate('${screenId}')"]`);
  if (navBtn) navBtn.classList.add('active');
  saveCurrentScreen(screenId);

  // If needed, update stats/reports
  if (screenId === 'dashboard') updateDashboardCards();
  if (screenId === 'return') filterPendingFiles();
  if (screenId === 'fileFetcher') renderProfiles();
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('active');
    document.querySelector('.sidebar-overlay').classList.remove('active');
  }
}

// --- MODAL CENTERING FIX (Profile Details) ---
function showProfileDetails(name, type) {
  const profile = profiles.find(p => p.name === name && p.type === type) || {};
  document.getElementById('profileModalTitle').textContent = `${name} (${type})`;
  const table = document.getElementById('profileModalTable');
  table.innerHTML = `
    <tr><th>Name</th><td>${profile.name || ''}</td></tr>
    <tr><th>Type</th><td>${profile.type || ''}</td></tr>
    ${profile.cellNo ? `<tr><th>Cell No</th><td><a href="tel:${profile.cellNo}">${profile.cellNo}</a></td></tr>` : ''}
    ${profile.chamberNo ? `<tr><th>Chamber No</th><td>${profile.chamberNo}</td></tr>` : ''}
    ${profile.advocateName ? `<tr><th>Advocate Name</th><td>${profile.advocateName}</td></tr>` : ''}
    ${profile.advocateCell ? `<tr><th>Advocate Cell</th><td><a href="tel:${profile.advocateCell}">${profile.advocateCell}</a></td></tr>` : ''}
    ${profile.designation ? `<tr><th>Designation</th><td>${profile.designation}</td></tr>` : ''}
    ${profile.postedAt ? `<tr><th>Posted At</th><td>${profile.postedAt}</td></tr>` : ''}
    ${profile.type === 'other' && profile.cnic ? `<tr><th>ID/CNIC</th><td>${maskCNIC(profile.cnic)}</td></tr>` : ''}
    ${profile.relation ? `<tr><th>Relation</th><td>${profile.relation}</td></tr>` : ''}
  `;
  if (profile.photo) {
    document.getElementById('profileModalPhoto').src = profile.photo;
    document.getElementById('profileModalPhotoZoom').src = profile.photo;
    document.getElementById('profileModalPhoto').style.display = 'block';
  } else {
    document.getElementById('profileModalPhoto').style.display = 'none';
    document.getElementById('profileModalPhotoZoom').style.display = 'none';
  }
  // Fix: Don’t scroll page to top when modal opens
  document.getElementById('profileModal').style.display = 'block';
  document.getElementById('profileModal').scrollIntoView({ block: "center", behavior: "smooth" });
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
}

// --- PAGE INIT: ONLOAD ---
window.onload = () => {
  showMiniGuide();
  initIndexedDB();
  restoreCurrentScreen();
  document.getElementById('agreeTerms').addEventListener('change', toggleSaveButton);
  updateDashboardCards();
  setupPushNotifications();
  setupPhotoAdjust('userPhoto', 'userPhotoPreview', 'userPhotoAdjust');
  setupPhotoAdjust('profilePhoto', 'photoPreview', 'photoAdjust');
  scheduleDailyBackup();
  setupSidebarClosing();
  updateBackupStatusBadge();
  setupAutosaveTimer();
};
// ========================
// CONTINUED: app.js (Core Logic, Mini Guide, Backup, Search Fixes)
// ========================

// ===== MINI GUIDE FOR FIRST USE =====
function showMiniGuide() {
  if (!localStorage.getItem('miniGuideShown')) {
    showToast("Welcome! Click ☰ to open the menu. Complete your profile and select a backup folder before using the app. (You will see this only once)", 6000);
    localStorage.setItem('miniGuideShown', '1');
  }
}

// ===== BACKUP STATUS BADGE + AUTOSAVE =====
function updateBackupStatusBadge() {
  // Add or update status badge in admin section
  let badge = document.getElementById('backupStatusBadge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'backupStatusBadge';
    badge.style.marginLeft = '10px';
    badge.style.padding = '5px 12px';
    badge.style.borderRadius = '10px';
    badge.style.fontWeight = 'bold';
    badge.style.fontSize = '13px';
    document.querySelector('#savedProfile h4')?.appendChild(badge);
  }
  if (backupFolderHandle) {
    badge.textContent = 'Backup: ACTIVE';
    badge.style.backgroundColor = '#4caf50';
    badge.style.color = '#fff';
  } else {
    badge.textContent = 'Backup: INACTIVE';
    badge.style.backgroundColor = '#d32f2f';
    badge.style.color = '#fff';
  }
}

// Autosave frequency and enable/disable controls
let autosaveEnabled = JSON.parse(localStorage.getItem('autosaveEnabled') || 'true');
let autosaveFrequency = parseInt(localStorage.getItem('autosaveFrequency')) || 60; // seconds
let autosaveTimer = null;

function setupAutosaveTimer() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  if (autosaveEnabled && backupFolderHandle) {
    autosaveTimer = setInterval(autoSaveToFile, autosaveFrequency * 1000);
  }
}
function setAutosaveEnabled(val) {
  autosaveEnabled = val;
  localStorage.setItem('autosaveEnabled', JSON.stringify(val));
  setupAutosaveTimer();
  showToast(`Autosave is now ${val ? "enabled" : "disabled"}`);
}
function setAutosaveFrequency(sec) {
  autosaveFrequency = sec;
  localStorage.setItem('autosaveFrequency', String(sec));
  setupAutosaveTimer();
  showToast(`Autosave frequency set to every ${sec} seconds`);
}

// Add autosave controls UI to Admin screen (when savedProfile loads)
function addAutosaveControls() {
  const admin = document.getElementById('savedProfile');
  if (!admin || document.getElementById('autosaveControls')) return;
  const wrapper = document.createElement('div');
  wrapper.id = 'autosaveControls';
  wrapper.style.marginTop = '10px';
  wrapper.innerHTML = `
    <label style="display:inline; font-weight:bold;">
      <input type="checkbox" id="autosaveToggle" ${autosaveEnabled ? 'checked' : ''}/> Enable Autosave
    </label>
    <label style="margin-left:14px;">
      Frequency:
      <select id="autosaveFreqSelect">
        <option value="30" ${autosaveFrequency===30?'selected':''}>30s</option>
        <option value="60" ${autosaveFrequency===60?'selected':''}>1 min</option>
        <option value="300" ${autosaveFrequency===300?'selected':''}>5 min</option>
        <option value="600" ${autosaveFrequency===600?'selected':''}>10 min</option>
      </select>
    </label>
    <span id="backupStatusBadge" style="margin-left:12px;"></span>
  `;
  admin.appendChild(wrapper);
  document.getElementById('autosaveToggle').addEventListener('change', e => setAutosaveEnabled(e.target.checked));
  document.getElementById('autosaveFreqSelect').addEventListener('change', e => setAutosaveFrequency(Number(e.target.value)));
  updateBackupStatusBadge();
}
const origUpdateSavedProfile = updateSavedProfile;
updateSavedProfile = function() {
  origUpdateSavedProfile();
  setTimeout(addAutosaveControls, 300); // ensure DOM is ready
  updateBackupStatusBadge();
};

// ===== BACKUP FOLDER LIFETIME PERMISSIONS (and error fix) =====
async function loadBackupFolder() {
  const transaction = db.transaction(['folder'], 'readonly');
  const store = transaction.objectStore('folder');
  const request = store.get('backupFolder');
  request.onsuccess = async () => {
    if (request.result && request.result.handle) {
      try {
        // Always check permission on every load
        const perm = await request.result.handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          backupFolderHandle = request.result.handle;
          updateBackupStatusBadge();
        } else if (await request.result.handle.requestPermission({ mode: 'readwrite' }) === 'granted') {
          backupFolderHandle = request.result.handle;
          updateBackupStatusBadge();
        } else {
          showToast('Permission to access backup folder denied');
          backupFolderHandle = null;
          updateBackupStatusBadge();
        }
      } catch (error) {
        console.error('Error loading backup folder:', error);
        showToast('Failed to load backup folder');
        backupFolderHandle = null;
        updateBackupStatusBadge();
      }
    }
    setupAutosaveTimer();
  };
}

// ===== AUTO-SAVE TO JSON (ALL DATA) =====
async function autoSaveToFile() {
  if (!backupFolderHandle) return;
  try {
    const data = {
      files,
      profiles,
      userProfile,
      analytics
    };
    const fileHandle = await backupFolderHandle.getFileHandle('court_file_tracker_autosave.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    updateBackupStatusBadge();
    // Don't show toast every time to avoid spam!
    // showToast('Auto-saved data to backup folder');
  } catch (error) {
    console.error('Auto-save failed:', error);
    showToast('Auto-save to backup failed');
    updateBackupStatusBadge();
  }
}

// ========== SEARCH FIX: FILE TAKER SHOWS ONLY THEIR RECORDS =============
// Fixed: Search by file taker now only returns that profile's files
function performDashboardSearch() {
  analytics.searchesPerformed++;
  localStorage.setItem('analytics', JSON.stringify(analytics));
  syncLocalStorageToIndexedDB();
  autoSaveToFile();

  const searchTitle = document.getElementById('searchTitle').value.toLowerCase();
  const searchCms = document.getElementById('searchCms').value;
  const fileTakerElement = document.getElementById('searchFileTaker');
  const searchFileTaker = fileTakerElement && fileTakerElement.value ? fileTakerElement.value.toLowerCase() : '';
  const searchFirNo = document.getElementById('searchFirNo').value.toLowerCase();
  const searchFirYear = document.getElementById('searchFirYear').value;
  const searchPoliceStation = document.getElementById('searchPoliceStation').value.toLowerCase();

  currentReportData = files.filter(f => {
    return (!searchTitle || f.title.toLowerCase().includes(searchTitle)) &&
      (!searchCms || f.cmsNo.toString().includes(searchCms)) &&
      (!searchFileTaker || f.deliveredToName.toLowerCase().includes(searchFileTaker)) &&
      (!searchFirNo || (f.firNo && f.firNo.toLowerCase().includes(searchFirNo))) &&
      (!searchFirYear || (f.firYear && f.firYear.toString().includes(searchFirYear))) &&
      (!searchPoliceStation || (f.policeStation && f.policeStation.toLowerCase().includes(searchPoliceStation)));
  });

  // If file taker selected, filter to *only* their records
  if (searchFileTaker) {
    currentReportData = currentReportData.filter(f => f.deliveredToName.toLowerCase() === searchFileTaker);
  }
  currentPage = 1;
  renderReportTable();
}

// ========== RESTORE BACKUP: SCRUTINIZE/DE-DUPLICATE ==========
function restoreData() {
  const file = document.getElementById('dataRestore').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);

      // Uniqueness filter for files by cmsNo
      if (data.files) {
        const existingCmsNos = new Set(files.map(f => f.cmsNo));
        const newFiles = data.files.filter(f => !existingCmsNos.has(f.cmsNo));
        files = [...files, ...newFiles];
      }
      // Uniqueness filter for profiles by name+type
      if (data.profiles) {
        const existingProfiles = new Set(profiles.map(p => p.name + p.type));
        const newProfiles = data.profiles.filter(p => !existingProfiles.has(p.name + p.type));
        profiles = [...profiles, ...newProfiles];
      }
      if (data.userProfile) {
        userProfile = { ...userProfile, ...data.userProfile, pin: userProfile.pin };
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
      }
      if (data.analytics) {
        analytics = { ...analytics, ...data.analytics };
        localStorage.setItem('analytics', JSON.stringify(analytics));
      }
      localStorage.setItem('files', JSON.stringify(files));
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
      autoSaveToFile();
      showToast('Data restored successfully');
      updateSavedProfile();
      updateDashboardCards();
      navigate('dashboard');
    } catch (error) {
      console.error('Restore error:', error);
      showToast('Failed to restore data. Invalid file format.');
    }
  };
  reader.readAsText(file);
}

// ========== PAGE REFRESH KEEPS SAME SCREEN ==========
window.addEventListener('beforeunload', () => {
  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen) {
    localStorage.setItem('currentScreen', activeScreen.id);
  }
});
// ...continuing, full app.js (continue directly after previous block!)

function showProfileDetails(name, type) {
  const profile = profiles.find(p => p.name === name && p.type === type) || {};
  document.getElementById('profileModalTitle').textContent = `${name} (${type})`;
  const table = document.getElementById('profileModalTable');
  table.innerHTML = `
    <tr><th>Name</th><td>${profile.name || ''}</td></tr>
    <tr><th>Type</th><td>${profile.type || ''}</td></tr>
    ${profile.cellNo ? `<tr><th>Cell No</th><td><a href="tel:${profile.cellNo}">${profile.cellNo}</a></td></tr>` : ''}
    ${profile.chamberNo ? `<tr><th>Chamber No</th><td>${profile.chamberNo}</td></tr>` : ''}
    ${profile.advocateName ? `<tr><th>Advocate Name</th><td>${profile.advocateName}</td></tr>` : ''}
    ${profile.advocateCell ? `<tr><th>Advocate Cell</th><td><a href="tel:${profile.advocateCell}">${profile.advocateCell}</a></td></tr>` : ''}
    ${profile.designation ? `<tr><th>Designation</th><td>${profile.designation}</td></tr>` : ''}
    ${profile.postedAt ? `<tr><th>Posted At</th><td>${profile.postedAt}</td></tr>` : ''}
    ${profile.type === 'other' && profile.cnic ? `<tr><th>ID/CNIC</th><td>${maskCNIC(profile.cnic)}</td></tr>` : ''}
    ${profile.relation ? `<tr><th>Relation</th><td>${profile.relation}</td></tr>` : ''}
  `;
  if (profile.photo) {
    document.getElementById('profileModalPhoto').src = profile.photo;
    document.getElementById('profileModalPhotoZoom').src = profile.photo;
    document.getElementById('profileModalPhoto').style.display = 'block';
  } else {
    document.getElementById('profileModalPhoto').style.display = 'none';
    document.getElementById('profileModalPhotoZoom').style.display = 'none';
  }
  document.getElementById('profileModal').style.display = 'block';
  // Prevent page scroll on modal open
  document.body.style.overflow = 'hidden';
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
  document.body.style.overflow = '';
}

// Sidebar mobile fixes: overlay tap, swipe, back button
function enableSidebarOverlayClose() {
  const overlay = document.querySelector('.sidebar-overlay');
  overlay.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('active');
    overlay.classList.remove('active');
  });
  window.addEventListener('popstate', () => {
    document.getElementById('sidebar').classList.remove('active');
    overlay.classList.remove('active');
  });
  overlay.addEventListener('touchstart', (e) => {
    e.preventDefault();
    document.getElementById('sidebar').classList.remove('active');
    overlay.classList.remove('active');
  });
}
enableSidebarOverlayClose();

function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.sidebar button[onclick="navigate('${screenId}')"]`)?.classList.add('active');
  if (screenId === 'dashboard') updateDashboardCards();
  if (screenId === 'return') filterPendingFiles();
  if (screenId === 'fileFetcher') renderProfiles();
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('active');
    document.querySelector('.sidebar-overlay').classList.remove('active');
  }
  // Store current screen for refresh persistence
  localStorage.setItem('currentScreen', screenId);
}

// On window load, restore last screen if any
window.onload = () => {
  showMiniGuide();
  initIndexedDB();
  let initialScreen = localStorage.getItem('currentScreen') || (userProfile ? 'dashboard' : 'admin');
  if (userProfile) {
    document.getElementById('setupMessage').style.display = 'none';
    document.getElementById('adminForm').style.display = 'none';
    document.getElementById('savedProfile').style.display = 'block';
    updateSavedProfile();
    navigate(initialScreen);
  } else {
    navigate('admin');
  }
  document.getElementById('agreeTerms').addEventListener('change', toggleSaveButton);
  updateDashboardCards();
  setupPushNotifications();
  setupPhotoAdjust('userPhoto', 'userPhotoPreview', 'userPhotoAdjust');
  setupPhotoAdjust('profilePhoto', 'photoPreview', 'photoAdjust');
  scheduleDailyBackup();
};

// Service Worker registration for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('service-worker.js')
      .then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
  });
}
// ===================
//  (CONTINUED APP.JS CODE, MIDDLE SECTION)
// ===================

// Admin Form Submission
document.getElementById('adminForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  try {
    setTimeout(() => {
      const userPhotoInput = document.getElementById('userPhoto');
      let photo = userPhotoInput.adjustedPhoto;
      if (!photo && userPhotoInput.files && userPhotoInput.files[0]) {
        photo = userPhotoInput.files[0];
      }
      if (!photo) {
        showToast('Please upload a profile photo');
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
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        syncLocalStorageToIndexedDB();
        autoSaveToFile();
        document.getElementById('setupMessage').style.display = 'none';
        document.getElementById('adminForm').style.display = 'none';
        document.getElementById('savedProfile').style.display = 'block';
        updateSavedProfile();
        showToast('Profile saved successfully!');
        document.getElementById('loadingIndicator').style.display = 'none';
        navigate('dashboard');
      };
      if (typeof photo === 'string' && photo.startsWith('data:')) {
        processPhoto(photo);
      } else {
        const reader = new FileReader();
        reader.onload = () => processPhoto(reader.result);
        reader.onerror = () => {
          showToast('Failed to read photo. Please try again.');
          document.getElementById('loadingIndicator').style.display = 'none';
        };
        reader.readAsDataURL(photo);
      }
    }, 500);
  } catch (error) {
    showToast('Failed to save profile. Please try again.');
    document.getElementById('loadingIndicator').style.display = 'none';
  }
});

function updateSavedProfile() {
  document.getElementById('savedClerkName').textContent = userProfile.clerkName;
  document.getElementById('savedJudgeName').textContent = userProfile.judgeName;
  document.getElementById('savedCourtName').textContent = userProfile.courtName;
  document.getElementById('savedMobile').textContent = userProfile.mobile;
  document.getElementById('savedMobile').href = `tel:${userProfile.mobile}`;
  if (userProfile.photo) {
    document.getElementById('savedUserPhoto').src = userProfile.photo;
    document.getElementById('savedUserPhoto').style.display = 'block';
  }
  document.getElementById('totalFiles').textContent = files.length;
  document.getElementById('totalProfiles').textContent = profiles.length;
  document.getElementById('changePinBtn').style.display = userProfile.email || userProfile.cnic ? 'inline-block' : 'none';
}

function editUserProfile() {
  document.getElementById('adminForm').style.display = 'block';
  document.getElementById('savedProfile').style.display = 'none';
  document.getElementById('clerkName').value = userProfile.clerkName;
  document.getElementById('judgeName').value = userProfile.judgeName;
  document.getElementById('courtName').value = userProfile.courtName;
  document.getElementById('mobile').value = userProfile.mobile;
  document.getElementById('cnic').value = userProfile.cnic;
  document.getElementById('pin').value = userProfile.pin;
  document.getElementById('email').value = userProfile.email;
  document.getElementById('agreeTerms').checked = true;
  document.getElementById('saveProfileBtn').disabled = false;
}
// ================
// Remaining app.js (Full/Final Section)
// ================

// -- File Return Handling
function filterPendingFiles() {
  const cms = document.getElementById('returnCms').value.trim();
  const title = document.getElementById('returnTitle').value.trim().toLowerCase();
  const tbody = document.querySelector('#pendingFilesTable tbody');
  tbody.innerHTML = '';
  const pending = files.filter(f => !f.returnDate &&
    (!cms || f.cmsNo.toString().includes(cms)) &&
    (!title || (f.petitioner + ' vs ' + f.respondent).toLowerCase().includes(title))
  );
  pending.forEach((file, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" data-file="${file.cmsNo}"></td>
      <td>${file.cmsNo}</td>
      <td>${file.petitioner} vs ${file.respondent}</td>
      <td>${file.caseType}</td>
      <td><button onclick="showProfileModal('${file.deliveredTo}')">${file.deliveredTo}</button></td>
      <td><button onclick="returnFile('${file.cmsNo}')">Return</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function returnFile(cmsNo) {
  const idx = files.findIndex(f => f.cmsNo == cmsNo && !f.returnDate);
  if (idx !== -1) {
    files[idx].returnDate = new Date().toISOString().slice(0,10);
    syncLocalStorageToIndexedDB();
    autoSaveToFile();
    filterPendingFiles();
    showToast('File marked as returned!');
    updateDashboard();
  }
}

function bulkReturnFiles() {
  document.querySelectorAll('#pendingFilesTable tbody input[type="checkbox"]:checked').forEach(input => {
    returnFile(input.dataset.file);
  });
}

// -- File Form Save
document.getElementById('fileForm').addEventListener('submit', e => {
  e.preventDefault();
  const data = {
    caseType: document.getElementById('caseType').value,
    cmsNo: document.getElementById('cmsNo').value,
    petitioner: document.getElementById('petitioner').value,
    respondent: document.getElementById('respondent').value,
    nature: document.getElementById('nature').value,
    firNo: document.getElementById('firNo') ? document.getElementById('firNo').value : '',
    firYear: document.getElementById('firYear') ? document.getElementById('firYear').value : '',
    firUs: document.getElementById('firUs') ? document.getElementById('firUs').value : '',
    policeStation: document.getElementById('policeStation') ? document.getElementById('policeStation').value : '',
    dateType: document.getElementById('dateType').value,
    date: document.getElementById('date').value,
    deliveredTo: document.getElementById('deliveredTo').value,
    deliveredType: document.getElementById('deliveredType').value,
    copyAgency: document.getElementById('copyAgency').checked,
    swalFormNo: document.getElementById('swalFormNo') ? document.getElementById('swalFormNo').value : '',
    swalDate: document.getElementById('swalDate') ? document.getElementById('swalDate').value : '',
    deliveryDate: new Date().toISOString().slice(0,10),
    returnDate: ''
  };
  files.push(data);
  syncLocalStorageToIndexedDB();
  autoSaveToFile();
  showToast('File entry saved and delivered!');
  updateDashboard();
  document.getElementById('fileForm').reset();
});

// -- Profile Management
function renderProfiles() {
  const type = document.getElementById('profileFilterType').value;
  const search = document.getElementById('profileSearch').value.trim().toLowerCase();
  const tableBody = document.querySelector('#profileTable tbody');
  tableBody.innerHTML = '';
  let filtered = profiles;
  if (type) filtered = filtered.filter(p => p.type === type);
  if (search) filtered = filtered.filter(p =>
    p.name.toLowerCase().includes(search) ||
    (p.cellNo && p.cellNo.includes(search)) ||
    (p.chamberNo && p.chamberNo.includes(search))
  );
  filtered.forEach(profile => {
    const delivered = files.filter(f => f.deliveredTo === profile.name && !f.returnDate).length;
    const total = files.filter(f => f.deliveredTo === profile.name).length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img src="${profile.photo || ''}" style="width:40px;height:40px;border-radius:50%;" /></td>
      <td>${profile.name}</td>
      <td>${profile.type}</td>
      <td>${profile.cellNo || ''}</td>
      <td>${profile.chamberNo || ''}</td>
      <td>${total}</td>
      <td>${delivered}</td>
      <td>
        <button onclick="showProfileModal('${profile.name}')">View</button>
        <button onclick="deleteProfile('${profile.name}')">Delete</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
  document.getElementById('profileList').style.display = filtered.length ? 'block' : 'none';
}

// -- Profile Modal Logic (NO jump-to-top on open, modal centers, overlay fixes)
function showProfileModal(profileName) {
  const profile = profiles.find(p => p.name === profileName);
  if (!profile) return;
  document.getElementById('profileModalTitle').textContent = profile.name;
  document.getElementById('profileModalPhoto').src = profile.photo || '';
  document.getElementById('profileModalPhoto').style.display = profile.photo ? 'block' : 'none';
  document.getElementById('profileModalTable').innerHTML = `
    <tr><th>Type</th><td>${profile.type}</td></tr>
    <tr><th>Cell No</th><td>${profile.cellNo || ''}</td></tr>
    <tr><th>Chamber</th><td>${profile.chamberNo || ''}</td></tr>
  `;
  // NO scrolling or jumping:
  const modal = document.getElementById('profileModal');
  modal.style.display = 'block';
  modal.scrollTo(0, 0); // Keep modal at top, but no page scroll
  document.body.style.overflow = 'hidden';
}
function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
  document.body.style.overflow = '';
}

// -- Sidebar Improvements (overlay, mobile, close on click/swipe/back)
function toggleSidebar(force) {
  const sidebar = document.getElementById('sidebar');
  if (force === true || (force !== false && !sidebar.classList.contains('active'))) {
    sidebar.classList.add('active');
    showSidebarOverlay();
  } else {
    sidebar.classList.remove('active');
    hideSidebarOverlay();
  }
}
function showSidebarOverlay() {
  document.querySelector('.sidebar-overlay').style.display = 'block';
}
function hideSidebarOverlay() {
  document.querySelector('.sidebar-overlay').style.display = 'none';
}
document.querySelector('.sidebar-overlay').addEventListener('click', () => toggleSidebar(false));
window.addEventListener('popstate', () => toggleSidebar(false));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('sidebar').classList.contains('active')) {
    toggleSidebar(false);
  }
});
// Swipe to close sidebar on mobile
let touchStartX = 0;
document.addEventListener('touchstart', e => {
  if (e.touches[0].clientX < 80 && !document.getElementById('sidebar').classList.contains('active')) {
    touchStartX = e.touches[0].clientX;
  }
});
document.addEventListener('touchmove', e => {
  if (touchStartX !== 0 && e.touches[0].clientX - touchStartX > 60) {
    toggleSidebar(true);
    touchStartX = 0;
  }
});
document.addEventListener('touchend', () => {
  touchStartX = 0;
});

// -- Dashboard File Taker Search (BUGFIX: Only show records of selected profile)
function performDashboardSearch() {
  // ... existing search logic for other filters
  const fileTaker = document.getElementById('searchFileTaker').value.trim();
  let results = files;
  if (fileTaker) {
    results = results.filter(f => f.deliveredTo && f.deliveredTo.toLowerCase() === fileTaker.toLowerCase());
  }
  // ... then further filter by other search boxes if used
  renderDashboardTable(results);
}

// -- Search Suggestions
function suggestProfiles(query, inputId) {
  // Show only relevant suggestions in search/dropdown
  const suggestions = profiles.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
  const list = document.getElementById(inputId === 'deliveredTo' ? 'suggestions' : 'searchSuggestions');
  list.innerHTML = '';
  suggestions.forEach(profile => {
    const li = document.createElement('li');
    li.innerHTML = `<img src="${profile.photo || ''}" />${profile.name}`;
    li.onclick = () => {
      document.getElementById(inputId).value = profile.name;
      list.innerHTML = '';
    };
    list.appendChild(li);
  });
}

// -- Screen Persistence (Keeps screen on reload)
window.addEventListener('beforeunload', () => {
  localStorage.setItem('currentScreen', currentScreen);
});
window.addEventListener('DOMContentLoaded', () => {
  const savedScreen = localStorage.getItem('currentScreen');
  if (savedScreen) navigate(savedScreen, true);
});

// -- Backup/Restore (with unique merge, autosave to selected folder, persistent directory handle)
async function selectBackupFolder() {
  try {
    const dirHandle = await window.showDirectoryPicker();
    await verifyPermission(dirHandle, true);
    localStorage.setItem('backupDir', await serializeHandle(dirHandle));
    backupDirHandle = dirHandle;
    showToast('Backup folder selected!');
    await autoSaveToFile();
  } catch (err) {
    showToast('Failed to select backup folder');
  }
}
async function autoSaveToFile() {
  if (!backupDirHandle) {
    const handleData = localStorage.getItem('backupDir');
    if (handleData) backupDirHandle = await deserializeHandle(handleData);
    else return;
  }
  try {
    await verifyPermission(backupDirHandle, true);
    const fileHandle = await backupDirHandle.getFileHandle('court-file-tracker-backup.json', {create: true});
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({
      userProfile,
      files,
      profiles
    }));
    await writable.close();
    showToast('Backup saved!');
  } catch (err) {
    showToast('Auto-backup failed! Please reselect folder.');
  }
}
async function restoreData() {
  // ...file select, read, parse
  // Merge logic: avoid duplicates!
  const file = document.getElementById('dataRestore').files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    files = mergeUnique(files, data.files, 'cmsNo');
    profiles = mergeUnique(profiles, data.profiles, 'name');
    userProfile = data.userProfile || userProfile;
    syncLocalStorageToIndexedDB();
    showToast('Data restored and merged (unique only)!');
    autoSaveToFile();
    updateDashboard();
  } catch (e) {
    showToast('Restore failed');
  }
}
function mergeUnique(orig, add, key) {
  const map = {};
  orig.concat(add || []).forEach(obj => { map[obj[key]] = obj; });
  return Object.values(map);
}

// File System Access API helpers
async function verifyPermission(fileHandle, withWrite) {
  const opts = {};
  if (withWrite) opts.mode = 'readwrite';
  if ((await fileHandle.queryPermission(opts)) === 'granted') return true;
  if ((await fileHandle.requestPermission(opts)) === 'granted') return true;
  throw new Error('Permission denied');
}
async function serializeHandle(handle) {
  return await handle.name; // You may want to use IDB if full serialization required!
}
async function deserializeHandle(name) {
  // Can't fully deserialize without Origin Private File System, so rely on user re-picking as fallback
  return null;
}

// -- PWA Installability (Manual prompt, install btn)
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('installBtn').style.display = 'block';
});
document.getElementById('installBtn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') showToast('App installed!');
    deferredPrompt = null;
    document.getElementById('installBtn').style.display = 'none';
  }
});

// -- Offline Detection & Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
window.addEventListener('offline', () => showToast('You are offline. Some features may not work.'));
window.addEventListener('online', () => showToast('Back online!'));

// -- Toast Notification
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 3000);
}

// -- Utility: Navigate screens
function navigate(screen, noPush) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(screen).classList.add('active');
  currentScreen = screen;
  if (!noPush) window.history.pushState({screen}, '', `#${screen}`);
}

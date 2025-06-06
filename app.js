// Global Variables
let files = JSON.parse(localStorage.getItem('files')) || [];
let profiles = JSON.parse(localStorage.getItem('profiles')) || [];
let userProfile = JSON.parse(localStorage.getItem('userProfile')) || null;
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue')) || [];
let currentReportData = [];
let currentPage = 1;
const itemsPerPage = 10;
let analytics = JSON.parse(localStorage.getItem('analytics')) || {
  filesEntered: 0,
  searchesPerformed: 0,
  backupsCreated: 0
};
let chartInstance = null;

// IndexedDB Setup
const dbName = 'CourtFileTrackerDB';
const dbVersion = 1;
let db;

function initIndexedDB() {
  const request = indexedDB.open(dbName, dbVersion);
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    db.createObjectStore('data', { keyPath: 'key' });
  };
  request.onsuccess = (event) => {
    db = event.target.result;
    syncLocalStorageToIndexedDB();
  };
  request.onerror = () => console.error('IndexedDB error');
}

function syncLocalStorageToIndexedDB() {
  const key = 'cft-encryption-key'; // TODO: Replace with secure key management in production
  const data = {
    files: JSON.parse(localStorage.getItem('files')) || [],
    profiles: JSON.parse(localStorage.getItem('profiles')) || [],
    userProfile: JSON.parse(localStorage.getItem('userProfile')) || null,
    offlineQueue: JSON.parse(localStorage.getItem('offlineQueue')) || [],
    analytics: JSON.parse(localStorage.getItem('analytics')) || analytics
  };
  if (data.userProfile) {
    data.userProfile.pin = data.userProfile.pin ? CryptoJS.AES.encrypt(data.userProfile.pin, key).toString() : '';
    data.userProfile.cnic = data.userProfile.cnic ? CryptoJS.AES.encrypt(data.userProfile.cnic, key).toString() : '';
  }
  const transaction = db.transaction(['data'], 'readwrite');
  const store = transaction.objectStore('data');
  Object.entries(data).forEach(([key, value]) => {
    store.put({ key, value });
  });
}

function syncIndexedDBToLocalStorage() {
  const key = 'cft-encryption-key'; // TODO: Replace with secure key management in production
  const transaction = db.transaction(['data'], 'readonly');
  const store = transaction.objectStore('data');
  const keys = ['files', 'profiles', 'userProfile', 'offlineQueue', 'analytics'];
  keys.forEach(key => {
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result) {
        let value = request.result.value;
        if (key === 'userProfile' && value) {
          value.pin = value.pin ? CryptoJS.AES.decrypt(value.pin, key).toString(CryptoJS.enc.Utf8) : '';
          value.cnic = value.cnic ? CryptoJS.AES.decrypt(value.cnic, key).toString(CryptoJS.enc.Utf8) : '';
        }
        localStorage.setItem(key, JSON.stringify(value));
        if (key === 'files') files = value;
        if (key === 'profiles') profiles = value;
        if (key === 'userProfile') userProfile = value;
        if (key === 'offlineQueue') offlineQueue = value;
        if (key === 'analytics') analytics = value;
      }
    };
  });
}

// Google Drive API Configuration
const CLIENT_ID = '1022877727253-vlif6k2sstl4gn98e8svsh8mhd3j0gl3.apps.googleusercontent.com';
const API_KEY = 'AIzaSyCmYFpMXEtPdfSg4-K7lgdqNc-njgqONmQ';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
let tokenClient;

function initGoogleDrive() {
  if (!gapi || !google) {
    console.error('Google API scripts not loaded');
    showToast('Google API scripts failed to load. Please check your internet connection.');
    return;
  }
  gapi.load('client', () => {
    gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    }).then(() => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.error) {
            console.error('Google sign-in error:', response.error, response.error_subtype);
            showToast(`Failed to sign in to Google Drive: ${response.error}`);
            return;
          }
          if (response.access_token) {
            localStorage.setItem('gapi_token', JSON.stringify({
              access_token: response.access_token,
              expires_at: Date.now() + (response.expires_in * 1000)
            }));
            userProfile.googleDriveConnected = true;
            localStorage.setItem('userProfile', JSON.stringify(userProfile));
            syncLocalStorageToIndexedDB();
            const googleDriveStatus = document.getElementById('googleDriveStatus');
            if (googleDriveStatus) googleDriveStatus.textContent = 'Attached';
            const backupToDriveBtn = document.getElementById('backupToDrive');
            if (backupToDriveBtn) backupToDriveBtn.style.display = 'inline-block';
            const restoreFromGoogleBtn = document.getElementById('restoreFromGoogle');
            if (restoreFromGoogleBtn) restoreFromGoogleBtn.style.display = 'inline-block';
            showToast('Signed in to Google Drive');
            processOfflineQueue();
          }
        },
        error_callback: (error) => {
          console.error('OAuth initialization error:', error);
          showToast('Failed to initialize Google sign-in. Please try again.');
        }
      });
    }).catch((error) => {
      console.error('Google API init error:', error);
      showToast('Failed to initialize Google Drive: ' + (error.details || 'Unknown error'));
    });
  });
}

function signInWithGoogle() {
  if (!navigator.onLine) {
    showToast('No internet connection. Please try again later.');
    return;
  }
  if (!tokenClient) {
    showToast('Google Drive not initialized. Initializing now...');
    initGoogleDrive();
    setTimeout(() => {
      if (tokenClient) tokenClient.requestAccessToken({ prompt: 'select_account' });
    }, 1000);
    return;
  }
  try {
    tokenClient.requestAccessToken({ prompt: 'select_account' });
  } catch (error) {
    console.error('Sign-in request error:', error);
    showToast('Failed to request Google sign-in. Please try again.');
  }
}

function isGoogleTokenValid() {
  const token = JSON.parse(localStorage.getItem('gapi_token'));
  return token && token.expires_at > Date.now();
}

function refreshGoogleToken() {
  if (!navigator.onLine || !tokenClient) return;
  const token = JSON.parse(localStorage.getItem('gapi_token'));
  if (token && token.expires_at < Date.now() + 60000) { // Refresh 1 minute before expiry
    try {
      tokenClient.requestAccessToken({ prompt: '' }); // Silent refresh
    } catch (error) {
      console.error('Token refresh error:', error);
      showToast('Failed to refresh Google Drive token. Please sign in again.');
    }
  }
}

async function backupToDrive() {
  if (!navigator.onLine) {
    offlineQueue.push({ action: 'backupToDrive', data: null });
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
    syncLocalStorageToIndexedDB();
    showToast('Backup queued for when online');
    return;
  }
  if (!isGoogleTokenValid()) {
    showToast('Google Drive session expired. Please sign in again.');
    signInWithGoogle();
    return;
  }
  let folderId;
  try {
    const response = await gapi.client.drive.files.list({
      q: "name='CFT' and mimeType='application/vnd.google-apps.folder'",
      fields: 'files(id, name)',
      spaces: 'drive'
    });
    const folder = response.result.files.find(f => f.name === 'CFT');
    if (folder) {
      folderId = folder.id;
    } else {
      const folderResponse = await gapi.client.drive.files.create({
        resource: {
          name: 'CFT',
          mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id'
      });
      folderId = folderResponse.result.id;
    }
  } catch (error) {
    console.error('Folder search/create error:', error.result?.error || error);
    showToast('Failed to locate or create CFT folder: ' + (error.result?.error?.message || 'Unknown error'));
    return;
  }
  const data = {
    files: files.map(f => ({ ...f, deliveredToName: f.deliveredToName, deliveredToType: f.deliveredToType })),
    profiles: profiles.map(p => ({ ...p, photo: p.photo || '' })),
    userProfile: userProfile ? { ...userProfile, pin: null, cnic: maskCNIC(userProfile.cnic) } : null,
    analytics
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const metadata = {
    name: `cft_data_${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.json`,
    mimeType: 'application/json',
    parents: [folderId]
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  try {
    await gapi.client.request({
      path: '/upload/drive/v3/files',
      method: 'POST',
      params: { uploadType: 'multipart' },
      body: form
    });
    analytics.backupsCreated++;
    localStorage.setItem('analytics', JSON.stringify(analytics));
    syncLocalStorageToIndexedDB();
    showToast('Backup uploaded to Google Drive in CFT folder');
  } catch (error) {
    console.error('Backup error:', error.result?.error || error);
    showToast('Failed to upload backup: ' + (error.result?.error?.message || 'Unknown error'));
  }
}

async function restoreFromDrive() {
  if (!navigator.onLine) {
    showToast('No internet connection. Please try again later.');
    return;
  }
  if (!isGoogleTokenValid()) {
    showToast('Please sign in to Google Drive');
    signInWithGoogle();
    return;
  }
  document.getElementById('loadingIndicator').style.display = 'block';
  try {
    const folderResponse = await gapi.client.drive.files.list({
      q: "name='CFT' and mimeType='application/vnd.google-apps.folder'",
      fields: 'files(id, name)',
      spaces: 'drive'
    });
    const folder = folderResponse.result.files.find(f => f.name === 'CFT');
    if (!folder) {
      showToast('CFT folder not found in Google Drive');
      document.getElementById('loadingIndicator').style.display = 'none';
      return;
    }
    const filesResponse = await gapi.client.drive.files.list({
      q: `parents in '${folder.id}' and name contains 'cft_data_'`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });
    const backupFiles = filesResponse.result.files;
    const select = document.getElementById('backupFiles');
    select.innerHTML = '<option value="">Select a backup</option>';
    backupFiles.forEach(file => {
      const option = document.createElement('option');
      option.value = file.id;
      option.textContent = file.name;
      select.appendChild(option);
    });
    document.getElementById('restoreFromGoogleModal').style.display = 'block';
    document.getElementById('loadingIndicator').style.display = 'none';
  } catch (error) {
    console.error('List files error:', error.result?.error || error);
    showToast('Failed to list backups: ' + (error.result?.error?.message || 'Unknown error'));
    document.getElementById('loadingIndicator').style.display = 'none';
  }
}

async function restoreSelectedBackup() {
  const fileId = document.getElementById('backupFiles').value;
  if (!fileId) {
    showToast('Please select a backup file');
    return;
  }
  document.getElementById('loadingIndicator').style.display = 'block';
  document.getElementById('restoreProgress').style.display = 'block';
  document.getElementById('progressBar').style.width = '10%';
  try {
    const response = await gapi.client.drive.files.get({
      fileId: fileId,
      alt: 'media'
    });
    document.getElementById('progressBar').style.width = '50%';
    const data = JSON.parse(response.body);
    const newFiles = data.files || [];
    newFiles.forEach(newFile => {
      const existingIndex = files.findIndex(f => 
        f.cmsNo === newFile.cmsNo &&
        f.deliveredToName === newFile.deliveredToName &&
        f.deliveredToType === newFile.deliveredToType &&
        f.deliveredAt === newFile.deliveredAt
      );
      if (existingIndex >= 0) {
        if (newFile.returnedAt && (!files[existingIndex].returnedAt || new Date(newFile.returnedAt) > new Date(files[existingIndex].returnedAt))) {
          files[existingIndex] = { ...files[existingIndex], ...newFile };
        }
      } else {
        files.push(newFile);
      }
    });
    const newProfiles = data.profiles || [];
    newProfiles.forEach(newProfile => {
      const existingIndex = profiles.findIndex(p => 
        p.name === newProfile.name &&
        p.type === newProfile.type &&
        p.cellNo === newProfile.cellNo &&
        (p.chamberNo || '') === (newProfile.chamberNo || '')
      );
      if (existingIndex >= 0) {
        const existing = profiles[existingIndex];
        const newFieldCount = Object.values(newProfile).filter(v => v).length;
        const oldFieldCount = Object.values(existing).filter(v => v).length;
        if (newFieldCount > oldFieldCount) {
          profiles[existingIndex] = { ...existing, ...newProfile };
        }
      } else {
        profiles.push(newProfile);
      }
    });
    analytics.filesEntered = Math.max(analytics.filesEntered, data.analytics?.filesEntered || 0);
    analytics.searchesPerformed = Math.max(analytics.searchesPerformed, data.analytics?.searchesPerformed || 0);
    analytics.backupsCreated = Math.max(analytics.backupsCreated, data.analytics?.backupsCreated || 0);
    userProfile = data.userProfile ? { ...data.userProfile, pin: userProfile?.pin || '', cnic: userProfile?.cnic || '' } : userProfile;
    document.getElementById('progressBar').style.width = '80%';
    localStorage.setItem('files', JSON.stringify(files));
    localStorage.setItem('profiles', JSON.stringify(profiles));
    localStorage.setItem('userProfile', JSON.stringify(userProfile));
    localStorage.setItem('analytics', JSON.stringify(analytics));
    syncLocalStorageToIndexedDB();
    document.getElementById('progressBar').style.width = '100%';
    showToast('Data restored successfully from Google Drive');
    updateSavedProfile();
    updateDashboardCards();
    hideRestoreFromGoogle();
  } catch (error) {
    console.error('Restore error:', error.result?.error || error);
    showToast('Failed to restore data: ' + (error.result?.error?.message || 'Unknown error'));
  } finally {
    document.getElementById('loadingIndicator').style.display = 'none';
    document.getElementById('restoreProgress').style.display = 'none';
  }
}

function hideRestoreFromGoogle() {
  document.getElementById('restoreFromGoogleModal').style.display = 'none';
  document.getElementById('backupFiles').value = '';
  document.getElementById('progressBar').style.width = '0%';
}

function maskCNIC(cnic) {
  if (!cnic) return '';
  const parts = cnic.split('-');
  if (parts.length !== 3) return '*****-*******-*';
  return `${parts[0].slice(0, 2)}***-${parts[1].slice(0, 3)}****-${parts[2]}`;
}

function processOfflineQueue() {
  if (!navigator.onLine || !isGoogleTokenValid()) return;
  offlineQueue.forEach(({ action }) => {
    if (action === 'backupToDrive') backupToDrive();
  });
  offlineQueue = [];
  localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
  syncLocalStorageToIndexedDB();
}

window.onload = () => {
  console.log('app.js loaded successfully');
  initIndexedDB();
  setTimeout(() => {
    if (!gapi || !google) {
      showToast('Google API scripts not loaded. Some features may not work.');
    } else {
      initGoogleDrive();
    }
  }, 5000); // Check for Google API script loading
  if (userProfile) {
    const setupMessage = document.getElementById('setupMessage');
    const adminForm = document.getElementById('adminForm');
    const savedProfile = document.getElementById('savedProfile');
    if (setupMessage) setupMessage.style.display = 'none';
    if (adminForm) adminForm.style.display = 'none';
    if (savedProfile) savedProfile.style.display = 'block';
    updateSavedProfile();
    if (userProfile.googleDriveConnected && isGoogleTokenValid()) {
      const backupToDriveBtn = document.getElementById('backupToDrive');
      if (backupToDriveBtn) backupToDriveBtn.style.display = 'inline-block';
      const restoreFromGoogleBtn = document.getElementById('restoreFromGoogle');
      if (restoreFromGoogleBtn) restoreFromGoogleBtn.style.display = 'inline-block';
    }
  } else {
    navigate('admin');
  }
  const agreeTerms = document.getElementById('agreeTerms');
  if (agreeTerms) agreeTerms.addEventListener('change', toggleSaveButton);
  updateDashboardCards();
  setupPushNotifications();
  setupPhotoAdjust('userPhoto', 'userPhotoPreview', 'userPhotoAdjust');
  setupPhotoAdjust('profilePhoto', 'photoPreview', 'photoAdjust');
  setInterval(refreshGoogleToken, 300000); // Check token every 5 minutes
  setInterval(() => {
    if (userProfile && userProfile.backupFolder && (files.length || profiles.length)) {
      saveProgressiveBackup(); // Only backup if data exists
    }
  }, 86400000); // Auto-backup every 24 hours
};

// PWA Install Prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installAppBtn = document.getElementById('installApp');
  if (installAppBtn) installAppBtn.style.display = 'block';
});

function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
      }
      deferredPrompt = null;
      const installAppBtn = document.getElementById('installApp');
      if (installAppBtn) installAppBtn.style.display = 'none';
    });
  }
}

function setupPushNotifications() {
  if ('Notification' in window && navigator.serviceWorker) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        setInterval(checkOverdueFiles, 3600000);
      }
    });
  }
}

function checkOverdueFiles() {
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const overdueFiles = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo);
  if (overdueFiles.length > 0) {
    navigator.serviceWorker.ready.then(registration => {
      registration.showNotification('Overdue Files', {
        body: `${overdueFiles.length} file(s) are overdue by more than 10 days.`,
        icon: 'icon-192.png'
      });
    });
  }
}

function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.sidebar button[onclick="navigate('${screenId}')"]`).classList.add('active');
  if (screenId === 'dashboard') updateDashboardCards();
  if (screenId === 'return') filterPendingFiles();
  if (screenId === 'fileFetcher') renderProfiles();
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('active');
    document.querySelector('.sidebar-overlay').classList.remove('active');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  sidebar.classList.toggle('active');
  overlay.classList.toggle('active');
}

function closeModalIfOutside(event, modalId) {
  const modalContent = document.querySelector(`#${modalId} .modal-content`);
  if (!modalContent.contains(event.target)) {
    document.getElementById(modalId).style.display = 'none';
  }
}

// Admin Form Submission
document.getElementById('adminForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  try {
    setTimeout(() => {
      const userPhotoInput = document.getElementById('userPhoto');
      let photo = userPhotoInput.adjustedPhoto || (userPhotoInput.files && userPhotoInput.files[0]);
      if (!photo) {
        showToast('Please upload a profile photo');
        document.getElementById('loadingIndicator').style.display = 'none';
        return;
      }
      if (!userProfile?.googleDriveConnected) {
        showToast('Google Drive not attached. Some features will be limited.');
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
          backupFolder: document.getElementById('backupFolder').value,
          googleDriveConnected: userProfile?.googleDriveConnected || false,
          photo: photoData
        };
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        syncLocalStorageToIndexedDB();
        saveProgressiveBackup();
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
    console.error('Admin form error:', error);
    showToast('Failed to save profile. Please try again.');
    document.getElementById('loadingIndicator').style.display = 'none';
  }
});

function saveProgressiveBackup() {
  if (!files.length && !profiles.length) return; // Skip backup if no data
  const data = {
    files: files.map(f => ({ ...f, deliveredToName: f.deliveredToName, deliveredToType: f.deliveredToType })),
    profiles: profiles.map(p => ({ ...p, photo: p.photo || '' })),
    userProfile: userProfile ? { ...userProfile, pin: null, cnic: maskCNIC(userProfile.cnic) } : null,
    analytics
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const fileName = `${userProfile.backupFolder || 'CFT'}/cft_data.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  if (navigator.onLine && userProfile.googleDriveConnected && isGoogleTokenValid()) {
    backupToDrive();
  }
  analytics.backupsCreated++;
  localStorage.setItem('analytics', JSON.stringify(analytics));
  syncLocalStorageToIndexedDB();
}

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
  document.getElementById('backupFolder').value = userProfile.backupFolder || '';
  document.getElementById('agreeTerms').checked = true;
  document.getElementById('saveProfileBtn').disabled = false;
}

function setupPhotoAdjust(inputId, previewId, adjustContainerId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const adjustContainer = document.getElementById(adjustContainerId);
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

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('Image too large. Please select an image smaller than 2MB.');
      input.value = '';
      return;
    }
    document.getElementById('loadingIndicator').style.display = 'block';
    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result;
      img.onload = () => {
        EXIF.getData(img, function() {
          const orientation = EXIF.getTag(this, 'Orientation') || 1;
          adjustContainer.style.display = 'block';
          preview.src = reader.result;
          preview.style.display = 'block';
          offsetX = 0;
          offsetY = 0;
          drawImage(orientation);
          input.adjustedPhoto = canvas.toDataURL('image/jpeg', 0.8);
          document.getElementById('loadingIndicator').style.display = 'none';
        });
      };
    };
    reader.onerror = () => {
      showToast('Error reading photo file');
      document.getElementById('loadingIndicator').style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  function drawImage(orientation) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let imgWidth = img.width * scaleFactor;
    let imgHeight = img.height * scaleFactor;
    scaleFactor = Math.max(canvas.width / img.width, canvas.height / img.height);
    imgWidth = img.width * scaleFactor;
    imgHeight = img.height * scaleFactor;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (orientation !== 1) {
      switch (orientation) {
        case 6: ctx.rotate(Math.PI / 2); break;
        case 3: ctx.rotate(Math.PI); break;
        case 8: ctx.rotate(-Math.PI / 2); break;
      }
    }
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    ctx.drawImage(img, offsetX, offsetY, imgWidth, imgHeight);
    ctx.restore();
  }

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
      drawImage(1);
    }
  });

  canvas.addEventListener('mouseup', () => {
    isDragging = false;
    input.adjustedPhoto = canvas.toDataURL('image/jpeg', 0.8);
  });

  canvas.addEventListener('mouseleave', () => {
    isDragging = false;
  });

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
      offsetY = touch.clientY - rect.top - startY;
      drawImage(1);
    }
  });

  canvas.addEventListener('touchend', () => {
    isDragging = false;
    input.adjustedPhoto = canvas.toDataURL('image/jpeg', 0.8);
  });
}

function toggleSaveButton() {
  document.getElementById('saveProfileBtn').disabled = !document.getElementById('agreeTerms').checked;
}

function promptPin(callback) {
  document.getElementById('pinModal').style.display = 'block';
  document.getElementById('pinInput').value = '';
  document.getElementById('pinInput').focus();
  window.submitPin = () => {
    const pin = document.getElementById('pinInput').value;
    document.getElementById('pinModal').style.display = 'none';
    if (!userProfile || !userProfile.pin) {
      showToast('No user profile found. Please set up your profile first.');
      callback(false);
      return;
    }
    if (pin === userProfile.pin) {
      callback(true);
    } else {
      showToast('Incorrect PIN');
      callback(false);
    }
  };
}

function showChangePin() {
  document.getElementById('changePinModal').style.display = 'block';
  document.getElementById('resetCnic').value = '';
  document.getElementById('resetPin').value = '';
}

function changePin() {
  const resetCnic = document.getElementById('resetCnic').value;
  const newPin = document.getElementById('resetPin').value;
  if (resetCnic === userProfile.cnic || resetCnic === userProfile.email) {
    userProfile.pin = newPin;
    localStorage.setItem('userProfile', JSON.stringify(userProfile));
    syncLocalStorageToIndexedDB();
    showToast('PIN changed successfully');
    hideChangePin();
  } else {
    showToast('Invalid CNIC or Email');
  }
}

function hideChangePin() {
  document.getElementById('changePinModal').style.display = 'none';
}

function updateDashboardCards() {
  const today = formatDate(new Date()).split(' ')[0];
  const tomorrow = formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000)).split(' ')[0];
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const deliveries = files.filter(f => formatDate(f.deliveredAt).startsWith(today)).length;
  const returns = files.filter(f => f.returned && formatDate(f.returnedAt).startsWith(today)).length;
  const pending = files.filter(f => !f.returned).length;
  const tomorrowHearings = files.filter(f => formatDate(f.date).startsWith(tomorrow)).length;
  const overdue = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo).length;

  document.getElementById('cardDeliveries').innerHTML = `<span class="tooltip">Files delivered today</span><h3>${deliveries}</h3><p>Deliveries Today</p>`;
  document.getElementById('cardReturns').innerHTML = `<span class="tooltip">Files returned today</span><h3>${returns}</h3><p>Returns Today</p>`;
  document.getElementById('cardPending').innerHTML = `<span class="tooltip">Files not yet returned</span><h3>${pending}</h3><p>Pending Files</p>`;
  document.getElementById('cardTomorrow').innerHTML = `<span class="tooltip">Hearings scheduled for tomorrow</span><h3>${tomorrowHearings}</h3><p>Tomorrow Hearings</p>`;
  document.getElementById('cardOverdue').innerHTML = `<span class="tooltip">Files pending over 10 days</span><h3>${overdue}</h3><p>Overdue Files</p>`;
  document.getElementById('cardSearchPrev').innerHTML = `<span class="tooltip">Search all previous records</span><h3>Search</h3><p>Previous Records</p>`;

  if (chartInstance) chartInstance.destroy();
  const ctx = document.getElementById('statsChart').getContext('2d');
  chartInstance = new Chart(ctx, {
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
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { display: false } }
    }
  });

  document.getElementById('cardDeliveries').onclick = () => showDashboardReport('deliveries');
  document.getElementById('cardReturns').onclick = () => showDashboardReport('returns');
  document.getElementById('cardPending').onclick = () => showDashboardReport('pending');
  document.getElementById('cardTomorrow').onclick = () => showDashboardReport('tomorrow');
  document.getElementById('cardOverdue').onclick = () => showDashboardReport('overdue');
  document.getElementById('cardSearchPrev').onclick = () => showDashboardReport('searchPrev');
}

function showDashboardReport(type) {
  document.getElementById('dashboardReportPanel').style.display = 'block';
  document.getElementById('loadingIndicator').style.display = 'block';
  document.getElementById('searchPrevRecords').style.display = type === 'searchPrev' ? 'block' : 'none';
  currentPage = 1;

  const today = formatDate(new Date()).split(' ')[0];
  const tomorrow = formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000)).split(' ')[0];
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  let filteredFiles = files;
  let title = '';
  switch (type) {
    case 'deliveries': filteredFiles = files.filter(f => formatDate(f.deliveredAt).startsWith(today)); title = 'Deliveries Today'; break;
    case 'returns': filteredFiles = files.filter(f => f.returned && formatDate(f.returnedAt).startsWith(today)); title = 'Returns Today'; break;
    case 'pending': filteredFiles = files.filter(f => !f.returned); title = 'Pending Files'; break;
    case 'tomorrow': filteredFiles = files.filter(f => formatDate(f.date).startsWith(tomorrow)); title = 'Tomorrow Hearings'; break;
    case 'overdue': filteredFiles = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo); title = 'Overdue Files'; break;
    case 'searchPrev': filteredFiles = files; title = 'Search Previous Records'; break;
  }

  currentReportData = filteredFiles;
  document.getElementById('reportTitle').textContent = title;
  renderReportTable();
  setTimeout(() => document.getElementById('loadingIndicator').style.display = 'none', 500);
}

let sortColumn = null;
let sortDirection = 1;

function renderReportTable() {
  const tbody = document.getElementById('dashboardReportTable').querySelector('tbody');
  tbody.innerHTML = '';

  let sortedData = [...currentReportData];
  if (sortColumn) {
    sortedData.sort((a, b) => {
      let valA = a[sortColumn] || '';
      let valB = b[sortColumn] || '';
      if (sortColumn === 'deliveredAt' || sortColumn === 'returnedAt' || sortColumn === 'date') {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      } else if (sortColumn === 'criminalDetails') {
        valA = a.caseType === 'criminal' ? `${a.firNo || ''} ${a.firYear || ''} ${a.firUs || ''} ${a.policeStation || ''}` : '';
        valB = b.caseType === 'criminal' ? `${b.firNo || ''} ${b.firYear || ''} ${b.firUs || ''} ${b.policeStation || ''}` : '';
      }
      return (valA > valB ? 1 : -1) * sortDirection;
    });
  }

  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const paginatedData = sortedData.slice(start, end);

  paginatedData.forEach((f, index) => {
    const row = document.createElement('tr');
    const timeSpan = f.returned ? getDynamicTimeSpan(f.deliveredAt, f.returnedAt) : getDynamicTimeSpan(f.deliveredAt);
    const profile = profiles.find(p => p.name === f.deliveredToName && p.type === f.deliveredToType) || {};
    const swalDetails = f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${formatDate(f.swalDate)}` : '';
    const criminalDetails = f.caseType === 'criminal' ? [
      f.firNo ? `FIR No: ${f.firNo}` : '',
      f.firYear ? `FIR Year: ${f.firYear}` : '',
      f.firUs ? `FIR U/S: ${f.firUs}` : '',
      f.policeStation ? `Police Station: ${f.policeStation}` : ''
    ].filter(Boolean).join(', ') : '';
    const profileDetails = [
      profile.chamberNo ? `Chamber No: ${profile.chamberNo}` : '',
      profile.advocateName ? `Advocate Name: ${profile.advocateName}` : '',
      profile.advocateCell ? `Advocate Cell: ${profile.advocateCell}` : '',
      profile.designation ? `Designation: ${profile.desigation}` : '',
      profile.postedAt ? `Posted At: ${profile.postedAt}` : '',
      profile.cnic ? `ID/CNIC: ${maskCNIC(profile.cnic)}` : '',
      profile.relation ? `Relation: ${profile.relation}` : ''
    ].filter(Boolean).join(', ');
    row.innerHTML = `
      <td>${start + index + 1}</td>
      <td>${f.cmsNo}</td>
      <td>${f.title.replace('vs', 'Vs.')}</td>
      <td>${f.caseType}</td>
      <td>${f.nature}</td>
      <td>${criminalDetails}</td>
      <td>${f.dateType === 'decision' ? 'Decision Date' : 'Next Hearing Date'}: ${formatDate(f.date)}</td>
      <td>${swalDetails}</td>
      <td><a href="#" onclick="showProfileDetails('${f.deliveredToName}', '${f.deliveredToType}')">${f.deliveredToName} (${f.deliveredToType})</a></td>
      <td>${formatDate(f.deliveredAt, 'YYYY-MM-DD HH:mm:ss')}</td>
      <td>${f.returned ? formatDate(f.returnedAt, 'YYYY-MM-DD HH:mm:ss') : ''}</td>
      <td class="time-span" data-delivered="${f.deliveredAt}" data-returned="${f.returned ? 'true' : 'false'}">${timeSpan}</td>
      <td>${f.courtName}</td>
      <td>${f.clerkName}</td>
      <td>${profileDetails}</td>
    `;
    tbody.appendChild(row);
  });

  updatePagination(sortedData.length);
  updateDynamicTimeSpans();
}

function getDynamicTimeSpan(deliveredAt, returnedAt = null) {
  const start = new Date(deliveredAt).getTime();
  const end = returnedAt ? new Date(returnedAt).getTime() : Date.now();
  const diff = end - start;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  if (months >= 1) return `${months}m ${days % 30}d ${hours % 24}h ${minutes % 60}m`;
  if (days >= 1) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  return `${hours}h ${minutes % 60}m`;
}

function updateDynamicTimeSpans() {
  document.querySelectorAll('.time-span:not([style*="display: none"])').forEach(span => {
    if (span.dataset.returned === 'false') {
      span.textContent = getDynamicTimeSpan(span.dataset.delivered);
    }
  });
}

setInterval(updateDynamicTimeSpans, 60000); // Reduced frequency to every minute

document.getElementById('dashboardReportTable').querySelectorAll('th').forEach((th, index) => {
  th.addEventListener('click', () => {
    const columns = ['id', 'cmsNo', 'title', 'caseType', 'nature', 'criminalDetails', 'dateType', 'swalFormNo', 'deliveredToName', 'deliveredAt', 'returnedAt', 'timeSpan', 'courtName', 'clerkName'];
    if (index >= 1 && index <= 13) {
      const newColumn = columns[index - 1];
      sortDirection = sortColumn === newColumn ? -sortDirection : 1;
      sortColumn = newColumn;
      renderReportTable();
    }
  });
});

function updatePagination(totalItems) {
  document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${Math.ceil(totalItems / itemsPerPage)}`;
  document.getElementById('prevPage').disabled = currentPage === 1;
  document.getElementById('nextPage').disabled = currentPage === Math.ceil(totalItems / itemsPerPage);
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

function formatDate(dateStr, format = 'YYYY-MM-DD') {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  d.setHours(d.getHours() + 5);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  if (format === 'YYYY-MM-DD HH:mm:ss') return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  return `${year}-${month}-${day}`;
}

function showProfileDetails(name, type) {
  const profile = profiles.find(p => p.name === name && p.type === type) || {};
  document.getElementById('profileModal').TitleTextContent = `${name} (${type})`;
  const table = document.getElementById('profileModal');
  table.innerHTML = `
    <tr><th>Name</th><td>${profile.name || ''}</td></tr>
    <tr><th>Type</th><td>${profile.type || ''}</td></tr>
    ${profile.cellNo ? `<tr><th>Cell No</th><td><a href="tel:${profile.cellNo}">${profile.cellNo}</a></td></tr>` : ''}
    ${profile.chamberNo ? `<tr><th>Chamber No</th><td>${profile.chamberNo}</td></tr>` : ''}
    ${profile.advocateName ? `<tr><th>Advocate Name</th><td>${profile.advocateName}</td></tr>` : ''}
    ${profile.advocateCell ? `<tr><th>Advocate Cell</th><td><a href="tel:${profile.advocateCell}">${profile.advocateCell}</a></td></tr>` : ''}
    ${profile.designation ? `<tr><th>Designation</th><td>${profile.designation}</td></tr>` : ''}
    ${profile.postedAt ? `<tr><th>Posted At</th><td>${profile.postedAt}</td></tr>` : ''}
    ${profile.cnic ? `<tr><th>ID/CNIC</th><td>${maskCNIC(profile.cnic)}</td></tr>` : ''}
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
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
}

function performDashboardSearch() {
  analytics.searchesPerformed++;
  localStorage.setItem('analytics', JSON.stringify(analytics));
  syncLocalStorageToIndexedDB();
  const searchTitle = document.getElementById('searchTitle').value.toLowerCase();
  const searchCms = document.getElementById('searchCms').value;
  const searchFileTaker = document.getElementById('searchFileTaker').value.toLowerCase();
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

  currentPage = 1;
  renderReportTable();
}

function printDashboardReport() {
  const reportTitle = document.getElementById('reportTitle').textContent;
  const table = document.getElementById('dashboardReportTable').outerHTML;
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
      <head>
        <title>${reportTitle}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background-color: #f5f5f5; }
          h2 { text-align: center; }
        </style>
      </head>
      <body>
        <h2>${reportTitle}</h2>
        ${table}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
}

function exportDashboardReport(format) {
  if (format === 'csv') {
    let csv = 'Sr#,CMS No,Title,Case Type,Nature,Criminal Details,Date Type,Swal Form Details,Delivered To,Delivery Date,Return Date,Time Span,Court,Clerk Name,Profile Details\n';
    currentReportData.forEach((f, index) => {
      const profile = profiles.find(p => p.name === f.deliveredToName && p.type === f.deliveredToType) || {};
      const timeSpan = f.returned ? getDynamicTimeSpan(f.deliveredAt, f.returnedAt) : getDynamicTimeSpan(f.deliveredAt);
      const swalDetails = f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${formatDate(f.swalDate)}` : '';
      const criminalDetails = f.caseType === 'criminal' ? [
        f.firNo ? `FIR No: ${f.firNo}` : '',
        f.firYear ? `FIR Year: ${f.firYear}` : '',
        f.firUs ? `FIR U/S: ${f.firUs}` : '',
        f.policeStation ? `Police Station: ${f.policeStation}` : ''
      ].filter(Boolean).join(', ') : '';
      const profileDetails = [
        profile.chamberNo ? `Chamber No: ${profile.chamberNo}` : '',
        profile.advocateName ? `Advocate Name: ${profile.advocateName}` : '',
        profile.advocateCell ? `Advocate Cell: ${profile.advocateCell}` : '',
        profile.designation ? `Designation: ${profile.designation}` : '',
        profile.postedAt ? `Posted At: ${profile.postedAt}` : '',
        profile.cnic ? `ID/CNIC: ${maskCNIC(profile.cnic)}` : '',
        profile.relation ? `Relation: ${profile.relation}` : ''
      ].filter(Boolean).join(', ');
      csv += `${index + 1},${f.cmsNo},"${f.title.replace('vs', 'Vs.')}",${f.caseType},"${f.nature}","${criminalDetails}",${f.dateType === 'decision' ? 'Decision Date' : 'Next Hearing Date'}: ${formatDate(f.date)},"${swalDetails}","${f.deliveredToName} (${f.deliveredToType})","${formatDate(f.deliveredAt, 'YYYY-MM-DD HH:mm:ss')}",${f.returned ? `"${formatDate(f.returnedAt, 'YYYY-MM-DD HH:mm:ss')}"` : ''},"${timeSpan}",${f.courtName},${f.clerkName},"${profileDetails}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } else if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(document.getElementById('reportTitle').textContent, 10, 10);
    doc.autoTable({
      html: '#dashboardReportTable',
      startY: 20,
      theme: 'striped',
      styles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 20 }, 2: { cellWidth: 30 } }
    });
    doc.save(`report_${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.pdf`);
  }
}

document.getElementById('fileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  promptPin((success) => {
    if (!success) {
      showToast('PIN verification failed');
      document.getElementById('loadingIndicator').style.display = 'none';
      return;
    }
    setTimeout(() => {
      const deliveredToName = document.getElementById('deliveredTo').value;
      const deliveredToType = document.getElementById('deliveredType').value;
      const profileExists = profiles.find(p => p.name === deliveredToName && p.type === deliveredToType);
      if (!profileExists) {
        showToast('Profile does not exist. Please add it in the File Fetcher section.');
        document.getElementById('loadingIndicator').style.display = 'none';
        navigate('fileFetcher');
        showProfileForm();
        return;
      }
      const fileData = {
        cmsNo: document.getElementById('cmsNo').value,
        title: `${document.getElementById('petitioner').value} vs ${document.getElementById('respondent').value}`,
        caseType: document.getElementById('caseType').value,
        nature: document.getElementById('nature').value,
        firNo: document.getElementById('firNo').value,
        firYear: document.getElementById('firYear').value,
        firUs: document.getElementById('firUs').value,
        policeStation: document.getElementById('policeStation').value,
        dateType: document.getElementById('dateType').value,
        date: document.getElementById('date').value,
        deliveredToName: deliveredToName,
        deliveredToType: deliveredToType,
        swalFormNo: document.getElementById('copyAgency').checked ? document.getElementById('swalFormNo').value : '',
        swalDate: document.getElementById('copyAgency').checked ? document.getElementById('swalDate').value : '',
        deliveredAt: new Date().toISOString(),
        courtName: userProfile.courtName,
        clerkName: userProfile.clerkName,
        returned: false
      };
      files.push(fileData);
      analytics.filesEntered++;
      localStorage.setItem('files', JSON.stringify(files));
      localStorage.setItem('analytics', JSON.stringify(analytics));
      syncLocalStorageToIndexedDB();
      saveProgressiveBackup();
      document.getElementById('fileForm').reset();
      document.getElementById('criminalFields').style.display = 'none';
      document.getElementById('copyAgencyFields').style.display = 'none';
      document.getElementById('copyAgency').checked = false;
      ['petitioner', 'respondent', 'caseType', 'nature', 'firNo', 'firYear', 'firUs', 'policeStation', 'date', 'deliveredTo', 'deliveredType', 'swalFormNo', 'swalDate', 'dateType'].forEach(field => {
        document.getElementById(field).disabled = false;
      });
      document.getElementById('copyAgency').disabled = false;
      showToast('File saved and delivered successfully');
      document.getElementById('loadingIndicator').style.display = 'none';
      updateDashboardCards();
    }, 500);
  });
});

function autoFillCMS() {
  const cmsNo = document.getElementById('cmsNo').value;
  const existing = files.find(f => f.cmsNo === cmsNo);
  const fields = ['petitioner', 'respondent', 'caseType', 'nature', 'firNo', 'firYear', 'firUs', 'policeStation', 'date', 'deliveredTo', 'deliveredType', 'swalFormNo', 'swalDate'];
  if (existing) {
    document.getElementById('petitioner').value = existing.title.split(' vs ')[0];
    document.getElementById('respondent').value = existing.title.split(' vs ')[1];
    document.getElementById('caseType').value = existing.caseType;
    document.getElementById('nature').value = existing.nature;
    document.getElementById('firNo').value = existing.firNo || '';
    document.getElementById('firYear').value = existing.firYear || '';
    document.getElementById('firUs').value = existing.firUs || '';
    document.getElementById('policeStation').value = existing.policeStation || '';
    document.getElementById('date').value = existing.date;
    document.getElementById('deliveredTo').value = existing.deliveredToName;
    document.getElementById('deliveredType').value = existing.deliveredToType;
    document.getElementById('swalFormNo').value = existing.swalFormNo || '';
    document.getElementById('swalDate').value = existing.swalDate || '';
    document.getElementById('copyAgency').checked = !!existing.swalFormNo;
    toggleCopyAgency();
    toggleCriminalFields();
    fields.forEach(field => document.getElementById(field).disabled = true);
    document.getElementById('copyAgency').disabled = true;
  } else {
    fields.forEach(field => document.getElementById(field).disabled = false);
    document.getElementById('copyAgency').disabled = false;
  }
  document.getElementById('dateType').disabled = false;
}

function toggleCriminalFields() {
  document.getElementById('criminalFields').style.display = document.getElementById('caseType').value === 'criminal' ? 'block' : 'none';
}

function toggleCopyAgency() {
  document.getElementById('copyAgencyFields').style.display = document.getElementById('copyAgency').checked ? 'block' : 'none';
}

function suggestProfiles(input, inputId) {
  const suggestions = document.getElementById(inputId === 'deliveredTo' ? 'suggestions' : 'searchSuggestions');
  suggestions.innerHTML = '';
  if (!input) return;
  const fuse = new Fuse(profiles, { keys: ['name', 'cellNo', 'chamberNo'], threshold: 0.3 });
  const results = fuse.search(input).slice(0, 5);
  results.forEach(result => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = result.item.photo || 'icon-192.png';
    img.style.width = '40px';
    img.style.height = '40px';
    img.style.borderRadius = '50%';
    img.style.border = '1px solid #ccc';
    li.appendChild(img));
    const text = document.createElement('span');
    text.textContent = `${result.item.name} (${result.item.type})`;
    li.appendChild(text);
    li.onclick = () => {
      document.querySelectorById(inputId).value = result.item.name;
      if (inputId === 'deliveredTo') document.getElementById('deliveredType').value = result.item.type;
      suggestions.innerHTML = '';
    };
    suggestions.appendChildLi;
  });
}

function filterPendingFiles() {
  const cm = document.querySelectorById('searchFieldId');
  const titl = document.querySelector('.inputTitle').toLowerCase();
  const tBody = tbody.getElementById('pendingFilesTable').querySelector('tbody');
  tBody.innerHTML = '';
  const filteredFiles = files.filter(f => !f.returned && (!cm || f.cmsNo.toString().includes(cm)) && (!titl || f.title.toLowerCase().includes(titl)));
  filteredFiles.forEach(f => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="select-file" data-cms="${f.cmsNo}"></td>
      <td>${f.cmsNo}</td>
      <td>${f.title.replace('vs', 'Vs.')}</td>
      <td>${f.caseType}</td>
      <td>${f.deliveredToName} (${f.deliveredToType})</td>
      <td><button onclick="returnFile('${f.cmsNo}')">Return</button></td>
    `;
    tBody.appendChild(row);
  });
}

function returnFile(cmsNo) {
  promptPin((success) => {
    if (success) {
      const file = files.find(f => f.cmsNo === cmsNo && !f.returned);
      if (file) {
        file.returned = true;
        file.returnedAt = new Date().toISOString();
        localStorage.setItem('files', JSON.stringify(files));
        syncLocalStorageToIndexedDB();
        saveProgressiveBackup();
        showToast(`File ${cmsNo} returned successfully`);
        filterPendingFiles();
        updateDashboardCards();
      }
    }
  });
}

function bulkReturnFiles() {
  const selected = document.querySelectorAll('.select-file:checked');
  if (selected.length === 0) {
    showToast('Please select at least one file to return');
    return;
  }
  promptPin((success) => {
    if (success) {
      selected.forEach(checkbox => {
        const cmsNo = checkbox.dataset.cms;
        const file = files.find(f => f.cmsNo === cmsNo && !f.returned);
        if (file) {
          file.returned = true;
          file.returnedAt = new Date().toISOString();
        }
      });
      localStorage.setItem('files', JSON.stringify(files));
      syncLocalStorageToIndexedDB();
      saveProgressiveBackup();
      showToast(`${selected.length} file(s) returned successfully`);
      filterPendingFiles();
      updateDashboardCards();
    }
  });
}

function showProfileForm() {
  document.getElementById('profileForm').style.display = 'block';
  document.getElementById('profileSearchSection').style.display = 'none';
  document.getElementById('profileList').style.display = 'none';
  document.getElementById('profileType').value = '';
  document.getElementById('profileFields').innerHTML = '';
  document.getElementById('profilePhoto').value = '';
  document.getElementById('photoAdjust').style.display = 'none';
}

function showProfileSearch() {
  document.getElementById('profileForm').style.display = 'none';
  document.getElementById('profileSearchSection').style.display = 'block';
  document.getElementById('profileList').style.display = 'block';
  renderProfiles();
}

function toggleProfileFields() {
  const type = document.getElementById('profileType').value;
  const fields = document.getElementById('profileFields');
  fields.innerHTML = `
    <label>Name: <span class="required">*</span><input type="text" id="profileName" required /></label>
    <label>Cell No: <span class="required">*</span><input type="text" id="cellNo" required /></label>
  `;
  if (type === 'munshi') {
    fields.innerHTML += `
      <label>Chamber No: <span class="required">*</span><input type="text" id="chamberNo" required /></label>
      <label>Advocate Name: <span class="required">*</span><input type="text" id="advocateName" required /></label>
      <label>Advocate Cell: <input type="text" id="advocateCell" /></label>
    `;
  } else if (type === 'advocate') {
    fields.innerHTML += `
      <label>Chamber No: <span class="required">*</span><input type="text" id="chamberNo" required /></label>
    `;
  } else if (type === 'colleague') {
    fields.innerHTML += `
      <label>Designation: <input type="text" id="designation" /></label>
      <label>Posted At: <input type="text" id="postedAt" /></label>
    `;
  } else if (type === 'other') {
    fields.innerHTML += `
      <label>ID/CNIC: <input type="text" id="cnic" /></label>
      <label>Relation: <input type="text" id="relation" /></label>
    `;
  }
  document.getElementById('photoRequired').style.display = type === 'advocate' ? 'none' : 'inline';
  document.getElementById('profilePhoto').required = type !== 'advocate';
}

document.getElementById('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  try {
    const profileType = document.getElementById('profileType').value;
    const photoInput = document.getElementById('profilePhoto');
    let photo = photoInput.adjustedPhoto || (photoInput.files && photoInput.files[0]);
    if (!photo && profileType !== 'advocate') {
      showToast('Please upload a profile photo');
      document.getElementById('loadingIndicator').style.display = 'none';
      return;
    }
    const processPhoto = (photoData) => {
      const profile = {
        type: profileType,
        name: document.getElementById('profileName').value,
        cellNo: document.getElementById('cellNo').value,
        chamberNo: document.getElementById('chamberNo')?.value || '',
        advocateName: document.getElementById('advocateName')?.value || '',
        advocateCell: document.getElementById('advocateCell')?.value || '',
        designation: document.getElementById('designation')?.value || '',
        postedAt: document.getElementById('postedAt')?.value || '',
        cnic: document.getElementById('cnic')?.value || '',
        relation: document.getElementById('relation')?.value || '',
        photo: photoData || ''
      };
      const existingIndex = profiles.findIndex(p => p.name === profile.name && p.type === profile.type);
      if (existingIndex >= 0) {
        profiles[existingIndex] = profile;
      } else {
        profiles.push(profile);
      }
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
      saveProgressiveBackup();
      document.getElementById('profileForm').reset();
      document.getElementById('profileFields').innerHTML = '';
      document.getElementById('photoAdjust').style.display = 'none';
      showToast('Profile saved successfully');
      document.getElementById('loadingIndicator').style.display = 'none';
      showProfileSearch();
    };
    if (photo && typeof photo === 'string' && photo.startsWith('data:')) {
      processPhoto(photo);
    } else if (photo) {
      const reader = new FileReader();
      reader.onload = () => processPhoto(reader.result);
      reader.onerror = () => {
        showToast('Failed to read photo. Please try again.');
        document.getElementById('loadingIndicator').style.display = 'none';
      };
      reader.readAsDataURL(photo);
    } else {
      processPhoto('');
    }
  } catch (error) {
    console.error('Profile form error:', error);
    showToast('Failed to save profile. Please try again.');
    document.getElementById('loadingIndicator').style.display = 'none';
  }
});

function renderProfiles() {
  const typeFilter = document.getElementById('profileFilterType').value;
  const search = document.getElementById('profileSearch').value.toLowerCase();
  const tbody = document.getElementById('profileTable').querySelector('tbody');
  tbody.innerHTML = '';
  let filteredProfiles = profiles;
  if (typeFilter) filteredProfiles = profiles.filter(p => p.type === typeFilter);
  if (search) {
    const fuse = new Fuse(filteredProfiles, { keys: ['name', 'cellNo', 'chamberNo', 'advocateName', 'designation'], threshold: 0.3 });
    filteredProfiles = fuse.search(search).map(result => result.item);
  }
  filteredProfiles.forEach(p => {
    const delivered = files.filter(f => f.deliveredToName === p.name && f.deliveredToType === p.type).length;
    const pending = files.filter(f => f.deliveredToName === p.name && f.deliveredToType === p.type && !f.returned).length;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${p.photo || 'icon-192.png'}" style="width:50px;height:50px;border-radius:50%;border:1px solid #ccc;"></td>
      <td>${p.name}</td>
      <td>${p.type}</td>
      <td>${p.cellNo}</td>
      <td>${p.chamberNo || ''}</td>
      <td>${delivered}</td>
      <td>${pending}</td>
      <td>
        <button onclick="editProfile('${p.name}', '${p.type}')">Edit</button>
        <button onclick="deleteProfile('${p.name}', '${p.type}')">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function editProfile(name, type) {
  const profile = profiles.find(p => p.name === name && p.type === type);
  if (!profile) return;
  document.getElementById('profileForm').style.display = 'block';
  document.getElementById('profileSearchSection').style.display = 'none';
  document.getElementById('profileList').style.display = 'none';
  document.getElementById('profileType').value = profile.type;
  toggleProfileFields();
  document.getElementById('profileName').value = profile.name;
  document.getElementById('cellNo').value = profile.cellNo;
  if (document.getElementById('chamberNo')) document.getElementById('chamberNo').value = profile.chamberNo || '';
  if (document.getElementById('advocateName')) document.getElementById('advocateName').value = profile.advocateName || '';
  if (document.getElementById('advocateCell')) document.getElementById('advocateCell').value = profile.advocateCell || '';
  if (document.getElementById('designation')) document.getElementById('designation').value = profile.designation || '';
  if (document.getElementById('postedAt')) document.getElementById('postedAt').value = profile.postedAt || '';
  if (document.getElementById('cnic')) document.getElementById('cnic').value = profile.cnic || '';
  if (document.getElementById('relation')) document.getElementById('relation').value = profile.relation || '';
}

function deleteProfile(name, type) {
  promptPin((success) => {
    if (success) {
      profiles = profiles.filter(p => p.name !== name || p.type !== type);
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
      saveProgressiveBackup();
      showToast('Profile deleted successfully');
      renderProfiles();
    }
  });
}

function triggerImport() {
  document.getElementById('profileImport').click();
}

function importProfiles() {
  const file = document.getElementById('profileImport').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const importedProfiles = JSON.parse(reader.result);
      if (!Array.isArray(importedProfiles)) throw new Error('Invalid profile data');
      importedProfiles.forEach(newProfile => {
        const existingIndex = profiles.findIndex(p => 
          p.name === newProfile.name &&
          p.type === newProfile.type &&
          p.cellNo === newProfile.cellNo &&
          (p.chamberNo || '') === (newProfile.chamberNo || '')
        );
        if (existingIndex >= 0) {
          profiles[existingIndex] = { ...profiles[existingIndex], ...newProfile };
        } else {
          profiles.push(newProfile);
        }
      });
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
      saveProgressiveBackup();
      showToast('Profiles imported successfully');
      showProfileSearch();
    } catch (error) {
      showToast('Failed to import profiles. Invalid file format.');
    }
  };
  reader.readAsText(file);
}

function exportProfiles() {
  const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `profiles_${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function backupData() {
  const data = {
    files,
    profiles,
    userProfile: { ...userProfile, pin: null, cnic: maskCNIC(userProfile.cnic) },
    analytics
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cft_backup_${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  analytics.backupsCreated++;
  localStorage.setItem('analytics', JSON.stringify(analytics));
  syncLocalStorageToIndexedDB();
}

function triggerRestore() {
  document.getElementById('dataRestore').click();
}

function restoreData() {
  const file = document.getElementById('dataRestore').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const newFiles = data.files || [];
      newFiles.forEach(newFile => {
        const existingIndex = files.findIndex(f => 
          f.cmsNo === newFile.cmsNo &&
          f.deliveredToName === newFile.deliveredToName &&
          f.deliveredToType === newFile.deliveredToType &&
          f.deliveredAt === newFile.deliveredAt
        );
        if (existingIndex >= 0) {
          if (newFile.returnedAt && (!files[existingIndex].returnedAt || new Date(newFile.returnedAt) > new Date(files[existingIndex].returnedAt))) {
            files[existingIndex] = { ...files[existingIndex], ...newFile };
          }
        } else {
          files.push(newFile);
        }
      });
      const newProfiles = data.profiles || [];
      newProfiles.forEach(newProfile => {
        const existingIndex = profiles.findIndex(p => 
          p.name === newProfile.name &&
          p.type === newProfile.type &&
          p.cellNo === newProfile.cellNo &&
          (p.chamberNo || '') === (newProfile.chamberNo || '')
        );
        if (existingIndex >= 0) {
          const existing = profiles[existingIndex];
          const newFieldCount = Object.values(newProfile).filter(v => v).length;
          const oldFieldCount = Object.values(existing).filter(v => v).length;
          if (newFieldCount > oldFieldCount) {
            profiles[existingIndex] = { ...existing, ...newProfile };
          }
        } else {
          profiles.push(newProfile);
        }
      });
      analytics.filesEntered = Math.max(analytics.filesEntered, data.analytics?.filesEntered || 0);
      analytics.searchesPerformed = Math.max(analytics.searchesPerformed, data.analytics?.searchesPerformed || 0);
      analytics.backupsCreated = Math.max(analytics.backupsCreated, data.analytics?.backupsCreated || 0);
      userProfile = data.userProfile ? { ...data.userProfile, pin: userProfile?.pin || '', cnic: userProfile?.cnic || '' } : userProfile;
      localStorage.setItem('files', JSON.stringify(files));
      localStorage.setItem('profiles', JSON.stringify(profiles));
      localStorage.setItem('userProfile', JSON.stringify(userProfile));
      localStorage.setItem('analytics', JSON.stringify(analytics));
      syncLocalStorageToIndexedDB();
      saveProgressiveBackup();
      showToast('Data restored successfully');
      updateSavedProfile();
      updateDashboardCards();
    } catch (error) {
      showToast('Failed to restore data. Invalid file format.');
    }
  };
  reader.readAsText(file);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 3000);
}

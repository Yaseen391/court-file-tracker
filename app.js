// Global Variables
let files = JSON.parse(localStorage.getItem('files')) || [];
let profiles = JSON.parse(localStorage.getItem('profiles')) || [];
let userProfile = JSON.parse(localStorage.getItem('userProfile')) || null;
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue')) || [];
let analytics = JSON.parse(localStorage.getItem('analytics')) || {
  filesEntered: 0,
  searchesPerformed: 0,
  backupsCreated: 0
};
let deferredPrompt;

// IndexedDB Setup
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
    if (!db.objectStoreNames.contains('auth')) {
      db.createObjectStore('auth', { keyPath: 'id' });
    }
  };
  request.onsuccess = (event) => {
    db = event.target.result;
    syncLocalStorageToIndexedDB();
  };
  request.onerror = () => console.error('IndexedDB error');
}

function syncLocalStorageToIndexedDB() {
  const data = {
    files,
    profiles,
    userProfile,
    offlineQueue,
    analytics
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
  const keys = ['files', 'profiles', 'userProfile', 'offlineQueue', 'analytics'];
  keys.forEach(key => {
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result) {
        localStorage.setItem(key, JSON.stringify(request.result.value));
        if (key === 'files') files = request.result.value;
        if (key === 'profiles') profiles = request.result.value;
        if (key === 'userProfile') userProfile = request.result.value;
        if (key === 'offlineQueue') offlineQueue = request.result.value;
        if (key === 'analytics') analytics = request.result.value;
      }
    };
  });
}

// Google Drive API Configuration
const CLIENT_ID = 'YOUR_CLIENT_ID';
const API_KEY = 'YOUR_API_KEY';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'CourtFileTracker';
const BACKUP_FILE_NAME = 'court_file_backup.json';
let tokenClient;

function initGoogleDrive() {
  gapi.load('client:auth2', () => {
    gapi.client.init({
      apiKey: API_KEY,
      clientId: CLIENT_ID,
      scope: SCOPES
    }).then(() => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.access_token) {
            const tokenData = {
              access_token: response.access_token,
              expires_at: Date.now() + (response.expires_in * 1000)
            };
            localStorage.setItem('gapi_token', JSON.stringify(tokenData));
            saveRefreshToken(response.refresh_token);
            updateGoogleDriveButtons(true);
            showToast('Signed in to Google Drive');
            syncLocalStorageToIndexedDB();
            processOfflineQueue();
            createAppDataFolder();
          }
        }
      });
      checkGoogleAuth();
    });
  });
}

function checkGoogleAuth() {
  const transaction = db.transaction(['auth'], 'readonly');
  const store = transaction.objectStore('auth');
  const request = store.get('googleAuth');
  request.onsuccess = () => {
    if (request.result && request.result.refreshToken) {
      refreshGoogleToken(request.result.refreshToken);
    }
  };
}

function saveRefreshToken(refreshToken) {
  if (refreshToken) {
    const transaction = db.transaction(['auth'], 'readwrite');
    const store = transaction.objectStore('auth');
    store.put({ id: 'googleAuth', refreshToken });
  }
}

function refreshGoogleToken(refreshToken) {
  if (!navigator.onLine) return;
  fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${CLIENT_ID}&client_secret=YOUR_CLIENT_SECRET&refresh_token=${refreshToken}&grant_type=refresh_token`
  })
  .then(response => response.json())
  .then(data => {
    if (data.access_token) {
      const tokenData = {
        access_token: data.access_token,
        expires_at: Date.now() + (data.expires_in * 1000)
      };
      localStorage.setItem('gapi_token', JSON.stringify(tokenData));
      gapi.auth2.getAuthInstance().currentUser.get().setAuthResponse({ access_token: data.access_token });
      updateGoogleDriveButtons(true);
      processOfflineQueue();
    }
  });
}

function updateGoogleDriveButtons(show) {
  document.getElementById('backupToDrive').style.display = show ? 'inline-block' : 'none';
  document.getElementById('restoreFromDrive').style.display = show ? 'inline-block' : 'none';
}

function signInWithGoogle() {
  if (!navigator.onLine) {
    showToast('No internet connection.');
    return;
  }
  tokenClient.requestAccessToken({ prompt: 'consent', access_type: 'offline' });
}

function isGoogleTokenValid() {
  const token = JSON.parse(localStorage.getItem('gapi_token'));
  return token && token.expires_at > Date.now();
}

function createAppDataFolder() {
  gapi.client.drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder'`,
    fields: 'files(id, name)'
  }).then(response => {
    if (response.result.files.length === 0) {
      gapi.client.drive.files.create({
        resource: {
          name: FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder'
        }
      }).then(folder => {
        console.log('Folder created:', folder.result.id);
      });
    }
  });
}

function backupToDrive() {
  if (!navigator.onLine) {
    offlineQueue.push({ action: 'backupToDrive', data: null });
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
    syncLocalStorageToIndexedDB();
    showToast('Backup queued.');
    return;
  }
  if (!isGoogleTokenValid()) {
    signInWithGoogle();
    return;
  }
  const transaction = db.transaction(['data'], 'readonly');
  const store = transaction.objectStore('data');
  const request = store.get('files');
  request.onsuccess = () => {
    const data = encryptData(JSON.stringify(request.result.value));
    gapi.client.drive.files.list({
      q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder'`,
      fields: 'files(id, name)'
    }).then(response => {
      const folderId = response.result.files[0]?.id;
      if (folderId) {
        uploadBackupFile(folderId, data);
      }
    });
  };
}

function uploadBackupFile(folderId, data) {
  gapi.client.drive.files.list({
    q: `name='${BACKUP_FILE_NAME}' and '${folderId}' in parents`,
    fields: 'files(id, name)'
  }).then(response => {
    const metadata = {
      name: BACKUP_FILE_NAME,
      mimeType: 'application/json',
      parents: [folderId]
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([data], { type: 'application/json' }));
    const method = response.result.files.length > 0 ? 'PATCH' : 'POST';
    const fileId = response.result.files.length > 0 ? response.result.files[0].id : '';
    gapi.client.request({
      path: `/upload/drive/v3/files${fileId ? '/' + fileId : ''}`,
      method,
      params: { uploadType: 'multipart' },
      body: form
    }).then(() => {
      analytics.backupsCreated++;
      localStorage.setItem('analytics', JSON.stringify(analytics));
      syncLocalStorageToIndexedDB();
      showToast('Backup uploaded.');
      showNotification('Backup completed');
    });
  });
}

function restoreFromDrive() {
  if (!navigator.onLine) {
    showToast('No internet connection.');
    return;
  }
  if (!isGoogleTokenValid()) {
    signInWithGoogle();
    return;
  }
  gapi.client.drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder'`,
    fields: 'files(id, name)'
  }).then(response => {
    if (response.result.files.length > 0) {
      const folderId = response.result.files[0].id;
      gapi.client.drive.files.list({
        q: `name='${BACKUP_FILE_NAME}' and '${folderId}' in parents`,
        fields: 'files(id, name)'
      }).then(fileResponse => {
        if (fileResponse.result.files.length > 0) {
          const fileId = fileResponse.result.files[0].id;
          gapi.client.drive.files.get({
            fileId,
            alt: 'media'
          }).then(file => {
            const decryptedData = decryptData(file.body);
            mergeRecords(JSON.parse(decryptedData));
            showToast('Data restored.');
            showNotification('Data restored');
          });
        } else {
          showToast('No backup found.');
        }
      });
    } else {
      showToast('No backup folder found.');
    }
  });
}

// Encryption
function encryptData(data) {
  const passphrase = 'secure-passphrase';
  return CryptoJS.AES.encrypt(data, passphrase).toString();
}

function decryptData(data) {
  const passphrase = 'secure-passphrase';
  return CryptoJS.AES.decrypt(data, passphrase).toString(CryptoJS.enc.Utf8);
}

// Service Worker and Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(registration => console.log('Service Worker registered'))
      .catch(error => console.error('Service Worker error:', error));
  });
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

function showNotification(message) {
  if (Notification.permission === 'granted') {
    navigator.serviceWorker.ready.then(registration => {
      registration.showNotification('Court File Tracker', {
        body: message,
        icon: 'icons/icon-192.png'
      });
    });
  }
}

function checkOverdueFiles() {
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const overdueFiles = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo);
  if (overdueFiles.length > 0) {
    showNotification(`${overdueFiles.length} file(s) are overdue by more than 10 days.`);
  }
}

// Authentication
function checkAuth() {
  const transaction = db.transaction(['auth'], 'readonly');
  const store = transaction.objectStore('auth');
  const request = store.get('user');
  request.onsuccess = () => {
    if (request.result && request.result.refreshToken) {
      refreshSessionToken(request.result.refreshToken);
    } else {
      showLogin();
    }
  };
}

function refreshSessionToken(refreshToken) {
  fetch('https://your-backend.com/refresh-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `refresh_token=${refreshToken}&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&grant_type=refresh_token`
  })
  .then(response => response.json())
  .then(data => {
    if (data.access_token) {
      localStorage.setItem('sessionToken', data.access_token);
      navigate('dashboard');
    } else {
      showLogin();
    }
  })
  .catch(() => showLogin());
}

function showLogin() {
  document.getElementById('main-content').innerHTML = `
    <h2>Login</h2>
    <form id="loginForm">
      <input type="text" id="username" placeholder="Username" required>
      <input type="password" id="password" placeholder="Password" required>
      <button type="submit">Login</button>
    </form>
  `;
  document.getElementById('loginForm').addEventListener('submit', login);
}

function login(event) {
  event.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  fetch('https://your-backend.com/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  .then(response => response.json())
  .then(data => {
    if (data.access_token && data.refresh_token) {
      localStorage.setItem('sessionToken', data.access_token);
      const transaction = db.transaction(['auth'], 'readwrite');
      const store = transaction.objectStore('auth');
      store.put({ id: 'user', refreshToken: data.refresh_token });
      navigate('dashboard');
    } else {
      showToast('Login failed');
    }
  })
  .catch(() => showToast('Login error'));
}

function logout() {
  localStorage.removeItem('sessionToken');
  const transaction = db.transaction(['auth'], 'readwrite');
  const store = transaction.objectStore('auth');
  store.delete('user');
  showLogin();
}

// Navigation and Sidebar
function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));
  const button = document.querySelector(`.sidebar button[onclick="navigate('${screenId}')"]`);
  if (button) button.classList.add('active');
  if (screenId === 'dashboard') updateDashboardCards();
  if (screenId === 'return') filterPendingFiles();
  if (screenId === 'fileFetcher') renderProfiles();
  closeSidebar();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  sidebar.classList.toggle('active');
  overlay.classList.toggle('active');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('active');
  document.querySelector('.sidebar-overlay').classList.remove('active');
}

document.addEventListener('click', event => {
  const sidebar = document.getElementById('sidebar');
  const hamburger = document.getElementById('hamburger');
  if (!sidebar.contains(event.target) && !hamburger.contains(event.target)) {
    closeSidebar();
  }
});

window.addEventListener('popstate', closeSidebar);

// Window Onload
window.onload = () => {
  initIndexedDB();
  initGoogleDrive();
  setupPushNotifications();
  checkAuth();

  // PWA Install Prompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installBtn').style.display = 'block';
  });

  document.getElementById('installBtn').addEventListener('click', () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(choiceResult => {
        if (choiceResult.outcome === 'accepted') {
          showToast('App installation started');
        }
        deferredPrompt = null;
        document.getElementById('installBtn').style.display = 'none';
      });
    }
  });

  // Sidebar Navigation
  document.getElementById('dashboardLink').addEventListener('click', () => navigate('dashboard'));
  document.getElementById('fileEntryLink').addEventListener('click', () => navigate('file'));
  document.getElementById('fileFetcherLink').addEventListener('click', () => navigate('fileFetcher'));
  document.getElementById('profileLink').addEventListener('click', () => navigate('admin'));
  document.getElementById('backupLink').addEventListener('click', backupToDrive);
  document.getElementById('restoreLink').addEventListener('click', restoreFromDrive);
  document.getElementById('logoutLink').addEventListener('click', logout);

  document.getElementById('hamburger').addEventListener('click', toggleSidebar);
  document.getElementById('agreeTerms').addEventListener('change', toggleSaveButton);
  setupPhotoAdjust('userPhoto', 'userPhotoPreview', 'userPhotoAdjust');
  setupPhotoAdjust('profilePhoto', 'photoPreview', 'photoAdjust');
  setInterval(refreshGoogleToken, 60000);
  scheduleBackups();

  if (userProfile) {
    document.getElementById('setupMessage').style.display = 'none';
    document.getElementById('adminForm').style.display = 'none';
    document.getElementById('savedProfile').style.display = 'block';
    updateSavedProfile();
    navigate('dashboard');
  } else {
    navigate('admin');
  }
};

function scheduleBackups() {
  setInterval(() => {
    if (navigator.onLine && isGoogleTokenValid()) {
      backupToDrive();
    }
  }, 6 * 60 * 60 * 1000);
}

// Admin Form
document.getElementById('adminForm').addEventListener('submit', e => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  setTimeout(() => {
    const userPhotoInput = document.getElementById('userPhoto');
    let photo = userPhotoInput.adjustedPhoto || (userPhotoInput.files && userPhotoInput.files[0]);
    if (!photo) {
      showToast('Please upload a profile photo');
      document.getElementById('loadingIndicator').style.display = 'none';
      return;
    }
    const processPhoto = photoData => {
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
      document.getElementById('setupMessage').style.display = 'none';
      document.getElementById('adminForm').style.display = 'none';
      document.getElementById('savedProfile').style.display = 'block';
      updateSavedProfile();
      showToast('Profile saved. Sign in to Google Drive.');
      signInWithGoogle();
      document.getElementById('loadingIndicator').style.display = 'none';
      navigate('dashboard');
    };
    if (typeof photo === 'string' && photo.startsWith('data:')) {
      processPhoto(photo);
    } else {
      const reader = new FileReader();
      reader.onload = () => processPhoto(reader.result);
      reader.onerror = () => {
        showToast('Failed to read photo.');
        document.getElementById('loadingIndicator').style.display = 'none';
      };
      reader.readAsDataURL(photo);
    }
  }, 500);
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

// Photo Adjust
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

  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
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
          let quality = 0.8;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          while (dataUrl.length > 100 * 1024 && quality > 0.1) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
          input.adjustedPhoto = dataUrl;
          document.getElementById('loadingIndicator').style.display = 'none';
        });
      };
    };
    reader.onerror = () => {
      showToast('Error reading photo.');
      document.getElementById('loadingIndicator').style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  function drawImage(orientation) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let imgWidth = img.width;
    let imgHeight = img.height;
    scaleFactor = Math.max(canvas.width / imgWidth, canvas.height / imgHeight);
    imgWidth *= scaleFactor;
    imgHeight *= scaleFactor;
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

  canvas.addEventListener('mousedown', e => {
    e.preventDefault();
    isDragging = true;
    startX = e.offsetX - offsetX;
    startY = e.offsetY - offsetY;
  });

  canvas.addEventListener('mousemove', e => {
    if (isDragging) {
      offsetX = e.offsetX - startX;
      offsetY = e.offsetY - startY;
      drawImage(1);
    }
  });

  canvas.addEventListener('mouseup', () => {
    isDragging = false;
    updatePhotoData();
  });

  canvas.addEventListener('mouseleave', () => {
    isDragging = false;
  });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    isDragging = true;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    startX = touch.clientX - rect.left - offsetX;
    startY = touch.clientY - rect.top - offsetY;
  });

  canvas.addEventListener('touchmove', e => {
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
    updatePhotoData();
  });

  function updatePhotoData() {
    let quality = 0.8;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > 100 * 1024 && quality > 0.1) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    input.adjustedPhoto = dataUrl;
  }
}

function toggleSaveButton() {
  document.getElementById('saveProfileBtn').disabled = !document.getElementById('agreeTerms').checked;
}

function showDisclaimerModal() {
  document.getElementById('disclaimerModal').style.display = 'block';
}

function promptPin(callback) {
  document.getElementById('pinModal').style.display = 'block';
  document.getElementById('pinInput').value = '';
  document.getElementById('pinInput').focus();
  window.submitPin = () => {
    const pin = document.getElementById('pinInput').value;
    document.getElementById('pinModal').style.display = 'none';
    callback(pin === userProfile.pin);
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

// Dashboard
function updateDashboardCards() {
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
}

// File Form
document.getElementById('fileForm').addEventListener('submit', e => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  promptPin(success => {
    if (!success) {
      showToast('PIN verification failed');
      document.getElementById('loadingIndicator').style.display = 'none';
      return;
    }
    const cmsNo = document.getElementById('cmsNo').value;
    const existingDelivered = files.find(f => f.cmsNo === cmsNo && !f.returned);
    if (existingDelivered) {
      showToast(`File ${cmsNo} is already delivered to ${existingDelivered.deliveredToName} (${existingDelivered.deliveredToType}).`);
      document.getElementById('loadingIndicator').style.display = 'none';
      return;
    }
    setTimeout(() => {
      const deliveredToName = document.getElementById('deliveredTo').value;
      const deliveredToType = document.getElementById('deliveredType').value;
      const profileExists = profiles.find(p => p.name === deliveredToName && p.type === deliveredToType);
      if (!profileExists) {
        showToast('Profile does not exist. Add it in File Fetcher.');
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
        deliveredToName,
        deliveredToType,
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
      document.getElementById('fileForm').reset();
      document.getElementById('criminalFields').style.display = 'none';
      document.getElementById('copyAgencyFields').style.display = 'none';
      document.getElementById('copyAgency').checked = false;
      ['petitioner', 'respondent', 'caseType', 'nature', 'firNo', 'firYear', 'firUs', 'policeStation', 'dateType', 'date', 'deliveredTo', 'deliveredType', 'swalFormNo', 'swalDate', 'copyAgency'].forEach(field => {
        document.getElementById(field).disabled = false;
      });
      showToast('File saved and delivered.');
      showNotification('File delivered');
      document.getElementById('loadingIndicator').style.display = 'none';
      updateDashboardCards();
    }, 500);
  });
});

function autoFillCMS() {
  const cmsNo = document.getElementById('cmsNo').value;
  const existing = files.find(f => f.cmsNo === cmsNo);
  const caseFields = ['petitioner', 'respondent', 'caseType', 'nature', 'firNo', 'firYear', 'firUs', 'policeStation'];
  const editableFields = ['dateType', 'date', 'deliveredTo', 'deliveredType', 'swalFormNo', 'swalDate', 'copyAgency'];
  if (existing) {
    document.getElementById('petitioner').value = existing.title.split(' vs ')[0];
    document.getElementById('respondent').value = existing.title.split(' vs ')[1];
    document.getElementById('caseType').value = existing.caseType;
    document.getElementById('nature').value = existing.nature;
    document.getElementById('firNo').value = existing.firNo || '';
    document.getElementById('firYear').value = existing.firYear || '';
    document.getElementById('firUs').value = existing.firUs || '';
    document.getElementById('policeStation').value = existing.policeStation || '';
    toggleCriminalFields();
    caseFields.forEach(field => document.getElementById(field).disabled = true);
    editableFields.forEach(field => document.getElementById(field).disabled = false);
    document.getElementById('copyAgency').checked = false;
    document.getElementById('deliveredTo').value = '';
    document.getElementById('deliveredType').value = '';
    document.getElementById('swalFormNo').value = '';
    document.getElementById('swalDate').value = '';
    toggleCopyAgency();
  } else {
    caseFields.concat(editableFields).forEach(field => document.getElementById(field).disabled = false);
    document.getElementById('copyAgency').disabled = false;
  }
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
  const fuse = new Fuse(profiles, {
    keys: ['name', 'cellNo', 'chamberNo'],
    threshold: 0.3
  });
  const results = fuse.search(input).slice(0, 5);
  results.forEach(result => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = result.item.photo || 'icon-192.png';
    img.style.width = '40px';
    img.style.height = '40px';
    img.style.borderRadius = '50%';
    img.style.border = '1px solid #ccc';
    li.appendChild(img);
    const text = document.createElement('span');
    text.textContent = `${result.item.name} (${result.item.type})`;
    li.appendChild(text);
    li.onclick = () => {
      document.getElementById(inputId).value = result.item.name;
      if (inputId === 'deliveredTo') {
        document.getElementById('deliveredType').value = result.item.type;
      }
      suggestions.innerHTML = '';
    };
    suggestions.appendChild(li);
  });
}

// File Return
function filterPendingFiles() {
  const cms = document.getElementById('returnCms').value;
  const title = document.getElementById('returnTitle').value.toLowerCase();
  const tbody = document.getElementById('pendingFilesTable').querySelector('tbody');
  tbody.innerHTML = '';
  const filteredFiles = files.filter(f => !f.returned && (!cms || f.cmsNo.toString().includes(cms)) && (!title || f.title.toLowerCase().includes(title)));
  filteredFiles.forEach(f => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="select-file" data-cms="${f.cmsNo}"></td>
      <td>${f.cmsNo}</td>
      <td>${f.title.replace('vs', 'Vs.')}</td>
      <td>${f.caseType}</td>
      <td><a href="#" onclick="showProfileDetails('${f.deliveredToName}', '${f.deliveredToType}')">${f.deliveredToName} (${f.deliveredToType})</a></td>
      <td><button onclick="returnFile('${f.cmsNo}')">Return</button></td>
    `;
    tbody.appendChild(row);
  });
}

function returnFile(cmsNo) {
  promptPin(success => {
    if (success) {
      const file = files.find(f => f.cmsNo === cmsNo && !f.returned);
      if (file) {
        file.returned = true;
        file.returnedAt = new Date().toISOString();
        localStorage.setItem('files', JSON.stringify(files));
        syncLocalStorageToIndexedDB();
        showToast(`File ${cmsNo} returned.`);
        showNotification(`File ${cmsNo} returned`);
        filterPendingFiles();
        updateDashboardCards();
      }
    }
  });
}

function bulkReturnFiles() {
  const selected = document.querySelectorAll('.select-file:checked');
  if (selected.length === 0) {
    showToast('Select at least one file.');
    return;
  }
  promptPin(success => {
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
      showToast(`${selected.length} file(s) returned.`);
      showNotification(`${selected.length} file(s) returned`);
      filterPendingFiles();
      updateDashboardCards();
    }
  });
}

// Profile Management
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

document.getElementById('profileForm').addEventListener('submit', e => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  const profileType = document.getElementById('profileType').value;
  const photoInput = document.getElementById('profilePhoto');
  let photo = photoInput.adjustedPhoto || (photoInput.files && photoInput.files[0]);
  if (!photo && profileType !== 'advocate') {
    showToast('Please upload a profile photo');
    document.getElementById('loadingIndicator').style.display = 'none';
    return;
  }
  const processPhoto = photoData => {
    const profile = {
      type: document.getElementById('profileType').value,
      name: document.getElementById('profileName').value,
      cellNo: document.getElementById('cellNo').value,
      chamberNo: document.getElementById('chamberNo') ? document.getElementById('chamberNo').value : '',
      advocateName: document.getElementById('advocateName') ? document.getElementById('advocateName').value : '',
      advocateCell: document.getElementById('advocateCell') ? document.getElementById('advocateCell').value : '',
      designation: document.getElementById('designation') ? document.getElementById('designation').value : '',
      postedAt: document.getElementById('postedAt') ? document.getElementById('postedAt').value : '',
      cnic: document.getElementById('cnic') ? document.getElementById('cnic').value : '',
      relation: document.getElementById('relation') ? document.getElementById('relation').value : '',
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
    document.getElementById('profileForm').reset();
    document.getElementById('profileFields').innerHTML = '';
    document.getElementById('photoAdjust').style.display = 'none';
    showToast('Profile saved.');
    document.getElementById('loadingIndicator').style.display = 'none';
    showProfileSearch();
  };
  if (photo && typeof photo === 'string' && photo.startsWith('data:')) {
    processPhoto(photo);
  } else if (photo) {
    const reader = new FileReader();
    reader.onload = () => processPhoto(reader.result);
    reader.onerror = () => {
      showToast('Failed to read photo.');
      document.getElementById('loadingIndicator').style.display = 'none';
    };
    reader.readAsDataURL(photo);
  } else {
    processPhoto('');
  }
});

function renderProfiles() {
  const typeFilter = document.getElementById('profileFilterType').value;
  const search = document.getElementById('profileSearch').value.toLowerCase();
  const tbody = document.getElementById('profileTable').querySelector('tbody');
  tbody.innerHTML = '';
  let filteredProfiles = profiles;
  if (typeFilter) {
    filteredProfiles = profiles.filter(p => p.type === typeFilter);
  }
  if (search) {
    const fuse = new Fuse(filteredProfiles, {
      keys: ['name', 'cellNo', 'chamberNo', 'advocateName', 'designation'],
      threshold: 0.3
    });
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
  promptPin(success => {
    if (success) {
      profiles = profiles.filter(p => p.name !== name || p.type !== type);
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
      showToast('Profile deleted.');
      renderProfiles();
    }
  });
}

// Data Import/Export
function triggerImport() {
  document.getElementById('profileImport').click();
}

function importProfiles() {
  const file = document.getElementById('profileImport').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const importedProfiles = JSON.parse(decryptData(reader.result));
      profiles = [...profiles, ...importedProfiles];
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
      showToast('Profiles imported.');
      showProfileSearch();
    } catch (error) {
      showToast('Failed to import profiles.');
    }
  };
  reader.readAsText(file);
}

function exportProfiles() {
  const encryptedData = encryptData(JSON.stringify(profiles));
  const blob = new Blob([encryptedData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `profiles_${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function backupData() {
  const data = { files, profiles, userProfile: { ...userProfile, pin: null, cnic: maskCNIC(userProfile.cnic) }, analytics };
  const encryptedData = encryptData(JSON.stringify(data));
  const blob = new Blob([encryptedData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  analytics.backupsCreated++;
  localStorage.setItem('analytics', JSON.stringify(analytics));
  syncLocalStorageToIndexedDB();
  showToast('Backup created.');
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
      const data = JSON.parse(decryptData(reader.result));
      if (data.files) mergeRecords(data.files);
      if (data.profiles) profiles = data.profiles;
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
      showToast('Data restored.');
      updateSavedProfile();
      updateDashboardCards();
      navigate('dashboard');
    } catch (error) {
      showToast('Failed to restore data.');
    }
  };
  reader.readAsText(file);
}

function mergeRecords(newRecords) {
  const existingIds = new Set(files.map(f => f.cmsNo));
  newRecords.forEach(record => {
    if (!existingIds.has(record.cmsNo)) {
      files.push(record);
    } else {
      const index = files.findIndex(f => f.cmsNo === record.cmsNo);
      files[index] = record;
    }
  });
  localStorage.setItem('files', JSON.stringify(files));
  syncLocalStorageToIndexedDB();
}

// Utilities
function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return format === 'YYYY-MM-DD HH:mm:ss' ? `${year}-${month}-${day} ${hours}:${minutes}:${seconds}` : `${year}-${month}-${day}`;
}

function maskCNIC(cnic) {
  if (!cnic) return '';
  const parts = cnic.split('-');
  return parts.length === 3 ? `${parts[0].slice(0, 2)}***-${parts[1].slice(0, 3)}****-${parts[2]}` : '*****-*******-*';
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Accessibility and Enhancements
document.querySelectorAll('input, button, a').forEach(el => {
  el.setAttribute('tabindex', '0');
  el.addEventListener('keypress', e => {
    if (e.key === 'Enter' && el.tagName !== 'INPUT') el.click();
  });
});

window.addEventListener('online', () => {
  showToast('You are now online');
  if (isGoogleTokenValid()) processOfflineQueue();
});

window.addEventListener('offline', () => {
  showToast('You are now offline.');
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    navigate('dashboard');
  } else if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    navigate('file');
  } else if (e.ctrlKey && e.key === 'r') {
    e.preventDefault();
    navigate('return');
  } else if (e.ctrlKey && e.key === 'p') {
    e.preventDefault();
    navigate('fileFetcher');
  }
});

function validateInput(input, type) {
  if (type === 'phone') {
    const phoneRegex = /^\d{10,15}$/;
    input.setCustomValidity(phoneRegex.test(input.value) ? '' : 'Please enter a valid phone number (10-15 digits)');
  } else if (type === 'cnic') {
    const cnicRegex = /^\d{5}-\d{7}-\d{1}$/;
    input.setCustomValidity(input.value && !cnicRegex.test(input.value) ? 'Please enter a valid CNIC (e.g., 12345-1234567-1)' : '');
  } else if (type === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    input.setCustomValidity(input.value && !emailRegex.test(input.value) ? 'Please enter a valid email address' : '');
  }
}

document.getElementById('mobile').addEventListener('input', () => validateInput(document.getElementById('mobile'), 'phone'));
document.getElementById('cnic').addEventListener('input', () => validateInput(document.getElementById('cnic'), 'cnic'));
document.getElementById('email').addEventListener('input', () => validateInput(document.getElementById('email'), 'email'));
document.getElementById('cellNo').addEventListener('input', () => validateInput(document.getElementById('cellNo'), 'phone'));
if (document.getElementById('advocateCell')) {
  document.getElementById('advocateCell').addEventListener('input', () => validateInput(document.getElementById('advocateCell'), 'phone'));
}

setInterval(() => {
  if (navigator.onLine && isGoogleTokenValid()) syncLocalStorageToIndexedDB();
}, 300000);

window.addEventListener('beforeunload', e => {
  if (files.length > 0 || profiles.length > 0) {
    e.preventDefault();
    e.returnValue = 'You have unsaved data. Are you sure?';
  }
});

function applyTheme(theme) {
  document.body.className = theme;
  localStorage.setItem('theme', theme);
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const currentTheme = localStorage.getItem('theme') || 'light';
  applyTheme(currentTheme === 'light' ? 'dark' : 'light');
});

applyTheme(localStorage.getItem('theme') || 'light');

window.addEventListener('error', event => {
  console.error('Global error:', event.error);
  showToast('An unexpected error occurred.');
});

function enableVoiceInput(inputId) {
  const input = document.getElementById(inputId);
  if ('webkitSpeechRecognition' in window) {
    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = event => {
      input.value = event.results[0][0].transcript;
      input.dispatchEvent(new Event('input'));
    };
    recognition.onerror = () => showToast('Voice input failed.');
    recognition.start();
  } else {
    showToast('Voice input not supported.');
  }
}

['clerkName', 'judgeName', 'courtName', 'profileName'].forEach(id => {
  const input = document.getElementById(id);
  if (input) {
    const button = document.createElement('button');
    button.textContent = '🎤';
    button.type = 'button';
    button.style.marginLeft = '5px';
    button.onclick = () => enableVoiceInput(id);
    input.parentNode.appendChild(button);
  }
});

document.querySelectorAll('img').forEach(img => img.setAttribute('loading', 'lazy'));

function compressData(data) {
  return pako.gzip(JSON.stringify(data), { to: 'string' });
}

function decompressData(compressed) {
  return JSON.parse(pako.ungzip(compressed, { to: 'string' }));
}

const originalSetItem = localStorage.setItem;
localStorage.setItem = function(key, value) {
  originalSetItem.call(this, key, ['files', 'profiles', 'analytics'].includes(key) ? compressData(value) : value);
};

const originalGetItem = localStorage.getItem;
localStorage.getItem = function(key) {
  const value = originalGetItem.call(this, key);
  if (['files', 'profiles', 'analytics'].includes(key) && value) {
    try {
      return decompressData(value);
    } catch (e) {
      return value;
    }
  }
  return value;
};

console.log('Court File Tracker initialized');

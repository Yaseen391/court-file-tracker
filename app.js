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
let deferredPrompt = null; // For PWA install prompt

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
  const data = {
    files: JSON.parse(localStorage.getItem('files')) || [],
    profiles: JSON.parse(localStorage.getItem('profiles')) || [],
    userProfile: JSON.parse(localStorage.getItem('userProfile')) || null,
    offlineQueue: JSON.parse(localStorage.getItem('offlineQueue')) || [],
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
const CLIENT_ID = 'YOUR_CLIENT_ID'; // Replace with your actual Client ID
const API_KEY = 'YOUR_API_KEY'; // Replace with your actual API Key
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
let tokenClient;

function initGoogleDrive() {
  gapi.load('client', () => {
    gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    }).then(() => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.access_token) {
            localStorage.setItem('gapi_token', JSON.stringify({
              access_token: response.access_token,
              expires_at: Date.now() + (response.expires_in * 1000)
            }));
            document.getElementById('backupToDrive').style.display = 'inline-block';
            document.getElementById('restoreFromDrive').style.display = 'inline-block';
            document.getElementById('triggerAutoBackup').style.display = 'inline-block';
            document.getElementById('showTransferDataModal').style.display = 'inline-block';
            showToast('Signed in to Google Drive');
            syncLocalStorageToIndexedDB();
            processOfflineQueue();
          } else {
            console.error('Google sign-in failed:', response);
            showToast('Failed to sign in to Google Drive. Please try again.');
          }
        }
      });
      // Trigger automatic backup every 24 hours
      setInterval(triggerAutoBackup, 24 * 60 * 60 * 1000);
    }).catch((error) => {
      console.error('Google API init error:', error);
      showToast('Failed to initialize Google Drive. Please try again.');
    });
  });
}

function signInWithGoogle() {
  if (!navigator.onLine) {
    showToast('No internet connection. Please try again later.');
    return;
  }
  if (!tokenClient) {
    showToast('Google Drive not initialized. Please try again.');
    initGoogleDrive();
    return;
  }
  tokenClient.requestAccessToken();
}

function isGoogleTokenValid() {
  const token = JSON.parse(localStorage.getItem('gapi_token'));
  return token && token.expires_at > Date.now();
}

function refreshGoogleToken() {
  if (!navigator.onLine || !tokenClient) return;
  const token = JSON.parse(localStorage.getItem('gapi_token'));
  if (token && token.expires_at < Date.now() + 60000) {
    signInWithGoogle();
  }
}

function backupToDrive(isAuto = false) {
  if (!navigator.onLine) {
    offlineQueue.push({ action: 'backupToDrive', data: { isAuto } });
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
    syncLocalStorageToIndexedDB();
    showToast(isAuto ? 'Automatic backup queued for when online' : 'Backup queued for when online');
    return;
  }
  if (!isGoogleTokenValid()) {
    showToast('Please sign in to Google Drive');
    signInWithGoogle();
    return;
  }
  const data = {
    files: files.map(f => ({
      ...f,
      deliveredToName: f.deliveredToName,
      deliveredToType: f.deliveredToType
    })),
    profiles: profiles.map(p => ({
      ...p,
      photo: p.photo || ''
    })),
    userProfile: userProfile ? { ...userProfile, pin: null, cnic: maskCNIC(userProfile.cnic) } : null,
    analytics
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const metadata = {
    name: `cft_backup_${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.json`,
    mimeType: 'application/json',
    parents: ['appDataFolder']
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  gapi.client.request({
    path: '/upload/drive/v3/files',
    method: 'POST',
    params: { uploadType: 'multipart' },
    body: form
  }).then((response) => {
    analytics.backupsCreated++;
    localStorage.setItem('analytics', JSON.stringify(analytics));
    syncLocalStorageToIndexedDB();
    showToast(isAuto ? 'Automatic backup uploaded to Google Drive' : 'Backup uploaded to Google Drive');
  }).catch((error) => {
    console.error('Backup error:', error);
    showToast('Failed to upload backup. Please try again.');
  });
}

function triggerAutoBackup() {
  if (files.length > 0 || profiles.length > 0) {
    backupToDrive(true);
  }
}

function restoreFromDrive() {
  if (!navigator.onLine) {
    showToast('No internet connection. Please try again later.');
    return;
  }
  if (!isGoogleTokenValid()) {
    showToast('Please sign in to Google Drive');
    signInWithGoogle();
    return;
  }
  gapi.client.drive.files.list({
    spaces: 'appDataFolder',
    q: "name contains 'cft_backup_'",
    fields: 'files(id, name)'
  }).then((response) => {
    const backupFiles = response.result.files;
    const select = document.getElementById('backupFiles');
    select.innerHTML = '<option value="">Select a backup</option>';
    backupFiles.forEach(file => {
      const option = document.createElement('option');
      option.value = file.id;
      option.textContent = file.name;
      select.appendChild(option);
    });
    document.getElementById('restoreModal').style.display = 'block';
  }).catch((error) => {
    console.error('List files error:', error);
    showToast('Failed to list backups. Please try again.');
  });

  document.getElementById('backupFiles').addEventListener('change', (e) => {
    const fileId = e.target.value;
    if (fileId) {
      gapi.client.drive.files.get({
        fileId: fileId,
        alt: 'media'
      }).then((response) => {
        const data = JSON.parse(response.body);
        files = data.files || [];
        profiles = data.profiles || [];
        userProfile = data.userProfile ? { ...data.userProfile, pin: userProfile?.pin || '' } : userProfile;
        analytics = data.analytics || analytics;
        localStorage.setItem('files', JSON.stringify(files));
        localStorage.setItem('profiles', JSON.stringify(profiles));
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        localStorage.setItem('analytics', JSON.stringify(analytics));
        syncLocalStorageToIndexedDB();
        showToast('Data restored successfully from Google Drive');
        updateSavedProfile();
        updateDashboardCards();
        hideRestoreModal();
      }).catch((error) => {
        console.error('Restore error:', error);
        showToast('Failed to restore data. Please try again.');
      });
    }
  }, { once: true });
}

function hideRestoreModal() {
  document.getElementById('restoreModal').style.display = 'none';
  document.getElementById('backupFiles').value = '';
}

function showTransferDataModal() {
  if (!navigator.onLine) {
    showToast('No internet connection. Please try again later.');
    return;
  }
  if (!isGoogleTokenValid()) {
    showToast('Please sign in to Google Drive');
    signInWithGoogle();
    return;
  }
  document.getElementById('transferDataModal').style.display = 'block';
  document.getElementById('transferEmail').value = '';
}

function transferData() {
  if (!navigator.onLine) {
    showToast('No internet connection. Please try again later.');
    return;
  }
  if (!isGoogleTokenValid()) {
    showToast('Please sign in to Google Drive');
    signInWithGoogle();
    return;
  }
  const email = document.getElementById('transferEmail').value;
  if (!email) {
    showToast('Please enter an email address');
    return;
  }
  const data = {
    files: files.map(f => ({
      ...f,
      deliveredToName: f.deliveredToName,
      deliveredToType: f.deliveredToType
    })),
    profiles: profiles.map(p => ({
      ...p,
      photo: p.photo || ''
    })),
    userProfile: userProfile ? { ...userProfile, pin: null, cnic: maskCNIC(userProfile.cnic) } : null,
    analytics
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const metadata = {
    name: `cft_transfer_${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.json`,
    mimeType: 'application/json',
    parents: ['appDataFolder']
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  gapi.client.request({
    path: '/upload/drive/v3/files',
    method: 'POST',
    params: { uploadType: 'multipart' },
    body: form
  }).then((response) => {
    const fileId = response.result.id;
    gapi.client.drive.permissions.create({
      fileId: fileId,
      resource: {
        type: 'user',
        role: 'reader',
        emailAddress: email
      }
    }).then(() => {
      gapi.client.drive.files.get({
        fileId: fileId,
        fields: 'webViewLink'
      }).then((response) => {
        showToast(`Data shared with ${email}. Link: ${response.result.webViewLink}`);
        document.getElementById('transferDataModal').style.display = 'none';
      });
    }).catch((error) => {
      console.error('Share error:', error);
      showToast('Failed to share data. Please try again.');
    });
  }).catch((error) => {
    console.error('Transfer error:', error);
    showToast('Failed to upload data for transfer. Please try again.');
  });
}

function maskCNIC(cnic) {
  if (!cnic) return '';
  const parts = cnic.split('-');
  if (parts.length !== 3) return '*****-*******-*';
  return `${parts[0].slice(0, 2)}***-${parts[1].slice(0, 3)}****-${parts[2]}`;
}

function processOfflineQueue() {
  if (!navigator.onLine || !isGoogleTokenValid()) return;
  const queue = [...offlineQueue];
  offlineQueue = [];
  localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
  syncLocalStorageToIndexedDB();
  queue.forEach(({ action, data }) => {
    if (action === 'backupToDrive') {
      backupToDrive(data?.isAuto || false);
    }
  });
}

// PWA Install Prompt
function handleInstallPrompt(event) {
  deferredPrompt = event;
  document.getElementById('installBtn').style.display = 'block';
}

function installApp() {
  if (!deferredPrompt) {
    showToast('Install prompt not available');
    return;
  }
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then((choiceResult) => {
    if (choiceResult.outcome === 'accepted') {
      showToast('App installation started');
      document.getElementById('installBtn').style.display = 'none';
    }
    deferredPrompt = null;
  });
}

window.onload = () => {
  initIndexedDB();
  initGoogleDrive();
  if (userProfile) {
    document.getElementById('setupMessage').style.display = 'none';
    document.getElementById('adminForm').style.display = 'none';
    document.getElementById('savedProfile').style.display = 'block';
    updateSavedProfile();
    if (!isGoogleTokenValid()) {
      showToast('Please sign in to Google Drive to continue');
      signInWithGoogle();
    } else {
      navigate('dashboard');
    }
  } else {
    navigate('admin');
  }
  document.getElementById('agreeTerms').addEventListener('change', toggleSaveButton);
  updateDashboardCards();
  setupPushNotifications();
  setupPhotoAdjust('userPhoto', 'userPhotoPreview', 'userPhotoAdjust');
  setupPhotoAdjust('profilePhoto', 'photoPreview', 'photoAdjust');
  setInterval(refreshGoogleToken, 60000);
  window.addEventListener('beforeinstallprompt', handleInstallPrompt);
  document.querySelector('.sidebar-overlay').addEventListener('click', toggleSidebar);
};

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
  if (userProfile && !isGoogleTokenValid() && screenId !== 'admin') {
    showToast('Please sign in to Google Drive to access this section');
    signInWithGoogle();
    return;
  }
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
        document.getElementById('setupMessage').style.display = 'none';
        document.getElementById('adminForm').style.display = 'none';
        document.getElementById('savedProfile').style.display = 'block';
        updateSavedProfile();
        showToast('Profile saved successfully! Please sign in to Google Drive.');
        signInWithGoogle();
        document.getElementById('loadingIndicator').style.display = 'none';
        navigate('dashboard');
      };

      if (typeof photo === 'string' && photo.startsWith('data:')) {
        processPhoto(photo);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          processPhoto(reader.result);
        };
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

// Photo Adjust Setup
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
    if (!file) {
      showToast('No file selected');
      return;
    }

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
    let imgWidth = img.width;
    let imgHeight = img.height;
    scaleFactor = Math.max(canvas.width / imgWidth, canvas.height / imgHeight);
    imgWidth *= scaleFactor;
    imgHeight *= scaleFactor;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (orientation && orientation !== 1) {
      switch (orientation) {
        case 6:
          ctx.rotate(Math.PI / 2);
          break;
        case 3:
          ctx.rotate(Math.PI);
          break;
        case 8:
          ctx.rotate(-Math.PI / 2);
          break;
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

  document.getElementById('cardDeliveries').innerHTML = `<span class="tooltip">Files delivered today</span><h3>${deliveries}</h3><button>Deliveries Today</button>`;
  document.getElementById('cardReturns').innerHTML = `<span class="tooltip">Files returned today</span><h3>${returns}</h3><button>Returns Today</button>`;
  document.getElementById('cardPending').innerHTML = `<span class="tooltip">Files not yet returned</span><h3>${pending}</h3><button>Pending Files</button>`;
  document.getElementById('cardTomorrow').innerHTML = `<span class="tooltip">Hearings scheduled for tomorrow</span><h3>${tomorrowHearings}</h3><button>Tomorrow Hearings</button>`;
  document.getElementById('cardOverdue').innerHTML = `<span class="tooltip">Files pending over 10 days</span><h3>${overdue}</h3><button>Overdue Files</button>`;
  document.getElementById('cardSearchPrev').innerHTML = `<span class="tooltip">Search all previous records</span><h3>Search</h3><button>Previous Records</button>`;

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

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
    case 'deliveries':
      filteredFiles = files.filter(f => formatDate(f.deliveredAt).startsWith(today));
      title = 'Deliveries Today';
      break;
    case 'returns':
      filteredFiles = files.filter(f => f.returned && formatDate(f.returnedAt).startsWith(today));
      title = 'Returns Today';
      break;
    case 'pending':
      filteredFiles = files.filter(f => !f.returned);
      title = 'Pending Files';
      break;
    case 'tomorrow':
      filteredFiles = files.filter(f => formatDate(f.date).startsWith(tomorrow));
      title = 'Tomorrow Hearings';
      break;
    case 'overdue':
      filteredFiles = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo);
      title = 'Overdue Files';
      break;
    case 'searchPrev':
      filteredFiles = files;
      title = 'Search Previous Records';
      break;
  }

  currentReportData = filteredFiles;
  document.getElementById('reportTitle').textContent = title;
  renderReportTable();

  setTimeout(() => {
    document.getElementById('loadingIndicator').style.display = 'none';
  }, 500);
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
      profile.designation ? `Designation: ${profile.designation}` : '',
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
  if (months >= 1) return `${months}m ${days % 30}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
  if (days >= 1) return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

function updateDynamicTimeSpans() {
  const spans = document.querySelectorAll('.time-span');
  spans.forEach(span => {
    if (span.dataset.returned === 'false') {
      span.textContent = getDynamicTimeSpan(span.dataset.delivered);
    }
  });
}

setInterval(updateDynamicTimeSpans, 1000);

document.getElementById('dashboardReportTable').querySelectorAll('th').forEach((th, index) => {
  th.addEventListener('click', () => {
    const columns = ['cmsNo', 'title', 'caseType', 'nature', 'criminalDetails', 'dateType', 'swalFormNo', 'deliveredToName', 'deliveredAt', 'returnedAt', 'timeSpan', 'courtName', 'clerkName'];
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

function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return '';
  const d = new Date(date);
  d.setHours(d.getHours() + 5);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  if (format === 'YYYY-MM-DD HH:mm:ss') {
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  return `${year}-${month}-${day}`;
}

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
      column

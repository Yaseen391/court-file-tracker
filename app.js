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
let deferredPrompt; // Added for PWA install prompt
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(registration => {
        console.log('ServiceWorker registered: ', registration);
      })
      .catch(error => {
        console.log('ServiceWorker registration failed: ', error);
      });
  });
}

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
const CLIENT_ID = '1022877727253-vlif6k2sstl4gn98e8svsh8mhd3j0gl3.apps.googleusercontent.com';
const API_KEY = 'AIzaSyCmYFpMXEtPdfSg4-K7lgdqNc-njgqONmQ';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';
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
            const tokenData = {
              access_token: response.access_token,
              expires_at: Date.now() + (response.expires_in * 1000)
            };
            localStorage.setItem('gapi_token', JSON.stringify(tokenData));
            updateGoogleDriveButtons(true);
            showToast('Signed in to Google Drive');
            syncLocalStorageToIndexedDB();
            processOfflineQueue();
            createAppDataFolder();
          } else {
            console.error('Google sign-in failed:', response);
            showToast('Failed to sign in to Google Drive. Please try again.');
          }
        }
      });
      if (isGoogleTokenValid()) {
        updateGoogleDriveButtons(true);
        createAppDataFolder();
      }
    }).catch((error) => {
      console.error('Google API init error:', error);
      showToast('Failed to initialize Google Drive. Please try again.');
    });
  });
}

function updateGoogleDriveButtons(show) {
  document.getElementById('backupToDrive').style.display = show ? 'inline-block' : 'none';
  document.getElementById('restoreFromDrive').style.display = show ? 'inline-block' : 'none';
  document.getElementById('shareBackup').style.display = show ? 'inline-block' : 'none';
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
  console.log('Triggering Google Drive sign-in');
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
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

function createAppDataFolder() {
  gapi.client.drive.files.list({
    q: "name='CFT_Data' and mimeType='application/vnd.google-apps.folder' and 'appDataFolder' in parents",
    spaces: 'appDataFolder'
  }).then((response) => {
    if (response.result.files.length === 0) {
      gapi.client.drive.files.create({
        resource: {
          name: 'CFT_Data',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['appDataFolder']
        }
      }).then((folder) => {
        createSubFolders(folder.result.id);
      });
    } else {
      createSubFolders(response.result.files[0].id);
    }
  }).catch((error) => {
    console.error('Folder creation error:', error);
  });
}

function createSubFolders(parentId) {
  const subFolders = ['CaseData', 'Profiles'];
  subFolders.forEach((name) => {
    gapi.client.drive.files.list({
      q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents`,
      spaces: 'appDataFolder'
    }).then((response) => {
      if (response.result.files.length === 0) {
        gapi.client.drive.files.create({
          resource: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
          }
        });
      }
    });
  });
}

function backupToDrive() {
  if (!navigator.onLine) {
    offlineQueue.push({ action: 'backupToDrive', data: null });
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
    syncLocalStorageToIndexedDB();
    showToast('Backup queued for when online');
    return;
  }
  if (!isGoogleTokenValid()) {
    showToast('Please sign in to Google Drive');
    signInWithGoogle();
    return;
  }
  const timestamp = formatDate(new Date(), 'YYYYMMDD_HHMMSS');
  const backups = [
    { name: `CaseData/cft_files_${timestamp}.json`, data: files },
    { name: `Profiles/cft_profiles_${timestamp}.json`, data: profiles }
  ];
  backups.forEach((backup) => {
    const blob = new Blob([JSON.stringify(backup.data, null, 2)], { type: 'application/json' });
    gapi.client.drive.files.list({
      q: `name='${backup.name.split('/')[0]}' and mimeType='application/vnd.google-apps.folder' and 'appDataFolder' in parents`,
      spaces: 'appDataFolder'
    }).then((response) => {
      const parentId = response.result.files[0]?.id || 'appDataFolder';
      const metadata = {
        name: backup.name.split('/')[1],
        mimeType: 'application/json',
        parents: [parentId]
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);
      gapi.client.request({
        path: '/upload/drive/v3/files',
        method: 'POST',
        params: { uploadType: 'multipart' },
        body: form
      }).then(() => {
        analytics.backupsCreated++;
        localStorage.setItem('analytics', JSON.stringify(analytics));
        syncLocalStorageToIndexedDB();
        showToast(`${backup.name.split('/')[0]} backup uploaded`);
      }).catch((error) => {
        console.error('Backup error:', error);
        showToast(`Failed to upload ${backup.name.split('/')[0]} backup. Please try again.`);
      });
    });
  });
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
    q: "name contains 'cft_' and ('CaseData' in parents or 'Profiles' in parents)",
    spaces: 'appDataFolder',
    fields: 'files(id, name, parents)'
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
    document.getElementById('shareBackupModal').style.display = 'block';
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
        if (e.target.selectedOptions[0].textContent.includes('cft_files_')) {
          files = data;
          localStorage.setItem('files', JSON.stringify(files));
        } else if (e.target.selectedOptions[0].textContent.includes('cft_profiles_')) {
          profiles = data;
          localStorage.setItem('profiles', JSON.stringify(profiles));
        }
        syncLocalStorageToIndexedDB();
        showToast('Data restored successfully from Google Drive');
        updateSavedProfile();
        updateDashboardCards();
        hideShareBackup();
      }).catch((error) => {
        console.error('Restore error:', error);
        showToast('Failed to restore data. Please try again.');
      });
    }
  }, { once: true }); // Ensure single listener
}

function showTransferData() {
  document.getElementById('shareBackupModal').style.display = 'block';
  gapi.client.drive.files.list({
    q: "name contains 'cft_' and ('CaseData' in parents or 'Profiles' in parents)",
    spaces: 'appDataFolder',
    fields: 'files(id, name, parents)'
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
  }).catch((error) => {
    console.error('List files error:', error);
    showToast('Failed to list backups. Please try again.');
  });
}

function shareBackup() {
  const fileId = document.getElementById('backupFiles').value;
  const email = document.getElementById('shareEmail').value;
  if (!fileId || !email) {
    showToast('Please select a backup and enter an email');
    return;
  }
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
      showToast(`Backup shared with ${email}. Link: ${response.result.webViewLink}`);
      navigator.serviceWorker.ready.then(registration => {
        registration.showNotification('Backup Shared', {
          body: `Backup shared with ${email}. They can access it via Google Drive.`,
          icon: 'icon-192.png'
        });
      });
      hideShareBackup();
    });
  }).catch((error) => {
    console.error('Share error:', error);
    showToast('Failed to share backup. Please try again.');
  });
}

function hideShareBackup() {
  document.getElementById('shareBackupModal').style.display = 'none';
  document.getElementById('backupFiles').value = '';
  document.getElementById('shareEmail').value = '';
}

function maskCNIC(cnic) {
  if (!cnic) return '';
  const parts = cnic.split('-');
  if (parts.length !== 3) return '*****-*******-*';
  return `${parts[0].slice(0, 2)}***-${parts[1].slice(0, 3)}****-${parts[2]}`;
}

function processOfflineQueue() {
  if (!navigator.onLine || !isGoogleTokenValid()) return;
  offlineQueue.forEach(({ action, data }) => {
    if (action === 'backupToDrive') backupToDrive();
  });
  offlineQueue = [];
  localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
  syncLocalStorageToIndexedDB();
}

function scheduleBackups() {
  setInterval(() => {
    if (navigator.onLine && isGoogleTokenValid()) {
      backupToDrive();
    }
  }, 6 * 60 * 60 * 1000); // Every 6 hours
}

window.onload = () => {
  console.log('app.js loaded successfully');
  initIndexedDB();
  initGoogleDrive();
  if (userProfile) {
    document.getElementById('setupMessage').style.display = 'none';
    document.getElementById('adminForm').style.display = 'none';
    document.getElementById('savedProfile').style.display = 'block';
    updateSavedProfile();
    if (isGoogleTokenValid()) {
      updateGoogleDriveButtons(true);
      navigate('dashboard');
    } else {
      showToast('Please sign in to Google Drive to continue');
      signInWithGoogle();
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
  scheduleBackups();

  // PWA Install Prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installBtn').style.display = 'block';
  });

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
    console.log('Admin form submission started');
    setTimeout(() => {
      const userPhotoInput = document.getElementById('userPhoto');
      let photo = userPhotoInput.adjustedPhoto;
      if (!photo && userPhotoInput.files && userPhotoInput.files[0]) {
        photo = userPhotoInput.files[0];
      }

      if (!photo) {
        console.error('No photo selected');
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
        console.log('Saving userProfile:', userProfile);
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        syncLocalStorageToIndexedDB();
        document.getElementById('setupMessage').style.display = 'none';
        document.getElementById('adminForm').style.display = 'none';
        document.getElementById('savedProfile').style.display = 'block';
        updateSavedProfile();
        showToast('Profile saved successfully! Please sign in to Google Drive.');
        console.log('Triggering Google Drive sign-in');
        signInWithGoogle();
        document.getElementById('loadingIndicator').style.display = 'none';
        navigate('dashboard');
      };

      if (typeof photo === 'string' && photo.startsWith('data:')) {
        console.log('Using adjusted data URL');
        processPhoto(photo);
      } else {
        console.log('Reading raw file');
        const reader = new FileReader();
        reader.onload = () => {
          console.log('Photo read successfully');
          processPhoto(reader.result);
        };
        reader.onerror = (error) => {
          console.error('Error reading photo:', error);
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
    let quality = 0.8;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > 100 * 1024 && quality > 0.1) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    input.adjustedPhoto = dataUrl;
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
    let quality = 0.8;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > 100 * 1024 && quality > 0.1) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    input.adjustedPhoto = dataUrl;
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
  console.log('Updating dashboard cards');
  const today = new Date().toLocaleDateString('en-CA');
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const deliveries = files.filter(f => new Date(f.deliveredAt).toLocaleDateString('en-CA') === today).length;
  console.log('Files for today:', files.filter(f => new Date(f.deliveredAt).toLocaleDateString('en-CA') === today));
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
  document.getElementById('loadingIndicator').style.display = 'block';
  document.getElementById('searchPrevRecords').style.display = type === 'searchPrev' ? 'block' : 'none';
  currentPage = 1;

  const today = new Date().toLocaleDateString('en-CA');
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  let filteredFiles = files;
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
      filteredFiles = files;
      title = 'Search Previous Records';
      break;
    default:
      console.error('Invalid report type:', type);
  }

  console.log('Filtered files:', filteredFiles);
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
      profile.type === 'other' && profile.cnic ? `ID/CNIC: ${maskCNIC(profile.cnic)}` : '',
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
        profile.type === 'other' && profile.cnic ? `ID/CNIC: ${maskCNIC(profile.cnic)}` : '',
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
    const cmsNo = document.getElementById('cmsNo').value;
    const existingDelivered = files.find(f => f.cmsNo === cmsNo && !f.returned);
    if (existingDelivered) {
      const profile = profiles.find(p => p.name === existingDelivered.deliveredToName && p.type === existingDelivered.deliveredToType);
      showToast(`File ${cmsNo} is already delivered to ${existingDelivered.deliveredToName} (${existingDelivered.deliveredToType}) and not yet returned.`);
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
      document.getElementById('fileForm').reset();
      document.getElementById('criminalFields').style.display = 'none';
      document.getElementById('copyAgencyFields').style.display = 'none';
      document.getElementById('copyAgency').checked = false;
      const caseFields = ['petitioner', 'respondent', 'caseType', 'nature', 'firNo', 'firYear', 'firUs', 'policeStation'];
      const editableFields = ['dateType', 'date', 'deliveredTo', 'deliveredType', 'swalFormNo', 'swalDate', 'copyAgency'];
      caseFields.concat(editableFields).forEach(field => {
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
    caseFields.forEach(field => {
      document.getElementById(field).disabled = true;
    });
    editableFields.forEach(field => {
      document.getElementById(field).disabled = false;
    });
    document.getElementById('copyAgency').checked = false;
    document.getElementById('deliveredTo').value = '';
    document.getElementById('deliveredType').value = '';
    document.getElementById('swalFormNo').value = '';
    document.getElementById('swalDate').value = '';
    toggleCopyAgency();
  } else {
    caseFields.concat(editableFields).forEach(field => {
      document.getElementById(field).disabled = false;
    });
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
  promptPin((success) => {
    if (success) {
      const file = files.find(f => f.cmsNo === cmsNo && !f.returned);
      if (file) {
        file.returned = true;
        file.returnedAt = new Date().toISOString();
        localStorage.setItem('files', JSON.stringify(files));
        syncLocalStorageToIndexedDB();
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

// Profile Form Submission
document.getElementById('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  try {
    const profileType = document.getElementById('profileType').value;
    const photoInput = document.getElementById('profilePhoto');
    let photo = photoInput.adjustedPhoto;
    if (!photo && photoInput.files && photoInput.files[0]) {
      photo = photoInput.files[0];
    }

    if (!photo && profileType !== 'advocate') {
      showToast('Please upload a profile photo');
      document.getElementById('loadingIndicator').style.display = 'none';
      return;
    }

    const processPhoto = (photoData) => {
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
      showToast('Profile saved successfully');
      document.getElementById('loadingIndicator').style.display = 'none';
      showProfileSearch();
    };

    if (photo && typeof photo === 'string' && photo.startsWith('data:')) {
      console.log('Using adjusted data URL');
      processPhoto(photo);
    } else if (photo) {
      console.log('Reading raw file');
      const reader = new FileReader();
      reader.onload = () => {
        console.log('Photo read successfully');
        processPhoto(reader.result);
      };
      reader.onerror = () => {
        console.error('Error reading photo');
        showToast('Failed to read photo. Please try again.');
        document.getElementById('loadingIndicator').style.display = 'none';
      };
      reader.readAsDataURL(photo);
    } else {
      console.log('No photo provided (Advocate profile)');
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
  promptPin((success) => {
    if (success) {
      profiles = profiles.filter(p => p.name !== name || p.type !== type);
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
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
      profiles = [...profiles, ...importedProfiles];
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
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
  a.href =url;
  a.download = `backup_${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  analytics.backupsCreated++;
  localStorage.setItem('analytics', JSON.stringify(analytics));
  syncLocalStorageToIndexedDB();
  showToast('Backup created successfully');
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
      if (data.files) files = data.files;
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

function resetApp() {
  promptPin((success) => {
    if (success) {
      files = [];
      profiles = [];
      userProfile = null;
      offlineQueue = [];
      analytics = { filesEntered: 0, searchesPerformed: 0, backupsCreated: 0 };
      localStorage.clear();
      const transaction = db.transaction(['data'], 'readwrite');
      const store = transaction.objectStore('data');
      store.clear();
      showToast('App reset successfully');
      navigate('admin');
      document.getElementById('setupMessage').style.display = 'block';
      document.getElementById('adminForm').style.display = 'block';
      document.getElementById('savedProfile').style.display = 'none';
      updateGoogleDriveButtons(false);
    }
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Analytics Dashboard
function showAnalytics() {
  navigate('analytics');
  const ctx = document.getElementById('analyticsChart').getContext('2d');
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Files Entered', 'Searches Performed', 'Backups Created'],
      datasets: [{
        label: 'Analytics',
        data: [analytics.filesEntered, analytics.searchesPerformed, analytics.backupsCreated],
        backgroundColor: ['#0288d1', '#4caf50', '#d32f2f']
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

  document.getElementById('analyticsFiles').textContent = analytics.filesEntered;
  document.getElementById('analyticsSearches').textContent = analytics.searchesPerformed;
  document.getElementById('analyticsBackups').textContent = analytics.backupsCreated;
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then(registration => {
      console.log('Service Worker registered:', registration);
    }).catch(error => {
      console.error('Service Worker registration failed:', error);
    });
  });
}

// Handle Online/Offline Status
window.addEventListener('online', () => {
  showToast('You are now online');
  if (isGoogleTokenValid()) {
    processOfflineQueue();
  }
});

window.addEventListener('offline', () => {
  showToast('You are now offline. Some features may be limited.');
});

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
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
  } else if (e.ctrlKey && e.key === 'a') {
    e.preventDefault();
    navigate('analytics');
  }
});

// Form Validation
function validateInput(input, type) {
  if (type === 'phone') {
    const phoneRegex = /^\d{10,15}$/;
    if (!phoneRegex.test(input.value)) {
      input.setCustomValidity('Please enter a valid phone number (10-15 digits)');
    } else {
      input.setCustomValidity('');
    }
  } else if (type === 'cnic') {
    const cnicRegex = /^\d{5}-\d{7}-\d{1}$/;
    if (input.value && !cnicRegex.test(input.value)) {
      input.setCustomValidity('Please enter a valid CNIC (e.g., 12345-1234567-1)');
    } else {
      input.setCustomValidity('');
    }
  } else if (type === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (input.value && !emailRegex.test(input.value)) {
      input.setCustomValidity('Please enter a valid email address');
    } else {
      input.setCustomValidity('');
    }
  }
}

// Attach validation to inputs
document.getElementById('mobile').addEventListener('input', () => validateInput(document.getElementById('mobile'), 'phone'));
document.getElementById('cnic').addEventListener('input', () => validateInput(document.getElementById('cnic'), 'cnic'));
document.getElementById('email').addEventListener('input', () => validateInput(document.getElementById('email'), 'email'));
document.getElementById('cellNo').addEventListener('input', () => validateInput(document.getElementById('cellNo'), 'phone'));
if (document.getElementById('advocateCell')) {
  document.getElementById('advocateCell').addEventListener('input', () => validateInput(document.getElementById('advocateCell'), 'phone'));
}

// Periodic Data Sync
setInterval(() => {
  if (navigator.onLine && isGoogleTokenValid()) {
    syncLocalStorageToIndexedDB();
  }
}, 300000); // Every 5 minutes

// Accessibility Enhancements
document.querySelectorAll('input, button, a').forEach(el => {
  el.setAttribute('tabindex', '0');
  el.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && el.tagName !== 'INPUT') {
      el.click();
    }
  });
});

// Prevent accidental navigation
window.addEventListener('beforeunload', (e) => {
  if (files.length > 0 || profiles.length > 0) {
    e.preventDefault();
    e.returnValue = 'You have unsaved data. Are you sure you want to leave?';
  }
});

// Dynamic Theme Support
function applyTheme(theme) {
  document.body.className = theme;
  localStorage.setItem('theme', theme);
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const currentTheme = localStorage.getItem('theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
});

// Apply saved theme on load
const savedTheme = localStorage.getItem('theme') || 'light';
applyTheme(savedTheme);

// Error Boundary
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  showToast('An unexpected error occurred. Please try again.');
});

// Chart.js cleanup on navigation
window.addEventListener('popstate', () => {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
});

// Handle visibility change
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isGoogleTokenValid()) {
    refreshGoogleToken();
    syncLocalStorageToIndexedDB();
  }
});

// Voice Input Support
function enableVoiceInput(inputId) {
  const input = document.getElementById(inputId);
  if ('webkitSpeechRecognition' in window) {
    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      input.value = event.results[0][0].transcript;
      input.dispatchEvent(new Event('input'));
    };
    recognition.onerror = () => showToast('Voice input failed. Please try again.');
    recognition.start();
  } else {
    showToast('Voice input not supported in this browser.');
  }
}

// Add voice input buttons
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

// Lazy load images
document.querySelectorAll('img').forEach(img => {
  img.setAttribute('loading', 'lazy');
});

// Compress localStorage data
function compressData(data) {
  return pako.gzip(JSON.stringify(data), { to: 'string' });
}

function decompressData(compressed) {
  return JSON.parse(pako.ungzip(compressed, { to: 'string' }));
}

// Override localStorage methods to use compression
const originalSetItem = localStorage.setItem;
localStorage.setItem = function(key, value) {
  if (['files', 'profiles', 'analytics'].includes(key)) {
    originalSetItem.call(this, key, compressData(value));
  } else {
    originalSetItem.call(this, key, value);
  }
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

// End of script
console.log('Court File Tracker initialized');

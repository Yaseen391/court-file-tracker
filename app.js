// Global Variables
let files = JSON.parse(localStorage.getItem('files')) || [];
let profiles = JSON.parse(localStorage.getItem('profiles')) || [];
let userProfile = JSON.parse(localStorage.getItem('userProfile')) || null;
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue')) || [];
let currentReportData = [];
let currentPage = 1;
const itemsPerPage = 10;
let cropper = null;
let userCropper = null;
let chartInstance = null; // Store Chart.js instance to fix canvas reuse error
let analytics = JSON.parse(localStorage.getItem('analytics')) || {
  filesEntered: 0,
  searchesPerformed: 0,
  backupsCreated: 0
};

// IndexedDB Setup for offline data persistence
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
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
let tokenClient;

// Initialize Google API Client
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
            document.getElementById('shareBackup').style.display = 'inline-block';
            showToast('Signed in to Google Drive');
            syncLocalStorageToIndexedDB();
            processOfflineQueue(); // Process any queued actions
          }
        }
      });
    }).catch((error) => {
      console.error('Google API init error:', error);
      showToast('Failed to initialize Google Drive. Please try again.');
    });
  });
}

// Sign in with Google
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

// Check if Google token is valid
function isGoogleTokenValid() {
  const token = JSON.parse(localStorage.getItem('gapi_token'));
  return token && token.expires_at > Date.now();
}

// Backup to Google Drive
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
  const data = {
    files: files.map(f => ({
      ...f,
      deliveredToName: f.deliveredToName,
      deliveredToType: f.deliveredToType
    })),
    profiles,
    userProfile: { ...userProfile, pin: null, cnic: maskCNIC(userProfile.cnic) }
  };
  const blob = new Blob([JSON.stringify(data, null, 0)], { type: 'application/json' });
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
  }).then(() => {
    analytics.backupsCreated++;
    localStorage.setItem('analytics', JSON.stringify(analytics));
    syncLocalStorageToIndexedDB();
    showToast('Backup uploaded to Google Drive');
  }).catch((error) => {
    console.error('Backup error:', error);
    showToast('Failed to upload backup. Please try again.');
  });
}

// Restore from Google Drive
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
    document.getElementById('shareBackupModal').style.display = 'block';
  }).catch((error) => {
    console.error('List files error:', error);
    showToast('Failed to list backups. Please try again.');
  });
}

// Share Backup
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

// Mask CNIC for privacy
function maskCNIC(cnic) {
  if (!cnic) return '';
  const parts = cnic.split('-');
  if (parts.length !== 3) return '*****-*******-*';
  return `${parts[0].slice(0, 2)}***-${parts[1].slice(0, 3)}****-${parts[2]}`;
}

// Process Offline Queue
function processOfflineQueue() {
  if (!navigator.onLine || !isGoogleTokenValid()) return;
  offlineQueue.forEach(({ action, data }) => {
    if (action === 'backupToDrive') backupToDrive();
  });
  offlineQueue = [];
  localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
  syncLocalStorageToIndexedDB();
}

// Window Load
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
  updateDashboardCards();
  setupPushNotifications();
};

// Setup Push Notifications
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

// Navigation with Google Drive check
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

// Toggle Sidebar
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  sidebar.classList.toggle('active');
  overlay.classList.toggle('active');
}

// Admin Form Submission
document.getElementById('adminForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  try {
    setTimeout(() => {
      const userPhoto = document.getElementById('userPhoto').cropperResult || (document.getElementById('userPhoto').files[0] ? document.getElementById('userPhoto').files[0] : null);
      const reader = new FileReader();
      reader.onload = () => {
        userProfile = {
          clerkName: document.getElementById('clerkName').value,
          judgeName: document.getElementById('judgeName').value,
          courtName: document.getElementById('courtName').value,
          mobile: document.getElementById('mobile').value,
          cnic: document.getElementById('cnic').value,
          pin: document.getElementById('pin').value,
          email: document.getElementById('email').value,
          photo: reader.result || ''
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
      };
      if (userPhoto) reader.readAsDataURL(userPhoto);
      else {
        userProfile.photo = '';
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        syncLocalStorageToIndexedDB();
        updateSavedProfile();
        document.getElementById('loadingIndicator').style.display = 'none';
      }
    }, 500);
  } catch (error) {
    console.error('Admin form error:', error);
    showToast('Failed to save profile. Please try again.');
    document.getElementById('loadingIndicator').style.display = 'none';
  }
});

// Update Saved Profile
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

// Edit User Profile
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

// Crop User Photo
document.getElementById('userPhoto').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.getElementById('userPhotoPreview');
      img.src = reader.result;
      document.getElementById('userPhotoCropper').style.display = 'block';
      if (userCropper) userCropper.destroy();
      userCropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 0.8,
        responsive: true
      });
    };
    reader.readAsDataURL(file);
  }
});

function cropUserPhoto() {
  if (userCropper) {
    try {
      const canvas = userCropper.getCroppedCanvas({ width: 200, height: 200 });
      const url = canvas.toDataURL('image/jpeg', 0.8);
      document.getElementById('userPhoto').cropperResult = url;
      document.getElementById('userPhotoCropper').style.display = 'none';
      userCropper.destroy();
      userCropper = null;
    } catch (error) {
      console.error('Crop user photo error:', error);
      showToast('Failed to crop photo. Please try again.');
    }
  }
}

// Toggle Save Button
function toggleSaveButton() {
  document.getElementById('saveProfileBtn').disabled = !document.getElementById('agreeTerms').checked;
}

// Show Disclaimer Modal
function showDisclaimerModal() {
  document.getElementById('disclaimerModal').style.display = 'block';
}

// PIN Prompt
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

// Show Change PIN
function showChangePin() {
  document.getElementById('changePinModal').style.display = 'block';
  document.getElementById('resetCnic').value = '';
  document.getElementById('resetPin').value = '';
}

// Change PIN
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

// Dashboard Cards
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

  // Destroy previous chart instance to fix canvas reuse error
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  // Chart.js Stats
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
          stepSize: 1, // Integer ticks
          ticks: { precision: 0 } // No decimals
        }
      },
      plugins: { legend: { display: false } }
    }
  });

  // Event Listeners
  document.getElementById('cardDeliveries').onclick = () => showDashboardReport('deliveries');
  document.getElementById('cardReturns').onclick = () => showDashboardReport('returns');
  document.getElementById('cardPending').onclick = () => showDashboardReport('pending');
  document.getElementById('cardTomorrow').onclick = () => showDashboardReport('tomorrow');
  document.getElementById('cardOverdue').onclick = () => showDashboardReport('overdue');
  document.getElementById('cardSearchPrev').onclick = () => showDashboardReport('searchPrev');
}

// Show Dashboard Report
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

// Render Report Table
let sortColumn = null;
let sortDirection = 1;

function renderReportTable() {
  const tbody = document.getElementById('dashboardReportTable').querySelector('tbody');
  tbody.innerHTML = '';

  // Sort data
  let sortedData = [...currentReportData];
  if (sortColumn) {
    sortedData.sort((a, b) => {
      let valA = a[sortColumn] || '';
      let valB = b[sortColumn] || '';
      if (sortColumn === 'deliveredAt' || sortColumn === 'returnedAt' || sortColumn === 'date') {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
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

// Dynamic Time Span
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

// Table Sorting
document.getElementById('dashboardReportTable').querySelectorAll('th').forEach((th, index) => {
  th.addEventListener('click', () => {
    const columns = ['cmsNo', 'title', 'caseType', 'nature', 'dateType', 'swalFormNo', 'deliveredToName', 'deliveredAt', 'returnedAt', 'timeSpan', 'courtName', 'clerkName'];
    if (index >= 1 && index <= 12) {
      const newColumn = columns[index - 1];
      sortDirection = sortColumn === newColumn ? -sortDirection : 1;
      sortColumn = newColumn;
      renderReportTable();
    }
  });
});

// Pagination
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

// Format Date with PKT
function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return '';
  const d = new Date(date);
  // Adjust to PKT (UTC+5)
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

// Show Profile Details
function showProfileDetails(name, type) {
  const profile = profiles.find(p => p.name === name && p.type === type) || {};
  document.getElementById('profileModalTitle').textContent = `${name} (${type})`;
  const table = document.getElementById('profileModalTable');
  table.innerHTML = `
    <tr><th>Name</th><td>${profile.name || ''}</td></tr>
    <tr><th>Type</th><td>${profile.type || ''}</td></tr>
    ${profile.cellNo ? `<tr><th>Cell No</th><td>${profile.cellNo}</td></tr>` : ''}
    ${profile.chamberNo ? `<tr><th>Chamber No</th><td>${profile.chamberNo}</td></tr>` : ''}
    ${profile.advocateName ? `<tr><th>Advocate Name</th><td>${profile.advocateName}</td></tr>` : ''}
    ${profile.advocateCell ? `<tr><th>Advocate Cell</th><td>${profile.advocateCell}</td></tr>` : ''}
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

// Dashboard Search
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

// Print Dashboard Report
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

// Export Dashboard Report
function exportDashboardReport(format) {
  if (format === 'csv') {
    let csv = 'Sr#,CMS No,Title,Case Type,Nature,Date Type,Swal Form Details,Delivered To,Delivery Date,Return Date,Time Span,Court,Clerk Name,Profile Details\n';
    currentReportData.forEach((f, index) => {
      const profile = profiles.find(p => p.name === f.deliveredToName && p.type === f.deliveredToType) || {};
      const timeSpan = f.returned ? getDynamicTimeSpan(f.deliveredAt, f.returnedAt) : getDynamicTimeSpan(f.deliveredAt);
      const swalDetails = f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${formatDate(f.swalDate)}` : '';
      const profileDetails = [
        profile.chamberNo ? `Chamber No: ${profile.chamberNo}` : '',
        profile.advocateName ? `Advocate Name: ${profile.advocateName}` : '',
        profile.advocateCell ? `Advocate Cell: ${profile.advocateCell}` : '',
        profile.designation ? `Designation: ${profile.designation}` : '',
        profile.postedAt ? `Posted At: ${profile.postedAt}` : '',
        profile.cnic ? `ID/CNIC: ${maskCNIC(profile.cnic)}` : '',
        profile.relation ? `Relation: ${profile.relation}` : ''
      ].filter(Boolean).join(', ');
      csv += `${index + 1},${f.cmsNo},"${f.title.replace('vs', 'Vs.')}",${f.caseType},${f.nature},"${f.dateType}: ${formatDate(f.date)}","${swalDetails}","${f.deliveredToName} (${f.deliveredToType})","${formatDate(f.deliveredAt, 'YYYY-MM-DD HH:mm:ss')}","${f.returned ? formatDate(f.returnedAt, 'YYYY-MM-DD HH:mm:ss') : ''}",${timeSpan},${f.courtName},${f.clerkName},"${profileDetails}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } else if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.text(document.getElementById('reportTitle').textContent, 10, 10);
    doc.autoTable({ html: '#dashboardReportTable', startY: 20 });
    doc.save(`report_${new Date().toISOString()}.pdf`);
  }
}

// New File Form
function toggleCriminalFields() {
  const caseType = document.getElementById('caseType').value;
  document.getElementById('criminalFields').style.display = caseType === 'criminal' ? 'block' : 'none';
}

function toggleCopyAgency() {
  const copyAgency = document.getElementById('copyAgency').checked;
  document.getElementById('copyAgencyFields').style.display = copyAgency ? 'block' : 'none';
  document.getElementById('swalFormNo').required = copyAgency;
  document.getElementById('swalDate').required = copyAgency;
}

function suggestProfiles(input, inputId) {
  const suggestions = document.getElementById(inputId === 'deliveredTo' ? 'suggestions' : 'searchSuggestions');
  suggestions.innerHTML = '';
  if (!input) return;
  const fuse = new Fuse(profiles, { keys: ['name', 'type', 'cellNo'], threshold: 0.3 });
  const results = fuse.search(input).slice(0, 5);
  results.forEach(result => {
    const li = document.createElement('li');
    li.innerHTML = `
      <img src="${result.item.photo || 'icon-192.png'}" alt="Profile" />
      <span>${result.item.name} (${result.item.type})</span>
    `;
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

function autoFillCMS() {
  const cmsNo = document.getElementById('cmsNo').value;
  const existingFile = files.find(f => f.cmsNo === parseInt(cmsNo));
  if (existingFile) {
    const [petitioner, respondent] = existingFile.title.split('vs').map(s => s.trim());
    document.getElementById('caseType').value = existingFile.caseType;
    document.getElementById('petitioner').value = petitioner || '';
    document.getElementById('respondent').value = respondent || '';
    document.getElementById('nature').value = existingFile.nature;
    document.getElementById('dateType').value = existingFile.dateType;
    document.getElementById('date').value = existingFile.date;
    if (existingFile.caseType === 'criminal') {
      document.getElementById('firNo').value = existingFile.firNo || '';
      document.getElementById('firYear').value = existingFile.firYear || '';
      document.getElementById('firUs').value = existingFile.firUs || '';
      document.getElementById('policeStation').value = existingFile.policeStation || '';
      document.getElementById('criminalFields').style.display = 'block';
    } else {
      document.getElementById('criminalFields').style.display = 'none';
    }
  }
}

document.getElementById('fileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  setTimeout(() => {
    const fileData = {
      cmsNo: parseInt(document.getElementById('cmsNo').value),
      title: `${document.getElementById('petitioner').value} vs ${document.getElementById('respondent').value}`,
      caseType: document.getElementById('caseType').value,
      nature: document.getElementById('nature').value,
      dateType: document.getElementById('dateType').value,
      date: document.getElementById('date').value,
      deliveredToName: document.getElementById('deliveredTo').value,
      deliveredToType: document.getElementById('deliveredType').value,
      deliveredAt: new Date().toISOString(),
      courtName: userProfile.courtName,
      clerkName: userProfile.clerkName,
      returned: false
    };
    if (fileData.caseType === 'criminal') {
      fileData.firNo = document.getElementById('firNo').value;
      fileData.firYear = document.getElementById('firYear').value;
      fileData.firUs = document.getElementById('firUs').value;
      fileData.policeStation = document.getElementById('policeStation').value;
    }
    if (document.getElementById('copyAgency').checked) {
      fileData.swalFormNo = document.getElementById('swalFormNo').value;
      fileData.swalDate = document.getElementById('swalDate').value;
    }
    files.push(fileData);
    analytics.filesEntered++;
    localStorage.setItem('files', JSON.stringify(files));
    localStorage.setItem('analytics', JSON.stringify(analytics));
    syncLocalStorageToIndexedDB();
    document.getElementById('fileForm').reset();
    document.getElementById('criminalFields').style.display = 'none';
    document.getElementById('copyAgencyFields').style.display = 'none';
    document.getElementById('copyAgency').checked = false;
    showToast('File saved and delivered successfully');
    document.getElementById('loadingIndicator').style.display = 'none';
    updateDashboardCards();
  }, 500);
});

// Return File
function filterPendingFiles() {
  const cmsNo = document.getElementById('returnCms').value;
  const title = document.getElementById('returnTitle').value.toLowerCase();
  const tbody = document.getElementById('pendingFilesTable').querySelector('tbody');
  tbody.innerHTML = '';
  const filteredFiles = files.filter(f => !f.returned &&
    (!cmsNo || f.cmsNo.toString().includes(cmsNo)) &&
    (!title || f.title.toLowerCase().includes(title)));
  filteredFiles.forEach(f => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="return-checkbox" data-cms="${f.cmsNo}"></td>
      <td>${f.cmsNo}</td>
      <td>${f.title.replace('vs', 'Vs.')}</td>
      <td>${f.caseType}</td>
      <td>${f.deliveredToName} (${f.deliveredToType})</td>
      <td><button onclick="returnFile(${f.cmsNo})">Return</button></td>
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
        showToast(`File ${cmsNo} marked as returned`);
        filterPendingFiles();
        updateDashboardCards();
      }
    }
  });
}

function bulkReturnFiles() {
  promptPin((success) => {
    if (success) {
      const checkboxes = document.querySelectorAll('.return-checkbox:checked');
      checkboxes.forEach(cb => {
        const cmsNo = parseInt(cb.dataset.cms);
        const file = files.find(f => f.cmsNo === cmsNo && !f.returned);
        if (file) {
          file.returned = true;
          file.returnedAt = new Date().toISOString();
        }
      });
      localStorage.setItem('files', JSON.stringify(files));
      syncLocalStorageToIndexedDB();
      showToast(`${checkboxes.length} file(s) marked as returned`);
      filterPendingFiles();
      updateDashboardCards();
    }
  });
}

// File Fetcher
function showProfileForm(profile = null) {
  document.getElementById('profileForm').style.display = 'block';
  document.getElementById('profileList').style.display = 'none';
  document.getElementById('profileSearchSection').style.display = 'none';
  document.getElementById('profileType').value = profile ? profile.type : '';
  toggleProfileFields();
  if (profile) {
    document.getElementById('profileName').value = profile.name;
    document.getElementById('cellNo').value = profile.cellNo || '';
    document.getElementById('chamberNo').value = profile.chamberNo || '';
    document.getElementById('advocateName').value = profile.advocateName || '';
    document.getElementById('advocateCell').value = profile.advocateCell || '';
    document.getElementById('designation').value = profile.designation || '';
    document.getElementById('postedAt').value = profile.postedAt || '';
    document.getElementById('cnic').value = profile.cnic || '';
    document.getElementById('relation').value = profile.relation || '';
    if (profile.photo) {
      document.getElementById('photoPreview').src = profile.photo;
      document.getElementById('photoCropper').style.display = 'block';
    }
  }
}

function toggleProfileFields() {
  const type = document.getElementById('profileType').value;
  const fields = document.getElementById('profileFields');
  fields.innerHTML = `
    <label>Name: <span class="required">*</span><input type="text" id="profileName" required /></label>
    <label>Cell No: <input type="text" id="cellNo" placeholder="0300-1234567" /></label>
  `;
  if (type === 'advocate') {
    fields.innerHTML += `
      <label>Chamber No: <input type="text" id="chamberNo" /></label>
      <label>Advocate Name: <input type="text" id="advocateName" /></label>
      <label>Advocate Cell: <input type="text" id="advocateCell" placeholder="0300-1234567" /></label>
    `;
  } else if (type === 'munshi') {
    fields.innerHTML += `
      <label>Designation: <input type="text" id="designation" /></label>
      <label>Posted At: <input type="text" id="postedAt" /></label>
    `;
  } else if (type === 'colleague' || type === 'other') {
    fields.innerHTML += `
      <label>ID/CNIC: <input type="text" id="cnic" placeholder="XXXXX-XXXXXXX-X" /></label>
      <label>Relation: <input type="text" id="relation" /></label>
    `;
  }
}

document.getElementById('profilePhoto').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.getElementById('photoPreview');
      img.src = reader.result;
      document.getElementById('photoCropper').style.display = 'block';
      if (cropper) cropper.destroy();
      cropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 0.8,
        responsive: true
      });
    };
    reader.readAsDataURL(file);
  }
});

function cropPhoto() {
  if (cropper) {
    try {
      const canvas = cropper.getCroppedCanvas({ width: 200, height: 200 });
      const url = canvas.toDataURL('image/jpeg', 0.8);
      document.getElementById('profilePhoto').cropperResult = url;
      document.getElementById('photoCropper').style.display = 'none';
      cropper.destroy();
      cropper = null;
    } catch (error) {
      console.error('Crop photo error:', error);
      showToast('Failed to crop photo. Please try again.');
    }
  }
}

document.getElementById('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  try {
    setTimeout(() => {
      const profilePhoto = document.getElementById('profilePhoto').cropperResult || (document.getElementById('profilePhoto').files[0] ? document.getElementById('profilePhoto').files[0] : null);
      const reader = new FileReader();
      reader.onload = () => {
        const profile = {
          type: document.getElementById('profileType').value,
          name: document.getElementById('profileName').value,
          cellNo: document.getElementById('cellNo').value,
          photo: reader.result || ''
        };
        if (profile.type === 'advocate') {
          profile.chamberNo = document.getElementById('chamberNo').value;
          profile.advocateName = document.getElementById('advocateName').value;
          profile.advocateCell = document.getElementById('advocateCell').value;
        } else if (profile.type === 'munshi') {
          profile.designation = document.getElementById('designation').value;
          profile.postedAt = document.getElementById('postedAt').value;
        } else if (profile.type === 'colleague' || profile.type === 'other') {
          profile.cnic = document.getElementById('cnic').value;
          profile.relation = document.getElementById('relation').value;
        }
        const existingIndex = profiles.findIndex(p => p.name === profile.name && p.type === profile.type);
        if (existingIndex >= 0) {
          profiles[existingIndex] = profile;
        } else {
          profiles.push(profile);
        }
        localStorage.setItem('profiles', JSON.stringify(profiles));
        syncLocalStorageToIndexedDB();
        document.getElementById('profileForm').reset();
        document.getElementById('profileForm').style.display = 'none';
        document.getElementById('photoCropper').style.display = 'none';
        showToast('Profile saved successfully');
        document.getElementById('loadingIndicator').style.display = 'none';
        renderProfiles();
      };
      if (profilePhoto) reader.readAsDataURL(profilePhoto);
      else {
        profile.photo = '';
        localStorage.setItem('profiles', JSON.stringify(profiles));
        syncLocalStorageToIndexedDB();
        document.getElementById('loadingIndicator').style.display = 'none';
      }
    }, 500);
  } catch (error) {
    console.error('Profile form error:', error);
    showToast('Failed to save profile. Please try again.');
    document.getElementById('loadingIndicator').style.display = 'none';
  }
});

function showProfileSearch() {
  document.getElementById('profileSearchSection').style.display = 'block';
  document.getElementById('profileList').style.display = 'block';
  document.getElementById('profileForm').style.display = 'none';
  renderProfiles();
}

function renderProfiles() {
  const filterType = document.getElementById('profileFilterType').value;
  const search = document.getElementById('profileSearch').value.toLowerCase();
  const tbody = document.getElementById('profileTable').querySelector('tbody');
  tbody.innerHTML = '';
  let filteredProfiles = profiles;
  if (filterType) {
    filteredProfiles = profiles.filter(p => p.type === filterType);
  }
  if (search) {
    const fuse = new Fuse(filteredProfiles, { keys: ['name', 'type', 'cellNo', 'chamberNo'], threshold: 0.3 });
    filteredProfiles = fuse.search(search).map(result => result.item);
  }
  filteredProfiles.forEach(p => {
    const deliveredCount = files.filter(f => f.deliveredToName === p.name && f.deliveredToType === p.type).length;
    const pendingCount = files.filter(f => f.deliveredToName === p.name && f.deliveredToType === p.type && !f.returned).length;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${p.photo || 'icon-192.png'}" style="width:50px;height:50px;border-radius:50%;border:1px solid #ccc;" /></td>
      <td>${p.name}</td>
      <td>${p.type}</td>
      <td>${p.cellNo || ''}</td>
      <td>${p.chamberNo || ''}</td>
      <td>${deliveredCount}</td>
      <td>${pendingCount}</td>
      <td>
        <button onclick="showProfileForm(profiles[${profiles.indexOf(p)}])">Edit</button>
        <button onclick="deleteProfile('${p.name}', '${p.type}')">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
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
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      const data = JSON.parse(reader.result);
      profiles = data.profiles || [];
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
      showToast('Profiles imported successfully');
      renderProfiles();
    };
    reader.readAsText(file);
  }
}

function exportProfiles() {
  const data = { profiles };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `profiles_${new Date().toISOString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Data Management
function backupData() {
  const data = {
    files: files.map(f => ({
      ...f,
      deliveredToName: f.deliveredToName,
      deliveredToType: f.deliveredToType
    })),
    profiles,
    userProfile: { ...userProfile, pin: null, cnic: maskCNIC(userProfile.cnic) }
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_${new Date().toISOString()}.json`;
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
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      const data = JSON.parse(reader.result);
      files = data.files || [];
      profiles = data.profiles || [];
      if (data.userProfile && !userProfile) {
        userProfile = { ...data.userProfile, pin: userProfile ? userProfile.pin : null };
      }
      localStorage.setItem('files', JSON.stringify(files));
      localStorage.setItem('profiles', JSON.stringify(profiles));
      localStorage.setItem('userProfile', JSON.stringify(userProfile));
      syncLocalStorageToIndexedDB();
      showToast('Data restored successfully');
      updateSavedProfile();
      updateDashboardCards();
      navigate('dashboard');
    };
    reader.readAsText(file);
  }
}

// Toast Notification
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

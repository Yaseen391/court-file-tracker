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
let analytics = JSON.parse(localStorage.getItem('analytics')) || {
  filesEntered: 0,
  searchesPerformed: 0,
  backupsCreated: 0
};

// Google Drive API Configuration
const CLIENT_ID = '1022877727253-vlif6k2sstl4gn98e8svsh8mhd3j0gl3.apps.googleusercontent.com';
const API_KEY = 'YOUR_ACTUAL_API_KEY_HERE'; // Replace with your Google API key
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
let tokenClient;

// Initialize Google API Client
function initGoogleDrive() {
  try {
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
            }
          }
        });
      }).catch((error) => {
        console.error('Google API initialization error:', error);
        showToast('Failed to initialize Google Drive. Using local backup.');
      });
    });
  } catch (error) {
    console.error('Google API load error:', error);
    showToast('Google Drive unavailable. Using local backup.');
  }
}

// Sign in with Google
function signInWithGoogle() {
  if (!navigator.onLine) {
    showToast('No internet connection. Please try again later.');
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
    showToast('Backup queued for when online');
    return;
  }
  if (!isGoogleTokenValid()) {
    showToast('Please sign in to Google Drive');
    signInWithGoogle();
    return;
  }
  const data = {
    files,
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

// Window Load
window.onload = () => {
  initGoogleDrive();
  if (userProfile) {
    document.getElementById('setupMessage').style.display = 'none';
    document.getElementById('adminForm').style.display = 'none';
    document.getElementById('savedProfile').style.display = 'block';
    updateSavedProfile();
    document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('hidden'));
    navigate('dashboard');
  } else {
    navigate('admin');
    document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.add('hidden'));
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

// Navigation
function navigate(screenId) {
  if (!userProfile && screenId !== 'admin' && screenId !== 'developersDisclaimer') {
    showToast('Please complete Admin profile setup first');
    return;
  }
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.sidebar button[onclick="navigate('${screenId}')"]`).classList.add('active');
  if (screenId === 'dashboard') updateDashboardCards();
  if (screenId === 'return') filterPendingFiles();
  if (screenId === 'fileFetcher') renderProfiles();
  if (screenId === 'developersDisclaimer') {
    // Instructions for Developers Disclaimer:
    // 1. Design your content as HTML (e.g., <div><h3>About Me</h3><img src="your-image.jpg"><p>Your bio...</p></div>).
    // 2. Replace the contents of <div id="disclaimerContent"> in index.html with your HTML.
    // 3. Host images locally in the project folder or use base64 encoding.
    // 4. Ensure styles match existing CSS (e.g., .screen, h2, p).
    // 5. Test on mobile and desktop for responsiveness.
  }
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
      const userPhotoInput = document.getElementById('userPhoto');
      const userPhoto = userPhotoInput.cropperResult || (userPhotoInput.files.length > 0 ? userPhotoInput.files[0] : null);
      const saveProfile = (photoData) => {
        userProfile = {
          clerkName: document.getElementById('clerkName').value,
          judgeName: document.getElementById('judgeName').value,
          courtName: document.getElementById('courtName').value,
          mobile: document.getElementById('mobile').value,
          cnic: document.getElementById('cnic').value,
          pin: document.getElementById('pin').value,
          email: document.getElementById('email').value,
          photo: photoData || ''
        };
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        document.getElementById('setupMessage').style.display = 'none';
        document.getElementById('adminForm').style.display = 'none';
        document.getElementById('savedProfile').style.display = 'block';
        updateSavedProfile();
        document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('hidden'));
        navigate('dashboard');
        showToast('Profile saved successfully!');
        document.getElementById('loadingIndicator').style.display = 'none';
      };
      if (userPhoto) {
        if (typeof userPhoto === 'string') {
          saveProfile(userPhoto);
        } else {
          const reader = new FileReader();
          reader.onload = () => saveProfile(reader.result);
          reader.onerror = () => {
            showToast('Failed to read photo. Please try again.');
            document.getElementById('loadingIndicator').style.display = 'none';
          };
          reader.readAsDataURL(userPhoto);
        }
      } else {
        saveProfile(null);
      }
    }, 500);
  } catch (error) {
    console.error('Profile save error:', error);
    showToast('Error saving profile. Please try again.');
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
    const canvas = userCropper.getCroppedCanvas({ width: 200, height: 200 });
    const url = canvas.toDataURL('image/jpeg', 0.8);
    document.getElementById('userPhoto').cropperResult = url;
    document.getElementById('userPhotoCropper').style.display = 'none';
    userCropper.destroy();
    userCropper = null;
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

  const ctx = document.getElementById('statsChart').getContext('2d');
  new Chart(ctx, {
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
      scales: { y: { beginAtZero: true } },
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
    const timeSpan = f.returned ? `${Math.ceil((new Date(f.returnedAt) - new Date(f.deliveredAt)) / (1000 * 60 * 60 * 24))} days` : getDynamicTimeSpan(f.deliveredAt);
    const profile = profiles.find(p => p.name === f.deliveredTo && p.type === f.deliveredType) || {};
    const swalDetails = f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${formatDate(f.swalDate)}` : '';
    row.innerHTML = `
      <td>${start + index + 1}</td>
      <td>${f.cmsNo}</td>
      <td>${f.title.replace('vs', 'Vs.')}</td>
      <td>${f.caseType}</td>
      <td>${f.nature}</td>
      <td>${f.dateType === 'decision' ? 'Decision Date' : 'Next Hearing Date'}: ${formatDate(f.date)}</td>
      <td>${swalDetails}</td>
      <td>${f.deliveredTo} (${f.deliveredType})</td>
      <td>${formatDate(f.deliveredAt)}</td>
      <td>${f.returned ? formatDate(f.returnedAt) : ''}</td>
      <td class="time-span" data-delivered="${f.deliveredAt}" data-returned="${f.returned ? 'true' : 'false'}">${timeSpan}</td>
      <td>${f.courtName}</td>
      <td>${f.clerkName}</td>
      <td><a href="#" onclick="showProfileDetails('${f.deliveredTo}', '${f.deliveredType}')">View Profile</a></td>
    `;
    tbody.appendChild(row);
  });

  updatePagination(sortedData.length);
  updateDynamicTimeSpans();
}

// Dynamic Time Span
function getDynamicTimeSpan(deliveredAt) {
  const diff = Date.now() - new Date(deliveredAt).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  if (months >= 12) return `${Math.floor(months / 12)}y ${months % 12}m`;
  if (months >= 1) return `${months}m ${days % 30}d`;
  if (weeks >= 1) return `${weeks}w ${days % 7}d`;
  if (days >= 1) return `${days}d ${hours % 24}h`;
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
    const columns = ['cmsNo', 'title', 'caseType', 'nature', 'dateType', 'swalFormNo', 'deliveredTo', 'deliveredAt', 'returnedAt', 'timeSpan', 'courtName', 'clerkName'];
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

// Dashboard Search
function performDashboardSearch() {
  analytics.searchesPerformed++;
  localStorage.setItem('analytics', JSON.stringify(analytics));
  const title = document.getElementById('searchTitle').value.toLowerCase();
  const cms = document.getElementById('searchCms').value;
  const fileTaker = document.getElementById('searchFileTaker').value.toLowerCase();
  const firNo = document.getElementById('searchFirNo').value.toLowerCase();
  const firYear = document.getElementById('searchFirYear').value;
  const policeStation = document.getElementById('searchPoliceStation').value.toLowerCase();

  const fuse = new Fuse(files, {
    keys: ['title', 'cmsNo', 'deliveredTo', 'firNo', 'firYear', 'policeStation'],
    threshold: 0.3
  });

  let results = files;
  if (title || cms || fileTaker || firNo || firYear || policeStation) {
    results = fuse.search({
      $or: [
        title ? { title } : null,
        cms ? { cmsNo: cms } : null,
        fileTaker ? { deliveredTo: fileTaker } : null,
        firNo ? { firNo } : null,
        firYear ? { firYear } : null,
        policeStation ? { policeStation } : null
      ].filter(Boolean)
    }).map(result => result.item);
  }

  currentReportData = results;
  currentPage = 1;
  renderReportTable();
}

// Profile Suggestions
function suggestProfiles(input, inputId) {
  const suggestions = document.getElementById(inputId === 'deliveredTo' ? 'suggestions' : 'searchSuggestions');
  suggestions.innerHTML = '';
  if (!input) return;

  const fuse = new Fuse(profiles, { keys: ['name', 'cellNo', 'chamberNo'], threshold: 0.3 });
  const results = fuse.search(input).slice(0, 5);

  results.forEach(result => {
    const li = document.createElement('li');
    li.innerHTML = `
      <img src="${result.item.photo || 'icon-192.png'}" alt="Profile" />
      <span>${result.item.name} (${result.item.type}) - ${result.item.cellNo}</span>
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

// Auto-Fill CMS
function autoFillCMS() {
  const cmsNo = document.getElementById('cmsNo').value;
  const existing = files.find(f => f.cmsNo === cmsNo);
  if (existing) {
    document.getElementById('caseType').value = existing.caseType;
    document.getElementById('petitioner').value = existing.petitioner;
    document.getElementById('respondent').value = existing.respondent;
    document.getElementById('nature').value = existing.nature;
    if (existing.caseType === 'criminal') {
      document.getElementById('firNo').value = existing.firNo || '';
      document.getElementById('firYear').value = existing.firYear || '';
      document.getElementById('firUs').value = existing.firUs || '';
      document.getElementById('policeStation').value = existing.policeStation || '';
      toggleCriminalFields();
    }
    document.getElementById('dateType').value = existing.dateType;
    document.getElementById('date').value = existing.date.split('T')[0];
    document.getElementById('deliveredTo').value = existing.deliveredTo;
    document.getElementById('deliveredType').value = existing.deliveredType;
    if (existing.swalFormNo) {
      document.getElementById('copyAgency').checked = true;
      toggleCopyAgency();
      document.getElementById('swalFormNo').value = existing.swalFormNo;
      document.getElementById('swalDate').value = existing.swalDate.split('T')[0];
    }
    ['caseType', 'petitioner', 'respondent', 'nature', 'firNo', 'firYear', 'firUs', 'policeStation', 'deliveredTo', 'deliveredType', 'swalFormNo', 'swalDate'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
  } else {
    ['caseType', 'petitioner', 'respondent', 'nature', 'firNo', 'firYear', 'firUs', 'policeStation', 'deliveredTo', 'deliveredType', 'swalFormNo', 'swalDate', 'dateType', 'date'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
  }
}

// Toggle Criminal Fields
function toggleCriminalFields() {
  document.getElementById('criminalFields').style.display = document.getElementById('caseType').value === 'criminal' ? 'block' : 'none';
}

// Toggle Copy Agency
function toggleCopyAgency() {
  const isChecked = document.getElementById('copyAgency').checked;
  document.getElementById('copyAgencyFields').style.display = isChecked ? 'block' : 'none';
  document.getElementById('swalFormNo').required = isChecked;
  document.getElementById('swalDate').required = isChecked;
}

// File Form Submission
document.getElementById('fileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  setTimeout(() => {
    const file = {
      cmsNo: document.getElementById('cmsNo').value,
      title: `${document.getElementById('petitioner').value} Vs. ${document.getElementById('respondent').value}`,
      caseType: document.getElementById('caseType').value,
      nature: document.getElementById('nature').value,
      firNo: document.getElementById('firNo').value,
      firYear: document.getElementById('firYear').value,
      firUs: document.getElementById('firUs').value,
      policeStation: document.getElementById('policeStation').value,
      dateType: document.getElementById('dateType').value,
      date: document.getElementById('date').value,
      deliveredTo: document.getElementById('deliveredTo').value,
      deliveredType: document.getElementById('deliveredType').value,
      deliveredAt: new Date().toISOString(),
      returned: false,
      courtName: userProfile.courtName,
      clerkName: userProfile.clerkName,
      swalFormNo: document.getElementById('copyAgency').checked ? document.getElementById('swalFormNo').value : '',
      swalDate: document.getElementById('copyAgency').checked ? document.getElementById('swalDate').value : ''
    };
    files.push(file);
    localStorage.setItem('files', JSON.stringify(files));
    analytics.filesEntered++;
    localStorage.setItem('analytics', JSON.stringify(analytics));
    document.getElementById('fileForm').reset();
    toggleCriminalFields();
    toggleCopyAgency();
    updateDashboardCards();
    showToast('File saved and delivered!');
    document.getElementById('loadingIndicator').style.display = 'none';
  }, 500);
});

// Filter Pending Files
function filterPendingFiles() {
  const cms = document.getElementById('returnCms').value;
  const title = document.getElementById('returnTitle').value.toLowerCase();
  const tbody = document.getElementById('pendingFilesTable').querySelector('tbody');
  tbody.innerHTML = '';

  const filteredFiles = files.filter(f => !f.returned && (!cms || f.cmsNo.includes(cms)) && (!title || f.title.toLowerCase().includes(title)));

  filteredFiles.forEach(f => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="select-file" data-cms="${f.cmsNo}"></td>
      <td>${f.cmsNo}</td>
      <td>${f.title.replace('vs', 'Vs.')}</td>
      <td>${f.caseType}</td>
      <td><a href="#" onclick="showProfileDetails('${f.deliveredTo}', '${f.deliveredType}')">${f.deliveredTo} (${f.deliveredType})</a></td>
      <td><button onclick="returnFile('${f.cmsNo}')">Return</button></td>
    `;
    tbody.appendChild(row);
  });
}

// Bulk Return Files
function bulkReturnFiles() {
  const selected = Array.from(document.querySelectorAll('.select-file:checked')).map(cb => cb.dataset.cms);
  if (selected.length === 0) {
    showToast('Please select at least one file');
    return;
  }
  if (confirm(`Return ${selected.length} file(s)?`)) {
    selected.forEach(cms => returnFile(cms));
    showToast(`${selected.length} file(s) returned`);
  }
}

// Return File
function returnFile(cmsNo) {
  const file = files.find(f => f.cmsNo === cmsNo && !f.returned);
  if (file) {
    file.returned = true;
    file.returnedAt = new Date().toISOString();
    localStorage.setItem('files', JSON.stringify(files));
    filterPendingFiles();
    updateDashboardCards();
    showToast(`File ${cmsNo} returned`);
  }
}

// Show Profile Form
function showProfileForm() {
  document.getElementById('profileForm').style.display = 'block';
  document.getElementById('profileSearchSection').style.display = 'none';
  document.getElementById('profileList').style.display = 'none';
  document.getElementById('profileType').value = '';
  toggleProfileFields();
}

// Toggle Profile Fields
function toggleProfileFields() {
  const type = document.getElementById('profileType').value;
  const fields = document.getElementById('profileFields');
  fields.innerHTML = '';
  const required = '<span class="required">*</span>';
  if (type === 'munshi') {
    fields.innerHTML = `
      <label>Name: ${required}<input type="text" id="profileName" required></label>
      <label>Cell No: ${required}<input type="text" id="cellNo" required></label>
      <label>Advocate Name: ${required}<input type="text" id="advocateName" required></label>
      <label>Advocate Cell No: <input type="text" id="advocateCell"></label>
      <label>Chamber No: <input type="text" id="chamberNo"></label>
    `;
  } else if (type === 'advocate') {
    fields.innerHTML = `
      <label>Name: ${required}<input type="text" id="profileName" required></label>
      <label>Cell No: ${required}<input type="text" id="cellNo" required></label>
      <label>Chamber No: <input type="text" id="chamberNo"></label>
    `;
  } else if (type === 'colleague') {
    fields.innerHTML = `
      <label>Name: ${required}<input type="text" id="profileName" required></label>
      <label>Cell No: ${required}<input type="text" id="cellNo" required></label>
      <label>Designation: ${required}<input type="text" id="designation" required></label>
      <label>Posted At: ${required}<input type="text" id="postedAt" required></label>
    `;
  } else if (type === 'other') {
    fields.innerHTML = `
      <label>Name: ${required}<input type="text" id="profileName" required></label>
      <label>Cell No: ${required}<input type="text" id="cellNo" required></label>
      <label>ID/CNIC: ${required}<input type="text" id="cnic" required></label>
      <label>Relation to Case: ${required}<input type="text" id="relation" required></label>
    `;
  }
}

// Crop Profile Photo
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
    const canvas = cropper.getCroppedCanvas({ width: 100, height: 100 });
    canvas.toBlob((blob) => {
      const url = canvas.toDataURL('image/jpeg', 0.5);
      document.getElementById('profilePhoto').cropperResult = url;
      document.getElementById('photoCropper').style.display = 'none';
      cropper.destroy();
      cropper = null;
    }, 'image/jpeg', 0.5);
  }
}

// Profile Form Submission
document.getElementById('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  setTimeout(() => {
    const profilePhoto = document.getElementById('profilePhoto').cropperResult || document.getElementById('profilePhoto').files[0];
    const type = document.getElementById('profileType').value;
    const profile = { type, name: document.getElementById('profileName').value, cellNo: document.getElementById('cellNo').value };
    if (type === 'munshi') {
      profile.advocateName = document.getElementById('advocateName').value;
      profile.advocateCell = document.getElementById('advocateCell').value;
      profile.chamberNo = document.getElementById('chamberNo').value;
    } else if (type === 'advocate') {
      profile.chamberNo = document.getElementById('chamberNo').value;
    } else if (type === 'colleague') {
      profile.designation = document.getElementById('designation').value;
      profile.postedAt = document.getElementById('postedAt').value;
    } else if (type === 'other') {
      profile.cnic = document.getElementById('cnic').value;
      profile.relation = document.getElementById('relation').value;
    }
    const reader = new FileReader();
    reader.onload = () => {
      profile.photo = reader.result;
      const existingIndex = profiles.findIndex(p => p.name === profile.name && p.type === profile.type);
      if (existingIndex !== -1) {
        profiles[existingIndex] = profile;
      } else {
        profiles.push(profile);
      }
      localStorage.setItem('profiles', JSON.stringify(profiles));
      document.getElementById('profileForm').reset();
      document.getElementById('profileForm').style.display = 'none';
      renderProfiles();
      showToast('Profile saved successfully!');
      document.getElementById('loadingIndicator').style.display = 'none';
    };
    if (profilePhoto) reader.readAsDataURL(profilePhoto);
    else {
      profile.photo = '';
      profiles.push(profile);
      localStorage.setItem('profiles', JSON.stringify(profiles));
      document.getElementById('loadingIndicator').style.display = 'none';
    }
  }, 500);
});

// Show Profile Search
function showProfileSearch() {
  document.getElementById('profileForm').style.display = 'none';
  document.getElementById('profileSearchSection').style.display = 'block';
  document.getElementById('profileList').style.display = 'block';
  renderProfiles();
}

// Render Profiles
function renderProfiles() {
  const type = document.getElementById('profileFilterType').value;
  const search = document.getElementById('profileSearch').value.toLowerCase();
  const tbody = document.getElementById('profileTable').querySelector('tbody');
  tbody.innerHTML = '';

  const filteredProfiles = profiles.filter(p => (!type || p.type === type) && (!search || p.name.toLowerCase().includes(search) || p.cellNo.includes(search) || (p.chamberNo && p.chamberNo.includes(search))));

  filteredProfiles.forEach(p => {
    const pendingFiles = files.filter(f => f.deliveredTo === p.name && f.deliveredType === p.type && !f.returned).length;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${p.photo || 'icon-192.png'}" style="width:50px;height:50px;border-radius:50%;border:1px solid #ccc;"></td>
      <td>${p.name}</td>
      <td>${p.type}</td>
      <td><a href="tel:${p.cellNo}">${p.cellNo}</a></td>
      <td>${p.chamberNo || ''}</td>
      <td>${files.filter(f => f.deliveredTo === p.name && f.deliveredType === p.type).length}</td>
      <td>${pendingFiles}</td>
      <td>
        <button onclick="editProfile('${p.name}', '${p.type}')">Edit</button>
        <button onclick="deleteProfile('${p.name}', '${p.type}')">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// Edit Profile
function editProfile(name, type) {
  const profile = profiles.find(p => p.name === name && p.type === type);
  if (profile) {
    showProfileForm();
    document.getElementById('profileType').value = profile.type;
    toggleProfileFields();
    document.getElementById('profileName').value = profile.name;
    document.getElementById('cellNo').value = profile.cellNo;
    if (profile.type === 'munshi') {
      document.getElementById('advocateName').value = profile.advocateName;
      document.getElementById('advocateCell').value = profile.advocateCell;
      document.getElementById('chamberNo').value = profile.chamberNo;
    } else if (profile.type === 'advocate') {
      document.getElementById('chamberNo').value = profile.chamberNo;
    } else if (profile.type === 'colleague') {
      document.getElementById('designation').value = profile.designation;
      document.getElementById('postedAt').value = profile.postedAt;
    } else if (profile.type === 'other') {
      document.getElementById('cnic').value = profile.cnic;
      document.getElementById('relation').value = profile.relation;
    }
  }
}

// Delete Profile
function deleteProfile(name, type) {
  promptPin((success) => {
    if (success) {
      profiles = profiles.filter(p => p.name !== name || p.type !== type);
      localStorage.setItem('profiles', JSON.stringify(profiles));
      renderProfiles();
      showToast('Profile deleted successfully');
    }
  });
}

// Show Profile Details
function showProfileDetails(name, type) {
  const profile = profiles.find(p => p.name === name && p.type === type) || {};
  document.getElementById('profileModal').style.display = 'block';
  document.getElementById('profileModalTitle').textContent = `${name} (${type})`;
  if (profile.photo) {
    document.getElementById('profileModalPhoto').src = profile.photo;
    document.getElementById('profileModalPhotoZoom').src = profile.photo;
    document.getElementById('profileModalPhoto').style.display = 'block';
  } else {
    document.getElementById('profileModalPhoto').style.display = 'none';
  }
  const table = document.getElementById('profileModalTable');
  table.innerHTML = `
    <tr><th>Name</th><td>${profile.name || ''}</td></tr>
    <tr><th>Type</th><td>${profile.type || ''}</td></tr>
    <tr><th>Cell No</th><td><a href="tel:${profile.cellNo || ''}">${profile.cellNo || ''}</a></td></tr>
    ${profile.chamberNo ? `<tr><th>Chamber No</th><td>${profile.chamberNo}</td></tr>` : ''}
    ${profile.advocateName ? `<tr><th>Advocate Name</th><td>${profile.advocateName}</td></tr>` : ''}
    ${profile.advocateCell ? `<tr><th>Advocate Cell No</th><td><a href="tel:${profile.advocateCell}">${profile.advocateCell}</a></td></tr>` : ''}
    ${profile.designation ? `<tr><th>Designation</th><td>${profile.designation}</td></tr>` : ''}
    ${profile.postedAt ? `<tr><th>Posted At</th><td>${profile.postedAt}</td></tr>` : ''}
    ${profile.cnic ? `<tr><th>ID/CNIC</th><td>${maskCNIC(profile.cnic)}</td></tr>` : ''}
    ${profile.relation ? `<tr><th>Relation to Case</th><td>${profile.relation}</td></tr>` : ''}
  `;
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
}

// Import Profiles
function triggerImport() {
  document.getElementById('profileImport').click();
}

function importProfiles() {
  const file = document.getElementById('profileImport').files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error('Invalid format');
        const validProfiles = imported.filter(p => p.name && p.type && p.cellNo);
        profiles = [...profiles, ...validProfiles];
        localStorage.setItem('profiles', JSON.stringify(profiles));
        renderProfiles();
        showToast(`${validProfiles.length} profiles imported successfully`);
      } catch (e) {
        showToast('Invalid file format');
      }
    };
    reader.readAsText(file);
  }
}

// Export Profiles
function exportProfiles() {
  const data = JSON.stringify(profiles);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'profiles.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Backup Data
function backupData() {
  const data = { files, profiles, userProfile: { ...userProfile, pin: null, cnic: maskCNIC(userProfile.cnic) } };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cft_backup_${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  analytics.backupsCreated++;
  localStorage.setItem('analytics', JSON.stringify(analytics));
  showToast('Backup created successfully');
}

// Trigger Restore
function triggerRestore() {
  promptPin((success) => {
    if (success) document.getElementById('dataRestore').click();
  });
}

// Restore Data
function restoreData() {
  const file = document.getElementById('dataRestore').files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.files && data.profiles && data.userProfile) {
          files = data.files;
          profiles = data.profiles;
          userProfile = { ...data.userProfile, pin: userProfile.pin, cnic: userProfile.cnic };
          localStorage.setItem('files', JSON.stringify(files));
          localStorage.setItem('profiles', JSON.stringify(profiles));
          localStorage.setItem('userProfile', JSON.stringify(userProfile));
          updateSavedProfile();
          updateDashboardCards();
          showToast('Data restored successfully');
        } else {
          showToast('Invalid backup file');
        }
      } catch (e) {
        showToast('Error restoring data');
      }
    };
    reader.readAsText(file);
  }
}

// Export Dashboard Report
function exportDashboardReport(format) {
  if (format === 'csv') {
    let csv = 'Sr#,CMS No,Title,Case Type,Nature,Date Type,Swal Form Details,Delivered To,Delivery Date,Return Date,Time Span,Court,Clerk\n';
    currentReportData.forEach((f, index) => {
      const timeSpan = f.returned ? `${Math.ceil((new Date(f.returnedAt) - new Date(f.deliveredAt)) / (1000 * 60 * 60 * 24))} days` : getDynamicTimeSpan(f.deliveredAt);
      const swalDetails = f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${formatDate(f.swalDate)}` : '';
      csv += `${index + 1},${f.cmsNo},"${f.title.replace('vs', 'Vs.')}",${f.caseType},${f.nature},"${f.dateType === 'decision' ? 'Decision Date' : 'Next Hearing Date'}: ${formatDate(f.date)}","${swalDetails}","${f.deliveredTo} (${f.deliveredType})",${formatDate(f.deliveredAt)},${f.returned ? formatDate(f.returnedAt) : ''},${timeSpan},${f.courtName},${f.clerkName}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dashboard_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  } else if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(12);
    doc.text(document.getElementById('reportTitle').textContent, 10, 10);
    const tableData = currentReportData.map((f, index) => [
      index + 1,
      f.cmsNo,
      f.title.replace('vs', 'Vs.'),
      f.caseType,
      f.nature,
      `${f.dateType === 'decision' ? 'Decision Date' : 'Next Hearing Date'}: ${formatDate(f.date)}`,
      f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${formatDate(f.swalDate)}` : '',
      `${f.deliveredTo} (${f.deliveredType})`,
      formatDate(f.deliveredAt),
      f.returned ? formatDate(f.returnedAt) : '',
      f.returned ? `${Math.ceil((new Date(f.returnedAt) - new Date(f.deliveredAt)) / (1000 * 60 * 60 * 24))} days` : getDynamicTimeSpan(f.deliveredAt),
      f.courtName,
      f.clerkName
    ]);
    doc.autoTable({
      head: [['Sr#', 'CMS No', 'Title', 'Case Type', 'Nature', 'Date Type', 'Swal Form Details', 'Delivered To', 'Delivery Date', 'Return Date', 'Time Span', 'Court', 'Clerk']],
      body: tableData,
      startY: 20,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [0, 51, 102] }
    });
    doc.save('dashboard_report.pdf');
  }
}

// Print Dashboard Report
function printDashboardReport() {
  const printContent = document.getElementById('dashboardReportPanel').innerHTML;
  const newWindow = window.open('', '_blank');
  newWindow.document.write(`
    <html>
      <head>
        <title>Print Report</title>
        <style>
          body { font-family: Arial, sans-serif; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background-color: #f5f5f5; }
        </style>
      </head>
      <body>${printContent}</body>
    </html>
  `);
  newWindow.document.close();
  newWindow.print();
}

// Format Date
function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  if (format === 'YYYYMMDD_HHMMSS') return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  return `${year}-${month}-${day}`;
}

// Show Toast
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

// Offline Queue Processing
function processOfflineQueue() {
  if (navigator.onLine && offlineQueue.length > 0) {
    offlineQueue.forEach(action => {
      if (action.action === 'backupToDrive') {
        backupToDrive();
      }
    });
    offlineQueue = [];
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
  }
}

window.addEventListener('online', processOfflineQueue);

// Accessibility Enhancements
document.querySelectorAll('button').forEach(btn => {
  if (!btn.getAttribute('aria-label')) {
    btn.setAttribute('aria-label', btn.textContent || 'Button');
  }
});

document.querySelectorAll('input, select').forEach(input => {
  if (!input.getAttribute('aria-label')) {
    const label = input.closest('label')?.textContent.split(':')[0] || input.placeholder || 'Input';
    input.setAttribute('aria-label', label);
  }
});

// Global variables
let files = JSON.parse(localStorage.getItem('files')) || [];
let profiles = JSON.parse(localStorage.getItem('profiles')) || [];
let userProfile = JSON.parse(localStorage.getItem('userProfile')) || {};
let stats = JSON.parse(localStorage.getItem('stats')) || { deliveries: 0, returns: 0, pending: 0, tomorrow: 0, overdue: 0 };
let pinVerified = false;
let currentPage = 1;
const itemsPerPage = 10;
let sortColumn = 'id';
let sortDirection = 'asc';
let fuse;
let statsChart;
let editedPhoto = null; // Store edited photo Data URL
let isDragging = false;
let dragStartX, dragStartY, translateX = 0, translateY = 0, scale = 1;
let isAdminPhoto = false; // Flag to differentiate profile vs admin photo

// Google Drive API
const CLIENT_ID = '1022877727253-vlif6k2sstl4gn98e8svsh8mhd3j0gl3.apps.googleusercontent.com';
const API_KEY = 'AIzaSyCmYFpMXEtPdfSg4-K7lgdqNc-njgqONmQ';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
let tokenClient;
let gapiInited = false;
let gisInited = false;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initializeChart();
  loadUserProfile();
  checkPin();
  initGoogleDrive();
});

// Setup event listeners
function setupEventListeners() {
  // Hamburger menu
  document.getElementById('menuBtn').addEventListener('click', () => toggleSidebar(true));

  // Sidebar overlay
  document.querySelector('.sidebar-overlay').addEventListener('click', () => toggleSidebar(false));

  // Sidebar navigation
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const screen = btn.dataset.screen;
      if (!pinVerified && screen !== 'admin' && screen !== 'developersDisclaimer') {
        showPinModal();
        return;
      }
      navigate(screen);
    });
  });

  // Forms
  document.getElementById('fileForm').addEventListener('submit', handleFileSubmit);
  document.getElementById('returnForm').addEventListener('submit', filterPendingFiles);
  document.getElementById('profileForm').addEventListener('submit', handleProfileSubmit);
  document.getElementById('adminForm').addEventListener('submit', handleAdminSubmit);

  // Photo uploads
  document.getElementById('profilePhoto').addEventListener('change', handlePhotoUpload);
  document.getElementById('userPhoto').addEventListener('change', handlePhotoUpload);

  // Dashboard cards
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => handleCardClick(card.id));
  });

  // File Fetcher buttons
  document.getElementById('addProfileBtn').addEventListener('click', showProfileForm);
  document.getElementById('searchProfilesBtn').addEventListener('click', showProfileSearch);
  document.getElementById('importProfilesBtn').addEventListener('click', triggerImport);
  document.getElementById('exportProfilesBtn').addEventListener('click', exportProfiles);
  document.getElementById('profileImport').addEventListener('change', importProfiles);

  // Profile photo editor
  document.getElementById('saveProfilePhotoBtn').addEventListener('click', saveProfilePhoto);

  // Admin buttons
  document.getElementById('editProfileBtn').addEventListener('click', editUserProfile);
  document.getElementById('changePinBtn').addEventListener('click', showChangePin);
  document.getElementById('backupLocalBtn').addEventListener('click', backupData);
  document.getElementById('restoreLocalBtn').addEventListener('click', triggerRestore);
  document.getElementById('signInGoogleBtn').addEventListener('click', signInWithGoogle);
  document.getElementById('backupToDrive').addEventListener('click', backupToDrive);
  document.getElementById('restoreFromDrive').addEventListener('click', restoreFromDrive);
  document.getElementById('shareBackup').addEventListener('click', showShareBackup);
  document.getElementById('dataRestore').addEventListener('change', restoreData);

  // Admin photo editor
  document.getElementById('saveUserPhotoBtn').addEventListener('click', saveUserPhoto);

  // Modals
  document.getElementById('submitPinBtn').addEventListener('click', submitPin);
  document.getElementById('changePinSubmitBtn').addEventListener('click', changePin);
  document.getElementById('cancelPinBtn').addEventListener('click', hideChangePin);
  document.getElementById('disclaimerLink').addEventListener('click', (e) => {
    e.preventDefault();
    showDisclaimerModal();
  });
  document.getElementById('closeDisclaimerBtn').addEventListener('click', () => {
    document.getElementById('disclaimerModal').style.display = 'none';
  });
  document.getElementById('closeProfileModalBtn').addEventListener('click', closeProfileModal);
  document.getElementById('shareBackupBtn').addEventListener('click', shareBackup);
  document.getElementById('cancelShareBackupBtn').addEventListener('click', hideShareBackup);

  // Terms checkbox
  document.getElementById('agreeTerms').addEventListener('change', toggleSaveButton);

  // Profile search inputs
  document.getElementById('profileFilterType').addEventListener('change', renderProfiles);
  document.getElementById('profileSearch').addEventListener('input', renderProfiles);

  // Dashboard search inputs
  document.getElementById('searchTitle').addEventListener('input', performDashboardSearch);
  document.getElementById('searchCms').addEventListener('input', performDashboardSearch);
  document.getElementById('searchFileTaker').addEventListener('input', (e) => suggestProfiles(e.target.value, 'searchFileTaker'));
  document.getElementById('searchFirNo').addEventListener('input', performDashboardSearch);
  document.getElementById('searchFirYear').addEventListener('input', performDashboardSearch);
  document.getElementById('searchPoliceStation').addEventListener('input', performDashboardSearch);

  // Dashboard report buttons
  document.getElementById('printReportBtn').addEventListener('click', printDashboardReport);
  document.getElementById('exportCsvBtn').addEventListener('click', () => exportDashboardReport('csv'));
  document.getElementById('exportPdfBtn').addEventListener('click', () => exportDashboardReport('pdf'));

  // Pagination
  document.getElementById('prevPage').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      performDashboardSearch();
    }
  });
  document.getElementById('nextPage').addEventListener('click', () => {
    currentPage++;
    performDashboardSearch();
  });

  // File form inputs
  document.getElementById('caseType').addEventListener('change', toggleCriminalFields);
  document.getElementById('cmsNo').addEventListener('blur', autoFillCMS);
  document.getElementById('deliveredTo').addEventListener('input', (e) => suggestProfiles(e.target.value, 'deliveredTo'));
  document.getElementById('copyAgency').addEventListener('change', toggleCopyAgency);

  // Return form inputs
  document.getElementById('returnCms').addEventListener('input', filterPendingFiles);
  document.getElementById('returnTitle').addEventListener('input', filterPendingFiles);
  document.getElementById('bulkReturnBtn').addEventListener('click', bulkReturnFiles);
}

// Initialize Google Drive API
function initGoogleDrive() {
  gapi.load('client', () => {
    gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: [DISCOVERY_DOC],
    }).then(() => {
      gapiInited = true;
      checkGoogleAuth();
    }).catch(err => {
      console.error('GAPI init failed:', err);
      showToast('Google Drive API failed. Using local storage.', 'error');
    });
  });

  if (window.google && window.google.accounts) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          console.error('Google Sign-In error:', response.error);
          showToast('Google Sign-In failed.', 'error');
          return;
        }
        gapi.client.setToken({ access_token: response.access_token });
        document.getElementById('backupToDrive').style.display = 'inline-block';
        document.getElementById('restoreFromDrive').style.display = 'inline-block';
        document.getElementById('shareBackup').style.display = 'inline-block';
        showToast('Signed in with Google.');
      },
    });
    gisInited = true;
  } else {
    setTimeout(initGoogleDrive, 1000);
  }
}

// Check Google auth status
function checkGoogleAuth() {
  if (gapiInited && gapi.client.getToken()) {
    document.getElementById('backupToDrive').style.display = 'inline-block';
    document.getElementById('restoreFromDrive').style.display = 'inline-block';
    document.getElementById('shareBackup').style.display = 'inline-block';
  }
}

// Sign in with Google
function signInWithGoogle() {
  if (!gisInited) {
    showToast('Google Sign-In not ready. Please try again.', 'error');
    return;
  }
  tokenClient.requestAccessToken();
}

// Navigation
function navigate(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screen).classList.add('active');
  document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.sidebar-btn[data-screen="${screen}"]`).classList.add('active');
  toggleSidebar(false);

  if (screen === 'dashboard') renderDashboard();
  if (screen === 'return') filterPendingFiles();
  if (screen === 'fileFetcher') showProfileSearch();
}

// PIN verification
function checkPin() {
  if (!userProfile.pin) {
    navigate('admin');
    return;
  }
  if (!pinVerified) showPinModal();
}

function showPinModal() {
  document.getElementById('pinModal').style.display = 'flex';
  document.getElementById('pinInput').focus();
}

function submitPin() {
  const pin = document.getElementById('pinInput').value;
  if (pin === userProfile.pin) {
    pinVerified = true;
    document.getElementById('pinModal').style.display = 'none';
    document.querySelectorAll('.sidebar-btn.hidden').forEach(btn => btn.classList.remove('hidden'));
    navigate('dashboard');
  } else {
    showToast('Incorrect PIN.', 'error');
  }
}

// File submission
function handleFileSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const fileData = {
    id: Date.now(),
    caseType: document.getElementById('caseType').value,
    cmsNo: document.getElementById('cmsNo').value,
    title: `${document.getElementById('petitioner').value} Vs. ${document.getElementById('respondent').value}`,
    nature: document.getElementById('nature').value,
    firNo: document.getElementById('firNo').value,
    firYear: document.getElementById('firYear').value,
    firUs: document.getElementById('firUs').value,
    policeStation: document.getElementById('policeStation').value,
    dateType: document.getElementById('dateType').value,
    date: document.getElementById('date').value,
    deliveredTo: document.getElementById('deliveredTo').value,
    deliveredType: document.getElementById('deliveredType').value,
    copyAgency: document.getElementById('copyAgency').checked,
    swalFormNo: document.getElementById('swalFormNo').value,
    swalDate: document.getElementById('swalDate').value,
    deliveryDate: new Date().toISOString().split('T')[0],
    status: 'pending',
    court: userProfile.courtName || 'Unknown',
    clerkName: userProfile.clerkName || 'Unknown',
  };
  files.push(fileData);
  updateStats();
  saveData();
  showToast('File saved and delivered.');
  form.reset();
  toggleCriminalFields();
  toggleCopyAgency();
}

// Profile submission
function handleProfileSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const profileData = {
    id: Date.now(),
    type: document.getElementById('profileType').value,
    name: document.getElementById('profileName').value,
    cellNo: document.getElementById('profileCellNo').value,
    chamberNo: document.getElementById('profileChamberNo').value || '',
    photo: editedPhoto || '',
  };
  profiles.push(profileData);
  saveData();
  showToast('Profile saved.');
  form.reset();
  document.getElementById('profileForm').style.display = 'none';
  document.getElementById('photoEditor').classList.remove('active');
  editedPhoto = null;
  showProfileSearch();
}

// Admin submission
function handleAdminSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const newProfile = {
    clerkName: document.getElementById('clerkName').value.trim(),
    judgeName: document.getElementById('judgeName').value.trim(),
    courtName: document.getElementById('courtName').value.trim(),
    mobile: document.getElementById('mobile').value.trim(),
    cnic: document.getElementById('cnic').value.trim(),
    pin: document.getElementById('pin').value.trim(),
    email: document.getElementById('email').value.trim(),
    photo: editedPhoto || '',
  };
  if (!newProfile.pin.match(/^\d{4}$/)) {
    showToast('PIN must be 4 digits.', 'error');
    return;
  }
  userProfile = newProfile;
  try {
    saveData();
    pinVerified = true;
    showToast('Admin profile saved.');
    loadUserProfile();
    navigate('dashboard');
  } catch (err) {
    console.error('Failed to save admin profile:', err);
    showToast('Failed to save admin profile.', 'error');
  }
}

// Photo upload handling
function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please upload an image file.', 'error');
    return;
  }
  isAdminPhoto = e.target.id === 'userPhoto';
  const previewId = isAdminPhoto ? 'userPhotoPreview' : 'profilePhotoPreview';
  const editorId = isAdminPhoto ? 'userPhotoEditor' : 'photoEditor';
  const preview = document.getElementById(previewId);
  const editor = document.getElementById(editorId);
  const reader = new FileReader();
  reader.onload = () => {
    preview.src = reader.result;
    editor.classList.add('active');
    resetPhotoEditor();
    setupPhotoEditor(previewId);
  };
  reader.onerror = () => showToast('Failed to load image.', 'error');
  reader.readAsDataURL(file);
}

// Reset photo editor state
function resetPhotoEditor() {
  translateX = 0;
  translateY = 0;
  scale = 1;
  isDragging = false;
  const zoomInput = document.getElementById(isAdminPhoto ? 'userZoom' : 'profileZoom');
  zoomInput.value = 1;
  updatePhotoTransform();
}

// Setup photo editor (drag and zoom)
function setupPhotoEditor(previewId) {
  const preview = document.getElementById(previewId);
  const zoomInput = document.getElementById(isAdminPhoto ? 'userZoom' : 'profileZoom');
  const container = document.getElementById(isAdminPhoto ? 'userPhotoPreviewContainer' : 'profilePhotoPreviewContainer');

  // Zoom handling
  const updateZoom = () => {
    scale = parseFloat(zoomInput.value);
    updatePhotoTransform();
  };
  zoomInput.removeEventListener('input', updateZoom); // Prevent duplicate listeners
  zoomInput.addEventListener('input', updateZoom);

  // Drag handling (mouse)
  const startDragging = (e) => {
    e.preventDefault();
    isDragging = true;
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    dragStartX = clientX - translateX;
    dragStartY = clientY - translateY;
  };

  const drag = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    translateX = clientX - dragStartX;
    translateY = clientY - dragStartY;
    requestAnimationFrame(updatePhotoTransform);
  };

  const stopDragging = () => {
    isDragging = false;
  };

  preview.removeEventListener('mousedown', startDragging);
  preview.removeEventListener('touchstart', startDragging);
  document.removeEventListener('mousemove', drag);
  document.removeEventListener('touchmove', drag);
  document.removeEventListener('mouseup', stopDragging);
  document.removeEventListener('touchend', stopDragging);

  preview.addEventListener('mousedown', startDragging);
  preview.addEventListener('touchstart', startDragging);
  document.addEventListener('mousemove', drag);
  document.addEventListener('touchmove', drag);
  document.addEventListener('mouseup', stopDragging);
  document.addEventListener('touchend', stopDragging);

  // Pinch-to-zoom (mobile)
  let lastDistance = 0;
  const startPinch = (e) => {
    if (e.touches.length === 2) {
      lastDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  };

  const pinchZoom = (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const delta = distance - lastDistance;
      scale = Math.min(Math.max(scale + delta * 0.01, 1), 3);
      zoomInput.value = scale;
      lastDistance = distance;
      updatePhotoTransform();
    }
  };

  preview.removeEventListener('touchstart', startPinch);
  preview.removeEventListener('touchmove', pinchZoom);
  preview.addEventListener('touchstart', startPinch);
  preview.addEventListener('touchmove', pinchZoom);
}

// Update photo transform
function updatePhotoTransform() {
  const preview = document.getElementById(isAdminPhoto ? 'userPhotoPreview' : 'profilePhotoPreview');
  preview.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
}

// Save profile photo
function saveProfilePhoto() {
  savePhoto(false);
}

// Save admin photo
function saveUserPhoto() {
  savePhoto(true);
}

// Save photo (generic function)
function savePhoto(isAdmin) {
  const preview = document.getElementById(isAdmin ? 'userPhotoPreview' : 'profilePhotoPreview');
  const container = document.getElementById(isAdmin ? 'userPhotoPreviewContainer' : 'profilePhotoPreviewContainer');
  const size = isAdmin ? 120 : 200;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const img = new Image();
  img.src = preview.src;
  img.onload = () => {
    const imgWidth = img.width * scale;
    const imgHeight = img.height * scale;
    let offsetX = -translateX / scale;
    let offsetY = -translateY / scale;

    if (imgWidth < size) offsetX = (size - imgWidth) / 2 / scale;
    if (imgHeight < size) offsetY = (size - imgHeight) / 2 / scale;

    ctx.drawImage(img, offsetX, offsetY, img.width, img.height, 0, 0, size / scale, size / scale);
    editedPhoto = canvas.toDataURL('image/jpeg', 0.8);
    document.getElementById(isAdmin ? 'userPhotoEditor' : 'photoEditor').classList.remove('active');
    showToast('Photo saved.');
  };
  img.onerror = () => showToast('Failed to process image.', 'error');
}

// Toggle save button
function toggleSaveButton() {
  document.getElementById('saveProfileBtn').disabled = !document.getElementById('agreeTerms').checked;
}

// Toggle sidebar
function toggleSidebar(show) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  sidebar.classList.toggle('active', show);
  overlay.classList.toggle('active', show);
}

// Render dashboard
function renderDashboard() {
  updateStats();
  document.getElementById('cardDeliveries').textContent = `Deliveries Today: ${stats.deliveries}`;
  document.getElementById('cardReturns').textContent = `Returns Today: ${stats.returns}`;
  document.getElementById('cardPending').textContent = `Pending: ${stats.pending}`;
  document.getElementById('cardTomorrow').textContent = `Tomorrow: ${stats.tomorrow}`;
  document.getElementById('cardOverdue').textContent = `Overdue: ${stats.overdue}`;
  updateChart();
}

// Update stats
function updateStats() {
  const today = new Date().toISOString().split('T')[0];
  stats.deliveries = files.filter(f => f.deliveryDate === today).length;
  stats.returns = files.filter(f => f.returnDate === today).length;
  stats.pending = files.filter(f => f.status === 'pending').length;
  stats.tomorrow = files.filter(f => {
    const date = new Date(f.date);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return date.toISOString().split('T')[0] === tomorrow.toISOString().split('T')[0];
  }).length;
  stats.overdue = files.filter(f => {
    const deliveryDate = new Date(f.deliveryDate);
    const diffDays = (new Date() - deliveryDate) / (1000 * 60 * 60 * 24);
    return f.status === 'pending' && diffDays > 10;
  }).length;
  localStorage.setItem('stats', JSON.stringify(stats));
}

// Initialize chart
function initializeChart() {
  const ctx = document.getElementById('statsChart').getContext('2d');
  statsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Deliveries', 'Returns', 'Pending', 'Tomorrow', 'Overdue'],
      datasets: [{
        label: 'File Stats',
        data: [stats.deliveries, stats.returns, stats.pending, stats.tomorrow, stats.overdue],
        backgroundColor: ['#0288d1', '#4caf50', '#d32f2f', '#fb8c00', '#7b1fa2'],
      }],
    },
    options: { scales: { y: { beginAtZero: true } } },
  });
}

// Update chart
function updateChart() {
  statsChart.data.datasets[0].data = [stats.deliveries, stats.returns, stats.pending, stats.tomorrow, stats.overdue];
  statsChart.update();
}

// Render profiles
function renderProfiles() {
  const filterType = document.getElementById('profileFilterType').value;
  const search = document.getElementById('profileSearch').value.toLowerCase();
  let filteredProfiles = profiles;
  if (filterType) {
    filteredProfiles = profiles.filter(p => p.type === filterType);
  }
  if (search) {
    fuse = new Fuse(filteredProfiles, { keys: ['name', 'cellNo', 'chamberNo'], threshold: 0.3 });
    filteredProfiles = fuse.search(search).map(result => result.item);
  }
  const tbody = document.getElementById('profileTable').querySelector('tbody');
  tbody.innerHTML = '';
  filteredProfiles.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img src="${p.photo || 'icon-192.png'}" style="width:50px;height:50px;border-radius:50%;" alt="Profile photo" /></td>
      <td>${p.name}</td>
      <td>${p.type}</td>
      <td>${p.cellNo}</td>
      <td>${p.chamberNo}</td>
      <td>${files.filter(f => f.deliveredTo === p.name && f.status === 'delivered').length}</td>
      <td>${files.filter(f => f.deliveredTo === p.name && f.status === 'pending').length}</td>
      <td>
        <button onclick="editProfile(${p.id})">Edit</button>
        <button onclick="deleteProfile(${p.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Save data
function saveData() {
  try {
    localStorage.setItem('files', JSON.stringify(files));
    localStorage.setItem('profiles', JSON.stringify(profiles));
    localStorage.setItem('userProfile', JSON.stringify(userProfile));
    localStorage.setItem('stats', JSON.stringify(stats));
  } catch (e) {
    console.error('Failed to save data:', e);
    showToast('Failed to save data.', 'error');
  }
}

// Show toast
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#d32f2f' : '#4caf50';
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 3000);
}

// Load user profile
function loadUserProfile() {
  if (userProfile.clerkName) {
    document.getElementById('setupMessage').style.display = 'none';
    document.getElementById('adminForm').style.display = 'none';
    document.getElementById('savedProfile').style.display = 'block';
    document.getElementById('savedClerkName').textContent = userProfile.clerkName || '';
    document.getElementById('savedJudgeName').textContent = userProfile.judgeName || '';
    document.getElementById('savedCourtName').textContent = userProfile.courtName || '';
    document.getElementById('savedMobile').textContent = userProfile.mobile || '';
    document.getElementById('savedMobile').href = userProfile.mobile ? `tel:${userProfile.mobile}` : '#';
    if (userProfile.photo) {
      document.getElementById('savedUserPhoto').src = userProfile.photo;
      document.getElementById('savedUserPhoto').style.display = 'block';
    }
    document.getElementById('totalFiles').textContent = files.length;
    document.getElementById('totalProfiles').textContent = profiles.length;
    document.getElementById('changePinBtn').style.display = 'inline-block';
  }
}

// Backup to Google Drive
function backupToDrive() {
  if (!gapiInited || !gapi.client.getToken()) {
    showToast('Not signed in to Google.', 'error');
    return;
  }
  const backupData = { files, profiles, userProfile, stats };
  const fileContent = JSON.stringify(backupData);
  const metadata = {
    name: `CFT_Backup_${new Date().toISOString().split('T')[0]}.json`,
    mimeType: 'application/json',
    parents: ['appDataFolder'],
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([fileContent], { type: 'application/json' }));
  gapi.client.request({
    path: '/upload/drive/v3/files',
    method: 'POST',
    params: { uploadType: 'multipart' },
    body: form,
  }).then(() => {
    showToast('Backup saved to Google Drive.');
  }).catch(err => {
    console.error('Backup failed:', err);
    showToast('Backup to Google Drive failed.', 'error');
  });
}

// Restore from Google Drive
function restoreFromDrive() {
  if (!gapiInited || !gapi.client.getToken()) {
    showToast('Not signed in to Google.', 'error');
    return;
  }
  gapi.client.drive.files.list({
    spaces: 'appDataFolder',
    fields: 'files(id, name)',
    pageSize: 10,
  }).then(response => {
    const select = document.getElementById('backupFiles');
    select.innerHTML = '<option value="">Select a backup</option>';
    response.result.files.forEach(file => {
      const option = document.createElement('option');
      option.value = file.id;
      option.textContent = file.name;
      select.appendChild(option);
    });
    document.getElementById('shareBackupModal').style.display = 'flex';
  }).catch(err => {
    console.error('Restore failed:', err);
    showToast('Failed to list backups.', 'error');
  });
}

// Additional helper functions
function toggleCriminalFields() {
  document.getElementById('criminalFields').style.display = document.getElementById('caseType').value === 'criminal' ? 'block' : 'none';
}

function toggleCopyAgency() {
  document.getElementById('copyAgencyFields').style.display = document.getElementById('copyAgency').checked ? 'block' : 'none';
}

function handleCardClick(cardId) {
  if (cardId === 'cardSearchPrev') {
    document.getElementById('dashboardReportPanel').style.display = 'block';
    document.getElementById('searchPrevRecords').style.display = 'block';
    performDashboardSearch();
  }
}

function filterPendingFiles(e) {
  if (e) e.preventDefault();
  const cms = document.getElementById('returnCms').value;
  const title = document.getElementById('returnTitle').value.toLowerCase();
  const filteredFiles = files.filter(f => f.status === 'pending' &&
    (!cms || f.cmsNo.includes(cms)) &&
    (!title || f.title.toLowerCase().includes(title))
  );
  const tbody = document.getElementById('pendingFilesTable').querySelector('tbody');
  tbody.innerHTML = '';
  filteredFiles.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="return-checkbox" data-id="${f.id}" /></td>
      <td>${f.cmsNo}</td>
      <td>${f.title}</td>
      <td>${f.caseType}</td>
      <td>${f.deliveredTo}</td>
      <td><button onclick="returnFile(${f.id})">Return</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function bulkReturnFiles() {
  const checkboxes = document.querySelectorAll('.return-checkbox:checked');
  checkboxes.forEach(cb => {
    const id = parseInt(cb.dataset.id);
    const file = files.find(f => f.id === id);
    if (file) {
      file.status = 'returned';
      file.returnDate = new Date().toISOString().split('T')[0];
    }
  });
  updateStats();
  saveData();
  showToast('Selected files returned.');
  filterPendingFiles();
}

function returnFile(id) {
  const file = files.find(f => f.id === id);
  if (file) {
    file.status = 'returned';
    file.returnDate = new Date().toISOString().split('T')[0];
    updateStats();
    saveData();
    showToast('File returned.');
    filterPendingFiles();
  }
}

function suggestProfiles(value, inputId) {
  const ul = document.getElementById(inputId === 'deliveredTo' ? 'suggestions' : 'searchSuggestions');
  ul.innerHTML = '';
  if (!value) return;
  const filtered = profiles.filter(p => p.name.toLowerCase().includes(value.toLowerCase()));
  filtered.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `
      <img src="${p.photo || 'icon-192.png'}" alt="Profile photo" />
      <span>${p.name} (${p.cellNo})</span>
    `;
    li.addEventListener('click', () => {
      document.getElementById(inputId).value = p.name;
      ul.innerHTML = '';
    });
    ul.appendChild(li);
  });
}

function editProfile(id) {
  const profile = profiles.find(p => p.id === id);
  if (!profile) return;
  document.getElementById('profileType').value = profile.type;
  document.getElementById('profileName').value = profile.name;
  document.getElementById('profileCellNo').value = profile.cellNo;
  document.getElementById('profileChamberNo').value = profile.chamberNo;
  if (profile.photo) {
    document.getElementById('profilePhotoPreview').src = profile.photo;
    document.getElementById('photoEditor').classList.add('active');
    editedPhoto = profile.photo;
  }
  document.getElementById('profileForm').style.display = 'block';
  document.getElementById('profileSearchSection').style.display = 'none';
  document.getElementById('profileList').style.display = 'none';
  profiles = profiles.filter(p => p.id !== id);
}

function deleteProfile(id) {
  profiles = profiles.filter(p => p.id !== id);
  saveData();
  renderProfiles();
}

function showProfileForm() {
  document.getElementById('profileForm').style.display = 'block';
  document.getElementById('profileSearchSection').style.display = 'none';
  document.getElementById('profileList').style.display = 'none';
  document.getElementById('profileForm').reset();
  document.getElementById('photoEditor').classList.remove('active');
  editedPhoto = null;
}

function showProfileSearch() {
  document.getElementById('profileForm').style.display = 'none';
  document.getElementById('profileSearchSection').style.display = 'block';
  document.getElementById('profileList').style.display = 'block';
  renderProfiles();
}

function triggerImport() {
  document.getElementById('profileImport').click();
}

function importProfiles(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      profiles = data.profiles || [];
      saveData();
      showToast('Profiles imported.');
      renderProfiles();
    } catch (err) {
      showToast('Invalid import file.', 'error');
    }
  };
  reader.readAsText(file);
}

function exportProfiles() {
  const data = JSON.stringify({ profiles });
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'profiles.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Profiles exported.');
}

function backupData() {
  const backupData = { files, profiles, userProfile, stats };
  const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CFT_Backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup saved locally.');
}

function triggerRestore() {
  document.getElementById('dataRestore').click();
}

function restoreData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      files = data.files || [];
      profiles = data.profiles || [];
      userProfile = data.userProfile || {};
      stats = data.stats || { deliveries: 0, returns: 0, pending: 0, tomorrow: 0, overdue: 0 };
      saveData();
      loadUserProfile();
      renderDashboard();
      showToast('Data restored.');
    } catch (err) {
      showToast('Invalid restore file.', 'error');
    }
  };
  reader.readAsText(file);
}

function showShareBackup() {
  restoreFromDrive();
}

function hideShareBackup() {
  document.getElementById('shareBackupModal').style.display = 'none';
}

function shareBackup() {
  const fileId = document.getElementById('backupFiles').value;
  const email = document.getElementById('shareEmail').value;
  if (!fileId || !email) {
    showToast('Please select a backup and enter an email.', 'error');
    return;
  }
  gapi.client.drive.permissions.create({
    fileId: fileId,
    resource: {
      type: 'user',
      role: 'reader',
      emailAddress: email,
    },
  }).then(() => {
    showToast('Backup shared.');
    hideShareBackup();
  }).catch(err => {
    console.error('Share failed:', err);
    showToast('Failed to share backup.', 'error');
  });
}

function showChangePin() {
  document.getElementById('changePinModal').style.display = 'flex';
}

function hideChangePin() {
  document.getElementById('changePinModal').style.display = 'none';
}

function changePin() {
  const cnic = document.getElementById('resetCnic').value;
  const newPin = document.getElementById('resetPin').value;
  if (!newPin.match(/^\d{4}$/)) {
    showToast('New PIN must be 4 digits.', 'error');
    return;
  }
  if (cnic === userProfile.cnic || cnic === userProfile.email) {
    userProfile.pin = newPin;
    saveData();
    showToast('PIN changed.');
    hideChangePin();
  } else {
    showToast('Invalid CNIC or email.', 'error');
  }
}

function showDisclaimerModal() {
  document.getElementById('disclaimerModal').style.display = 'flex';
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
}

function editUserProfile() {
  document.getElementById('setupMessage').style.display = 'none';
  document.getElementById('savedProfile').style.display = 'none';
  document.getElementById('adminForm').style.display = 'block';
  document.getElementById('clerkName').value = userProfile.clerkName || '';
  document.getElementById('judgeName').value = userProfile.judgeName || '';
  document.getElementById('courtName').value = userProfile.courtName || '';
  document.getElementById('mobile').value = userProfile.mobile || '';
  document.getElementById('cnic').value = userProfile.cnic || '';
  document.getElementById('pin').value = userProfile.pin || '';
  document.getElementById('email').value = userProfile.email || '';
  if (userProfile.photo) {
    document.getElementById('userPhotoPreview').src = userProfile.photo;
    document.getElementById('userPhotoEditor').classList.add('active');
    editedPhoto = userProfile.photo;
  }
}

function autoFillCMS() {
  const cmsNo = document.getElementById('cmsNo').value;
  const existingFile = files.find(f => f.cmsNo === cmsNo);
  if (existingFile) {
    document.getElementById('petitioner').value = existingFile.title.split(' Vs. ')[0];
    document.getElementById('respondent').value = existingFile.title.split(' Vs. ')[1];
    document.getElementById('nature').value = existingFile.nature;
    document.getElementById('caseType').value = existingFile.caseType;
    toggleCriminalFields();
    document.getElementById('firNo').value = existingFile.firNo || '';
    document.getElementById('firYear').value = existingFile.firYear || '';
    document.getElementById('firUs').value = existingFile.firUs || '';
    document.getElementById('policeStation').value = existingFile.policeStation || '';
  }
}

function performDashboardSearch() {
  const title = document.getElementById('searchTitle').value.toLowerCase();
  const cms = document.getElementById('searchCms').value;
  const fileTaker = document.getElementById('searchFileTaker').value.toLowerCase();
  const firNo = document.getElementById('searchFirNo').value.toLowerCase();
  const firYear = document.getElementById('searchFirYear').value;
  const policeStation = document.getElementById('searchPoliceStation').value.toLowerCase();

  let filteredFiles = files;
  if (title) filteredFiles = filteredFiles.filter(f => f.title.toLowerCase().includes(title));
  if (cms) filteredFiles = filteredFiles.filter(f => f.cmsNo.includes(cms));
  if (fileTaker) filteredFiles = filteredFiles.filter(f => f.deliveredTo.toLowerCase().includes(fileTaker));
  if (firNo) filteredFiles = filteredFiles.filter(f => f.firNo && f.firNo.toLowerCase().includes(firNo));
  if (firYear) filteredFiles = filteredFiles.filter(f => f.firYear && f.firYear.includes(firYear));
  if (policeStation) filteredFiles = filteredFiles.filter(f => f.policeStation && f.policeStation.toLowerCase().includes(policeStation));

  const start = (currentPage - 1) * itemsPerPage;
  const paginatedFiles = filteredFiles.slice(start, start + itemsPerPage);

  const tbody = document.getElementById('dashboardReportTable').querySelector('tbody');
  tbody.innerHTML = '';
  paginatedFiles.forEach((f, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${start + index + 1}</td>
      <td>${f.cmsNo}</td>
      <td>${f.title}</td>
      <td>${f.caseType}</td>
      <td>${f.nature}</td>
      <td>${f.dateType}</td>
      <td>${f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${f.swalDate}` : '-'}</td>
      <td>${f.deliveredTo}</td>
      <td>${f.deliveryDate}</td>
      <td>${f.returnDate || '-'}</td>
      <td>${f.returnDate ? Math.ceil((new Date(f.returnDate) - new Date(f.deliveryDate)) / (1000 * 60 * 60 * 24)) + ' days' : '-'}</td>
      <td>${f.court}</td>
      <td>${f.clerkName}</td>
      <td><button onclick="showProfileDetails('${f.deliveredTo}')">View</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${Math.ceil(filteredFiles.length / itemsPerPage)}`;
  document.getElementById('prevPage').disabled = currentPage === 1;
  document.getElementById('nextPage').disabled = start + itemsPerPage >= filteredFiles.length;
}

function showProfileDetails(name) {
  const profile = profiles.find(p => p.name === p.deliveredTo);
  if (!profile) {
    showToast('Profile not found.', 'error');
    return;
  }
  document.getElementById('profileModalTitle').textContent = profile.name;
  if (profile.photo) {
    document.getElementById('profileModalPhoto').src = profile.photo;
    document.getElementById('profileModalPhoto').style.display = 'block';
    document.getElementById('profileModalPhotoZoom').src = profile.photo;
  }
  const table = document.getElementById('profileModalTable');
  table.innerHTML = `
    <tr><th>Type</th><td>${profile.type}</td></tr>
    <tr><th>Cell No</th><td>${profile.cellNo}</td></tr>
    <tr><th>Chamber No</th><td>${profile.chamberNo || '-'}</td></tr>
    <tr><th>Files Delivered</th><td>${files.filter(f => f.deliveredTo === profile.name && f.status === 'delivered').length}</td></tr>
    <tr><th>Pending Files</th><td>${files.filter(f => f.deliveredTo === profile.name && f.status === 'pending').length}</td></tr>
  `;
  document.getElementById('profileModal').style.display = 'flex';
}

function printDashboardReport() {
  window.print();
}

function exportDashboardReport(format) {
  const title = document.getElementById('searchTitle').value.toLowerCase();
  const cms = document.getElementById('searchCms').value;
  const fileTaker = document.getElementById('searchFileTaker').value.toLowerCase();
  const firNo = document.getElementById('searchFirNo').value.toLowerCase();
  const firYear = document.getElementById('searchFirYear').value;
  const policeStation = document.getElementById('searchPoliceStation').value.toLowerCase();

  let filteredFiles = files;
  if (title) filteredFiles = filteredFiles.filter(f => f.title.toLowerCase().includes(title));
  if (cms) filteredFiles = filteredFiles.filter(f => f.cmsNo.includes(cms));
  if (fileTaker) filteredFiles = filteredFiles.filter(f => f.deliveredTo.toLowerCase().includes(fileTaker));
  if (firNo) filteredFiles = filteredFiles.filter(f => f.firNo && f.firNo.toLowerCase().includes(firNo));
  if (firYear) filteredFiles = filteredFiles.filter(f => f.firYear && f.firYear.includes(firYear));
  if (policeStation) filteredFiles = filteredFiles.filter(f => f.policeStation && f.policeStation.toLowerCase().includes(policeStation));

  if (format === 'csv') {
    const headers = ['Sr#', 'CMS No', 'Title', 'Case Type', 'Nature', 'Date Type', 'Swal Form Details', 'Delivered To', 'Delivery Date', 'Return Date', 'Time Span', 'Court', 'Clerk Name'];
    const rows = filteredFiles.map((f, index) => [
      index + 1,
      f.cmsNo,
      f.title,
      f.caseType,
      f.nature,
      f.dateType,
      f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${f.swalDate}` : '-',
      f.deliveredTo,
      f.deliveryDate,
      f.returnDate || '-',
      f.returnDate ? Math.ceil((new Date(f.returnDate) - new Date(f.deliveryDate)) / (1000 * 60 * 60 * 24)) + ' days' : '-',
      f.court,
      f.clerkName,
    ].map(field => `"${field}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'report.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Report exported as CSV.');
  } else if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Court File Tracker Report', 20, 20);
    doc.setFontSize(12);
    const headers = [['Sr#', 'CMS No', 'Title', 'Case Type', 'Nature', 'Date Type', 'Swal Form', 'Delivered To', 'Delivery Date', 'Return Date', 'Time Span', 'Court', 'Clerk Name']];
    const data = filteredFiles.map((f, index) => [
      index + 1,
      f.cmsNo,
      f.title,
      f.caseType,
      f.nature,
      f.dateType,
      f.swalFormNo ? `No: ${f.swalFormNo}, Date: ${f.swalDate}` : '-',
      f.deliveredTo,
      f.deliveryDate,
      f.returnDate || '-',
      f.returnDate ? Math.ceil((new Date(f.returnDate) - new Date(f.deliveryDate)) / (1000 * 60 * 60 * 24)) + ' days' : '-',
      f.court,
      f.clerkName,
    ]);
    doc.autoTable({
      head: headers,
      body: data,
      startY: 30,
      theme: 'grid',
      styles: { fontSize: 8 },
      columnStyles: { 2: { cellWidth: 30 } },
    });
    doc.save('report.pdf');
    showToast('Report exported as PDF.');
  }
}

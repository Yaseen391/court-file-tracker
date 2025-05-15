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
  // Navigation
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!pinVerified && btn.textContent.includes('Admin')) return;
      if (!pinVerified) {
        showPinModal();
        return;
      }
      navigate(btn.getAttribute('onclick').match(/'([^']+)'/)[1]);
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

  // Menu and sidebar
  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
  document.getElementById('pinModal').addEventListener('submit', submitPin);
}

// Initialize Google Drive API
function initGoogleDrive() {
  // Load gapi client
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

  // Initialize Google Identity Services
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
    // Retry loading gsi/client
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
  document.querySelector(`.sidebar-btn[onclick*="${screen}"]`).classList.add('active');
  toggleSidebar(false);

  // Screen-specific logic
  if (screen === 'dashboard') renderDashboard();
  if (screen === 'return') filterPendingFiles();
  if (screen === 'fileFetcher') renderProfiles();
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
    court: userProfile.courtName,
    clerkName: userProfile.clerkName,
  };
  files.push(fileData);
  updateStats();
  saveData();
  showToast('File saved and delivered.');
  document.getElementById('fileForm').reset();
  toggleCriminalFields();
  toggleCopyAgency();
}

// Profile submission
function handleProfileSubmit(e) {
  e.preventDefault();
  const profileData = {
    id: Date.now(),
    type: document.getElementById('profileType').value,
    name: document.getElementById('profileName').value,
    cellNo: document.getElementById('profileCellNo').value,
    chamberNo: document.getElementById('profileChamberNo')?.value || '',
    photo: editedPhoto || '',
  };
  profiles.push(profileData);
  saveData();
  showToast('Profile saved.');
  document.getElementById('profileForm').reset();
  document.getElementById('profileForm').style.display = 'none';
  document.getElementById('photoEditor').style.display = 'none';
  editedPhoto = null;
  renderProfiles();
}

// Admin submission
function handleAdminSubmit(e) {
  e.preventDefault();
  userProfile = {
    clerkName: document.getElementById('clerkName').value,
    judgeName: document.getElementById('judgeName').value,
    courtName: document.getElementById('courtName').value,
    mobile: document.getElementById('mobile').value,
    cnic: document.getElementById('cnic').value,
    pin: document.getElementById('pin').value,
    email: document.getElementById('email').value,
    photo: editedPhoto || '',
  };
  saveData();
  pinVerified = true;
  showToast('Profile saved.');
  loadUserProfile();
  navigate('dashboard');
}

// Photo upload handling
function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  isAdminPhoto = e.target.id === 'userPhoto';
  const previewId = isAdminPhoto ? 'userPhotoPreview' : 'profilePhotoPreview';
  const editorId = isAdminPhoto ? 'userPhotoEditor' : 'photoEditor';
  const preview = document.getElementById(previewId);
  const reader = new FileReader();
  reader.onload = () => {
    preview.src = reader.result;
    document.getElementById(editorId).style.display = 'block';
    resetPhotoEditor();
    setupPhotoEditor(previewId);
  };
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
  zoomInput.addEventListener('input', () => {
    scale = parseFloat(zoomInput.value);
    updatePhotoTransform();
  });

  // Drag handling (mouse)
  preview.addEventListener('mousedown', startDragging);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', stopDragging);

  // Drag handling (touch)
  preview.addEventListener('touchstart', startDragging);
  document.addEventListener('touchmove', drag);
  document.addEventListener('touchend', stopDragging);

  function startDragging(e) {
    e.preventDefault();
    isDragging = true;
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    dragStartX = clientX - translateX;
    dragStartY = clientY - translateY;
  }

  function drag(e) {
    if (!isDragging) return;
    e.preventDefault();
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    translateX = clientX - dragStartX;
    translateY = clientY - dragStartY;
    requestAnimationFrame(updatePhotoTransform);
  }

  function stopDragging() {
    isDragging = false;
  }

  // Pinch-to-zoom (mobile)
  let lastDistance = 0;
  preview.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lastDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  });

  preview.addEventListener('touchmove', (e) => {
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
  });
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
  const size = isAdmin ? 120 : 200; // Admin: 120x120, Profile: 200x200
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Calculate the visible portion
  const img = new Image();
  img.src = preview.src;
  img.onload = () => {
    const containerRect = container.getBoundingClientRect();
    const imgWidth = img.width * scale;
    const imgHeight = img.height * scale;
    let offsetX = -translateX / scale;
    let offsetY = -translateY / scale;

    // Center the image if it's smaller than the container
    if (imgWidth < size) offsetX = (size - imgWidth) / 2 / scale;
    if (imgHeight < size) offsetY = (size - imgHeight) / 2 / scale;

    ctx.drawImage(img, offsetX, offsetY, img.width, img.height, 0, 0, size / scale, size / scale);
    editedPhoto = canvas.toDataURL('image/jpeg', 0.8);
    document.getElementById(isAdmin ? 'userPhotoEditor' : 'photoEditor').style.display = 'none';
    showToast('Photo saved.');
  };
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
    fuse = new Fuse(filteredProfiles, { keys: ['name', 'cellNo', 'chamberNo'] });
    filteredProfiles = fuse.search(search).map(result => result.item);
  }
  const tbody = document.getElementById('profileTable').querySelector('tbody');
  tbody.innerHTML = '';
  filteredProfiles.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img src="${p.photo || 'icon-192.png'}" style="width:50px;height:50px;border-radius:50%;" /></td>
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
  localStorage.setItem('files', JSON.stringify(files));
  localStorage.setItem('profiles', JSON.stringify(profiles));
  localStorage.setItem('userProfile', JSON.stringify(userProfile));
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
    document.getElementById('savedClerkName').textContent = userProfile.clerkName;
    document.getElementById('savedJudgeName').textContent = userProfile.judgeName;
    document.getElementById('savedCourtName').textContent = userProfile.courtName;
    document.getElementById('savedMobile').textContent = userProfile.mobile;
    document.getElementById('savedMobile').href = `tel:${userProfile.mobile}`;
    if (userProfile.photo) {
      document.getElementById('savedUserPhoto').src = userProfile.photo;
      document.getElementById('savedUserPhoto').style.display = 'block';
    }
    document.getElement Osprey('totalFiles').textContent = files.length;
    document.getElementById('totalProfiles').textContent = profiles.length;
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
    select.innerHTML = '';
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

// Additional helper functions (stubs for brevity)
function toggleSidebar(show) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  sidebar.classList.toggle('active', show);
  overlay?.classList.toggle('active', show);
}

function toggleCriminalFields() {
  document.getElementById('criminalFields').style.display = document.getElementById('caseType').value === 'criminal' ? 'block' : 'none';
}

function toggleCopyAgency() {
  document.getElementById('copyAgencyFields').style.display = document.getElementById('copyAgency').checked ? 'block' : 'none';
}

function handleCardClick(cardId) {
  // Implement dashboard card actions
}

function filterPendingFiles() {
  // Implement pending files filtering
}

function suggestProfiles(value, inputId) {
  // Implement profile suggestions
}

function editProfile(id) {
  // Implement profile editing
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

function importProfiles() {
  // Implement profile import
}

function exportProfiles() {
  // Implement profile export
}

function backupData() {
  // Implement local backup
}

function triggerRestore() {
  document.getElementById('dataRestore').click();
}

function restoreData() {
  // Implement local restore
}

function showShareBackup() {
  restoreFromDrive();
}

function hideShareBackup() {
  document.getElementById('shareBackupModal').style.display = 'none';
}

function shareBackup() {
  // Implement backup sharing
}

function showChangePin() {
  document.getElementById('changePinModal').style.display = 'flex';
}

function hideChangePin() {
  document.getElementById('changePinModal').style.display = 'none';
}

function changePin() {
  // Implement PIN change
}

function showDisclaimerModal() {
  document.getElementById('disclaimerModal').style.display = 'flex';
}

function toggleSaveButton() {
  document.getElementById('saveProfileBtn').disabled = !document.getElementById('agreeTerms').checked;
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
}

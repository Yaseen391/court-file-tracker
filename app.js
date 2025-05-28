// Court File Tracker App Logic
const dbName = 'CourtFileTrackerDB';
let files = JSON.parse(localStorage.getItem(dbName) || '{}');
let profiles = JSON.parse(localStorage.getItem('profiles') || '[]');
let userProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');
let currentScreen = 'admin';
let statsChart = null;
let deferredPrompt = null;
const recordsPerPage = 10;
let currentPage = 1;

// Utility Functions
const showToast = (message, type = 'success') => {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#d32f2f' : '#4caf50';
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 3000);
};

const saveData = () => {
  localStorage.setItem(dbName, JSON.stringify(files));
  localStorage.setItem('profiles', JSON.stringify(profiles));
  localStorage.setItem('userProfile', JSON.stringify(userProfile));
};

const loadData = () => {
  files = JSON.parse(localStorage.getItem(dbName) || '{}');
  profiles = JSON.parse(localStorage.getItem('profiles') || '[]');
  userProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');
};

// Sidebar and Navigation
const toggleSidebar = () => {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('active');
};

const switchScreen = (screenId) => {
  if (!userProfile.clerkName && screenId !== 'admin' && screenId !== 'developersDisclaimer') {
    showToast('Please complete your profile setup first.', 'error');
    screenId = 'admin';
  }
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  document.querySelector(`.sidebar button[data-screen="${screenId}"]`).classList.add('active');
  currentScreen = screenId;
  if (screenId === 'dashboard') updateDashboard();
  if (screenId === 'return') loadPendingFiles();
  if (screenId === 'fileFetcher') loadProfiles();
  if (screenId === 'admin') updateAdminSection();
  toggleSidebar();
};

// PIN Handling
const showPinModal = () => {
  if (!userProfile.pin) return;
  document.getElementById('pinModal').style.display = 'flex';
  document.getElementById('pinInput').focus();
};

const submitPin = () => {
  const pinInput = document.getElementById('pinInput').value;
  if (pinInput === userProfile.pin) {
    document.getElementById('pinModal').style.display = 'none';
    document.getElementById('pinInput').value = '';
  } else {
    showToast('Incorrect PIN.', 'error');
  }
};

// Admin Section
const updateAdminSection = () => {
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
    document.getElementById('totalFiles').textContent = Object.keys(files).length;
    document.getElementById('totalProfiles').textContent = profiles.length;
  } else {
    document.getElementById('setupMessage').style.display = 'block';
    document.getElementById('adminForm').style.display = 'block';
    document.getElementById('savedProfile').style.display = 'none';
  }
};

const handleAdminForm = (e) => {
  e.preventDefault();
  const clerkName = document.getElementById('clerkName').value.trim();
  const judgeName = document.getElementById('judgeName').value.trim();
  const courtName = document.getElementById('courtName').value.trim();
  const mobile = document.getElementById('mobile').value.trim();
  const cnic = document.getElementById('cnic').value.trim();
  const pin = document.getElementById('pin').value.trim();
  const email = document.getElementById('email').value.trim();
  const userPhoto = document.getElementById('userPhoto').files[0];
  const agreeTerms = document.getElementById('agreeTerms').checked;

  if (!agreeTerms) {
    showToast('You must agree to the terms and privacy policy.', 'error');
    return;
  }

  if (!/^\d{5}-\d{7}-\d$/.test(cnic)) {
    showToast('Invalid CNIC format (e.g., 12345-1234567-1).', 'error');
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    showToast('PIN must be 4 digits.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    userProfile = {
      clerkName,
      judgeName,
      courtName,
      mobile,
      cnic,
      pin,
      email,
      photo: reader.result
    };
    saveData();
    updateAdminSection();
    showToast('Profile saved successfully.');
  };
  if (userPhoto) {
    reader.readAsDataURL(userPhoto);
  } else if (userProfile.photo) {
    userProfile = { ...userProfile, clerkName, judgeName, courtName, mobile, cnic, pin, email };
    saveData();
    updateAdminSection();
    showToast('Profile updated successfully.');
  } else {
    showToast('Please upload a photo.', 'error');
  }
};

const editUserProfile = () => {
  document.getElementById('setupMessage').style.display = 'block';
  document.getElementById('adminForm').style.display = 'block';
  document.getElementById('savedProfile').style.display = 'none';
  document.getElementById('clerkName').value = userProfile.clerkName || '';
  document.getElementById('judgeName').value = userProfile.judgeName || '';
  document.getElementById('courtName').value = userProfile.courtName || '';
  document.getElementById('mobile').value = userProfile.mobile || '';
  document.getElementById('cnic').value = userProfile.cnic || '';
  document.getElementById('pin').value = userProfile.pin || '';
  document.getElementById('email').value = userProfile.email || '';
  if (userProfile.photo) {
    document.getElementById('userPhotoPreview').src = userProfile.photo;
    document.getElementById('userPhotoPreview').style.display = 'block';
  }
};

const showChangePin = () => {
  document.getElementById('changePinModal').style.display = 'flex';
  document.getElementById('resetCnic').focus();
};

const changePin = () => {
  const resetCnic = document.getElementById('resetCnic').value.trim();
  const resetPin = document.getElementById('resetPin').value.trim();
  if ((resetCnic === userProfile.cnic || resetCnic === userProfile.email) && /^\d{4}$/.test(resetPin)) {
    userProfile.pin = resetPin;
    saveData();
    document.getElementById('changePinModal').style.display = 'none';
    showToast('PIN changed successfully.');
  } else {
    showToast('Invalid CNIC/Email or PIN.', 'error');
  }
};

const hideChangePin = () => {
  document.getElementById('changePinModal').style.display = 'none';
};

// New File Entry
const handleFileForm = async (e) => {
  e.preventDefault();
  const caseType = document.getElementById('caseType').value;
  const cmsNo = document.getElementById('cmsNo').value;
  const petitioner = document.getElementById('petitioner').value.trim();
  const respondent = document.getElementById('respondent').value.trim();
  const nature = document.getElementById('nature').value.trim();
  const firNo = document.getElementById('firNo').value.trim();
  const firYear = document.getElementById('firYear').value.trim();
  const firUs = document.getElementById('firUs').value.trim();
  const policeStation = document.getElementById('policeStation').value.trim();
  const dateType = document.getElementById('dateType').value;
  const date = document.getElementById('date').value;
  const deliveredTo = document.getElementById('deliveredTo').value.trim();
  const deliveredType = document.getElementById('deliveredType').value;
  const copyAgency = document.getElementById('copyAgency').checked;
  const swalFormNo = document.getElementById('swalFormNo').value;
  const swalDate = document.getElementById('swalDate').value;

  if (files[cmsNo]) {
    showToast('CMS No already exists.', 'error');
    return;
  }

  files[cmsNo] = {
    caseType,
    title: `${petitioner} Vs. ${respondent}`,
    nature,
    criminalDetails: caseType === 'criminal' ? { firNo, firYear, firUs, policeStation } : {},
    dateType,
    date,
    deliveredTo,
    deliveredType,
    deliveryDate: new Date().toISOString().split('T')[0],
    copyAgency: copyAgency ? { swalFormNo, swalDate } : null,
    court: userProfile.courtName,
    clerkName: userProfile.clerkName
  };
  saveData();
  document.getElementById('fileForm').reset();
  document.getElementById('criminalFields').style.display = 'none';
  document.getElementById('copyAgencyFields').style.display = 'none';
  showToast('File saved and delivered.');
};

// Return File
const loadPendingFiles = () => {
  const tableBody = document.querySelector('#pendingFilesTable tbody');
  tableBody.innerHTML = '';
  Object.entries(files).forEach(([cmsNo, file]) => {
    if (!file.returnDate) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input type="checkbox" class="select-file" data-cms="${cmsNo}"></td>
        <td>${cmsNo}</td>
        <td>${file.title}</td>
        <td>${file.caseType}</td>
        <td>${file.deliveredTo}</td>
        <td><button onclick="returnFile('${cmsNo}')">Return</button></td>
      `;
      tableBody.appendChild(row);
    }
  });
};

const returnFile = (cmsNo) => {
  files[cmsNo].returnDate = new Date().toISOString().split('T')[0];
  saveData();
  loadPendingFiles();
  showToast('File returned.');
};

const bulkReturnFiles = () => {
  const selected = document.querySelectorAll('.select-file:checked');
  selected.forEach(checkbox => {
    const cmsNo = checkbox.dataset.cms;
    files[cmsNo].returnDate = new Date().toISOString().split('T')[0];
  });
  saveData();
  loadPendingFiles();
  showToast('Selected files returned.');
};

// File Fetcher
const showProfileForm = () => {
  document.getElementById('profileForm').style.display = 'block';
  document.getElementById('profileSearchSection').style.display = 'none';
  document.getElementById('profileList').style.display = 'none';
};

const showProfileSearch = () => {
  document.getElementById('profileForm').style.display = 'none';
  document.getElementById('profileSearchSection').style.display = 'block';
  document.getElementById('profileList').style.display = 'block';
  loadProfiles();
};

const loadProfiles = () => {
  const tableBody = document.querySelector('#profileTable tbody');
  tableBody.innerHTML = '';
  const filterType = document.getElementById('profileFilterType').value;
  const searchQuery = document.getElementById('profileSearch').value.toLowerCase();
  profiles
    .filter(profile => !filterType || profile.type === filterType)
    .filter(profile => !searchQuery || profile.name.toLowerCase().includes(searchQuery) || profile.cellNo.includes(searchQuery))
    .forEach(profile => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><img src="${profile.photo || 'icon-192.png'}" style="width:40px;height:40px;border-radius:50%;" alt="Profile Photo"></td>
        <td>${profile.name}</td>
        <td>${profile.type}</td>
        <td>${profile.cellNo}</td>
        <td>${profile.chamberNo || '-'}</td>
        <td>${profile.filesDelivered || 0}</td>
        <td>${profile.pendingFiles || 0}</td>
        <td>
          <button onclick="editProfile('${profile.id}')">Edit</button>
          <button onclick="deleteProfile('${profile.id}')">Delete</button>
          <button onclick="showProfileDetails('${profile.id}')">View</button>
        </td>
      `;
      tableBody.appendChild(row);
    });
};

const handleProfileForm = (e) => {
  e.preventDefault();
  const profileType = document.getElementById('profileType').value;
  const name = document.getElementById('profileName').value.trim();
  const cellNo = document.getElementById('profileCellNo').value.trim();
  const chamberNo = document.getElementById('profileChamberNo').value.trim();
  const photo = document.getElementById('profilePhoto').files[0];
  const id = document.getElementById('profileId').value || Date.now().toString();

  const reader = new FileReader();
  reader.onload = () => {
    const profile = {
      id,
      type: profileType,
      name,
      cellNo,
      chamberNo,
      photo: reader.result,
      filesDelivered: 0,
      pendingFiles: 0
    };
    const index = profiles.findIndex(p => p.id === id);
    if (index !== -1) {
      profiles[index] = profile;
    } else {
      profiles.push(profile);
    }
    saveData();
    document.getElementById('profileForm').reset();
    document.getElementById('profileForm').style.display = 'none';
    showProfileSearch();
    showToast('Profile saved.');
  };
  if (photo) {
    reader.readAsDataURL(photo);
  } else {
    const existing = profiles.find(p => p.id === id);
    if (existing && existing.photo) {
      const profile = {
        id,
        type: profileType,
        name,
        cellNo,
        chamberNo,
        photo: existing.photo,
        filesDelivered: existing.filesDelivered,
        pendingFiles: existing.pendingFiles
      };
      const index = profiles.findIndex(p => p.id === id);
      if (index !== -1) {
        profiles[index] = profile;
      } else {
        profiles.push(profile);
      }
      saveData();
      document.getElementById('profileForm').reset();
      document.getElementById('profileForm').style.display = 'none';
      showProfileSearch();
      showToast('Profile updated.');
    } else {
      showToast('Please upload a photo.', 'error');
    }
  }
};

const editProfile = (id) => {
  const profile = profiles.find(p => p.id === id);
  if (profile) {
    document.getElementById('profileForm').style.display = 'block';
    document.getElementById('profileSearchSection').style.display = 'none';
    document.getElementById('profileList').style.display = 'none';
    document.getElementById('profileType').value = profile.type;
    document.getElementById('profileName').value = profile.name;
    document.getElementById('profileCellNo').value = profile.cellNo;
    document.getElementById('profileChamberNo').value = profile.chamberNo;
    document.getElementById('profileId').value = profile.id;
    if (profile.photo) {
      document.getElementById('photoPreview').src = profile.photo;
      document.getElementById('photoPreview').style.display = 'block';
    }
  }
};

const deleteProfile = (id) => {
  profiles = profiles.filter(p => p.id !== id);
  saveData();
  loadProfiles();
  showToast('Profile deleted.');
};

const showProfileDetails = (id) => {
  const profile = profiles.find(p => p.id === id);
  if (profile) {
    document.getElementById('profileModal').style.display = 'flex';
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
      <tr><th>Files Delivered</th><td>${profile.filesDelivered || 0}</td></tr>
      <tr><th>Pending Files</th><td>${profile.pendingFiles || 0}</td></tr>
    `;
  }
};

const closeProfileModal = () => {
  document.getElementById('profileModal').style.display = 'none';
};

// Dashboard
const updateDashboard = () => {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  let deliveries = 0, returns = 0, pending = 0, tomorrowHearings = 0, overdue = 0;

  Object.values(files).forEach(file => {
    if (file.deliveryDate === today) deliveries++;
    if (file.returnDate === today) returns++;
    if (!file.returnDate) pending++;
    if (file.date === tomorrow && file.dateType === 'hearing') tomorrowHearings++;
    if (!file.returnDate && (Date.now() - new Date(file.deliveryDate)) > 10 * 86400000) overdue++;
  });

  document.getElementById('cardDeliveries').innerHTML = `Files Delivered Today<br><strong>${deliveries}</strong><span class="tooltip">Files delivered today</span>`;
  document.getElementById('cardReturns').innerHTML = `Files Returned Today<br><strong>${returns}</strong><span class="tooltip">Files returned today</span>`;
  document.getElementById('cardPending').innerHTML = `Pending Files<br><strong>${pending}</strong><span class="tooltip">Files not yet returned</span>`;
  document.getElementById('cardTomorrow').innerHTML = `Tomorrow's Hearings<br><strong>${tomorrowHearings}</strong><span class="tooltip">Hearings scheduled for tomorrow</span>`;
  document.getElementById('cardOverdue').innerHTML = `Overdue Files (>10 days)<br><strong>${overdue}</strong><span class="tooltip">Files pending over 10 days</span>`;

  if (statsChart) statsChart.destroy();
  statsChart = new Chart(document.getElementById('statsChart'), {
    type: 'bar',
    data: {
      labels: ['Delivered', 'Returned', 'Pending', 'Tomorrow', 'Overdue'],
      datasets: [{
        label: 'File Stats',
        data: [deliveries, returns, pending, tomorrowHearings, overdue],
        backgroundColor: ['#0288d1', '#4caf50', '#d32f2f', '#fb8c00', '#7b1fa2']
      }]
    },
    options: { scales: { y: { beginAtZero: true } } }
  });
};

// Data Management
const backupData = () => {
  const data = { files, profiles, userProfile };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cft-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup saved locally.');
};

const triggerRestore = () => {
  document.getElementById('dataRestore').click();
};

const handleRestore = (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        files = data.files || {};
        profiles = data.profiles || [];
        userProfile = data.userProfile || {};
        saveData();
        updateAdminSection();
        showToast('Data restored successfully.');
      } catch {
        showToast('Invalid backup file.', 'error');
      }
    };
    reader.readAsText(file);
  }
};

const resetApp = () => {
  if (confirm('Are you sure you want to reset all data? This cannot be undone.')) {
    localStorage.clear();
    files = {};
    profiles = [];
    userProfile = {};
    saveData();
    updateAdminSection();
    showToast('App reset successfully.');
  }
};

// PWA Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('installBtn').style.display = 'block';
});

document.getElementById('installBtn').addEventListener('click', () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      deferredPrompt = null;
      document.getElementById('installBtn').style.display = 'none';
    });
  }
});

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  updateAdminSection();
  showPinModal();

  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
  document.querySelectorAll('.sidebar button').forEach(btn => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });

  document.getElementById('adminForm').addEventListener('submit', handleAdminForm);
  document.getElementById('pinInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitPin();
  });

  document.getElementById('caseType').addEventListener('change', (e) => {
    document.getElementById('criminalFields').style.display = e.target.value === 'criminal' ? 'block' : 'none';
  });

  document.getElementById('copyAgency').addEventListener('change', (e) => {
    document.getElementById('copyAgencyFields').style.display = e.target.checked ? 'block' : 'none';
  });

  document.getElementById('fileForm').addEventListener('submit', handleFileForm);
  document.getElementById('dataRestore').addEventListener('change', handleRestore);

  document.getElementById('profileForm').addEventListener('submit', handleProfileForm);
  document.getElementById('profileFilterType').addEventListener('change', loadProfiles);
  document.getElementById('profileSearch').addEventListener('input', debounce(loadProfiles, 300));
});

// Debounce Utility
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

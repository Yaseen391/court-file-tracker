// Global Variables
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
let deferredPrompt;
let backupFolderHandle = null; // Store folder handle for backups

// IndexedDB Setup
const dbName = 'CourtFileTrackerDB';
const dbVersion = 2; // Updated version for new folder store
let db;

function initIndexedDB() {
  const request = indexedDB.open(dbName, dbVersion);
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('data')) {
      db.createObjectStore('data', { keyPath: 'key' });
    }
    if (!db.objectStoreNames.contains('folder')) {
      db.createObjectStore('folder', { keyPath: 'id' }); // New store for folder handle
    }
  };
  request.onsuccess = (event) => {
    db = event.target.result;
    syncLocalStorageToIndexedDB();
    initializeApp(); // Call to check and load backup folder
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

async function loadBackupFolder() {
  const transaction = db.transaction(['folder'], 'readonly');
  const store = transaction.objectStore('folder');
  const request = store.get('backupFolder');
  request.onsuccess = async () => {
    if (request.result && request.result.handle) {
      try {
        // Only query permission, do not request it
        const permission = await request.result.handle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          backupFolderHandle = request.result.handle;
        } else {
          console.warn('Folder permission not granted. Ask user to reselect.');
          backupFolderHandle = null;
        }
      } catch (error) {
        console.error('Error loading backup folder:', error);
        backupFolderHandle = null;
      }
    }
  };
  request.onerror = () => {
    console.error('Error accessing backup folder store');
    backupFolderHandle = null;
  };
}

async function selectBackupFolder() {
  try {
    if ('showDirectoryPicker' in window) {
      const folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const permission = await folderHandle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        backupFolderHandle = folderHandle;
        const transaction = db.transaction(['folder'], 'readwrite');
        const store = transaction.objectStore('folder');
        store.put({ id: 'backupFolder', handle: folderHandle });
        showToast('Backup folder selected successfully');
        document.getElementById('selectFolderBtn').classList.add('hidden'); // Hide button after selection
        document.getElementById('backupFolderModal').style.display = 'none'; // Close modal
      } else {
        showToast('Permission to access folder denied');
      }
    } else {
      showToast('File System Access API not supported in this browser');
    }
  } catch (error) {
    console.error('Error selecting backup folder:', error);
    showToast('Failed to select backup folder');
  }
}

async function initializeApp() {
  await loadBackupFolder();
  const transaction = db.transaction(['folder'], 'readonly');
  const store = transaction.objectStore('folder');
  const request = store.get('backupFolder');
  request.onsuccess = () => {
    if (!request.result || !backupFolderHandle) {
      // Show button if no valid backup folder is set
      document.getElementById('selectFolderBtn').classList.remove('hidden');
    } else {
      // Ensure button stays hidden if folder is already set
      document.getElementById('selectFolderBtn').classList.add('hidden');
    }
  };
  request.onerror = () => {
    console.error('Error checking backup folder on init');
    document.getElementById('selectFolderBtn').classList.remove('hidden');
  };
}

async function performDailyBackup() {
  if (!backupFolderHandle) {
    console.warn('No backup folder selected for backup');
    return;
  }
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const dailyFiles = files.filter(f => new Date(f.deliveredAt).toLocaleDateString('en-CA') === today);
    const data = { files: dailyFiles, profiles, analytics };
    const timestamp = formatDate(new Date(), 'YYYYMMDD_HHMMSS');
    const fileName = `backup_${timestamp}.json`;
    const fileHandle = await backupFolderHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    analytics.backupsCreated++;
    localStorage.setItem('analytics', JSON.stringify(analytics));
    syncLocalStorageToIndexedDB();
  } catch (error) {
    console.error('Daily backup error:', error);
  }
}

function scheduleDailyBackup() {
  performDailyBackup(); // Run immediately
  setInterval(performDailyBackup, 60 * 60 * 1000); // Every hour
}

function maskCNIC(cnic) {
  if (!cnic) return '';
  const parts = cnic.split('-');
  if (parts.length !== 3) return '*****-*******-*';
  return `${parts[0].slice(0, 2)}***-${parts[1].slice(0, 3)}****-${parts[2]}`;
}

window.onload = () => {
  console.log('app.js loaded successfully');
  initIndexedDB();
  if (userProfile) {
    document.getElementById('setupMessage').style.display = 'none';
    document.getElementById('adminForm').style.display = 'none';
    document.getElementById('savedProfile').style.display = 'block';
    updateSavedProfile();
    navigate('dashboard');
  } else {
    navigate('admin');
  }
  document.getElementById('agreeTerms').addEventListener('change', toggleSaveButton);
  updateDashboardCards();
  setupPushNotifications();
  setupPhotoAdjust('userPhoto', 'userPhotoPreview', 'userPhotoAdjust');
  setupPhotoAdjust('profilePhoto', 'photoPreview', 'photoAdjust');
  scheduleDailyBackup();

  // Add touch and click event listeners for sidebar overlay
  const overlay = document.querySelector('.sidebar-overlay');
  overlay.addEventListener('touchstart', (e) => {
    e.preventDefault();
    toggleSidebar();
  });
  overlay.addEventListener('click', (e) => {
    e.preventDefault();
    toggleSidebar();
  });

  // Handle back button to close sidebar
  window.addEventListener('popstate', () => {
    if (document.getElementById('sidebar').classList.contains('active')) {
      toggleSidebar();
    }
  });

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
  if (!userProfile) {
    showToast('Please complete admin setup first');
    document.getElementById('admin').classList.add('active');
    return;
  }
  if (!backupFolderHandle && screenId !== 'admin') {
    showToast('Please select a backup folder first');
    document.getElementById('backupFolderModal').style.display = 'block';
    document.getElementById('admin').classList.add('active');
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
  document.getElementById��('loadingIndicator').style.display = 'block';
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
        showToast('Profile saved successfully! Please select a backup folder.');
        document.getElementById('loadingIndicator').style.display = 'none';
        // Show folder selection button after admin setup
        document.getElementById('selectFolderBtn').classList.remove('hidden');
        document.getElementById('backupFolderModal').style.display = 'block';
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
  if (format === 'YYYYMMDD') {
    return `${year}${month}${day}`;
  }
  if (format === 'YYYYMMDD_HHMMSS') {
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  }
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
  a.href = url;
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

      // Merge files
      if (data.files) {
        data.files.forEach(newFile => {
          const existingIndex = files.findIndex(f => f.cmsNo === newFile.cmsNo);
          if (existingIndex === -1) {
            files.push(newFile);
          } else {
            if (new Date(newFile.deliveredAt) > new Date(files[existingIndex].deliveredAt)) {
              files[existingIndex] = newFile;
            }
          }
        });
      }

      // Merge profiles
      if (data.profiles) {
        data.profiles.forEach(newProfile => {
          const existingIndex = profiles.findIndex(p => p.name === newProfile.name && p.type === newProfile.type);
          if (existingIndex === -1) {
            profiles.push(newProfile);
          } else {
            profiles[existingIndex] = { ...profiles[existingIndex], ...newProfile };
          }
        });
      }

      // Update userProfile (preserve PIN)
      if (data.userProfile) {
        userProfile = { ...userProfile, ...data.userProfile, pin: userProfile.pin };
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
      }

      // Merge analytics
      if (data.analytics) {
        analytics = { ...analytics, ...data.analytics };
        localStorage.setItem('analytics', JSON.stringify(analytics));
      }

      localStorage.setItem('files', JSON.stringify(files));
      localStorage.setItem('profiles', JSON.stringify(profiles));
      syncLocalStorageToIndexedDB();
      showToast('Data restored and merged successfully');
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
      backupFolderHandle = null;
      analytics = { filesEntered: 0, searchesPerformed: 0, backupsCreated: 0 };
      localStorage.clear();
      const transaction = db.transaction(['data', 'folder'], 'readwrite');
      transaction.objectStore('data').clear();
      transaction.objectStore('folder').clear();
      showToast('App reset successfully');
      navigate('admin');
      document.getElementById('setupMessage').style.display = 'block';
      document.getElementById('adminForm').style.display = 'block';
      document.getElementById('savedProfile').style.display = 'none';
      document.getElementById('selectFolderBtn').classList.remove('hidden'); // Show button again after reset
    }
  });
}

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
      labels: ['Files Delivered', 'Searches Performed', 'Backups Created'],
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

// Handle Online/Offline Status
window.addEventListener('online', () => {
  showToast('You are now online');
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
  if (type === 'cnic') {
    const cnicRegex = /^\d{5}-\d{7}-\d{1}$/;
    return cnicRegex.test(input);
  } else if (type === 'mobile') {
    const mobileRegex = /^\+?\d{10,12}$/;
    return mobileRegex.test(input);
  } else if (type === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(input);
  } else if (type === 'pin') {
    return input.length >= 4 && input.length <= 8;
  }
  return true; // Default to true for other types
}

// Event Listeners for Form Inputs
document.getElementById('cnic').addEventListener('input', (e) => {
  if (!validateInput(e.target.value, 'cnic')) {
    e.target.setCustomValidity('Please enter a valid CNIC (e.g., 12345-1234567-1)');
  } else {
    e.target.setCustomValidity('');
  }
});

document.getElementById('mobile').addEventListener('input', (e) => {
  if (!validateInput(e.target.value, 'mobile')) {
    e.target.setCustomValidity('Please enter a valid mobile number (10-12 digits)');
  } else {
    e.target.setCustomValidity('');
  }
});

document.getElementById('email').addEventListener('input', (e) => {
  if (!validateInput(e.target.value, 'email')) {
    e.target.setCustomValidity('Please enter a valid email address');
  } else {
    e.target.setCustomValidity('');
  }
});

document.getElementById('pin').addEventListener('input', (e) => {
  if (!validateInput(e.target.value, 'pin')) {
    e.target.setCustomValidity('PIN must be 4-8 characters long');
  } else {
    e.target.setCustomValidity('');
  }
});

// Backup Folder Selection Button Listener
document.getElementById('selectFolderBtn').addEventListener('click', () => {
  selectBackupFolder();
});

// Modal Close Listeners
document.getElementById('disclaimerModal').addEventListener('click', (e) => {
  closeModalIfOutside(e, 'disclaimerModal');
});

document.getElementById('pinModal').addEventListener('click', (e) => {
  closeModalIfOutside(e, 'pinModal');
});

document.getElementById('changePinModal').addEventListener('click', (e) => {
  closeModalIfOutside(e, 'changePinModal');
});

document.getElementById('backupFolderModal').addEventListener('click', (e) => {
  closeModalIfOutside(e, 'backupFolderModal');
});

// Toast Notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  }, 100);
}

// Auto-fill and Suggestions for File Form
document.getElementById('cmsNo').addEventListener('input', autoFillCMS);
document.getElementById('caseType').addEventListener('change', toggleCriminalFields);
document.getElementById('copyAgency').addEventListener('change', toggleCopyAgency);
document.getElementById('deliveredTo').addEventListener('input', (e) => {
  suggestProfiles(e.target.value, 'deliveredTo');
});

// Profile Search Suggestions
document.getElementById('searchFileTaker').addEventListener('input', (e) => {
  suggestProfiles(e.target.value, 'searchFileTaker');
});

// Return File Filters
document.getElementById('returnCms').addEventListener('input', filterPendingFiles);
document.getElementById('returnTitle').addEventListener('input', filterPendingFiles);

// Profile Filters
document.getElementById('profileFilterType').addEventListener('change', renderProfiles);
document.getElementById('profileSearch').addEventListener('input', renderProfiles);

// Profile Type Change
document.getElementById('profileType').addEventListener('change', toggleProfileFields);

// Bulk Return Button
document.getElementById('bulkReturnBtn').addEventListener('click', bulkReturnFiles);

// Dashboard Search Button
document.getElementById('searchPrevBtn').addEventListener('click', performDashboardSearch);

// Export Buttons
document.getElementById('exportCsvBtn').addEventListener('click', () => exportDashboardReport('csv'));
document.getElementById('exportPdfBtn').addEventListener('click', () => exportDashboardReport('pdf'));

// Print Button
document.getElementById('printReportBtn').addEventListener('click', printDashboardReport);

// Backup and Restore Buttons
document.getElementById('backupBtn').addEventListener('click', backupData);
document.getElementById('restoreBtn').addEventListener('click', triggerRestore);
document.getElementById('dataRestore').addEventListener('change', restoreData);

// Reset App Button
document.getElementById('resetBtn').addEventListener('click', resetApp);

// Import/Export Profiles
document.getElementById('importProfileBtn').addEventListener('click', triggerImport);
document.getElementById('exportProfileBtn').addEventListener('click', exportProfiles);
document.getElementById('profileImport').addEventListener('change', importProfiles);

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(registration => {
      console.log('Service Worker registered with scope:', registration.scope);
    }).catch(error => {
      console.error('Service Worker registration failed:', error);
    });
  });
}

// Handle visibility change for performance
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    console.log('App is in background');
  } else {
    console.log('App is in foreground');
    updateDashboardCards();
  }
});

// Ensure sidebar closes on resize
window.addEventListener('resize', () => {
  if (window.innerWidth > 768 && document.getElementById('sidebar').classList.contains('active')) {
    toggleSidebar();
  }
});

// CSS for Toast
const style = document.createElement('style');
style.textContent = `
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #333;
    color: #fff;
    padding: 10px 20px;
    border-radius: 5px;
    opacity: 0;
    transition: opacity 0.3s ease;
    z-index: 1000;
  }
  .toast.show {
    opacity: 1;
  }
  .sidebar-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 998;
    display: none;
  }
  .sidebar-overlay.active {
    display: block;
  }
`;
document.head.appendChild(style);

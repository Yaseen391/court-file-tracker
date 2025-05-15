// Court File Tracker App Logic
// Version: 1.0.1
// Last Updated: May 15, 2025

// Global variables
let tokenClient;
let cropper;
let userCropper;
let currentProfile = null;
let profiles = [];
let files = [];
let userProfile = null;
const RECORDS_PER_PAGE = 10;

// Initialize app on load
window.onload = function() {
  initGoogleAPI();
  loadUserProfile();
  loadProfiles();
  loadFiles();
  updateDashboardCards();
  // Register event listeners
  document.getElementById('fileForm').addEventListener('submit', saveFile);
  document.getElementById('returnForm').addEventListener('submit', filterPendingFiles);
  document.getElementById('adminForm').addEventListener('submit', saveUserProfile);
  document.getElementById('profileForm').addEventListener('submit', saveProfile);
};

/**
 * Initializes Google API client and Identity Services for Drive and authentication.
 * @throws {Error} If API initialization fails.
 */
function initGoogleAPI() {
  gapi.load('client', () => {
    gapi.client.init({
      apiKey: 'AIzaSyCmYFpMXEtPdfSg4-K7lgdqNc-njgqONmQ',
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
    }).then(() => {
      console.log('Google API initialized successfully');
      // Initialize Google Identity Services
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: '1022877727253-vlif6k2sstl4gn98e8svsh8mhd3j0gl3.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            gapi.client.setToken({ access_token: tokenResponse.access_token });
            console.log('Access token acquired');
            Swal.fire({
              icon: 'success',
              title: 'Signed In',
              text: 'Successfully signed in with Google!',
              toast: true,
              position: 'bottom-end',
              showConfirmButton: false,
              timer: 3000
            });
            document.getElementById('backupToDrive').style.display = 'inline-block';
            document.getElementById('restoreFromDrive').style.display = 'inline-block';
            document.getElementById('shareBackup').style.display = 'inline-block';
          } else {
            console.error('Failed to acquire access token');
            Swal.fire({
              icon: 'error',
              title: 'Sign-In Failed',
              text: 'Unable to sign in with Google. Please try again.',
              toast: true,
              position: 'bottom-end',
              showConfirmButton: false,
              timer: 3000
            });
          }
        }
      });
    }).catch(error => {
      console.error('Google API initialization error:', error);
      Swal.fire({
        icon: 'error',
        title: 'API Error',
        text: 'Failed to initialize Google Drive API. Using local storage.',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    });
  });
}

/**
 * Signs in with Google using OAuth 2.0.
 */
function signInWithGoogle() {
  if (tokenClient) {
    tokenClient.requestAccessToken();
  } else {
    console.error('Token client not initialized');
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Please try again after the application is fully loaded.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
  }
}

/**
 * Updates dashboard cards with statistics and chart.
 */
function updateDashboardCards() {
  const ctx = document.getElementById('statsChart').getContext('2d');
  // Destroy existing chart instance if it exists
  const existingChart = Chart.getChart('statsChart');
  if (existingChart) {
    existingChart.destroy();
  }
  // Create new chart
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Pending', 'In Progress', 'Completed'],
      datasets: [{
        label: 'Case Status',
        data: [files.filter(f => f.status === 'pending').length, 
               files.filter(f => f.status === 'in_progress').length, 
               files.filter(f => f.status === 'completed').length],
        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56']
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true }
      },
      plugins: {
        legend: { display: true },
        title: { display: true, text: 'Case Status Overview' }
      }
    }
  });

  // Update card counts
  document.getElementById('cardDeliveries').innerHTML = `<h3>${files.filter(f => new Date(f.deliveryDate).toDateString() === new Date().toDateString()).length}</h3><p>Files Delivered Today</p>`;
  document.getElementById('cardReturns').innerHTML = `<h3>${files.filter(f => f.returnDate && new Date(f.returnDate).toDateString() === new Date().toDateString()).length}</h3><p>Files Returned Today</p>`;
  document.getElementById('cardPending').innerHTML = `<h3>${files.filter(f => f.status === 'pending').length}</h3><p>Files Not Yet Returned</p>`;
  document.getElementById('cardTomorrow').innerHTML = `<h3>${files.filter(f => f.date && new Date(f.date).toDateString() === new Date(Date.now() + 86400000).toDateString()).length}</h3><p>Hearings Tomorrow</p>`;
  document.getElementById('cardOverdue').innerHTML = `<h3>${files.filter(f => f.status === 'pending' && (Date.now() - new Date(f.deliveryDate).getTime()) / 86400000 > 10).length}</h3><p>Overdue Files</p>`;
}

/**
 * Loads user profile from local storage or Google Drive.
 */
function loadUserProfile() {
  const savedProfile = localStorage.getItem('userProfile');
  if (savedProfile) {
    userProfile = JSON.parse(savedProfile);
    renderUserProfile();
  } else {
    document.getElementById('adminForm').style.display = 'block';
    document.getElementById('setupMessage').style.display = 'block';
  }
}

/**
 * Loads profiles from local storage or Google Drive.
 */
function loadProfiles() {
  // Load from local storage
  const keys = Object.keys(localStorage).filter(k => k.startsWith('profile_'));
  profiles = keys.map(k => JSON.parse(localStorage.getItem(k))).filter(p => p);
  renderProfiles();
}

/**
 * Loads files from local storage or Google Drive.
 */
function loadFiles() {
  // Load from local storage
  const keys = Object.keys(localStorage).filter(k => k.startsWith('file_'));
  files = keys.map(k => JSON.parse(localStorage.getItem(k))).filter(f => f);
  filterPendingFiles();
}

/**
 * Saves user profile with photo.
 * @param {Event} e - Form submission event.
 */
function saveUserProfile(e) {
  e.preventDefault();
  const loading = document.getElementById('loadingIndicator');
  loading.style.display = 'flex';
  
  const profile = {
    clerkName: DOMPurify.sanitize(document.getElementById('clerkName').value),
    judgeName: DOMPurify.sanitize(document.getElementById('judgeName').value),
    courtName: DOMPurify.sanitize(document.getElementById('courtName').value),
    mobile: DOMPurify.sanitize(document.getElementById('mobile').value),
    cnic: DOMPurify.sanitize(document.getElementById('cnic').value),
    pin: DOMPurify.sanitize(document.getElementById('pin').value),
    email: DOMPurify.sanitize(document.getElementById('email').value),
    photo: document.getElementById('savedUserPhoto').src || ''
  };

  userProfile = profile;
  localStorage.setItem('userProfile', JSON.stringify(profile));
  saveToGoogleDrive(new Blob([JSON.stringify(profile)], { type: 'application/json' }), 'user_profile.json', () => {
    loading.style.display = 'none';
    Swal.fire({
      icon: 'success',
      title: 'Profile Saved',
      text: 'User profile saved successfully!',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
    renderUserProfile();
  });
}

/**
 * Saves profile with photo.
 * @param {Event} e - Form submission event.
 */
function saveProfile(e) {
  e.preventDefault();
  const loading = document.getElementById('loadingIndicator');
  loading.style.display = 'flex';

  const profile = {
    id: currentProfile ? currentProfile.id : Date.now(),
    type: DOMPurify.sanitize(document.getElementById('profileType').value),
    name: DOMPurify.sanitize(document.getElementById('profileName')?.value || ''),
    cellNo: DOMPurify.sanitize(document.getElementById('profileCellNo')?.value || ''),
    chamberNo: DOMPurify.sanitize(document.getElementById('profileChamberNo')?.value || ''),
    photo: document.getElementById('profilePhotoPreview')?.src || ''
  };

  profiles = profiles.filter(p => p.id !== profile.id);
  profiles.push(profile);
  localStorage.setItem('profile_' + profile.id, JSON.stringify(profile));
  saveToGoogleDrive(new Blob([JSON.stringify(profile)], { type: 'application/json' }), `profile_${profile.id}.json`, () => {
    loading.style.display = 'none';
    Swal.fire({
      icon: 'success',
      title: 'Profile Saved',
      text: 'Profile saved successfully!',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
    renderProfiles();
    document.getElementById('profileForm').style.display = 'none';
    currentProfile = null;
  });
}

/**
 * Saves file data.
 * @param {Event} e - Form submission event.
 */
function saveFile(e) {
  e.preventDefault();
  const loading = document.getElementById('loadingIndicator');
  loading.style.display = 'flex';

  const file = {
    id: Date.now(),
    caseType: DOMPurify.sanitize(document.getElementById('caseType').value),
    cmsNo: DOMPurify.sanitize(document.getElementById('cmsNo').value),
    petitioner: DOMPurify.sanitize(document.getElementById('petitioner').value),
    respondent: DOMPurify.sanitize(document.getElementById('respondent').value),
    nature: DOMPurify.sanitize(document.getElementById('nature').value),
    firNo: DOMPurify.sanitize(document.getElementById('firNo').value || ''),
    firYear: DOMPurify.sanitize(document.getElementById('firYear').value || ''),
    firUs: DOMPurify.sanitize(document.getElementById('firUs').value || ''),
    policeStation: DOMPurify.sanitize(document.getElementById('policeStation').value || ''),
    dateType: DOMPurify.sanitize(document.getElementById('dateType').value),
    date: DOMPurify.sanitize(document.getElementById('date').value),
    deliveredTo: DOMPurify.sanitize(document.getElementById('deliveredTo').value),
    deliveredType: DOMPurify.sanitize(document.getElementById('deliveredType').value),
    copyAgency: document.getElementById('copyAgency').checked,
    swalFormNo: DOMPurify.sanitize(document.getElementById('swalFormNo')?.value || ''),
    swalDate: DOMPurify.sanitize(document.getElementById('swalDate')?.value || ''),
    deliveryDate: new Date().toISOString(),
    status: 'pending'
  };

  files.push(file);
  localStorage.setItem('file_' + file.id, JSON.stringify(file));
  saveToGoogleDrive(new Blob([JSON.stringify(file)], { type: 'application/json' }), `file_${file.id}.json`, () => {
    loading.style.display = 'none';
    Swal.fire({
      icon: 'success',
      title: 'File Saved',
      text: 'File entry saved and delivered!',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
    document.getElementById('fileForm').reset();
    updateDashboardCards();
  });
}

/**
 * Handles profile photo upload and initializes cropper.
 * @param {Event} event - File input change event.
 */
function handleProfilePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file || !file.type.startsWith('image/')) {
    console.error('Invalid file selected');
    Swal.fire({
      icon: 'error',
      title: 'Invalid File',
      text: 'Please select a valid image file.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.getElementById('cropperCanvas');
      canvas.width = 300;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      if (cropper) {
        cropper.destroy();
      }
      cropper = new Cropper(canvas, {
        aspectRatio: 1,
        viewMode: 1,
        movable: true,
        zoomable: true,
        scalable: false,
        cropBoxMovable: false,
        cropBoxResizable: false,
        ready: function() {
          cropper.setCropBoxData({ width: 200, height: 200 });
        }
      });
      document.getElementById('photoCropper').style.display = 'block';
    };
    img.src = e.target.result;
  };
  reader.onerror = function(error) {
    console.error('FileReader error:', error);
    Swal.fire({
      icon: 'error',
      title: 'File Error',
      text: 'Failed to read the file. Please try again.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
  };
  reader.readAsDataURL(file);
}

/**
 * Handles user photo upload and initializes cropper.
 * @param {Event} event - File input change event.
 */
function handleUserPhotoUpload(event) {
  const file = event.target.files[0];
  if (!file || !file.type.startsWith('image/')) {
    console.error('Invalid file selected');
    Swal.fire({
      icon: 'error',
      title: 'Invalid File',
      text: 'Please select a valid image file.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.getElementById('userCropperCanvas');
      canvas.width = 300;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      if (userCropper) {
        userCropper.destroy();
      }
      userCropper = new Cropper(canvas, {
        aspectRatio: 1,
        viewMode: 1,
        movable: true,
        zoomable: true,
        scalable: false,
        cropBoxMovable: false,
        cropBoxResizable: false,
        ready: function() {
          userCropper.setCropBoxData({ width: 200, height: 200 });
        }
      });
      document.getElementById('userPhotoCropper').style.display = 'block';
    };
    img.src = e.target.result;
  };
  reader.onerror = function(error) {
    console.error('FileReader error:', error);
    Swal.fire({
      icon: 'error',
      title: 'File Error',
      text: 'Failed to read the file. Please try again.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
  };
  reader.readAsDataURL(file);
}

/**
 * Saves cropped profile photo.
 */
function saveCroppedProfilePhoto() {
  if (!cropper) {
    console.error('Cropper not initialized');
    return;
  }
  const croppedCanvas = cropper.getCroppedCanvas({ width: 200, height: 200 });
  croppedCanvas.toBlob(blob => {
    const reader = new FileReader();
    reader.onload = function() {
      const img = document.createElement('img');
      img.id = 'profilePhotoPreview';
      img.src = reader.result;
      img.style.width = '100px';
      img.style.height = '100px';
      img.style.borderRadius = '50%';
      document.getElementById('photoCropper').appendChild(img);
      saveToGoogleDrive(blob, `profile_photo_${Date.now()}.png`, () => {
        document.getElementById('photoCropper').style.display = 'none';
        cropper.destroy();
        cropper = null;
        Swal.fire({
          icon: 'success',
          title: 'Photo Saved',
          text: 'Profile photo cropped and saved!',
          toast: true,
          position: 'bottom-end',
          showConfirmButton: false,
          timer: 3000
        });
      });
    };
    reader.readAsDataURL(blob);
  }, 'image/png', 0.8); // Compress image
}

/**
 * Saves cropped user photo.
 */
function saveCroppedUserPhoto() {
  if (!userCropper) {
    console.error('Cropper not initialized');
    return;
  }
  const croppedCanvas = userCropper.getCroppedCanvas({ width: 200, height: 200 });
  croppedCanvas.toBlob(blob => {
    const reader = new FileReader();
    reader.onload = function() {
      document.getElementById('savedUserPhoto').src = reader.result;
      document.getElementById('savedUserPhoto').style.display = 'block';
      saveToGoogleDrive(blob, `user_photo_${Date.now()}.png`, () => {
        document.getElementById('userPhotoCropper').style.display = 'none';
        userCropper.destroy();
        userCropper = null;
        Swal.fire({
          icon: 'success',
          title: 'Photo Saved',
          text: 'User photo cropped and saved!',
          toast: true,
          position: 'bottom-end',
          showConfirmButton: false,
          timer: 3000
        });
      });
    };
    reader.readAsDataURL(blob);
  }, 'image/png', 0.8); // Compress image
}

/**
 * Saves data to Google Drive or local storage.
 * @param {Blob} blob - Data to save.
 * @param {string} fileName - Name of the file.
 * @param {Function} callback - Callback function.
 */
function saveToGoogleDrive(blob, fileName, callback) {
  if (!gapi.client.getToken()) {
    console.warn('Not signed in to Google, saving to local storage');
    saveToLocalStorage(blob, fileName, callback);
    return;
  }

  const fileMetadata = {
    name: DOMPurify.sanitize(fileName),
    mimeType: blob.type
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }));
  form.append('file', blob);

  document.getElementById('loadingIndicator').style.display = 'flex';
  fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: new Headers({ 'Authorization': 'Bearer ' + gapi.client.getToken().access_token }),
    body: form
  }).then(response => response.json())
    .then(file => {
      console.log('File uploaded to Google Drive:', file);
      document.getElementById('loadingIndicator').style.display = 'none';
      callback();
    })
    .catch(error => {
      console.error('Google Drive upload error:', error);
      document.getElementById('loadingIndicator').style.display = 'none';
      Swal.fire({
        icon: 'error',
        title: 'Upload Failed',
        text: 'Failed to save to Google Drive. Saving to local storage.',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
      saveToLocalStorage(blob, fileName, callback);
    });
}

/**
 * Saves data to local storage.
 * @param {Blob} blob - Data to save.
 * @param {string} fileName - Name of the file.
 * @param {Function} callback - Callback function.
 */
function saveToLocalStorage(blob, fileName, callback) {
  const reader = new FileReader();
  reader.onload = function() {
    try {
      localStorage.setItem(fileName, reader.result);
      console.log('Saved to local storage:', fileName);
      callback();
    } catch (error) {
      console.error('Local storage error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Storage Error',
        text: 'Failed to save to local storage. Storage may be full.',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    }
  };
  reader.readAsDataURL(blob);
}

/**
 * Renders user profile in admin section.
 */
function renderUserProfile() {
  if (!userProfile) return;
  document.getElementById('adminForm').style.display = 'none';
  document.getElementById('setupMessage').style.display = 'none';
  document.getElementById('savedProfile').style.display = 'block';
  document.getElementById('savedClerkName').textContent = userProfile.clerkName;
  document.getElementById('savedJudgeName').textContent = userProfile.judgeName;
  document.getElementById('savedCourtName').textContent = userProfile.courtName;
  document.getElementById('savedMobile').textContent = userProfile.mobile;
  document.getElementById('savedMobile').href = `tel:${userProfile.mobile}`;
  document.getElementById('totalFiles').textContent = files.length;
  document.getElementById('totalProfiles').textContent = profiles.length;
  if (userProfile.photo) {
    document.getElementById('savedUserPhoto').src = userProfile.photo;
    document.getElementById('savedUserPhoto').style.display = 'block';
  }
}

/**
 * Navigates to a specific screen.
 * @param {string} screenId - ID of the screen to show.
 */
function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.sidebar-btn[onclick="navigate('${screenId}')"]`)?.classList.add('active');
  toggleSidebar();
}

/**
 * Toggles the sidebar visibility.
 */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  sidebar.classList.toggle('active');
  overlay.classList.toggle('active');
}

/**
 * Toggles criminal fields based on case type.
 */
function toggleCriminalFields() {
  const caseType = document.getElementById('caseType').value;
  document.getElementById('criminalFields').style.display = caseType === 'criminal' ? 'block' : 'none';
}

/**
 * Toggles copy agency fields.
 */
function toggleCopyAgency() {
  const checked = document.getElementById('copyAgency').checked;
  document.getElementById('copyAgencyFields').style.display = checked ? 'block' : 'none';
}

/**
 * Filters pending files for return.
 */
function filterPendingFiles() {
  const cmsNo = DOMPurify.sanitize(document.getElementById('returnCms').value);
  const title = DOMPurify.sanitize(document.getElementById('returnTitle').value.toLowerCase());
  const tbody = document.getElementById('pendingFilesTable').querySelector('tbody');
  tbody.innerHTML = '';

  const pendingFiles = files.filter(f => f.status === 'pending' &&
    (!cmsNo || f.cmsNo.includes(cmsNo)) &&
    (!title || `${f.petitioner} vs ${f.respondent}`.toLowerCase().includes(title)));

  pendingFiles.forEach(file => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" value="${file.id}" aria-label="Select File"></td>
      <td>${file.cmsNo}</td>
      <td>${file.petitioner} vs ${file.respondent}</td>
      <td>${file.caseType}</td>
      <td>${file.deliveredTo}</td>
      <td><button onclick="returnFile(${file.id})" aria-label="Return File"><i class="fas fa-undo"></i> Return</button></td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Returns a single file.
 * @param {number} fileId - ID of the file to return.
 */
function returnFile(fileId) {
  const file = files.find(f => f.id === fileId);
  if (file) {
    file.status = 'completed';
    file.returnDate = new Date().toISOString();
    localStorage.setItem('file_' + file.id, JSON.stringify(file));
    saveToGoogleDrive(new Blob([JSON.stringify(file)], { type: 'application/json' }), `file_${file.id}.json`, () => {
      Swal.fire({
        icon: 'success',
        title: 'File Returned',
        text: 'File marked as returned!',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
      filterPendingFiles();
      updateDashboardCards();
    });
  }
}

/**
 * Returns multiple selected files.
 */
function bulkReturnFiles() {
  const checkboxes = document.querySelectorAll('#pendingFilesTable input[type="checkbox"]:checked');
  const fileIds = Array.from(checkboxes).map(cb => Number(cb.value));
  fileIds.forEach(fileId => returnFile(fileId));
}

/**
 * Shows the profile form for adding/editing.
 */
function showProfileForm() {
  document.getElementById('profileForm').style.display = 'block';
  document.getElementById('profileSearchSection').style.display = 'none';
  document.getElementById('profileList').style.display = 'none';
  toggleProfileFields();
}

/**
 * Toggles profile fields based on type.
 */
function toggleProfileFields() {
  const type = document.getElementById('profileType').value;
  const fields = document.getElementById('profileFields');
  fields.innerHTML = `
    <label>Name: <span class="required">*</span><input id="profileName" required aria-label="Profile Name"></label>
    <label>Cell No: <input id="profileCellNo" type="tel" aria-label="Profile Cell Number"></label>
    ${type === 'advocate' ? '<label>Chamber No: <input id="profileChamberNo" aria-label="Chamber Number"></label>' : ''}
  `;
  if (currentProfile) {
    document.getElementById('profileType').value = currentProfile.type;
    document.getElementById('profileName').value = currentProfile.name;
    document.getElementById('profileCellNo').value = currentProfile.cellNo;
    if (currentProfile.chamberNo) {
      document.getElementById('profileChamberNo').value = currentProfile.chamberNo;
    }
    if (currentProfile.photo) {
      const img = document.createElement('img');
      img.id = 'profilePhotoPreview';
      img.src = currentProfile.photo;
      img.style.width = '100px';
      img.style.height = '100px';
      img.style.borderRadius = '50%';
      document.getElementById('photoCropper').appendChild(img);
    }
  }
}

/**
 * Shows profile search section.
 */
function showProfileSearch() {
  document.getElementById('profileForm').style.display = 'none';
  document.getElementById('profileSearchSection').style.display = 'block';
  document.getElementById('profileList').style.display = 'block';
  renderProfiles();
}

/**
 * Renders profiles in the file fetcher table.
 */
function renderProfiles() {
  const typeFilter = document.getElementById('profileFilterType').value;
  const search = DOMPurify.sanitize(document.getElementById('profileSearch').value.toLowerCase());
  const tbody = document.getElementById('profileTable').querySelector('tbody');
  tbody.innerHTML = '';

  const filteredProfiles = profiles.filter(p => 
    (!typeFilter || p.type === typeFilter) &&
    (!search || p.name.toLowerCase().includes(search) || 
     p.cellNo.includes(search) || 
     (p.chamberNo && p.chamberNo.includes(search)))
  );

  filteredProfiles.forEach(profile => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${profile.photo || 'icon-192.png'}" alt="Profile Photo" style="width:50px;height:50px;border-radius:50%;"></td>
      <td>${profile.name}</td>
      <td>${profile.type}</td>
      <td>${profile.cellNo}</td>
      <td>${profile.chamberNo || '-'}</td>
      <td>${files.filter(f => f.deliveredTo === profile.name).length}</td>
      <td>${files.filter(f => f.deliveredTo === profile.name && f.status === 'pending').length}</td>
      <td>
        <button onclick="editProfile(${profile.id})" aria-label="Edit Profile"><i class="fas fa-edit"></i></button>
        <button onclick="deleteProfile(${profile.id})" aria-label="Delete Profile"><i class="fas fa-trash"></i></button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Edits an existing profile.
 * @param {number} profileId - ID of the profile to edit.
 */
function editProfile(profileId) {
  currentProfile = profiles.find(p => p.id === profileId);
  showProfileForm();
}

/**
 * Deletes a profile.
 * @param {number} profileId - ID of the profile to delete.
 */
function deleteProfile(profileId) {
  Swal.fire({
    title: 'Are you sure?',
    text: 'This profile will be deleted permanently.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Delete',
    cancelButtonText: 'Cancel'
  }).then(result => {
    if (result.isConfirmed) {
      profiles = profiles.filter(p => p.id !== profileId);
      localStorage.removeItem('profile_' + profileId);
      renderProfiles();
      Swal.fire({
        icon: 'success',
        title: 'Profile Deleted',
        text: 'Profile removed successfully!',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    }
  });
}

/**
 * Suggests profiles for autocompletion.
 * @param {string} value - Input value to search.
 * @param {string} inputId - ID of the input element.
 */
function suggestProfiles(value, inputId) {
  value = DOMPurify.sanitize(value.toLowerCase());
  const suggestions = document.getElementById(inputId === 'deliveredTo' ? 'suggestions' : 'searchSuggestions');
  suggestions.innerHTML = '';

  if (!value) return;

  const matches = profiles.filter(p => p.name.toLowerCase().includes(value));
  matches.forEach(profile => {
    const li = document.createElement('li');
    li.textContent = profile.name;
    li.addEventListener('click', () => {
      document.getElementById(inputId).value = profile.name;
      suggestions.innerHTML = '';
    });
    suggestions.appendChild(li);
  });
}

/**
 * Performs dashboard search.
 */
function performDashboardSearch() {
  const title = DOMPurify.sanitize(document.getElementById('searchTitle').value.toLowerCase());
  const cmsNo = DOMPurify.sanitize(document.getElementById('searchCms').value);
  const fileTaker = DOMPurify.sanitize(document.getElementById('searchFileTaker').value.toLowerCase());
  const firNo = DOMPurify.sanitize(document.getElementById('searchFirNo').value);
  const firYear = DOMPurify.sanitize(document.getElementById('searchFirYear').value);
  const policeStation = DOMPurify.sanitize(document.getElementById('searchPoliceStation').value.toLowerCase());

  const filteredFiles = files.filter(f => 
    (!title || `${f.petitioner} vs ${f.respondent}`.toLowerCase().includes(title)) &&
    (!cmsNo || f.cmsNo.includes(cmsNo)) &&
    (!fileTaker || f.deliveredTo.toLowerCase().includes(fileTaker)) &&
    (!firNo || f.firNo.includes(firNo)) &&
    (!firYear || f.firYear.includes(firYear)) &&
    (!policeStation || f.policeStation.toLowerCase().includes(policeStation))
  );

  renderDashboardReport(filteredFiles);
}

/**
 * Renders dashboard report table.
 * @param {Array} filteredFiles - Files to display.
 */
function renderDashboardReport(filteredFiles) {
  const tbody = document.getElementById('dashboardReportTable').querySelector('tbody');
  tbody.innerHTML = '';
  const page = Number(document.getElementById('pageInfo').dataset.page || 1);
  const start = (page - 1) * RECORDS_PER_PAGE;
  const end = start + RECORDS_PER_PAGE;
  const paginatedFiles = filteredFiles.slice(start, end);

  paginatedFiles.forEach((file, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${start + index + 1}</td>
      <td>${file.cmsNo}</td>
      <td>${file.petitioner} vs ${file.respondent}</td>
      <td>${file.caseType}</td>
      <td>${file.nature}</td>
      <td>${file.dateType}</td>
      <td>${file.copyAgency ? `Form No: ${file.swalFormNo}, Date: ${file.swalDate}` : '-'}</td>
      <td>${file.deliveredTo}</td>
      <td>${new Date(file.deliveryDate).toLocaleDateString()}</td>
      <td>${file.returnDate ? new Date(file.returnDate).toLocaleDateString() : '-'}</td>
      <td>${file.returnDate ? Math.ceil((new Date(file.returnDate) - new Date(file.deliveryDate)) / 86400000) : '-'}</td>
      <td>${userProfile?.courtName || '-'}</td>
      <td>${userProfile?.clerkName || '-'}</td>
      <td><button onclick="showProfileDetails('${file.deliveredTo}')" aria-label="View Profile Details"><i class="fas fa-user"></i></button></td>
    `;
    tbody.appendChild(row);
  });

  document.getElementById('pageInfo').textContent = `Page ${page} of ${Math.ceil(filteredFiles.length / RECORDS_PER_PAGE)}`;
  document.getElementById('pageInfo').dataset.page = page;
  document.getElementById('prevPage').disabled = page === 1;
  document.getElementById('nextPage').disabled = end >= filteredFiles.length;
}

/**
 * Shows profile details in a modal.
 * @param {string} name - Name of the profile to show.
 */
function showProfileDetails(name) {
  const profile = profiles.find(p => p.name === name);
  if (!profile) return;

  document.getElementById('profileModal').style.display = 'flex';
  document.getElementById('profileModalTitle').textContent = profile.name;
  document.getElementById('profileModalPhoto').src = profile.photo || 'icon-192.png';
  document.getElementById('profileModalPhoto').style.display = 'block';
  document.getElementById('profileModalPhotoZoom').src = profile.photo || 'icon-192.png';
  const table = document.getElementById('profileModalTable');
  table.innerHTML = `
    <tr><th>Type</th><td>${profile.type}</td></tr>
    <tr><th>Cell No</th><td>${profile.cellNo}</td></tr>
    <tr><th>Chamber No</th><td>${profile.chamberNo || '-'}</td></tr>
    <tr><th>Files Delivered</th><td>${files.filter(f => f.deliveredTo === profile.name).length}</td></tr>
    <tr><th>Pending Files</th><td>${files.filter(f => f.deliveredTo === profile.name && f.status === 'pending').length}</td></tr>
  `;
}

/**
 * Closes profile modal.
 */
function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
}

/**
 * Exports profiles to JSON.
 */
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

/**
 * Imports profiles from JSON.
 */
function importProfiles() {
  const file = document.getElementById('profileImport').files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      imported.forEach(profile => {
        profile.id = Date.now() + Math.random();
        profiles.push(profile);
        localStorage.setItem('profile_' + profile.id, JSON.stringify(profile));
        saveToGoogleDrive(new Blob([JSON.stringify(profile)], { type: 'application/json' }), `profile_${profile.id}.json`, () => {});
      });
      renderProfiles();
      Swal.fire({
        icon: 'success',
        title: 'Profiles Imported',
        text: 'Profiles imported successfully!',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    } catch (error) {
      console.error('Import error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Import Failed',
        text: 'Invalid profile data. Please check the file.',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    }
  };
  reader.readAsText(file);
}

/**
 * Triggers profile import.
 */
function triggerImport() {
  document.getElementById('profileImport').click();
}

/**
 * Backs up data to local storage.
 */
function backupData() {
  const data = {
    userProfile,
    profiles,
    files
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'court_file_tracker_backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Restores data from file.
 */
function restoreData() {
  const file = document.getElementById('dataRestore').files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.userProfile) {
        userProfile = data.userProfile;
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        renderUserProfile();
      }
      if (data.profiles) {
        profiles = data.profiles;
        profiles.forEach(p => localStorage.setItem('profile_' + p.id, JSON.stringify(p)));
        renderProfiles();
      }
      if (data.files) {
        files = data.files;
        files.forEach(f => localStorage.setItem('file_' + f.id, JSON.stringify(f)));
        updateDashboardCards();
        filterPendingFiles();
      }
      Swal.fire({
        icon: 'success',
        title: 'Data Restored',
        text: 'Data restored successfully!',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    } catch (error) {
      console.error('Restore error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Restore Failed',
        text: 'Invalid backup file. Please check the file.',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    }
  };
  reader.readAsText(file);
}

/**
 * Triggers data restore.
 */
function triggerRestore() {
  document.getElementById('dataRestore').click();
}

/**
 * Backs up data to Google Drive.
 */
function backupToDrive() {
  const data = {
    userProfile,
    profiles,
    files
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  saveToGoogleDrive(blob, `court_file_tracker_backup_${Date.now()}.json`, () => {
    Swal.fire({
      icon: 'success',
      title: 'Backup Saved',
      text: 'Backup saved to Google Drive!',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
  });
}

/**
 * Restores data from Google Drive.
 */
function restoreFromDrive() {
  if (!gapi.client.getToken()) {
    Swal.fire({
      icon: 'error',
      title: 'Not Signed In',
      text: 'Please sign in with Google to restore from Drive.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
    return;
  }

  document.getElementById('loadingIndicator').style.display = 'flex';
  gapi.client.drive.files.list({
    q: "name contains 'court_file_tracker_backup'",
    fields: 'files(id, name)'
  }).then(response => {
    const files = response.result.files;
    if (!files.length) {
      document.getElementById('loadingIndicator').style.display = 'none';
      Swal.fire({
        icon: 'info',
        title: 'No Backups',
        text: 'No backup files found in Google Drive.',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
      return;
    }

    const latestFile = files.sort((a, b) => b.name.localeCompare(a.name))[0];
    gapi.client.drive.files.get({
      fileId: latestFile.id,
      alt: 'media'
    }).then(response => {
      const data = JSON.parse(response.body);
      if (data.userProfile) {
        userProfile = data.userProfile;
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        renderUserProfile();
      }
      if (data.profiles) {
        profiles = data.profiles;
        profiles.forEach(p => localStorage.setItem('profile_' + p.id, JSON.stringify(p)));
        renderProfiles();
      }
      if (data.files) {
        files = data.files;
        files.forEach(f => localStorage.setItem('file_' + f.id, JSON.stringify(f)));
        updateDashboardCards();
        filterPendingFiles();
      }
      document.getElementById('loadingIndicator').style.display = 'none';
      Swal.fire({
        icon: 'success',
        title: 'Data Restored',
        text: 'Data restored from Google Drive!',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    }).catch(error => {
      document.getElementById('loadingIndicator').style.display = 'none';
      console.error('Restore from Drive error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Restore Failed',
        text: 'Failed to restore from Google Drive.',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    });
  }).catch(error => {
    document.getElementById('loadingIndicator').style.display = 'none';
    console.error('Drive file list error:', error);
    Swal.fire({
      icon: 'error',
      title: 'Restore Failed',
      text: 'Failed to access Google Drive files.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
  });
}

/**
 * Shows the change PIN modal.
 */
function showChangePin() {
  document.getElementById('changePinModal').style.display = 'flex';
}

/**
 * Hides the change PIN modal.
 */
function hideChangePin() {
  document.getElementById('changePinModal').style.display = 'none';
}

/**
 * Changes the user PIN.
 */
function changePin() {
  const cnic = DOMPurify.sanitize(document.getElementById('resetCnic').value);
  const newPin = DOMPurify.sanitize(document.getElementById('resetPin').value);
  if ((cnic === userProfile.cnic || cnic === userProfile.email) && newPin.length === 4) {
    userProfile.pin = newPin;
    localStorage.setItem('userProfile', JSON.stringify(userProfile));
    saveToGoogleDrive(new Blob([JSON.stringify(userProfile)], { type: 'application/json' }), 'user_profile.json', () => {
      hideChangePin();
      Swal.fire({
        icon: 'success',
        title: 'PIN Changed',
        text: 'Your PIN has been updated!',
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 3000
      });
    });
  } else {
    Swal.fire({
      icon: 'error',
      title: 'Invalid Input',
      text: 'Please enter the correct CNIC/Email and a 4-digit PIN.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
  }
}

/**
 * Shows the disclaimer modal.
 */
function showDisclaimerModal() {
  document.getElementById('disclaimerModal').style.display = 'flex';
}

/**
 * Toggles the save button based on terms agreement.
 */
function toggleSaveButton() {
  document.getElementById('saveProfileBtn').disabled = !document.getElementById('agreeTerms').checked;
}

/**
 * Shows the share backup modal.
 */
function showShareBackup() {
  document.getElementById('shareBackupModal').style.display = 'flex';
  const select = document.getElementById('backupFiles');
  select.innerHTML = '<option value="">Select Backup</option>';
  // Mock backup files (replace with actual Drive file list if needed)
  ['backup_2025-05-15.json', 'backup_2025-05-14.json'].forEach(file => {
    const option = document.createElement('option');
    option.value = file;
    option.textContent = file;
    select.appendChild(option);
  });
}

/**
 * Hides the share backup modal.
 */
function hideShareBackup() {
  document.getElementById('shareBackupModal').style.display = 'none';
}

/**
 * Shares a backup file (mock implementation).
 */
function shareBackup() {
  const file = document.getElementById('backupFiles').value;
  const email = DOMPurify.sanitize(document.getElementById('shareEmail').value);
  if (file && email) {
    // Mock sharing logic (replace with actual email or Drive sharing API)
    console.log(`Sharing ${file} with ${email}`);
    hideShareBackup();
    Swal.fire({
      icon: 'success',
      title: 'Backup Shared',
      text: `Backup shared with ${email}!`,
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
  } else {
    Swal.fire({
      icon: 'error',
      title: 'Invalid Input',
      text: 'Please select a backup file and enter a valid email.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
  }
}

/**
 * Auto-fills CMS number (placeholder).
 */
function autoFillCMS() {
  // Implement CMS auto-fill logic if needed
}

/**
 * Prints the dashboard report.
 */
function printDashboardReport() {
  window.print();
}

/**
 * Exports the dashboard report.
 * @param {string} format - Export format ('csv' or 'pdf').
 */
function exportDashboardReport(format) {
  if (format === 'csv') {
    let csv = 'Sr#,CMS No,Title,Case Type,Nature,Date Type,Swal Form Details,Delivered To,Delivery Date,Return Date,Time Span,Court,Clerk Name\n';
    files.forEach((f, i) => {
      csv += `${i+1},${f.cmsNo},${f.petitioner} vs ${f.respondent},${f.caseType},${f.nature},${f.dateType},` +
             `${f.copyAgency ? `Form No: ${f.swalFormNo}, Date: ${f.swalDate}` : '-'},${f.deliveredTo},` +
             `${new Date(f.deliveryDate).toLocaleDateString()},${f.returnDate ? new Date(f.returnDate).toLocaleDateString() : '-'},` +
             `${f.returnDate ? Math.ceil((new Date(f.returnDate) - new Date(f.deliveryDate)) / 86400000) : '-'},` +
             `${userProfile?.courtName || '-'},${userProfile?.clerkName || '-'}\n`;
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
    doc.text('Dashboard Report', 10, 10);
    let y = 20;
    files.forEach((f, i) => {
      doc.text(`${i+1}. CMS No: ${f.cmsNo}, Title: ${f.petitioner} vs ${f.respondent}, Status: ${f.status}`, 10, y);
      y += 10;
      if (y > 270) {
        doc.addPage();
        y = 10;
      }
    });
    doc.save('dashboard_report.pdf');
  }
}

/**
 * Edits the user profile.
 */
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
  toggleSaveButton();
}

/**
 * Submits the PIN for verification.
 */
function submitPin() {
  const pin = DOMPurify.sanitize(document.getElementById('pinInput').value);
  if (pin === userProfile.pin) {
    document.getElementById('pinModal').style.display = 'none';
    document.getElementById('changePinBtn').style.display = 'inline-block';
  } else {
    Swal.fire({
      icon: 'error',
      title: 'Invalid PIN',
      text: 'Please enter the correct PIN.',
      toast: true,
      position: 'bottom-end',
      showConfirmButton: false,
      timer: 3000
    });
  }
}

// Offline detection
window.addEventListener('online', () => {
  Swal.fire({
    icon: 'success',
    title: 'Online',
    text: 'You are now online!',
    toast: true,
    position: 'bottom-end',
    showConfirmButton: false,
    timer: 3000
  });
});

window.addEventListener('offline', () => {
  Swal.fire({
    icon: 'warning',
    title: 'Offline',
    text: 'You are offline. Data will be saved locally.',
    toast: true,
    position: 'bottom-end',
    showConfirmButton: false,
    timer: 3000
  });
});

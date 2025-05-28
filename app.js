// Court File Tracker Lite App Logic
const dbName = 'CourtFileTrackerDB';
let files = JSON.parse(localStorage.getItem('files')) || [];
let profiles = JSON.parse(localStorage.getItem('profiles')) || [];
let userProfile = JSON.parse(localStorage.getItem('userProfile')) || null;
let currentScreen = 'admin';
let chartInstance = null;
let deferredPrompt = null;
const recordsPerPage = 10;
let currentPage = 1;
let currentReportData = [];
let analytics = JSON.parse(localStorage.getItem('analytics')) || {
  filesEntered: 0,
  searchesPerformed: 0,
  backupsCreated: 0
};

// Utility Functions
const showToast = (message, type = 'success') => {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#d32f2f' : '#4caf50';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
};

const saveData = () => {
  localStorage.setItem('files', JSON.stringify(files));
  localStorage.setItem('profiles', JSON.stringify(profiles));
  localStorage.setItem('userProfile', JSON.stringify(userProfile));
  localStorage.setItem('analytics', JSON.stringify(analytics));
};

const loadData = () => {
  files = JSON.parse(localStorage.getItem('files')) || [];
  profiles = JSON.parse(localStorage.getItem('profiles')) || [];
  userProfile = JSON.parse(localStorage.getItem('userProfile')) || null;
  analytics = JSON.parse(localStorage.getItem('analytics')) || {
    filesEntered: 0,
    searchesPerformed: 0,
    backupsCreated: 0
  };
};

// Sidebar and Navigation
const toggleSidebar = () => {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  sidebar.classList.toggle('active');
  overlay.classList.toggle('active');
};

const navigate = (screenId) => {
  if (!userProfile && screenId !== 'admin' && screenId !== 'developersDisclaimer') {
    showToast('Please complete your profile setup first.', 'error');
    screenId = 'admin';
  }
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  document.querySelector(`.sidebar button[onclick="navigate('${screenId}')"]`).classList.add('active');
  currentScreen = screenId;
  if (screenId === 'dashboard') updateDashboardCards();
  if (screenId === 'return') filterPendingFiles();
  if (screenId === 'fileFetcher') renderProfiles();
  if (screenId === 'analytics') showAnalytics();
  if (window.innerWidth <= 768) toggleSidebar();
};

// PIN Handling
const showPinModal = () => {
  if (!userProfile?.pin) return;
  document.getElementById('pinModal').style.display = 'block';
  document.getElementById('pinInput').focus();
};

const submitPin = (callback) => {
  const pinInput = document.getElementById('pinInput').value;
  if (pinInput === userProfile.pin) {
    document.getElementById('pinModal').style.display = 'none';
    document.getElementById('pinInput').value = '';
    callback(true);
  } else {
    showToast('Incorrect PIN.', 'error');
    callback(false);
  }
};

// Admin Section
const updateSavedProfile = () => {
  if (userProfile) {
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
    document.getElementById('totalFiles').textContent = files.length;
    document.getElementById('totalProfiles').textContent = profiles.length;
    document.getElementById('changePinBtn').style.display = userProfile.email || userProfile.cnic ? 'inline-block' : 'none';
  } else {
    document.getElementById('setupMessage').style.display = 'block';
    document.getElementById('adminForm').style.display = 'block';
    document.getElementById('savedProfile').style.display = 'none';
  }
};

const handleAdminForm = (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
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
    document.getElementById('loadingIndicator').style.display = 'none';
    return;
  }

  if (!/^\d{5}-\d{7}-\d$/.test(cnic)) {
    showToast('Invalid CNIC format (e.g., 12345-1234567-1).', 'error');
    document.getElementById('loadingIndicator').style.display = 'none';
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    showToast('PIN must be 4 digits.', 'error');
    document.getElementById('loadingIndicator').style.display = 'none';
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
    updateSavedProfile();
    showToast('Profile saved successfully.');
    document.getElementById('loadingIndicator').style.display = 'none';
    navigate('dashboard');
  };
  reader.onerror = () => {
    showToast('Failed to read photo.', 'error');
    document.getElementById('loadingIndicator').style.display = 'none';
  };
  if (userPhoto) {
    reader.readAsDataURL(userPhoto);
  } else if (userProfile?.photo) {
    userProfile = { ...userProfile, clerkName, judgeName, courtName, mobile, cnic, pin, email };
    saveData();
    updateSavedProfile();
    showToast('Profile updated successfully.');
    document.getElementById('loadingIndicator').style.display = 'none';
    navigate('dashboard');
  } else {
    showToast('Please upload a photo.', 'error');
    document.getElementById('loadingIndicator').style.display = 'none';
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
  document.getElementById('agreeTerms').checked = true;
  if (userProfile.photo) {
    document.getElementById('userPhotoPreview').src = userProfile.photo;
    document.getElementById('userPhotoPreview').style.display = 'block';
  }
};

const showChangePin = () => {
  document.getElementById('changePinModal').style.display = 'block';
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
const handleFileForm = (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  submitPin((success) => {
    if (!success) {
      document.getElementById('loadingIndicator').style.display = 'none';
      return;
    }
    const cmsNo = document.getElementById('cmsNo').value;
    const existingDelivered = files.find(f => f.cmsNo === cmsNo && !f.returned);
    if (existingDelivered) {
      showToast(`File ${cmsNo} is already delivered to ${existingDelivered.deliveredToName} (${existingDelivered.deliveredToType}) and not yet returned.`, 'error');
      document.getElementById('loadingIndicator').style.display = 'none';
      return;
    }
    const deliveredToName = document.getElementById('deliveredTo').value.trim();
    const deliveredToType = document.getElementById('deliveredType').value;
    const profileExists = profiles.find(p => p.name === deliveredToName && p.type === deliveredToType);
    if (!profileExists) {
      showToast('Profile does not exist. Please add it in the File Fetcher section.', 'error');
      document.getElementById('loadingIndicator').style.display = 'none';
      navigate('fileFetcher');
      showProfileForm();
      return;
    }
    const fileData = {
      cmsNo,
      title: `${document.getElementById('petitioner').value.trim()} vs ${document.getElementById('respondent').value.trim()}`,
      caseType: document.getElementById('caseType').value,
      nature: document.getElementById('nature').value.trim(),
      firNo: document.getElementById('firNo').value.trim(),
      firYear: document.getElementById('firYear').value.trim(),
      firUs: document.getElementById('firUs').value.trim(),
      policeStation: document.getElementById('policeStation').value.trim(),
      dateType: document.getElementById('dateType').value,
      date: document.getElementById('date').value,
      deliveredToName,
      deliveredToType,
      swalFormNo: document.getElementById('copyAgency').checked ? document.getElementById('swalFormNo').value.trim() : '',
      swalDate: document.getElementById('copyAgency').checked ? document.getElementById('swalDate').value : '',
      deliveredAt: new Date().toISOString(),
      courtName: userProfile.courtName,
      clerkName: userProfile.clerkName,
      returned: false
    };
    files.push(fileData);
    analytics.filesEntered++;
    saveData();
    document.getElementById('fileForm').reset();
    document.getElementById('criminalFields').style.display = 'none';
    document.getElementById('copyAgencyFields').style.display = 'none';
    document.getElementById('copyAgency').checked = false;
    ['petitioner', 'respondent', 'caseType', 'nature', 'firNo', 'firYear', 'firUs', 'policeStation', 'dateType', 'date', 'deliveredTo', 'deliveredType', 'swalFormNo', 'swalDate', 'copyAgency'].forEach(id => {
      document.getElementById(id).disabled = false;
    });
    showToast('File saved and delivered successfully.');
    document.getElementById('loadingIndicator').style.display = 'none';
    updateDashboardCards();
  });
};

const autoFillCMS = () => {
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
    caseFields.forEach(id => document.getElementById(id).disabled = true);
    editableFields.forEach(id => document.getElementById(id).disabled = false);
    document.getElementById('copyAgency').checked = false;
    document.getElementById('deliveredTo').value = '';
    document.getElementById('deliveredType').value = '';
    document.getElementById('swalFormNo').value = '';
    document.getElementById('swalDate').value = '';
    toggleCopyAgency();
  } else {
    caseFields.concat(editableFields).forEach(id => document.getElementById(id).disabled = false);
    document.getElementById('copyAgency').disabled = false;
  }
};

const toggleCriminalFields = () => {
  document.getElementById('criminalFields').style.display = document.getElementById('caseType').value === 'criminal' ? 'block' : 'none';
};

const toggleCopyAgency = () => {
  document.getElementById('copyAgencyFields').style.display = document.getElementById('copyAgency').checked ? 'block' : 'none';
};

const suggestProfiles = (input, inputId) => {
  const suggestions = document.getElementById(inputId === 'deliveredTo' ? 'suggestions' : 'searchSuggestions');
  suggestions.innerHTML = '';
  if (!input) return;
  const fuse = new Fuse(profiles, { keys: ['name', 'cellNo', 'chamberNo'], threshold: 0.3 });
  const results = fuse.search(input).slice(0, 5);
  results.forEach(result => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = result.item.photo || 'icon-192.png';
    img.style.width = '40px';
    img.style.height = '40px';
    img.style.borderRadius = '50%';
    li.appendChild(img);
    const text = document.createElement('span');
    text.textContent = `${result.item.name} (${result.item.type})`;
    li.appendChild(text);
    li.onclick = () => {
      document.getElementById(inputId).value = result.item.name;
      if (inputId === 'deliveredTo') document.getElementById('deliveredType').value = result.item.type;
      suggestions.innerHTML = '';
    };
    suggestions.appendChild(li);
  });
};

// Return File
const filterPendingFiles = () => {
  const cms = document.getElementById('returnCms').value;
  const title = document.getElementById('returnTitle').value.toLowerCase();
  const tbody = document.querySelector('#pendingFilesTable tbody');
  tbody.innerHTML = '';
  files
    .filter(f => !f.returned && (!cms || f.cmsNo.includes(cms)) && (!title || f.title.toLowerCase().includes(title)))
    .forEach(f => {
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
};

const returnFile = (cmsNo) => {
  submitPin((success) => {
    if (success) {
      const file = files.find(f => f.cmsNo === cmsNo && !f.returned);
      if (file) {
        file.returned = true;
        file.returnedAt = new Date().toISOString();
        saveData();
        showToast(`File ${cmsNo} returned successfully.`);
        filterPendingFiles();
        updateDashboardCards();
      }
    }
  });
};

const bulkReturnFiles = () => {
  const selected = document.querySelectorAll('.select-file:checked');
  if (!selected.length) {
    showToast('Please select at least one file to return.', 'error');
    return;
  }
  submitPin((success) => {
    if (success) {
      selected.forEach(checkbox => {
        const file = files.find(f => f.cmsNo === checkbox.dataset.cms && !f.returned);
        if (file) {
          file.returned = true;
          file.returnedAt = new Date().toISOString();
        }
      });
      saveData();
      showToast(`${selected.length} file(s) returned successfully.`);
      filterPendingFiles();
      updateDashboardCards();
    }
  });
};

// File Fetcher
const showProfileForm = () => {
  document.getElementById('profileForm').style.display = 'block';
  document.getElementById('profileSearchSection').style.display = 'none';
  document.getElementById('profileList').style.display = 'none';
  document.getElementById('profileType').value = '';
  document.getElementById('profileFields').innerHTML = '';
  document.getElementById('profilePhoto').value = '';
  document.getElementById('photoAdjust').style.display = 'none';
};

const showProfileSearch = () => {
  document.getElementById('profileForm').style.display = 'none';
  document.getElementById('profileSearchSection').style.display = 'block';
  document.getElementById('profileList').style.display = 'block';
  renderProfiles();
};

const toggleProfileFields = () => {
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
    fields.innerHTML += `<label>Chamber No: <span class="required">*</span><input type="text" id="chamberNo" required /></label>`;
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
};

const handleProfileForm = (e) => {
  e.preventDefault();
  document.getElementById('loadingIndicator').style.display = 'block';
  const profileType = document.getElementById('profileType').value;
  const photoInput = document.getElementById('profilePhoto');
  const photo = photoInput.files[0];

  const processPhoto = (photoData) => {
    const profile = {
      type: profileType,
      name: document.getElementById('profileName').value.trim(),
      cellNo: document.getElementById('cellNo').value.trim(),
      chamberNo: document.getElementById('chamberNo')?.value.trim() || '',
      advocateName: document.getElementById('advocateName')?.value.trim() || '',
      advocateCell: document.getElementById('advocateCell')?.value.trim() || '',
      designation: document.getElementById('designation')?.value.trim() || '',
      postedAt: document.getElementById('postedAt')?.value.trim() || '',
      cnic: document.getElementById('cnic')?.value.trim() || '',
      relation: document.getElementById('relation')?.value.trim() || '',
      photo: photoData || ''
    };
    const existingIndex = profiles.findIndex(p => p.name === profile.name && p.type === profile.type);
    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }
    saveData();
    document.getElementById('profileForm').reset();
    document.getElementById('profileFields').innerHTML = '';
    document.getElementById('photoAdjust').style.display = 'none';
    showToast('Profile saved successfully.');
    document.getElementById('loadingIndicator').style.display = 'none';
    showProfileSearch();
  };

  if (photo) {
    const reader = new FileReader();
    reader.onload = () => processPhoto(reader.result);
    reader.onerror = () => {
      showToast('Failed to read photo.', 'error');
      document.getElementById('loadingIndicator').style.display = 'none';
    };
    reader.readAsDataURL(photo);
  } else if (profileType === 'advocate' || profiles.find(p => p.name === document.getElementById('profileName').value && p.type === profileType)?.photo) {
    processPhoto('');
  } else {
    showToast('Please upload a photo.', 'error');
    document.getElementById('loadingIndicator').style.display = 'none';
  }
};

const renderProfiles = () => {
  const typeFilter = document.getElementById('profileFilterType').value;
  const search = document.getElementById('profileSearch').value.toLowerCase();
  const tbody = document.querySelector('#profileTable tbody');
  tbody.innerHTML = '';
  let filteredProfiles = typeFilter ? profiles.filter(p => p.type === typeFilter) : profiles;
  if (search) {
    const fuse = new Fuse(filteredProfiles, { keys: ['name', 'cellNo', 'chamberNo'], threshold: 0.3 });
    filteredProfiles = fuse.search(search).map(result => result.item);
  }
  filteredProfiles.forEach(p => {
    const delivered = files.filter(f => f.deliveredToName === p.name && f.deliveredToType === p.type).length;
    const pending = files.filter(f => f.deliveredToName === p.name && f.deliveredToType === p.type && !f.returned).length;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${p.photo || 'icon-192.png'}" style="width:40px;height:40px;border-radius:50%;"></td>
      <td>${p.name}</td>
      <td>${p.type}</td>
      <td>${p.cellNo}</td>
      <td>${p.chamberNo || '-'}</td>
      <td>${delivered}</td>
      <td>${pending}</td>
      <td>
        <button onclick="editProfile('${p.name}', '${p.type}')">Edit</button>
        <button onclick="deleteProfile('${p.name}', '${p.type}')">Delete</button>
        <button onclick="showProfileDetails('${p.name}', '${p.type}')">View</button>
      </td>
    `;
    tbody.appendChild(row);
  });
};

const editProfile = (name, type) => {
  const profile = profiles.find(p => p.name === name && p.type === type);
  if (profile) {
    document.getElementById('profileForm').style.display = 'block';
    document.getElementById('profileSearchSection').style.display = 'none';
    document.getElementById('profileList').style.display = 'none';
    document.getElementById('profileType').value = profile.type;
    toggleProfileFields();
    document.getElementById('profileName').value = profile.name;
    document.getElementById('cellNo').value = profile.cellNo;
    if (document.getElementById('chamberNo')) document.getElementById('chamberNo').value = profile.chamberNo;
    if (document.getElementById('advocateName')) document.getElementById('advocateName').value = profile.advocateName;
    if (document.getElementById('advocateCell')) document.getElementById('advocateCell').value = profile.advocateCell;
    if (document.getElementById('designation')) document.getElementById('designation').value = profile.designation;
    if (document.getElementById('postedAt')) document.getElementById('postedAt').value = profile.postedAt;
    if (document.getElementById('cnic')) document.getElementById('cnic').value = profile.cnic;
    if (document.getElementById('relation')) document.getElementById('relation').value = profile.relation;
    if (profile.photo) {
      document.getElementById('photoPreview').src = profile.photo;
      document.getElementById('photoPreview').style.display = 'block';
    }
  }
};

const deleteProfile = (name, type) => {
  submitPin((success) => {
    if (success) {
      profiles = profiles.filter(p => p.name !== name || p.type !== type);
      saveData();
      showToast('Profile deleted successfully.');
      renderProfiles();
    }
  });
};

const showProfileDetails = (name, type) => {
  const profile = profiles.find(p => p.name === name && p.type === type) || {};
  document.getElementById('profileModal').style.display = 'block';
  document.getElementById('profileModalTitle').textContent = `${name} (${type})`;
  document.getElementById('profileModalTable').innerHTML = `
    <tr><th>Name</th><td>${profile.name || ''}</td></tr>
    <tr><th>Type</th><td>${profile.type || ''}</td></tr>
    ${profile.cellNo ? `<tr><th>Cell No</th><td><a href="tel:${profile.cellNo}">${profile.cellNo}</a></td></tr>` : ''}
    ${profile.chamberNo ? `<tr><th>Chamber No</th><td>${profile.chamberNo}</td></tr>` : ''}
    ${profile.advocateName ? `<tr><th>Advocate Name</th><td>${profile.advocateName}</td></tr>` : ''}
    ${profile.advocateCell ? `<tr><th>Advocate Cell</th><td><a href="tel:${profile.advocateCell}">${profile.advocateCell}</a></td></tr>` : ''}
    ${profile.designation ? `<tr><th>Designation</th><td>${profile.designation}</td></tr>` : ''}
    ${profile.postedAt ? `<tr><th>Posted At</th><td>${profile.postedAt}</td></tr>` : ''}
    ${profile.cnic ? `<tr><th>ID/CNIC</th><td>${profile.cnic}</td></tr>` : ''}
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
};

const closeProfileModal = () => {
  document.getElementById('profileModal').style.display = 'none';
};

// Dashboard
const updateDashboardCards = () => {
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

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(document.getElementById('statsChart').getContext('2d'), {
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
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { display: false } }
    }
  });
};

// Dashboard Reports
const showDashboardReport = (type) => {
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
  }
  currentReportData = filteredFiles;
  document.getElementById('reportTitle').textContent = title;
  renderReportTable();
  document.getElementById('loadingIndicator').style.display = 'none';
};

let sortColumn = null;
let sortDirection = 1;

const renderReportTable = () => {
  const tbody = document.querySelector('#dashboardReportTable tbody');
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

  const start = (currentPage - 1) * recordsPerPage;
  const end = start + recordsPerPage;
  const paginatedData = sortedData.slice(start, end);

  paginatedData.forEach((f, index) => {
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
      profile.cnic ? `ID/CNIC: ${profile.cnic}` : '',
      profile.relation ? `Relation: ${profile.relation}` : ''
    ].filter(Boolean).join(', ');
    const row = document.createElement('tr');
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
};

const getDynamicTimeSpan = (deliveredAt, returnedAt = null) => {
  const start = new Date(deliveredAt).getTime();
  const end = returnedAt ? new Date(returnedAt).getTime() : Date.now();
  const diff = end - start;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
};

const updateDynamicTimeSpans = () => {
  document.querySelectorAll('.time-span').forEach(span => {
    if (span.dataset.returned === 'false') {
      span.textContent = getDynamicTimeSpan(span.dataset.delivered);
    }
  });
};

const updatePagination = (totalItems) => {
  document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${Math.ceil(totalItems / recordsPerPage)}`;
  document.getElementById('prevPage').disabled = currentPage === 1;
  document.getElementById('nextPage').disabled = currentPage === Math.ceil(totalItems / recordsPerPage);
};

const formatDate = (date, format = 'YYYY-MM-DD') => {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return format === 'YYYY-MM-DD HH:mm:ss' ? `${year}-${month}-${day} ${hours}:${minutes}:${seconds}` : `${year}-${month}-${day}`;
};

// Data Management
const backupData = () => {
  const data = { files, profiles, userProfile: { ...userProfile, pin: null, cnic: userProfile.cnic } };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cft-backup-${formatDate(new Date(), 'YYYYMMDD_HHMMSS')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  analytics.backupsCreated++;
  saveData();
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
        files = data.files || [];
        profiles = data.profiles || [];
        userProfile = data.userProfile ? { ...userProfile, ...data.userProfile, pin: userProfile?.pin } : userProfile;
        saveData();
        updateSavedProfile();
        showToast('Data restored successfully.');
        navigate('dashboard');
      } catch {
        showToast('Invalid backup file.', 'error');
      }
    };
    reader.readAsText(file);
  }
};

const resetApp = () => {
  submitPin((success) => {
    if (success) {
      files = [];
      profiles = [];
      userProfile = null;
      analytics = { filesEntered: 0, searchesPerformed: 0, backupsCreated: 0 };
      saveData();
      showToast('App reset successfully.');
      navigate('admin');
      updateSavedProfile();
    }
  });
};

// Analytics Dashboard
const showAnalytics = () => {
  navigate('analytics');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(document.getElementById('analyticsChart').getContext('2d'), {
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
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { display: false } }
    }
  });
  document.getElementById('analyticsFiles').textContent = analytics.filesEntered;
  document.getElementById('analyticsSearches').textContent = analytics.searchesPerformed;
  document.getElementById('analyticsBackups').textContent = analytics.backupsCreated;
};

// Push Notifications
const setupPushNotifications = () => {
  if ('Notification' in window && navigator.serviceWorker) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        setInterval(checkOverdueFiles, 3600000);
      }
    });
  }
};

const checkOverdueFiles = () => {
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
  updateSavedProfile();
  showPinModal();
  setupPushNotifications();

  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
  document.querySelector('.sidebar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[onclick*="navigate"]');
    if (btn) {
      const screenId = btn.getAttribute('onclick').match(/navigate\('([^']+)'\)/)[1];
      navigate(screenId);
    }
  });

  document.getElementById('adminForm').addEventListener('submit', handleAdminForm);
  document.getElementById('pinInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitPin(() => {});
  });

  document.getElementById('caseType').addEventListener('change', toggleCriminalFields);
  document.getElementById('copyAgency').addEventListener('change', toggleCopyAgency);
  document.getElementById('fileForm').addEventListener('submit', handleFileForm);
  document.getElementById('dataRestore').addEventListener('change', handleRestore);

  document.getElementById('profileForm').addEventListener('submit', handleProfileForm);
  document.getElementById('profileFilterType').addEventListener('change', renderProfiles);
  document.getElementById('profileSearch').addEventListener('input', debounce(renderProfiles, 300));

  document.querySelectorAll('#dashboardReportTable th').forEach((th, index) => {
    th.addEventListener('click', () => {
      const columns = ['cmsNo', 'title', 'caseType', 'nature', 'criminalDetails', 'dateType', 'swalFormNo', 'deliveredToName', 'deliveredAt', 'returnedAt', 'timeSpan', 'courtName', 'clerkName'];
      if (index >= 1 && index <= 13) {
        sortColumn = columns[index - 1];
        sortDirection = sortColumn === sortColumn ? -sortDirection : 1;
        renderReportTable();
      }
    });
  });

  document.getElementById('prevPage').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderReportTable();
    }
  });

  document.getElementById('nextPage').addEventListener('click', () => {
    if (currentPage < Math.ceil(currentReportData.length / recordsPerPage)) {
      currentPage++;
      renderReportTable();
    }
  });

  setInterval(updateDynamicTimeSpans, 1000);
});

// Debounce Utility
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

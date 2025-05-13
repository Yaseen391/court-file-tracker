// Utility Functions
function $(id) { return document.getElementById(id); }
function showToast(message, duration = 3000) {
  const toast = $('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, duration);
}

// Storage Functions
function getFiles() {
  return JSON.parse(localStorage.getItem('files') || '[]');
}

function saveFiles(files) {
  localStorage.setItem('files', JSON.stringify(files));
}

function getProfiles() {
  return JSON.parse(localStorage.getItem('profiles') || '[]');
}

function saveProfiles(profiles) {
  try {
    localStorage.setItem('profiles', JSON.stringify(profiles));
  } catch (e) {
    console.error('Error saving profiles:', e);
    showToast('Failed to save profile. Storage may be full.', 5000);
  }
}

function getUserProfile() {
  return JSON.parse(localStorage.getItem('userProfile') || '{}');
}

function saveUserProfile(profile) {
  localStorage.setItem('userProfile', JSON.stringify(profile));
}

// Date Formatting (Pakistan Standard Time, 24-hour)
function formatDate(date, includeTime = false) {
  if (!date) return '';
  const d = new Date(date);
  const options = { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' };
  let formatted = d.toLocaleDateString('en-GB', options).split('/').reverse().join('/');
  if (includeTime) {
    const timeOptions = { timeZone: 'Asia/Karachi', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
    formatted += `, ${d.toLocaleTimeString('en-GB', timeOptions)} PKT`;
  }
  return formatted;
}

// Sidebar Toggle
function toggleSidebar() {
  const sidebar = $('sidebar');
  const overlay = document.querySelector('.sidebar-overlay') || document.createElement('div');
  overlay.className = 'sidebar-overlay';
  if (!overlay.parentElement) document.body.appendChild(overlay);
  sidebar.classList.toggle('active');
  overlay.style.display = sidebar.classList.contains('active') ? 'block' : 'none';
  // Ensure sidebar closes when clicking outside
  overlay.onclick = () => {
    sidebar.classList.remove('active');
    overlay.style.display = 'none';
  };
}

// Navigation
function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
  document.querySelectorAll('.sidebar button').forEach(b => b.classList.remove('active'));
  document.querySelector(`.sidebar button[onclick="navigate('${screenId}')"]`)?.classList.add('active');
  localStorage.setItem('currentScreen', screenId);
  if (window.innerWidth <= 768) {
    $('sidebar').classList.remove('active');
    document.querySelector('.sidebar-overlay')?.remove();
  }
  // Close dashboard report panel if open
  $('dashboardReportPanel').style.display = 'none';
  // Initialize screen-specific logic
  if (screenId === 'dashboard') updateDashboard();
  if (screenId === 'fileFetcher') resetFileFetcher();
  if (screenId === 'return') filterPendingFiles();
}

// Dashboard Logic
function updateDashboard() {
  const files = getFiles();
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  const tenDaysAgo = Date.now() - 10 * 86400000;

  const deliveries = files.filter(f => formatDate(f.deliveredAt).startsWith(today)).length;
  const returns = files.filter(f => f.returned && formatDate(f.returnedAt).startsWith(today)).length;
  const pending = files.filter(f => !f.returned).length;
  const tomorrowHearings = files.filter(f => formatDate(f.date).startsWith(tomorrow)).length;
  const overdue = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo).length;

  $('cardDeliveries').innerHTML = `<button onclick="showDashboardReport('deliveriesToday')">Deliveries Today<br>${deliveries}</button><span class="tooltip">Files delivered today</span>`;
  $('cardReturns').innerHTML = `<button onclick="showDashboardReport('returnsToday')">Returns Today<br>${returns}</button><span class="tooltip">Files returned today</span>`;
  $('cardPending').innerHTML = `<button onclick="showDashboardReport('pending')">Pending Files<br>${pending}</button><span class="tooltip">Files not yet returned</span>`;
  $('cardTomorrow').innerHTML = `<button onclick="showDashboardReport('tomorrow')">Tomorrow Hearings<br>${tomorrowHearings}</button><span class="tooltip">Hearings scheduled for tomorrow</span>`;
  $('cardOverdue').innerHTML = `<button onclick="showDashboardReport('overdue')">Overdue Files<br>${overdue}</button><span class="tooltip">Files pending over 10 days</span>`;
  $('cardSearchPrev').innerHTML = `<button onclick="showDashboardReport('searchPrevRecords')">Search Prev. Records<br>Search All</button><span class="tooltip">Search all previous records</span>`;
}

// Dashboard Report with Pagination
let currentPage = 1;
const rowsPerPage = 10;
let currentReportData = [];

function showDashboardReport(type) {
  $('loadingIndicator').style.display = 'block';
  $('dashboardReportPanel').style.display = 'block';
  let files = getFiles();
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  const tenDaysAgo = Date.now() - 10 * 86400000;
  let title = '';

  if (type === 'deliveriesToday') {
    files = files.filter(f => formatDate(f.deliveredAt).startsWith(today));
    title = 'Deliveries Today';
  } else if (type === 'returnsToday') {
    files = files.filter(f => f.returned && formatDate(f.returnedAt).startsWith(today));
    title = 'Returns Today';
  } else if (type === 'pending') {
    files = files.filter(f => !f.returned);
    title = 'Pending Files';
  } else if (type === 'tomorrow') {
    files = files.filter(f => formatDate(f.date).startsWith(tomorrow));
    title = 'Tomorrow Hearings';
  } else if (type === 'overdue') {
    files = files.filter(f => !f.returned && new Date(f.deliveredAt) < tenDaysAgo);
    title = 'Overdue Files';
  } else if (type === 'searchPrevRecords') {
    files = files; // All files
    title = 'Search Previous Records';
    $('searchPrevRecords').style.display = 'flex';
    performDashboardSearch();
    $('loadingIndicator').style.display = 'none';
    return;
  }

  $('searchPrevRecords').style.display = 'none';
  currentReportData = files;
  currentPage = 1;
  renderReportTable(title);
}

function renderReportTable(title) {
  $('reportTitle').textContent = title;
  const tbody = $('dashboardReportTable').querySelector('tbody');
  tbody.innerHTML = '';
  const start = (currentPage - 1) * rowsPerPage;
  const end = start + rowsPerPage;
  const paginatedFiles = currentReportData.slice(start, end);

  paginatedFiles.forEach((f, index) => {
    const profile = getProfiles().find(p => p.name === f.deliveredTo && p.type === f.deliveredType) || {};
    const nature = f.caseType === 'criminal' && f.firNo
      ? `${f.nature}, FIR No: ${f.firNo}, Year: ${f.firYear || ''}, U/S: ${f.firUs || ''}, Police Station: ${f.policeStation || ''}`
      : f.nature;
    const swalDetails = f.sentToCopyAgency ? `${f.swalFormNo}, ${formatDate(f.swalDate)}` : '';
    const profileDetails = Object.entries(profile)
      .filter(([key]) => key !== 'photo' && key !== 'name' && key !== 'type')
      .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}: ${value}`)
      .join(', ');
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${start + index + 1}</td>
      <td>${f.cmsNo}</td>
      <td>${f.title}</td>
      <td>${f.caseType}</td>
      <td>${nature}</td>
      <td>${swalDetails}</td>
      <td><a href="#" onclick="showProfileDetails('${f.deliveredTo}', '${f.deliveredType}')">${f.deliveredTo} (${f.deliveredType})</a></td>
      <td>${formatDate(f.deliveredAt, true)}</td>
      <td>${f.returned ? formatDate(f.returnedAt, true) : ''}</td>
      <td>${f.timeSpan || ''}</td>
      <td>${f.court}</td>
      <td>${f.clerkName}</td>
      <td>${profileDetails}</td>
    `;
    tbody.appendChild(row);
  });

  updatePagination();
  $('loadingIndicator').style.display = 'none';
}

function updatePagination() {
  const totalPages = Math.ceil(currentReportData.length / rowsPerPage);
  $('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
  $('prevPage').disabled = currentPage === 1;
  $('nextPage').disabled = currentPage === totalPages;
}

$('prevPage').onclick = () => {
  if (currentPage > 1) {
    currentPage--;
    renderReportTable($('reportTitle').textContent);
  }
};

$('nextPage').onclick = () => {
  if (currentPage < Math.ceil(currentReportData.length / rowsPerPage)) {
    currentPage++;
    renderReportTable($('reportTitle').textContent);
  }
};

// Dashboard Search with Fuzzy Search
let fuse = null;
function performDashboardSearch() {
  const title = $('searchTitle').value.trim().toLowerCase();
  const cmsNo = $('searchCms').value.trim();
  const fileTaker = $('searchFileTaker').value.trim().toLowerCase();
  let files = getFiles();

  if (title || cmsNo || fileTaker) {
    if (!fuse) {
      fuse = new Fuse(files, {
        keys: ['title', 'cmsNo', 'deliveredTo'],
        threshold: 0.4,
        ignoreLocation: true,
      });
    }
    const searchTerms = [];
    if (title) searchTerms.push({ title });
    if (cmsNo) searchTerms.push({ cmsNo });
    if (fileTaker) searchTerms.push({ deliveredTo: fileTaker });
    files = fuse.search(searchTerms.length === 1 ? searchTerms[0] : { $and: searchTerms }).map(result => result.item);
  }

  currentReportData = files;
  currentPage = 1;
  renderReportTable('Search Previous Records');
}

// Export and Print Dashboard Report
function exportDashboardReport(format) {
  const files = currentReportData;
  if (format === 'csv') {
    const csv = ['Sr#,CMS No,Title,Case Type,Nature,Swal Form Details,Delivered To,Delivery Date,Return Date,Time Span,Court,Clerk Name,Profile Details'];
    files.forEach((f, i) => {
      const profile = getProfiles().find(p => p.name === f.deliveredTo && p.type === f.deliveredType) || {};
      const nature = f.caseType === 'criminal' && f.firNo
        ? `${f.nature}, FIR No: ${f.firNo}, Year: ${f.firYear || ''}, U/S: ${f.firUs || ''}, Police Station: ${f.policeStation || ''}`
        : f.nature;
      const swalDetails = f.sentToCopyAgency ? `${f.swalFormNo}, ${formatDate(f.swalDate)}` : '';
      const profileDetails = Object.entries(profile)
        .filter(([key]) => key !== 'photo' && key !== 'name' && key !== 'type')
        .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}: ${value}`)
        .join(', ');
      csv.push(`${i + 1},${f.cmsNo},${f.title},${f.caseType},${nature},${swalDetails},${f.deliveredTo} (${f.deliveredType}),${formatDate(f.deliveredAt, true)},${f.returned ? formatDate(f.returnedAt, true) : ''},${f.timeSpan || ''},${f.court},${f.clerkName},${profileDetails}`);
    });
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${$('reportTitle').textContent.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } else if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text($('reportTitle').textContent, 10, 10);
    doc.autoTable({
      startY: 20,
      head: [['Sr#', 'CMS No', 'Title', 'Case Type', 'Nature', 'Swal Form Details', 'Delivered To', 'Delivery Date', 'Return Date', 'Time Span', 'Court', 'Clerk Name', 'Profile Details']],
      body: files.map((f, i) => {
        const profile = getProfiles().find(p => p.name === f.deliveredTo && p.type === f.deliveredType) || {};
        const nature = f.caseType === 'criminal' && f.firNo
          ? `${f.nature}, FIR No: ${f.firNo}, Year: ${f.firYear || ''}, U/S: ${f.firUs || ''}, Police Station: ${f.policeStation || ''}`
          : f.nature;
        const swalDetails = f.sentToCopyAgency ? `${f.swalFormNo}, ${formatDate(f.swalDate)}` : '';
        const profileDetails = Object.entries(profile)
          .filter(([key]) => key !== 'photo' && key !== 'name' && key !== 'type')
          .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}: ${value}`)
          .join(', ');
        return [i + 1, f.cmsNo, f.title, f.caseType, nature, swalDetails, `${f.deliveredTo} (${f.deliveredType})`, formatDate(f.deliveredAt, true), f.returned ? formatDate(f.returnedAt, true) : '', f.timeSpan || '', f.court, f.clerkName, profileDetails];
      }),
      styles: { fontSize: 8 },
      columnStyles: { 4: { cellWidth: 30 }, 12: { cellWidth: 30 } },
    });
    doc.save(`${$('reportTitle').textContent.replace(/\s+/g, '_')}.pdf`);
  }
}

function printDashboardReport() {
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
      <head><title>${$('reportTitle').textContent}</title>
      <style>
        body { font-family: Arial, sans-serif; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        th { background: #f5f5f5; }
      </style>
      </head>
      <body>
        <h2>${$('reportTitle').textContent}</h2>
        ${$('dashboardReportTable').outerHTML}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
}

// Profile Details Modal
function showProfileDetails(name, type) {
  const profile = getProfiles().find(p => p.name === name && p.type === type) || {};
  $('profileModalTitle').textContent = `${name} (${type})`;
  const table = $('profileModalTable');
  table.innerHTML = '';
  for (const [key, value] of Object.entries(profile)) {
    if (key === 'photo') {
      $('profileModalPhoto').src = value || '';
      $('profileModalPhoto').style.display = value ? 'block' : 'none';
      continue;
    }
    const row = document.createElement('tr');
    row.innerHTML = `<th>${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</th><td>${value}</td>`;
    table.appendChild(row);
  }
  $('profileModal').style.display = 'block';
}

function closeProfileModal() {
  $('profileModal').style.display = 'none';
}

// New File Entry
$('fileForm').onsubmit = async e => {
  e.preventDefault();
  $('loadingIndicator').style.display = 'block';
  const userProfile = getUserProfile();
  if (!userProfile.pin) {
    showToast('Please set up your profile first.', 5000);
    navigate('settings');
    return;
  }
  const pin = await promptPin();
  if (pin !== userProfile.pin) {
    showToast('Incorrect PIN.', 5000);
    $('loadingIndicator').style.display = 'none';
    return;
  }
  const newFile = {
    id: Date.now().toString(), // Unique ID for each delivery
    caseType: $('caseType').value,
    cmsNo: $('cmsNo').value,
    title: `${$('petitioner').value} vs. ${$('respondent').value}`,
    nature: $('nature').value,
    firNo: $('firNo').value,
    firYear: $('firYear').value,
    firUs: $('firUs').value,
    policeStation: $('policeStation').value,
    dateType: $('dateType').value,
    date: $('date').value,
    deliveredTo: $('deliveredTo').value,
    deliveredType: $('deliveredType').value,
    sentToCopyAgency: $('copyAgency').checked,
    swalFormNo: $('swalFormNo').value,
    swalDate: $('swalDate').value,
    deliveredAt: new Date().toISOString(),
    court: userProfile.courtName,
    clerkName: userProfile.clerkName,
    returned: false,
  };
  const files = getFiles();
  files.push(newFile);
  saveFiles(files);
  showToast('File saved and delivered successfully!');
  $('fileForm').reset();
  toggleCriminalFields();
  toggleCopyAgency();
  $('loadingIndicator').style.display = 'none';
};

function toggleCriminalFields() {
  $('criminalFields').style.display = $('caseType').value === 'criminal' ? 'block' : 'none';
}

function autoFillCMS() {
  const cmsNo = $('cmsNo').value;
  const files = getFiles();
  const existing = files.find(f => f.cmsNo === cmsNo && !f.returned);
  if (existing) {
    $('caseType').value = existing.caseType;
    toggleCriminalFields();
    const [petitioner, respondent] = existing.title.split(' vs. ');
    $('petitioner').value = petitioner;
    $('respondent').value = respondent;
    $('nature').value = existing.nature;
    $('firNo').value = existing.firNo || '';
    $('firYear').value = existing.firYear || '';
    $('firUs').value = existing.firUs || '';
    $('policeStation').value = existing.policeStation || '';
    $('dateType').value = existing.dateType;
    $('date').value = existing.date;
  }
}

function toggleCopyAgency() {
  $('copyAgencyFields').style.display = $('copyAgency').checked ? 'block' : 'none';
  $('swalFormNo').required = $('copyAgency').checked;
  $('swalDate').required = $('copyAgency').checked;
}

// Profile Suggestions
function suggestProfiles(value, inputId) {
  const suggestions = $(inputId === 'deliveredTo' ? 'suggestions' : 'searchSuggestions');
  suggestions.innerHTML = '';
  if (!value) return;
  const profiles = getProfiles().filter(p => p.name.toLowerCase().includes(value.toLowerCase()));
  profiles.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<img src="${p.photo || ''}" style="${p.photo ? '' : 'display:none;'}">${p.name} (${p.type})`;
    li.onclick = () => {
      $(inputId).value = p.name;
      if (inputId === 'deliveredTo') $('deliveredType').value = p.type;
      suggestions.innerHTML = '';
      if (inputId === 'searchFileTaker') performDashboardSearch();
    };
    suggestions.appendChild(li);
  });
}

// Return File
function filterPendingFiles() {
  const cms = $('returnCms').value.trim();
  const title = $('returnTitle').value.trim().toLowerCase();
  const files = getFiles().filter(f => !f.returned);
  const filtered = files.filter(f =>
    (!cms || f.cmsNo.includes(cms)) &&
    (!title || f.title.toLowerCase().includes(title))
  );
  const tbody = $('pendingFilesTable').querySelector('tbody');
  tbody.innerHTML = '';
  filtered.forEach(f => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${f.cmsNo}</td>
      <td>${f.title}</td>
      <td>${f.caseType}</td>
      <td>${f.deliveredTo} (${f.deliveredType})</td>
      <td><button onclick="returnFile('${f.id}')">Return</button></td>
    `;
    tbody.appendChild(row);
  });
}

async function returnFile(fileId) {
  const userProfile = getUserProfile();
  const pin = await promptPin();
  if (pin !== userProfile.pin) {
    showToast('Incorrect PIN.', 5000);
    return;
  }
  const files = getFiles();
  const file = files.find(f => f.id === fileId);
  if (!file) return;
  file.returned = true;
  file.returnedAt = new Date().toISOString();
  const delivered = new Date(file.deliveredAt);
  const returned = new Date(file.returnedAt);
  const diff = Math.round((returned - delivered) / (1000 * 60 * 60 * 24));
  file.timeSpan = `${diff} day${diff !== 1 ? 's' : ''}`;
  saveFiles(files);
  showToast('File returned successfully!');
  filterPendingFiles();
}

// File Fetcher
function resetFileFetcher() {
  $('profileForm').style.display = 'none';
  $('profileSearchSection').style.display = 'none';
  $('profileList').style.display = 'none';
  $('profileForm').reset();
  toggleProfileFields();
}

function showProfileForm() {
  $('profileForm').style.display = 'block';
  $('profileSearchSection').style.display = 'none';
  $('profileList').style.display = 'none';
}

function showProfileSearch() {
  $('profileForm').style.display = 'none';
  $('profileSearchSection').style.display = 'block';
  $('profileList').style.display = 'block';
  renderProfiles();
}

function toggleProfileFields() {
  const type = $('profileType').value;
  const fields = $('profileFields');
  fields.innerHTML = '';
  let html = '<label>Cell No: <span class="required">*</span><input type="text" id="cellNo" required placeholder="0300-1234567" /></label>';
  if (type === 'advocate') {
    html += `
      <label>Advocate Name: <span class="required">*</span><input type="text" id="advocateName" required /></label>
      <label>Advocate Cell: <input type="text" id="advocateCell" placeholder="0300-1234567" /></label>
      <label>Chamber No: <input type="text" id="chamberNo" /></label>
    `;
  } else if (type === 'colleague' || type === 'other') {
    html += `<label>Details: <input type="text" id="details" /></label>`;
  }
  fields.innerHTML = html;

  // Attach mobile formatters
  const cellNo = $('cellNo');
  const advocateCell = $('advocateCell');
  if (cellNo) {
    cellNo.oninput = () => formatMobile(cellNo);
    formatMobile(cellNo);
  }
  if (advocateCell) {
    advocateCell.oninput = () => formatMobile(advocateCell);
    formatMobile(advocateCell);
  }
}

function formatMobile(input) {
  let value = input.value.replace(/\D/g, '');
  if (value.length > 4) {
    value = `${value.slice(0, 4)}-${value.slice(4, 11)}`;
  }
  input.value = value;
}

$('profileForm').onsubmit = async e => {
  e.preventDefault();
  $('loadingIndicator').style.display = 'block';
  const userProfile = getUserProfile();
  const pin = await promptPin();
  if (pin !== userProfile.pin) {
    showToast('Incorrect PIN.', 5000);
    $('loadingIndicator').style.display = 'none';
    return;
  }
  const profiles = getProfiles();
  const photo = $('profilePhoto').files[0];
  let photoUrl = '';
  if (photo) {
    photoUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(photo);
    });
  }
  const profile = {
    name: $('profileName').value,
    type: $('profileType').value,
    cellNo: $('cellNo').value,
    photo: photoUrl || profiles[parseInt($('profileForm').dataset.editIndex)]?.photo || '',
  };
  if (profile.type === 'advocate') {
    profile.advocateName = $('advocateName').value;
    profile.advocateCell = $('advocateCell').value;
    profile.chamberNo = $('chamberNo').value;
  } else if (profile.type === 'colleague' || profile.type === 'other') {
    profile.details = $('details').value;
  }
  const editIndex = parseInt($('profileForm').dataset.editIndex);
  if (!isNaN(editIndex)) {
    profiles[editIndex] = profile;
  } else {
    profiles.push(profile);
  }
  saveProfiles(profiles);
  showToast('Profile saved successfully!');
  $('profileForm').reset();
  $('profileForm').dataset.editIndex = '';
  $('photoPreview').style.display = 'none';
  toggleProfileFields();
  showProfileSearch();
  renderProfiles();
  $('loadingIndicator').style.display = 'none';
};

$('profilePhoto').onchange = () => {
  const file = $('profilePhoto').files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      $('photoPreview').src = reader.result;
      $('photoPreview').style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
};

function renderProfiles() {
  const type = $('profileFilterType').value;
  const search = $('profileSearch').value.trim().toLowerCase();
  let profiles = getProfiles();
  if (type) profiles = profiles.filter(p => p.type === type);
  if (search) {
    profiles = profiles.filter(p =>
      p.name.toLowerCase().includes(search) ||
      p.cellNo.includes(search) ||
      p.chamberNo?.includes(search)
    );
  }
  const tbody = $('profileTable').querySelector('tbody');
  tbody.innerHTML = '';
  profiles.forEach((p, i) => {
    const filesDelivered = getFiles().filter(f => f.deliveredTo === p.name && f.deliveredType === p.type).length;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${p.photo || ''}" style="width:40px;height:40px;border-radius:50%;${p.photo ? '' : 'display:none;'}" /></td>
      <td>${p.name}</td>
      <td>${p.type}</td>
      <td>${p.cellNo}</td>
      <td>${p.chamberNo || ''}</td>
      <td>${filesDelivered}</td>
      <td>
        <button onclick="editProfile(${i})">Edit</button>
        <button onclick="deleteProfile(${i})">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function editProfile(index) {
  const profiles = getProfiles();
  const p = profiles[index];
  $('profileType').value = p.type;
  toggleProfileFields();
  $('profileName').value = p.name;
  $('cellNo').value = p.cellNo;
  if (p.type === 'advocate') {
    $('advocateName').value = p.advocateName;
    $('advocateCell').value = p.advocateCell;
    $('chamberNo').value = p.chamberNo;
  } else if (p.type === 'colleague' || p.type === 'other') {
    $('details').value = p.details;
  }
  $('photoPreview').src = p.photo || '';
  $('photoPreview').style.display = p.photo ? 'block' : 'none';
  $('profileForm').dataset.editIndex = index;
  showProfileForm();
}

function deleteProfile(index) {
  if (!confirm('Are you sure you want to delete this profile?')) return;
  const profiles = getProfiles();
  profiles.splice(index, 1);
  saveProfiles(profiles);
  renderProfiles();
  showToast('Profile deleted successfully!');
}

function triggerImport() {
  $('profileImport').click();
}

function importProfiles() {
  const file = $('profileImport').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      const profiles = getProfiles();
      profiles.push(...imported);
      saveProfiles(profiles);
      showToast('Profiles imported successfully!');
      showProfileSearch();
      renderProfiles();
    } catch (e) {
      showToast('Invalid file format.', 5000);
    }
  };
  reader.readAsText(file);
}

function exportProfiles() {
  const profiles = getProfiles();
  const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'profiles.json';
  a.click();
  URL.revokeObjectURL(url);
}

// User Profile
$('settingsForm').onsubmit = async e => {
  e.preventDefault();
  $('loadingIndicator').style.display = 'block';
  const photo = $('userPhoto').files[0];
  let photoUrl = '';
  if (photo) {
    photoUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(photo);
    });
  }
  const profile = {
    clerkName: $('clerkName').value,
    judgeName: $('judgeName').value,
    courtName: $('courtName').value,
    mobile: $('mobile').value,
    cnic: $('cnic').value,
    pin: $('pin').value,
    email: $('email').value,
    photo: photoUrl || getUserProfile().photo || '',
  };
  saveUserProfile(profile);
  showToast('Profile saved successfully!');
  displaySavedProfile();
  $('loadingIndicator').style.display = 'none';
};

function displaySavedProfile() {
  const profile = getUserProfile();
  if (!profile.clerkName) {
    $('settingsForm').style.display = 'block';
    $('savedProfile').style.display = 'none';
    $('setupMessage').style.display = 'block';
    return;
  }
  $('savedClerkName').textContent = profile.clerkName;
  $('savedJudgeName').textContent = profile.judgeName;
  $('savedCourtName').textContent = profile.courtName;
  $('savedMobile').textContent = profile.mobile;
  $('savedMobile').href = `tel:${profile.mobile}`;
  $('savedUserPhoto').src = profile.photo || '';
  $('savedUserPhoto').style.display = profile.photo ? 'block' : 'none';
  $('settingsForm').style.display = 'none';
  $('savedProfile').style.display = 'block';
  $('setupMessage').style.display = 'none';
  $('changePinBtn').style.display = profile.cnic || profile.email ? 'inline-block' : 'none';
}

function editUserProfile() {
  const profile = getUserProfile();
  $('clerkName').value = profile.clerkName;
  $('judgeName').value = profile.judgeName;
  $('courtName').value = profile.courtName;
  $('mobile').value = profile.mobile;
  $('cnic').value = profile.cnic;
  $('pin').value = profile.pin;
  $('email').value = profile.email;
  $('userPhotoPreview').src = profile.photo || '';
  $('userPhotoPreview').style.display = profile.photo ? 'block' : 'none';
  $('settingsForm').style.display = 'block';
  $('savedProfile').style.display = 'none';
  $('setupMessage').style.display = 'block';
}

$('userPhoto').onchange = () => {
  const file = $('userPhoto').files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      $('userPhotoPreview').src = reader.result;
      $('userPhotoPreview').style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
};

function toggleSaveButton() {
  $('saveProfileBtn').disabled = !$('agreeTerms').checked;
}

function showDisclaimerModal() {
  $('disclaimerModal').style.display = 'block';
}

async function promptPin() {
  return new Promise(resolve => {
    $('pinModal').style.display = 'block';
    $('pinInput').value = '';
    $('pinInput').focus();
    $('pinInput').onkeypress = e => {
      if (e.key === 'Enter') submitPin();
    };
    window.submitPin = () => {
      const pin = $('pinInput').value;
      $('pinModal').style.display = 'none';
      resolve(pin);
    };
  });
}

function showChangePin() {
  $('changePinModal').style.display = 'block';
  $('resetCnic').value = '';
  $('resetPin').value = '';
}

function hideChangePin() {
  $('changePinModal').style.display = 'none';
}

function changePin() {
  const profile = getUserProfile();
  const input = $('resetCnic').value;
  if (input !== profile.cnic && input !== profile.email) {
    showToast('Invalid CNIC or Email.', 5000);
    return;
  }
  profile.pin = $('resetPin').value;
  saveUserProfile(profile);
  showToast('PIN changed successfully!');
  hideChangePin();
  displaySavedProfile();
}

// Dark Mode
function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}

// Backup and Restore
function backupData() {
  const data = {
    files: getFiles(),
    profiles: getProfiles(),
    userProfile: getUserProfile(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cft_backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

function triggerRestore() {
  $('dataRestore').click();
}

function restoreData() {
  const file = $('dataRestore').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.files) saveFiles(data.files);
      if (data.profiles) saveProfiles(data.profiles);
      if (data.userProfile) saveUserProfile(data.userProfile);
      showToast('Data restored successfully!');
      displaySavedProfile();
      if ($('dashboard').classList.contains('active')) updateDashboard();
      if ($('fileFetcher').classList.contains('active')) resetFileFetcher();
      if ($('return').classList.contains('active')) filterPendingFiles();
    } catch (e) {
      showToast('Invalid backup file.', 5000);
    }
  };
  reader.readAsText(file);
}

// Offline Support
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
function saveOfflineQueue() {
  localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
}

function queueOfflineAction(action, data) {
  offlineQueue.push({ action, data, timestamp: new Date().toISOString() });
  saveOfflineQueue();
  showToast('Action queued offline. Will sync when online.', 5000);
}

async function syncOfflineQueue() {
  if (!navigator.onLine || !offlineQueue.length) return;
  const userProfile = getUserProfile();
  for (const { action, data } of offlineQueue) {
    if (action === 'saveFile') {
      const files = getFiles();
      files.push(data);
      saveFiles(files);
    } else if (action === 'returnFile') {
      const files = getFiles();
      const file = files.find(f => f.id === data.id);
      if (file) {
        file.returned = true;
        file.returnedAt = data.returnedAt;
        file.timeSpan = data.timeSpan;
        saveFiles(files);
      }
    } else if (action === 'saveProfile') {
      const profiles = getProfiles();
      profiles.push(data);
      saveProfiles(profiles);
    }
  }
  offlineQueue = [];
  saveOfflineQueue();
  showToast('Offline actions synced successfully!');
}

// Event Listeners
window.onload = () => {
  const profile = getUserProfile();
  if (profile.clerkName) {
    const screen = localStorage.getItem('currentScreen') || 'dashboard';
    navigate(screen);
    displaySavedProfile();
  } else {
    navigate('settings');
  }
  if (localStorage.getItem('darkMode') === 'true') document.body.classList.add('dark-mode');
  syncOfflineQueue();
};

window.addEventListener('online', syncOfflineQueue);

// Close Sidebar on Outside Click
document.addEventListener('click', e => {
  const sidebar = $('sidebar');
  const menuBtn = $('menuBtn');
  const reportPanel = $('dashboardReportPanel');
  if (window.innerWidth <= 768 && sidebar.classList.contains('active') &&
      !sidebar.contains(e.target) && !menuBtn.contains(e.target) &&
      !reportPanel.contains(e.target)) {
    sidebar.classList.remove('active');
    document.querySelector('.sidebar-overlay')?.remove();
  }
});

// Close Dashboard Report on Outside Click
$('dashboardReportPanel').onclick = e => {
  if (e.target === $('dashboardReportPanel')) {
    $('dashboardReportPanel').style.display = 'none';
    $('sidebar').classList.remove('active');
    document.querySelector('.sidebar-overlay')?.remove();
  }
};

// Debounce Search Inputs
let searchTimeout;
['searchTitle', 'searchCms', 'searchFileTaker'].forEach(id => {
  $(id).addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performDashboardSearch, 300);
  });
});

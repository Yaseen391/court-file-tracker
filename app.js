// ----- Utility Functions -----
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const yr = d.getFullYear();
  return `${day}/${mon}/${yr}`;
}

function calculateDuration(startDate, endDate) {
  if (!startDate) return "";
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const diffMs = end - start;
  if (diffMs < 0) return "0m";
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${days}d ${hours}h ${minutes}m`;
}

function hashPin(pin) {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    hash = ((hash << 5) - hash) + pin.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString();
}

function formatMobile(input) {
  let value = input.value.replace(/[^\d]/g, '');
  if (value.length > 11) value = value.slice(0, 11);
  if (value.length > 3) {
    value = `+92${value.slice(0, 3)}-${value.slice(3)}`;
  } else if (value.length > 0) {
    value = `+92${value}`;
  }
  input.value = value;
}

function formatCnic(input) {
  let value = input.value.replace(/[^\d]/g, '');
  if (value.length > 13) value = value.slice(0, 13);
  if (value.length > 5) {
    value = `${value.slice(0, 5)}-${value.slice(5, 12)}-${value.slice(12)}`;
  } else if (value.length > 0) {
    value = value;
  }
  input.value = value;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.innerText = message;
  toast.style.display = "block";
  setTimeout(() => { toast.style.display = "none"; }, 3000);
}

// ----- Navigation -----
function navigate(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");

  const sidebar = document.getElementById("sidebar");
  if (window.innerWidth <= 768) {
    sidebar.classList.remove("active");
  }

  if (screenId === "dashboard") updateDashboard();
  if (screenId === "profiles") renderProfiles();
  if (screenId === "return") filterPendingFiles();
  if (screenId === "search") performSearch();
}

// ----- Local Storage -----
function getFiles() {
  return JSON.parse(localStorage.getItem("courtFiles") || "[]");
}

function saveFiles(files) {
  localStorage.setItem("courtFiles", JSON.stringify(files));
}

function getProfiles() {
  return JSON.parse(localStorage.getItem("profiles") || "[]");
}

function saveProfiles(profiles) {
  localStorage.setItem("profiles", JSON.stringify(profiles));
}

// ----- Initial Setup -----
window.onload = function () {
  history.pushState(null, null, location.href);
  const clerkName = localStorage.getItem("clerkName");
  navigate("settings");
  if (clerkName) {
    showSavedProfile();
  } else {
    document.getElementById("setupMessage").style.display = "block";
    document.querySelectorAll(".sidebar button").forEach(btn => btn.disabled = true);
  }

  // Initialize input masks
  document.getElementById("mobile").addEventListener("input", () => formatMobile(document.getElementById("mobile")));
  document.getElementById("cnic").addEventListener("input", () => formatCnic(document.getElementById("cnic")));
  document.getElementById("resetMobile").addEventListener("input", () => formatMobile(document.getElementById("resetMobile")));
  document.getElementById("resetCnic").addEventListener("input", () => formatCnic(document.getElementById("resetCnic")));
};

// ----- Window Controls -----
document.getElementById("minimizeBtn").addEventListener("click", () => {
  alert("Minimize not supported in PWA. Simulating by reloading.");
  window.location.reload();
});

document.getElementById("resizeBtn").addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
});

document.getElementById("closeBtn").addEventListener("click", () => {
  window.location.reload(); // Simulate close
});

// ----- Settings -----
function showSavedProfile() {
  const clerkName = localStorage.getItem("clerkName");
  const judgeName = localStorage.getItem("judgeName");
  const courtName = localStorage.getItem("courtName");
  const mobile = localStorage.getItem("mobile");
  const cnic = localStorage.getItem("cnic");
  const userPhoto = localStorage.getItem("userPhoto");

  document.getElementById("savedClerkName").innerText = clerkName || "";
  document.getElementById("savedJudgeName").innerText = judgeName || "";
  document.getElementById("savedCourtName").innerText = courtName || "";
  document.getElementById("savedMobile").innerText = mobile || "";
  document.getElementById("savedCnic").innerText = cnic || "";
  document.getElementById("savedUserPhoto").src = userPhoto || "";
  document.getElementById("savedUserPhoto").style.display = userPhoto ? "block" : "none";

  document.getElementById("savedProfile").style.display = "block";
  document.getElementById("settingsForm").style.display = "none";
  document.getElementById("setupMessage").style.display = "none";
  document.querySelectorAll(".sidebar button").forEach(btn => btn.disabled = false);
}

function editUserProfile() {
  document.getElementById("savedProfile").style.display = "none";
  document.getElementById("settingsForm").style.display = "block";
  document.getElementById("clerkName").value = localStorage.getItem("clerkName") || "";
  document.getElementById("judgeName").value = localStorage.getItem("judgeName") || "";
  document.getElementById("courtName").value = localStorage.getItem("courtName") || "";
  document.getElementById("mobile").value = localStorage.getItem("mobile") || "";
  document.getElementById("cnic").value = localStorage.getItem("cnic") || "";
  document.getElementById("userPhotoPreview").src = localStorage.getItem("userPhoto") || "";
  document.getElementById("userPhotoPreview").style.display = localStorage.getItem("userPhoto") ? "block" : "none";
}

document.getElementById("settingsForm").addEventListener("submit", function (e) {
  e.preventDefault();
  showPinPrompt(() => {
    const clerkName = document.getElementById("clerkName").value.trim();
    const judgeName = document.getElementById("judgeName").value.trim();
    const courtName = document.getElementById("courtName").value.trim();
    const mobile = document.getElementById("mobile").value.trim();
    const cnic = document.getElementById("cnic").value.trim();
    const pin = document.getElementById("pin").value;
    const userPhoto = document.getElementById("userPhotoPreview").getAttribute("data-img") || "";

    if (!clerkName || !judgeName || !courtName || !mobile || !pin) {
      showToast("All required fields must be filled.");
      return;
    }

    if (pin.length !== 4) {
      showToast("PIN must be 4 digits.");
      return;
    }

    localStorage.setItem("clerkName", clerkName);
    localStorage.setItem("judgeName", judgeName);
    localStorage.setItem("courtName", courtName);
    localStorage.setItem("mobile", mobile);
    localStorage.setItem("cnic", cnic);
    localStorage.setItem("pinHash", hashPin(pin));
    localStorage.setItem("userPhoto", userPhoto);

    showSavedProfile();
    showToast("User Profile Saved.");
    navigate("dashboard");
  });
});

document.getElementById("userPhoto").addEventListener("change", function () {
  const file = this.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement("canvas");
      const maxSize = 100;
      let w = img.width;
      let h = img.height;

      if (w > h) {
        if (w > maxSize) {
          h *= maxSize / w;
          w = maxSize;
        }
      } else {
        if (h > maxSize) {
          w *= maxSize / h;
          h = maxSize;
        }
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const base64 = canvas.toDataURL("image/jpeg", 0.7);
      document.getElementById("userPhotoPreview").src = base64;
      document.getElementById("userPhotoPreview").style.display = "block";
      document.getElementById("userPhotoPreview").setAttribute("data-img", base64);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// ----- PIN Security -----
let pinCallback = null;

function showPinPrompt(callback) {
  pinCallback = callback;
  document.getElementById("pinModal").style.display = "block";
  document.getElementById("pinInput").value = "";
  document.getElementById("pinInput").focus();
}

function submitPin() {
  const pin = document.getElementById("pinInput").value;
  const storedHash = localStorage.getItem("pinHash");
  if (hashPin(pin) === storedHash) {
    document.getElementById("pinModal").style.display = "none";
    if (pinCallback) pinCallback();
  } else {
    showToast("Incorrect PIN.");
  }
}

function showForgotPin() {
  document.getElementById("pinModal").style.display = "none";
  document.getElementById("forgotPinModal").style.display = "block";
  document.getElementById("resetMobile").value = "";
  document.getElementById("resetCnic").value = "";
  document.getElementById("resetPin").value = "";
}

function hideForgotPin() {
  document.getElementById("forgotPinModal").style.display = "none";
}

function resetPin() {
  const mobile = document.getElementById("resetMobile").value.trim();
  const cnic = document.getElementById("resetCnic").value.trim();
  const newPin = document.getElementById("resetPin").value;
  const storedMobile = localStorage.getItem("mobile");
  const storedCnic = localStorage.getItem("cnic");

  if ((mobile && mobile === storedMobile) || (cnic && cnic === storedCnic)) {
    if (newPin.length !== 4) {
      showToast("New PIN must be 4 digits.");
      return;
    }
    localStorage.setItem("pinHash", hashPin(newPin));
    document.getElementById("forgotPinModal").style.display = "none";
    showToast("PIN reset successfully.");
  } else {
    showToast("Incorrect Mobile or CNIC.");
  }
}

// ----- Modal Outside Click -----
function closeModalOnOutsideClick(e) {
  if (e.target.classList.contains("modal")) {
    e.target.style.display = "none";
  }
}

document.getElementById("pinModal").addEventListener("click", closeModalOnOutsideClick);
document.getElementById("forgotPinModal").addEventListener("click", closeModalOnOutsideClick);
document.getElementById("profileModal").addEventListener("click", closeModalOnOutsideClick);

// ----- Toggle Fields -----
function toggleCriminalFields() {
  const type = document.getElementById("caseType").value;
  document.getElementById("criminalFields").style.display = type === "criminal" ? "block" : "none";
}

function toggleCopyAgency() {
  const show = document.getElementById("copyAgency").checked;
  document.getElementById("copyAgencyFields").style.display = show ? "block" : "none";
}

function toggleProfileFields() {
  const type = document.getElementById("profileType").value;
  const container = document.getElementById("profileFields");
  container.innerHTML = "";

  if (type === "munshi") {
    container.innerHTML = `
      <label>Cell No: <span class="required">*</span><input type="text" id="cellNo" required /></label>
      <label>Advocate Name: <span class="required">*</span><input type="text" id="advocateName" required /></label>
      <label>Advocate Cell No:<input type="text" id="advocateCell" /></label>
      <label>Chamber No:<input type="text" id="chamberNo" /></label>
    `;
  } else if (type === "advocate") {
    container.innerHTML = `
      <label>Cell No: <span class="required">*</span><input type="text" id="cellNo" required /></label>
      <label>Chamber No: <span class="required">*</span><input type="text" id="chamberNo" required /></label>
    `;
  } else if (type === "colleague") {
    container.innerHTML = `
      <label>Designation: <span class="required">*</span><input type="text" id="designation" required /></label>
      <label>Cell No: <span class="required">*</span><input type="text" id="cellNo" required /></label>
      <label>Court Name:<input type="text" id="courtName" /></label>
    `;
  } else if (type === "other") {
    container.innerHTML = `
      <label>Cell No: <span class="required">*</span><input type="text" id="cellNo" required /></label>
      <label>Address:<input type="text" id="address" /></label>
      <label>ID No:<input type="text" id="idNo" /></label>
      <label>Relation to Case:<input type="text" id="relation" /></label>
    `;
  }

  document.querySelectorAll("#profileFields input[id='cellNo']").forEach(input => {
    input.addEventListener("input", () => formatMobile(input));
  });
}

// ----- CMS Auto Fill -----
function autoFillCMS() {
  const cmsNo = document.getElementById("cmsNo").value.trim();
  if (!cmsNo) return;

  const files = getFiles();
  const existing = files.find(f => f.cmsNo === cmsNo);
  if (!existing) return;

  document.getElementById("caseType").value = existing.caseType;
  document.getElementById("caseType").disabled = true;
  const [petitioner, respondent] = existing.title.split(" vs ");
  document.getElementById("petitioner").value = petitioner || "";
  document.getElementById("petitioner").disabled = true;
  document.getElementById("respondent").value = respondent || "";
  document.getElementById("respondent").disabled = true;
  document.getElementById("nature").value = existing.nature || "";
  document.getElementById("nature").disabled = true;

  document.getElementById("firNo").value = existing.firNo || "";
  document.getElementById("firNo").disabled = true;
  document.getElementById("firYear").value = existing.firYear || "";
  document.getElementById("firYear").disabled = true;
  document.getElementById("firUs").value = existing.firUs || "";
  document.getElementById("firUs").disabled = true;
  document.getElementById("policeStation").value = existing.policeStation || "";
  document.getElementById("policeStation").disabled = true;

  if (existing.decisionDate) {
    document.getElementById("dateType").value = "decision";
    document.getElementById("date").value = existing.decisionDate;
  } else if (existing.hearingDate) {
    document.getElementById("dateType").value = "hearing";
    document.getElementById("date").value = existing.hearingDate;
  }
}

// ----- Suggest Profiles -----
function suggestProfiles(value) {
  const list = document.getElementById("suggestions");
  list.innerHTML = "";
  if (value.trim().length === 0) return;

  const matches = getProfiles().filter(p =>
    p.name.toLowerCase().includes(value.toLowerCase())
  );

  matches.forEach(p => {
    const li = document.createElement("li");
    li.innerHTML = `
      ${p.photo ? `<img src="${p.photo}" alt="${p.name}">` : ""}
      <div>
        <strong>${p.name}</strong> (${p.type})<br>
        ${p.cellNo ? `Cell: ${p.cellNo}` : ""}
        ${p.chamberNo ? ` | Chamber: ${p.chamberNo}` : ""}
      </div>
    `;
    li.onclick = () => {
      document.getElementById("deliveredTo").value = p.name;
      document.getElementById("deliveredTo").disabled = true;
      document.getElementById("deliveredType").value = p.type;
      document.getElementById("deliveredType").disabled = true;
      list.innerHTML = "";
    };
    list.appendChild(li);
  });
}

// ----- New File Entry Submit -----
document.getElementById("fileForm").addEventListener("submit", function (e) {
  e.preventDefault();
  showPinPrompt(() => {
    const cmsNo = document.getElementById("cmsNo").value.trim();
    const name = document.getElementById("deliveredTo").value.trim();
    const profiles = getProfiles();
    if (!profiles.some(p => p.name === name)) {
      localStorage.setItem("pendingProfileName", name);
      showToast("Profile not found. Please add it in Profiles.");
      navigate("profiles");
      return;
    }

    const files = getFiles();
    const existing = files.find(f => f.cmsNo === cmsNo);

    if (existing && !confirm(`CMS No ${cmsNo} exists. Update existing record?`)) {
      return;
    }

    const newFile = {
      cmsNo,
      title: `${document.getElementById("petitioner").value.trim()} vs ${document.getElementById("respondent").value.trim()}`,
      caseType: document.getElementById("caseType").value,
      nature: document.getElementById("nature").value.trim(),
      firNo: document.getElementById("firNo").value.trim(),
      firYear: document.getElementById("firYear").value,
      firUs: document.getElementById("firUs").value.trim(),
      policeStation: document.getElementById("policeStation").value.trim(),
      deliveredTo: name,
      deliveredType: document.getElementById("deliveredType").value,
      decisionDate: null,
      hearingDate: null,
      returnDate: null,
      createdDate: new Date().toISOString().split("T")[0],
      deliveredDate: new Date().toISOString().split("T")[0],
      sentToCopyAgency: document.getElementById("copyAgency").checked,
      clerkName: localStorage.getItem("clerkName"),
      judgeName: localStorage.getItem("judgeName")
    };

    const dateType = document.getElementById("dateType").value;
    const date = document.getElementById("date").value;
    if (dateType === "decision") newFile.decisionDate = date;
    else newFile.hearingDate = date;

    if (newFile.sentToCopyAgency) {
      newFile.swalFormNo = document.getElementById("swalFormNo").value.trim();
      newFile.swalDate = document.getElementById("swalDate").value;
      if (!newFile.swalFormNo || !newFile.swalDate) {
        showToast("Swal Form No and Date are required.");
        return;
      }
    }

    if (existing) {
      const index = files.findIndex(f => f.cmsNo === cmsNo);
      files[index] = newFile;
    } else {
      files.push(newFile);
    }
    saveFiles(files);
    document.getElementById("fileForm").reset();
    document.getElementById("copyAgencyFields").style.display = "none";
    document.getElementById("caseType").disabled = false;
    document.getElementById("petitioner").disabled = false;
    document.getElementById("respondent").disabled = false;
    document.getElementById("nature").disabled = false;
    document.getElementById("firNo").disabled = false;
    document.getElementById("firYear").disabled = false;
    document.getElementById("firUs").disabled = false;
    document.getElementById("policeStation").disabled = false;
    document.getElementById("deliveredTo").disabled = false;
    document.getElementById("deliveredType").disabled = false;
    showToast("File saved successfully.");
    navigate("dashboard");
  });
});

// ----- Return File -----
function filterPendingFiles() {
  const cmsNo = document.getElementById("returnCms").value.trim().toLowerCase();
  const title = document.getElementById("returnTitle").value.trim().toLowerCase();
  const files = getFiles().filter(f => !f.returnDate);
  const filtered = files.filter(f =>
    (!cmsNo || f.cmsNo.toLowerCase().includes(cmsNo)) &&
    (!title || f.title.toLowerCase().includes(title))
  );

  const tbody = document.querySelector("#pendingFilesTable tbody");
  tbody.innerHTML = "";
  filtered.forEach(f => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${f.cmsNo}</td>
      <td>${f.title}</td>
      <td>${f.caseType}</td>
      <td>${f.deliveredTo} (${f.deliveredType})</td>
      <td><button onclick="markReturned('${f.cmsNo}')">Return</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function markReturned(cmsNo) {
  showPinPrompt(() => {
    const files = getFiles();
    const file = files.find(f => f.cmsNo === cmsNo);
    if (!file) {
      showToast("File not found.");
      return;
    }
    file.returnDate = new Date().toISOString().split("T")[0];
    saveFiles(files);
    document.getElementById("returnForm").reset();
    filterPendingFiles();
    showToast("Marked as returned.");
    navigate("dashboard");
  });
}

// ----- Search -----
function performSearch() {
  const cmsNo = document.getElementById("searchCms").value.trim().toLowerCase();
  const title = document.getElementById("searchTitle").value.trim().toLowerCase();
  const startDate = document.getElementById("searchStartDate").value;
  const endDate = document.getElementById("searchEndDate").value;

  const files = getFiles().filter(f => {
    const delivery = new Date(f.deliveredDate);
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    return (
      (!cmsNo || f.cmsNo.toLowerCase().includes(cmsNo)) &&
      (!title || f.title.toLowerCase().includes(title)) &&
      (!start || delivery >= start) &&
      (!end || delivery <= end)
    );
  });

  const tbody = document.querySelector("#searchResultsTable tbody");
  tbody.innerHTML = "";
  files.forEach(f => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${f.cmsNo}</td>
      <td>${f.title}</td>
      <td>${f.caseType}</td>
      <td>${formatDate(f.deliveredDate)}</td>
      <td>${f.returnDate ? formatDate(f.returnDate) : 'Pending'}</td>
      <td><a href="#" onclick="showProfileDetails('${f.deliveredTo}')">${f.deliveredTo}</a> (${f.deliveredType})</td>
      <td>${f.clerkName || ''}</td>
      <td>${f.judgeName || ''}</td>
      <td><button onclick="showFileDetails('${f.cmsNo}')">Details</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("searchResults").innerHTML = files.length ? "" : "<p>No matches found.</p>";
}

function showFileDetails(cmsNo) {
  const file = getFiles().find(f => f.cmsNo === cmsNo);
  if (!file) return;

  const details = `
    CMS No: ${file.cmsNo}<br>
    Title: ${file.title}<br>
    Case Type: ${file.caseType}<br>
    Nature: ${file.nature}<br>
    ${file.firNo ? `FIR No: ${file.firNo}<br>` : ""}
    ${file.firYear ? `FIR Year: ${file.firYear}<br>` : ""}
    ${file.firUs ? `FIR U/S: ${file.firUs}<br>` : ""}
    ${file.policeStation ? `Police Station: ${file.policeStation}<br>` : ""}
    Delivered To: ${file.deliveredTo} (${file.deliveredType})<br>
    Delivery Date: ${formatDate(file.deliveredDate)}<br>
    Return Date: ${file.returnDate ? formatDate(file.returnDate) : 'Pending'}<br>
    ${file.sentToCopyAgency ? `Swal Form No: ${file.swalFormNo}<br>Swal Date: ${formatDate(file.swalDate)}<br>` : ""}
    Clerk: ${file.clerkName || ''}<br>
    Judge: ${file.judgeName || ''}
  `;
  alert(details); // Replace with modal in production
}

function exportSearchReport() {
  const table = document.getElementById("searchResultsTable");
  const rows = Array.from(table.rows);
  const csv = rows.map(row => Array.from(row.cells).map(cell => cell.innerText.replace(/,/g, '')).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.download = "search_report.csv";
  link.href = URL.createObjectURL(blob);
  link.click();
}

function printSearchReport() {
  const content = document.getElementById("searchResults").innerHTML;
  const win = window.open("", "", "width=900,height=600");
  win.document.write("<html><head><title>Print Report</title></head><body>");
  win.document.write(content);
  win.document.write("</body></html>");
  win.print();
  win.close();
}

// ----- Profile Modal -----
function showProfileDetails(name) {
  const profile = getProfiles().find(p => p.name === name);
  if (!profile) return;

  document.getElementById("profileModalTitle").innerText = profile.name;
  document.getElementById("profileModalPhoto").src = profile.photo || "";
  document.getElementById("profileModalPhoto").style.display = profile.photo ? "block" : "none";

  const table = document.getElementById("profileModalTable");
  table.innerHTML = `
    <tr><th>Type</th><td>${profile.type}</td></tr>
    ${profile.cellNo ? `<tr><th>Cell</th><td><a href="tel:${profile.cellNo}">${profile.cellNo}</a></td></tr>` : ""}
    ${profile.chamberNo ? `<tr><th>Chamber</th><td>${profile.chamberNo}</td></tr>` : ""}
    ${profile.advocateName ? `<tr><th>Advocate</th><td>${profile.advocateName}</td></tr>` : ""}
    ${profile.advocateCell ? `<tr><th>Advocate Cell</th><td>${profile.advocateCell}</td></tr>` : ""}
    ${profile.designation ? `<tr><th>Designation</th><td>${profile.designation}</td></tr>` : ""}
    ${profile.courtName ? `<tr><th>Court</th><td>${profile.courtName}</td></tr>` : ""}
    ${profile.address ? `<tr><th>Address</th><td>${profile.address}</td></tr>` : ""}
    ${profile.idNo ? `<tr><th>ID No</th><td>${profile.idNo}</td></tr>` : ""}
    ${profile.relation ? `<tr><th>Relation</th><td>${profile.relation}</td></tr>` : ""}
  `;
  document.getElementById("profileModal").style.display = "block";
}

function closeProfileModal() {
  document.getElementById("profileModal").style.display = "none";
}

// ----- Dashboard Logic -----
function updateDashboard() {
  const files = getFiles();
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().split("T")[0];

  const deliveriesToday = files.filter(f => f.deliveredDate === today);
  const returnsToday = files.filter(f => f.returnDate === today);
  const notReturned = files.filter(f => !f.returnDate);
  const dueTomorrow = files.filter(f => f.hearingDate === tomorrow && !f.returnDate);
  const overdue = files.filter(f => {
    const delivery = f.deliveredDate || f.createdDate;
    return !f.returnDate && delivery < tenDaysAgo;
  });
  const alertProfilers = [...new Set(
    files.filter(f => !f.returnDate && !f.sentToCopyAgency && (f.deliveredDate || f.createdDate) < oneDayAgo)
      .map(f => f.deliveredTo)
  )];

  document.getElementById("cardDeliveries").innerHTML = `<button onclick="showDashboardReport('deliveries')">Deliveries Today: ${deliveriesToday.length}</button>`;
  document.getElementById("cardReturns").innerHTML = `<button onclick="showDashboardReport('returns')">Returns Today: ${returnsToday.length}</button>`;
  document.getElementById("cardPending").innerHTML = `<button onclick="showDashboardReport('pending')">Files Not Returned: ${notReturned.length}</button>`;
  document.getElementById("cardTomorrow").innerHTML = `<button onclick="showDashboardReport('tomorrow')">Hearings Tomorrow: ${dueTomorrow.length}</button>`;
  document.getElementById("cardOverdue").innerHTML = `<button onclick="showDashboardReport('overdue')">Files Pending >10 Days: ${overdue.length}</button>`;
  document.getElementById("cardAlertProfilers").innerHTML = `<button onclick="showDashboardReport('alertProfilers')">Alert Profilers: ${alertProfilers.length}</button>`;
}

// ----- Dashboard Report View -----
function showDashboardReport(type) {
  const files = getFiles();
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().split("T")[0];
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  let filtered = [];
  let title = "";

  if (type === "deliveries") {
    filtered = files.filter(f => f.deliveredDate === today);
    title = "Files Delivered Today";
  } else if (type === "returns") {
    filtered = files.filter(f => f.returnDate === today);
    title = "Files Returned Today";
  } else if (type === "pending") {
    filtered = files.filter(f => !f.returnDate);
    title = "Files Not Yet Returned";
  } else if (type === "tomorrow") {
    filtered = files.filter(f => f.hearingDate === tomorrow && !f.returnDate);
    title = "Hearings Scheduled for Tomorrow";
  } else if (type === "overdue") {
    filtered = files.filter(f => {
      const delivery = f.deliveredDate || f.createdDate;
      return !f.returnDate && delivery < tenDaysAgo;
    });
    title = "Files Pending >10 Days";
  } else if (type === "alertProfilers") {
    const overdue = files.filter(f => {
      const delivery = f.deliveredDate || f.createdDate;
      return !f.returnDate && !f.sentToCopyAgency && delivery < oneDayAgo;
    });
    filtered = [...new Set(overdue.map(f => f.deliveredTo))].map(name => {
      const profile = getProfiles().find(p => p.name === name) || { name, type: "Unknown" };
      return { ...profile, overdueCount: overdue.filter(f => f.deliveredTo === name).length };
    });
    title = "Alert Profilers (Overdue Files)";
  }

  const tbody = document.querySelector("#dashboardReportTable tbody");
  tbody.innerHTML = "";
  if (type === "alertProfilers") {
    filtered.forEach((p, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td><a href="#" onclick="showProfileDetails('${p.name}')">${p.name}</a> (${p.type})</td>
        <td>-</td>
        <td>Overdue: ${p.overdueCount}</td>
        <td>-</td>
        <td>${p.cellNo || ''}</td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    filtered.forEach((f, i) => {
      const profile = getProfiles().find(p => p.name === f.deliveredTo) || {};
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${f.cmsNo}</td>
        <td>${f.title}</td>
        <td>${f.caseType}</td>
        <td>${f.nature}</td>
        <td><a href="#" onclick="showProfileDetails('${f.deliveredTo}')">${f.deliveredTo}</a> (${f.deliveredType})</td>
        <td>${formatDate(f.deliveredDate)}</td>
        <td>${f.returnDate ? formatDate(f.returnDate) : "Pending"}</td>
        <td>${calculateDuration(f.deliveredDate, f.returnDate)}</td>
        <td>${f.clerkName || ''} / ${f.judgeName || ''}</td>
        <td>${profile.cellNo || ''}${profile.chamberNo ? `, Chamber: ${profile.chamberNo}` : ''}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById("reportTitle").innerText = title + ` (${filtered.length})`;
  document.getElementById("dashboardReportPanel").style.display = "block";
  document.getElementById("dashboardReportPanel").addEventListener("click", (e) => {
    if (e.target === document.getElementById("dashboardReportPanel")) {
      document.getElementById("dashboardReportPanel").style.display = "none";
    }
  });
}

function exportDashboardReport() {
  const table = document.getElementById("dashboardReportTable");
  const rows = Array.from(table.rows);
  const csv = rows.map(row => Array.from(row.cells).map(cell => cell.innerText.replace(/,/g, '')).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.download = "dashboard_report.csv";
  link.href = URL.createObjectURL(blob);
  link.click();
}

function printDashboardReport() {
  const content = document.getElementById("dashboardReportPanel").innerHTML;
  const win = window.open("", "", "width=900,height=600");
  win.document.write("<html><head><title>Print Report</title></head><body>");
  win.document.write(content);
  win.document.write("</body></html>");
  win.print();
  win.close();
}

// ----- Profile Manager -----
document.getElementById("profilePhoto").addEventListener("change", function () {
  const file = this.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement("canvas");
      const maxSize = 100;
      let w = img.width;
      let h = img.height;

      if (w > h) {
        if (w > maxSize) {
          h *= maxSize / w;
          w = maxSize;
        }
      } else {
        if (h > maxSize) {
          w *= maxSize / h;
          h = maxSize;
        }
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const base64 = canvas.toDataURL("image/jpeg", 0.7);
      document.getElementById("photoPreview").src = base64;
      document.getElementById("photoPreview").style.display = "block";
      document.getElementById("photoPreview").setAttribute("data-img", base64);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

document.getElementById("profileForm").addEventListener("submit", function (e) {
  e.preventDefault();
  showPinPrompt(() => {
    const type = document.getElementById("profileType").value;
    const name = document.getElementById("profileName").value.trim();
    const img = document.getElementById("photoPreview").getAttribute("data-img") || "";
    const isEdit = document.getElementById("profileForm").dataset.editIndex !== undefined;
    const editIndex = parseInt(document.getElementById("profileForm").dataset.editIndex);

    const extra = {};
    document.querySelectorAll("#profileFields input").forEach(input => {
      extra[input.id] = input.value.trim();
    });

    const profile = { type, name, photo: img, ...extra };
    const all = getProfiles();

    if (!isEdit && all.some(p => p.name === name)) {
      showToast("Profile already exists.");
      return;
    }

    if (isEdit) {
      all[editIndex] = profile;
    } else {
      all.push(profile);
    }
    saveProfiles(all);
    document.getElementById("profileForm").reset();
    document.getElementById("profileForm").dataset.editIndex = "";
    document.getElementById("photoPreview").style.display = "none";
    document.getElementById("photoPreview").src = "";
    renderProfiles();
    showToast("Profile saved successfully.");
  });
});

function renderProfiles() {
  const list = document.getElementById("profileList");
  list.innerHTML = "";
  const filterType = document.getElementById("profileFilterType").value;
  const searchTerm = document.getElementById("profileSearch").value.trim().toLowerCase();

  let profiles = getProfiles();
  if (filterType) {
    profiles = profiles.filter(p => p.type === filterType);
  }
  if (searchTerm) {
    profiles = profiles.filter(p =>
      p.name.toLowerCase().includes(searchTerm) ||
      (p.cellNo && p.cellNo.includes(searchTerm)) ||
      (p.chamberNo && p.chamberNo.toLowerCase().includes(searchTerm)) ||
      (p.advocateName && p.advocateName.toLowerCase().includes(searchTerm))
    );
  }

  profiles.sort((a, b) => a.name.localeCompare(b.name));

  profiles.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        ${p.photo ? `<img src="${p.photo}" style="width:40px;height:40px;border-radius:50%;">` : ""}
        <div>
          <b>${p.name}</b> (${p.type})<br>
          ${p.cellNo ? `Cell: ${p.cellNo}` : ""}
          ${p.chamberNo ? ` | Chamber: ${p.chamberNo}` : ""}
        </div>
      </div>
      <div style="margin-top:8px;">
        <button onclick="editProfile(${i})" style="background:#0066cc;color:white;border:none;border-radius:4px;padding:4px 8px;">Edit</button>
        <button onclick="deleteProfile(${i})" style="background:red;color:white;border:none;border-radius:4px;padding:4px 8px;">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });

  const pendingName = localStorage.getItem("pendingProfileName");
  if (pendingName) {
    document.getElementById("profileName").value = pendingName;
    localStorage.removeItem("pendingProfileName");
  }
}

function editProfile(index) {
  const profiles = getProfiles();
  const p = profiles[index];
  document.getElementById("profileType").value = p.type;
  document.getElementById("profileName").value = p.name;
  document.getElementById("photoPreview").src = p.photo || "";
  document.getElementById("photoPreview").style.display = p.photo ? "block" : "none";
  document.getElementById("photoPreview").setAttribute("data-img", p.photo || "");
  toggleProfileFields();
  document.querySelectorAll("#profileFields input").forEach(input => {
    input.value = p[input.id] || "";
  });
  document.getElementById("profileForm").dataset.editIndex = index;
  window.scrollTo(0, document.getElementById("profileForm").offsetTop);
}

function deleteProfile(index) {
  showPinPrompt(() => {
    const profiles = getProfiles();
    profiles.splice(index, 1);
    saveProfiles(profiles);
    renderProfiles();
    showToast("Profile deleted successfully.");
  });
}

function exportProfiles() {
  const profiles = getProfiles();
  const json = JSON.stringify(profiles, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const link = document.createElement("a");
  link.download = "profiles.json";
  link.href = URL.createObjectURL(blob);
  link.click();
}

function importProfiles() {
  const file = document.getElementById("profileImport").files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const imported = JSON.parse(e.target.result);
      const profiles = getProfiles();
      const newProfiles = [];
      let duplicates = 0;

      imported.forEach(p => {
        const existing = profiles.find(e => 
          (p.cellNo && e.cellNo === p.cellNo) || 
          (!p.cellNo && e.name === p.name)
        );
        if (!existing) {
          newProfiles.push(p);
        } else {
          duplicates++;
        }
      });

      if (newProfiles.length > 0) {
        saveProfiles([...profiles, ...newProfiles]);
      }
      renderProfiles();
      showToast(`Imported ${newProfiles.length} profiles. Skipped ${duplicates} duplicates.`);
    } catch (err) {
      showToast("Invalid JSON file.");
    }
  };
  reader.readAsText(file);
}

// ----- Event Listeners -----
document.addEventListener("click", function (e) {
  const sidebar = document.getElementById("sidebar");
  if (window.innerWidth <= 768 && sidebar.classList.contains("active")) {
    const clickedInside = sidebar.contains(e.target) || e.target.id === "menuBtn";
    if (!clickedInside) sidebar.classList.remove("active");
  }
});

window.addEventListener("popstate", () => {
  const sidebar = document.getElementById("sidebar");
  if (window.innerWidth <= 768 && sidebar.classList.contains("active")) {
    sidebar.classList.remove("active");
    history.pushState(null, null, location.href);
  }
});

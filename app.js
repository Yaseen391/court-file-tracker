function toggleCopyAgency() {
  const checked = document.getElementById("copyAgency").checked;
  document.getElementById("copyAgencyFields").style.display = checked ? "block" : "none";
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("active");
}
function navigate(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
  if (screenId === "dashboard") updateDashboard();
  if (screenId === "profiles") renderProfiles();
}

function saveSettings() {
  localStorage.setItem("clerkName", document.getElementById("clerkName").value.trim());
  localStorage.setItem("judgeName", document.getElementById("judgeName").value.trim());
  alert("Settings saved.");
}

window.onload = function () {
  document.getElementById("clerkName").value = localStorage.getItem("clerkName") || "";
  document.getElementById("judgeName").value = localStorage.getItem("judgeName") || "";
};

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

// Auto-suggestions for deliveredTo field
function suggestProfiles(inputValue) {
  const list = document.getElementById("suggestions");
  const profiles = getProfiles();
  list.innerHTML = "";

  if (inputValue.trim().length === 0) return;

  const matches = profiles.filter(p =>
    p.name.toLowerCase().includes(inputValue.toLowerCase())
  );

  matches.forEach(match => {
    const li = document.createElement("li");
    li.innerText = match.name;
    li.onclick = () => {
      document.getElementById("deliveredTo").value = match.name;
      document.getElementById("deliveredType").value = match.type;
      list.innerHTML = "";
    };
    list.appendChild(li);
  });
}

function toggleCriminalFields() {
  const type = document.getElementById("caseType").value;
  document.getElementById("criminalFields").style.display = type === "criminal" ? "block" : "none";
}

document.getElementById("fileForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const files = getFiles();

  const caseType = document.getElementById("caseType").value;
  const petitioner = document.getElementById("petitioner").value.trim();
  const respondent = document.getElementById("respondent").value.trim();
  const title = `${petitioner} vs ${respondent}`;

  const name = document.getElementById("deliveredTo").value.trim();
  const type = document.getElementById("deliveredType").value;

  // Auto-save profile if not already saved
  const existing = getProfiles();
  if (!existing.some(p => p.name === name)) {
    existing.push({ name, type });
    saveProfiles(existing);
  }

  const newFile = {
    cmsNo: document.getElementById("cmsNo").value.trim(),
    title,
    caseType,
    nature: document.getElementById("nature").value.trim(),
    decisionDate: null,
    hearingDate: null,
    firNo: document.getElementById("firNo").value.trim(),
    firYear: document.getElementById("firYear").value,
    firUs: document.getElementById("firUs").value.trim(),
    policeStation: document.getElementById("policeStation").value.trim(),
    deliveredTo: name,
    deliveredType: type,
    returnDate: null,
    createdDate: new Date().toISOString().split("T")[0],
    deliveredDate: new Date().toISOString().split("T")[0]
  };

  const dateType = document.getElementById("dateType").value;
  const date = document.getElementById("date").value;
  if (dateType === "decision") newFile.decisionDate = date;
  else newFile.hearingDate = date;
  newFile.sentToCopyAgency = document.getElementById("copyAgency").checked;

if (newFile.sentToCopyAgency) {
  newFile.swalFormNo = document.getElementById("swalFormNo").value.trim();
  newFile.swalDate = document.getElementById("swalDate").value;
  if (!newFile.swalFormNo || !newFile.swalDate) {
    alert("Swal Form No and Date are required.");
    return;
  }
}

  files.push(newFile);
  saveFiles(files);
  alert("File saved and marked as delivered.");
  document.getElementById("fileForm").reset();
  navigate("dashboard");
});

document.getElementById("returnForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const cmsNo = document.getElementById("returnCms").value.trim();
  const files = getFiles();
  const file = files.find(f => f.cmsNo === cmsNo);
  if (!file) return alert("File not found.");
  file.returnDate = new Date().toISOString().split("T")[0];
  saveFiles(files);
  alert("Marked as returned.");
  document.getElementById("returnForm").reset();
  navigate("dashboard");
});

document.getElementById("searchBox").addEventListener("input", function () {
  const term = this.value.trim().toLowerCase();
  if (term.length === 0) {
    document.getElementById("searchResults").innerHTML = "";
    return;
  }

  const results = getFiles().filter(file =>
    file.cmsNo.toLowerCase().includes(term) || file.title.toLowerCase().includes(term)
  );

  const html = results.map(f => `
    <div class="search-result">
      <strong>${f.title}</strong><br>
      CMS: ${f.cmsNo}<br>
      Type: ${f.caseType}<br>
      Nature: ${f.nature}<br>
      Delivered To: ${f.deliveredTo} (${f.deliveredType})<br>
      Returned: ${f.returnDate || 'Pending'}<br>
      --------------------------
    </div>
  `).join("");
  document.getElementById("searchResults").innerHTML = html || "<p>No matches found.</p>";
});

function updateDashboard() {
  const files = getFiles();
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().split("T")[0];

  const deliveriesToday = files.filter(f => f.deliveredDate === today);
  const returnsToday = files.filter(f => f.returnDate === today);
  const notReturned = files.filter(f => !f.returnDate);
  const dueTomorrow = files.filter(f => f.hearingDate === tomorrow && !f.returnDate);
  const overdue = files.filter(f => {
    const delivery = f.deliveredDate || f.createdDate;
    return !f.returnDate && delivery < tenDaysAgo;
  });

 document.getElementById("cardDeliveries").innerHTML = `<button onclick="showDashboardReport('deliveries')">Deliveries Today: ${deliveriesToday.length}</button>`;
document.getElementById("cardReturns").innerHTML = `<button onclick="showDashboardReport('returns')">Returns Today: ${returnsToday.length}</button>`;
document.getElementById("cardPending").innerHTML = `<button onclick="showDashboardReport('pending')">Files Not Returned: ${notReturned.length}</button>`;
document.getElementById("cardTomorrow").innerHTML = `<button onclick="showDashboardReport('tomorrow')">Hearings Tomorrow: ${dueTomorrow.length}</button>`;
document.getElementById("cardOverdue").innerHTML = `<button onclick="showDashboardReport('overdue')">Files Pending >10 Days: ${overdue.length}</button>`;}

// PROFILE MANAGER
document.getElementById("profileForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const name = document.getElementById("profileName").value.trim();
  const type = document.getElementById("profileType").value;
  const profiles = getProfiles();
  if (!name || !type) return alert("Please enter both name and type.");
  if (profiles.some(p => p.name === name)) return alert("Profile already exists.");
  profiles.push({ name, type });
  saveProfiles(profiles);
  document.getElementById("profileForm").reset();
  renderProfiles();
});

function renderProfiles() {
  const list = document.getElementById("profileList");
  list.innerHTML = "";
  const profiles = getProfiles();

  profiles.forEach((profile, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<b>${profile.name}</b> (${profile.type}) 
      <button onclick="deleteProfile(${index})" style="float:right;background:red;color:white;border:none;border-radius:4px;padding:4px;">Delete</button>`;
    list.appendChild(li);
  });
}

function deleteProfile(index) {
  const profiles = getProfiles();
  profiles.splice(index, 1);
  saveProfiles(profiles);
  renderProfiles();
}
function toggleProfileFields() {
  const type = document.getElementById("profileType").value;
  const container = document.getElementById("profileFields");
  container.innerHTML = "";

  if (type === "munshi") {
    container.innerHTML = `
      <label>Cell No:<input type="text" id="cellNo" required /></label>
      <label>Advocate Name:<input type="text" id="advocateName" required /></label>
      <label>Advocate Cell No:<input type="text" id="advocateCell" /></label>
      <label>Chamber No:<input type="text" id="chamberNo" /></label>
    `;
  } else if (type === "advocate") {
    container.innerHTML = `
      <label>Cell No:<input type="text" id="cellNo" required /></label>
      <label>Chamber No:<input type="text" id="chamberNo" required /></label>
    `;
  } else if (type === "colleague") {
    container.innerHTML = `
      <label>Designation:<input type="text" id="designation" required /></label>
      <label>Cell No:<input type="text" id="cellNo" required /></label>
      <label>Court Name:<input type="text" id="courtName" /></label>
    `;
  } else if (type === "other") {
    container.innerHTML = `
      <label>Cell No:<input type="text" id="cellNo" required /></label>
      <label>Address:<input type="text" id="address" /></label>
      <label>ID No:<input type="text" id="idNo" /></label>
      <label>Relation to Case:<input type="text" id="relation" /></label>
    `;
  }
}

// Resize and convert image to base64
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
  const type = document.getElementById("profileType").value;
  const name = document.getElementById("profileName").value.trim();
  const img = document.getElementById("photoPreview").getAttribute("data-img") || "";

  const extra = {};
  document.querySelectorAll("#profileFields input").forEach(input => {
    extra[input.id] = input.value.trim();
  });

  const profile = {
    type,
    name,
    photo: img,
    ...extra
  };

  const all = getProfiles();
  if (all.some(p => p.name === name)) return alert("Profile already exists.");
  all.push(profile);
  saveProfiles(all);
  document.getElementById("profileForm").reset();
  document.getElementById("photoPreview").style.display = "none";
  document.getElementById("photoPreview").src = "";
  renderProfiles();
});

function renderProfiles() {
  const list = document.getElementById("profileList");
  list.innerHTML = "";
  const profiles = getProfiles();

  profiles.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div style="margin-bottom:8px;">
        ${p.photo ? `<img src="${p.photo}" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;"> ` : ""}
        <b>${p.name}</b> (${p.type}) 
        <button onclick="deleteProfile(${i})" style="float:right;background:red;color:white;border:none;border-radius:4px;padding:4px;">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
}function toggleCopyAgency() {
  const checked = document.getElementById("copyAgency").checked;
  document.getElementById("copyAgencyFields").style.display = checked ? "block" : "none";
}
function autoFillCMS() {
  const cmsNo = document.getElementById("cmsNo").value.trim();
  if (!cmsNo) return;

  const files = getFiles();
  const existing = files.find(f => f.cmsNo === cmsNo);
  if (!existing) return;

  // Auto-fill the form fields
  document.getElementById("caseType").value = existing.caseType;
  const [petitioner, respondent] = existing.title.split(" vs ");
  document.getElementById("petitioner").value = petitioner || "";
  document.getElementById("respondent").value = respondent || "";
  document.getElementById("nature").value = existing.nature || "";

  document.getElementById("firNo").value = existing.firNo || "";
  document.getElementById("firYear").value = existing.firYear || "";
  document.getElementById("firUs").value = existing.firUs || "";
  document.getElementById("policeStation").value = existing.policeStation || "";

  if (existing.decisionDate) {
    document.getElementById("dateType").value = "decision";
    document.getElementById("date").value = existing.decisionDate;
  } else if (existing.hearingDate) {
    document.getElementById("dateType").value = "hearing";
    document.getElementById("date").value = existing.hearingDate;
  }
}
function showDashboardReport(type) {
  const files = getFiles();
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().split("T")[0];

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
  }

  const tbody = document.querySelector("#dashboardReportTable tbody");
  tbody.innerHTML = "";
  filtered.forEach((f, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${f.cmsNo}</td>
      <td>${f.title}</td>
      <td>${f.caseType}</td>
      <td>${f.nature}</td>
      <td>${f.deliveredTo} (${f.deliveredType})</td>
      <td>${formatDate(f.deliveredDate)}</td>
      <td>${f.returnDate ? formatDate(f.returnDate) : "Pending"}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("reportTitle").innerText = title + ` (${filtered.length})`;
  document.getElementById("dashboardReportPanel").style.display = "block";
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const yr = d.getFullYear();
  return `${day}/${mon}/${yr}`;
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

function exportDashboardReport() {
  let table = document.getElementById("dashboardReportTable");
  let rows = Array.from(table.rows);
  let csv = rows.map(row => Array.from(row.cells).map(cell => cell.innerText).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.download = "dashboard_report.csv";
  link.href = URL.createObjectURL(blob);
  link.click();
}

// Navigation
function navigate(screenId) {
  document.querySelectorAll(".screen").forEach(section => {
    section.classList.remove("active");
  });
  document.getElementById(screenId).classList.add("active");
}

// Settings Save
function saveSettings() {
  const clerk = document.getElementById("clerkName").value.trim();
  const judge = document.getElementById("judgeName").value.trim();
  localStorage.setItem("clerkName", clerk);
  localStorage.setItem("judgeName", judge);
  alert("Settings saved.");
}

// Load Settings on Start
window.onload = function () {
  document.getElementById("clerkName").value = localStorage.getItem("clerkName") || "";
  document.getElementById("judgeName").value = localStorage.getItem("judgeName") || "";
};

// File Storage Helper
function getFiles() {
  return JSON.parse(localStorage.getItem("courtFiles") || "[]");
}
function saveFiles(files) {
  localStorage.setItem("courtFiles", JSON.stringify(files));
}

// Add New File
document.getElementById("fileForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const files = getFiles();
  const newFile = {
    cmsNo: document.getElementById("cmsNo").value.trim(),
    title: document.getElementById("title").value.trim(),
    caseType: document.getElementById("caseType").value,
    nature: document.getElementById("nature").value.trim(),
    decisionDate: document.getElementById("decisionDate").value,
    hearingDate: document.getElementById("hearingDate").value,
    deliveredTo: null,
    returnDate: null
  };
  files.push(newFile);
  saveFiles(files);
  alert("File saved.");
  document.getElementById("fileForm").reset();
  navigate("dashboard");
});

// Deliver File
document.getElementById("deliverForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const cmsNo = document.getElementById("deliverCms").value.trim();
  const recipient = document.getElementById("deliveredTo").value.trim();
  const files = getFiles();
  const file = files.find(f => f.cmsNo === cmsNo);
  if (!file) return alert("File not found.");
  file.deliveredTo = recipient;
  saveFiles(files);
  alert("Marked as delivered.");
  document.getElementById("deliverForm").reset();
  navigate("dashboard");
});

// Return File
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

// Search
document.getElementById("searchBox").addEventListener("input", function () {
  const term = this.value.trim().toLowerCase();
  const results = getFiles().filter(file =>
    file.cmsNo.toLowerCase().includes(term) ||
    file.title.toLowerCase().includes(term)
  );
  const resultHTML = results.map(file => `
    <div class="search-result">
      <strong>${file.title}</strong><br>
      CMS: ${file.cmsNo}<br>
      Type: ${file.caseType}<br>
      Delivered To: ${file.deliveredTo || 'Not yet delivered'}<br>
      Returned: ${file.returnDate || 'Pending'}<br>
      -------------------------------
    </div>
  `).join("");
  document.getElementById("searchResults").innerHTML = resultHTML || "<p>No matching files found.</p>";
});

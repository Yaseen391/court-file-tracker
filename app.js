function navigate(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
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
    deliveredTo: document.getElementById("deliveredTo").value.trim(),
    deliveredType: document.getElementById("deliveredType").value,
    returnDate: null
  };

  const dateType = document.getElementById("dateType").value;
  const date = document.getElementById("date").value;
  if (dateType === "decision") newFile.decisionDate = date;
  else newFile.hearingDate = date;

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

function navigate(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
  if (screenId === "dashboard") updateDashboard();
  if (screenId === "profiles") renderProfiles();
}

function saveSettings() {
  localStorage.setItem("clerkName", document.getElementById("clerkName").value.trim());
  localStorage.setItem("judgeName", document.getElementById("judgeName").value.trim());
  localStorage.setItem("designation", document.getElementById("designation").value.trim());
  localStorage.setItem("clerkCell", document.getElementById("clerkCell").value.trim());
  alert("Settings saved.");
}

window.onload = function () {
  document.getElementById("clerkName").value = localStorage.getItem("clerkName") || "";
  document.getElementById("judgeName").value = localStorage.getItem("judgeName") || "";
  document.getElementById("designation").value = localStorage.getItem("designation") || "";
  document.getElementById("clerkCell").value = localStorage.getItem("clerkCell") || "";
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

// CMS Auto-Fill
function autoFillFromCMS() {
  const cms = document.getElementById("cmsNo").value.trim();
  const match = getFiles().find(f => f.cmsNo === cms);
  if (match) {
    document.getElementById("caseType").value = match.caseType || "";
    document.getElementById("petitioner").value = match.title?.split(" vs ")[0] || "";
    document.getElementById("respondent").value = match.title?.split(" vs ")[1] || "";
    document.getElementById("nature").value = match.nature || "";
    document.getElementById("firNo").value = match.firNo || "";
    document.getElementById("firYear").value = match.firYear || "";
    document.getElementById("firUs").value = match.firUs || "";
    document.getElementById("policeStation").value = match.policeStation || "";
    if (match.decisionDate) {
      document.getElementById("dateType").value = "decision";
      document.getElementById("date").value = match.decisionDate;
    } else if (match.hearingDate) {
      document.getElementById("dateType").value = "hearing";
      document.getElementById("date").value = match.hearingDate;
    }
  }
}

// Copy Agency toggle
function toggleCopyAgencyFields() {
  document.getElementById("copyAgencyFields").style.display =
    document.getElementById("copyAgencyCheck").checked ? "block" : "none";
}

document.getElementById("fileForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const files = getFiles();

  const cms = document.getElementById("cmsNo").value.trim();
  const caseType = document.getElementById("caseType").value;
  const petitioner = document.getElementById("petitioner").value.trim();
  const respondent = document.getElementById("respondent").value.trim();
  const title = `${petitioner} vs ${respondent}`;

  const newFile = {
    cmsNo: cms,
    caseType,
    title,
    nature: document.getElementById("nature").value.trim(),
    decisionDate: null,
    hearingDate: null,
    firNo: document.getElementById("firNo").value.trim(),
    firYear: document.getElementById("firYear").value,
    firUs: document.getElementById("firUs").value.trim(),
    policeStation: document.getElementById("policeStation").value.trim(),
    deliveredTo: document.getElementById("deliveredTo").value.trim(),
    deliveredType: document.getElementById("deliveredType").value,
    returnDate: null,
    createdDate: new Date().toISOString().split("T")[0],
    deliveredDate: new Date().toISOString().split("T")[0],
    copyAgency: document.getElementById("copyAgencyCheck").checked,
    swalNo: document.getElementById("swalNo")?.value || "",
    swalDate: document.getElementById("swalDate")?.value || ""
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

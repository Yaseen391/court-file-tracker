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
}

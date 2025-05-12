// ----- Utility Functions -----
function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    const yr = d.getFullYear();
    return `${day}/${mon}/${yr}`;
  } catch (err) {
    console.error("Error formatting date:", err);
    return "";
  }
}

function calculateTimer(startTimestamp, endTimestamp) {
  try {
    const start = startTimestamp;
    const end = endTimestamp || Date.now();
    const diffMs = end - start;
    if (diffMs < 0) return "0h 0m 0s";
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    return days > 0 ? `${days}d ${hours}h ${minutes}m ${seconds}s` : `${hours}h ${minutes}m ${seconds}s`;
  } catch (err) {
    console.error("Error calculating timer:", err);
    return "0h 0m 0s";
  }
}

function getJudgeNameOnly(judgeName) {
  try {
    if (!judgeName) return "";
    return judgeName.split(',')[0].trim();
  } catch (err) {
    console.error("Error extracting judge name:", err);
    return judgeName || "";
  }
}

function hashPin(pin) {
  try {
    let hash = 0;
    for (let i = 0; i < pin.length; i++) {
      hash = ((hash << 5) - hash) + pin.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  } catch (err) {
    console.error("Error hashing PIN:", err);
    return "";
  }
}

function formatMobile(input) {
  try {
    let value = input.value.replace(/[^\d]/g, '');
    if (value.length > 9) value = value.slice(0, 9);
    if (value.length > 2) {
      value = `03${value.slice(0, 2)}-${value.slice(2)}`;
    } else if (value.length > 0) {
      value = `03${value}`;
    } else {
      value = "03";
    }
    input.value = value;
  } catch (err) {
    console.error("Error formatting mobile:", err);
    input.value = "03";
  }
}

function formatCnic(input) {
  try {
    let value = input.value.replace(/[^\d]/g, '');
    if (value.length > 13) value = value.slice(0, 13);
    if (value.length > 5) {
      value = `${value.slice(0, 5)}-${value.slice(5, 12)}-${value.slice(12)}`;
    } else if (value.length > 0) {
      value = value;
    }
    input.value = value;
  } catch (err) {
    console.error("Error formatting CNIC:", err);
    input.value = "";
  }
}

function showToast(message) {
  try {
    const toast = document.getElementById("toast");
    if (!toast) throw new Error("Toast element not found");
    toast.innerText = message;
    toast.style.display = "block";
    setTimeout(() => { toast.style.display = "none"; }, 3000);
  } catch (err) {
    console.error("Error showing toast:", err);
  }
}

// ----- Navigation -----
function navigate(screenId) {
  try {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const screen = document.getElementById(screenId);
    if (!screen) throw new Error(`Screen ${screenId} not found`);
    screen.classList.add("active");

    const sidebar = document.getElementById("sidebar");
    if (window.innerWidth <= 768 && sidebar) {
      sidebar.classList.remove("active");
    }

    if (screenId === "dashboard") updateDashboard();
    if (screenId === "profiles") renderProfiles();
    if (screenId === "return") filterPendingFiles();
    if (screenId === "search") performSearch();
  } catch (err) {
    console.error("Error navigating to screen:", err);
    showToast("Navigation error. Please try again.");
  }
}

// ----- Local Storage -----
function getFiles() {
  try {
    return JSON.parse(localStorage.getItem("courtFiles") || "[]");
  } catch (err) {
    console.error("Error getting files:", err);
    return [];
  }
}

function saveFiles(files) {
  try {
    localStorage.setItem("courtFiles", JSON.stringify(files));
  } catch (err) {
    console.error("Error saving files:", err);
    showToast("Failed to save files.");
  }
}

function getProfiles() {
  try {
    return JSON.parse(localStorage.getItem("profiles") || "[]");
  } catch (err) {
    console.error("Error getting profiles:", err);
    return [];
  }
}

function saveProfiles(profiles) {
  try {
    localStorage.setItem("profiles", JSON.stringify(profiles));
  } catch (err) {
    console.error("Error saving profiles:", err);
    showToast("Failed to save profiles.");
  }
}

// ----- Initial Setup -----
window.onload = function () {
  try {
    history.pushState(null, null, location.href);
    const clerkName = localStorage.getItem("clerkName");
    if (clerkName) {
      navigate("dashboard");
      showSavedProfile();
    } else {
      navigate("settings");
      document.getElementById("setupMessage").style.display = "block";
      document.querySelectorAll(".sidebar button").forEach(btn => btn.disabled = true);
      document.getElementById("settingsSubmit").disabled = true; // Disable save button initially
    }

    // Initialize input masks
    document.getElementById("mobile").addEventListener("input", () => formatMobile(document.getElementById("mobile")));
    document.getElementById("cnic").addEventListener("input", () => formatCnic(document.getElementById("cnic")));
    document.getElementById("resetCnic").addEventListener("input", () => formatCnic(document.getElementById("resetCnic")));

    // Hamburger menu
    document.getElementById("menuBtn").addEventListener("click", () => {
      const sidebar = document.getElementById("sidebar");
      if (sidebar) {
        sidebar.classList.toggle("active");
      }
    });

    // Disclaimer checkbox
    const disclaimerCheck = document.getElementById("disclaimerCheck");
    if (disclaimerCheck) {
      disclaimerCheck.addEventListener("change", () => {
        document.getElementById("settingsSubmit").disabled = !disclaimerCheck.checked;
      });
    }
  } catch (err) {
    console.error("Error during window.onload:", err);
    showToast("Initialization error. Please refresh.");
  }
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
  window.location.reload();
});

// ----- Settings -----
function showSavedProfile() {
  try {
    const clerkName = localStorage.getItem("clerkName");
    const judgeName = localStorage.getItem("judgeName");
    const courtName = localStorage.getItem("courtName");
    const mobile = localStorage.getItem("mobile");
    const userPhoto = localStorage.getItem("userPhoto");

    const table = document.getElementById("savedProfileTable");
    table.innerHTML = `
      <tr>
        <td><img src="${userPhoto || ''}" style="width:60px;height:60px;border-radius:50%;${userPhoto ? '' : 'display:none;'}"></td>
        <td>${clerkName || ''}</td>
        <td>${getJudgeNameOnly(judgeName || '')}</td>
        <td>${courtName || ''}</td>
        <td><a href="tel:${mobile || ''}">${mobile || ''}</a></td>
      </tr>
    `;
    document.getElementById("savedProfile").style.display = "block";
    document.getElementById("settingsForm").style.display = "none";
    document.getElementById("setupMessage").style.display = "none";
    document.querySelectorAll(".sidebar button").forEach(btn => btn.disabled = false);

    // Show Change PIN button only if profile is saved
    const changePinBtn = document.getElementById("changePinBtn");
    if (changePinBtn && clerkName) {
      changePinBtn.style.display = "inline-block";
    }
  } catch (err) {
    console.error("Error showing saved profile:", err);
    showToast("Error displaying profile.");
  }
}

function editUserProfile() {
  try {
    document.getElementById("savedProfile").style.display = "none";
    document.getElementById("settingsForm").style.display = "block";
    document.getElementById("clerkName").value = localStorage.getItem("clerkName") || "";
    document.getElementById("judgeName").value = localStorage.getItem("judgeName") || "";
    document.getElementById("courtName").value = localStorage.getItem("courtName") || "";
    document.getElementById("mobile").value = localStorage.getItem("mobile") || "03";
    document.getElementById("cnic").value = localStorage.getItem("cnic") || "";
    document.getElementById("userPhotoPreview").src = localStorage.getItem("userPhoto") || "";
    document.getElementById("userPhotoPreview").style.display = localStorage.getItem("userPhoto") ? "block" : "none";
    document.getElementById("disclaimerCheck").checked = false;
    document.getElementById("settingsSubmit").disabled = true;
  } catch (err) {
    console.error("Error editing user profile:", err);
    showToast("Error loading profile for edit.");
  }
}

document.getElementById("settingsForm").addEventListener("submit", function (e) {
  e.preventDefault();
  try {
    const clerkName = document.getElementById("clerkName").value.trim();
    const judgeName = document.getElementById("judgeName").value.trim();
    const courtName = document.getElementById("courtName").value.trim();
    const mobile = document.getElementById("mobile").value.trim();
    const cnic = document.getElementById("cnic").value.trim();
    const pin = document.getElementById("pin").value;
    const userPhoto = document.getElementById("userPhotoPreview").getAttribute("data-img") || "";

    if (!clerkName || !judgeName || !courtName || !mobile || !cnic || !pin) {
      showToast("All required fields must be filled.");
      return;
    }

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      showToast("PIN must be 4 digits.");
      return;
    }

    if (!/^03\d{2}-\d{7}$/.test(mobile)) {
      showToast("Mobile number must be in format 03XX-XXXXXXX.");
      return;
    }

    if (!/^\d{5}-\d{7}-\d{1}$/.test(cnic)) {
      showToast("CNIC must be in format XXXXX-XXXXXXX-X.");
      return;
    }

    const isInitialSave = !localStorage.getItem("pinHash");

    const saveProfile = () => {
      try {
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
      } catch (err) {
        console.error("Error saving profile:", err);
        showToast("Failed to save profile.");
      }
    };

    if (isInitialSave) {
      saveProfile();
    } else {
      showPinPrompt(saveProfile);
    }
  } catch (err) {
    console.error("Error submitting settings form:", err);
    showToast("Error saving profile. Please try again.");
  }
});

document.getElementById("userPhoto").addEventListener("change", function () {
  try {
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
  } catch (err) {
    console.error("Error processing user photo:", err);
    showToast("Failed to process photo.");
  }
});

// ----- PIN Security -----
let pinCallback = null;

function showPinPrompt(callback) {
  try {
    pinCallback = callback;
    document.getElementById("pinModal").style.display = "block";
    document.getElementById("pinInput").value = "";
    document.getElementById("pinInput").focus();
  } catch (err) {
    console.error("Error showing PIN prompt:", err);
    showToast("Error accessing PIN prompt.");
  }
}

function submitPin() {
  try {
    const pin = document.getElementById("pinInput").value;
    const storedHash = localStorage.getItem("pinHash");
    if (hashPin(pin) === storedHash) {
      document.getElementById("pinModal").style.display = "none";
      if (pinCallback) pinCallback();
    } else {
      showToast("Incorrect PIN.");
    }
  } catch (err) {
    console.error("Error submitting PIN:", err);
    showToast("Error verifying PIN.");
  }
}

function showForgotPin() {
  try {
    document.getElementById("pinModal").style.display = "none";
    document.getElementById("forgotPinModal").style.display = "block";
    document.getElementById("resetCnic").value = "";
    document.getElementById("resetPin").value = "";
  } catch (err) {
    console.error("Error showing forgot PIN modal:", err);
    showToast("Error accessing PIN reset.");
  }
}

function hideForgotPin() {
  try {
    document.getElementById("forgotPinModal").style.display = "none";
  } catch (err) {
    console.error("Error hiding forgot PIN modal:", err);
  }
}

function resetPin() {
  try {
    const cnic = document.getElementById("resetCnic").value.trim();
    const newPin = document.getElementById("resetPin").value;
    const storedCnic = localStorage.getItem("cnic");

    if (!cnic || cnic !== storedCnic) {
      showToast("Incorrect CNIC.");
      return;
    }

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      showToast("New PIN must be 4 digits.");
      return;
    }

    localStorage.setItem("pinHash", hashPin(newPin));
    document.getElementById("forgotPinModal").style.display = "none";
    showToast("PIN reset successfully.");
  } catch (err) {
    console.error("Error resetting PIN:", err);
    showToast("Error resetting PIN.");
  }
}

// ----- Modal Outside Click -----
function closeModalOnOutsideClick(e) {
  try {
    if (e.target.classList.contains("modal")) {
      e.target.style.display = "none";
    }
  } catch (err) {
    console.error("Error closing modal:", err);
  }
}

document.getElementById("pinModal").addEventListener("click", closeModalOnOutsideClick);
document.getElementById("forgotPinModal").addEventListener("click", closeModalOnOutsideClick);
document.getElementById("profileModal").addEventListener("click", closeModalOnOutsideClick);
document.getElementById("fileDetailsModal").addEventListener("click", closeModalOnOutsideClick);

// ----- Toggle Fields -----
function toggleCriminalFields() {
  try {
    const type = document.getElementById("caseType").value;
    document.getElementById("criminalFields").style.display = type === "criminal" ? "block" : "none";
  } catch (err) {
    console.error("Error toggling criminal fields:", err);
  }
}

function toggleCopyAgency() {
  try {
    const show = document.getElementById("copyAgency").checked;
    document.getElementById("copyAgencyFields").style.display = show ? "block" : "none";
  } catch (err) {
    console.error("Error toggling copy agency fields:", err);
  }
}

function toggleProfileFields() {
  try {
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
  } catch (err) {
    console.error("Error toggling profile fields:", err);
    showToast("Error loading profile fields.");
  }
}

// ----- CMS Auto Fill -----
function autoFillCMS() {
  try {
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
  } catch (err) {
    console.error("Error auto-filling CMS:", err);
    showToast("Error auto-filling form.");
  }
}

// ----- Suggest Profiles -----
function suggestProfiles(value) {
  try {
    const list = document.getElementById("suggestions");
    list.innerHTML = "";
    if (value.trim().length === 0) return;

    const matches = getProfiles().filter(p =>
      p.name.toLowerCase().includes(value.toLowerCase())
    );

    matches.forEach(p => {
      const li = document.createElement("li");
      li.innerHTML = `
        ${p.photo ? `<img src="${p.photo}" alt="${p.name}" style="width:40px;height:40px;border-radius:50%;">` : ""}
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
  } catch (err) {
    console.error("Error suggesting profiles:", err);
    showToast("Error loading suggestions.");
  }
}

// ----- New File Entry Submit -----
document.getElementById("fileForm").addEventListener("submit", function (e) {
  e.preventDefault();
  try {
    showPinPrompt(() => {
      const cmsNo = document.getElementById("cmsNo").value.trim();
      const name = document.getElementById("deliveredTo").value.trim();
      const profiles = getProfiles();
      const profile = profiles.find(p => p.name === name);
      if (!profile) {
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
        deliveryTimestamp: Date.now(),
        duration: null,
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
  } catch (err) {
    console.error("Error submitting file form:", err);
    showToast("Error saving file. Please try again.");
  }
});

// ----- Return File -----
function filterPendingFiles() {
  try {
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
  } catch (err) {
    console.error("Error filtering pending files:", err);
    showToast("Error loading pending files.");
  }
}

function markReturned(cmsNo) {
  try {
    showPinPrompt(() => {
      const files = getFiles();
      const file = files.find(f => f.cmsNo === cmsNo);
      if (!file) {
        showToast("File not found.");
        return;
      }
      file.returnDate = new Date().toISOString().split("T")[0];
      file.duration = calculateTimer(file.deliveryTimestamp, Date.now());
      saveFiles(files);
      document.getElementById("returnForm").reset();
      filterPendingFiles();
      showToast("Marked as returned.");
      navigate("dashboard");
    });
  } catch (err) {
    console.error("Error marking file as returned:", err);
    showToast("Error marking file as returned.");
  }
}

// ----- Search -----
document.getElementById("searchForm").addEventListener("submit", function (e) {
  e.preventDefault();
  performSearch();
});

function performSearch() {
  try {
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
      const profile = getProfiles().find(p => p.name === f.deliveredTo) || {};
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${f.cmsNo}</td>
        <td>${f.title}</td>
        <td>${f.caseType}</td>
        <td>${formatDate(f.deliveredDate)}</td>
        <td>${f.returnDate ? formatDate(f.returnDate) : 'Pending'}</td>
        <td><a href="#" onclick="showProfileDetails('${f.deliveredTo}')">${f.deliveredTo}</a> (${f.deliveredType})</td>
        <td>${f.clerkName || ''}</td>
        <td>${getJudgeNameOnly(f.judgeName || '')}</td>
        <td>${f.duration || calculateTimer(f.deliveryTimestamp)}</td>
        <td><button onclick="showFileDetails('${f.cmsNo}')">Details</button></td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("searchResults").innerHTML = files.length ? "" : "<p>No matches found.</p>";
  } catch (err) {
    console.error("Error performing search:", err);
    showToast("Error searching files.");
  }
}

function showFileDetails(cmsNo) {
  try {
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
      Duration: ${file.duration || calculateTimer(file.deliveryTimestamp)}<br>
      ${file.sentToCopyAgency ? `Swal Form No: ${file.swalFormNo}<br>Swal Date: ${formatDate(file.swalDate)}<br>` : ""}
      Clerk: ${file.clerkName || ''}<br>
      Judge: ${getJudgeNameOnly(file.judgeName || '')}
    `;
    document.getElementById("fileDetailsContent").innerHTML = details;
    document.getElementById("fileDetailsModal").style.display = "block";
  } catch (err) {
    console.error("Error showing file details:", err);
    showToast("Error displaying file details.");
  }
}

function exportSearchReport() {
  try {
    const table = document.getElementById("searchResultsTable");
    const rows = Array.from(table.rows);
    const csv = rows.map(row => Array.from(row.cells).map(cell => cell.innerText.replace(/,/g, '')).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.download = "search_report.csv";
    link.href = URL.createObjectURL(blob);
    link.click();
  } catch (err) {
    console.error("Error exporting search report:", err);
    showToast("Error exporting report.");
  }
}

function printSearchReport() {
  try {
    const content = document.getElementById("searchResults").innerHTML;
    const win = window.open("", "", "width=900,height=600");
    win.document.write("<html><head><title>Print Report</title></head><body>");
    win.document.write(content);
    win.document.write("</body></html>");
    win.print();
    win.close();
  } catch (err) {
    console.error("Error printing search report:", err);
    showToast("Error printing report.");
  }
}

// ----- Profile Modal -----
function showProfileDetails(name) {
  try {
    const profile = getProfiles().find(p => p.name === name);
    if (!profile) {
      showToast("Profile not found.");
      return;
    }

    document.getElementById("profileModalTitle").innerText = profile.name;
    document.getElementById("profileModalPhoto").src = profile.photo || "";
    document.getElementById("profileModalPhoto").style.display = profile.photo ? "block" : "none";

    const table = document.getElementById("profileModalTable");
    table.innerHTML = `
      <tr><th>Type</th><td>${profile.type}</td></tr>
      ${profile.cellNo ? `<tr><th>Cell</th><td><a href="tel:${profile.cellNo}">${profile.cellNo}</a></td></tr>` : ""}
      ${profile.chamberNo ? `<tr><th>Chamber</th><td>${profile.chamberNo}</td></tr>` : ""}
      ${profile.advocateName ? `<tr><th>Advocate</th><td>${profile.advocateName}</td></tr>` : ""}
      ${profile.advocateCell ? `<tr><th>Advocate Cell</th><td><a href="tel:${profile.advocateCell}">${profile.advocateCell}</a></td></tr>` : ""}
      ${profile.designation ? `<tr><th>Designation</th><td>${profile.designation}</td></tr>` : ""}
      ${profile.courtName ? `<tr><th>Court</th><td>${profile.courtName}</td></tr>` : ""}
      ${profile.address ? `<tr><th>Address</th><td>${profile.address}</td></tr>` : ""}
      ${profile.idNo ? `<tr><th>ID No</th><td>${profile.idNo}</td></tr>` : ""}
      ${profile.relation ? `<tr><th>Relation</th><td>${profile.relation}</td></tr>` : ""}
    `;
    document.getElementById("profileModal").style.display = "block";
  } catch (err) {
    console.error("Error showing profile details:", err);
    showToast("Error displaying profile details.");
  }
}

function closeProfileModal() {
  try {
    document.getElementById("profileModal").style.display = "none";
  } catch (err) {
    console.error("Error closing profile modal:", err);
  }
}

// ----- Dashboard Logic -----
function updateDashboard() {
  try {
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
  } catch (err) {
    console.error("Error updating dashboard:", err);
    showToast("Error loading dashboard.");
  }
}

// ----- Dashboard Report View -----
function showDashboardReport(type) {
  try {
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
          <td><a href="tel:${p.cellNo || ''}">${p.cellNo || ''}</a></td>
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
          <td>${f.duration || calculateTimer(f.deliveryTimestamp)}</td>
          <td>${f.clerkName || ''} / ${getJudgeNameOnly(f.judgeName || '')}</td>
          <td><a href="tel:${profile.cellNo || ''}">${profile.cellNo || ''}</a>${profile.chamberNo ? `, Chamber: ${profile.chamberNo}` : ''}</td>
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
  } catch (err) {
    console.error("Error showing dashboard report:", err);
    showToast("Error loading report.");
  }
}

function exportDashboardReport() {
  try {
    const table = document.getElementById("dashboardReportTable");
    const rows = Array.from(table.rows);
    const csv = rows.map(row => Array.from(row.cells).map(cell => cell.innerText.replace(/,/g, '')).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.download = "dashboard_report.csv";
    link.href = URL.createObjectURL(blob);
    link.click();
  } catch (err) {
    console.error("Error exporting dashboard report:", err);
    showToast("Error exporting report.");
  }
}

function printDashboardReport() {
  try {
    const content = document.getElementById("dashboardReportPanel").innerHTML;
    const win = window.open("", "", "width=900,height=600");
    win.document.write("<html><head><title>Print Report</title></head><body>");
    win.document.write(content);
    win.document.write("</body></html>");
    win.print();
    win.close();
  } catch (err) {
    console.error("Error printing dashboard report:", err);
    showToast("Error printing report.");
  }
}

// ----- Profile Manager -----
document.getElementById("profilePhoto").addEventListener("change", function () {
  try {
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
  } catch (err) {
    console.error("Error processing profile photo:", err);
    showToast("Failed to process profile photo.");
  }
});

document.getElementById("profileForm").addEventListener("submit", function (e) {
  e.preventDefault();
  try {
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

      if (!name || !type || (extra.cellNo && !/^03\d{2}-\d{7}$/.test(extra.cellNo))) {
        showToast("Please fill all required fields and ensure valid mobile number.");
        return;
      }

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
  } catch (err) {
    console.error("Error submitting profile form:", err);
    showToast("Failed to save profile. Please try again.");
  }
});

function renderProfiles() {
  try {
    const list = document.getElementById("profileList");
    list.innerHTML = `
      <table class="profile-table">
        <thead>
          <tr>
            <th>Photo</th>
            <th>Name</th>
            <th>Type</th>
            <th>Cell No</th>
            <th>Other Details</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;
    const tbody = list.querySelector("tbody");

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
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><img src="${p.photo || ''}" style="width:40px;height:40px;border-radius:50%;${p.photo ? '' : 'display:none;'}"></td>
        <td>${p.name}</td>
        <td>${p.type}</td>
        <td><a href="tel:${p.cellNo || ''}">${p.cellNo || ''}</a></td>
        <td>
          ${p.chamberNo ? `Chamber: ${p.chamberNo}<br>` : ""}
          ${p.advocateName ? `Advocate: ${p.advocateName}<br>` : ""}
          ${p.advocateCell ? `Advocate Cell: <a href="tel:${p.advocateCell}">${p.advocateCell}</a><br>` : ""}
          ${p.designation ? `Designation: ${p.designation}<br>` : ""}
          ${p.courtName ? `Court: ${p.courtName}<br>` : ""}
          ${p.address ? `Address: ${p.address}<br>` : ""}
          ${p.idNo ? `ID No: ${p.idNo}<br>` : ""}
          ${p.relation ? `Relation: ${p.relation}` : ""}
        </td>
        <td>
          <button onclick="editProfile(${i})" class="edit-btn">Edit</button>
          <button onclick="deleteProfile(${i})" class="delete-btn">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    const pendingName = localStorage.getItem("pendingProfileName");
    if (pendingName) {
      document.getElementById("profileName").value = pendingName;
      localStorage.removeItem("pendingProfileName");
    }
  } catch (err) {
    console.error("Error rendering profiles:", err);
    showToast("Error loading profiles.");
  }
}

function editProfile(index) {
  try {
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
  } catch (err) {
    console.error("Error editing profile:", err);
    showToast("Error loading profile for edit.");
  }
}

function deleteProfile(index) {
  try {
    showPinPrompt(() => {
      const profiles = getProfiles();
      profiles.splice(index, 1);
      saveProfiles(profiles);
      renderProfiles();
      showToast("Profile deleted successfully.");
    });
  } catch (err) {
    console.error("Error deleting profile:", err);
    showToast("Error deleting profile.");
  }
}

function exportProfiles() {
  try {
    const profiles = getProfiles();
    const json = JSON.stringify(profiles, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const link = document.createElement("a");
    link.download = "profiles.json";
    link.href = URL.createObjectURL(blob);
    link.click();
  } catch (err) {
    console.error("Error exporting profiles:", err);
    showToast("Error exporting profiles.");
  }
}

function importProfiles() {
  try {
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
        console.error("Error parsing imported profiles:", err);
        showToast("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  } catch (err) {
    console.error("Error importing profiles:", err);
    showToast("Error importing profiles.");
  }
}

// ----- Event Listeners -----
document.addEventListener("click", function (e) {
  try {
    const sidebar = document.getElementById("sidebar");
    if (window.innerWidth <= 768 && sidebar.classList.contains("active")) {
      const clickedInside = sidebar.contains(e.target) || e.target.id === "menuBtn";
      if (!clickedInside) sidebar.classList.remove("active");
    }
  } catch (err) {
    console.error("Error handling sidebar click:", err);
  }
});

window.addEventListener("popstate", () => {
  try {
    const sidebar = document.getElementById("sidebar");
    if (window.innerWidth <= 768 && sidebar.classList.contains("active")) {
      sidebar.classList.remove("active");
      history.pushState(null, null, location.href);
    }
  } catch (err) {
    console.error("Error handling popstate:", err);
  }
});

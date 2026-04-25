const SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1P7AkTA9Qb1WLDYkl3xdUO9XHiOk6pid3c98PmETA6os/edit";

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('SIMBA - BBPK Jakarta')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Validasi Login Pengguna
 */
function login(nip, password) {
  // Custom password sesuai ketentuan
  if (password !== "12345@") {
    return { success: false, message: "Password salah! Gunakan password default." };
  }
  try {
    // Daftar role berdasarkan input shortcut
    const roleMapping = {
      "pegawai": { role: "Pegawai", name: "Pegawai Demo" },
      "bmn": { role: "Pengelola BMN", name: "Pengelola BMN Demo" },
      "lobby": { role: "Pengelola Ruang", name: "Pengelola Ruang Demo" },
      "kepala": { role: "Kepala Kantor", name: "Kepala Kantor Demo" },
      "admin": { role: "Admin", name: "Admin Demo" }
    };
    
    let userKey = nip.toString().toLowerCase().trim();
    if (roleMapping[userKey]) {
      return { success: true, role: roleMapping[userKey].role, name: roleMapping[userKey].name, nip: nip };
    }

    const ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    // Mencoba beberapa kemungkinan nama sheet pengguna
    let sheetNames = ["Pegawai", "Users", "Data Pegawai", "User"];
    let sheet = null;
    
    for (let name of sheetNames) {
      sheet = ss.getSheetByName(name);
      if (sheet) break;
    }
    
    // Fallback jika sheet tidak ditemukan
    if (!sheet) {
      if (nip === "admin") return { success: true, role: "Admin", name: "Administrator", nip: nip };
      if (nip === "pegawai") return { success: true, role: "Pegawai", name: "Pegawai Demo", nip: nip };
      if (nip === "pengelola") return { success: true, role: "Pengelola BMN", name: "Pengelola Demo", nip: nip };
      if (nip === "kepala") return { success: true, role: "Kepala Kantor", name: "Kepala Demo", nip: nip };
      return { success: false, message: "Database pegawai belum disiapkan." };
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: false, message: "Data pegawai kosong." };
    
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const nipIndex = headers.indexOf("nip");
    let nameIndex = headers.indexOf("nama");
    if (nameIndex === -1) nameIndex = headers.indexOf("nama pegawai");
    let roleIndex = headers.indexOf("role");
    if (roleIndex === -1) roleIndex = headers.indexOf("peran");
    if (roleIndex === -1) roleIndex = headers.indexOf("jabatan");
    
    if (nipIndex === -1) return { success: false, message: "Format kolom database salah. Harus ada kolom NIP." };
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][nipIndex].toString() === nip) {
        let role = roleIndex !== -1 ? data[i][roleIndex].toString() : "Pegawai";
        let name = nameIndex !== -1 ? data[i][nameIndex].toString() : "User " + nip;
        
        // Normalisasi role
        if (role.toLowerCase().includes("admin")) role = "Admin";
        else if (role.toLowerCase().includes("pengelola")) role = "Pengelola BMN";
        else if (role.toLowerCase().includes("kepala")) role = "Kepala Kantor";
        else role = "Pegawai";
        
        return { success: true, role: role, name: name, nip: nip };
      }
    }
    
    return { success: false, message: "NIP tidak terdaftar dalam sistem." };
  } catch (e) {
    return { success: false, message: "Gagal mengakses database: " + e.message };
  }
}

/**
 * Fetch Data dari Sheet
 */
function fetchSheetData(sheetNameCandidates) {
  try {
    const ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    let sheet = null;
    
    for (let name of sheetNameCandidates) {
      sheet = ss.getSheetByName(name);
      if (sheet) break;
    }
    
    if (!sheet) return [];
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    
    const headers = data[0];
    const rows = [];
    
    for (let i = 1; i < data.length; i++) {
      let obj = {};
      for (let j = 0; j < headers.length; j++) {
        let key = headers[j].toString().trim();
        if (key) obj[key] = data[i][j];
      }
      // Add row index to update later
      obj._rowIndex = i + 1;
      rows.push(obj);
    }
    return rows;
  } catch (e) {
    console.error(e);
    return [];
  }
}

function getBarang() {
  return fetchSheetData(["Barang", "Data Barang", "Inventaris"]);
}

function getRuang() {
  return fetchSheetData(["Ruang", "Data Ruang", "Ruang Studio"]);
}

function getPeminjaman() {
  return fetchSheetData(["Peminjaman", "Riwayat Peminjaman", "Peminjaman Barang"]);
}

function getPenyewaan() {
  return fetchSheetData(["Penyewaan", "Riwayat Penyewaan", "Penyewaan Ruang"]);
}

/**
 * Submit Peminjaman Barang
 */
function submitPeminjaman(data) {
  return insertToSheet(["Peminjaman", "Riwayat Peminjaman", "Peminjaman Barang"], data);
}

/**
 * Submit Penyewaan Ruang
 */
function submitPenyewaan(data) {
  return insertToSheet(["Penyewaan", "Riwayat Penyewaan", "Penyewaan Ruang"], data);
}

/**
 * Helper insert data
 */
function insertToSheet(sheetCandidates, data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Tunggu hingga 30 detik agar proses antrean selesai
    const ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    let sheet = null;
    for (let name of sheetCandidates) {
      sheet = ss.getSheetByName(name);
      if (sheet) break;
    }
    
    if (!sheet) {
      // Create sheet if not exists
      sheet = ss.insertSheet(sheetCandidates[0]);
      let headers = Object.keys(data);
      headers.push("Status");
      headers.push("Tanggal Pengajuan");
      sheet.appendRow(headers);
    }
    
    let headers = sheet.getDataRange().getValues()[0];
    let rowData = [];
    
    for (let i = 0; i < headers.length; i++) {
      let key = headers[i].toString().trim();
      if (key === "Status") rowData.push("Menunggu Verifikasi");
      else if (key === "Tanggal Pengajuan") rowData.push(new Date().toLocaleString('id-ID'));
      else rowData.push(data[key] !== undefined ? data[key] : "");
    }
    
    sheet.appendRow(rowData);
    return { success: true, message: "Pengajuan berhasil dikirim!" };
  } catch (e) {
    return { success: false, message: "Error: " + e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Verifikasi (Approve/Reject)
 */
function updateStatus(sheetType, rowIndex, status, notes) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    let sheetCandidates = sheetType === "peminjaman" 
      ? ["Peminjaman", "Riwayat Peminjaman", "Peminjaman Barang"] 
      : ["Penyewaan", "Riwayat Penyewaan", "Penyewaan Ruang"];
      
    let sheet = null;
    for (let name of sheetCandidates) {
      sheet = ss.getSheetByName(name);
      if (sheet) break;
    }
    
    if (!sheet) return { success: false, message: "Sheet tidak ditemukan" };
    
    const headers = sheet.getDataRange().getValues()[0];
    let statusCol = -1;
    let notesCol = -1;
    
    for (let i = 0; i < headers.length; i++) {
      let h = headers[i].toString().toLowerCase().trim();
      if (h === "status") statusCol = i + 1;
      if (h === "catatan" || h === "keterangan verifikasi") notesCol = i + 1;
    }
    
    if (statusCol === -1) {
      statusCol = headers.length + 1;
      sheet.getRange(1, statusCol).setValue("Status");
    }
    
    sheet.getRange(rowIndex, statusCol).setValue(status);
    
    if (notes) {
      if (notesCol === -1) {
        notesCol = headers.length + 2;
        sheet.getRange(1, notesCol).setValue("Catatan");
      }
      sheet.getRange(rowIndex, notesCol).setValue(notes);
    }
    
    return { success: true, message: "Status berhasil diperbarui." };
  } catch (e) {
    return { success: false, message: "Error: " + e.message };
  } finally {
    lock.releaseLock();
  }
}

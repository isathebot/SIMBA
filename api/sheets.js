const { google } = require('googleapis');

const SPREADSHEET_ID = "1P7AkTA9Qb1WLDYkl3xdUO9XHiOk6pid3c98PmETA6os";

function getAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';
  
  if (!clientEmail || !privateKey) {
    throw new Error('Google Credentials are not set in environment variables');
  }

  return new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

async function fetchSheetData(sheets, sheetNameCandidates) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const actualSheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
  
  let sheetName = null;
  for (let candidate of sheetNameCandidates) {
    if (actualSheetNames.includes(candidate)) {
      sheetName = candidate;
      break;
    }
  }
  
  if (!sheetName) return [];
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:Z`,
  });
  
  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];
  
  const headers = rows[0];
  const data = [];
  
  for (let i = 1; i < rows.length; i++) {
    let obj = {};
    for (let j = 0; j < headers.length; j++) {
      let key = headers[j] ? headers[j].toString().trim() : '';
      if (key) obj[key] = rows[i][j] || '';
    }
    obj._rowIndex = i + 1;
    data.push(obj);
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { action, payload } = req.body;
  
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    if (action === 'login') {
      const { nip, password } = payload;
      if (password !== "12345@") {
        return res.json({ success: false, message: "Password salah! Gunakan password default." });
      }
      
      const roleMapping = {
        "pegawai": { role: "Pegawai", name: "Pegawai Demo" },
        "bmn": { role: "Pengelola BMN", name: "Pengelola BMN Demo" },
        "lobby": { role: "Pengelola Ruang", name: "Pengelola Ruang Demo" },
        "kepala": { role: "Kepala Kantor", name: "Kepala Kantor Demo" },
        "admin": { role: "Admin", name: "Admin Demo" }
      };
      
      let userKey = nip.toString().toLowerCase().trim();
      if (roleMapping[userKey]) {
        return res.json({ success: true, role: roleMapping[userKey].role, name: roleMapping[userKey].name, nip: nip });
      }
      
      const data = await fetchSheetData(sheets, ["Pegawai", "Users", "Data Pegawai", "User"]);
      if (data.length === 0) {
        if (nip === "admin") return res.json({ success: true, role: "Admin", name: "Administrator", nip: nip });
        if (nip === "pegawai") return res.json({ success: true, role: "Pegawai", name: "Pegawai Demo", nip: nip });
        if (nip === "pengelola") return res.json({ success: true, role: "Pengelola BMN", name: "Pengelola Demo", nip: nip });
        if (nip === "kepala") return res.json({ success: true, role: "Kepala Kantor", name: "Kepala Demo", nip: nip });
        return res.json({ success: false, message: "Database pegawai belum disiapkan." });
      }
      
      for (let user of data) {
        const userNip = user['NIP'] || user['nip'] || '';
        if (userNip.toString() === nip) {
          let role = user['Role'] || user['Peran'] || user['Jabatan'] || 'Pegawai';
          let name = user['Nama'] || user['Nama Pegawai'] || ('User ' + nip);
          
          if (role.toLowerCase().includes("admin")) role = "Admin";
          else if (role.toLowerCase().includes("pengelola")) role = "Pengelola BMN";
          else if (role.toLowerCase().includes("kepala")) role = "Kepala Kantor";
          else role = "Pegawai";
          
          return res.json({ success: true, role, name, nip });
        }
      }
      return res.json({ success: false, message: "NIP tidak terdaftar dalam sistem." });
    }
    
    else if (action === 'getBarang') {
      const data = await fetchSheetData(sheets, ["Barang", "Data Barang", "Inventaris"]);
      return res.json({ success: true, data });
    }
    
    else if (action === 'getRuang') {
      const data = await fetchSheetData(sheets, ["Ruang", "Data Ruang", "Ruang Studio"]);
      return res.json({ success: true, data });
    }
    
    else if (action === 'submitForm') {
      const { type, data } = payload;
      const sheetNameCandidates = type === 'peminjaman' 
        ? ["Peminjaman", "Riwayat Peminjaman", "Peminjaman Barang"] 
        : ["Penyewaan", "Riwayat Penyewaan", "Penyewaan Ruang"];
        
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const actualSheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
      let sheetName = sheetNameCandidates.find(c => actualSheetNames.includes(c));
      
      if (!sheetName) return res.json({ success: false, message: `Buat tab ${sheetNameCandidates[0]} di Spreadsheet Anda terlebih dahulu.` });
      
      const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!A1:Z1` });
      const headers = headerRes.data.values ? headerRes.data.values[0] : [];
      let rowData = [];
      
      for (let i = 0; i < headers.length; i++) {
        let key = headers[i].toString().trim();
        if (key === "Status") rowData.push("Menunggu Verifikasi");
        else if (key === "Tanggal Pengajuan") rowData.push(new Date().toLocaleString('id-ID'));
        else rowData.push(data[key] !== undefined ? data[key] : "");
      }
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] }
      });
      
      return res.json({ success: true, message: "Pengajuan berhasil dikirim!" });
    }
    
    else if (action === 'updateStatus') {
      const { type, rowIndex, status, notes } = payload;
      const sheetNameCandidates = type === 'peminjaman' 
        ? ["Peminjaman", "Riwayat Peminjaman", "Peminjaman Barang"] 
        : ["Penyewaan", "Riwayat Penyewaan", "Penyewaan Ruang"];
        
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const actualSheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
      let sheetName = sheetNameCandidates.find(c => actualSheetNames.includes(c));
      
      if (!sheetName) return res.json({ success: false, message: "Sheet tidak ditemukan" });
      
      const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!A1:Z1` });
      const headers = headerRes.data.values ? headerRes.data.values[0] : [];
      let statusCol = -1, notesCol = -1;
      
      for (let i = 0; i < headers.length; i++) {
        let h = headers[i].toString().toLowerCase().trim();
        if (h === "status") statusCol = i;
        if (h === "catatan" || h === "keterangan verifikasi") notesCol = i;
      }
      
      if (statusCol !== -1) {
        const colLetter = String.fromCharCode(65 + statusCol);
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!${colLetter}${rowIndex}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[status]] }
        });
      }
      if (notes && notesCol !== -1) {
        const colLetter = String.fromCharCode(65 + notesCol);
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!${colLetter}${rowIndex}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[notes]] }
        });
      }
      return res.json({ success: true, message: "Status berhasil diperbarui." });
    }
    
    return res.status(400).json({ success: false, message: "Aksi tidak dikenali" });
  } catch (error) {
    console.error("API Error:", error);
    // Jika auth error, berikan pesan lebih jelas
    if(error.message.includes("Google Credentials are not set")) {
        return res.status(500).json({ success: false, message: "Vercel belum dikonfigurasi dengan Google Service Account. Silakan atur GOOGLE_CLIENT_EMAIL dan GOOGLE_PRIVATE_KEY di Vercel." });
    }
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
}

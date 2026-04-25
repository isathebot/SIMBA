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
        return res.json({ success: false, message: "Password salah!" });
      }
      
      const roleMapping = {
        "pegawai": { role: "Pegawai", name: "Pegawai BBPK" },
        "bmn": { role: "Pengelola BMN", name: "Pengelola BMN" },
        "lobby": { role: "Pengelola Ruang", name: "Pengelola Ruangan" },
        "kepala": { role: "Kepala Kantor", name: "Kepala Kantor" },
        "admin": { role: "Admin", name: "Administrator" }
      };
      
      let userKey = nip.toString().toLowerCase().trim();
      if (roleMapping[userKey]) {
        return res.json({ success: true, ...roleMapping[userKey], nip: nip });
      }
      
      return res.json({ success: false, message: "User tidak ditemukan." });
    }
    
    else if (action === 'getBarang') {
      const data = await fetchSheetData(sheets, ["Barang", "Data Barang", "Inventaris"]);
      return res.json({ success: true, data });
    }
    
    else if (action === 'getRuang') {
      const data = await fetchSheetData(sheets, ["Ruang", "Data Ruang", "Ruang Studio"]);
      return res.json({ success: true, data });
    }

    else if (action === 'getHistory') {
      const pData = await fetchSheetData(sheets, ["Peminjaman", "Riwayat Peminjaman"]);
      const rData = await fetchSheetData(sheets, ["Penyewaan", "Riwayat Penyewaan"]);
      
      const history = [
        ...pData.map(d => ({ ...d, tipe: 'Barang' })),
        ...rData.map(d => ({ ...d, tipe: 'Ruangan' }))
      ];
      return res.json({ success: true, data: history });
    }
    
    else if (action === 'submitForm') {
      const { type, data } = payload;
      const sheetCandidates = type === 'peminjaman' ? ["Peminjaman", "Riwayat Peminjaman"] : ["Penyewaan", "Riwayat Penyewaan"];
      
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const actualSheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
      let sheetName = sheetCandidates.find(c => actualSheetNames.includes(c));
      
      if (!sheetName) return res.json({ success: false, message: `Buat tab ${sheetCandidates[0]} di Sheets Anda.` });
      
      const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!A1:Z1` });
      const headers = headerRes.data.values ? headerRes.data.values[0] : [];
      let rowData = headers.map(h => {
        if (h === "Status") return "Menunggu Verifikasi";
        if (h === "Tanggal Pengajuan") return new Date().toLocaleString('id-ID');
        return data[h] || "";
      });
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] }
      });
      
      return res.json({ success: true, message: "Berhasil terkirim!" });
    }

    else if (action === 'updateStatus') {
      const { type, rowIndex, status } = payload;
      const sheetCandidates = type === 'Barang' ? ["Peminjaman", "Riwayat Peminjaman"] : ["Penyewaan", "Riwayat Penyewaan"];
      
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const actualSheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
      let sheetName = sheetCandidates.find(c => actualSheetNames.includes(c));
      
      if (!sheetName) return res.json({ success: false });

      const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!A1:Z1` });
      const headers = headerRes.data.values ? headerRes.data.values[0] : [];
      const colIndex = headers.indexOf("Status");
      if (colIndex === -1) return res.json({ success: false });

      const colLetter = String.fromCharCode(65 + colIndex);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!${colLetter}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[status]] }
      });
      
      return res.json({ success: true });
    }
    
    return res.status(400).json({ success: false, message: "Action unknown" });
    
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

const { google } = require('googleapis');

const SPREADSHEET_ID = "1P7AkTA9Qb1WLDYkl3xdUO9XHiOk6pid3c98PmETA6os";

const PEMINJAMAN_HEADERS = ["NIP", "Nama", "Barang", "Tujuan", "Tanggal Pinjam", "Tanggal Kembali", "Status", "Tanggal Pengajuan"];
const PENYEWAAN_HEADERS = ["NIP", "Nama", "Ruang", "Acara", "Waktu Mulai", "Waktu Selesai", "Status", "Tanggal Pengajuan"];

function getAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';
  // Handle escaped newlines from Vercel environment
  privateKey = privateKey.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new Error('GOOGLE_CLIENT_EMAIL atau GOOGLE_PRIVATE_KEY belum diatur di Environment Variables Vercel.');
  }

  return new google.auth.JWT(clientEmail, null, privateKey, [
    'https://www.googleapis.com/auth/spreadsheets'
  ]);
}

function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// Ensure a sheet tab exists; create it with headers if not
async function ensureSheet(sheets, sheetName, headers) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = spreadsheet.data.sheets.map(s => s.properties.title);

  if (!existing.includes(sheetName)) {
    // Create the sheet tab
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }]
      }
    });
    // Write header row
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] }
    });
  }
}

// Read all data rows from a sheet
async function readSheet(sheets, sheetName) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z`
    });
    const rows = response.data.values;
    if (!rows || rows.length < 2) return [];

    const headers = rows[0];
    return rows.slice(1).map((row, i) => {
      const obj = { _rowIndex: i + 2 };
      headers.forEach((h, j) => { if (h) obj[h.trim()] = row[j] || ''; });
      return obj;
    });
  } catch (e) {
    return [];
  }
}

module.exports = async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const { action, payload } = req.body || {};

  try {
    // ===================== LOGIN (no Sheets needed) =====================
    if (action === 'login') {
      const { nip, password } = payload;
      if (password !== '12345@') return res.json({ success: false, message: 'Password salah!' });

      const roles = {
        admin:   { role: 'Admin',          name: 'Administrator' },
        pegawai: { role: 'Pegawai',        name: 'Pegawai BBPK' },
        bmn:     { role: 'Pengelola BMN',  name: 'Pengelola BMN' },
        lobby:   { role: 'Pengelola Ruang', name: 'Pengelola Ruangan' },
        kepala:  { role: 'Kepala Kantor',  name: 'Kepala Kantor' }
      };

      const key = (nip || '').toString().toLowerCase().trim();
      if (roles[key]) return res.json({ success: true, ...roles[key], nip });
      return res.json({ success: false, message: 'User tidak ditemukan.' });
    }

    // ============= All actions below need Google Sheets =============
    const sheets = getSheetsClient();

    // Ensure both tabs exist with headers
    await ensureSheet(sheets, 'Peminjaman', PEMINJAMAN_HEADERS);
    await ensureSheet(sheets, 'Penyewaan', PENYEWAAN_HEADERS);

    // ===================== GET HISTORY =====================
    if (action === 'getHistory') {
      const pData = await readSheet(sheets, 'Peminjaman');
      const rData = await readSheet(sheets, 'Penyewaan');
      const history = [
        ...pData.map(d => ({ ...d, tipe: 'Barang' })),
        ...rData.map(d => ({ ...d, tipe: 'Ruangan' }))
      ];
      return res.json({ success: true, data: history });
    }

    // ===================== SUBMIT FORM =====================
    if (action === 'submitForm') {
      const { type, data } = payload;
      const sheetName = type === 'peminjaman' ? 'Peminjaman' : 'Penyewaan';
      const headers = type === 'peminjaman' ? PEMINJAMAN_HEADERS : PENYEWAAN_HEADERS;

      const rowData = headers.map(h => {
        if (h === 'Status') return 'Menunggu Verifikasi';
        if (h === 'Tanggal Pengajuan') return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        return data[h] || '';
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] }
      });

      return res.json({ success: true, message: 'Pengajuan berhasil disimpan ke database!' });
    }

    // ===================== UPDATE STATUS =====================
    if (action === 'updateStatus') {
      const { type, rowIndex, status } = payload;
      const sheetName = type === 'Barang' ? 'Peminjaman' : 'Penyewaan';
      const headers = type === 'Barang' ? PEMINJAMAN_HEADERS : PENYEWAAN_HEADERS;
      const colIndex = headers.indexOf('Status');

      if (colIndex === -1) return res.json({ success: false, message: 'Kolom Status tidak ditemukan.' });

      const colLetter = String.fromCharCode(65 + colIndex);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!${colLetter}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[status]] }
      });

      return res.json({ success: true, message: `Status diubah menjadi ${status}` });
    }

    // ===================== DELETE ROW =====================
    if (action === 'deleteRow') {
      const { type, rowIndex } = payload;
      const sheetName = type === 'Barang' ? 'Peminjaman' : 'Penyewaan';

      // Get sheetId (numeric ID for batchUpdate)
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const sheetObj = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
      if (!sheetObj) return res.json({ success: false, message: 'Tab tidak ditemukan.' });

      const sheetId = sheetObj.properties.sheetId;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1,
                endIndex: rowIndex
              }
            }
          }]
        }
      });

      return res.json({ success: true, message: 'Data berhasil dihapus.' });
    }
    return res.status(400).json({ success: false, message: 'Action tidak dikenal.' });

  } catch (error) {
    console.error('API Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

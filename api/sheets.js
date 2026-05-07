const { google } = require('googleapis');

const SPREADSHEET_ID = "1P7AkTA9Qb1WLDYkl3xdUO9XHiOk6pid3c98PmETA6os";

const PEMINJAMAN_HEADERS = ["NIP", "Nama", "Barang", "Tujuan", "Tanggal Pinjam", "Tanggal Kembali", "Status", "Tanggal Pengajuan", "Alasan Penolakan"];
const PENYEWAAN_HEADERS = ["NIP", "Nama", "Ruang", "Acara", "Waktu Mulai", "Waktu Selesai", "Status", "Tanggal Pengajuan", "Alasan Penolakan"];
const PENGEMBALIAN_HEADERS = ["NIP", "Nama", "Barang", "Kondisi", "Tanggal Pengembalian", "Catatan", "Status", "Tanggal Pengajuan", "Alasan Penolakan"];
const KELUHAN_HEADERS = ["NIP", "Nama", "Barang", "Jenis", "Deskripsi", "Tanggal Kejadian", "Status", "Tanggal Pengajuan", "Alasan Penolakan"];

function getAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';
  privateKey = privateKey.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    throw new Error('GOOGLE_CLIENT_EMAIL atau GOOGLE_PRIVATE_KEY belum diatur.');
  }
  return new google.auth.JWT(clientEmail, null, privateKey, [
    'https://www.googleapis.com/auth/spreadsheets'
  ]);
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

let cachedHistory = null;
let lastCacheTime = 0;
let cachePromise = null;
const CACHE_TTL = 8000; // 8 seconds for near real-time updates
let sheetsInitialized = false; // Skip redundant ensureSheet calls after first init

// Ensure sheet exists AND always fix headers to match expected
async function ensureSheet(sheets, sheetName, headers) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = spreadsheet.data.sheets.map(s => s.properties.title);

  if (!existing.includes(sheetName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
    });
  }

  // Always force correct headers on row 1
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:${String.fromCharCode(64 + headers.length)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] }
  });
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

function getSheetConfig(type) {
  switch (type) {
    case 'peminjaman': return { sheetName: 'Peminjaman', headers: PEMINJAMAN_HEADERS };
    case 'penyewaan': return { sheetName: 'Penyewaan', headers: PENYEWAAN_HEADERS };
    case 'pengembalian': return { sheetName: 'Pengembalian', headers: PENGEMBALIAN_HEADERS };
    case 'keluhan': return { sheetName: 'Keluhan', headers: KELUHAN_HEADERS };
    default: return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const { action, payload } = req.body || {};

  try {
    // ===================== LOGIN =====================
    if (action === 'login') {
      const { nip, password } = payload;
      if (password !== '12345@') return res.json({ success: false, message: 'Password salah!' });
      const roles = {
        admin:   { role: 'Admin',           name: 'Administrator' },
        pegawai: { role: 'Pegawai',         name: 'Pegawai BBPK' },
        bmn:     { role: 'Pengelola BMN',   name: 'Pengelola BMN' },
        lobby:   { role: 'Pengelola Ruang', name: 'Pengelola Ruangan' },
        kepala:  { role: 'Kepala Kantor',   name: 'Kepala Kantor' }
      };
      const key = (nip || '').toString().toLowerCase().trim();
      if (roles[key]) return res.json({ success: true, ...roles[key], nip });
      return res.json({ success: false, message: 'User tidak ditemukan.' });
    }

    // ===== All actions below need Google Sheets =====
    const sheets = getSheetsClient();
    
    // Only ensure sheets exist on first call (saves 4 API calls per request)
    if (!sheetsInitialized) {
      await ensureSheet(sheets, 'Peminjaman', PEMINJAMAN_HEADERS);
      await ensureSheet(sheets, 'Penyewaan', PENYEWAAN_HEADERS);
      await ensureSheet(sheets, 'Pengembalian', PENGEMBALIAN_HEADERS);
      await ensureSheet(sheets, 'Keluhan', KELUHAN_HEADERS);
      sheetsInitialized = true;
    }

    // ===================== GET HISTORY =====================
    if (action === 'getHistory') {
      if (cachedHistory && (Date.now() - lastCacheTime < CACHE_TTL)) {
        return res.json({ success: true, data: cachedHistory, cached: true });
      }
      
      if (!cachePromise) {
        cachePromise = (async () => {
          const pData = await readSheet(sheets, 'Peminjaman');
          const rData = await readSheet(sheets, 'Penyewaan');
          const pengData = await readSheet(sheets, 'Pengembalian');
          const kData = await readSheet(sheets, 'Keluhan');
          const history = [
            ...pData.map(d => ({ ...d, tipe: 'Barang' })),
            ...rData.map(d => ({ ...d, tipe: 'Ruangan' })),
            ...pengData.map(d => ({ ...d, tipe: 'Pengembalian' })),
            ...kData.map(d => ({ ...d, tipe: 'Keluhan' }))
          ];
          cachedHistory = history;
          lastCacheTime = Date.now();
          cachePromise = null;
          return history;
        })();
      }
      
      const history = await cachePromise;
      return res.json({ success: true, data: history });
    }

    // ===================== SUBMIT FORM =====================
    if (action === 'submitForm') {
      const { type, data } = payload;
      const config = getSheetConfig(type);
      if (!config) return res.json({ success: false, message: 'Tipe form tidak dikenal.' });

      const rowData = config.headers.map(h => {
        if (h === 'Status') return 'Menunggu Verifikasi';
        if (h === 'Alasan Penolakan') return '';
        if (h === 'Tanggal Pengajuan') return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        return data[h] || '';
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${config.sheetName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] }
      });

      // Invalidate cache
      cachedHistory = null;
      lastCacheTime = 0;

      return res.json({ success: true, message: 'Pengajuan berhasil!' });
    }

    // ===================== UPDATE STATUS =====================
    if (action === 'updateStatus') {
      const { type, rowIndex, status, reason } = payload;
      
      let sheetName, headers;
      if (type === 'Barang') { sheetName = 'Peminjaman'; headers = PEMINJAMAN_HEADERS; }
      else if (type === 'Ruangan') { sheetName = 'Penyewaan'; headers = PENYEWAAN_HEADERS; }
      else if (type === 'Pengembalian') { sheetName = 'Pengembalian'; headers = PENGEMBALIAN_HEADERS; }
      else if (type === 'Keluhan') { sheetName = 'Keluhan'; headers = KELUHAN_HEADERS; }
      else { return res.json({ success: false, message: 'Tipe tidak valid.' }); }

      const colIndex = headers.indexOf('Status');
      if (colIndex === -1) return res.json({ success: false, message: 'Kolom Status tidak ditemukan.' });

      const colLetter = String.fromCharCode(65 + colIndex);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!${colLetter}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[status]] }
      });

      // Write rejection/cancellation reason if provided
      if (reason && (status === 'Ditolak' || status === 'Dibatalkan')) {
        const reasonColIndex = headers.indexOf('Alasan Penolakan');
        if (reasonColIndex !== -1) {
          const reasonColLetter = String.fromCharCode(65 + reasonColIndex);
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!${reasonColLetter}${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[reason]] }
          });
        }
      }

      // Invalidate cache
      cachedHistory = null;
      lastCacheTime = 0;

      return res.json({ success: true, message: `Status diubah menjadi ${status}` });
    }

    // ===================== DELETE ROW =====================
    if (action === 'deleteRow') {
      const { type, rowIndex } = payload;
      
      let sheetName;
      if (type === 'Barang') sheetName = 'Peminjaman';
      else if (type === 'Ruangan') sheetName = 'Penyewaan';
      else if (type === 'Pengembalian') sheetName = 'Pengembalian';
      else if (type === 'Keluhan') sheetName = 'Keluhan';
      else return res.json({ success: false, message: 'Tipe tidak valid.' });

      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const sheetObj = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
      if (!sheetObj) return res.json({ success: false, message: 'Tab tidak ditemukan.' });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetObj.properties.sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1,
                endIndex: rowIndex
              }
            }
          }]
        }
      });
      
      // Invalidate cache
      cachedHistory = null;
      lastCacheTime = 0;
      
      return res.json({ success: true, message: 'Data berhasil dihapus.' });
    }

    return res.status(400).json({ success: false, message: 'Action tidak dikenal.' });
  } catch (error) {
    console.error('API Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

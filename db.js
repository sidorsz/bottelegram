const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');
const PENDING_PATH = path.join(__dirname, 'pending.json');

// Membaca seluruh database media
function readDB() {
    if (!fs.existsSync(DB_PATH)) {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
        } catch (e) {
            console.error('Gagal membuat database.json:', e);
        }
        return {};
    }
    try {
        const data = fs.readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(data || '{}');
    } catch (e) {
        console.error('Gagal membaca database.json:', e);
        return {};
    }
}

// Menyimpan item media baru
function saveMedia(id, mediaData) {
    const db = readDB();
    db[id] = {
        ...mediaData,
        createdAt: new Date().toISOString()
    };
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('Gagal menulis database.json:', e);
    }
    return db[id];
}

// Mengambil media berdasarkan ID / kode
function getMedia(id) {
    const db = readDB();
    return db[id] || null;
}

// ==========================================
// PENDING SUBMISSIONS (Antrean Review Admin)
// ==========================================

function readPending() {
    if (!fs.existsSync(PENDING_PATH)) {
        try {
            fs.writeFileSync(PENDING_PATH, JSON.stringify({}, null, 2));
        } catch (e) {
            console.error('Gagal membuat pending.json:', e);
        }
        return {};
    }
    try {
        const data = fs.readFileSync(PENDING_PATH, 'utf-8');
        return JSON.parse(data || '{}');
    } catch (e) {
        console.error('Gagal membaca pending.json:', e);
        return {};
    }
}

function savePending(id, data) {
    const p = readPending();
    p[id] = {
        ...data,
        createdAt: new Date().toISOString()
    };
    try {
        fs.writeFileSync(PENDING_PATH, JSON.stringify(p, null, 2));
    } catch (e) {
        console.error('Gagal menulis pending.json:', e);
    }
    return p[id];
}

function getPending(id) {
    const p = readPending();
    return p[id] || null;
}

function deletePending(id) {
    const p = readPending();
    delete p[id];
    try {
        fs.writeFileSync(PENDING_PATH, JSON.stringify(p, null, 2));
    } catch (e) {
        console.error('Gagal memperbarui pending.json:', e);
    }
}

module.exports = {
    saveMedia,
    getMedia,
    readDB,
    savePending,
    getPending,
    deletePending
};

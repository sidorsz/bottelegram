// ===============================================================
// 📋 MENU PERINTAH (tombol "/" Telegram) — dibedakan USER vs ADMIN
// ---------------------------------------------------------------
// USER BIASA : hanya melihat perintah user
//              (chat pribadi bot & grup/kolom komentar)
// ADMIN      : perintah user + perintah admin bertanda 👑
// Catatan keamanan: menu hanya TAMPILAN. Perlindungan sebenarnya ada di
// setiap handler perintah admin (cek config.adminIds / admin grup).
// ===============================================================

// ---------- Perintah USER (chat pribadi) ----------
const USER_DONASI = [
    { command: 'start', description: 'Mulai & aturan donasi' },
    { command: 'help', description: 'Panduan lengkap' },
    { command: 'tentang', description: 'Tentang komunitas' },
    { command: 'banding', description: 'Ajukan keringanan sanksi grup' },
    { command: 'minta_akses', description: 'Minta izin masuk grup' },
    { command: 'cancel', description: 'Batalkan sesi donasi' },
    { command: 'bersihkan', description: 'Hapus riwayat chat bot' }
];

const USER_VIEWER = [
    { command: 'start', description: 'Mulai bot' },
    { command: 'help', description: 'Panduan' },
    { command: 'tentang', description: 'Tentang komunitas' },
    { command: 'bersihkan', description: 'Hapus riwayat chat bot' }
];

// ---------- Perintah USER (grup / kolom komentar) ----------
const GROUP_USER = [
    { command: 'aturan', description: 'Lihat aturan grup' },
    { command: 'statusku', description: 'Cek peringatan & jatah keluar-masuk saya' }
];

// ---------- Perintah ADMIN ----------
const CLEANUP_ADMIN = [
    { command: 'status_hapus', description: '👑 Statistik pencatat pesan bot' },
    { command: 'hapus_semua', description: '👑 Hapus semua pesan bot (konfirmasi)' },
    { command: 'hapus_user', description: '👑 Hapus pesan bot ke 1 user (ID)' },
    { command: 'autohapus', description: '👑 Atur auto-hapus pesan (menit/off)' }
];

const DONASI_ADMIN = [
    { command: 'panel', description: '👑 Posting & pin panel Channel/Grup' },
    { command: 'broadcast', description: '👑 Kirim pengumuman ke semua user' },
    { command: 'izinkan', description: '👑 Izinkan user masuk grup lagi (ID)' },
    { command: 'debug_channel', description: '👑 Cek status channel & diskusi' },
    ...CLEANUP_ADMIN
];

const GROUP_ADMIN = [
    { command: 'cekwarn', description: '👑 Cek peringatan user (balas pesannya)' },
    { command: 'resetwarn', description: '👑 Reset peringatan & mute (balas pesannya)' },
    { command: 'ai', description: '👑 Atur Bot AI (on/off/status/chance)' }
];

const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const nameOf = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Pengguna';

module.exports = function setupMenus({ botDonasi, botViewer, isSameBot, config, mod }) {
    const adminIds = (config.adminIds || []).map(Number);
    const groupId = String(config.groupId);
    const donasiUsername = ((config.botDonasi && config.botDonasi.username) || '').replace(/^@/, '');

    // Panggil API langsung agar aman di semua versi node-telegram-bot-api
    const setCmds = (bot, commands, scope) =>
        bot._request('setMyCommands', {
            form: { commands: JSON.stringify(commands), scope: JSON.stringify(scope) }
        });

    const deleteCmds = (bot, scope) =>
        bot._request('deleteMyCommands', {
            form: { scope: JSON.stringify(scope) }
        }).catch(() => { });

    async function apply(label, bot, commands, scope) {
        try {
            await setCmds(bot, commands, scope);
            console.log(`📋 Menu ${label}: ${commands.length} perintah dipasang`);
        } catch (err) {
            const why = (err.response && err.response.body && err.response.body.description) || err.message;
            console.warn(`⚠️ Menu ${label} gagal: ${why}`);
        }
    }

    async function run() {
        // ===== 1. BOT DONASI (HANYA CHAT PRIBADI, TIDAK ADA PERINTAH DI GRUP) =====
        // Hapus perintah global/default dan grup agar tidak bocor ke grup
        await deleteCmds(botDonasi, { type: 'default' });
        await deleteCmds(botDonasi, { type: 'all_group_chats' });
        await apply('user chat pribadi (donasi)', botDonasi, USER_DONASI, { type: 'all_private_chats' });

        // ===== 2. BOT VIEWER (HANYA CHAT PRIBADI UNTUK USER) =====
        if (!isSameBot) {
            await deleteCmds(botViewer, { type: 'default' });
            // User di grup TIDAK MELIHAT perintah apa pun (menu kosong)
            await deleteCmds(botViewer, { type: 'all_group_chats' });
            await apply('user chat pribadi (viewer)', botViewer, USER_VIEWER, { type: 'all_private_chats' });
        }

        // ===== 3. ADMIN DI CHAT PRIBADI (perintah user + perintah admin) =====
        for (const id of adminIds) {
            await apply(`admin ${id} (donasi)`, botDonasi, [...USER_DONASI, ...DONASI_ADMIN], { type: 'chat', chat_id: id });
            if (!isSameBot) {
                await apply(`admin ${id} (viewer)`, botViewer, [...USER_VIEWER, ...CLEANUP_ADMIN], { type: 'chat', chat_id: id });
            }
        }

        // ===== 4. ADMIN DI GRUP (HANYA ADMIN YANG DAPAT MELIHAT PERINTAH DI GRUP) =====
        await apply('admin grup (hanya admin)', botViewer, GROUP_ADMIN, {
            type: 'chat_administrators',
            chat_id: config.groupId
        });
    }

    // ---------- Perintah USER di grup: /aturan & /statusku ----------
    const isGroup = (msg) => msg && msg.chat && String(msg.chat.id) === groupId;

    async function tempReply(msg, text) {
        try {
            const sent = await botViewer.sendMessage(groupId, text, { parse_mode: 'HTML' });
            setTimeout(() => botViewer.deleteMessage(groupId, sent.message_id).catch(() => { }), 25000);
        } catch (err) { console.error('❌ Gagal balas perintah grup:', err.message); }
        botViewer.deleteMessage(groupId, msg.message_id).catch(() => { });
    }

    botViewer.onText(/^\/aturan(?:@\w+)?$/i, (msg) => {
        if (!isGroup(msg)) return;
        tempReply(msg,
            `📜 <b>ATURAN GRUP</b>\n\n` +
            `🚫 Dilarang kirim link / promosi\n` +
            `⚠️ Pelanggaran: peringatan → mute → dikeluarkan\n` +
            `🚪 Keluar-masuk grup maksimal 3x\n` +
            `🛡️ Dilarang screenshot / rekam konten\n\n` +
            (donasiUsername
                ? `⚖️ <i>Terkena sanksi? Chat @${esc(donasiUsername)} lalu ketik</i> <code>/banding</code>`
                : ''));
    });

    botViewer.onText(/^\/statusku(?:@\w+)?$/i, (msg) => {
        if (!isGroup(msg) || !msg.from || msg.from.is_bot) return;
        const p = mod && mod.getPenalty(msg.from.id);
        const j = mod && mod.getJoinRecord(msg.from.id);
        const mute = p && p.muteUntil ? ` (mute ±${Math.ceil((p.muteUntil - Date.now()) / 60000)} menit)` : '';
        tempReply(msg,
            `👤 <b>Status</b> <a href="tg://user?id=${msg.from.id}">${esc(nameOf(msg.from))}</a>\n\n` +
            `⚠️ Peringatan: <b>${p ? p.count : 0}/3</b>${mute}\n` +
            `🚪 Masuk grup: <b>${j ? j.count : 0}/3</b>`);
    });

    // Beri jeda singkat setelah bot menyala
    setTimeout(run, 2500);
    console.log('📋 Menu perintah USER & ADMIN dijadwalkan.');
};
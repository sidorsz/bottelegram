// ===============================================================
// 🕶️ STEALTH — perintah admin di Grup & Channel dihapus SEKETIKA
// ---------------------------------------------------------------
// - GRUP    : setiap pesan perintah admin (/ai, /resetwarn, /cekwarn, /panel, dst)
//             langsung dihapus bot sehingga member tidak sempat melihatnya.
//             (perintah tetap diproses karena bot sudah menerima isinya)
// - CHANNEL : postingan yang berisi perintah admin dihapus seketika.
//             /panel dijalankan; hasilnya dikirim lewat DM ke admin.
// Syarat: bot harus admin dengan izin "Delete Messages" di grup & channel.
// Catatan: Telegram tetap menampilkan pesan sepersekian detik sebelum
// terhapus. Paling bersih: kirim perintah dari chat pribadi dengan bot.
// ===============================================================

const CMD_RE = /^\/([a-z0-9_]+)(?:@\w+)?(?:\s+(.*))?$/is;

// Perintah yang dianggap khusus admin (disembunyikan dari user)
const ADMIN_CMDS = new Set([
    'ai', 'resetwarn', 'cekwarn', 'panel', 'izinkan', 'broadcast',
    'hapus_semua', 'hapus_user', 'autohapus', 'status_hapus', 'debug_channel'
]);

module.exports = function setupStealth({ botDonasi, botViewer, config, getPanel }) {
    const groupId = String(config.groupId);
    const channelId = String(config.channelId);
    const adminIds = (config.adminIds || []).map(Number);

    // ---------- GRUP ----------
    // Hapus SEMUA pesan perintah (yang diawali '/') dari grup seketika agar obrolan grup selalu bersih
    const cleanGroupCmd = (bot, msg) => {
        if (!msg || !msg.chat || String(msg.chat.id) !== groupId) return;
        const text = (msg.text || msg.caption || '').trim();
        if (!text.startsWith('/')) return;

        // Dihapus seketika tanpa menunggu apa pun
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });
    };

    botViewer.on('message', (msg) => cleanGroupCmd(botViewer, msg));
    if (botDonasi && botDonasi !== botViewer) {
        botDonasi.on('message', (msg) => cleanGroupCmd(botDonasi, msg));
    }

    // ---------- CHANNEL ----------
    botDonasi.on('channel_post', async (post) => {
        if (!post || !post.chat || String(post.chat.id) !== channelId || !post.text) return;
        const m = post.text.match(CMD_RE);
        if (!m || !ADMIN_CMDS.has(m[1].toLowerCase())) return;

        const cmd = m[1].toLowerCase();
        const arg = (m[2] || '').trim().toLowerCase();

        // Hapus dulu supaya subscriber tidak melihatnya
        botDonasi.deleteMessage(post.chat.id, post.message_id).catch((err) => {
            console.warn('⚠️ Stealth: gagal hapus perintah di channel (cek izin Delete Messages):', err.message);
        });

        const dm = (text) => {
            for (const id of adminIds) botDonasi.sendMessage(id, text, { parse_mode: 'HTML' }).catch(() => { });
        };

        if (cmd === 'panel') {
            const panel = getPanel && getPanel();
            if (!panel) return dm('⚠️ Modul panel belum aktif.');
            const target = ['channel', 'grup'].includes(arg) ? arg : '';
            const report = await panel.execute(target);
            return dm(`💎 <b>Panel</b> (dari perintah di channel)\n\n${report.join('\n')}`);
        }

        dm(`ℹ️ Perintah <code>/${cmd}</code> tidak bisa dijalankan dari channel. Gunakan di chat pribadi bot atau di grup.`);
    });

    console.log('🕶️ Stealth aktif: perintah admin di grup & channel dihapus seketika.');
};

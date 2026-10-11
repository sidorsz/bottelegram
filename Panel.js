// ===============================================================
// 💎 PANEL PREMIUM — pesan bertombol yang di-pin di Channel & Grup
// ---------------------------------------------------------------
// ADMIN (chat pribadi dengan Bot Donasi):
//   /panel          → posting & pin panel di Channel dan Grup
//   /panel channel  → hanya Channel
//   /panel grup     → hanya Grup
// Menjalankan ulang akan menghapus panel lama lalu memposting yang baru.
// ===============================================================

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, 'panel_state.json');
const COVER_PATH = path.join(__dirname, 'cover.jpg');

const clean = (u) => (u || '').replace(/^@/, '');
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };

module.exports = function setupPanel({ botDonasi, botViewer, isSameBot, config }) {
    const adminIds = (config.adminIds || []).map(Number);
    const state = readJson(STATE_PATH, {});
    const save = () => fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), () => { });

    const url = {
        channel: `https://t.me/${clean(config.channelUsername)}`,
        group: `https://t.me/${clean(config.groupUsername)}`,
        viewer: `https://t.me/${clean(config.botViewer.username)}`,
        donasi: `https://t.me/${clean(config.botDonasi.username)}`
    };

    // ---------- Panel CHANNEL ----------
    const CHANNEL_TEXT =
        `╔══════════════════════════╗
║  💎  <b>PAP RATE COWOK</b>  💎
╚══════════════════════════╝

📸 Pap Rate member — dikirim <b>anonim</b>,
dimoderasi admin & terproteksi
anti-screenshot.

━━━━━━━━━━━━━━━━━━━━━━━

👁 <b>Lihat konten</b> lewat tombol di bawah
📤 <b>Kirim PAP</b> kamu sendiri secara anonim
💬 <b>Ngobrol & kasih rate</b> di grup diskusi

🔞 <i>Khusus 18+</i>`;

    const CHANNEL_KB = {
        inline_keyboard: [
            [{ text: '👁  Lihat Konten', url: url.viewer }],
            [{ text: '📤  Kirim Donasi PAP', url: url.donasi }],
            [{ text: '💬  Grup Diskusi', url: url.group }]
        ]
    };

    // ---------- Panel GRUP ----------
    const GROUP_TEXT =
        `╔══════════════════════════╗
║  💬  <b>GRUP DISKUSI</b>  💬
╚══════════════════════════╝

Selamat datang di komunitas
<b>Pap Rate Cowok</b> 💎

━━━━━━━━━━━━━━━━━━━━━━━

📜 <b>ATURAN GRUP</b>

🚫 Dilarang kirim link / promosi
⚠️ 3x peringatan = dikeluarkan
🚪 Keluar-masuk grup maksimal 3x
🛡️ Dilarang screenshot / rekam konten

━━━━━━━━━━━━━━━━━━━━━━━

⚖️ <i>Terkena sanksi? Ketik /banding di Bot Donasi.</i>
👇 <b>Gunakan tombol di bawah:</b>`;

    const GROUP_KB = {
        inline_keyboard: [
            [{ text: '📢  Channel Pap Rate', url: url.channel }],
            [{ text: '👁  Lihat Konten', url: url.viewer }],
            [{ text: '📤  Kirim Donasi PAP', url: url.donasi }]
        ]
    };

    // ---------- Posting + pin ----------
    async function post(key, bot, chatId, text, kb, withCover) {
        // Hapus panel lama
        if (state[key]) {
            await bot.unpinChatMessage(chatId, { message_id: state[key] }).catch(() => { });
            await bot.deleteMessage(chatId, state[key]).catch(() => { });
        }

        const opts = { parse_mode: 'HTML', reply_markup: kb };
        const sent = (withCover && fs.existsSync(COVER_PATH))
            ? await bot.sendPhoto(chatId, COVER_PATH, { caption: text, ...opts })
            : await bot.sendMessage(chatId, text, opts);

        state[key] = sent.message_id;
        save();

        let pinned = true;
        try {
            await bot.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
        } catch (err) {
            pinned = false;
            console.error(`⚠️ Gagal pin panel ${key}:`, err.message);
        }
        return pinned;
    }

    async function execute(target) {
        const report = [];

        if (!target || target === 'channel') {
            try {
                const pinned = await post('channel', botDonasi, config.channelId, CHANNEL_TEXT, CHANNEL_KB, true);
                report.push(`📢 Channel: ✅ terkirim${pinned ? ' & di-pin' : ' (gagal pin — beri izin Pin Messages)'}`);
            } catch (err) {
                report.push(`📢 Channel: ❌ ${err.message}`);
            }
        }

        if (!target || target === 'grup') {
            try {
                const pinned = await post('group', botViewer, config.groupId, GROUP_TEXT, GROUP_KB, false);
                report.push(`💬 Grup: ✅ terkirim${pinned ? ' & di-pin' : ' (gagal pin — beri izin Pin Messages)'}`);
            } catch (err) {
                report.push(`💬 Grup: ❌ ${err.message}`);
            }
        }

        return report;
    }

    botDonasi.onText(/^\/panel(?:@\w+)?(?:\s+(channel|grup))?$/i, async (msg, match) => {
        if (!msg.chat || msg.chat.type !== 'private') return;
        if (!msg.from || !adminIds.includes(Number(msg.from.id))) return;
        const report = await execute((match[1] || '').toLowerCase());
        botDonasi.sendMessage(msg.chat.id, `💎 <b>Panel</b>\n\n${report.join('\n')}`, { parse_mode: 'HTML' });
    });

    console.log('💎 Panel premium siap (/panel — khusus admin).');
    return { execute };
};
// Hilangkan peringatan deprecation node-telegram-bot-api
process.env.NTBA_FIX_350 = 1;

const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { saveMedia, getMedia, savePending, getPending, deletePending } = require('./db');

// Path gambar cover (gambar anime boy)
const COVER_PATH = path.join(__dirname, 'cover.jpg');
let cachedCoverFileId = null;

// Bersihkan awalan @ pada username untuk kebutuhan URL t.me/...
const cleanUsername = (username) => (username || '').replace(/^@/, '');
const botDonasiUsername = cleanUsername(config.botDonasi.username);
const botViewerUsername = cleanUsername(config.botViewer.username);

// ═══════════════════════════════════════════════════
// 🎨 PREMIUM UI KIT - Unicode & Icon Styling
// ═══════════════════════════════════════════════════
const UI = {
    // Divider premium
    line: '━━━━━━━━━━━━━━━━━━━━━━━',
    lineThin: '─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─',
    lineDot: '•───────────────────────•',

    // Icons (Bootstrap-style via Unicode/Emoji)
    icon: {
        bot: '🤖', premium: '💎', star: '⭐', crown: '👑',
        user: '👤', id: '🆔', link: '🔗', time: '⏰',
        photo: '📸', video: '🎥', voice: '🎙️', media: '📁',
        channel: '📢', group: '💬', send: '📤', inbox: '📥',
        check: '✅', cross: '❌', warn: '⚠️', info: 'ℹ️',
        lock: '🔒', shield: '🛡️', fire: '🔥', bolt: '⚡',
        approve: '✔️', reject: '✖️', pending: '⏳',
        arrow: '➡️', back: '◀️', next: '▶️', up: '▲', down: '▼',
        sparkle: '✨', gift: '🎁', heart: '💖', rocket: '🚀',
        scroll: '📜', rule: '📋', flag: '🚩', medal: '🏅',
        diamond: '◆', dot: '●', bullet: '▪️', check2: '☑️',
        hourglass: '⌛', bell: '🔔', megaphone: '📣', target: '🎯',
        trophy: '🏆', verified: '☑️', safe: '🛡️', vip: '👑'
    },

    // Helper: header box premium
    header: (text, icon = '💎') =>
        `╔══════════════════════╗\n` +
        `   ${icon}  ${text}  ${icon}\n` +
        `╚══════════════════════╝`,

    // Helper: section box
    section: (title, icon = '▪️') =>
        `\n${icon} <b>${title}</b>\n${'━'.repeat(20)}`,

    // Helper: badge
    badge: (text, type = 'info') => {
        const badges = {
            success: `✅ ${text}`,
            danger: `❌ ${text}`,
            warning: `⚠️ ${text}`,
            info: `ℹ️ ${text}`,
            premium: `💎 ${text}`,
            pending: `⏳ ${text}`
        };
        return badges[type] || text;
    }
};

console.log('╔══════════════════════════════════════════╗');
console.log('║  💎 PREMIUM TELEGRAM BOT SYSTEM v2.1    ║');
console.log('║  🛡️  Anti-Screenshot & Admin Approval   ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`🤖 Bot Donasi : @${botDonasiUsername}`);
console.log(`👁️  Bot Viewer : @${botViewerUsername}`);
console.log(`📢 Channel ID : ${config.channelId} (@${config.channelUsername})`);
console.log(`💬 Group ID   : ${config.groupId} (@${config.groupUsername})`);
console.log(`👑 Admin IDs  : ${config.adminIds.join(', ')}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Opsi Polling dengan allowed_updates lengkap termasuk chat_member, chat_join_request, edited_message & pre_checkout_query
const pollingOptions = {
    params: {
        allowed_updates: [
            'message',
            'edited_message',
            'callback_query',
            'channel_post',
            'chat_member',
            'chat_join_request',
            'pre_checkout_query'
        ]
    }
};

// Inisialisasi kedua bot
const isSameBot = config.botViewer.token === config.botDonasi.token;
const botDonasi = new TelegramBot(config.botDonasi.token, { polling: pollingOptions });
const botViewer = isSameBot
    ? botDonasi
    : new TelegramBot(config.botViewer.token, { polling: pollingOptions });

console.log('✅ Kedua bot berhasil diinisialisasi.');

// 🔍 DEBUG: Cek status channel & grup diskusi
setTimeout(async () => {
    try {
        const chat = await botDonasi.getChat(config.channelId);
        console.log('\n╔══════════════════════════════╗');
        console.log('║  🔍 CEK STATUS CHANNEL       ║');
        console.log('╚══════════════════════════════╝');
        console.log(`📢 Channel: ${chat.title}`);
        console.log(`🆔 ID: ${chat.id}`);

        if (chat.linked_chat_id) {
            console.log(`✅ LINKED ke Grup ID: ${chat.linked_chat_id}`);
            console.log('✅ Komentar Telegram otomatis aktif di postingan baru!');
        } else {
            console.log('❌ BELUM DI-LINK ke Grup Diskusi!');
            console.log('👉 Solusi: Manage Channel → Discussion → Add Group');
        }

        // Pastikan izin kirim media di grup diskusi selalu aktif
        try {
            await botViewer.setChatPermissions(config.groupId, {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_photos: true,
                can_send_videos: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true
            });
            console.log('✅ Izin Foto & Media di Grup Diskusi dipastikan AKTIF!');
        } catch (permErr) {
            console.warn('⚠️ Gagal set permission grup:', permErr.message);
        }

        // Cek apakah Bot Viewer admin di Channel & Grup (wajib untuk cek keanggotaan & moderasi)
        try {
            const me = await botViewer.getMe();
            for (const [label, id] of [['Channel', config.channelId], ['Grup', config.groupId]]) {
                try {
                    const m = await botViewer.getChatMember(id, me.id);
                    if (['administrator', 'creator'].includes(m.status)) {
                        console.log(`✅ Bot Viewer adalah ADMIN di ${label}`);
                    } else {
                        console.warn(`⚠️ Bot Viewer BUKAN admin di ${label} (status: ${m.status}) → jadikan admin!`);
                    }
                } catch (e) {
                    console.warn(`⚠️ Bot Viewer tidak bisa cek ${label}: ${e.message}`);
                }
            }
        } catch { }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } catch (err) {
        console.error('❌ Gagal cek channel:', err.message);
    }
}, 3000);

// 🕶️ STEALTH: Perintah admin di grup & channel dihapus seketika
let panel;
require('./stealth')({ botDonasi, botViewer, config, getPanel: () => panel });

// 🧹 Aktifkan pencatat & penghapus pesan bot (kontrol admin)
require('./cleanup')({ botDonasi, botViewer, isSameBot, config });

// Memory session untuk pengirim donasi
const userSessions = {};

// ⚡ Rate Limiter sederhana per user (cegah spam foto)
const userLastMediaTime = {};
const RATE_LIMIT_MS = 2000; // 2 detik

// 📁 Maksimal media per donasi (foto/video boleh campur)
const MAX_MEDIA = 2;

// ⚡ Cache keanggotaan — HANYA hasil "sudah join" yang di-cache (30 detik).
//    Hasil "belum join" tidak pernah di-cache, dan cache dibuang otomatis
//    saat user join / keluar (lihat moderasi.js).
const membershipCache = new Map();
const MEMBERSHIP_TTL_MS = 30 * 1000;

// ===============================================================
// HELPER: Cek Keanggotaan (Wajib Join Channel & Grup)
// force = true → abaikan cache, cek langsung ke Telegram
// ===============================================================

async function checkMembership(userId, force = false) {
    const now = Date.now();
    const cached = membershipCache.get(userId);
    if (!force && cached && cached.data.isMember && (now - cached.timestamp < MEMBERSHIP_TTL_MS)) {
        return cached.data;
    }

    const validStatuses = ['creator', 'administrator', 'member'];

    const check = async (chatId, label) => {
        try {
            const res = await botViewer.getChatMember(chatId, userId);
            return validStatuses.includes(res.status) ||
                (res.status === 'restricted' && res.is_member !== false);
        } catch (err) {
            console.error(
                `⚠️ getChatMember ${label} gagal (user ${userId}):`,
                (err.response && err.response.body && err.response.body.description) || err.message
            );
            return false;
        }
    };

    const [inChannel, inGroup] = await Promise.all([
        check(config.channelId, 'channel'),
        check(config.groupId, 'grup')
    ]);

    const result = { isMember: inChannel && inGroup, inChannel, inGroup };

    if (result.isMember) membershipCache.set(userId, { data: result, timestamp: now });
    else membershipCache.delete(userId);

    return result;
}

function getForceSubMarkup(code = '') {
    const channelUrl = `https://t.me/${config.channelUsername}`;
    const groupUrl = `https://t.me/${config.groupUsername}`;
    const callbackData = code ? `check_sub:${code}` : 'check_sub:none';

    return {
        inline_keyboard: [
            [
                { text: '📢  ① JOIN CHANNEL  📢', url: channelUrl }
            ],
            [
                { text: '💬  ② JOIN GRUP DISKUSI  💬', url: groupUrl }
            ],
            [
                { text: '🔄  ③ CEK STATUS VERIFIKASI  🔄', callback_data: callbackData }
            ]
        ]
    };
}

function getForceSubText(inChannel, inGroup) {
    const channelStatus = inChannel
        ? '✅ <b>SUDAH JOIN</b>'
        : '❌ <b>BELUM JOIN</b>';
    const groupStatus = inGroup
        ? '✅ <b>SUDAH JOIN</b>'
        : '❌ <b>BELUM JOIN</b>';

    return (
        `╔══════════════════════════════╗
║  🔒  AKSES TERKUNCI  🔒
║  ⚠️  WAJIB GABUNG DULU!  ⚠️
╚══════════════════════════════╝

👋 <b>Halo, Sobat Premium!</b>

Untuk mengakses seluruh fitur eksklusif bot ini, Anda <b>WAJIB</b> bergabung ke Channel & Grup Diskusi kami terlebih dahulu.

${UI.line}

📊 <b>STATUS KEANGGOTAAN ANDA:</b>

📢 <b>Channel Resmi</b>
   ${channelStatus}

💬 <b>Grup Diskusi</b>
   ${groupStatus}

${UI.line}

<i>📌 Klik tombol di bawah untuk bergabung ke keduanya, lalu tekan tombol <b>③ CEK STATUS</b> untuk membuka akses bot!</i>

💎 <b>Nikmati akses premium tanpa batas setelah bergabung!</b>`
    );
}

async function postCoverToChannel(caption, replyMarkup = null) {
    const coverSource = cachedCoverFileId || (fs.existsSync(COVER_PATH) ? COVER_PATH : null);
    if (!coverSource) {
        throw new Error('File cover.jpg tidak ditemukan di folder bot!');
    }

    // Opsi kirim: jangan pakai protect_content agar Telegram otomatis forward ke grup diskusi untuk kolom komentar
    const sendOptions = { caption, parse_mode: 'HTML' };
    if (replyMarkup) sendOptions.reply_markup = replyMarkup;

    const msg = await botDonasi.sendPhoto(config.channelId, coverSource, sendOptions);

    if (!cachedCoverFileId && msg.photo) {
        cachedCoverFileId = msg.photo[msg.photo.length - 1].file_id;
    }

    console.log(`✅ Posted to Channel (Msg ID: ${msg.message_id}) - Komentar native Telegram aktif!`);
    return msg;
}

// ===============================================================
// HELPER: Kirim Media Asli Ke User (Viewer Bot) dengan Anti-Screenshot
// Mendukung 1 atau 2 media (foto / video / campuran) → dikirim sebagai album
// ===============================================================

// Ubah stream menjadi Buffer (dipakai untuk sendMediaGroup)
async function toBuffer(stream) {
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
}

async function sendMediaToUser(chatId, code) {
    const media = getMedia(code);
    if (!media) {
        return botViewer.sendMessage(
            chatId,
            `⚠️ <b>Media tidak ditemukan</b>\n\n<i>Mungkin sudah kadaluarsa atau link salah.</i>`,
            { parse_mode: 'HTML', protect_content: true }
        );
    }

    // 🏷️ CEK: apakah user ini pengirim PAP-nya?
    const isOwner = media.senderId && String(media.senderId) === String(chatId);

    // 🎨 Banner khusus untuk pemilik
    const ownerBanner = isOwner
        ? `╭━━━━━━━━━━━━━━━━━━╮\n` +
        `┃  👑 <b>PAP MILIK ANDA</b> 👑\n` +
        `╰━━━━━━━━━━━━━━━━━━╯\n` +
        `✨ <i>Ini postingan hasil donasi Anda</i>\n\n`
        : '';

    // Caption
    const captionText = ownerBanner +
        (media.caption
            ? `💬 <i>"${media.caption}"</i>\n\n`
            : '') +
        `🛡️ <b>Konten Terproteksi — Anti Screenshot & Forward</b>`;

    // 🎨 Tombol berbeda untuk pemilik vs pengunjung biasa
    const replyMarkup = isOwner
        ? {
            inline_keyboard: [
                [
                    { text: '📢 Lihat di Channel', url: `https://t.me/${config.channelUsername}` }
                ],
                [
                    { text: '📤 Donasi PAP Lagi', url: `https://t.me/${botDonasiUsername}` }
                ]
            ]
        }
        : {
            inline_keyboard: [
                [
                    { text: '📢 Channel Pap Rate Cowok', url: `https://t.me/${config.channelUsername}` }
                ],
                [
                    { text: '💬 Grup Diskusi', url: `https://t.me/${config.groupUsername}` },
                    { text: '📤 Donasi PAP', url: `https://t.me/${botDonasiUsername}` }
                ]
            ]
        };

    // Dukung data lama (tanpa mediaList) & data baru (mediaList: foto/video, maks 2)
    const items = (media.mediaList && media.mediaList.length)
        ? media.mediaList
        : [{ type: media.type, fileId: media.fileId, viewerFileId: media.viewerFileId }];

    try {
        if (items.length === 1) {
            // ----- SINGLE MEDIA -----
            const it = items[0];
            const opts = {
                caption: captionText,
                parse_mode: 'HTML',
                reply_markup: replyMarkup,
                protect_content: true
            };
            const isPhoto = it.type === 'photo';
            const send = (src) => isPhoto
                ? botViewer.sendPhoto(chatId, src, opts)
                : botViewer.sendVideo(chatId, src, opts);

            if (it.viewerFileId) {
                await send(it.viewerFileId);
            } else {
                const sentMsg = await send(botDonasi.getFileStream(it.fileId));
                if (sentMsg) {
                    it.viewerFileId = isPhoto
                        ? sentMsg.photo[sentMsg.photo.length - 1].file_id
                        : sentMsg.video.file_id;
                }
            }
        } else {
            // ----- MULTI MEDIA (album: 2 foto / foto+video / 2 video) -----
            const group = [];
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                const isPhoto = it.type === 'photo';
                const entry = { type: isPhoto ? 'photo' : 'video' };

                if (it.viewerFileId) {
                    entry.media = it.viewerFileId;
                } else {
                    entry.media = await toBuffer(botDonasi.getFileStream(it.fileId));
                    entry.fileOptions = {
                        filename: isPhoto ? 'pap.jpg' : 'pap.mp4',
                        contentType: isPhoto ? 'image/jpeg' : 'video/mp4'
                    };
                }
                if (i === 0) {
                    entry.caption = captionText;
                    entry.parse_mode = 'HTML';
                }
                group.push(entry);
            }

            const sentMsgs = await botViewer.sendMediaGroup(chatId, group, { protect_content: true });

            // Cache file_id viewer supaya pengiriman berikutnya cepat
            sentMsgs.forEach((m, i) => {
                if (!items[i]) return;
                items[i].viewerFileId = m.photo
                    ? m.photo[m.photo.length - 1].file_id
                    : (m.video ? m.video.file_id : undefined);
            });

            // Album tidak bisa punya tombol → kirim tombol di pesan terpisah
            await botViewer.sendMessage(chatId, '👇 <b>Menu</b>', {
                parse_mode: 'HTML',
                reply_markup: replyMarkup,
                protect_content: true
            });
        }

        // Simpan cache viewerFileId
        media.mediaList = items;
        saveMedia(code, media);

        console.log(
            `👁️ [${new Date().toLocaleTimeString()}] Media (${items.length}x) kode ${code} → user ${chatId}` +
            (isOwner ? ' 👑 [OWNER VIEW]' : ' [PUBLIC VIEW]')
        );
    } catch (err) {
        console.error('❌ Gagal mengirim media:', err.response ? err.response.body : err.message);
        botViewer.sendMessage(
            chatId,
            `❌ <b>Gagal memuat media</b>\n\n<i>Silakan coba beberapa saat lagi.</i>`,
            { parse_mode: 'HTML', protect_content: true }
        );
    }
}

// ===============================================================
// HELPER: Sambutan Member Baru (Premium Welcome)
// ===============================================================

const recentWelcomes = new Set();

async function sendWelcome(chatId, user, contextName) {
    if (!user || user.is_bot) return;

    const welcomeKey = `${chatId}_${user.id}`;
    if (recentWelcomes.has(welcomeKey)) return;
    recentWelcomes.add(welcomeKey);
    setTimeout(() => recentWelcomes.delete(welcomeKey), 30000);

    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Teman';
    const usernameText = user.username ? `@${user.username}` : '<i>Tidak ada username</i>';
    const contextIcon = contextName === 'CHANNEL' ? '📢' : '💬';

    const welcomeText =
        `${contextIcon} <b>SELAMAT DATANG DI ${contextName}</b>

👤 <b>Nama</b> — ${fullName}
🆔 <b>ID</b> — <code>${user.id}</code>
🔗 <b>Username</b> — ${usernameText}

━━━━━━━━━━━━━━━━━━━

✨ Anda resmi bergabung di komunitas premium kami.

📸 Pap Rate berkualitas
🎁 Donasi PAP anonim
🛡️ Konten terproteksi

<i>💎 Gunakan tombol di bawah untuk mulai menjelajah.</i>`;

    const welcomeButtons = {
        inline_keyboard: [
            [
                { text: '📸 Buka Pap Rate', url: `https://t.me/${botViewerUsername}` }
            ],
            [
                { text: '📤 Kirim Donasi PAP', url: `https://t.me/${botDonasiUsername}` }
            ]
        ]
    };

    try {
        const sentMsg = await botViewer.sendMessage(chatId, welcomeText, {
            parse_mode: 'HTML',
            reply_markup: welcomeButtons
        });

        console.log(`🎉 [${new Date().toLocaleTimeString()}] Welcome → ${fullName} (${user.id}) di ${contextName}`);

        // ⏱️ AUTO-DELETE setelah 15 detik (khusus GRUP)
        if (contextName === 'GRUP' && sentMsg && sentMsg.message_id) {
            setTimeout(async () => {
                try {
                    await botViewer.deleteMessage(chatId, sentMsg.message_id);
                    console.log(`🗑️ [${new Date().toLocaleTimeString()}] Welcome message dihapus otomatis (15s) di ${contextName}`);
                } catch (err) {
                    // Abaikan error jika pesan sudah terhapus manual atau bot tidak punya izin
                    console.error(`⚠️ Gagal hapus welcome message: ${err.message}`);
                }
            }, 15000); // 15000ms = 15 detik
        }
    } catch (err) {
        console.error(`❌ Gagal welcome di ${contextName}:`, err.message);
    }
}

// ===============================================================
// 🛡️ MODERASI GRUP + WELCOME/GOODBYE (chat_member & service message)
// Anti-link, peringatan 1-3, mute, kick, pesan member keluar
// ===============================================================
const mod = require('./moderasi')({ botViewer, botDonasi, isSameBot, config, membershipCache, sendWelcome });
const banding = require('./Banding')({ botDonasi, botViewer, isSameBot, config, mod });
mod.setBanding(banding);

// 👑 Menu perintah khusus Admin & 💎 Panel Channel/Grup
require('./Adminmenu')({ botDonasi, botViewer, isSameBot, config, mod });
panel = require('./Panel')({ botDonasi, botViewer, isSameBot, config });
require('./ai')({ botViewer, config, mod });

// Auto-approve join request ke Grup Diskusi (agar user bisa langsung komentar tanpa tertahan admin)
const autoApproveJoinHandler = async (req) => {
    if (!req || !req.chat || !req.from) return;
    try {
        await botViewer.approveChatJoinRequest(req.chat.id, req.from.id);
        console.log(`✅ Auto-approve join request untuk ${req.from.first_name || 'User'} (${req.from.id}) di ${req.chat.title}`);
    } catch (err) {
        // Abaikan jika sudah di-approve
    }
};
botViewer.on('chat_join_request', autoApproveJoinHandler);
if (!isSameBot) {
    botDonasi.on('chat_join_request', autoApproveJoinHandler);
}

// ===============================================================
// HELPER: Proses Pengiriman Donasi Ke Admin
// ===============================================================

async function processSubmissionToAdmin(chatId, user) {
    const session = userSessions[chatId];
    if (!session || !session.mediaList || !session.mediaList.length || !session.voice) return;

    // Hentikan timer kadaluarsa & timer debounce karena sesi sudah diproses
    if (session.timer) clearTimeout(session.timer);
    if (session.submitTimer) clearTimeout(session.submitTimer);

    const submissionId = `sub_${Date.now()}`;
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Anonim';
    const usernameText = user.username ? `@${user.username}` : 'Tanpa Username';

    // Multi-media: maksimal 2 (foto / video / campuran)
    const mediaList = session.mediaList.slice(0, MAX_MEDIA);

    const subData = {
        id: submissionId,
        donorId: chatId,
        donorName: fullName,
        donorUsername: usernameText,
        mediaType: mediaList[0].type,
        mediaFileId: mediaList[0].fileId,
        mediaList: mediaList,          // array media
        caption: session.caption || '',
        voiceFileId: session.voice.fileId,
        createdAt: new Date().toISOString()
    };

    savePending(submissionId, subData);
    delete userSessions[chatId];

    // Beritahu pengirim
    await botDonasi.sendMessage(
        chatId,
        `╔══════════════════════════════╗
║  📤  KIRIMAN TERKIRIM!  📤
╚══════════════════════════════╝

✅ <b>Donasi PAP Anda berhasil diteruskan ke Admin!</b>

${UI.line}

🎙️ <b>Voice Note verifikasi</b> Anda sudah kami terima untuk keperluan moderasi.

${UI.line}

⏳ <b>STATUS:</b> Menunggu Persetujuan Admin

📢 <i>Setelah disetujui Admin, kiriman Anda akan otomatis diposting ke Channel secara <b>100% ANONIM</b>.</i>

🔔 <i>Anda akan mendapat notifikasi saat kiriman sudah diproses!</i>

💖 <b>Terima kasih telah berkontribusi untuk komunitas kami!</b>`,
        { parse_mode: 'HTML', protect_content: true }
    );

    console.log(`📥 [${new Date().toLocaleTimeString()}] Donasi baru dari ${fullName} (${chatId}). Menunggu approval...`);

    // Caption admin premium
    const adminCaption =
        `╔══════════════════════════════╗
║  📥  DONASI PAP BARU  📥
║  ⏳  PERLU PERSETUJUAN  ⏳
╚══════════════════════════════╝

${UI.line}

👤 <b>Pengirim</b>
   ${fullName}

🆔 <b>User ID</b>
   <code>${chatId}</code>

🔗 <b>Username</b>
   ${usernameText}

💬 <b>Caption</b>
   ${subData.caption || '<i>(Tidak ada caption)</i>'}

⏰ <b>Waktu Masuk</b>
   ${new Date().toLocaleString('id-ID')}

${UI.line}

🎙️ <i>Silakan dengarkan Voice Note verifikasi di bawah untuk memvalidasi keaslian pengirim.</i>

🛡️ <b>Review konten sebelum menyetujui!</b>`;

    const adminKeyboard = {
        inline_keyboard: [
            [
                { text: '✅  SETUJUI & POSTING KE CHANNEL', callback_data: `adm_app:${submissionId}` }
            ],
            [
                { text: '❌  TOLAK KIRIMAN INI', callback_data: `adm_rej:${submissionId}` }
            ]
        ]
    };

    for (const adminId of config.adminIds) {
        try {
            // Kirim semua media (maks 2: foto/video campur)
            const mediaToSend = subData.mediaList || [{ type: subData.mediaType, fileId: subData.mediaFileId }];
            for (let i = 0; i < mediaToSend.length; i++) {
                const m = mediaToSend[i];
                const isFirst = i === 0;
                const opts = {
                    caption: isFirst ? adminCaption : `📎 <b>Media ${i + 1}/${mediaToSend.length}</b>`,
                    parse_mode: 'HTML',
                    protect_content: true
                };
                if (m.type === 'photo') {
                    await botDonasi.sendPhoto(adminId, m.fileId, opts);
                } else {
                    await botDonasi.sendVideo(adminId, m.fileId, opts);
                }
            }

            await botDonasi.sendVoice(adminId, subData.voiceFileId, {
                caption: `🎙️ <b>Voice Note Verifikasi</b>\n👤 ${fullName}\n🆔 <code>${chatId}</code>`,
                parse_mode: 'HTML',
                protect_content: true
            }).catch(console.error);

            await botDonasi.sendMessage(
                adminId,
                `⚖️ <b>KEPUTUSAN ADMIN DIPERLUKAN</b>\n\n📋 <b>Submission ID:</b> <code>${submissionId}</code>\n\n${UI.lineThin}\n\n<i>Silakan periksa kesesuaian konten dan rekaman suara di atas, lalu pilih tindakan:</i>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: adminKeyboard,
                    protect_content: true
                }
            );
        } catch (err) {
            console.error(`❌ Gagal meneruskan ke Admin (${adminId}):`, err.message);
        }
    }
}

// ═══════════════════════════════════════════════════
// 📋 TEKS BANTUAN & TENTANG (Digunakan di Command & Callback)
// ═══════════════════════════════════════════════════

const HELP_TEXT_DONASI =
    `╔══════════════════════════════╗
║  💎  PUSAT BANTUAN  💎
╚══════════════════════════════╝

👋 <b>Halo! Berikut panduan Bot Donasi PAP:</b>

${UI.line}

📌 <b>PERINTAH TERSEDIA:</b>

   /start   ➔ Mulai & lihat rules donasi
   /tentang ➔ Tentang bot & komunitas
   /help    ➔ Bantuan lengkap
   /rules   ➔ Aturan donasi PAP
   /cancel  ➔ Batalkan sesi donasi
   /bersihkan ➔ Hapus riwayat chat bot

${UI.line}

🚀 <b>CARA DONASI PAP:</b>

   <b>1.</b> Kirim <b>Foto/Video PAP</b> (maks 2 media, boleh campur)
   <b>2.</b> Kirim <b>Voice Note</b> sebagai verifikasi
   <b>3.</b> Tunggu persetujuan Admin
   <b>4.</b> Kiriman diposting anonim ke Channel

${UI.line}

🛡️ <b>KEAMANAN:</b>
   ▪️ Identitas Anda 100% anonim
   ▪️ Konten terproteksi anti-screenshot
   ▪️ Moderasi ketat oleh admin

${UI.line}

💡 <i>Kirim media sekarang untuk mulai donasi!</i>`;

const TENTANG_TEXT =
    `╔══════════════════════════════╗
║  💎  TENTANG BOT  💎
╚══════════════════════════════╝

${UI.line}

👑 <b>Pap Rate Cowok</b> — Komunitas premium
berbagi konten PAP berkualitas tinggi dengan
sistem keamanan berlapis & anonim.

${UI.line}

🎯 <b>FITUR UNGGULAN:</b>

   ▪️ 📸 Pap Rate berkualitas premium
   ▪️ 🎁 Donasi PAP 100% anonim
   ▪️ 🛡️ Konten anti-screenshot & forward
   ▪️ 👥 Komunitas aktif & aman
   ▪️ ⚖️ Moderasi ketat oleh admin

${UI.line}

🔗 <b>LINK PENTING:</b>

   📢 Channel  ➔ @${config.channelUsername}
   💬 Grup     ➔ @${config.groupUsername}
   👁️ Viewer   ➔ @${botViewerUsername}
   📤 Donasi   ➔ @${botDonasiUsername}

${UI.line}

💖 <i>Terima kasih telah menjadi bagian dari komunitas kami!</i>`;

const HELP_TEXT_VIEWER =
    `╔══════════════════════════════╗
║  💎  PUSAT BANTUAN  💎
╚══════════════════════════════╝

👋 <b>Halo! Berikut panduan Bot Viewer:</b>

${UI.line}

📌 <b>PERINTAH TERSEDIA:</b>

   /start   ➔ Mulai bot viewer
   /tentang ➔ Tentang bot & komunitas
   /help    ➔ Bantuan lengkap
   /rules   ➔ Aturan komunitas
   /bersihkan ➔ Hapus riwayat chat bot

${UI.line}

🚀 <b>CARA MELIHAT PAP:</b>

   <b>1.</b> Buka postingan di Channel
   <b>2.</b> Klik link gambar/video
   <b>3.</b> Bot kirim konten ke chat ini
   <b>4.</b> Konten terproteksi anti-screenshot

${UI.line}

🛡️ <b>KEAMANAN:</b>
   ▪️ Anti-Screenshot
   ▪️ Anti-Forward
   ▪️ Konten Terproteksi

${UI.line}

💡 <i>Klik link di Channel untuk mulai melihat PAP!</i>`;

// ===============================================================
// HELPER: Handler Callback Tombol
// ===============================================================

const handleCallbackQuery = async (botInstance, query) => {
    const data = query.data || '';

    // A. Callback Cek Wajib Join
    if (data.startsWith('check_sub:')) {
        const code = data.replace('check_sub:', '');
        const userId = query.from.id;
        // force = true → selalu cek ulang langsung ke Telegram (tanpa cache)
        const membership = await checkMembership(userId, true);

        if (!membership.isMember) {
            const jRec = mod.getJoinRecord(userId);
            const isBlocked = jRec && jRec.blocked;
            const alertMsg = isBlocked
                ? '🚫 Akses grup Anda diblokir (keluar-masuk > 3x). Silakan pulihkan akun lewat bot donasi!'
                : '❌ Anda belum bergabung ke Channel & Grup! Silakan join keduanya dulu ya.';

            await botInstance.answerCallbackQuery(query.id, {
                text: alertMsg,
                show_alert: true
            });

            if (isBlocked && botInstance === botDonasi) {
                banding.sendAccessMenu(userId, query.from.first_name);
            }
            try {
                await botInstance.editMessageText(getForceSubText(membership.inChannel, membership.inGroup), {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: getForceSubMarkup(code === 'none' ? '' : code)
                });
            } catch { }
            return;
        }

        await botInstance.answerCallbackQuery(query.id, {
            text: '✅ Verifikasi sukses! Selamat datang di komunitas premium.',
            show_alert: false
        });

        try {
            await botInstance.deleteMessage(query.message.chat.id, query.message.message_id);
        } catch { }

        if (code && code !== 'none') {
            await sendMediaToUser(query.message.chat.id, code);
        } else {
            await botInstance.sendMessage(
                query.message.chat.id,
                `╔══════════════════════════════╗
║  ✅  AKSES DIBUKA!  ✅
╚══════════════════════════════╝

🎉 <b>Selamat! Akses premium Anda sudah aktif.</b>

${UI.line}

🚀 <b>Semua fitur bot kini terbuka untuk Anda:</b>

   ▪️ 📸 Lihat Pap Rate berkualitas
   ▪️ 🎁 Kirim donasi PAP anonim
   ▪️ 🛡️ Konten terproteksi anti-screenshot
   ▪️ 💬 Diskusi komunitas

${UI.line}

<i>💎 Silakan klik link di Channel untuk melihat gambar/video, atau kirim donasi PAP via tombol di bawah.</i>`,
                {
                    parse_mode: 'HTML',
                    protect_content: true,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📸 Buka Pap Rate', url: `https://t.me/${botViewerUsername}` }
                            ],
                            [
                                { text: '📤 Kirim Donasi PAP', url: `https://t.me/${botDonasiUsername}` }
                            ]
                        ]
                    }
                }
            );
        }
        return;
    }

    // B. Callback Persetujuan Admin (Approve)
    if (data.startsWith('adm_app:')) {
        // 🔒 Keamanan: Hanya Admin terdaftar yang boleh menekan tombol ini
        if (!config.adminIds.includes(query.from.id)) {
            return botInstance.answerCallbackQuery(query.id, {
                text: '⛔ Akses Ditolak: Anda bukan Admin!',
                show_alert: true
            }).catch(console.error);
        }

        const submissionId = data.replace('adm_app:', '');
        const sub = getPending(submissionId);

        if (!sub) {
            return botInstance.answerCallbackQuery(query.id, {
                text: '⚠️ Kiriman ini sudah pernah diproses sebelumnya!',
                show_alert: true
            }).catch(console.error);
        }

        try {
            const mediaCode = Buffer.from(`get-${Date.now()}`).toString('base64url');
            const viewerLink = `https://t.me/${botViewerUsername}?start=${mediaCode}`;
            const channelCaption =
                `${sub.caption ? sub.caption + '\n\n' : ''}${viewerLink}

<blockquote>kirim donasi pap :
➔ @${botDonasiUsername}</blockquote>

${config.hashtag}`;

            // Posting ke Channel TANPA inline keyboard agar kolom komentar native Telegram otomatis tampil
            const channelMsg = await postCoverToChannel(channelCaption);

            // Simpan SEMUA media (maks 2: foto/video campur) supaya viewer bisa menampilkan semuanya
            saveMedia(mediaCode, {
                type: sub.mediaType,            // kompatibilitas data lama
                fileId: sub.mediaFileId,        // kompatibilitas data lama
                mediaList: (sub.mediaList && sub.mediaList.length)
                    ? sub.mediaList
                    : [{ type: sub.mediaType, fileId: sub.mediaFileId }],
                channelMessageId: channelMsg.message_id,
                caption: sub.caption,
                senderId: sub.donorId
            });

            deletePending(submissionId);

            const donorApprovedButtons = {
                inline_keyboard: [
                    [
                        { text: '📢 Lihat Postingan di Channel', url: `https://t.me/${config.channelUsername}` }
                    ],
                    [
                        { text: '💬 Masuk ke Grup Diskusi', url: `https://t.me/${config.groupUsername}` }
                    ],
                    [
                        { text: '📸 Buka Pap Rate Cowok Bot', url: `https://t.me/${botViewerUsername}` }
                    ]
                ]
            };

            try {
                await botDonasi.sendMessage(
                    sub.donorId,
                    `╔══════════════════════════════╗
║  🎉  DONASI DISETUJUI!  🎉
╚══════════════════════════════╝

✅ <b>Selamat! Donasi PAP Anda telah disetujui Admin.</b>

${UI.line}

📢 <b>Status:</b> Sudah diposting ke Channel
🛡️ <b>Mode:</b> 100% ANONIM
💎 <b>Konten:</b> Terproteksi premium

${UI.line}

<i>💖 Terima kasih telah berkontribusi! Kiriman Anda sudah dilihat oleh ribuan member komunitas kami.</i>

👇 <b>Gunakan tombol di bawah untuk navigasi:</b>`,
                    {
                        parse_mode: 'HTML',
                        protect_content: true,
                        reply_markup: donorApprovedButtons
                    }
                );
            } catch { }

            await botInstance.editMessageText(
                `╔══════════════════════════════╗
║  ✅  DISETUJUI & DIPOSTING  ✅
╚══════════════════════════════╝

👤 <b>Donatur:</b> ${sub.donorName}
🆔 <b>User ID:</b> <code>${sub.donorId}</code>

${UI.lineThin}

📌 <b>Channel Message ID:</b> ${channelMsg.message_id}
🔗 <b>Media Code:</b> <code>${mediaCode}</code>

${UI.lineThin}

✨ <i>Postingan sukses dipublikasikan ke Channel!</i>`,
                {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML'
                }
            );

            await botInstance.answerCallbackQuery(query.id, {
                text: '✅ Berhasil disetujui & diposting ke Channel!',
                show_alert: false
            }).catch(console.error);

            console.log(`✅ [${new Date().toLocaleTimeString()}] Donasi ${submissionId} DISETUJUI oleh Admin ${query.from.id}`);
        } catch (err) {
            console.error('❌ Gagal proses approval:', err);
            await botInstance.answerCallbackQuery(query.id, {
                text: '❌ Gagal memposting ke channel: ' + err.message,
                show_alert: true
            }).catch(console.error);
        }
        return;
    }

    // C. Callback Penolakan Admin (Reject)
    if (data.startsWith('adm_rej:')) {
        // 🔒 Keamanan: Hanya Admin terdaftar yang boleh menekan tombol ini
        if (!config.adminIds.includes(query.from.id)) {
            return botInstance.answerCallbackQuery(query.id, {
                text: '⛔ Akses Ditolak: Anda bukan Admin!',
                show_alert: true
            }).catch(console.error);
        }

        const submissionId = data.replace('adm_rej:', '');
        const sub = getPending(submissionId);

        if (!sub) {
            return botInstance.answerCallbackQuery(query.id, {
                text: '⚠️ Kiriman ini sudah pernah diproses sebelumnya!',
                show_alert: true
            }).catch(console.error);
        }

        deletePending(submissionId);

        try {
            await botDonasi.sendMessage(
                sub.donorId,
                `╔══════════════════════════════╗
║  ❌  DONASI DITOLAK  ❌
╚══════════════════════════════╝

😔 <b>Mohon maaf, donasi PAP Anda ditolak oleh Admin.</b>

${UI.line}

📋 <b>Kemungkinan penyebab:</b>

   ▪️ Konten tidak sesuai Rule 1-5
   ▪️ Kualitas media kurang jelas
   ▪️ Voice note tidak sesuai

${UI.line}

💡 <i>Silakan periksa kembali persyaratan dan coba kirim ulang ya!</i>

💖 <b>Terima kasih atas pengertiannya.</b>`,
                { parse_mode: 'HTML', protect_content: true }
            );
        } catch { }

        await botInstance.editMessageText(
            `╔══════════════════════════════╗
║  ❌  KIRIMAN DITOLAK  ❌
╚══════════════════════════════╝

👤 <b>Donatur:</b> ${sub.donorName}
🆔 <b>User ID:</b> <code>${sub.donorId}</code>

${UI.lineThin}

<i>Kiriman telah ditolak dan tidak diposting ke Channel.</i>`,
            {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML'
            }
        );

        await botInstance.answerCallbackQuery(query.id, {
            text: '❌ Donasi ditolak.',
            show_alert: false
        }).catch(console.error);

        console.log(`❌ [${new Date().toLocaleTimeString()}] Donasi ${submissionId} DITOLAK oleh Admin ${query.from.id}`);
        return;
    }

    // D. Callback Help & About
    if (data === 'cmd_help') {
        await botInstance.answerCallbackQuery(query.id).catch(console.error);
        return botInstance.sendMessage(query.message.chat.id, HELP_TEXT_DONASI, {
            parse_mode: 'HTML',
            protect_content: true
        });
    }

    if (data === 'cmd_about') {
        await botInstance.answerCallbackQuery(query.id).catch(console.error);
        return botInstance.sendMessage(query.message.chat.id, TENTANG_TEXT, {
            parse_mode: 'HTML',
            protect_content: true
        });
    }
};

botViewer.on('callback_query', (q) => handleCallbackQuery(botViewer, q));
if (!isSameBot) {
    botDonasi.on('callback_query', (q) => handleCallbackQuery(botDonasi, q));
}

// ===============================================================
// 1. BOT DONASI
// ===============================================================

const RULES_WELCOME_TEXT =
    `╔══════════════════════════════╗
║  💎  BOT DONASI PAP PREMIUM  💎
╚══════════════════════════════╝

👋 <b>Selamat datang di Bot Donasi PAP!</b>

Sebelum mengirim donasi, mohon baca <b>5 RULES RESMI</b> berikut dengan teliti:

${UI.line}

📜 <b>RULES RESMI DONASI PAP</b>

   <b>①</b> 🚪 <b>Wajib Join</b>
   Bergabung di Channel & Grup Diskusi resmi kami

   <b>②</b> 🎙️ <b>Wajib Verifikasi Suara</b>
   Kirim 1 Voice Note sebagai verifikasi keaslian

   <b>③</b> 📸 <b>Kualitas Media</b>
   Foto/video harus jelas, tidak blur atau rusak
   (maksimal 2 media per donasi, foto/video boleh campur)

   <b>④</b> 🚫 <b>Etika Konten</b>
   Dilarang konten ilegal / di bawah umur / SARA / spam/ foto orang lain tanpa izin

   <b>⑤</b> ⚖️ <b>Persetujuan Admin</b>
   Semua kiriman dimoderasi sebelum diposting
   Identitas Anda tetap <b>100% ANONIM</b>

${UI.line}

🚀 <b>LANGKAH-LANGKAH DONASI</b>

   <b>Step 1</b> ➡️ Kirim <b>Foto/Video PAP</b> (maks 2) ke chat ini
   <b>Step 2</b> ➡️ Kirim <b>Voice Note</b> sebagai verifikasi
   <b>Step 3</b> ➡️ Tunggu persetujuan Admin
   <b>Step 4</b> ➡️ Kiriman diposting ke Channel (anonim)

${UI.line}

✨ <i>Silakan kirim Foto atau Video kamu sekarang untuk memulai!</i>

👇 <b>Bot siap menerima donasi Anda!</b>`;

botDonasi.onText(/\/start$/, async (msg) => {
    if (!msg.chat || msg.chat.type !== 'private') return;

    // Cek jika user diblokir dari grup (keluar-masuk > 3x) → beri opsi pemulihan otomatis
    const joinRec = mod.getJoinRecord(msg.from.id);
    if (joinRec && joinRec.blocked) {
        return banding.sendAccessMenu(msg.from.id, msg.from.first_name);
    }

    // Cek jika user punya sanksi batasan komentar (mute) aktif
    const penalty = mod.getPenalty(msg.from.id);
    if (penalty && penalty.muteUntil && penalty.muteUntil > Date.now()) {
        banding.sendBandingMenu(msg.from.id, 'Sedang dalam masa batasan komentar (mute)');
    }

    const membership = await checkMembership(msg.chat.id, true);
    if (!membership.isMember) {
        return botDonasi.sendMessage(
            msg.chat.id,
            getForceSubText(membership.inChannel, membership.inGroup),
            { parse_mode: 'HTML', protect_content: true, reply_markup: getForceSubMarkup('none') }
        );
    }

    botDonasi.sendMessage(msg.chat.id, RULES_WELCOME_TEXT, {
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: {
            inline_keyboard: [
                [{ text: '📢  Channel Pap Rate', url: `https://t.me/${config.channelUsername}` }],
                [{ text: '💬  Grup Diskusi', url: `https://t.me/${config.groupUsername}` }],
                [{ text: '👁  Buka Pap Rate', url: `https://t.me/${botViewerUsername}` }],
                [{ text: '🧹 Bersihkan Chat', callback_data: 'clean_menu' }]
            ]
        }
    });
});

botDonasi.onText(/\/cancel$/, (msg) => {
    if (!msg.chat || msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;
    // Bersihkan timer jika ada
    if (userSessions[chatId] && userSessions[chatId].timer) {
        clearTimeout(userSessions[chatId].timer);
    }
    if (userSessions[chatId] && userSessions[chatId].submitTimer) {
        clearTimeout(userSessions[chatId].submitTimer);
    }
    delete userSessions[chatId];
    botDonasi.sendMessage(
        chatId,
        `╔══════════════════════════════╗
         ║  🔄  SESI DIBATALKAN  🔄    ║
         ╚══════════════════════════════╝

✅ Sesi donasi Anda telah berhasil dibatalkan.

💡 <i>Silakan kirim media baru jika ingin memulai donasi lagi.</i>`,
        { parse_mode: 'HTML', protect_content: true }
    );
});

// ===============================================================
// Handler Media Donasi (Foto & Video) — maksimal 2 media, boleh campur
// (2 foto / 1 foto + 1 video / 2 video)
// ===============================================================

async function handleMediaSubmission(msg, type) {
    if (!msg.chat || msg.chat.type !== 'private') return;

    // 🛡️ CEK ALUR BANDING / PEMBAYARAN QRIS:
    // Pastikan foto bukti transfer QRIS TIDAK PERNAH masuk ke alur donasi PAP!
    if (banding && banding.isWaitingProof && banding.isWaitingProof(msg.chat.id)) {
        if (type === 'photo') {
            await banding.handleProofPhoto(msg);
        } else {
            botDonasi.sendMessage(msg.chat.id, '📷 Mohon kirim <b>foto / screenshot</b> bukti pembayaran QRIS (bukan video).\n\nKetik /cancel untuk membatalkan.', { parse_mode: 'HTML' });
        }
        if (userSessions[msg.chat.id]) delete userSessions[msg.chat.id];
        return; // SELESAI! Keluar langsung, jangan pernah masuk alur donasi PAP!
    }

    // Jangan proses media jika user sedang dalam alur banding
    if (banding && banding.isBusy && banding.isBusy(msg.chat.id)) return;

    const chatId = msg.chat.id;

    // ⚡ Rate Limiter — DILEWATI untuk album (media_group_id) agar 2 media sekaligus bisa masuk
    if (!msg.media_group_id) {
        const now = Date.now();
        if (userLastMediaTime[chatId] && (now - userLastMediaTime[chatId] < RATE_LIMIT_MS)) {
            return botDonasi.sendMessage(chatId, '⚠️ Terlalu cepat! Tunggu sebentar sebelum mengirim media berikutnya.', { protect_content: true });
        }
        userLastMediaTime[chatId] = now;
    }

    const membership = await checkMembership(chatId);
    if (!membership.isMember) {
        return botDonasi.sendMessage(
            chatId,
            getForceSubText(membership.inChannel, membership.inGroup),
            { parse_mode: 'HTML', protect_content: true, reply_markup: getForceSubMarkup('none') }
        );
    }

    const fileId = type === 'photo'
        ? msg.photo[msg.photo.length - 1].file_id
        : msg.video.file_id;
    const userCaption = (msg.caption || '').trim().substring(0, 500);

    // Inisialisasi sesi jika belum ada
    if (!userSessions[chatId]) userSessions[chatId] = {};
    const s = userSessions[chatId];
    if (!s.mediaList) s.mediaList = [];

    // Batas maksimal 2 media (foto + video boleh campur)
    if (s.mediaList.length >= MAX_MEDIA) {
        // Untuk album, abaikan diam-diam jika sudah penuh agar tidak spam pesan
        if (msg.media_group_id && s.lastGroupId === msg.media_group_id) return;
        return botDonasi.sendMessage(chatId,
            `⚠️ Maksimal <b>${MAX_MEDIA} media</b> (foto/video) per donasi sudah tercapai.\n` +
            (s.voice ? '' : 'Langkah berikutnya: kirim <b>Voice Note</b> untuk verifikasi! 🎙️\n') +
            'Kirim /cancel untuk mulai ulang.',
            { parse_mode: 'HTML', protect_content: true });
    }

    // Hapus timer lama jika ada (reset timeout)
    if (s.timer) clearTimeout(s.timer);

    // Tambahkan media ke list
    s.mediaList.push({ type, fileId });
    s.lastGroupId = msg.media_group_id || null;
    if (userCaption && !s.caption) s.caption = userCaption;
    // Media utama (untuk kompatibilitas backward)
    s.media = { ...s.mediaList[0], caption: s.caption || '' };

    // Set timer kadaluarsa 15 menit
    s.timer = setTimeout(() => {
        delete userSessions[chatId];
        botDonasi.sendMessage(chatId, '⏳ Sesi donasi kadaluarsa (15 menit). Silakan kirim ulang foto/video jika masih ingin berdonasi.').catch(() => { });
    }, 15 * 60 * 1000);

    // Voice sudah ada → tunggu sebentar (debounce) supaya media ke-2 dari album ikut terbawa
    if (s.voice) {
        if (s.submitTimer) clearTimeout(s.submitTimer);
        const from = msg.from;
        s.submitTimer = setTimeout(() => processSubmissionToAdmin(chatId, from), 1500);
        return;
    }

    const jumlah = s.mediaList.length;
    const sisa = MAX_MEDIA - jumlah;
    const fotoCount = s.mediaList.filter(m => m.type === 'photo').length;
    const videoCount = s.mediaList.filter(m => m.type === 'video').length;

    return botDonasi.sendMessage(
        chatId,
        `╔══════════════════════════════╗
║  📁  MEDIA ${jumlah}/${MAX_MEDIA} DITERIMA!  📁
╚══════════════════════════════╝

✅ <b>Tersimpan sementara:</b> ${fotoCount} foto, ${videoCount} video

${UI.line}

${sisa > 0 ? `📎 <i>Anda masih bisa kirim <b>${sisa} media lagi</b> (foto/video, opsional), atau langsung kirim Voice Note.</i>\n\n` : ''}🎙️ <b>LANGKAH WAJIB (RULE ②)</b>

Kirimkan <b>1 Voice Note</b> rekaman suara Anda sekarang untuk verifikasi!

${UI.line}

💡 <i>Tekan dan tahan ikon mikrofon di Telegram untuk merekam suara singkat.</i>

⏳ <b>Menunggu Voice Note...</b>`,
        { parse_mode: 'HTML', protect_content: true }
    );
}

// Handler Foto Donasi
botDonasi.on('photo', (msg) => handleMediaSubmission(msg, 'photo'));

// Handler Video Donasi
botDonasi.on('video', (msg) => handleMediaSubmission(msg, 'video'));

// Handler Voice Note / Audio Donasi
botDonasi.on('voice', async (msg) => {
    if (!msg.chat || msg.chat.type !== 'private') return;
    handleVoiceSubmission(msg);
});

botDonasi.on('audio', async (msg) => {
    if (!msg.chat || msg.chat.type !== 'private') return;
    handleVoiceSubmission(msg);
});

async function handleVoiceSubmission(msg) {
    const chatId = msg.chat.id;

    const membership = await checkMembership(chatId);
    if (!membership.isMember) {
        return botDonasi.sendMessage(
            chatId,
            getForceSubText(membership.inChannel, membership.inGroup),
            { parse_mode: 'HTML', protect_content: true, reply_markup: getForceSubMarkup('none') }
        );
    }

    const voiceId = msg.voice ? msg.voice.file_id : (msg.audio ? msg.audio.file_id : null);
    if (!voiceId) return;

    if (!userSessions[chatId]) userSessions[chatId] = {};
    userSessions[chatId].voice = { fileId: voiceId };

    if (!userSessions[chatId].mediaList || !userSessions[chatId].mediaList.length) {
        return botDonasi.sendMessage(
            chatId,
            `╔══════════════════════════════╗
║  🎙️  VOICE NOTE DITERIMA  🎙️
╚══════════════════════════════╝

✅ <b>Voice Note verifikasi berhasil tersimpan.</b>

${UI.line}

📸 <b>LANGKAH SELANJUTNYA (RULE ③)</b>

Sekarang silakan kirimkan <b>Foto atau Video PAP</b> yang ingin Anda donasikan (maks 2 media)!

${UI.line}

💡 <i>Pastikan kualitas media jelas dan tidak blur.</i>

⏳ <b>Menunggu Foto / Video...</b>`,
            { parse_mode: 'HTML', protect_content: true }
        );
    }

    await processSubmissionToAdmin(chatId, msg.from);
}

// ===============================================================
// 2. BOT VIEWER
// ===============================================================

// User klik tautan https://t.me/indopapratecowok_bot?start=KODE
botViewer.onText(/\/start (.+)/, async (msg, match) => {
    if (!msg.chat || msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const code = (match[1] || '').trim();

    // force = true → selalu cek ulang (user yang sudah keluar grup/channel langsung terkunci)
    const membership = await checkMembership(chatId, true);
    if (!membership.isMember) {
        return botViewer.sendMessage(
            chatId,
            getForceSubText(membership.inChannel, membership.inGroup),
            { parse_mode: 'HTML', protect_content: true, reply_markup: getForceSubMarkup(code) }
        );
    }

    await sendMediaToUser(chatId, code);
});

// Jika user langsung membuka bot viewer tanpa link kode
if (!isSameBot) {
    botViewer.onText(/\/start$/, async (msg) => {
        if (!msg.chat || msg.chat.type !== 'private') return;

        const membership = await checkMembership(msg.chat.id, true);
        if (!membership.isMember) {
            return botViewer.sendMessage(
                msg.chat.id,
                getForceSubText(membership.inChannel, membership.inGroup),
                { parse_mode: 'HTML', protect_content: true, reply_markup: getForceSubMarkup('none') }
            );
        }

        botViewer.sendMessage(
            msg.chat.id,
            `╔══════════════════════════════╗
║  💎  PAP RATE PREMIUM BOT  💎
╚══════════════════════════════╝

👋 <b>Halo, Sobat Premium!</b>

Bot ini digunakan untuk <b>melihat gambar/video asli</b> dari Channel kami dengan keamanan tingkat tinggi.

${UI.line}

🛡️ <b>FITUR KEAMANAN:</b>
   ▪️ 🔒 Anti-Screenshot
   ▪️ 🚫 Anti-Forward
   ▪️ 🛡️ Konten Terproteksi

${UI.line}

📌 <b>CARA MENGGUNAKAN:</b>

   ①  Buka postingan di Channel
   ②  Klik link gambar/video
   ③  Bot akan mengirimkan konten ke sini

${UI.line}

💡 <i>Atau Anda bisa langsung klik tombol di bawah untuk melihat koleksi Pap Rate kami!</i>`,
            {
                parse_mode: 'HTML',
                protect_content: true,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📸 Buka Channel Pap Rate', url: `https://t.me/${config.channelUsername}` }
                        ],
                        [
                            { text: '📤 Kirim Donasi PAP', url: `https://t.me/${botDonasiUsername}` }
                        ]
                    ]
                }
            }
        );
    });
}

console.log('╔══════════════════════════════════════════╗');
console.log('║  🚀  PREMIUM BOT SIAP BEROPERASI!  🚀   ║');
console.log('║  💎 UI Premium + Anti-Screenshot         ║');
console.log('║  ⚖️  Admin Approval System Active        ║');
console.log('║  ⚡ Membership Check + Rate Limiter ON   ║');
console.log('║  🛡️  Moderasi Grup + Welcome/Goodbye ON  ║');
console.log('╚══════════════════════════════════════════╝');

// ===============================================================
// 📣 BROADCAST SYSTEM — Hanya Admin
// ===============================================================

// Simpan user ID yang pernah /start
const BOT_USERS_PATH = path.join(__dirname, 'bot_users.json');
function loadBotUsers() {
    try { return JSON.parse(fs.readFileSync(BOT_USERS_PATH, 'utf8')); } catch { return []; }
}
function saveBotUsers(users) {
    fs.writeFileSync(BOT_USERS_PATH, JSON.stringify([...new Set(users)], null, 2));
}
let botUsers = loadBotUsers();

// Patch /start botDonasi untuk simpan user ID
botDonasi.onText(/\/start(\s.*)?$/, async (msg) => {
    if (!msg.chat || msg.chat.type !== 'private') return;
    const uid = msg.chat.id;
    if (!botUsers.includes(uid)) { botUsers.push(uid); saveBotUsers(botUsers); }
});

// Command /broadcast — hanya Admin
botDonasi.onText(/\/broadcast (.+)/s, async (msg, match) => {
    if (!msg.chat || msg.chat.type !== 'private') return;
    if (!config.adminIds.includes(msg.from.id)) {
        return botDonasi.sendMessage(msg.chat.id, '⛔ Hanya Admin yang bisa broadcast!', { protect_content: true });
    }
    const broadcastText = match[1].trim();
    const users = loadBotUsers();
    let sukses = 0, gagal = 0;
    await botDonasi.sendMessage(msg.chat.id, `📣 Memulai broadcast ke <b>${users.length}</b> user...`, { parse_mode: 'HTML' });
    for (const uid of users) {
        try {
            await botDonasi.sendMessage(uid,
                `📣 <b>PENGUMUMAN RESMI</b>\n\n${broadcastText}`,
                { parse_mode: 'HTML', protect_content: true }
            );
            sukses++;
        } catch { gagal++; }
        // Jeda kecil agar tidak kena rate limit Telegram
        await new Promise(r => setTimeout(r, 50));
    }
    await botDonasi.sendMessage(msg.chat.id,
        `✅ Broadcast selesai!\n📤 Terkirim: <b>${sukses}</b>\n❌ Gagal: <b>${gagal}</b>`,
        { parse_mode: 'HTML' }
    );
});

botDonasi.onText(/\/debug_channel$/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (!config.adminIds.includes(msg.from.id)) return;

    try {
        const chat = await botDonasi.getChat(config.channelId);
        let info = `📊 <b>DEBUG CHANNEL INFO</b>\n\n`;
        info += `📢 Title: ${chat.title}\n`;
        info += `🆔 ID: <code>${chat.id}</code>\n`;
        info += `🔗 Type: ${chat.type}\n`;
        info += `💬 Linked Chat: ${chat.linked_chat_id || '❌ BELUM DI-LINK'}\n\n`;

        if (chat.linked_chat_id) {
            const linkedChat = await botDonasi.getChat(chat.linked_chat_id);
            info += `✅ <b>LINKED!</b>\n`;
            info += `📌 Grup: ${linkedChat.title}\n`;
            info += `🆔 ID: <code>${linkedChat.id}</code>\n\n`;
            info += `✅ Komentar akan muncul di postingan baru!`;
        } else {
            info += `❌ <b>BELUM DI-LINK!</b>\n\n`;
            info += `👉 Solusi:\n`;
            info += `1. Buka Channel\n`;
            info += `2. Manage Channel\n`;
            info += `3. Discussion → Add Group\n`;
            info += `4. Pilih grup diskusi Anda`;
        }

        botDonasi.sendMessage(msg.chat.id, info, { parse_mode: 'HTML' });
    } catch (err) {
        botDonasi.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
    }
});

// /help & /rules
botDonasi.onText(/\/(help|rules)$/, (msg) => {
    if (msg.chat.type !== 'private') return;
    botDonasi.sendMessage(msg.chat.id, HELP_TEXT_DONASI, {
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📢 Channel', url: `https://t.me/${config.channelUsername}` },
                    { text: '💬 Grup Diskusi', url: `https://t.me/${config.groupUsername}` }
                ],
                [
                    { text: '👁️ Buka Viewer', url: `https://t.me/${botViewerUsername}` }
                ]
            ]
        }
    });
});

// /tentang
botDonasi.onText(/\/tentang$/, (msg) => {
    if (msg.chat.type !== 'private') return;
    botDonasi.sendMessage(msg.chat.id, TENTANG_TEXT, {
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📢 Channel Pap Rate', url: `https://t.me/${config.channelUsername}` }
                ],
                [
                    { text: '💬 Grup Diskusi', url: `https://t.me/${config.groupUsername}` }
                ]
            ]
        }
    });
});

// 🎯 AUTO-REPLY: Kalau user ketik teks apapun (bukan command, bukan media)
botDonasi.on('message', async (msg) => {
    if (!msg.chat || msg.chat.type !== 'private') return;
    if (!msg.text) return;                          // bukan teks → skip
    if (msg.text.startsWith('/')) return;           // command → skip
    if (msg.from.is_bot) return;                    // dari bot → skip
    if (banding.isBusy(msg.chat.id)) return;        // sedang alur banding → skip

    // Cek membership dulu
    const membership = await checkMembership(msg.chat.id);
    if (!membership.isMember) {
        return botDonasi.sendMessage(
            msg.chat.id,
            getForceSubText(membership.inChannel, membership.inGroup),
            { parse_mode: 'HTML', protect_content: true, reply_markup: getForceSubMarkup('none') }
        );
    }

    // Balas dengan instruksi
    botDonasi.sendMessage(
        msg.chat.id,
        `💎 <b>Bot ini aktif 24 jam, siap membantu Anda!</b>

${UI.line}

📌 <b>Yang bisa Anda lakukan:</b>

   ▪️ 📸 Kirim <b>Foto/Video PAP</b> untuk donasi (maks 2)
   ▪️ 🎙️ Kirim <b>Voice Note</b> untuk verifikasi
   ▪️ 📋 Ketik /help untuk panduan lengkap
   ▪️ ℹ️ Ketik /tentang untuk info komunitas
   ▪️ 🔄 Ketik /cancel untuk batalkan sesi

${UI.line}

<i>💡 Silakan kirim media PAP Anda sekarang — bot akan langsung memproses!</i>`,
        {
            parse_mode: 'HTML',
            protect_content: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📋 Bantuan', callback_data: 'cmd_help' },
                        { text: 'ℹ️ Tentang', callback_data: 'cmd_about' }
                    ],
                    [
                        { text: '📢 Channel', url: `https://t.me/${config.channelUsername}` }
                    ]
                ]
            }
        }
    );
});

// /help & /rules viewer
botViewer.onText(/\/(help|rules)$/, (msg) => {
    if (msg.chat.type !== 'private') return;
    botViewer.sendMessage(msg.chat.id, HELP_TEXT_VIEWER, {
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📢 Channel', url: `https://t.me/${config.channelUsername}` },
                    { text: '💬 Grup', url: `https://t.me/${config.groupUsername}` }
                ],
                [
                    { text: '📤 Donasi PAP', url: `https://t.me/${botDonasiUsername}` }
                ]
            ]
        }
    });
});

// /tentang viewer
botViewer.onText(/\/tentang$/, (msg) => {
    if (msg.chat.type !== 'private') return;
    botViewer.sendMessage(msg.chat.id, TENTANG_TEXT, {
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📢 Channel Pap Rate', url: `https://t.me/${config.channelUsername}` }
                ],
                [
                    { text: '💬 Grup Diskusi', url: `https://t.me/${config.groupUsername}` }
                ]
            ]
        }
    });
});

// 🎯 AUTO-REPLY VIEWER
botViewer.on('message', async (msg) => {
    if (!msg.chat || msg.chat.type !== 'private') return;
    if (!msg.text) return;
    if (msg.text.startsWith('/')) return;
    if (msg.from.is_bot) return;

    // Skip kalau pesan welcome dari grup
    if (msg.new_chat_members) return;

    const membership = await checkMembership(msg.chat.id);
    if (!membership.isMember) {
        return botViewer.sendMessage(
            msg.chat.id,
            getForceSubText(membership.inChannel, membership.inGroup),
            { parse_mode: 'HTML', protect_content: true, reply_markup: getForceSubMarkup('none') }
        );
    }

    botViewer.sendMessage(
        msg.chat.id,
        `💎 <b>Bot Viewer aktif 24 jam, siap membantu!</b>

${UI.line}

📌 <b>Yang bisa Anda lakukan:</b>

   ▪️ 📸 Klik link di Channel untuk lihat PAP
   ▪️ 📋 Ketik /help untuk panduan
   ▪️ ℹ️ Ketik /tentang untuk info bot
   ▪️ 📤 Kirim donasi PAP ke bot donasi

${UI.line}

<i>💡 Buka Channel & klik link postingan untuk melihat konten!</i>`,
        {
            parse_mode: 'HTML',
            protect_content: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📢 Buka Channel', url: `https://t.me/${config.channelUsername}` }
                    ],
                    [
                        { text: '📤 Donasi PAP', url: `https://t.me/${botDonasiUsername}` }
                    ]
                ]
            }
        }
    );
});
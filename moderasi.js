// ===============================================================
// 🛡️ MODERASI GRUP v2
// - Welcome / Goodbye
// - Anti-link + peringatan 1-3 (hapus → mute → kick)
// - Batas keluar-masuk grup maksimal 3x (lebih dari itu diblokir sampai admin izinkan)
// - API untuk banding.js (cabut / ringankan konsekuensi)
// - Pengingat video chat harian jam 19:00 WIB
// ===============================================================

const fs = require('fs');
const path = require('path');

const WARN_PATH = path.join(__dirname, 'warnings.json');
const JOIN_PATH = path.join(__dirname, 'joins.json');

const WARN_LIMIT = 3;                         // batas peringatan
const MUTE_MINUTES = 60;                      // durasi mute di peringatan ke-2
const WARN_EXPIRE_MS = 7 * 24 * 3600 * 1000;  // peringatan hangus setelah 7 hari
const NOTICE_TTL_MS = 30 * 1000;              // pesan peringatan dihapus otomatis
const BLOCK_MENTIONS = true;                  // blok @username promosi (whitelist di bawah)
const BAN_PERMANENT = false;                  // true = ban permanen, false = kick (bisa join lagi)

const MAX_JOINS = 3;                          // maksimal masuk grup (keluar-masuk)

// Pengingat video chat (WIB = UTC+7)
const VIDEO_CHAT = { enabled: true, hour: 19, minute: 0, adminRemindMinutesBefore: 10, pin: true };

const LINK_REGEX = new RegExp(
    '(https?:\\/\\/|www\\.|tg:\\/\\/|joinchat|telegram\\.(?:me|dog)|' +
    '\\b[a-z0-9-]+\\.(?:com|net|org|id|co|io|me|xyz|info|biz|site|online|link|top|club|vip|shop|store|app|cc|tv|live|fun|pro|gl|ly)(?![a-z0-9]))',
    'i'
);

const MUTE_PERMS = {
    can_send_messages: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false
};
const FULL_PERMS = {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_invite_users: true
};

const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const nameOf = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Pengguna';
const tag = (u) => `<a href="tg://user?id=${u.id}">${esc(nameOf(u))}</a>`;
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };

module.exports = function setupModeration({ botViewer, botDonasi, isSameBot, config, membershipCache, sendWelcome, banding }) {
    const groupId = String(config.groupId);
    const channelId = String(config.channelId);
    const adminIds = (config.adminIds || []).map(Number);
    const clean = (u) => (u || '').replace(/^@/, '').toLowerCase();
    const donasiUsername = clean(config.botDonasi && config.botDonasi.username);
    const mentionWhitelist = [
        config.channelUsername, config.groupUsername,
        config.botDonasi && config.botDonasi.username,
        config.botViewer && config.botViewer.username
    ].map(clean).filter(Boolean);

    let bandingModule = banding;

    // ---------- Penyimpanan ----------
    const warnings = readJson(WARN_PATH, {});
    const joins = readJson(JOIN_PATH, {});
    const saveWarnings = () => fs.writeFile(WARN_PATH, JSON.stringify(warnings, null, 2), () => { });
    const saveJoins = () => fs.writeFile(JOIN_PATH, JSON.stringify(joins, null, 2), () => { });
    const wkey = (uid) => `${groupId}:${uid}`;

    const autoDelete = (chatId, msgId, ms) =>
        setTimeout(() => botViewer.deleteMessage(chatId, msgId).catch(() => { }), ms);

    // ---------- Cek admin grup (cache 60 detik) ----------
    const adminCache = new Map();
    async function isAdmin(userId) {
        if (adminIds.includes(Number(userId))) return true;
        const c = adminCache.get(userId);
        if (c && Date.now() - c.t < 60000) return c.v;
        let v = false;
        try {
            const m = await botViewer.getChatMember(groupId, userId);
            v = ['creator', 'administrator'].includes(m.status);
        } catch { v = false; }
        adminCache.set(userId, { v, t: Date.now() });
        return v;
    }

    // ---------- Goodbye ----------
    const recentGoodbyes = new Set();
    const silentLeave = new Set(); // user yang kita kick/ban sendiri (sudah ada pengumuman)

    async function sendGoodbye(user, kicked = false) {
        if (!user || user.is_bot) return;
        if (silentLeave.has(user.id)) return;
        const key = `bye_${user.id}`;
        if (recentGoodbyes.has(key)) return;
        recentGoodbyes.add(key);
        setTimeout(() => recentGoodbyes.delete(key), 30000);

        const uname = user.username ? `@${esc(user.username)}` : '<i>Tidak ada username</i>';
        const text =
            `👋 <b>${kicked ? 'MEMBER DIKELUARKAN' : 'MEMBER KELUAR'}</b>\n\n` +
            `👤 <b>Nama</b> — ${esc(nameOf(user))}\n` +
            `🆔 <b>ID</b> — <code>${user.id}</code>\n` +
            `🔗 <b>Username</b> — ${uname}\n\n` +
            `━━━━━━━━━━━━━━━━━━━\n\n` +
            `<i>${kicked ? 'Telah dikeluarkan dari grup.' : 'Sampai jumpa lagi! 💎'}</i>`;
        try {
            const sent = await botViewer.sendMessage(groupId, text, { parse_mode: 'HTML' });
            autoDelete(groupId, sent.message_id, 15000);
            console.log(`👋 Goodbye → ${nameOf(user)} (${user.id})`);
        } catch (err) {
            console.error('❌ Gagal kirim goodbye:', err.message);
        }
    }

    // ---------- Join grup + batas keluar-masuk ----------
    const recentJoinKeys = new Set();

    async function handleGroupJoin(user) {
        if (!user || user.is_bot) return;
        membershipCache.delete(user.id);

        // Dedupe: event chat_member & service message bisa datang bersamaan
        const key = `j_${user.id}`;
        if (recentJoinKeys.has(key)) return;
        recentJoinKeys.add(key);
        setTimeout(() => recentJoinKeys.delete(key), 30000);

        if (await isAdmin(user.id)) {
            await sendWelcome(groupId, user, 'GRUP');
            return;
        }

        const rec = joins[user.id] || { count: 0, blocked: false };
        rec.count += 1;
        rec.name = nameOf(user);
        rec.username = user.username || '';
        rec.t = Date.now();
        joins[user.id] = rec;

        if (rec.count > MAX_JOINS) {
            rec.blocked = true;
            saveJoins();

            silentLeave.add(user.id);
            setTimeout(() => silentLeave.delete(user.id), 60000);
            try {
                const ban = botViewer.banChatMember ? 'banChatMember' : 'kickChatMember';
                await botViewer[ban](groupId, user.id);
            } catch (err) { console.error('❌ Gagal blokir user keluar-masuk:', err.message); }

            try {
                const sent = await botViewer.sendMessage(groupId,
                    `🚫 <b>AKSES DIBLOKIR</b>\n\n` +
                    `👤 ${tag(user)}\n🆔 <code>${user.id}</code>\n\n` +
                    `Keluar-masuk grup lebih dari <b>${MAX_JOINS}x</b>. ` +
                    `Untuk masuk lagi, minta izin admin lewat @${esc(donasiUsername)} → <code>/minta_akses</code>`,
                    { parse_mode: 'HTML' });
                autoDelete(groupId, sent.message_id, NOTICE_TTL_MS);
            } catch { }

            // Kirim otomatis menu pemulihan akses ke DM user via bot donasi
            if (bandingModule && bandingModule.sendAccessMenu) {
                setTimeout(() => bandingModule.sendAccessMenu(user.id, nameOf(user)), 1500);
            } else {
                botDonasi.sendMessage(user.id,
                    `🚫 <b>Anda diblokir dari grup</b>\n\nKarena keluar-masuk grup lebih dari ${MAX_JOINS}x.\n` +
                    `Ketik /minta_akses untuk opsi pemulihan lewat admin / pembayaran.`,
                    { parse_mode: 'HTML' }).catch(() => { });
            }

            console.log(`🚫 Blokir keluar-masuk → ${nameOf(user)} (${user.id}) join ke-${rec.count}`);
            return;
        }

        saveJoins();
        await sendWelcome(groupId, user, 'GRUP');

        if (rec.count === MAX_JOINS) {
            try {
                const sent = await botViewer.sendMessage(groupId,
                    `⚠️ ${tag(user)}, ini adalah masuk grup ke-<b>${MAX_JOINS}</b> (terakhir). ` +
                    `Jika keluar lalu masuk lagi, Anda akan <b>diblokir</b>.`,
                    { parse_mode: 'HTML' });
                autoDelete(groupId, sent.message_id, 20000);
            } catch { }
        }
    }

    // ---------- Event chat_member (join / leave) ----------
    function onChatMember(update) {
        if (!update || !update.chat || !update.new_chat_member) return;
        const chatId = String(update.chat.id);
        if (chatId !== groupId && chatId !== channelId) return;

        const user = update.new_chat_member.user;
        const oldS = update.old_chat_member ? update.old_chat_member.status : '';
        const newS = update.new_chat_member.status;

        membershipCache.delete(user.id); // status berubah → buang cache

        const wasOut = ['left', 'kicked'].includes(oldS);
        const isIn = ['member', 'restricted', 'administrator', 'creator'].includes(newS);
        const wasIn = ['member', 'restricted', 'administrator'].includes(oldS);
        const isOut = ['left', 'kicked'].includes(newS);

        if (wasOut && isIn) {
            if (chatId === groupId) handleGroupJoin(user);
            else sendWelcome(update.chat.id, user, 'CHANNEL');
        } else if (wasIn && isOut && chatId === groupId) {
            sendGoodbye(user, newS === 'kicked');
        }
    }
    botViewer.on('chat_member', onChatMember);
    if (!isSameBot) botDonasi.on('chat_member', onChatMember);

    // ---------- Deteksi pelanggaran ----------
    function detectViolation(msg) {
        const text = msg.text || msg.caption || '';
        const entities = msg.entities || msg.caption_entities || [];

        const fwd = msg.forward_from_chat ||
            (msg.forward_origin && ['channel', 'chat'].includes(msg.forward_origin.type));
        if (fwd) return 'Meneruskan pesan dari channel/grup lain (promosi)';

        for (const e of entities) {
            if (e.type === 'url' || e.type === 'text_link') return 'Mengirim link';
            if (BLOCK_MENTIONS && e.type === 'mention') {
                const uname = clean(text.substr(e.offset, e.length));
                if (!mentionWhitelist.includes(uname)) return 'Promosi @username channel/grup';
            }
        }
        if (LINK_REGEX.test(text)) return 'Mengirim link / promosi';
        return null;
    }

    // ---------- Eksekusi hukuman ----------
    async function punish(msg, reason) {
        const chatId = msg.chat.id;
        const user = msg.from;

        try {
            await botViewer.deleteMessage(chatId, msg.message_id);
        } catch (err) {
            console.error('❌ Gagal hapus pesan (bot harus admin + izin Delete Messages):', err.message);
        }

        const key = wkey(user.id);
        let w = warnings[key];
        if (!w || (Date.now() - w.t > WARN_EXPIRE_MS && !(w.muteUntil > Date.now()))) w = { count: 0, t: Date.now() };
        w.count += 1;
        w.t = Date.now();
        warnings[key] = w;

        let consequence;
        if (w.count === 1) {
            consequence = `Pelanggaran berikutnya → <b>MUTE ${MUTE_MINUTES} menit</b>.`;
        } else if (w.count < WARN_LIMIT) {
            consequence = `Anda <b>di-MUTE ${MUTE_MINUTES} menit</b>. Pelanggaran berikutnya → <b>DIKELUARKAN</b>.`;
            w.muteUntil = Date.now() + MUTE_MINUTES * 60000;
            try {
                await botViewer.restrictChatMember(chatId, user.id, {
                    permissions: MUTE_PERMS,
                    until_date: Math.floor(w.muteUntil / 1000)
                });
            } catch (err) { console.error('❌ Gagal mute:', err.message); }
        } else {
            consequence = BAN_PERMANENT
                ? 'Batas peringatan tercapai → <b>DIBLOKIR PERMANEN</b> dari grup.'
                : 'Batas peringatan tercapai → <b>DIKELUARKAN</b> dari grup.';
            silentLeave.add(user.id);
            setTimeout(() => silentLeave.delete(user.id), 60000);
            try {
                const ban = botViewer.banChatMember ? 'banChatMember' : 'kickChatMember';
                await botViewer[ban](chatId, user.id);
                if (!BAN_PERMANENT) {
                    setTimeout(() => botViewer.unbanChatMember(chatId, user.id, { only_if_banned: true }).catch(() => { }), 3000);
                }
            } catch (err) { console.error('❌ Gagal kick:', err.message); }
            delete warnings[key];
            membershipCache.delete(user.id);
        }
        saveWarnings();

        const appealHint = donasiUsername
            ? `\n\n💡 <i>Ingin keringanan? Chat @${esc(donasiUsername)} lalu ketik</i> <code>/banding</code>`
            : '';
        const text =
            `🚨 <b>PERINGATAN ${Math.min(w.count, WARN_LIMIT)}/${WARN_LIMIT}</b>\n\n` +
            `👤 <b>Nama</b> — ${tag(user)}\n` +
            `🆔 <b>ID</b> — <code>${user.id}</code>\n` +
            `📛 <b>Pelanggaran</b> — ${esc(reason)}\n\n` +
            `⚖️ <b>Konsekuensi:</b> ${consequence}\n\n` +
            `<i>Dilarang promosi link / channel / grup di sini.</i>` + appealHint;
        try {
            const sent = await botViewer.sendMessage(chatId, text, { parse_mode: 'HTML' });
            autoDelete(chatId, sent.message_id, NOTICE_TTL_MS);
        } catch (err) { console.error('❌ Gagal kirim peringatan:', err.message); }

        console.log(`🚨 Warn ${w.count}/${WARN_LIMIT} → ${nameOf(user)} (${user.id}) | ${reason}`);

        // Kirim otomatis menu pemulihan ke DM user via bot donasi
        // (delay 2 detik agar pesan grup terkirim dulu)
        if (bandingModule && bandingModule.sendBandingMenu) {
            setTimeout(() => bandingModule.sendBandingMenu(user.id, reason), 2000);
        }
    }

    // ---------- Handler pesan grup ----------
    async function onGroupMessage(msg) {
        if (!msg || !msg.chat || String(msg.chat.id) !== groupId) return;

        if (msg.new_chat_members) {
            for (const u of msg.new_chat_members) await handleGroupJoin(u);
            return;
        }
        if (msg.left_chat_member) {
            membershipCache.delete(msg.left_chat_member.id);
            await sendGoodbye(msg.left_chat_member, false);
            return;
        }

        if (!msg.from || msg.from.is_bot) return;
        if (msg.is_automatic_forward || msg.sender_chat) return;   // postingan channel / admin anonim
        if (await isAdmin(msg.from.id)) return;

        const reason = detectViolation(msg);
        if (reason) await punish(msg, reason);
    }
    botViewer.on('message', onGroupMessage);
    botViewer.on('edited_message', onGroupMessage);

    // ---------- Admin: /resetwarn & /cekwarn (balas pesan user ATAU tulis ID) ----------
    const targetOf = (msg, match) => {
        if (match && match[1]) return Number(match[1]);
        const r = msg.reply_to_message;
        if (r && r.from && !r.from.is_bot && r.from.id !== 777000) return r.from.id;
        return null;
    };

    const notice = async (text) => {
        try {
            const s = await botViewer.sendMessage(groupId, text, { parse_mode: 'HTML' });
            autoDelete(groupId, s.message_id, 15000);
        } catch { }
    };

    botViewer.onText(/^\/resetwarn(?:@\w+)?(?:\s+(\d+))?$/i, async (msg, match) => {
        if (!msg.chat || String(msg.chat.id) !== groupId) return;
        if (!msg.from || !(await isAdmin(msg.from.id))) return;
        botViewer.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });

        const target = targetOf(msg, match);
        if (!target) return notice('ℹ️ Balas pesan user, atau tulis ID: <code>/resetwarn 123456</code>');

        await api.clearPenalty(target);   // reset peringatan + cabut mute
        notice(`✅ Peringatan & mute user <code>${target}</code> direset.`);
    });

    botViewer.onText(/^\/cekwarn(?:@\w+)?(?:\s+(\d+))?$/i, async (msg, match) => {
        if (!msg.chat || String(msg.chat.id) !== groupId) return;
        if (!msg.from || !(await isAdmin(msg.from.id))) return;
        botViewer.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });

        const target = targetOf(msg, match);
        if (!target) return notice('ℹ️ Balas pesan user, atau tulis ID: <code>/cekwarn 123456</code>');

        const p = api.getPenalty(target);
        const j = joins[target];
        const mute = p && p.muteUntil ? `, mute ±${Math.ceil((p.muteUntil - Date.now()) / 60000)} menit` : '';
        notice(
            `🔎 <b>Status</b> <code>${target}</code>\n` +
            `⚠️ Peringatan: <b>${p ? p.count : 0}/${WARN_LIMIT}</b>${mute}\n` +
            `🚪 Masuk grup: <b>${j ? j.count : 0}/${MAX_JOINS}</b>${j && j.blocked ? ' (DIBLOKIR)' : ''}`
        );
    });

    // ---------- Pengingat Video Chat harian (WIB) ----------
    // CATATAN: Bot API TIDAK bisa memulai video chat. Bot hanya mengingatkan,
    // admin yang menekan "Start Video Chat" (atau pakai "Schedule Video Chat" bawaan Telegram).
    const reminded = {};
    if (VIDEO_CHAT.enabled) {
        setInterval(async () => {
            const wib = new Date(Date.now() + 7 * 3600 * 1000);
            const day = wib.toISOString().slice(0, 10);
            const nowMin = wib.getUTCHours() * 60 + wib.getUTCMinutes();
            const startMin = VIDEO_CHAT.hour * 60 + VIDEO_CHAT.minute;
            const hh = String(VIDEO_CHAT.hour).padStart(2, '0');
            const mm = String(VIDEO_CHAT.minute).padStart(2, '0');

            // 1) Ingatkan admin beberapa menit sebelumnya
            const preMin = startMin - VIDEO_CHAT.adminRemindMinutesBefore;
            if (nowMin === preMin && reminded[`pre_${day}`] !== true) {
                reminded[`pre_${day}`] = true;
                for (const id of adminIds) {
                    botDonasi.sendMessage(id,
                        `📹 <b>Pengingat Admin</b>\n\nVideo chat grup dimulai jam <b>${hh}:${mm} WIB</b> ` +
                        `(${VIDEO_CHAT.adminRemindMinutesBefore} menit lagi). Silakan siapkan & mulai video chat di grup.`,
                        { parse_mode: 'HTML' }).catch(() => { });
                }
            }

            // 2) Umumkan ke grup tepat waktu
            if (nowMin === startMin && reminded[`go_${day}`] !== true) {
                reminded[`go_${day}`] = true;
                try {
                    const sent = await botViewer.sendMessage(groupId,
                        `📹 <b>VIDEO CHAT MALAM INI — ${hh}:${mm} WIB</b>\n\n` +
                        `Admin akan memulai video chat. Bergabung lewat ikon video chat di bagian atas grup.\n\n` +
                        `🚫 <b>Dilarang screenshot / merekam layar.</b> Pelanggar yang dilaporkan akan dikenai sanksi.`,
                        { parse_mode: 'HTML' });
                    if (VIDEO_CHAT.pin) {
                        botViewer.pinChatMessage(groupId, sent.message_id).catch(() => { });
                    }
                } catch (err) { console.error('❌ Gagal kirim pengumuman video chat:', err.message); }
            }
        }, 20 * 1000);
    }

    // ---------- API untuk banding.js ----------
    async function unmute(uid) {
        try {
            await botViewer.restrictChatMember(groupId, uid, { permissions: FULL_PERMS });
        } catch (err) { console.error('⚠️ Gagal cabut mute:', err.message); }
    }

    const api = {
        groupId,
        isAdmin,
        isViolation: (msg) => !!detectViolation(msg),

        // Konsekuensi aktif user (peringatan / mute). null jika tidak ada.
        getPenalty(uid) {
            const w = warnings[wkey(uid)];
            if (!w) return null;
            const muted = w.muteUntil && w.muteUntil > Date.now();
            const expired = Date.now() - (w.t || 0) > WARN_EXPIRE_MS;
            const count = expired ? 0 : (w.count || 0);
            if (!count && !muted) return null;
            return { count, muteUntil: muted ? w.muteUntil : 0 };
        },

        // Cabut penuh: reset peringatan + buka mute
        async clearPenalty(uid) {
            delete warnings[wkey(uid)];
            saveWarnings();
            await unmute(uid);
            return { action: 'cleared' };
        },

        // Ringankan: potong sisa mute 50% (jika tidak sedang mute → kurangi 1 peringatan)
        async shortenPenalty(uid) {
            const w = warnings[wkey(uid)];
            if (!w) return { action: 'none' };
            const now = Date.now();

            if (w.muteUntil && w.muteUntil > now) {
                const newRemain = Math.floor((w.muteUntil - now) / 2);
                if (newRemain < 40000) {
                    w.muteUntil = 0;
                    await unmute(uid);
                    saveWarnings();
                    return { action: 'mute_lifted' };
                }
                w.muteUntil = now + newRemain;
                try {
                    await botViewer.restrictChatMember(groupId, uid, {
                        permissions: MUTE_PERMS,
                        until_date: Math.floor(w.muteUntil / 1000)
                    });
                } catch (err) { console.error('⚠️ Gagal perpendek mute:', err.message); }
                saveWarnings();
                return { action: 'mute_shortened', minutes: Math.ceil(newRemain / 60000) };
            }

            w.count = Math.max(0, (w.count || 0) - 1);
            if (!w.count) delete warnings[wkey(uid)];
            saveWarnings();
            return { action: 'warn_reduced', count: w.count };
        },

        getJoinRecord(uid) { return joins[uid] || null; },

        // Izinkan user yang diblokir (keluar-masuk >3x) masuk lagi
        async allowRejoin(uid) {
            const rec = joins[uid] || { count: 0 };
            rec.count = 0;
            rec.blocked = false;
            joins[uid] = rec;
            saveJoins();
            try {
                await botViewer.unbanChatMember(groupId, uid, { only_if_banned: true });
            } catch (err) { console.error('⚠️ Gagal unban:', err.message); }
            membershipCache.delete(uid);
        },

        setBanding(b) {
            bandingModule = b;
        }
    };

    console.log('🛡️ Moderasi grup aktif (welcome, goodbye, anti-link, peringatan 1-3, batas keluar-masuk, pengingat video chat).');
    return api;
};
// ===============================================================
// 🧹 CLEANUP — Pencatat & Penghapus Pesan (Bot Donasi & Bot Viewer)
// ---------------------------------------------------------------
// ADMIN : /hapus_semua ya | /hapus_user ID | /autohapus MENIT|off | /status_hapus
// USER  : tombol "🧹 Bersihkan Chat" atau /bersihkan
//           → 🧹 Bersihkan Semua  /  🔝 Hapus 5 Teratas
// - Pesan ke Admin & ke Channel TIDAK dicatat (tombol approve aman)
// ===============================================================

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'sent_messages.json');
const SETTINGS_PATH = path.join(__dirname, 'bot_settings.json');

// Telegram hanya mengizinkan hapus pesan yang umurnya < 48 jam
const MAX_AGE_MS = 47 * 60 * 60 * 1000;
const MAX_AUTO_MIN = 47 * 60;
const SWEEP_MS = 30 * 1000;

// true  = tombol user juga menghapus pesan yang DIKIRIM USER sendiri (foto, voice, teks)
// false = hanya menghapus pesan yang dikirim bot
const CLEAN_USER_MESSAGES = true;

// Jumlah pesan untuk opsi "Teratas"
const TOP_N = 5;

const CLEAN_BUTTON = { text: '🧹 Bersihkan Chat', callback_data: 'clean_menu' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readJson(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

module.exports = function setupCleanup({ botDonasi, botViewer, isSameBot, config }) {
    const adminIds = (config.adminIds || []).map(Number);

    // Jika kedua bot sama, cukup satu nama ('donasi')
    const bots = { donasi: botDonasi };
    if (!isSameBot) bots.viewer = botViewer;

    let sentLog = readJson(LOG_PATH, []);
    const settings = readJson(SETTINGS_PATH, { autoDeleteMin: {} });
    if (!settings.autoDeleteMin) settings.autoDeleteMin = {};

    let dirty = false;
    const saveSettings = () => fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), () => { });

    // Simpan log ke file tiap 5 detik jika ada perubahan
    setInterval(() => {
        if (!dirty) return;
        dirty = false;
        fs.writeFile(LOG_PATH, JSON.stringify(sentLog), () => { });
    }, 5000);

    // ---------- Pencatat ----------
    // incoming = true → pesan yang dikirim USER ke bot (ditandai u:1)
    function record(botName, msg, incoming = false) {
        if (!msg || !msg.chat || msg.chat.type !== 'private') return;      // hanya chat private user
        if (adminIds.includes(Number(msg.chat.id))) return;                // jangan hapus pesan ke/dari admin
        const entry = { b: botName, c: msg.chat.id, m: msg.message_id, t: Date.now() };
        if (incoming) entry.u = 1;
        sentLog.push(entry);
        dirty = true;
    }

    // Tambahkan tombol "🧹 Bersihkan Chat" ke setiap pesan bertombol yang dikirim ke user biasa
    function addCleanRow(chatId, opts) {
        if (!opts || !opts.reply_markup || !Array.isArray(opts.reply_markup.inline_keyboard)) return opts;
        if (Number(chatId) <= 0 || adminIds.includes(Number(chatId))) return opts; // hanya chat private user biasa
        const kb = opts.reply_markup.inline_keyboard;
        const skip = kb.flat().some((b) => /^(check_sub|clean_|adm_)/.test((b && b.callback_data) || ''));
        if (skip) return opts;
        return { ...opts, reply_markup: { ...opts.reply_markup, inline_keyboard: [...kb, [CLEAN_BUTTON]] } };
    }

    function track(bot, botName) {
        for (const method of ['sendMessage', 'sendPhoto', 'sendVideo', 'sendVoice', 'sendAudio', 'sendDocument']) {
            const orig = bot[method].bind(bot);
            bot[method] = async (...args) => {
                if (args[2]) args[2] = addCleanRow(args[0], args[2]);
                const res = await orig(...args);
                record(botName, res);
                return res;
            };
        }
        const origGroup = bot.sendMediaGroup.bind(bot);
        bot.sendMediaGroup = async (...args) => {
            const res = await origGroup(...args);
            (res || []).forEach((r) => record(botName, r));
            return res;
        };

        // Catat pesan masuk dari user (untuk fitur "bersihkan semua")
        if (CLEAN_USER_MESSAGES) {
            bot.on('message', (msg) => {
                if (!msg || !msg.from || msg.from.is_bot) return;
                record(botName, msg, true);
            });
        }
    }

    for (const [name, bot] of Object.entries(bots)) track(bot, name);

    // ---------- Penghapus ----------
    async function deleteEntries(entries) {
        let ok = 0, fail = 0;
        const reasons = {};
        const done = new Set(entries);
        for (const e of entries) {
            try {
                await bots[e.b].deleteMessage(e.c, e.m);
                ok++;
            } catch (err) {
                fail++; // sudah dihapus user / kadaluarsa / bot diblokir
                const why = (err.response && err.response.body && err.response.body.description) || err.message;
                reasons[why] = (reasons[why] || 0) + 1;
            }
            await sleep(40); // jeda kecil agar tidak kena rate limit
        }
        sentLog = sentLog.filter((e) => !done.has(e));
        dirty = true;
        if (fail) console.log('🧹 Alasan gagal hapus:', reasons);
        return { ok, fail, reasons };
    }

    // Ringkas alasan gagal untuk laporan ke admin
    function fmtReasons(reasons) {
        const rows = Object.entries(reasons || {});
        if (!rows.length) return '';
        return '\n\n🔎 <b>Alasan gagal:</b>\n' +
            rows.map(([why, n]) => `• ${n}x — ${String(why).replace(/[<>&]/g, '')}`).join('\n');
    }

    // ---------- Sweeper: buang log lama & hapus otomatis ----------
    let sweeping = false;
    setInterval(async () => {
        if (sweeping) return;
        sweeping = true;
        try {
            const now = Date.now();
            const before = sentLog.length;
            sentLog = sentLog.filter((e) => now - e.t < MAX_AGE_MS);
            if (sentLog.length !== before) dirty = true;

            for (const name of Object.keys(bots)) {
                const min = Number(settings.autoDeleteMin[name] || 0);
                if (!min) continue;
                // Auto-hapus hanya untuk pesan BOT (bukan pesan user)
                const due = sentLog.filter((e) => e.b === name && !e.u && now - e.t >= min * 60 * 1000);
                if (due.length) {
                    const r = await deleteEntries(due);
                    console.log(`🧹 [${name}] Auto-hapus: ${r.ok} terhapus, ${r.fail} gagal`);
                }
            }
        } catch (err) {
            console.error('❌ Sweeper error:', err.message);
        } finally {
            sweeping = false;
        }
    }, SWEEP_MS);

    // ---------- Perintah Admin ----------
    const isAdmin = (msg) =>
        msg.chat && msg.chat.type === 'private' && msg.from && adminIds.includes(Number(msg.from.id));

    function registerAdmin(bot, botName) {
        // /hapus_semua ya  (hanya pesan BOT)
        bot.onText(/^\/hapus_semua(?:\s+(ya))?$/i, async (msg, match) => {
            if (!isAdmin(msg)) return;
            const list = sentLog.filter((e) => e.b === botName && !e.u);
            if (!match[1]) {
                return bot.sendMessage(msg.chat.id,
                    `⚠️ Ini akan menghapus <b>${list.length}</b> pesan bot dari chat semua user (maks 48 jam terakhir).\n\n` +
                    `Ketik <code>/hapus_semua ya</code> untuk melanjutkan.`,
                    { parse_mode: 'HTML' });
            }
            await bot.sendMessage(msg.chat.id, `🧹 Menghapus ${list.length} pesan...`);
            const r = await deleteEntries(list);
            bot.sendMessage(msg.chat.id,
                `✅ Selesai!\n🗑️ Terhapus: <b>${r.ok}</b>\n⚠️ Gagal/sudah hilang: <b>${r.fail}</b>` + fmtReasons(r.reasons),
                { parse_mode: 'HTML' });
        });

        // /hapus_user 123456789
        bot.onText(/^\/hapus_user\s+(\d+)$/i, async (msg, match) => {
            if (!isAdmin(msg)) return;
            const uid = Number(match[1]);
            const list = sentLog.filter((e) => e.b === botName && !e.u && Number(e.c) === uid);
            if (!list.length) {
                return bot.sendMessage(msg.chat.id, `ℹ️ Tidak ada pesan tercatat untuk user <code>${uid}</code>.`, { parse_mode: 'HTML' });
            }
            const r = await deleteEntries(list);
            bot.sendMessage(msg.chat.id,
                `✅ User <code>${uid}</code>\n🗑️ Terhapus: <b>${r.ok}</b>\n⚠️ Gagal: <b>${r.fail}</b>` + fmtReasons(r.reasons),
                { parse_mode: 'HTML' });
        });

        // /autohapus 10   |   /autohapus off   |   /autohapus
        bot.onText(/^\/autohapus(?:\s+(\S+))?$/i, async (msg, match) => {
            if (!isAdmin(msg)) return;
            const arg = (match[1] || '').toLowerCase();
            const cur = Number(settings.autoDeleteMin[botName] || 0);

            if (!arg) {
                return bot.sendMessage(msg.chat.id,
                    `🧹 <b>Auto-hapus (${botName})</b>: ${cur ? `<b>${cur} menit</b>` : '<b>MATI</b>'}\n\n` +
                    `Atur: <code>/autohapus 10</code> (menit)\nMatikan: <code>/autohapus off</code>`,
                    { parse_mode: 'HTML' });
            }
            if (arg === 'off') {
                settings.autoDeleteMin[botName] = 0;
                saveSettings();
                return bot.sendMessage(msg.chat.id, '✅ Auto-hapus dimatikan.');
            }
            const min = parseInt(arg, 10);
            if (!min || min < 1 || min > MAX_AUTO_MIN) {
                return bot.sendMessage(msg.chat.id, `⚠️ Masukkan angka menit 1–${MAX_AUTO_MIN}, atau <code>off</code>.`, { parse_mode: 'HTML' });
            }
            settings.autoDeleteMin[botName] = min;
            saveSettings();
            bot.sendMessage(msg.chat.id,
                `✅ Auto-hapus aktif: pesan bot ke user dihapus <b>${min} menit</b> setelah terkirim.`,
                { parse_mode: 'HTML' });
        });

        // /status_hapus
        bot.onText(/^\/status_hapus$/i, async (msg) => {
            if (!isAdmin(msg)) return;
            const mine = sentLog.filter((e) => e.b === botName);
            const botMsgs = mine.filter((e) => !e.u).length;
            const userMsgs = mine.length - botMsgs;
            const users = new Set(mine.map((e) => e.c)).size;
            const cur = Number(settings.autoDeleteMin[botName] || 0);
            bot.sendMessage(msg.chat.id,
                `📊 <b>Status Cleanup (${botName})</b>\n\n` +
                `📨 Pesan bot tercatat: <b>${botMsgs}</b>\n` +
                `💬 Pesan user tercatat: <b>${userMsgs}</b>\n` +
                `👥 User: <b>${users}</b>\n` +
                `🧹 Auto-hapus: ${cur ? `<b>${cur} menit</b>` : '<b>MATI</b>'}`,
                { parse_mode: 'HTML' });
        });
    }

    // ---------- Tombol & Perintah USER: Bersihkan Chat ----------
    const MENU_TEXT =
        `🧹 <b>BERSIHKAN CHAT</b>\n\n` +
        `Pilih yang ingin dihapus dari riwayat chat Anda dengan bot ini:\n\n` +
        `🧹 <b>Bersihkan Semua</b> — hapus seluruh pesan\n` +
        `🔝 <b>${TOP_N} Teratas</b> — hapus ${TOP_N} pesan paling lama (paling atas)\n\n` +
        `ℹ️ <i>Hanya pesan dalam 48 jam terakhir yang bisa dihapus.</i>`;

    const MENU_MARKUP = {
        inline_keyboard: [
            [{ text: '🧹 Bersihkan Semua', callback_data: 'clean_all' }],
            [{ text: `🔝 Hapus ${TOP_N} Teratas`, callback_data: 'clean_top' }],
            [{ text: '✖️ Tutup', callback_data: 'clean_cancel' }]
        ]
    };

    const cleaning = new Set(); // cegah klik ganda

    function registerUserClean(bot, botName) {
        // Perintah /bersihkan
        bot.onText(/^\/bersihkan$/i, (msg) => {
            if (!msg.chat || msg.chat.type !== 'private') return;
            bot.sendMessage(msg.chat.id, MENU_TEXT, {
                parse_mode: 'HTML',
                protect_content: true,
                reply_markup: MENU_MARKUP
            });
        });

        // Tombol
        bot.on('callback_query', async (q) => {
            const data = q.data || '';
            if (!data.startsWith('clean_')) return;
            if (!q.message || !q.message.chat || q.message.chat.type !== 'private') {
                return bot.answerCallbackQuery(q.id).catch(() => { });
            }

            const chatId = q.message.chat.id;
            const menuId = q.message.message_id;
            const lockKey = `${botName}:${chatId}`;

            // Buka menu
            if (data === 'clean_menu') {
                await bot.answerCallbackQuery(q.id).catch(() => { });
                return bot.sendMessage(chatId, MENU_TEXT, {
                    parse_mode: 'HTML',
                    protect_content: true,
                    reply_markup: MENU_MARKUP
                });
            }

            // Tutup menu
            if (data === 'clean_cancel') {
                await bot.answerCallbackQuery(q.id).catch(() => { });
                const ent = sentLog.find((e) => e.b === botName && Number(e.c) === Number(chatId) && e.m === menuId);
                if (ent) return deleteEntries([ent]);
                return bot.deleteMessage(chatId, menuId).catch(() => { });
            }

            if (cleaning.has(lockKey)) {
                return bot.answerCallbackQuery(q.id, { text: '⏳ Sedang diproses, tunggu sebentar...' }).catch(() => { });
            }

            // Bersihkan semua
            if (data === 'clean_all') {
                const mine = sentLog.filter((e) => e.b === botName && Number(e.c) === Number(chatId));
                if (!mine.length) {
                    return bot.answerCallbackQuery(q.id, {
                        text: 'ℹ️ Tidak ada pesan yang bisa dihapus.',
                        show_alert: true
                    }).catch(() => { });
                }
                cleaning.add(lockKey);
                try {
                    await bot.answerCallbackQuery(q.id, { text: '🧹 Membersihkan chat...' }).catch(() => { });
                    const r = await deleteEntries(mine);
                    await bot.sendMessage(chatId,
                        `✅ <b>${r.ok}</b> pesan berhasil dibersihkan dari chat ini.`,
                        { parse_mode: 'HTML', protect_content: true });
                } finally {
                    cleaning.delete(lockKey);
                }
                return;
            }

            // Hapus N pesan teratas (paling lama)
            if (data === 'clean_top') {
                const mine = sentLog
                    .filter((e) => e.b === botName && Number(e.c) === Number(chatId) && e.m !== menuId)
                    .sort((a, b) => (a.t - b.t) || (a.m - b.m))
                    .slice(0, TOP_N);
                if (!mine.length) {
                    return bot.answerCallbackQuery(q.id, {
                        text: 'ℹ️ Tidak ada pesan lain yang bisa dihapus.',
                        show_alert: true
                    }).catch(() => { });
                }
                cleaning.add(lockKey);
                try {
                    await bot.answerCallbackQuery(q.id, { text: `🔝 Menghapus ${mine.length} pesan teratas...` }).catch(() => { });
                    const r = await deleteEntries(mine);
                    await bot.editMessageText(
                        MENU_TEXT + `\n\n✅ <b>${r.ok}</b> pesan teratas dihapus.`,
                        {
                            chat_id: chatId,
                            message_id: menuId,
                            parse_mode: 'HTML',
                            reply_markup: MENU_MARKUP
                        }
                    ).catch(() => { });
                } finally {
                    cleaning.delete(lockKey);
                }
                return;
            }
        });
    }

    for (const [name, bot] of Object.entries(bots)) {
        registerAdmin(bot, name);
        registerUserClean(bot, name);
    }

    console.log(`🧹 Cleanup aktif (${Object.keys(bots).join(', ')}) — ${sentLog.length} pesan tercatat.`);
};
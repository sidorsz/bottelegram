// ===============================================================
// 🤖 BOT AI GEMINI v2 — nimbrung di grup & kolom komentar channel
// ---------------------------------------------------------------
// - Membaca pesan TEKS grup (hanya di memori, tidak disimpan ke disk)
// - Membalas sebagian pesan secara acak + SELALU membalas jika dipanggil
//   (balas ke pesan bot / sebut @username bot)
// - Komentar di bawah postingan channel punya peluang balasan lebih tinggi
// - Gaya balasan diacak (8 persona) + tidak mengulang balasan lama
// - Foto/video TIDAK dikirim ke AI (sengaja, demi privasi & keamanan)
// - Admin (di grup): /ai status | on | off | test | chance 0.3 | comment 0.6 | debug on|off
// Butuh Node.js 18+ (fetch bawaan).
// API key: config.geminiApiKey ATAU environment variable GEMINI_API_KEY
// ===============================================================

const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, 'ai_settings.json');

// ⚙️ PENGATURAN
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DEFAULTS = {
    enabled: true,
    chance: 0.6,          // peluang membalas pesan biasa di grup (60%)
    commentChance: 0.85,  // peluang membalas KOMENTAR di bawah postingan channel (85%)
    debug: true           // true = log alasan setiap pesan dilewati ke console
};
const MIN_LEN = 2;                   // pesan biasa minimal 2 karakter (agar "hai", "msn", "kok bsa" tetap dibalas)
const MIN_LEN_COMMENT = 2;           // untuk komentar channel
const GROUP_COOLDOWN_MS = 6 * 1000;  // jeda minimal 6 detik antar balasan acak di grup
const USER_COOLDOWN_MS = 12 * 1000;  // jeda minimal 12 detik balasan acak ke user yang sama
const MAX_PER_HOUR = 120;            // batas total balasan AI per jam
const HISTORY_SIZE = 14;
const MAX_REPLY_CHARS = 280;
const DELAY_MS = [1200, 3000];       // jeda "mengetik" acak (1.2s - 3s agar responsif)

const PERSONAS = [
    'santai dan gaul, seperti teman nongkrong di grup',
    'jenaka dan suka bercanda ringan',
    'kalem dan asik, memberi tanggapan santai',
    'kepo, suka bertanya balik kepada yang bicara',
    'supportif dan menyemangati',
    'lucu dan ceplas-ceplos yang bersahabat',
    'to the point, ringkas, dan ekspresif'
];

const SYSTEM_PROMPT = `Kamu adalah "Kak Bot", bot AI yang menjadi anggota grup Telegram komunitas "Pap Rate Cowok". Tugasmu ikut nimbrung obrolan dengan komentar singkat yang santai, asik, dan relevan.

ATURAN:
- Bahasa Indonesia santai gaul (seperti teman nongkrong di grup), 1-2 kalimat pendek, maksimal 180 karakter. Emoji 1-2.
- Jangan kaku dan jangan seperti customer service atau AI formal.
- Komentari pesan terakhir sesuai konteks obrolan. Jangan mengulang kalimat atau pola yang sama dengan balasanmu sebelumnya.
- JANGAN membagikan link, promosi, atau meminta data pribadi.
- Jangan berpura-pura menjadi manusia jika ditanya langsung, tapi mengobrollah dengan gaya teman yang akrab.
- Jika pesan berisi hal terlarang ekstrem (konten di bawah umur, SARA berat, kekerasan berbahaya, ancaman bunuh diri) → balas persis satu kata: SKIP`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const nameOf = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Anggota';
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

module.exports = async function setupAI({ botViewer, config, mod }) {
    const API_KEY = process.env.GEMINI_API_KEY || config.geminiApiKey || '';
    if (!API_KEY) {
        console.warn('⚠️ Bot AI nonaktif: isi config.geminiApiKey atau environment variable GEMINI_API_KEY.');
        return;
    }
    if (typeof fetch !== 'function') {
        console.warn('⚠️ Bot AI nonaktif: butuh Node.js 18+ (fetch tidak tersedia). Cek dengan: node -v');
        return;
    }

    const groupId = String(config.groupId);
    const settings = Object.assign({}, DEFAULTS, readJson(SETTINGS_PATH, {}));
    const saveSettings = () => fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), () => { });
    const dbg = (...a) => { if (settings.debug) console.log('🤖[debug]', ...a); };

    let me = { id: 0, username: '' };
    try { me = await botViewer.getMe(); } catch (e) { console.error('⚠️ getMe gagal:', e.message); }

    // ---------- State & statistik ----------
    const history = [];
    const myReplies = [];
    const lastUserReply = new Map();
    const hourly = [];
    const stats = { seen: 0, texts: 0, asked: 0, replied: 0, errors: 0, skipChance: 0, skipOther: 0 };
    let lastGroupReply = 0;
    let lastPersona = -1;
    let busy = false;
    let pausedUntil = 0;
    let lastError = '';

    // ---------- Panggil Gemini ----------
    async function askGemini(userPrompt) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
        const generationConfig = { temperature: 1.0, topP: 0.95, maxOutputTokens: 1024 };
        if (MODEL.includes('2.5')) generationConfig.thinkingConfig = { thinkingBudget: 0 };

        stats.asked++;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                    generationConfig
                }),
                signal: ctrl.signal
            });
            if (res.status === 429) {
                pausedUntil = Date.now() + 60 * 1000;
                lastError = 'HTTP 429 (rate limit / kuota habis) — AI dijeda 60 detik';
                stats.errors++;
                console.warn('⚠️ Gemini ' + lastError);
                return null;
            }
            if (!res.ok) {
                const body = (await res.text()).slice(0, 300);
                lastError = `HTTP ${res.status}: ${body}`;
                stats.errors++;
                console.error('❌ Gemini ' + lastError);
                return null;
            }
            const data = await res.json();
            const cand = data && data.candidates && data.candidates[0];
            const parts = cand && cand.content && cand.content.parts;
            const text = (parts || []).map((p) => p.text || '').join('').trim();
            if (!text) {
                lastError = `Respons kosong (finishReason: ${(cand && cand.finishReason) || 'tidak ada kandidat — kemungkinan diblokir filter keamanan'})`;
                stats.errors++;
                console.warn('⚠️ Gemini ' + lastError);
                return null;
            }
            lastError = '';
            return text;
        } catch (err) {
            lastError = err.name === 'AbortError' ? 'timeout 15 detik' : err.message;
            stats.errors++;
            console.error('❌ Gemini error:', lastError);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    // Tes koneksi otomatis saat start → langsung ketahuan kalau key/model salah
    setTimeout(async () => {
        const out = await askGemini('Balas satu kalimat sapaan singkat dalam bahasa Indonesia.');
        if (out) console.log(`✅ Gemini terhubung (model ${MODEL}): "${clip(out, 80)}"`);
        else console.error(`❌ Gemini TIDAK terhubung → ${lastError}`);
        stats.asked = 0; stats.errors = 0;
    }, 3000);

    // ---------- Susun prompt ----------
    function buildPrompt(name, text, direct, comment) {
        let idx;
        do { idx = Math.floor(Math.random() * PERSONAS.length); } while (idx === lastPersona && PERSONAS.length > 1);
        lastPersona = idx;

        const ctx = history.slice(-HISTORY_SIZE).map((h) => `${h.name}: ${h.text}`).join('\n');
        const prev = myReplies.length ? myReplies.map((r) => `- ${r}`).join('\n') : '(belum ada)';

        return (
            `Gaya balasan kali ini: ${PERSONAS[idx]}.\n\n` +
            `Balasanmu sebelumnya (JANGAN diulang atau dimirip-miripkan):\n${prev}\n\n` +
            `Riwayat obrolan grup terakhir:\n${ctx}\n\n` +
            (direct ? `Pengguna ini sedang berbicara LANGSUNG denganmu — jawab dengan ramah dan relevan.\n` : '') +
            (comment ? `Ini adalah KOMENTAR di bawah postingan channel.\n` : '') +
            `Pesan yang harus kamu komentari (dari ${name}):\n"""\n${text}\n"""`
        );
    }

    // Buang hasil yang berisiko (link / @username) atau format aneh
    function sanitize(raw) {
        let t = raw.replace(/[*_`#>]/g, '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
        t = clip(t, MAX_REPLY_CHARS);
        if (!t || /^SKIP\b/i.test(t)) return null;
        if (/(https?:\/\/|www\.|t\.me|telegram\.me|@\w{4,})/i.test(t)) return null;
        return t;
    }

    function isDirect(msg) {
        const text = (msg.text || '').toLowerCase();
        const rep = msg.reply_to_message;
        // Reply ke bot ini atau bot lain dalam sistem
        if (rep && rep.from && (Number(rep.from.id) === Number(me.id) || rep.from.is_bot)) return true;
        // Sebut @username bot
        const uname = (me.username || '').toLowerCase();
        if (uname && text.includes(`@${uname}`)) return true;
        if (text.includes('@indopapratecowok_bot') || text.includes('@donasipapcowok_bot')) return true;
        // Panggil "bot", "kak bot", "gemini" di dalam chat
        if (/\b(bot|kak bot|gemini)\b/i.test(text)) return true;
        return false;
    }

    // Komentar tingkat-atas di bawah postingan channel
    const isChannelComment = (msg) =>
        !!(msg.reply_to_message && msg.reply_to_message.is_automatic_forward);

    // ---------- Handler pesan grup ----------
    async function onMessage(msg) {
        if (!msg || !msg.chat || String(msg.chat.id) !== groupId) return;
        stats.seen++;
        if (!msg.text) return;

        // Cek anonymous admin / sender grup vs bot lain
        const isAnonAdmin = msg.from && msg.from.id === 1087968824;
        const isGroupSender = msg.sender_chat && String(msg.sender_chat.id) === groupId;
        const isOtherBot = msg.from && msg.from.is_bot && !isAnonAdmin;
        if (isOtherBot) return; // Abaikan pesan dari bot lain

        stats.texts++;

        // Jangan balas forward otomatis channel itu sendiri
        if (msg.is_automatic_forward) {
            dbg('lewati: forward otomatis channel'); return;
        }

        const text = msg.text.trim();
        if (!text || text.startsWith('/')) return;
        if (mod && mod.isViolation && mod.isViolation(msg)) { dbg('lewati: pelanggaran (dihapus moderasi)'); return; }

        let name = 'Anggota';
        let userId = msg.from ? msg.from.id : (msg.sender_chat ? msg.sender_chat.id : 0);
        if (isAnonAdmin || isGroupSender) {
            name = (msg.sender_chat && msg.sender_chat.title) || 'Admin';
        } else if (msg.from) {
            name = nameOf(msg.from);
        }

        history.push({ name, text: clip(text, 200) });
        if (history.length > HISTORY_SIZE * 2) history.splice(0, history.length - HISTORY_SIZE);

        if (!settings.enabled) { dbg('lewati: AI dimatikan'); return; }
        const now = Date.now();
        if (now < pausedUntil) { dbg('lewati: AI sedang dijeda (rate limit)'); stats.skipOther++; return; }
        if (busy) { dbg('lewati: sedang memproses pesan lain'); stats.skipOther++; return; }

        while (hourly.length && now - hourly[0] > 3600 * 1000) hourly.shift();
        if (hourly.length >= MAX_PER_HOUR) { dbg('lewati: batas per jam tercapai'); stats.skipOther++; return; }

        const direct = isDirect(msg);
        const comment = isChannelComment(msg);

        if (!direct) {
            if (text.length < (comment ? MIN_LEN_COMMENT : MIN_LEN)) { dbg(`lewati: pesan terlalu pendek (< ${MIN_LEN} char)`); stats.skipOther++; return; }
            if (now - lastGroupReply < GROUP_COOLDOWN_MS) { dbg(`lewati: cooldown grup (${Math.ceil((GROUP_COOLDOWN_MS - (now - lastGroupReply)) / 1000)}s)`); stats.skipOther++; return; }
            if (userId && now - (lastUserReply.get(userId) || 0) < USER_COOLDOWN_MS) { dbg('lewati: cooldown user'); stats.skipOther++; return; }
            const p = comment ? Number(settings.commentChance) : Number(settings.chance);
            if (Math.random() > p) { dbg(`lewati: kalah undian (${Math.round(p * 100)}%)`); stats.skipChance++; return; }
        }

        busy = true;
        try {
            dbg(`memproses pesan ${name}: "${clip(text, 60)}" (direct=${direct}, comment=${comment})`);
            botViewer.sendChatAction(groupId, 'typing').catch(() => { });
            await sleep(rand(DELAY_MS[0], DELAY_MS[1]));

            const raw = await askGemini(buildPrompt(name, clip(text, 400), direct, comment));
            if (!raw) return;
            const reply = sanitize(raw);
            if (!reply) { dbg(`dibuang (SKIP/berisiko): "${clip(raw, 60)}"`); stats.skipOther++; return; }

            await botViewer.sendMessage(groupId, reply, {
                reply_to_message_id: msg.message_id,
                allow_sending_without_reply: true
            });

            const t = Date.now();
            lastGroupReply = t;
            if (userId) lastUserReply.set(userId, t);
            hourly.push(t);
            stats.replied++;
            myReplies.push(reply);
            if (myReplies.length > 5) myReplies.shift();
            console.log(`🤖 AI → ${name} ("${clip(text, 25)}"): ${reply}`);
        } catch (err) {
            lastError = 'Kirim balasan gagal: ' + err.message;
            stats.errors++;
            console.error('❌ AI gagal membalas:', err.message);
        } finally {
            busy = false;
        }
    }
    botViewer.on('message', onMessage);

    // ---------- Admin: /ai ... ----------
    botViewer.onText(/^\/ai(?:@\w+)?(?:\s+(\w+))?(?:\s+([\w.,]+))?$/i, async (msg, match) => {
        if (!msg.chat || String(msg.chat.id) !== groupId) return;
        if (!msg.from || !(await mod.isAdmin(msg.from.id))) return;
        botViewer.deleteMessage(groupId, msg.message_id).catch(() => { });

        const cmd = (match[1] || 'status').toLowerCase();
        const arg = String(match[2] || '').toLowerCase();
        const pct = (v) => `${Math.round(v * 100)}%`;
        let out;

        if (cmd === 'on') { settings.enabled = true; saveSettings(); out = '✅ Bot AI diaktifkan.'; }
        else if (cmd === 'off') { settings.enabled = false; saveSettings(); out = '⏸️ Bot AI dimatikan.'; }
        else if (cmd === 'chance' || cmd === 'comment') {
            const v = parseFloat(arg.replace(',', '.'));
            if (!(v >= 0 && v <= 1)) out = `ℹ️ Contoh: <code>/ai ${cmd} 0.5</code> (0 sampai 1)`;
            else {
                if (cmd === 'chance') settings.chance = v; else settings.commentChance = v;
                saveSettings();
                out = `✅ Peluang ${cmd === 'chance' ? 'balasan grup' : 'balasan komentar channel'}: <b>${pct(v)}</b>`;
            }
        }
        else if (cmd === 'debug') {
            settings.debug = arg === 'on'; saveSettings();
            out = `🛠️ Debug ${settings.debug ? 'AKTIF (lihat console)' : 'mati'}.`;
        }
        else if (cmd === 'test') {
            const r = await askGemini('Balas satu kalimat sapaan singkat dalam bahasa Indonesia.');
            out = r ? `✅ <b>Gemini terhubung</b>\n<i>${esc(clip(r, 150))}</i>`
                : `❌ <b>Gemini GAGAL</b>\n<code>${esc(lastError)}</code>`;
        }
        else {
            out =
                `🤖 <b>Bot AI</b>: ${settings.enabled ? 'AKTIF' : 'MATI'}\n` +
                `🧠 Model: <code>${esc(MODEL)}</code>\n` +
                `🎲 Peluang grup: <b>${pct(settings.chance)}</b> · komentar channel: <b>${pct(settings.commentChance)}</b>\n\n` +
                `📥 Pesan grup terbaca: <b>${stats.seen}</b> (teks: ${stats.texts})\n` +
                `📡 Dikirim ke Gemini: <b>${stats.asked}</b> · dibalas: <b>${stats.replied}</b>\n` +
                `🎲 Kalah undian: ${stats.skipChance} · dilewati lain: ${stats.skipOther} · error: ${stats.errors}\n` +
                `🕐 Balasan 1 jam terakhir: ${hourly.length}/${MAX_PER_HOUR}\n` +
                (lastError ? `\n⚠️ Error terakhir:\n<code>${esc(clip(lastError, 200))}</code>\n` : '') +
                `\n<code>/ai test</code> · <code>/ai on|off</code> · <code>/ai chance 0.3</code> · <code>/ai comment 0.6</code> · <code>/ai debug on</code>`;
        }

        try {
            const s = await botViewer.sendMessage(groupId, out, { parse_mode: 'HTML' });
            setTimeout(() => botViewer.deleteMessage(groupId, s.message_id).catch(() => { }), 30000);
        } catch { }
    });

    console.log(`🤖 Bot AI Gemini aktif (model ${MODEL}, grup ${Math.round(settings.chance * 100)}%, komentar ${Math.round(settings.commentChance * 100)}%).`);
};
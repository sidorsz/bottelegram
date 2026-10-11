// ===============================================================
// ⚖️ BANDING & PEMULIHAN AKUN v2.1
// ---------------------------------------------------------------
// Memulihkan akun user dari:
// 1. Sanksi chat/komentar di grup (Mute / Peringatan karena link/promosi)
// 2. Akses grup diblokir (karena keluar-masuk > 3x)
//
// Opsi Pemulihan untuk User:
//   🧾 Bayar QRIS (Rp 5.000) + kirim foto bukti transfer
//   ⭐ Bayar Telegram Stars (50 ⭐) otomatis terverifikasi
//   ⏱️ Keringanan Waktu (tulis alasan ke admin)
//
// Opsi Keputusan untuk Admin:
//   ✅ SETUJUI PENUH       → Cabut semua sanksi & buka akses grup
//   ⏱️ KURANGI WAKTU CHAT → Potong sisa durasi mute 50% / kurangi poin sanksi
//   ❌ TOLAK              → Pengajuan ditolak (Stars di-refund)
// ===============================================================

const fs = require('fs');
const path = require('path');

// ⚙️ PENGATURAN
const STARS_PRICE = 50;                               // harga dalam Telegram Stars ⭐
const QRIS_NOMINAL = 'Rp 5.000';                      // nominal pembayaran QRIS
const QRIS_IMAGE = path.join(__dirname, 'qris.jpg');  // file gambar QRIS
const MIN_REASON = 20;                                // minimal panjang karakter alasan
const MAX_JOINS = 3;                                  // batas maksimal keluar-masuk grup
const DATA_PATH = path.join(__dirname, 'appeals.json');

const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const nameOf = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Pengguna';
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };

module.exports = function setupAppeal({ botDonasi, botViewer, isSameBot, config, mod }) {
    const adminIds = (config.adminIds || []).map(Number);
    const isAdminId = (id) => adminIds.includes(Number(id));
    const groupUrl = `https://t.me/${(config.groupUsername || '').replace(/^@/, '')}`;

    const store = readJson(DATA_PATH, { appeals: {}, access: {} });
    if (!store.appeals) store.appeals = {};
    if (!store.access) store.access = {};
    const save = () => fs.writeFile(DATA_PATH, JSON.stringify(store, null, 2), () => { });

    // State percakapan user (in-memory)
    const states = {}; // uid → { step, method, reason, context }
    const recentProofs = new Set();
    const isBusy = (chatId) => !!states[chatId] || recentProofs.has(Number(chatId));
    const isWaitingProof = (chatId) => !!(states[chatId] && states[chatId].step === 'proof');

    const isPrivate = (msg) => msg && msg.chat && msg.chat.type === 'private';
    const hasPending = (uid) => Object.values(store.appeals).some((a) => a.userId === uid);

    const penaltyText = (p) => {
        if (!p) return '<i>Tidak ada sanksi aktif</i>';
        const mins = p.muteUntil ? Math.ceil((p.muteUntil - Date.now()) / 60000) : 0;
        return `⚠️ Peringatan: <b>${p.count}/3</b>` + (mins > 0 ? `\n🔇 Batasan Chat (Mute): <b>±${mins} menit lagi</b>` : '');
    };

    const methodLabel = (a) =>
        a.method === 'stars' ? `⭐ Telegram Stars (${STARS_PRICE} ⭐)`
            : a.method === 'qris' ? `🧾 QRIS (${QRIS_NOMINAL}) + Foto Bukti`
                : '⏱️ Keringanan Waktu (Pengajuan Alasan)';

    // =============================================================
    // FUNGSI: Kirim Menu Pemulihan Sanksi Komentar / Link ke User
    // =============================================================
    async function sendBandingMenu(uid, reason = '') {
        const p = mod.getPenalty(uid);
        if (!p) return;
        if (hasPending(uid)) {
            return botDonasi.sendMessage(uid,
                '⏳ <b>Pengajuan Anda Sedang Diproses</b>\n\nPengajuan pemulihan Anda masih menunggu peninjauan admin. Mohon bersabar.',
                { parse_mode: 'HTML' }).catch(() => { });
        }

        delete states[uid];
        const penLine = penaltyText(p);
        const reasonLine = reason ? `\n📛 <b>Pelanggaran:</b> ${esc(reason)}\n` : '';

        try {
            await botDonasi.sendMessage(uid,
                `⚖️ <b>SANKSI GRUP AKTIF — OPSI PEMULIHAN</b>\n\n${penLine}${reasonLine}\n\n` +
                `Akun Anda dibatasi berkomentar / menerima sanksi di grup. ` +
                `Pilih opsi di bawah untuk memulihkan akun atau mengurangi batasan waktu chat:\n\n` +
                `🧾 <b>Bayar QRIS (${QRIS_NOMINAL})</b>\n` +
                `└ Scan QRIS & kirim bukti transfer (Cabut sanksi penuh setelah verifikasi)\n\n` +
                `⭐ <b>Bayar Stars (${STARS_PRICE} ⭐)</b>\n` +
                `└ Pembayaran instan via Telegram Stars (Cabut sanksi penuh)\n\n` +
                `⏱️ <b>Keringanan Waktu Chat (Gratis)</b>\n` +
                `└ Ajukan pengurangan batasan waktu chat 50% ke admin\n\n` +
                `ℹ️ <i>Admin dapat menyetujui pemulihan penuh atau mengurangi batasan waktu chat Anda.</i>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🧾 Bayar QRIS ${QRIS_NOMINAL}`, callback_data: 'ap_qris' }],
                            [{ text: `⭐ Bayar ${STARS_PRICE} Stars`, callback_data: 'ap_star' }],
                            [{ text: '⏱️ Keringanan Waktu Chat (Gratis)', callback_data: 'ap_time' }],
                            [{ text: '✖️ Tutup', callback_data: 'ap_x' }]
                        ]
                    }
                });
        } catch { }
    }

    // =============================================================
    // FUNGSI: Kirim Menu Pemulihan Akses Masuk Grup (Keluar-Masuk > 3x)
    // =============================================================
    async function sendAccessMenu(uid, name = '') {
        if (hasPending(uid)) {
            return botDonasi.sendMessage(uid,
                '⏳ <b>Pengajuan Anda Sedang Diproses</b>\n\nPermintaan akses Anda masih menunggu persetujuan admin. Mohon bersabar.',
                { parse_mode: 'HTML' }).catch(() => { });
        }

        delete states[uid];
        try {
            await botDonasi.sendMessage(uid,
                `🚫 <b>AKSES GRUP ANDA DIBLOKIR</b>\n\n` +
                `Akun Anda diblokir dari grup karena melebihi batas keluar-masuk (maksimal <b>${MAX_JOINS}x</b>).\n\n` +
                `Pilih opsi di bawah untuk memulihkan akses masuk ke grup:\n\n` +
                `🧾 <b>Bayar QRIS (${QRIS_NOMINAL})</b>\n` +
                `└ Scan QRIS & kirim bukti transfer → Akses langsung dibuka setelah admin verifikasi\n\n` +
                `⭐ <b>Bayar Stars (${STARS_PRICE} ⭐)</b>\n` +
                `└ Pembayaran instan via Telegram Stars\n\n` +
                `⏱️ <b>Tulis Alasan ke Admin (Gratis)</b>\n` +
                `└ Jelaskan alasan Anda untuk meminta izin masuk kembali\n\n` +
                `ℹ️ <i>Setelah disetujui admin, status blokir dicabut dan hitungan keluar-masuk direset.</i>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🧾 Bayar QRIS ${QRIS_NOMINAL}`, callback_data: 'ak_qris' }],
                            [{ text: `⭐ Bayar ${STARS_PRICE} Stars`, callback_data: 'ak_star' }],
                            [{ text: '⏱️ Tulis Alasan ke Admin', callback_data: 'ak_reason' }],
                            [{ text: '✖️ Tutup', callback_data: 'ap_x' }]
                        ]
                    }
                });
        } catch { }
    }

    // =============================================================
    // COMMAND MANUAL USER
    // =============================================================
    botDonasi.onText(/^\/banding(?:@\w+)?$/i, async (msg) => {
        if (!isPrivate(msg)) return;
        const uid = msg.from.id;
        const p = mod.getPenalty(uid);

        if (!p) {
            return botDonasi.sendMessage(msg.chat.id,
                '✅ Anda tidak memiliki sanksi aktif di grup. Tidak ada yang perlu diajukan banding.');
        }
        await sendBandingMenu(uid);
    });

    botDonasi.onText(/^\/minta_akses(?:@\w+)?$/i, async (msg) => {
        if (!isPrivate(msg)) return;
        const uid = msg.from.id;
        const rec = mod.getJoinRecord(uid);

        if (!rec || !rec.blocked) {
            return botDonasi.sendMessage(msg.chat.id, '✅ Anda tidak sedang diblokir dari grup karena keluar-masuk.');
        }
        await sendAccessMenu(uid, rec.name);
    });

    botDonasi.onText(/^\/cancel/i, (msg) => {
        if (!isPrivate(msg)) return;
        if (states[msg.from.id]) {
            delete states[msg.from.id];
            botDonasi.sendMessage(msg.chat.id, '🔄 Pengajuan telah dibatalkan.');
        }
    });

    // =============================================================
    // KIRIM PENGAJUAN KE SEMUA ADMIN
    // =============================================================
    async function submitToAdmins(a) {
        store.appeals[a.id] = a;
        save();

        const p = mod.getPenalty(a.userId);
        const joinRec = mod.getJoinRecord(a.userId);
        const isBlockedJoin = joinRec && joinRec.blocked;

        let statusText = '';
        if (isBlockedJoin) statusText += '🚫 <b>DIBLOKIR KELUAR-MASUK GRUP (> 3x)</b>\n';
        if (p) {
            const mins = p.muteUntil ? Math.ceil((p.muteUntil - Date.now()) / 60000) : 0;
            statusText += `⚠️ Peringatan: ${p.count}/3` + (mins > 0 ? `, Mute: ±${mins} menit` : '') + '\n';
        }
        if (!statusText) statusText = 'Sanksi telah kedaluwarsa / tidak aktif\n';

        const text =
            `📨 <b>PENGAJUAN PEMULIHAN AKUN</b>\n\n` +
            `👤 <b>Nama</b> — ${esc(a.name)}\n` +
            `🆔 <b>ID</b> — <code>${a.userId}</code>\n` +
            `🔗 <b>Username</b> — ${a.username ? '@' + esc(a.username) : '-'}\n\n` +
            `📋 <b>Status Pelanggaran:</b>\n${statusText}\n` +
            `💳 <b>Metode:</b> ${methodLabel(a)}\n` +
            (a.reason ? `📝 <b>Alasan:</b> <i>${esc(a.reason)}</i>\n` : '') +
            `\n<i>Pilih tindakan admin di bawah:</i>`;

        // Tombol Keputusan Admin
        const kb = {
            inline_keyboard: [
                [
                    { text: '✅ SETUJUI PENUH', callback_data: `ap_ok:${a.id}` },
                    { text: '⏱️ KURANGI WAKTU CHAT', callback_data: `ap_reduce:${a.id}` }
                ],
                [
                    { text: '❌ TOLAK', callback_data: `ap_no:${a.id}` }
                ]
            ]
        };

        for (const adminId of adminIds) {
            try {
                if (a.proof) {
                    await botDonasi.sendPhoto(adminId, a.proof, { caption: text, parse_mode: 'HTML', reply_markup: kb });
                } else {
                    await botDonasi.sendMessage(adminId, text, { parse_mode: 'HTML', reply_markup: kb });
                }
            } catch (err) {
                console.error(`❌ Gagal kirim pengajuan ke admin ${adminId}:`, err.message);
            }
        }
        console.log(`📨 Pengajuan pemulihan ${a.id} (${a.method}) dari ${a.name} (${a.userId})`);
    }

    function newAppeal(user, method, extra = {}) {
        return {
            id: Date.now().toString(36),
            userId: user.id,
            name: nameOf(user),
            username: user.username || '',
            method,
            createdAt: Date.now(),
            ...extra
        };
    }

    // =============================================================
    // PEMBAYARAN TELEGRAM STARS
    // =============================================================
    botDonasi.on('pre_checkout_query', async (q) => {
        try {
            const payload = q.invoice_payload || '';
            const ok = payload.startsWith('appeal:') || payload.startsWith('access:');
            await botDonasi.answerPreCheckoutQuery(q.id, ok,
                ok ? {} : { error_message: 'Pengajuan tidak valid. Pembayaran dibatalkan.' });
        } catch (err) { console.error('❌ pre_checkout error:', err.message); }
    });

    botDonasi.on('successful_payment', async (msg) => {
        if (!isPrivate(msg) || !msg.successful_payment) return;
        const pay = msg.successful_payment;
        const payload = pay.invoice_payload || '';
        if (!payload.startsWith('appeal:') && !payload.startsWith('access:')) return;

        const isAccess = payload.startsWith('access:');
        const a = newAppeal(msg.from, 'stars', {
            chargeId: pay.telegram_payment_charge_id,
            context: isAccess ? 'access' : 'appeal'
        });

        await botDonasi.sendMessage(msg.chat.id,
            `✅ <b>Pembayaran ${pay.total_amount} ⭐ Berhasil Diterima!</b>\n\n` +
            `⏳ Pengajuan pemulihan Anda telah diteruskan ke Admin untuk diverifikasi. Akun Anda akan segera dipulihkan.`,
            { parse_mode: 'HTML' });
        await submitToAdmins(a);
    });

    // =============================================================
    // CALLBACK QUERY (USER & ADMIN)
    // =============================================================
    const onCallback = async (q) => {
        const d = q.data || '';
        if (!/^(ap_|ak_)/.test(d)) return;
        const ack = (opts) => botDonasi.answerCallbackQuery(q.id, opts).catch(() => { });
        const chatId = q.message && q.message.chat.id;
        const uid = q.from.id;

        // ---------- User: Tutup Menu ----------
        if (d === 'ap_x') {
            await ack();
            return botDonasi.deleteMessage(chatId, q.message.message_id).catch(() => { });
        }

        // ---------- User: Pilih Opsi QRIS ----------
        if (d === 'ap_qris' || d === 'ak_qris') {
            await ack();
            const isAccess = d === 'ak_qris';
            states[uid] = { step: 'proof', method: 'qris', context: isAccess ? 'access' : 'appeal' };

            const caption =
                `🧾 <b>PEMBAYARAN QRIS — ${QRIS_NOMINAL}</b>\n\n` +
                `1. Scan kode QRIS di atas dengan m-Banking atau E-Wallet (BCA, BRI, Mandiri, BNI, Dana, GoPay, OVO, ShopeePay, dll)\n` +
                `2. Selesaikan transfer sebesar <b>${QRIS_NOMINAL}</b>\n` +
                `3. Kirim <b>FOTO / SCREENSHOT bukti transfer</b> ke chat ini\n\n` +
                `⏳ <i>Setelah bukti dikirim, admin akan memverifikasi untuk membuka kembali akun atau mengurangi batasan waktu chat Anda.</i>\n\n` +
                `Ketik /cancel untuk membatalkan.`;

            if (fs.existsSync(QRIS_IMAGE)) {
                return botDonasi.sendPhoto(chatId, QRIS_IMAGE, { caption, parse_mode: 'HTML' });
            }
            return botDonasi.sendMessage(chatId, caption + '\n\n⚠️ <i>Gambar QRIS sedang dimuat ulang, silakan transfer ke NMID yang tertera.</i>', { parse_mode: 'HTML' });
        }

        // ---------- User: Pilih Opsi Stars ----------
        if (d === 'ap_star' || d === 'ak_star') {
            await ack();
            const isAccess = d === 'ak_star';
            try {
                await botDonasi.sendInvoice(chatId,
                    isAccess ? 'Pemulihan Akses Grup' : 'Pemulihan Batasan Chat Grup',
                    isAccess ? 'Membuka kembali akses masuk grup setelah diblokir.' : 'Mencabut batasan chat dan peringatan di grup.',
                    `${isAccess ? 'access' : 'appeal'}:${uid}`, '', 'XTR',
                    [{ label: 'Pemulihan Akun', amount: STARS_PRICE }]);
            } catch (err) {
                console.error('❌ Gagal kirim invoice Stars:', err.message);
                botDonasi.sendMessage(chatId, '❌ Gagal membuat tagihan Stars. Silakan gunakan opsi QRIS.');
            }
            return;
        }

        // ---------- User: Pilih Opsi Keringanan Waktu / Alasan ----------
        if (d === 'ap_time' || d === 'ak_reason') {
            await ack();
            const isAccess = d === 'ak_reason';
            states[uid] = { step: 'reason', method: 'time', context: isAccess ? 'access' : 'appeal' };

            return botDonasi.sendMessage(chatId,
                `📝 <b>TULIS ALASAN PEMULIHAN</b>\n\n` +
                (isAccess
                    ? `Tulis alasan mengapa Anda perlu masuk kembali ke grup (minimal ${MIN_REASON} karakter).`
                    : `Tulis alasan mengapa batasan waktu chat Anda perlu diringankan dan komitmen Anda mematuhi aturan grup (minimal ${MIN_REASON} karakter).`) +
                `\n\nKetik /cancel untuk membatalkan.`,
                { parse_mode: 'HTML' });
        }

        // ---------- User: Konfirmasi Alasan Tertulis ----------
        if (d === 'ap_confirm') {
            const st = states[uid];
            if (!st || st.step !== 'confirm') { await ack(); return; }
            await ack({ text: '✅ Pengajuan dikirim ke admin.' });
            delete states[uid];
            botDonasi.deleteMessage(chatId, q.message.message_id).catch(() => { });
            await botDonasi.sendMessage(chatId, '⏳ Pengajuan Anda sudah diteruskan ke admin. Mohon tunggu keputusan.');
            await submitToAdmins(newAppeal(q.from, 'time', { reason: st.reason, context: st.context || 'appeal' }));
            return;
        }

        // =============================================================
        // KEPUTUSAN ADMIN: ap_ok, ap_reduce, ap_no
        // =============================================================
        if (d.startsWith('ap_ok:') || d.startsWith('ap_reduce:') || d.startsWith('ap_no:')) {
            if (!isAdminId(uid)) { await ack({ text: '⛔ Anda bukan Admin!', show_alert: true }); return; }
            const id = d.split(':')[1];
            const a = store.appeals[id];
            if (!a) { await ack({ text: '⚠️ Pengajuan sudah diproses sebelumnya.', show_alert: true }); return; }

            delete store.appeals[id];
            save();

            const isOk = d.startsWith('ap_ok:');
            const isReduce = d.startsWith('ap_reduce:');
            const isReject = d.startsWith('ap_no:');

            let resultNote = '';

            // 1. SETUJUI PENUH
            if (isOk) {
                await mod.clearPenalty(a.userId);
                const rec = mod.getJoinRecord(a.userId);
                if (rec && rec.blocked) {
                    await mod.allowRejoin(a.userId);
                }
                resultNote = 'Sanksi dicabut penuh & akses grup dibuka kembali.';

                botDonasi.sendMessage(a.userId,
                    `🎉 <b>Pengajuan Anda DISETUJUI PENUH oleh Admin!</b>\n\n` +
                    `✅ Batasan chat/komentar telah dicabut.\n` +
                    `✅ Akses grup telah dibuka kembali.\n\n` +
                    `<i>Silakan kembali berpartisipasi dan patuhi aturan grup ya. 💎</i>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: [[{ text: '💬 Masuk / Cek Grup', url: groupUrl }]] }
                    }).catch(() => { });

                await ack({ text: '✅ Disetujui Penuh' });
            }

            // 2. KURANGI WAKTU CHAT
            else if (isReduce) {
                const r = await mod.shortenPenalty(a.userId);
                if (r.action === 'mute_shortened') {
                    resultNote = `Sisa batasan chat dipotong 50% (± ${r.minutes} menit lagi).`;
                } else if (r.action === 'mute_lifted') {
                    resultNote = 'Batasan chat dicabut penuh.';
                } else if (r.action === 'warn_reduced') {
                    resultNote = `Peringatan dikurangi 1 (sisa ${r.count}).`;
                } else {
                    resultNote = 'Batasan waktu diringankan.';
                }

                const rec = mod.getJoinRecord(a.userId);
                if (rec && rec.blocked) {
                    await mod.allowRejoin(a.userId);
                    resultNote += ' Akses grup dibuka kembali.';
                }

                botDonasi.sendMessage(a.userId,
                    `⏱️ <b>Admin Mengurangi Batasan Waktu Chat Anda!</b>\n\n` +
                    `📋 <b>Status:</b> ${resultNote}\n\n` +
                    `<i>Mohon patuhi aturan grup agar tidak terkena sanksi kembali.</i>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: [[{ text: '💬 Masuk / Cek Grup', url: groupUrl }]] }
                    }).catch(() => { });

                await ack({ text: '⏱️ Batasan Waktu Dikurangi' });
            }

            // 3. TOLAK
            else if (isReject) {
                let refundNote = '';
                if (a.method === 'stars' && a.chargeId) {
                    try {
                        await botDonasi._request('refundStarPayment', {
                            form: { user_id: a.userId, telegram_payment_charge_id: a.chargeId }
                        });
                        refundNote = '\n\n⭐ Stars Anda sudah dikembalikan otomatis.';
                        resultNote = 'Stars di-refund.';
                    } catch (err) {
                        console.error('❌ Gagal refund Stars:', err.message);
                        resultNote = 'Refund Stars manual diperlukan.';
                    }
                } else if (a.method === 'qris') {
                    refundNote = '\n\nJika bukti tidak valid atau ada pertanyaan, silakan hubungi admin.';
                    resultNote = 'Bukti ditolak.';
                }

                botDonasi.sendMessage(a.userId,
                    `❌ <b>Pengajuan Pemulihan Ditolak oleh Admin</b>${refundNote}`,
                    { parse_mode: 'HTML' }).catch(() => { });

                await ack({ text: '❌ Ditolak' });
            }

            // Update status di pesan Admin
            const labelTitle = isOk ? '✅ DISETUJUI PENUH' : isReduce ? '⏱️ BATASAN WAKTU DIKURANGI' : '❌ DITOLAK';
            const label = `${labelTitle} oleh ${nameOf(q.from)}\n👤 ${esc(a.name)} (<code>${a.userId}</code>)\n${resultNote}`;

            try {
                if (q.message.photo) {
                    await botDonasi.editMessageCaption(label, { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML' });
                } else {
                    await botDonasi.editMessageText(label, { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML' });
                }
            } catch { }

            console.log(`⚖️ Banding ${id} ${labelTitle} oleh admin ${uid}`);
            return;
        }
    };

    botDonasi.on('callback_query', onCallback);

    // =============================================================
    // HANDLER FOTO BUKTI PEMBAYARAN QRIS (dipanggil langsung dari index.js)
    // =============================================================
    async function handleProofPhoto(msg) {
        if (!isPrivate(msg)) return false;
        const uid = msg.from.id;
        if (recentProofs.has(uid)) return true; // abaikan jika album/media ganda
        const st = states[uid];
        if (!st || st.step !== 'proof') return false;

        recentProofs.add(uid);
        setTimeout(() => recentProofs.delete(uid), 15000);

        const proof = msg.photo[msg.photo.length - 1].file_id;
        const context = st.context || 'appeal';
        delete states[uid];

        await botDonasi.sendMessage(msg.chat.id,
            `⏳ <b>Bukti Pembayaran Diterima!</b>\n\n` +
            `Bukti transfer Anda telah diteruskan ke Admin untuk diverifikasi. ` +
            `Akun Anda akan dipulihkan setelah disetujui. Mohon ditunggu ya! 💎`,
            { parse_mode: 'HTML' });

        await submitToAdmins(newAppeal(msg.from, 'qris', { proof, context }));
        return true;
    }

    // =============================================================
    // INPUT TEKS ALASAN USER
    // =============================================================
    botDonasi.on('message', async (msg) => {
        if (!isPrivate(msg) || !msg.text || msg.text.startsWith('/')) return;
        const st = states[msg.from.id];
        if (!st) return;

        if (st.step === 'proof') {
            return botDonasi.sendMessage(msg.chat.id,
                '📷 Mohon kirim <b>foto / screenshot</b> bukti pembayaran QRIS (bukan teks).\n\nKetik /cancel untuk membatalkan.',
                { parse_mode: 'HTML' });
        }

        if (st.step === 'reason') {
            const reason = msg.text.trim();
            if (reason.length < MIN_REASON) {
                return botDonasi.sendMessage(msg.chat.id,
                    `⚠️ Alasan terlalu singkat (minimal ${MIN_REASON} karakter, saat ini ${reason.length}). Tulis lebih lengkap.`);
            }
            st.reason = reason.slice(0, 500);
            st.step = 'confirm';

            return botDonasi.sendMessage(msg.chat.id,
                `📝 <b>Alasan Anda:</b>\n<i>"${esc(st.reason)}"</i>\n\n` +
                `Dengan menekan tombol di bawah, Anda berkomitmen mematuhi aturan grup.`,
                {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '✅ Kirim Pengajuan ke Admin', callback_data: 'ap_confirm' }]] }
                });
        }
    });

    // Admin direct command: /izinkan ID (langsung buka akses user)
    botDonasi.onText(/^\/izinkan(?:@\w+)?\s+(\d+)$/i, async (msg, match) => {
        if (!isPrivate(msg) || !isAdminId(msg.from.id)) return;
        const target = Number(match[1]);
        delete store.access[target];
        save();
        await mod.allowRejoin(target);
        await mod.clearPenalty(target);

        botDonasi.sendMessage(msg.chat.id, `✅ User <code>${target}</code> diizinkan masuk grup lagi (hitungan dan sanksi direset).`, { parse_mode: 'HTML' });
        botDonasi.sendMessage(target,
            `✅ <b>Akses grup DIIZINKAN admin.</b> Silakan bergabung kembali.`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💬 Masuk Grup', url: groupUrl }]] } }
        ).catch(() => { });
    });

    console.log('⚖️ Sistem pemulihan & banding aktif (/banding, /minta_akses, QRIS, Stars).');

    return { isBusy, isWaitingProof, handleProofPhoto, sendBandingMenu, sendAccessMenu };
};
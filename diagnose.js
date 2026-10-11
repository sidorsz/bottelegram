const config = require('./config');
const T = config.botDonasi.token;
const api = async (m, p = {}) =>
    (await fetch(`https://api.telegram.org/bot${T}/${m}?` + new URLSearchParams(p))).json();

(async () => {
    const me = (await api('getMe')).result;
    console.log('Bot:', me.username, me.id);

    const ch = (await api('getChat', { chat_id: config.channelId })).result || {};
    console.log('\n[CHANNEL]', ch.title, '| type:', ch.type, '| username:', ch.username);
    console.log('linked_chat_id:', ch.linked_chat_id || '❌ KOSONG (belum di-link)');
    console.log('has_protected_content:', ch.has_protected_content);

    const gr = (await api('getChat', { chat_id: config.groupId })).result || {};
    console.log('\n[GRUP config.groupId]', gr.title, '| type:', gr.type);
    console.log('is_forum (Topics):', gr.is_forum);
    console.log('linked_chat_id grup:', gr.linked_chat_id);
    console.log('has_protected_content:', gr.has_protected_content);

    console.log('\n[COCOK?]');
    console.log('channel.linked_chat_id == config.groupId ?', String(ch.linked_chat_id) === String(config.groupId));
    console.log('grup.linked_chat_id == config.channelId ?', String(gr.linked_chat_id) === String(config.channelId));

    for (const [nama, id] of [['CHANNEL', config.channelId], ['GRUP', config.groupId]]) {
        const m = (await api('getChatMember', { chat_id: id, user_id: me.id })).result || {};
        console.log(`\n[BOT di ${nama}] status:`, m.status,
            '| post:', m.can_post_messages, '| edit:', m.can_edit_messages,
            '| hapus:', m.can_delete_messages);
    }

    const wh = (await api('getWebhookInfo')).result;
    console.log('\n[WEBHOOK] url:', wh.url || '(kosong, aman untuk polling)', '| error:', wh.last_error_message || '-');
})();
// Telegram webhook: /start (login_ ёки reset_ билан), рақам улашиш, тасдиқ ва коднинг юборилиши
const crypto = require('crypto');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const digits = p => String(p || '').replace(/\D/g, '');

async function kv(cmd) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

async function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const say = (chatId, text, extra) => tg('sendMessage', Object.assign({ chat_id: chatId, text }, extra || {}));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) return res.status(403).end();
  const msg = (req.body || {}).message;
  if (!msg) return res.status(200).json({ ok: true });
  const chatId = msg.chat.id;

  if (msg.contact) {
    if (msg.contact.user_id !== msg.from.id) {
      await say(chatId, 'Илтимос, ўз рақамингизни улашинг.');
      return res.status(200).json({ ok: true });
    }
    const phone = digits(msg.contact.phone_number);
    await kv(['SET', 'tg:' + phone, String(chatId)]);

    const pendRaw = await kv(['GET', 'tgc:' + chatId]);
    if (!pendRaw) {
      await say(chatId, 'Рахмат! Рақамингиз сақланди. Буюртмангиз ҳақидаги хабарлар шу ерга келади.', { reply_markup: { remove_keyboard: true } });
      return res.status(200).json({ ok: true });
    }
    await kv(['DEL', 'tgc:' + chatId]);
    const pend = JSON.parse(pendRaw);
    const userRaw = await kv(['GET', 'user:' + phone]);
    const user = userRaw ? JSON.parse(userRaw) : null;
    const exists = !!user && !!user.act;

    if (pend.purpose === 'reset') {
      if (exists) {
        const code = String(crypto.randomInt(100000, 1000000));
        await kv(['SET', 'rst:' + phone, JSON.stringify({ code, exp: Date.now() + 10 * 60 * 1000, tries: 0 }), 'EX', '600']);
        await say(chatId, `Паролни тиклаш коди: ${code}\nКод 10 дақиқа амал қилади. Уни сайтдаги «Паролни тиклаш» бўлимига киритинг.`, { reply_markup: { remove_keyboard: true } });
      } else {
        await say(chatId, 'Афсус, бу рақам базада мавжуд эмас. Қайтадан уриниб кўринг.', { reply_markup: { remove_keyboard: true } });
      }
      return res.status(200).json({ ok: true });
    }

    // login
    if (exists) {
      await kv(['SET', 'tgl:' + pend.t, JSON.stringify({ status: 'ok', phone }), 'EX', '600']);
      await say(chatId, '✅ Профилга кирдингиз. Сайтга қайтишингиз мумкин.', { reply_markup: { remove_keyboard: true } });
    } else {
      await kv(['SET', 'tgl:' + pend.t, JSON.stringify({ status: 'nouser' }), 'EX', '600']);
      await say(chatId, 'Афсус, бу рақам базада мавжуд эмас. Қайтадан уриниб кўринг.', { reply_markup: { remove_keyboard: true } });
    }
    return res.status(200).json({ ok: true });
  }

  if (msg.text && msg.text.startsWith('/start')) {
    const payload = (msg.text.split(' ')[1] || '').trim();
    const m = payload.match(/^(login|reset)_([a-f0-9]{24})$/);
    if (m) {
      await kv(['SET', 'tgc:' + chatId, JSON.stringify({ t: m[2], purpose: m[1] }), 'EX', '600']);
      await say(chatId, 'Телефон рақамингизни улашинг. Пастдаги тугмани босинг.', {
        reply_markup: { keyboard: [[{ text: '📱 Рақамни улашиш', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
      });
    } else {
      await say(chatId, 'Assalomu alaykum! Lux Home Tizim. Буюртма ҳақидаги хабарларни олиш учун телефон рақамингизни улашинг.', {
        reply_markup: { keyboard: [[{ text: '📱 Рақамни улашиш', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
      });
    }
  }
  return res.status(200).json({ ok: true });
};

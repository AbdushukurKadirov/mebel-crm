// Telegram webhook: харидор /start ва ўз рақамини улашганда рақам Redis'да сақланади
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) {
    return res.status(403).end();
  }
  const msg = (req.body || {}).message;
  if (!msg) return res.status(200).json({ ok: true });
  const chatId = msg.chat.id;

  if (msg.contact) {
    if (msg.contact.user_id !== msg.from.id) {
      await tg('sendMessage', { chat_id: chatId, text: 'Илтимос, ўз рақамингизни улашинг.' });
    } else {
      await kv(['SET', 'tg:' + digits(msg.contact.phone_number), String(chatId)]);
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Рахмат! Рақамингиз сақланди. Буюртмангиз ҳақидаги хабарлар шу ерга келади.',
        reply_markup: { remove_keyboard: true },
      });
    }
  } else if (msg.text && msg.text.startsWith('/start')) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Assalomu alaykum! Lux Home Tizim. Буюртма ҳақидаги хабарларни олиш учун телефон рақамингizни улашинг.',
      reply_markup: {
        keyboard: [[{ text: '📱 Рақамни улашиш', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }
  return res.status(200).json({ ok: true });
};

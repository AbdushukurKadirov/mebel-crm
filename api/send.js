// Дастурдан хабар юбориш: телефон рақам бўйича Telegram'га жўнатади
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_KEY = process.env.APP_KEY;
const links = global.__tgLinks || (global.__tgLinks = new Map());
const digits = p => String(p || '').replace(/\D/g, '');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (APP_KEY && req.headers['x-app-key'] !== APP_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const { phone, text } = req.body || {};
  const chatId = links.get(digits(phone));
  if (!chatId) return res.status(200).json({ ok: false, reason: 'not_linked' });

  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(text || '').slice(0, 4000) }),
  });
  const j = await r.json();
  return res.status(200).json({ ok: !!j.ok, reason: j.ok ? null : j.description });
};

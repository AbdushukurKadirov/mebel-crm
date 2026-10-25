// Ҳар куни 10:00 (Тошкент) да қарзи бор харидорларга эслатма
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TG = process.env.TELEGRAM_BOT_TOKEN;
const money = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const tot = c => Math.max(0, (c.price || 0) - (c.disc || 0));
const paid = c => (c.pay || []).reduce((s, p) => s + (p.a || 0), 0);
const rem = c => Math.max(0, tot(c) - paid(c));

async function kv(cmd) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

async function tgSend(phone, text) {
  const chat = await kv(['GET', 'tg:' + String(phone || '').replace(/\D/g, '')]);
  if (!chat || !TG) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
    return (await r.json()).ok === true;
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  const raw = await kv(['GET', 'crm:data']);
  if (!raw) return res.status(200).json({ ok: true, sent: 0 });
  const s = JSON.parse(raw);
  const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
  let sent = 0;

  for (const c of s.C || []) {
    if (c.stage !== 'debt' || rem(c) <= 0 || c.lastDaily === today) continue;
    const txt = `${c.name}, эслатма: буюртма бўйича қолган қарзингиз ${money(rem(c))} сўм. Илтимос, тўловни амалга оширинг.`;
    const ok = await tgSend(c.phone, txt);
    c.msgs = [...(c.msgs || []), { t: Date.now(), ev: 'daily', txt, ch: 'tg', ok }];
    c.lastDaily = today;
    if (ok) sent++;
  }

  await kv(['SET', 'crm:data', JSON.stringify(s)]);
  return res.status(200).json({ ok: true, sent });
};

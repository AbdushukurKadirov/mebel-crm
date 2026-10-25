// Директорни бир марта яратиш. SETUP_KEY билан ҳимояланган.
const crypto = require('crypto');
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SETUP_KEY = process.env.SETUP_KEY;
const digits = p => String(p || '').replace(/\D/g, '');

async function kv(cmd) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

const ALLK = ['sales', 'zamer', 'prod:0', 'prod:1', 'prod:2', 'prod:3', 'prod:4', 'prod:5', 'prod:6', 'prod:7', 'debt', 'an', 'adm'];
const ALLF = ['phone', 'addr', 'price', 'pay', 'msgs'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { key, phone, password, name } = req.body || {};
  if (!SETUP_KEY || key !== SETUP_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
  const d = digits(phone);
  if (d.length !== 12 || !d.startsWith('998')) return res.status(400).json({ ok: false, error: 'bad_phone' });
  if (!password || String(password).length < 8) return res.status(400).json({ ok: false, error: 'password_short' });
  if (await kv(['GET', 'setup:done'])) return res.status(409).json({ ok: false, error: 'already_setup' });

  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const user = { phone: d, name: name || 'Директор', role: 'Директор', act: true, p: ALLK, a: ALLK, f: ALLF, pw: salt + '$' + h };
  await kv(['SET', 'user:' + d, JSON.stringify(user)]);
  await kv(['SET', 'setup:done', '1']);
  return res.status(200).json({ ok: true });
};

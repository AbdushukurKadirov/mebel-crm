// Логин, сессия, чиқиш: ?action=login (POST), ?action=me (GET), ?action=logout (POST)
const crypto = require('crypto');
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

function verify(pw, stored) {
  const [salt, h] = String(stored).split('$');
  const t = crypto.scryptSync(String(pw || ''), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(t, 'hex'));
}

function bearer(req) {
  return (req.headers.authorization || '').replace('Bearer ', '').trim();
}

async function sessionUser(req) {
  const t = bearer(req);
  if (!t) return null;
  const d = await kv(['GET', 'session:' + t]);
  if (!d) return null;
  const raw = await kv(['GET', 'user:' + d]);
  if (!raw) return null;
  const u = JSON.parse(raw);
  return u.act ? u : null;
}

module.exports = async (req, res) => {
  const action = new URL(req.url, 'http://x').searchParams.get('action');

  if (action === 'login' && req.method === 'POST') {
    const { phone, password } = req.body || {};
    const raw = await kv(['GET', 'user:' + digits(phone)]);
    if (!raw) return res.status(401).json({ ok: false, error: 'bad_credentials' });
    const u = JSON.parse(raw);
    if (!u.act || !verify(password, u.pw)) return res.status(401).json({ ok: false, error: 'bad_credentials' });
    const token = crypto.randomBytes(32).toString('hex');
    await kv(['SET', 'session:' + token, u.phone, 'EX', '43200']);
    const { pw, ...pub } = u;
    return res.status(200).json({ ok: true, token, user: pub });
  }

  if (action === 'me' && req.method === 'GET') {
    const u = await sessionUser(req);
    if (!u) return res.status(401).json({ ok: false });
    const { pw, ...pub } = u;
    return res.status(200).json({ ok: true, user: pub });
  }

  if (action === 'logout' && req.method === 'POST') {
    const t = bearer(req);
    if (t) await kv(['DEL', 'session:' + t]);
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ ok: false });
};

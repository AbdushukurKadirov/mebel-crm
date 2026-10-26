// Логин, сессия, чиқиш, парол, Telegram орқали кириш ва парол тиклаш
// ?action=login|me|logout|password (фақат POST/GET юқорида)
// ?action=tgstart (POST) · ?action=tgcheck (GET) · ?action=reset (POST)
const crypto = require('crypto');
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BOT = 'luxhometizim_bot';
const digits = p => String(p || '').replace(/\D/g, '');

async function kv(cmd) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + '$' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
}

function verify(pw, stored) {
  if (!stored) return false;
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

async function newSession(phone) {
  const token = crypto.randomBytes(32).toString('hex');
  await kv(['SET', 'session:' + token, phone, 'EX', '43200']);
  return token;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action');

  if (action === 'login' && req.method === 'POST') {
    const { phone, password } = req.body || {};
    const raw = await kv(['GET', 'user:' + digits(phone)]);
    if (!raw) return res.status(401).json({ ok: false, error: 'bad_credentials' });
    const u = JSON.parse(raw);
    if (!u.act || !verify(password, u.pw)) return res.status(401).json({ ok: false, error: 'bad_credentials' });
    const token = await newSession(u.phone);
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

  if (action === 'password' && req.method === 'POST') {
    const u = await sessionUser(req);
    if (!u) return res.status(401).json({ ok: false });
    const { oldPassword, newPassword } = req.body || {};
    if (!verify(oldPassword, u.pw)) return res.status(403).json({ ok: false, error: 'bad_old_password' });
    if (String(newPassword || '').length < 8) return res.status(400).json({ ok: false, error: 'password_short' });
    u.pw = hashPw(newPassword);
    await kv(['SET', 'user:' + u.phone, JSON.stringify(u)]);
    return res.status(200).json({ ok: true });
  }

  // Telegram орқали кириш: сайт токен беради, бот рақамни тасдиқлайди
  if (action === 'tgstart' && req.method === 'POST') {
    const purpose = req.body && req.body.purpose === 'reset' ? 'reset' : 'login';
    const t = crypto.randomBytes(12).toString('hex');
    await kv(['SET', 'tgl:' + t, JSON.stringify({ status: 'pending', purpose }), 'EX', '600']);
    const param = (purpose === 'reset' ? 'reset_' : 'login_') + t;
    return res.status(200).json({ ok: true, t, url: `https://t.me/${BOT}?start=${param}` });
  }

  if (action === 'tgcheck' && req.method === 'GET') {
    const t = url.searchParams.get('t') || '';
    const raw = t ? await kv(['GET', 'tgl:' + t]) : null;
    if (!raw) return res.status(200).json({ ok: false, status: 'expired' });
    const st = JSON.parse(raw);
    if (st.status !== 'ok') return res.status(200).json({ ok: true, status: st.status });
    const u = JSON.parse(await kv(['GET', 'user:' + st.phone]) || 'null');
    await kv(['DEL', 'tgl:' + t]);
    if (!u || !u.act) return res.status(200).json({ ok: true, status: 'nouser' });
    const token = await newSession(u.phone);
    const { pw, ...pub } = u;
    return res.status(200).json({ ok: true, status: 'ok', token, user: pub });
  }

  // Парол тиклаш: Telegram'га келган код + янги парол
  if (action === 'reset' && req.method === 'POST') {
    const { phone, code, newPassword } = req.body || {};
    const d = digits(phone);
    const raw = await kv(['GET', 'rst:' + d]);
    if (!raw) return res.status(400).json({ ok: false, error: 'bad_code' });
    const r = JSON.parse(raw);
    if (r.tries >= 5) { await kv(['DEL', 'rst:' + d]); return res.status(429).json({ ok: false, error: 'too_many' }); }
    if (r.code !== String(code || '').trim() || Date.now() > r.exp) {
      r.tries = (r.tries || 0) + 1;
      await kv(['SET', 'rst:' + d, JSON.stringify(r), 'EX', '600']);
      return res.status(400).json({ ok: false, error: 'bad_code' });
    }
    if (String(newPassword || '').length < 8) return res.status(400).json({ ok: false, error: 'password_short' });
    const u = JSON.parse(await kv(['GET', 'user:' + d]) || 'null');
    if (!u) return res.status(400).json({ ok: false, error: 'bad_code' });
    u.pw = hashPw(newPassword);
    await kv(['SET', 'user:' + d, JSON.stringify(u)]);
    await kv(['DEL', 'rst:' + d]);
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ ok: false });
};

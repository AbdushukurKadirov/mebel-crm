// Ходимларни бошқариш (фақат Админ рухсати бор ходим):
// GET ?action=list · POST ?action=add | update | resetpw | delete
const crypto = require('crypto');
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DIRECTOR = '998998055858';
const digits = p => String(p || '').replace(/\D/g, '');
const arr = x => (Array.isArray(x) ? x.map(String) : null);

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

const pub = u => { const { pw, ...r } = u; return r; };

module.exports = async (req, res) => {
  const me = await sessionUser(req);
  if (!me) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!(me.p || []).includes('adm')) return res.status(403).json({ ok: false, error: 'forbidden' });

  const action = new URL(req.url, 'http://x').searchParams.get('action');
  const body = req.body || {};

  if (action === 'list' && req.method === 'GET') {
    const phones = (await kv(['SMEMBERS', 'staff:all'])) || [];
    if (!phones.includes(DIRECTOR)) phones.unshift(DIRECTOR);
    const users = [];
    for (const d of phones) {
      const raw = await kv(['GET', 'user:' + d]);
      if (raw) users.push(pub(JSON.parse(raw)));
    }
    return res.status(200).json({ ok: true, users });
  }

  if (req.method !== 'POST') return res.status(405).end();
  const d = digits(body.phone);

  if (action === 'add') {
    if (d.length !== 12 || !d.startsWith('998')) return res.status(400).json({ ok: false, error: 'bad_phone' });
    if (!String(body.name || '').trim()) return res.status(400).json({ ok: false, error: 'name_required' });
    if (String(body.password || '').length < 8) return res.status(400).json({ ok: false, error: 'password_short' });
    if (await kv(['GET', 'user:' + d])) return res.status(409).json({ ok: false, error: 'exists' });
    const user = {
      phone: d,
      name: String(body.name).trim().slice(0, 60),
      role: String(body.role || 'Ходим').trim().slice(0, 60),
      act: true,
      p: arr(body.p) || [],
      a: arr(body.a) || [],
      f: arr(body.f) || [],
      pw: hashPw(body.password),
    };
    await kv(['SET', 'user:' + d, JSON.stringify(user)]);
    await kv(['SADD', 'staff:all', d]);
    return res.status(200).json({ ok: true, user: pub(user) });
  }

  const raw = await kv(['GET', 'user:' + d]);
  if (!raw) return res.status(404).json({ ok: false, error: 'not_found' });
  const t = JSON.parse(raw);

  if (action === 'update') {
    const p = arr(body.p) || t.p;
    const act = typeof body.act === 'boolean' ? body.act : t.act;
    if (d === DIRECTOR && (!act || !p.includes('adm'))) {
      return res.status(400).json({ ok: false, error: 'director_locked' });
    }
    if (typeof body.name === 'string' && body.name.trim()) t.name = body.name.trim().slice(0, 60);
    if (typeof body.role === 'string' && body.role.trim()) t.role = body.role.trim().slice(0, 60);
    t.act = act;
    t.p = p;
    t.a = arr(body.a) || t.a;
    t.f = arr(body.f) || t.f;
    await kv(['SET', 'user:' + d, JSON.stringify(t)]);
    return res.status(200).json({ ok: true, user: pub(t) });
  }

  if (action === 'resetpw') {
    if (String(body.password || '').length < 8) return res.status(400).json({ ok: false, error: 'password_short' });
    t.pw = hashPw(body.password);
    await kv(['SET', 'user:' + d, JSON.stringify(t)]);
    return res.status(200).json({ ok: true });
  }

  if (action === 'delete') {
    if (d === DIRECTOR) return res.status(400).json({ ok: false, error: 'director_locked' });
    await kv(['DEL', 'user:' + d]);
    await kv(['SREM', 'staff:all', d]);
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ ok: false, error: 'unknown_action' });
};

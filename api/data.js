// CRM маълумотлари (харидорлар, буюртмалар, тўловлар) — фақат кирган ходим учун
const crypto = require('crypto');
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX = 3 * 1024 * 1024;

async function kv(cmd) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
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
  const u = await sessionUser(req);
  if (!u) return res.status(401).json({ ok: false, error: 'unauthorized' });

  if (req.method === 'GET') {
    const raw = await kv(['GET', 'crm:data']);
    return res.status(200).json({ ok: true, state: raw ? JSON.parse(raw) : null });
  }

  if (req.method === 'PUT') {
    const s = req.body || {};
    if (!Array.isArray(s.C)) return res.status(400).json({ ok: false, error: 'bad_state' });
    const raw = JSON.stringify({ C: s.C, id: s.id, ST: s.ST });
    if (raw.length > MAX) return res.status(413).json({ ok: false, error: 'too_large' });
    await kv(['SET', 'crm:data', raw]);
    return res.status(200).json({ ok: true, saved: new Date().toISOString() });
  }

  return res.status(405).end();
};

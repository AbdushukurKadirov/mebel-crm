// CRM маълумотлари: ҳар бир ходимга фақат рухсат берилган қисм, сақлаш эса текширувдан ўтади
const crypto = require('crypto');
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX = 3 * 1024 * 1024;

const FIELD_KEYS = {
  phone: ['phone'],
  addr: ['addr', 'city', 'gm', 'ya', 'str', 'house', 'apt', 'dist', 'stt'],
  price: ['price', 'disc', 'pdate'],
  pay: ['pay'],
  msgs: ['msgs'],
};
const EMPTY = { phone: '', addr: '', city: '', gm: '', ya: '', str: '', house: '', apt: '', dist: '', stt: '', price: 0, disc: 0, pdate: '', pay: [], msgs: [] };

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

// Ходим бу ёзувни кўра оладими
function canSee(u, c) {
  const p = u.p || [];
  if (p.includes('an')) return true;
  switch (c.stage) {
    case 'lead': return p.includes('sales');
    case 'zamer': return p.includes('zamer');
    case 'prod': return p.includes('prod:' + c.pi);
    case 'debt': return p.includes('debt');
    case 'done': case 'archive': return p.includes('debt');
    default: return false;
  }
}

// Ходим бу ёзувда босқични ўзгартира оладими (тугмаси бор бўлими)
function canAct(u, c) {
  const a = u.a || [];
  switch (c.stage) {
    case 'lead': return a.includes('sales');
    case 'zamer': return a.includes('zamer');
    case 'prod': return a.includes('prod:' + c.pi);
    case 'debt': return a.includes('debt');
    default: return false;
  }
}

// Рухсат берилмаган майдонлар
function hiddenKeys(u) {
  const f = u.f || [];
  let out = [];
  for (const k in FIELD_KEYS) if (!f.includes(k)) out = out.concat(FIELD_KEYS[k]);
  return out;
}

function viewFor(u, c) {
  const x = { ...c };
  for (const k of hiddenKeys(u)) x[k] = EMPTY[k];
  return x;
}


// Босқич ўтишлари фақат рухсат этилган кетма-кетликда
function stageMoveOk(old, n) {
  if (old.stage === n.stage && old.pi === n.pi) return true;
  if (old.stage === 'lead') return n.stage === 'zamer';
  if (old.stage === 'zamer') return n.stage === 'prod' && n.pi === 0;
  if (old.stage === 'prod') {
    if (old.pi >= 7) return n.stage === 'debt';
    return n.stage === 'prod' && n.pi > old.pi && n.pi <= 7;
  }
  if (old.stage === 'debt') return n.stage === 'done';
  return false;
}

module.exports = async (req, res) => {
  const u = await sessionUser(req);
  if (!u) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const raw = await kv(['GET', 'crm:data']);
  const s = raw ? JSON.parse(raw) : null;

  if (req.method === 'GET') {
    if (!s) return res.status(200).json({ ok: true, state: null });
    const C = (s.C || []).filter(c => canSee(u, c)).map(c => viewFor(u, c));
    return res.status(200).json({ ok: true, state: { C, id: s.id, ST: s.ST } });
  }

  if (req.method === 'PUT') {
    const body = req.body || {};
    if (!Array.isArray(body.C)) return res.status(400).json({ ok: false, error: 'bad_state' });
    const base = s || { C: [], id: 0, ST: null };
    const out = new Map(base.C.map(c => [c.id, c]));
    let maxId = Math.max(base.id || 0, ...base.C.map(c => c.id || 0));
    const a = u.a || [];

    for (const n of body.C) {
      if (typeof n.id !== 'number') continue;
      const old = out.get(n.id);

      if (!old) {
        // Янги харидор: фақат Сотув тугмаси бор ходим яратади
        if (!a.includes('sales')) continue;
        out.set(n.id, { ...n, stage: 'lead', pi: 0 });
        maxId = Math.max(maxId, n.id);
        continue;
      }

      if (!canSee(u, old)) continue;            // кўрмаган ёзувига тегмайди
      if (old.name !== n.name) continue;        // ID тўқнашуви: бошқа харидор
      const allowedAct = canAct(u, old);
      const merged = { ...n };
      for (const k of hiddenKeys(u)) merged[k] = old[k];   // яширин майдонлар ўзгармайди
      if (!allowedAct || !stageMoveOk(old, n)) { merged.stage = old.stage; merged.pi = old.pi; }
      out.set(n.id, merged);
    }

    let ST = base.ST;
    if ((u.a || []).some(x => x === 'an' || x === 'adm') && body.ST) ST = body.ST;

    const next = JSON.stringify({ C: [...out.values()], id: maxId, ST });
    if (next.length > MAX) return res.status(413).json({ ok: false, error: 'too_large' });
    await kv(['SET', 'crm:data', next]);
    return res.status(200).json({ ok: true, saved: new Date().toISOString() });
  }

  return res.status(405).end();
};
                                   

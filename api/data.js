// CRM маълумотлари: рухсат текшируви + Telegram хабарлари (сервер томонда)
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TG = process.env.TELEGRAM_BOT_TOKEN;
const MAX = 3 * 1024 * 1024;
const PS = ['Роскрой', 'Кесиш', 'Ровер', 'Малярка', 'Кромка', 'Цех оброботка', 'Доставка', 'Сборка'];

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

// ---- Telegram хабарлари ----
const money = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const tot = c => Math.max(0, (c.price || 0) - (c.disc || 0));
const paid = c => (c.pay || []).reduce((s, p) => s + (p.a || 0), 0);
const rem = c => Math.max(0, tot(c) - paid(c));

function diffEvents(o, m) {
  const out = [];
  const dbt = rem(m) > 0 ? ' Қолган қарз: ' + money(rem(m)) + ' сўм.' : '';
  if (o.stage !== m.stage || o.pi !== m.pi) {
    if (m.stage === 'prod' && m.pi === 0 && (o.stage === 'lead' || o.stage === 'zamer')) {
      out.push({ ev: 'order', txt: `Ассалому алайкум, ${m.name}! Буюртмангиз қабул қилинди. Сумма: ${money(tot(m))} сўм.` + dbt });
    } else if (m.stage === 'prod') {
      out.push({ ev: 'stage', txt: `${m.name}, буюртмангиз «${PS[m.pi]}» босқичига ўтди.` + dbt });
    } else if (m.stage === 'debt') {
      out.push({ ev: 'ready', txt: `${m.name}, буюртмангиз тайёр ва топширилди.` + dbt });
    } else if (m.stage === 'done') {
      out.push({ ev: 'fin', txt: `Буюртмангиз ёпилди. Раҳмат, ${m.name}!` });
    }
  }
  const op = (o.pay || []).length, np = (m.pay || []).length;
  for (let i = op; i < np; i++) {
    const a = m.pay[i].a || 0;
    out.push({ ev: 'pay', txt: `Тўлов қабул қилинди: +${money(a)} сўм.` + (rem(m) > 0 ? ' Қолган қарз: ' + money(rem(m)) + ' сўм.' : ' Қарз тўлиқ тўланди. Раҳмат!') });
  }
  return out;
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
    const pending = [];

    for (const n of body.C) {
      if (typeof n.id !== 'number') continue;
      const old = out.get(n.id);

      if (!old) {
        if (!a.includes('sales')) continue;
        const created = { ...n, stage: 'lead', pi: 0, msgs: [] };
        out.set(n.id, created);
        maxId = Math.max(maxId, n.id);
        continue;
      }

      if (!canSee(u, old)) continue;
      if (old.name !== n.name) continue;
      const merged = { ...n };
      for (const k of hiddenKeys(u)) merged[k] = old[k];
      if (!canAct(u, old) || !stageMoveOk(old, n)) { merged.stage = old.stage; merged.pi = old.pi; }
      merged.msgs = old.msgs || [];          // хабарлар фақат сервердан ёзилади
      merged.lastDaily = old.lastDaily;
      for (const e of diffEvents(old, merged)) pending.push({ c: merged, ...e });
      out.set(n.id, merged);
    }

    // Хабарлар юбориш ва тарихга ёзиш
    for (const p of pending) {
      const ok = await tgSend(p.c.phone, p.txt);
      p.c.msgs = [...(p.c.msgs || []), { t: Date.now(), ev: p.ev, txt: p.txt, ch: 'tg', ok }];
    }

    let ST = base.ST;
    if (a.some(x => x === 'an' || x === 'adm') && body.ST) ST = body.ST;

    const next = JSON.stringify({ C: [...out.values()], id: maxId, ST });
    if (next.length > MAX) return res.status(413).json({ ok: false, error: 'too_large' });
    await kv(['SET', 'crm:data', next]);
    return res.status(200).json({ ok: true, sent: pending.length, saved: new Date().toISOString() });
  }

  return res.status(405).end();
};

'use strict';
// Zero-dependency accounting server: Node built-ins only. Data lives in ./data/*.csv
const http = require('http'), https = require('https'), net = require('net'), tls = require('tls'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const PORT = +process.env.PORT || 3000, HOST = process.env.HOST || '0.0.0.0';
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA = IS_SERVERLESS ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const BAK = IS_SERVERLESS ? path.join('/tmp', 'backups') : path.join(__dirname, 'backups');
const PHOTOS = path.join(DATA, 'photos');
const CERTS = path.join(__dirname, 'certs');
const db = require('./lib/db');
const FACE_THRESHOLD = +process.env.FACE_THRESHOLD || 0.5; // lower = stricter (face-api default 0.6)
const tlsOptions = () => { // key.pem + cert.pem, or amigo.pfx + pfx.pass (created by launcher/install.bat)
  try {
    const k = path.join(CERTS, 'key.pem'), c = path.join(CERTS, 'cert.pem'), p = path.join(CERTS, 'amigo.pfx'), pw = path.join(CERTS, 'pfx.pass');
    if (fs.existsSync(k) && fs.existsSync(c)) return { key: fs.readFileSync(k), cert: fs.readFileSync(c) };
    if (fs.existsSync(p)) return { pfx: fs.readFileSync(p), passphrase: fs.existsSync(pw) ? fs.readFileSync(pw, 'utf8').trim() : '' };
  } catch (e) { console.error('Certificate problem:', e.message); }
  return null;
};
let TLS_OPTS = tlsOptions(), TLS = !!TLS_OPTS;

const SCHEMA = {
  users: ['id','username','fullName','password','role','designation','contact','email','photo','faceDescriptor','faceRequired','otpRequired','permissions','createdAt'],
  clients: ['id','name','email','phone','address','gstin','contact','mobile','createdAt'],
  products: ['id','name','hsn','rate','gst','createdAt'],
  invoices: ['id','number','date','state','taxType','clientId','clientName','clientAddress','clientGstin','clientContact','clientMobile','shipName','shipAddress','shipGstin','shipContact','shipMobile','poNumber','poDate','items','subtotal','tax','total','createdBy','createdAt'],
  purchases: ['id','date','vendor','description','amount','gst','createdBy','createdAt'],
  workupdates: ['id','date','userId','username','fullName','loginTime','submittedAt','work','pending','hours','emailStatus','createdAt'],
  logins: ['id','userId','username','loginAt'],
  docs: ['id','type','number','date','party','total','data','createdBy','createdAt'], // quotation | pi | po (details as JSON in data)
  sheets: ['id','title','type','date','category','data','createdBy','createdAt'],
  ledgers: ['id','name','group','openingBalance','balanceType','contact','phone','gstin','address','createdBy','createdAt'],
  vouchers: ['id','voucherNo','voucherType','date','narration','entries','total','createdBy','createdAt'],
};
const BOTH = ['admin','employee'], ADMIN = ['admin'];
const PERM = { clients:{r:BOTH,c:BOTH}, products:{r:BOTH,c:BOTH}, invoices:{r:BOTH,c:BOTH}, purchases:{r:ADMIN,c:ADMIN}, users:{r:ADMIN,c:ADMIN}, workupdates:{r:BOTH,c:BOTH}, logins:{r:ADMIN,c:[]}, docs:{r:BOTH,c:BOTH}, sheets:{r:BOTH,c:BOTH}, ledgers:{r:BOTH,c:BOTH}, vouchers:{r:BOTH,c:BOTH} };
const REQUIRED = { clients:['name'], products:['name','rate'], purchases:['date','amount'], users:['username','role'], sheets:['title','type'], ledgers:['name','group'], vouchers:['voucherType','date'] };

// ---------- CSV ----------
const esc = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function parseCSV(t) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i+1] === '\n') i++; r.push(f); f = ''; rows.push(r); r = []; }
    else f += c;
  }
  if (f !== '' || r.length) { r.push(f); rows.push(r); }
  return rows.filter(x => !(x.length === 1 && x[0] === ''));
}
const file = t => path.join(DATA, t + '.csv');
function readTable(t) {
  if (db.isDbActive()) return db.getCachedTable(t);
  try {
    const rows = parseCSV(fs.readFileSync(file(t), 'utf8').replace(/^\uFEFF/, ''));
    const head = rows.shift() || SCHEMA[t];
    return rows.map(r => Object.fromEntries(SCHEMA[t].map(k => [k, r[head.indexOf(k)] ?? ''])));
  } catch { return []; }
}
async function writeTable(t, list) {
  if (db.isDbActive()) {
    db.setCachedTable(t, list);
    try {
      await db.writeTable(t, list);
    } catch (err) {
      console.error('DB writeTable error:', err.message);
    }
    return;
  }
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const out = [SCHEMA[t].join(',')].concat(list.map(o => SCHEMA[t].map(k => esc(o[k])).join(','))).join('\n') + '\n';
    const tmp = file(t) + '.tmp'; fs.writeFileSync(tmp, out); fs.renameSync(tmp, file(t));
  } catch {}
}
let chain = Promise.resolve(); // serialise all writes so concurrent users cannot corrupt files
const locked = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

// ---------- Security ----------
const hash = (p, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex');
const verify = (p, s) => { const [salt, h] = String(s).split(':'); if (!h) return false; const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(p, salt, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sessions = new Map(), TTL = 8 * 3600e3, attempts = new Map();
const newId = () => crypto.randomBytes(6).toString('hex');
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(x => x[0]));
function session(req) {
  let sid = cookie(req).sid;
  if (!sid && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    sid = req.headers.authorization.slice(7).trim();
  }
  if (!sid) return null;
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(sid, process.env.JWT_SECRET || 'amigo-accounting-production-jwt-secret-key-2026');
    if (decoded && decoded.u) return { user: decoded.u, exp: Date.now() + TTL };
  } catch {}
  const s = sessions.get(sid);
  if (!s || s.exp < Date.now()) return null;
  s.exp = Date.now() + TTL;
  return s;
}
const safeUser = u => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName || '',
  role: u.role,
  designation: u.designation || '',
  contact: u.contact || '',
  email: u.email || '',
  photo: u.photo || '',
  faceRequired: u.faceRequired || '',
  otpRequired: u.otpRequired || '',
  permissions: typeof u.permissions === 'object' && u.permissions !== null
    ? u.permissions
    : (typeof u.permissions === 'string' ? (() => { try { return JSON.parse(u.permissions || '{}'); } catch { return {}; } })() : {}),
  createdAt: u.createdAt
});
const needsFace = u => u.role === 'employee' && mailCfg().faceEmployees !== false; // face check is an allowed way to verify for employees
// ---- HTML e-mail templates (table layout + inline CSS so Gmail/Outlook render them; logo is embedded as a CID image) ----
const hx = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let LOGO = null; const logoBuf = () => { if (LOGO === null) { try { LOGO = fs.readFileSync(path.join(PUB, 'logo.png')); } catch { LOGO = false; } } return LOGO; };
const mailImages = () => logoBuf() ? [{ cid: 'amigo-logo', type: 'image/png', name: 'logo.png', data: logoBuf() }] : [];
function emailHtml({ title, preheader, body }) {
  const co = company(), logo = logoBuf();
  const brand = logo ? `<img src="cid:amigo-logo" width="92" alt="${hx(co.name)}" style="display:block;border:0;outline:none;height:auto">` : `<span style="font-size:20px;font-weight:700;color:#0b4f8a">${hx(co.name)}</span>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${hx(title)}</title></head>
<body style="margin:0;padding:0;background:#eef1f8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef1f8;font-size:1px">${hx(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f8;padding:26px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2333;border:1px solid #e3e8f3">
<tr><td style="padding:22px 28px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="104" valign="middle">${brand}</td><td valign="middle" style="padding-left:6px"><div style="font-size:17px;font-weight:700;color:#0b4f8a;line-height:1.25">${hx(co.name)}</div><div style="font-size:12px;color:#8a93a6;letter-spacing:.4px;margin-top:3px">GO &amp; GROW WITH AMIGO</div></td></tr></table></td></tr>
<tr><td style="height:5px;line-height:5px;font-size:0;background:#0b6fc4;border-bottom:3px solid #c1272d">&nbsp;</td></tr>
${body}
<tr><td style="background:#f6f8fc;padding:18px 28px;text-align:center;color:#8a93a6;font-size:12px;line-height:1.6;border-top:1px solid #e9edf6">${hx(co.name)}<br>This is an automated message from your accounts app. Please do not reply.</td></tr>
</table></td></tr></table></body></html>`;
}
const codeHtml = ({ title, preheader, intro, code, warning }) => emailHtml({ title, preheader, body: `
<tr><td style="padding:30px 32px 6px"><h1 style="margin:0 0 10px;font-size:23px;line-height:1.3;color:#1c2333">${hx(title)}</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#5b6477">${intro}</p></td></tr>
<tr><td align="center" style="padding:24px 32px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#f1f7ff;border:2px dashed #0b6fc4;border-radius:14px;padding:18px 34px;font-family:Consolas,'Courier New',monospace;font-size:38px;font-weight:700;letter-spacing:12px;color:#0b4f8a;text-align:center">${hx(code)}</td></tr></table></td></tr>
<tr><td style="padding:0 32px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#fff7f7;border-left:4px solid #c1272d;border-radius:6px;padding:12px 16px;font-size:13px;line-height:1.6;color:#6b4a4a">${warning}</td></tr></table></td></tr>` });
const otpHtml = code => codeHtml({ title: 'Your login code', preheader: `Your login code is ${code}. It is valid for 10 minutes.`, code,
  intro: `Use this one-time code to finish signing in to <b>${hx(company().name)}</b>. It is valid for <b>10 minutes</b> and can be used once.`,
  warning: '<b>Did not try to sign in?</b> Ignore this email and tell the admin. Never share this code with anyone.' });
const resetHtml = code => codeHtml({ title: 'Reset your admin password', preheader: `Your password reset code is ${code}. It is valid for 10 minutes.`, code,
  intro: `We received a request to reset the admin password for <b>${hx(company().name)}</b>. Enter this code on the login screen to choose a new password. It is valid for <b>10 minutes</b>.`,
  warning: '<b>Did not ask for this?</b> Ignore this email, your password stays the same. Never share this code with anyone.' });
const pwChangedHtml = () => emailHtml({ title: 'Your password was changed', preheader: 'The admin password was just changed.', body: `
<tr><td style="padding:30px 32px 30px"><h1 style="margin:0 0 10px;font-size:23px;color:#1c2333">Your password was changed</h1><p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#5b6477">The admin password for <b>${hx(company().name)}</b> was reset on <b>${hx(new Date().toLocaleString('en-IN'))}</b>.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#fff7f7;border-left:4px solid #c1272d;border-radius:6px;padding:12px 16px;font-size:13px;line-height:1.6;color:#6b4a4a"><b>Was this not you?</b> Contact the person who manages this PC right away and change the password again.</td></tr></table></td></tr>` });
function workUpdateHtml(row, u, mins) {
  const name = row.fullName || row.username, tile = (label, value) => `<td width="25%" style="padding:4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#f1f7ff;border-radius:10px;padding:12px 6px"><div style="font-size:11px;color:#6b7488;text-transform:uppercase;letter-spacing:.6px">${label}</div><div style="font-size:16px;font-weight:700;color:#0b4f8a;margin-top:4px">${value}</div></td></tr></table></td>`;
  const duty = mins === null ? '-' : `${Math.floor(mins / 60)}h ${mins % 60}m`, multi = v => hx(v).replace(/\r?\n/g, '<br>');
  const section = (label, color, text) => `<tr><td style="padding:6px 32px 14px"><div style="font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">${label}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-left:4px solid ${color};background:#fafbfe;border-radius:6px;padding:14px 16px;font-size:15px;line-height:1.65;color:#1c2333">${text}</td></tr></table></td></tr>`;
  return emailHtml({ title: `${name} work update`, preheader: `${name} sent the work update for ${dmy(row.date)}.`, body: `
<tr><td style="padding:28px 32px 4px"><div style="font-size:12px;font-weight:700;color:#c1272d;text-transform:uppercase;letter-spacing:.8px">Daily work update</div><h1 style="margin:6px 0 4px;font-size:24px;line-height:1.3;color:#1c2333">${hx(name)}</h1><div style="font-size:14px;color:#5b6477">${hx(dmy(row.date))} &nbsp;·&nbsp; ${hx(row.username)}${u.contact ? ' &nbsp;·&nbsp; ' + hx(u.contact) : ''}</div></td></tr>
<tr><td style="padding:16px 28px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tile('First login', hx(ltime(row.loginTime)))}${tile('Update sent', hx(ltime(row.submittedAt)))}${tile('On duty', hx(duty))}${tile('Hours', row.hours ? hx(row.hours) : '-')}</tr></table></td></tr>
${section('Work done today', '#0b6fc4', multi(row.work))}${section('Pending / blockers', '#c1272d', row.pending ? multi(row.pending) : '<span style="color:#8a93a6">None</span>')}<tr><td style="height:8px"></td></tr>` });
}

function offlineAlertHtml({ employee, inactiveMins, lastSeenAt, actions = [], date }) {
  const name = employee.fullName || employee.username;
  const hours = Math.floor(inactiveMins / 60);
  const mins = Math.round(inactiveMins % 60);
  const durStr = `${hours > 0 ? hours + 'h ' : ''}${mins}m`;
  const tile = (label, value) => `<td width="33%" style="padding:4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#fff1f2;border-radius:10px;padding:12px 6px"><div style="font-size:11px;color:#9f1239;text-transform:uppercase;letter-spacing:.6px">${label}</div><div style="font-size:16px;font-weight:700;color:#be123c;margin-top:4px">${value}</div></td></tr></table></td>`;
  const recentActions = actions.length ? actions.slice(-6).map(a => `<div style="margin-bottom:6px;font-size:13px"><b style="color:#0b4f8a">${hx(a.t)}:</b> ${hx(a.desc || a.type)}</div>`).join('') : '<span style="color:#8a93a6">No actions logged in the system before going offline</span>';

  return emailHtml({
    title: `Offline Alert: ${name}`,
    preheader: `${name} has been offline for ${durStr} during working hours.`,
    body: `
<tr><td style="padding:28px 32px 4px">
  <div style="display:inline-block;background:#ffe4e6;color:#be123c;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:.8px">Inactivity Alert (> 1.5 hrs)</div>
  <h1 style="margin:8px 0 4px;font-size:22px;line-height:1.3;color:#1c2333">${hx(name)} is Offline</h1>
  <div style="font-size:14px;color:#5b6477">${hx(dmy(date))} &nbsp;·&nbsp; ${hx(employee.username)}${employee.contact ? ' &nbsp;·&nbsp; ' + hx(employee.contact) : ''}</div>
</td></tr>
<tr><td style="padding:16px 28px 8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      ${tile('Working Offline Time', durStr)}
      ${tile('Last Active', lastSeenAt ? hx(ltime(lastSeenAt)) : 'Not logged in')}
      ${tile('Current Status', 'Offline')}
    </tr>
  </table>
</td></tr>
<tr><td style="padding:6px 32px 14px">
  <div style="font-size:12px;font-weight:700;color:#0b6fc4;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Activity Before Going Offline</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="border-left:4px solid #0b6fc4;background:#fafbfe;border-radius:6px;padding:14px 16px;font-size:14px;line-height:1.6;color:#1c2333">
        ${recentActions}
      </td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:0 32px 20px;font-size:13px;line-height:1.5;color:#8a93a6">
  <i>Note: This notification is sent automatically because the employee was inactive for more than 1.5 hours in official working hours (excluding lunch break from 1:00 PM to 2:00 PM and company holidays).</i>
</td></tr>`
  });
}

const MONITORING_DEFAULTS = {
  enabled: true,
  workDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  workStartTime: '09:30',
  workEndTime: '18:30',
  lunchStartTime: '13:00',
  lunchEndTime: '14:00',
  offlineThresholdMins: 90,
  alertEmails: '',
  holidays: []
};

function monitoringCfg() {
  if (db.isDbActive()) return { ...MONITORING_DEFAULTS, ...db.getCachedSetting('monitoring') };
  const f = path.join(DATA, 'monitoring.json');
  try {
    if (fs.existsSync(f)) {
      return { ...MONITORING_DEFAULTS, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    }
  } catch {}
  return { ...MONITORING_DEFAULTS };
}

function getWorkingInactiveMinutes(lastSeenDate, nowDate, cfg) {
  if (!lastSeenDate || isNaN(lastSeenDate.getTime())) return 0;
  if (nowDate <= lastSeenDate) return 0;

  let startMs = lastSeenDate.getTime();
  let endMs = nowDate.getTime();

  const toTodayMs = hhmm => {
    const [h, m] = String(hhmm || '00:00').split(':').map(Number);
    const d = new Date(nowDate);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  const workStartMs = toTodayMs(cfg.workStartTime || '09:30');
  const workEndMs = toTodayMs(cfg.workEndTime || '18:30');
  const lunchStartMs = toTodayMs(cfg.lunchStartTime || '13:00');
  const lunchEndMs = toTodayMs(cfg.lunchEndTime || '14:00');

  if (startMs < workStartMs) startMs = workStartMs;
  if (endMs > workEndMs) endMs = workEndMs;
  if (endMs <= startMs) return 0;

  let totalMins = (endMs - startMs) / 60000;

  // Subtract lunch break overlap
  const lunchOverlapStart = Math.max(startMs, lunchStartMs);
  const lunchOverlapEnd = Math.min(endMs, lunchEndMs);
  if (lunchOverlapEnd > lunchOverlapStart) {
    totalMins -= (lunchOverlapEnd - lunchOverlapStart) / 60000;
  }

  return Math.max(0, totalMins);
}

const ACTIVITY_FILE = path.join(DATA, 'activity.json');
function readActivity() {
  if (db.isDbActive()) return db.getCachedActivity();
  try {
    if (fs.existsSync(ACTIVITY_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function writeActivity(data) {
  if (db.isDbActive()) {
    db.saveActivity(data).catch(e => console.error('Failed to write activity to db:', e.message));
    return;
  }
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const keys = Object.keys(data).sort();
    if (keys.length > 90) {
      for (let i = 0; i < keys.length - 90; i++) delete data[keys[i]];
    }
    const tmp = ACTIVITY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, ACTIVITY_FILE);
  } catch (e) {
    console.error('Failed to write activity:', e.message);
  }
}

function logActivityAction(user, type, desc) {
  if (!user || user.role !== 'employee') return;
  try {
    const today = ldate();
    const data = readActivity();
    if (!data[today]) data[today] = {};
    if (!data[today][user.id]) {
      data[today][user.id] = {
        userId: user.id,
        username: user.username,
        fullName: user.fullName || '',
        loginTime: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        lastPingTime: Date.now(),
        status: 'active',
        activeMinutes: 0,
        idleMinutes: 0,
        offlineAlertSent: false,
        actions: [],
        timeline: []
      };
    }
    const rec = data[today][user.id];
    rec.lastSeenAt = new Date().toISOString();
    rec.status = 'active';
    rec.actions = rec.actions || [];
    rec.actions.push({
      t: ltime(new Date()),
      type: String(type || ''),
      desc: String(desc || '').slice(0, 300)
    });
    if (rec.actions.length > 300) rec.actions = rec.actions.slice(-300);
    writeActivity(data);
  } catch (e) {
    console.error('logActivityAction error:', e.message);
  }
}

async function checkInactivityAlerts() {
  try {
    const cfg = monitoringCfg();
    if (!cfg.enabled) return;

    const now = new Date();
    const today = ldate(now);

    // 1. Check Indian Festivals & Holidays
    if (Array.isArray(cfg.holidays) && cfg.holidays.some(h => h.date === today)) return;

    // 2. Check Working Days (Mon-Sat; Sunday off)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayDay = dayNames[now.getDay()];
    if (Array.isArray(cfg.workDays) && !cfg.workDays.includes(todayDay)) return;

    // 3. Check Working Hours
    const curHM = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    if (curHM < (cfg.workStartTime || '09:30') || curHM > (cfg.workEndTime || '18:30')) return;

    // 4. Check Lunch Break (1:00 PM - 2:00 PM)
    if (curHM >= (cfg.lunchStartTime || '13:00') && curHM < (cfg.lunchEndTime || '14:00')) return;

    const mCfg = mailCfg();
    const recipients = String(cfg.alertEmails || mCfg.mailTo || '')
      .split(',')
      .map(x => x.trim())
      .filter(x => EMAIL_RE.test(x));

    if (!recipients.length || !mCfg.smtpUser || !mCfg.smtpPass) return;

    const data = readActivity();
    if (!data[today]) data[today] = {};

    const threshold = +cfg.offlineThresholdMins || 90;
    const employees = readTable('users').filter(u => u.role === 'employee');

    for (const emp of employees) {
      let rec = data[today][emp.id];
      if (!rec) {
        // Employee has not logged in at all today
        const [wH, wM] = (cfg.workStartTime || '09:30').split(':').map(Number);
        const shiftStart = new Date(now);
        shiftStart.setHours(wH, wM, 0, 0);

        const inactiveMins = getWorkingInactiveMinutes(shiftStart, now, cfg);
        if (inactiveMins >= threshold) {
          const alertKey = emp.id + '_no_login_alert';
          if (!data[today][alertKey]) {
            data[today][alertKey] = { sentAt: now.toISOString() };
            writeActivity(data);

            const html = offlineAlertHtml({
              employee: emp,
              inactiveMins,
              lastSeenAt: null,
              actions: [],
              date: today
            });

            await smtpSend(mCfg, {
              to: recipients.join(', '),
              subject: `⚠️ Offline Alert: ${emp.fullName || emp.username} has not logged in today (${Math.round(inactiveMins)}m into shift)`,
              html,
              images: mailImages(),
              text: `${emp.fullName || emp.username} has not logged in yet today and has been offline for ${Math.round(inactiveMins)} minutes during work hours.`
            });
          }
        }
        continue;
      }

      // Employee has a record today
      const lastSeen = new Date(rec.lastSeenAt || rec.loginTime);
      const inactiveMins = getWorkingInactiveMinutes(lastSeen, now, cfg);

      if (inactiveMins >= threshold) {
        if (!rec.offlineAlertSent) {
          rec.offlineAlertSent = true;
          rec.offlineAlertSentAt = now.toISOString();
          rec.status = 'offline';
          writeActivity(data);

          const html = offlineAlertHtml({
            employee: emp,
            inactiveMins,
            lastSeenAt: lastSeen,
            actions: rec.actions || [],
            date: today
          });

          await smtpSend(mCfg, {
            to: recipients.join(', '),
            subject: `⚠️ Offline Alert: ${emp.fullName || emp.username} offline for ${Math.floor(inactiveMins / 60)}h ${Math.round(inactiveMins % 60)}m`,
            html,
            images: mailImages(),
            text: `${emp.fullName || emp.username} has been offline for ${Math.round(inactiveMins)} minutes during official work hours.`
          });
        }
      }
    }
  } catch (err) {
    console.error('Inactivity check error:', err.message);
  }
}

const needsOtp = u => (u.role === 'employee' ? mailCfg().otpEmployees !== false : (mailCfg().otpAdmin !== false && !!u.email));
const resets = new Map(), resetIp = new Map(); // admin password-reset codes
const pending = new Map(); // password-verified logins waiting for the face check and/or the e-mailed code
const maskEmail = e => { const [n, d] = String(e).split('@'); return n[0] + '*'.repeat(Math.max(1, n.length - 2)) + (n.length > 1 ? n.slice(-1) : '') + '@' + d; };
const otpHash = (code, salt) => crypto.createHash('sha256').update(salt + code).digest('hex');
async function sendOtp(p, u) { // e-mails a fresh 6-digit code; returns '' on success or an error message
  const now = Date.now();
  if (p.lastSent && now - p.lastSent < 30000) return 'Please wait 30 seconds before asking for another code.';
  if ((p.sends || 0) >= 4) return 'Too many codes requested. Log in again.';
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), salt = crypto.randomBytes(8).toString('hex');
  p.otp = { h: otpHash(code, salt), salt, exp: now + 10 * 60e3, tries: 0 }; p.lastSent = now; p.sends = (p.sends || 0) + 1; p.exp = now + 15 * 60e3; p.stage = 'otp';
  try { await smtpSend(mailCfg(), { to: u.email, subject: 'Your Accounts login code', html: otpHtml(code), images: mailImages(), text: `Your one-time login code is ${code}\n\nIt is valid for 10 minutes. If you did not try to log in, ignore this email and tell the admin.` }); return ''; }
  catch (e) { console.error('OTP email failed:', e.message); return 'The code could not be emailed. Ask the admin to check the mail settings.'; }
}
const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
function startSession(res, u) {
  let sid;
  try {
    const jwt = require('jsonwebtoken');
    sid = jwt.sign({ u: safeUser(u) }, process.env.JWT_SECRET || 'amigo-accounting-production-jwt-secret-key-2026', { expiresIn: '8h' });
  } catch {
    sid = crypto.randomBytes(24).toString('hex');
  }
  const now = new Date().toISOString();
  sessions.set(sid, { user: safeUser(u), exp: Date.now() + TTL, loginAt: now });
  db.addLoginAudit({ id: newId(), userId: u.id, username: u.username, loginAt: now }).catch(console.error);
  const secureFlag = (IS_SERVERLESS || TLS) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL / 1000}${secureFlag}`);
  return { ...safeUser(u), token: sid };
}
const CONTACT_RE = /^\+?[0-9 \-]{7,16}$/;
function applyFace(o, b, id) { // photo + face descriptor come only through this validated path
  delete o.photo; delete o.faceDescriptor; delete o.faceRequired; delete o.otpRequired;
  if (!b.photo) return;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+\/=]+)$/.exec(b.photo), d = Array.isArray(b.descriptor) ? b.descriptor.map(Number) : [];
  if (!m || m[1].length > 400000) throw fail(400, 'Invalid photo (JPEG under 300 KB)');
  const buf = Buffer.from(m[1], 'base64'); if (buf[0] !== 0xFF || buf[1] !== 0xD8) throw fail(400, 'Invalid photo');
  if (d.length !== 128 || d.some(x => !isFinite(x))) throw fail(400, 'No clear face found in the photo');
  fs.mkdirSync(PHOTOS, { recursive: true }); fs.writeFileSync(path.join(PHOTOS, id + '.jpg'), buf);
  o.photo = '1'; o.faceDescriptor = JSON.stringify(d.map(x => +x.toFixed(5)));
}
function checkUser(o, prev, b) { // validate the merged user record
  const m = { ...prev, ...o };
  if (m.role === 'employee' && !m.contact) throw fail(400, 'Contact number is required for employees');
  if (m.contact && !CONTACT_RE.test(m.contact)) throw fail(400, 'Invalid contact number');
  if (m.role === 'employee') { // one verification method is enough, but at least one must be possible
    const c = mailCfg(), fOn = c.faceEmployees !== false, oOn = c.otpEmployees !== false;
    if (fOn && oOn && !m.photo && !m.email) throw fail(400, 'Add a profile photo (face check) or an email address (emailed code) so the employee can verify at login');
    if (fOn && !oOn && !m.photo) throw fail(400, 'A profile photo showing a clear face is required for employees');
    if (oOn && !fOn && !m.email) throw fail(400, 'Email address is required for employees (login codes are sent there)');
  }
  if (m.email && !EMAIL_RE.test(m.email)) throw fail(400, 'Invalid email address');
  if (m.role === 'admin') { o.otpRequired = ''; o.faceRequired = ''; }
}

const MAIL_DEFAULTS = { smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true, smtpUser: '', smtpPass: '', mailTo: '', supportEmail: '', alertTime: '17:30', otpEmployees: true, otpAdmin: true, faceEmployees: true };
const mailCfg = () => ({
  ...MAIL_DEFAULTS,
  ...(db.isDbActive() ? db.getCachedSetting('mail') : (fs.existsSync(path.join(DATA, 'mail.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'mail.json'), 'utf8')) : {})),
  smtpPass: process.env.SMTP_PASS || (db.isDbActive() ? db.getCachedSetting('mail')?.smtpPass : '') || ''
});
const EMAIL_RE = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const pad2 = n => String(n).padStart(2, '0');
const formatDateTimeStamp = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
const ldate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ltime = d => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-';
const dmy = d => String(d).split('-').reverse().join('-');
const oneLine = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
const b64w = x => (Buffer.isBuffer(x) ? x : Buffer.from(String(x))).toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
function mimeMessage({ from, fromName, toRecipients, ccRecipients, rcpts, subject, text, html, images = [], attachments = [] }) { // plain text + HTML + attachments
  const toList = toRecipients && toRecipients.length ? toRecipients : (rcpts || []);
  const senderStr = fromName ? `"${fromName.replace(/"/g, '')}" <${from}>` : `Accounts App <${from}>`;
  const head = [
    `From: ${senderStr}`,
    `To: ${toList.join(', ')}`,
    ...(ccRecipients && ccRecipients.length ? [`Cc: ${ccRecipients.join(', ')}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(oneLine(subject)).toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0'
  ];
  const id = crypto.randomBytes(8).toString('hex'), alt = 'alt_' + id, rel = 'rel_' + id, mix = 'mix_' + id;
  const textPart = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64w(text)];
  const imgs = images.flatMap(im => [`--${rel}`, `Content-Type: ${im.type}; name="${im.name}"`, 'Content-Transfer-Encoding: base64', `Content-ID: <${im.cid}>`, `Content-Disposition: inline; filename="${im.name}"`, '', b64w(im.data)]);
  const bodyLines = html ? [
    `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, ...textPart,
    `--${alt}`, `Content-Type: multipart/related; boundary="${rel}"; type="text/html"`, '',
    `--${rel}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64w(html), ...imgs, `--${rel}--`, `--${alt}--`
  ] : textPart;

  if (!attachments.length) return head.concat(bodyLines).join('\r\n');

  const attParts = attachments.flatMap(att => [
    `--${mix}`,
    `Content-Type: ${att.type || 'application/octet-stream'}; name="${att.name}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${att.name}"`,
    '',
    b64w(att.data)
  ]);

  return head.concat(`Content-Type: multipart/mixed; boundary="${mix}"`, '', `--${mix}`, ...bodyLines, ...attParts, `--${mix}--`).join('\r\n');
}
// Minimal SMTP client (Gmail: smtp.gmail.com:465 over TLS + AUTH LOGIN with an App Password). No dependencies.
function smtpSend(cfg, { to, cc, bcc, subject, text, html, images, attachments, fromName, exactSubject = false }) {
  const ts = formatDateTimeStamp();
  const finalSubject = exactSubject || /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/.test(subject) ? subject : `${subject} - ${ts}`;
  return new Promise((resolve, reject) => {
    const secure = cfg.smtpSecure !== false, host = cfg.smtpHost, port = +cfg.smtpPort || 465;
    const sock = (secure ? tls : net).connect({ host, port, servername: host });
    sock.setEncoding('utf8'); sock.setTimeout(20000);
    let buf = '', pend = null, dead = false;
    const end = e => { if (dead) return; dead = true; if (pend) pend.no(e || new Error('closed')); sock.destroy(); e ? reject(e) : resolve(); };
    const check = () => { if (!pend) return; const L = buf.split('\r\n'); for (let i = 0; i < L.length - 1; i++) if (/^\d{3} /.test(L[i])) { const r = { code: +L[i].slice(0, 3), text: L.slice(0, i + 1).join(' | ') }; buf = L.slice(i + 1).join('\r\n'); const p = pend; pend = null; return p.ok(r); } };
    sock.on('data', d => { buf += d; check(); }); sock.on('error', end); sock.on('timeout', () => end(new Error('SMTP timeout')));
    const reply = () => new Promise((ok, no) => { pend = { ok, no }; check(); });
    const expect = async codes => { const r = await reply(); if (!codes.includes(r.code)) throw new Error('SMTP ' + r.text.slice(-160)); };
    const cmd = async (l, codes) => { sock.write(l + '\r\n'); await expect(codes); };
    const b64 = x => Buffer.from(String(x)).toString('base64');
    (async () => {
      const toList = String(to || '').split(',').map(x => x.trim()).filter(Boolean);
      const ccList = String(cc || '').split(',').map(x => x.trim()).filter(Boolean);
      const bccList = String(bcc || '').split(',').map(x => x.trim()).filter(Boolean);
      const allRcpts = [...toList, ...ccList, ...bccList];
      const from = cfg.smtpUser;
      await expect([220]); await cmd('EHLO accounts.local', [250]);
      if (cfg.smtpUser) { await cmd('AUTH LOGIN', [334]); await cmd(b64(cfg.smtpUser), [334]); await cmd(b64(cfg.smtpPass), [235]); }
      await cmd(`MAIL FROM:<${from}>`, [250]); for (const r of allRcpts) await cmd(`RCPT TO:<${r}>`, [250, 251]);
      await cmd('DATA', [354]);
      const msg = mimeMessage({ from, fromName, toRecipients: toList, ccRecipients: ccList, rcpts: toList, subject: finalSubject, text, html, images, attachments });
      sock.write(msg + '\r\n.\r\n'); await expect([250]); sock.write('QUIT\r\n');
    })().then(() => end(), end);
  });
}

// --- Logging buffer & retrieval for system diagnostics / bug reports ---
const serverLogRing = [];
const pushLogRing = (type, args) => {
  try {
    const msg = args.map(a => (typeof a === 'object' && a !== null ? (a.stack || JSON.stringify(a)) : String(a))).join(' ');
    const line = `[${new Date().toISOString()}] [${type}] ${msg}`;
    serverLogRing.push(line);
    if (serverLogRing.length > 500) serverLogRing.shift();
  } catch {}
};
const _origLog = console.log, _origErr = console.error;
console.log = function(...args) { pushLogRing('INFO', args); _origLog.apply(console, args); };
console.error = function(...args) { pushLogRing('ERROR', args); _origErr.apply(console, args); };

function getRecentServerLogs(maxLines = 400) {
  const possiblePaths = [
    path.join(__dirname, 'launcher', 'logs', 'server.log'),
    path.join(__dirname, 'launcher', 'server.log'),
    path.join(DATA, 'server.log')
  ];
  let diskLog = '';
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const stats = fs.statSync(p);
        if (stats.size > 0) {
          const readBytes = Math.min(stats.size, 350 * 1024);
          const fd = fs.openSync(p, 'r');
          const buf = Buffer.alloc(readBytes);
          fs.readSync(fd, buf, 0, readBytes, stats.size - readBytes);
          fs.closeSync(fd);
          diskLog = buf.toString('utf8');
          break;
        }
      }
    } catch {}
  }

  const memoryLog = serverLogRing.join('\r\n');
  let combined = '';
  if (diskLog && memoryLog) {
    combined = diskLog + '\r\n--- Recent Memory Activity Logs ---\r\n' + memoryLog;
  } else {
    combined = diskLog || memoryLog || `[${new Date().toISOString()}] Server running on Port ${PORT} (Node.js ${process.version})`;
  }

  // Redact secrets / passwords
  combined = combined
    .replace(/(smtpPass["']?\s*[:=]\s*["']?)[^"',\r\n]+/gi, '$1***REDACTED***')
    .replace(/(password["']?\s*[:=]\s*["']?)[^"',\r\n]+/gi, '$1***REDACTED***')
    .replace(/(AUTH LOGIN[\r\n]+)[A-Za-z0-9+/=]+/gi, '$1***REDACTED***');

  const lines = combined.split(/\r?\n/);
  return lines.slice(-maxLines).join('\r\n');
}

async function emailUpdate(row) { // returns a short status string stored with the update
  const c = mailCfg(); if (!c.smtpUser || !c.smtpPass || !c.mailTo) return 'not configured';
  const name = row.fullName || row.username, first = row.loginTime, sub = row.submittedAt;
  const mins = first ? Math.max(0, Math.round((new Date(sub) - new Date(first)) / 60000)) : null;
  const u = readTable('users').find(x => x.id === row.userId) || {};
  const text = [`Employee      : ${name} (${row.username})`, `Contact       : ${u.contact || '-'}`, `Date          : ${dmy(row.date)}`,
    `Login time    : ${ltime(first)} (first login today)`, `Update sent at: ${ltime(sub)}`, mins === null ? '' : `Time on duty  : ${Math.floor(mins / 60)}h ${mins % 60}m (first login to update)`,
    row.hours ? `Hours worked  : ${row.hours}` : '', '', 'WORK DONE TODAY', '---------------', row.work, '', 'PENDING / BLOCKERS', '------------------', row.pending || 'None'].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  try { await smtpSend(c, { to: c.mailTo, subject: `${name}_${dmy(row.date)} work update`, text, html: workUpdateHtml(row, u, mins), images: mailImages() }); return 'sent ' + ltime(new Date()); }
  catch (e) { return ('failed: ' + e.message).slice(0, 160); }
}
function buildUpdate(b, L, user) {
  const today = ldate(), work = String(b.work || '').trim(), hours = b.hours === '' || b.hours == null ? '' : +b.hours;
  if (work.length < 5) throw fail(400, 'Please describe the work you did today');
  if (hours !== '' && !(hours >= 0 && hours <= 24)) throw fail(400, 'Hours must be between 0 and 24');
  if (L.some(x => x.userId === user.id && x.date === today)) throw fail(400, "Today's work update is already submitted");
  const first = readTable('logins').filter(x => x.userId === user.id && ldate(new Date(x.loginAt)) === today).map(x => x.loginAt).sort()[0] || '';
  return { date: today, userId: user.id, username: user.username, fullName: user.fullName || '', loginTime: first, submittedAt: new Date().toISOString(), work: work.slice(0, 3000), pending: String(b.pending || '').trim().slice(0, 1000), hours: String(hours), emailStatus: '' };
}
const COMPANY_DEFAULTS = { name: 'Your Company Name', address: 'Street, City, State, PIN', gstin: '', state: 'Maharashtra', stateCode: '27', prefix: 'INV', terms: '1. This is an electronically generated document.\n2. All disputes are subject to Pune jurisdiction.', stamp: '',
  // Quotation / Proforma invoice / Purchase order (pre-filled from the sample PDFs; edit in Company)
  docAddress: 'office No. 401, Baban Villa, S\nNo. 6/17, Chovisawadi\nPune - 412105 Maharashtra\nIndia', contactPhone: '08605069145', contactEmail: 'kuldeep.amigo@gmail.com',
  pan: 'ACBFA5336L', bankName: 'HDFC', bankBranch: 'Chovisawadi, Charoli BK, Pune-412105 Maharashtra.', bankAcc: '50200081185029', bankIfsc: 'HDFC0009467',
  quoteHeader: 'Office No:- 401, Baban Villa, Sno-6/17, Chovisawadi, Haveli Pune, Pimpri Chinchwad (M Corp.) 412105\nGmail : amigoent6423@gmail.com\nMo No. 08605069145, 7499260854 9096975291',
  quoteTerms: 'Price :-Ex work Pune .\nPacking :- Charges 2%\nDuties Taxes :- GST @ 18% extra\nPayment Terms :- 30% Advance with PO and 70% Against PI readiness of material\nDelivery :- 2-3weeks\nFreight :- To Pay Basis\nValidity :- This offer is valid for 15 days from date of quotation.\nService engineer and workers Loading & boarding is in customer scope.',
  quoteSign: 'Kuldeep Ranbawale\n08605069145\nAmigo Enterprises,Pune\nkuldeep.amigo@gmail.com', poPayment: '100% Against PI', quotePrefix: 'AE/', piPrefix: 'AEPI-', poPrefix: 'AE/',
  groqApiKey: '', groqModel: 'openai/gpt-oss-120b' };
const company = () => ({
  ...COMPANY_DEFAULTS,
  ...(db.isDbActive() ? db.getCachedSetting('company') : (fs.existsSync(path.join(DATA, 'company.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'company.json'), 'utf8')) : {}))
});

// ---- AI Integration ----
const WORKING_AI_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

function fetchGroqModels(apiKey) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error('AI API key required'));
    const req = https.request('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && Array.isArray(json.data)) {
            const excluded = ['whisper', 'guard', 'safeguard', 'embed', 'vision', 'canopy', 'orpheus', 'allam', 'gemma', 'deepseek'];
            const chatModels = json.data
              .filter(m => m.active !== false)
              .map(m => m.id)
              .filter(id => {
                const lower = id.toLowerCase();
                return !excluded.some(kw => lower.includes(kw));
              })
              .sort((a, b) => {
                const p = m => m.includes('120b') ? 1 : m.includes('20b') ? 2 : m.includes('qwen') ? 3 : 4;
                return p(a) - p(b);
              });
            resolve(chatModels.length ? chatModels : WORKING_AI_MODELS);
          } else {
            const msg = json.error?.message || `AI API error (${res.statusCode})`;
            reject(new Error(msg));
          }
        } catch (e) {
          reject(new Error('Invalid response from AI service'));
        }
      });
    });
    req.on('error', err => reject(new Error('Connection to AI service failed: ' + err.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('AI request timed out')); });
    req.end();
  });
}

function callGroqOnce({ apiKey, model, messages, temperature = 0.2 }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error('AI API key not configured. Please add it in AI Settings.'));
    let activeModel = model || 'openai/gpt-oss-120b';
    const lower = activeModel.toLowerCase();
    if (lower.includes('canopy') || lower.includes('orpheus') || lower.includes('gemma') || lower.includes('deepseek') || lower.includes('llama-3.3') || lower.includes('llama-3.1')) {
      activeModel = 'openai/gpt-oss-120b';
    }
    const payload = JSON.stringify({
      model: activeModel,
      messages,
      temperature,
      max_tokens: 2500
    });
    const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 35000
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const choice = json.choices?.[0];
            let content = choice?.message?.content || '';
            if (!content && choice?.message?.reasoning) content = choice.message.reasoning;
            content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            if (!content) return reject(new Error('AI returned an empty response. Please try again.'));
            resolve(content);
          } else {
            const msg = json.error?.message || `AI service error (status ${res.statusCode})`;
            reject(new Error(msg));
          }
        } catch (e) {
          reject(new Error('Invalid response from AI API'));
        }
      });
    });
    req.on('error', err => reject(new Error('Connection to AI service failed: ' + err.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('AI request timed out')); });
    req.write(payload);
    req.end();
  });
}

async function callGroq({ apiKey, model, messages, temperature = 0.2 }) {
  const modelsToTry = [
    model,
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b'
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  let lastError = null;
  for (const m of modelsToTry) {
    try {
      return await callGroqOnce({ apiKey, model: m, messages, temperature });
    } catch (err) {
      lastError = err;
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('does not exist') || msg.includes('decommissioned') || msg.includes('terms') || msg.includes('access')) {
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('Unable to connect to AI service');
}

async function transformWithGroq({ apiKey, model, text, action, context }) {
  const systemPrompt = `You are an expert AI assistant for an industrial accounting, engineering, and manufacturing business in Maharashtra, India.
Your role is to assist with daily employee work updates, email drafting, proforma invoices (PI), purchase orders (PO), quotation terms, and commercial notes.
CRITICAL RULES:
1. Preserve all factual data: numbers, dates, part codes, model names, quantities, and monetary values must NEVER be altered or invented.
2. When asked to "Make Professional", fix grammar, spelling, punctuation, and enhance tone to crisp corporate/business standard.
3. When translating to Marathi (मराठी), use natural, respectful, professional official Marathi (कार्यालयीन व व्यावसायिक मराठी). Preserve technical terms where appropriate (e.g. Wiring, Sensor, Calibration, Motor, PI, PO, GST).
4. When translating to Hindi (हिंदी), use clear, professional, respectful business Hindi (कार्यालयीन व व्यावसायिक हिंदी).
5. When translating to English, translate smoothly and formally from Marathi, Hindi, or conversational Hinglish into proper business English.
6. When structuring work updates or bullets, present clear, concise bullet points suitable for management review.
7. Return ONLY the final polished or translated text. Do NOT add preamble like "Here is your text:", conversational pleasantries, explanations, or enclosing markdown quotes.`;

  let userPrompt = '';
  switch (action) {
    case 'to_marathi':
      userPrompt = `Translate and adapt the following ${context || 'text'} into professional official Marathi (मराठी):\n\n${text}`;
      break;
    case 'to_hindi':
      userPrompt = `Translate and adapt the following ${context || 'text'} into professional official Hindi (हिंदी):\n\n${text}`;
      break;
    case 'to_english':
      userPrompt = `Translate the following ${context || 'text'} from Marathi/Hindi/Hinglish into clear, professional business English:\n\n${text}`;
      break;
    case 'bullets':
    case 'shorten':
      userPrompt = `Summarize and structure the following ${context || 'text'} into crisp, clear professional bullet points:\n\n${text}`;
      break;
    case 'subject':
      userPrompt = `Generate a single crisp, formal, professional email subject line for:\n\n${text}`;
      break;
    case 'terms':
      userPrompt = `Refine and format the following commercial terms & conditions into numbered, legally sound business clauses:\n\n${text}`;
      break;
    case 'polish':
    default:
      userPrompt = `Enhance and polish the following ${context || 'text'} into professional business language:\n\n${text}`;
      break;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  return await callGroq({ apiKey, model, messages, temperature: 0.2 });
}
// ---------- Setup ----------
function init() {
  if (IS_SERVERLESS || db.isDbActive()) return;
  try {
    fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(BAK, { recursive: true });
    for (const t in SCHEMA) {
      if (!fs.existsSync(file(t))) {
        fs.writeFileSync(file(t), SCHEMA[t].join(',') + '\n');
      } else {
        const rows = parseCSV(fs.readFileSync(file(t), 'utf8').replace(/^\uFEFF/, ''));
        if (rows.length && rows[0].join(',') !== SCHEMA[t].join(',')) {
          const head = rows[0], dataRows = rows.slice(1);
          const mapped = dataRows.map(r => Object.fromEntries(SCHEMA[t].map(k => [k, r[head.indexOf(k)] ?? ''])));
          writeTable(t, mapped);
        }
      }
    }
    const cf = path.join(DATA, 'company.json');
    if (!fs.existsSync(cf)) {
      fs.writeFileSync(cf, JSON.stringify(COMPANY_DEFAULTS, null, 2));
    } else {
      try {
        const cur = JSON.parse(fs.readFileSync(cf, 'utf8'));
        const bad = ['canopy', 'orpheus', 'gemma', 'deepseek', 'llama-3.3', 'llama-3.1'];
        if (!cur.groqModel || bad.some(b => (cur.groqModel || '').toLowerCase().includes(b))) {
          cur.groqModel = 'openai/gpt-oss-120b';
          fs.writeFileSync(cf, JSON.stringify(cur, null, 2));
        }
      } catch {}
    }
    const mf = path.join(DATA, 'mail.json'); if (!fs.existsSync(mf)) fs.writeFileSync(mf, JSON.stringify(MAIL_DEFAULTS, null, 2));
    const existing = readTable('users');
    if (!existing.some(u => u.role === 'admin')) {
      const name = existing.some(u => u.username.toLowerCase() === 'admin') ? 'admin2' : 'admin';
      writeTable('users', existing.concat({ id: newId(), username: name, password: hash('Admin@123'), role: 'admin', createdAt: new Date().toISOString() }));
      console.log(`\n  No admin account found: created user "${name}" with password "Admin@123" -> CHANGE IT after logging in.\n`);
    }
    const exLedgers = readTable('ledgers');
    if (!exLedgers.length) {
      const defaultLedgers = [
        { name: 'Cash', group: 'Cash-in-Hand', openingBalance: '0', balanceType: 'Dr' },
        { name: 'Bank Account', group: 'Bank Accounts', openingBalance: '0', balanceType: 'Dr' },
        { name: 'Sales Account', group: 'Sales Accounts', openingBalance: '0', balanceType: 'Cr' },
        { name: 'Purchase Account', group: 'Purchase Accounts', openingBalance: '0', balanceType: 'Dr' },
        { name: 'Capital Account', group: 'Capital Account', openingBalance: '0', balanceType: 'Cr' },
        { name: 'Sundry Debtors', group: 'Sundry Debtors', openingBalance: '0', balanceType: 'Dr' },
        { name: 'Sundry Creditors', group: 'Sundry Creditors', openingBalance: '0', balanceType: 'Cr' },
        { name: 'CGST (Duties & Taxes)', group: 'Duties & Taxes', openingBalance: '0', balanceType: 'Cr' },
        { name: 'SGST (Duties & Taxes)', group: 'Duties & Taxes', openingBalance: '0', balanceType: 'Cr' },
        { name: 'IGST (Duties & Taxes)', group: 'Duties & Taxes', openingBalance: '0', balanceType: 'Cr' },
        { name: 'Freight & Site Work Expenses', group: 'Direct Expenses', openingBalance: '0', balanceType: 'Dr' },
        { name: 'Office Rent & Utilities', group: 'Indirect Expenses', openingBalance: '0', balanceType: 'Dr' },
        { name: 'Staff Salaries', group: 'Indirect Expenses', openingBalance: '0', balanceType: 'Dr' }
      ];
      writeTable('ledgers', defaultLedgers.map(l => ({
        id: newId(),
        name: l.name,
        group: l.group,
        openingBalance: l.openingBalance,
        balanceType: l.balanceType,
        contact: '',
        phone: '',
        gstin: '',
        address: '',
        createdBy: 'system',
        createdAt: new Date().toISOString()
      })));
    }
    const dir = path.join(BAK, new Date().toISOString().slice(0, 10)); fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(DATA, dir, { recursive: true });
  } catch (err) {
    console.warn('Init skipped:', err.message);
  }
}

// ---------- Zip Archiver & Extractor (Pure Node.js built-ins) ----------
function createZip(fileMap) {
  const localHeaders = [], centralHeaders = [];
  let offset = 0;
  for (const [name, content] of Object.entries(fileMap)) {
    const rawData = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = zlib.crc32(rawData);
    const compressed = zlib.deflateRawSync(rawData);
    const nameBuf = Buffer.from(name, 'utf8');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18); lh.writeUInt32LE(rawData.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    localHeaders.push(lh, nameBuf, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20); cd.writeUInt32LE(rawData.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    centralHeaders.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + compressed.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const b of centralHeaders) cdSize += b.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(fileMap).length, 8); eocd.writeUInt16LE(Object.keys(fileMap).length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16); eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

function extractZip(buf) {
  const files = {};
  let eocdIdx = buf.length - 22;
  while (eocdIdx >= 0) {
    if (buf.readUInt32LE(eocdIdx) === 0x06054b50) break;
    eocdIdx--;
  }

  if (eocdIdx >= 0) {
    const totalEntries = buf.readUInt16LE(eocdIdx + 10);
    const cdOffset = buf.readUInt32LE(eocdIdx + 16);
    let cdIdx = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (cdIdx >= buf.length || buf.readUInt32LE(cdIdx) !== 0x02014b50) break;
      const compMethod = buf.readUInt16LE(cdIdx + 10);
      const compSize = buf.readUInt32LE(cdIdx + 20);
      const nameLen = buf.readUInt16LE(cdIdx + 28);
      const extraLen = buf.readUInt16LE(cdIdx + 30);
      const commentLen = buf.readUInt16LE(cdIdx + 32);
      const localOffset = buf.readUInt32LE(cdIdx + 42);
      const name = buf.toString('utf8', cdIdx + 46, cdIdx + 46 + nameLen);

      const lhExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + nameLen + lhExtraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      if (compMethod === 8) files[name] = zlib.inflateRawSync(compData).toString('utf8');
      else if (compMethod === 0) files[name] = compData.toString('utf8');
      cdIdx += 46 + nameLen + extraLen + commentLen;
    }
  } else {
    let idx = 0;
    while (idx < buf.length - 30) {
      if (buf.readUInt32LE(idx) !== 0x04034b50) break;
      const compMethod = buf.readUInt16LE(idx + 8);
      const compSize = buf.readUInt32LE(idx + 18);
      const nameLen = buf.readUInt16LE(idx + 26);
      const extraLen = buf.readUInt16LE(idx + 28);
      const name = buf.toString('utf8', idx + 30, idx + 30 + nameLen);
      const dataStart = idx + 30 + nameLen + extraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      if (compMethod === 8) files[name] = zlib.inflateRawSync(compData).toString('utf8');
      else if (compMethod === 0) files[name] = compData.toString('utf8');
      idx = dataStart + compSize;
    }
  }
  return files;
}

// ---------- HTTP helpers ----------
const send = (res, code, obj) => {
  const cookieHeader = res.getHeader('Set-Cookie');
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  if (cookieHeader) headers['Set-Cookie'] = cookieHeader;
  res.writeHead(code, headers);
  res.end(JSON.stringify(obj));
};
const fail = (code, msg) => Object.assign(new Error(msg), { code });
const body = req => new Promise((ok, no) => { let d = ''; req.on('data', c => { d += c; if (d.length > 50e6) { req.destroy(); no(fail(413, 'Too large')); } }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { no(fail(400, 'Bad JSON')); } }); });
const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const clean = (o, t) => {
  const x = {};
  for (const k of SCHEMA[t]) {
    if (o[k] !== undefined && !['id','createdAt','createdBy'].includes(k)) {
      if (k === 'permissions') {
        x[k] = typeof o[k] === 'object' && o[k] !== null
          ? o[k]
          : (typeof o[k] === 'string' ? (() => { try { return JSON.parse(o[k] || '{}'); } catch { return {}; } })() : {});
      } else {
        x[k] = String(o[k]).trim().slice(0, 500);
      }
    }
  }
  return x;
};

const DEFAULT_EMPLOYEE_PERMISSIONS = {
  invoices:  { view: true, create: true, edit: true, delete: false, mail: true },
  quotation: { view: true, create: true, edit: true, delete: false, mail: true },
  pi:        { view: true, create: true, edit: true, delete: false, mail: true },
  po:        { view: true, create: true, edit: true, delete: false, mail: true },
  sheets:    { view: true, create: true, edit: true, delete: false, mail: false },
  clients:   { view: true, create: true, edit: true, delete: false },
  products:  { view: true, create: true, edit: true, delete: false },
  purchases: { view: false, create: false, edit: false, delete: false },
  ledgers:   { view: true, create: true, edit: true, delete: false },
  vouchers:  { view: true, create: true, edit: true, delete: false }
};

function hasPermission(user, mod, action) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (mod === 'taxinvoice' || mod === 'invoice') mod = 'invoices';
  if (mod === 'docs') mod = 'quotation';
  const userPerms = (user.permissions && typeof user.permissions === 'object' && Object.keys(user.permissions).length > 0)
    ? user.permissions
    : DEFAULT_EMPLOYEE_PERMISSIONS;
  const modPerms = userPerms[mod] || DEFAULT_EMPLOYEE_PERMISSIONS[mod] || {};
  return !!modPerms[action];
}

// ---------- API ----------
async function api(req, res, parts) {
  const [a, id, sub] = parts, m = req.method;
  if (a === 'reset' && m === 'POST' && (id === 'request' || id === 'confirm')) { // admin password reset by emailed code
    const b = await body(req), key = String(b.username || '').trim().toLowerCase(), now = Date.now(), ip = req.socket.remoteAddress;
    const rl = resetIp.get(ip) || { n: 0, t: now }; if (now - rl.t > 15 * 60e3) { rl.n = 0; rl.t = now; } if (++rl.n > 10) throw fail(429, 'Too many requests. Try again in a few minutes.'); resetIp.set(ip, rl);
    if (id === 'request') {
      const c = mailCfg(); if (!c.smtpUser || !c.smtpPass) throw fail(503, 'Email is not set up on this app, so a reset code cannot be sent.');
      const generic = { ok: true, message: 'If this is an admin account with an email address on file, a reset code has been sent to it.' };
      const u = readTable('users').find(x => x.username.toLowerCase() === key);
      if (!u || u.role !== 'admin' || !u.email) return send(res, 200, generic); // same answer for every other case: no account probing
      let r = resets.get(key); if (!r || now - r.win > 30 * 60e3) r = { win: now, sends: 0 };
      if (now - (r.last || 0) < 60e3 || r.sends >= 4) return send(res, 200, generic);
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), salt = crypto.randomBytes(8).toString('hex');
      resets.set(key, { ...r, id: u.id, salt, h: otpHash(code, salt), exp: now + 10 * 60e3, tries: 0, last: now, sends: r.sends + 1 });
      try { await smtpSend(c, { to: u.email, subject: 'Your password reset code', html: resetHtml(code), images: mailImages(), text: `Your admin password reset code is ${code}\n\nIt is valid for 10 minutes. If you did not ask for this, ignore this email.` }); }
      catch (e) { console.error('Reset email failed:', e.message); }
      return send(res, 200, generic);
    }
    const pw = String(b.newPassword || ''), r = resets.get(key);
    if (pw.length < 8) throw fail(400, 'New password must be at least 8 characters');
    if (!r || r.exp < now) throw fail(400, 'Invalid or expired code. Request a new one.');
    const code = String(b.code || '').replace(/\D/g, '');
    if (code.length !== 6 || !crypto.timingSafeEqual(Buffer.from(r.h), Buffer.from(otpHash(code, r.salt)))) {
      if (++r.tries >= 5) { resets.delete(key); throw fail(429, 'Too many wrong codes. Request a new code.'); }
      throw fail(400, 'Wrong code. Try again.');
    }
    const u = await locked(() => { const L = readTable('users'), x = L.find(y => y.id === r.id); if (!x || x.role !== 'admin') return null; x.password = hash(pw); writeTable('users', L); return x; });
    if (!u) throw fail(400, 'Invalid or expired code. Request a new one.');
    resets.delete(key);
    for (const [sid, ss] of sessions) if (ss.user.id === u.id) sessions.delete(sid); // sign out everywhere
    for (const [k, v] of pending) if (v.id === u.id) pending.delete(k);
    smtpSend(mailCfg(), { to: u.email, subject: 'Your password was changed', html: pwChangedHtml(), images: mailImages(), text: 'The admin password was just changed. If this was not you, contact the person who manages this PC right away.' }).catch(e => console.error('Notice email failed:', e.message));
    return send(res, 200, { ok: true });
  }
  if (a === 'login' && !id && m === 'POST') {
    const ip = req.socket.remoteAddress, at = attempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - at.t > 15 * 60e3) { at.n = 0; at.t = Date.now(); }
    if (at.n >= 8) throw fail(429, 'Too many attempts. Try again in 15 minutes.');
    const b = await body(req), u = readTable('users').find(x => x.username.toLowerCase() === String(b.username || '').toLowerCase());
    if (!u || !verify(b.password || '', u.password)) { at.n++; attempts.set(ip, at); throw fail(401, 'Invalid username or password'); }
    attempts.delete(ip);
    for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
    // Second step: Face check for employees, or Emailed OTP for Employees & Admin
    const c = mailCfg(), faceOn = needsFace(u), otpOn = needsOtp(u);
    const faceOk = faceOn && !!u.faceDescriptor, otpOk = otpOn && !!u.email && !!c.smtpUser && !!c.smtpPass;
    if (faceOn || otpOn) {
      if (!faceOk && !otpOk) {
        if (u.role === 'admin') return send(res, 200, startSession(res, u)); // fallback if admin has no email/smtp configured
        throw fail(403, 'Cannot verify you: ' + [faceOn && 'your face is not enrolled (no profile photo)', otpOn && (u.email ? 'email codes are not set up' : 'no email address on your account')].filter(Boolean).join(' and ') + '. Ask the admin to fix it.');
      }
      const methods = [faceOk && 'face', otpOk && 'otp'].filter(Boolean), token = crypto.randomBytes(24).toString('hex'), p = { id: u.id, exp: Date.now() + 120e3, tries: 0, methods };
      pending.set(token, p);
      if (methods.length === 2) return send(res, 200, { needChoice: true, token, methods, email: maskEmail(u.email) });
      if (methods[0] === 'face') return send(res, 200, { needFace: true, token });
      const err = await sendOtp(p, u); return send(res, 200, { needOtp: true, token, email: maskEmail(u.email), sent: !err, error: err });
    }
    return send(res, 200, startSession(res, u));
  }
  if (a === 'login' && id === 'face' && m === 'POST') {
    const b = await body(req), p = pending.get(b.token);
    if (!p || p.exp < Date.now() || !p.methods.includes('face')) { pending.delete(b.token); throw fail(401, 'Login expired. Enter your password again.'); }
    const u = readTable('users').find(x => x.id === p.id), d = Array.isArray(b.descriptor) ? b.descriptor.map(Number) : [];
    if (!u || d.length !== 128 || d.some(x => !isFinite(x))) throw fail(400, 'Invalid face data');
    if (dist(d, JSON.parse(u.faceDescriptor)) > FACE_THRESHOLD) {
      if (++p.tries >= 5) { pending.delete(b.token); throw fail(429, 'Too many failed face attempts. Log in again.'); }
      throw fail(401, 'Face not recognised');
    }
    pending.delete(b.token);
    return send(res, 200, startSession(res, u));
  }
  if (a === 'login' && id === 'otp' && m === 'POST') {
    const b = await body(req), p = pending.get(b.token), now = Date.now();
    if (!p || p.exp < now || !p.methods.includes('otp')) { pending.delete(b.token); throw fail(401, 'Login expired. Enter your password again.'); }
    const u = readTable('users').find(x => x.id === p.id); if (!u) throw fail(401, 'Login expired. Enter your password again.');
    if (sub === 'send' || sub === 'resend') { const err = await sendOtp(p, u); return send(res, 200, { sent: !err, error: err, email: maskEmail(u.email) }); }
    if (!p.otp) throw fail(400, 'Ask for a code first.');
    if (p.otp.exp < now) throw fail(401, 'The code has expired. Ask for a new one.');
    const code = String(b.code || '').replace(/\D/g, ''), good = Buffer.from(p.otp.h), got = Buffer.from(otpHash(code, p.otp.salt));
    if (code.length !== 6 || !crypto.timingSafeEqual(good, got)) {
      if (++p.otp.tries >= 5) { pending.delete(b.token); throw fail(429, 'Too many wrong codes. Log in again.'); }
      throw fail(401, 'Wrong code. Try again.');
    }
    pending.delete(b.token);
    return send(res, 200, startSession(res, u));
  }
  const s = session(req); if (!s) throw fail(401, 'Please log in');
  const user = s.user;
  if (a === 'logout' && m === 'POST') { sessions.delete(cookie(req).sid); res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/'); return send(res, 200, {}); }
  if (a === 'me') return send(res, 200, user);
  if (a === 'counts' && m === 'GET') {
    const clients = readTable('clients').length;
    const products = readTable('products').length;
    const invoices = readTable('invoices').length;
    const purchases = readTable('purchases').length;
    const users = readTable('users').length;
    const docs = readTable('docs');
    const quotation = docs.filter(x => x.type === 'quotation').length;
    const pi = docs.filter(x => x.type === 'pi').length;
    const po = docs.filter(x => x.type === 'po').length;
    const sheets = readTable('sheets').length;
    const vouchers = readTable('vouchers').length;
    const ledgers = readTable('ledgers').length;
    return send(res, 200, { clients, products, invoices, purchases, users, quotation, pi, po, sheets, vouchers, ledgers });
  }
  if (a === 'photo' && m === 'GET') {
    if (!/^[a-f0-9]+$/.test(id || '')) throw fail(404, 'Not found');
    const f = path.join(PHOTOS, id + '.jpg'); if (!fs.existsSync(f)) throw fail(404, 'Not found');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=60' }); return fs.createReadStream(f).pipe(res);
  }
  if (a === 'password' && m === 'POST') {
    const b = await body(req); if (String(b.newPassword || '').length < 8) throw fail(400, 'New password must be at least 8 characters');
    await locked(() => { const L = readTable('users'), u = L.find(x => x.id === user.id); if (!verify(b.oldPassword || '', u.password)) throw fail(400, 'Current password is wrong'); u.password = hash(b.newPassword); writeTable('users', L); });
    return send(res, 200, {});
  }
  if (a === 'company') {
    const cf = path.join(DATA, 'company.json');
    if (m === 'GET') return send(res, 200, company());
    if (m === 'PUT') { if (user.role !== 'admin') throw fail(403, 'Admin only'); const b = await body(req), o = {}; for (const k of Object.keys(COMPANY_DEFAULTS)) if (k !== 'stamp') o[k] = String(b[k] ?? '').slice(0, 3000);
      o.stamp = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(b.stamp || '') && b.stamp.length < 600000 ? b.stamp : ''; await locked(() => fs.writeFileSync(cf, JSON.stringify(o, null, 2))); return send(res, 200, o); }
  }
  if (a === 'ai') {
    const co = company();
    const apiKey = (co.groqApiKey || '').trim();
    const model = co.groqModel || 'openai/gpt-oss-120b';

    if (id === 'models' && m === 'POST') {
      const b = await body(req);
      const keyToUse = (b.apiKey || apiKey || '').trim();
      if (!keyToUse) throw fail(400, 'Please enter an AI API key first');
      try {
        const models = await fetchGroqModels(keyToUse);
        return send(res, 200, { ok: true, models });
      } catch (err) {
        throw fail(400, err.message);
      }
    }

    if (id === 'test' && m === 'POST') {
      const b = await body(req);
      const keyToTest = (b.apiKey || apiKey || '').trim();
      if (!keyToTest) throw fail(400, 'Please enter an AI API key first');

      let availableModels = [];
      try {
        availableModels = await fetchGroqModels(keyToTest);
      } catch (e) {
        availableModels = WORKING_AI_MODELS;
      }

      let targetModel = b.model || model;
      if (!availableModels.includes(targetModel)) {
        targetModel = availableModels[0] || 'openai/gpt-oss-120b';
      }

      try {
        await callGroq({
          apiKey: keyToTest,
          model: targetModel,
          messages: [{ role: 'user', content: 'Say OK' }],
          temperature: 0.1
        });
        return send(res, 200, {
          ok: true,
          message: `Connected successfully! Active model: ${targetModel}`,
          model: targetModel,
          availableModels
        });
      } catch (err) {
        throw fail(400, err.message);
      }
    }

    if (id === 'transform' && m === 'POST') {
      if (!apiKey) throw fail(400, 'AI API Key is not configured. Please add your key in AI Settings.');
      const b = await body(req);
      const text = String(b.text || '').trim();
      if (!text) throw fail(400, 'Please enter some text first');
      const action = String(b.action || 'polish');
      const context = String(b.context || 'text');

      try {
        const result = await transformWithGroq({ apiKey, model, text, action, context });
        return send(res, 200, { ok: true, result });
      } catch (err) {
        throw fail(500, err.message);
      }
    }
  }
  if (a === 'sync') {
    if (m === 'GET' && id === 'live') {
      return send(res, 200, { revisions: db.getRevisions(), serverTime: Date.now() });
    }
    const syncFile = path.join(DATA, 'sync.json');
    const readSyncMeta = () => {
      try { return JSON.parse(fs.readFileSync(syncFile, 'utf8')); }
      catch { return { lastSyncAt: '', syncedBy: '', lastEmailedAt: '', emailedBy: '', history: [] }; }
    };
    const writeSyncMeta = meta => {
      try { fs.writeFileSync(syncFile, JSON.stringify(meta, null, 2)); } catch {}
    };

    if (m === 'GET' && (id === 'status' || !id)) {
      const meta = readSyncMeta();
      const isSunday = new Date().getDay() === 0;
      return send(res, 200, { ...meta, isSunday });
    }

    if (m === 'GET' && id === 'export') {
      const fileMap = {};
      for (const t in SCHEMA) {
        if (fs.existsSync(file(t))) {
          fileMap[t + '.csv'] = fs.readFileSync(file(t), 'utf8');
        }
      }
      const cf = path.join(DATA, 'company.json');
      if (fs.existsSync(cf)) fileMap['company.json'] = fs.readFileSync(cf, 'utf8');

      const zipBuf = createZip(fileMap);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="data_${user.username}_${ldate()}.zip"`,
        'Content-Length': zipBuf.length
      });
      return res.end(zipBuf);
    }

    if (m === 'POST' && id === 'email') {
      const c = mailCfg();
      if (!c.smtpUser || !c.smtpPass || !c.mailTo) {
        throw fail(400, 'Company recipient email is not configured. Please set it in Email & Alerts first.');
      }
      const fileMap = {};
      for (const t in SCHEMA) {
        if (fs.existsSync(file(t))) {
          fileMap[t + '.csv'] = fs.readFileSync(file(t), 'utf8');
        }
      }
      const cf = path.join(DATA, 'company.json');
      if (fs.existsSync(cf)) fileMap['company.json'] = fs.readFileSync(cf, 'utf8');

      const zipBuf = createZip(fileMap);
      const senderName = user.fullName || user.username;
      const todayStr = ldate();

      const sub = `Weekly data.zip Backup & Sync [${senderName}] - ${dmy(todayStr)}`;
      const text = `Weekly accounts backup (data.zip) submitted by ${senderName} (${user.username}) on ${new Date().toLocaleString('en-IN')}.\nSystem Date: ${dmy(todayStr)}\n\nPlease download the attached data.zip and use "Data Sync & Backup" in the Admin panel to merge into the central database.`;
      const html = emailHtml({
        title: `Weekly Data Sync & Backup`,
        preheader: `Weekly data.zip from ${senderName}`,
        body: `
          <tr>
            <td style="padding:24px 28px">
              <h2 style="margin:0 0 12px;color:#0b4f8a">📦 Weekly Data Backup (data.zip)</h2>
              <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6">
                This is the automated weekly consolidation backup sent by <b>${hx(senderName)}</b> (User: <code>${hx(user.username)}</code>, Role: <b>${hx(user.role)}</b>) on <b>${hx(new Date().toLocaleString('en-IN'))}</b>.
              </p>
              <div style="background:#f1f5f9;border-left:4px solid #0b6fc4;padding:12px 16px;border-radius:6px;font-size:13px;color:#1e293b;margin-bottom:16px">
                <b>Attachment:</b> <code>data_${hx(user.username)}_${todayStr}.zip</code> (${(zipBuf.length / 1024).toFixed(1)} KB)<br>
                <b>Contents:</b> All accounting invoices, vouchers, ledgers, quotations, and manual entries from this PC.
              </div>
              <p style="margin:0;font-size:13px;color:#64748b">
                <b>Admin Instructions:</b> Download the attached zip file, log into your Admin account, go to <b>Administration &rarr; Data Sync &amp; Backup</b>, and click <b>Upload &amp; Merge data.zip</b> to consolidate all data.
              </p>
            </td>
          </tr>
        `
      });

      try {
        await smtpSend(c, {
          to: c.mailTo,
          subject: sub,
          text,
          html,
          images: mailImages(),
          attachments: [
            { name: `data_${user.username}_${todayStr}.zip`, type: 'application/zip', data: zipBuf }
          ]
        });
      } catch (e) {
        throw fail(502, 'Could not email data.zip: ' + e.message);
      }

      const meta = readSyncMeta();
      meta.lastEmailedAt = new Date().toISOString();
      meta.emailedBy = user.username;
      meta.emailedSize = zipBuf.length;
      meta.history = meta.history || [];
      meta.history.unshift({
        at: meta.lastEmailedAt,
        by: user.username,
        action: 'email',
        recipient: c.mailTo,
        size: zipBuf.length
      });
      if (meta.history.length > 25) meta.history = meta.history.slice(0, 25);
      writeSyncMeta(meta);

      return send(res, 200, { ok: true, recipient: c.mailTo, date: todayStr, size: zipBuf.length });
    }

    if (m === 'POST' && id === 'import') {
      if (user.role !== 'admin') throw fail(403, 'Admin only');
      const b = await body(req);
      if (!b.zip) throw fail(400, 'Please select a data.zip file to upload');

      let zipBuf;
      try { zipBuf = Buffer.from(b.zip, 'base64'); }
      catch { throw fail(400, 'Invalid zip data'); }

      let files = {};
      try { files = extractZip(zipBuf); }
      catch (e) { throw fail(400, 'Could not extract zip file: ' + e.message); }

      const fileKeys = Object.keys(files);
      if (!fileKeys.length) throw fail(400, 'The uploaded zip file is empty');

      const backupDir = path.join(BAK, `before_sync_${new Date().toISOString().replace(/[:.]/g, '-')}`);
      try {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.cpSync(DATA, backupDir, { recursive: true });
      } catch (e) { console.error('Pre-sync backup error:', e.message); }

      const stats = [];

      await locked(() => {
        for (const t in SCHEMA) {
          const zipFileName = t + '.csv';
          const matchedKey = fileKeys.find(k => k.toLowerCase() === zipFileName.toLowerCase() || k.toLowerCase().endsWith('/' + zipFileName.toLowerCase()));
          if (!matchedKey) continue;

          const csvRaw = files[matchedKey];
          const parsed = parseCSV(String(csvRaw).replace(/^\uFEFF/, ''));
          if (!parsed.length) continue;

          const uHead = parsed.shift() || SCHEMA[t];
          const uRows = parsed.map(r => Object.fromEntries(SCHEMA[t].map(k => [k, r[uHead.indexOf(k)] ?? ''])));

          const currentList = readTable(t);
          let added = 0, updated = 0;

          uRows.forEach(uRow => {
            if (!uRow || !Object.keys(uRow).length) return;
            let matchIdx = -1;

            if (t === 'users') {
              matchIdx = currentList.findIndex(x => (uRow.id && x.id === uRow.id) || (uRow.username && x.username.toLowerCase() === uRow.username.toLowerCase()));
              if (matchIdx >= 0) {
                const keepPw = !uRow.password && currentList[matchIdx].password;
                Object.assign(currentList[matchIdx], uRow);
                if (keepPw) currentList[matchIdx].password = keepPw;
                updated++;
                return;
              }
            } else if (t === 'invoices' || t === 'docs') {
              matchIdx = currentList.findIndex(x => (uRow.id && x.id === uRow.id) || (uRow.number && x.number === uRow.number));
            } else if (t === 'vouchers') {
              matchIdx = currentList.findIndex(x => (uRow.id && x.id === uRow.id) || (uRow.voucherNo && x.voucherNo === uRow.voucherNo));
            } else if (t === 'ledgers') {
              matchIdx = currentList.findIndex(x => (uRow.id && x.id === uRow.id) || (uRow.name && x.name.toLowerCase() === uRow.name.toLowerCase()));
            } else if (t === 'clients') {
              matchIdx = currentList.findIndex(x => (uRow.id && x.id === uRow.id) || (uRow.gstin && uRow.gstin.length > 5 && x.gstin === uRow.gstin) || (uRow.name && x.name.toLowerCase() === uRow.name.toLowerCase()));
            } else if (t === 'products') {
              matchIdx = currentList.findIndex(x => (uRow.id && x.id === uRow.id) || (uRow.name && x.name.toLowerCase() === uRow.name.toLowerCase()));
            } else {
              matchIdx = currentList.findIndex(x => uRow.id && x.id === uRow.id);
            }

            if (matchIdx >= 0) {
              Object.assign(currentList[matchIdx], uRow);
              updated++;
            } else {
              currentList.push(uRow);
              added++;
            }
          });

          writeTable(t, currentList);
          stats.push({ table: t, added, updated, total: currentList.length });
        }
      });

      const meta = readSyncMeta();
      meta.lastSyncAt = new Date().toISOString();
      meta.syncedBy = user.username;
      meta.history = meta.history || [];
      meta.history.unshift({
        at: meta.lastSyncAt,
        by: user.username,
        action: 'import',
        stats
      });
      if (meta.history.length > 20) meta.history = meta.history.slice(0, 20);
      writeSyncMeta(meta);

      return send(res, 200, { ok: true, stats, message: 'All tables synced and duplicates overridden successfully' });
    }

    throw fail(404, 'Not found');
  }

  if (a === 'support') {
    if (m === 'POST' && id === 'report') {
      const b = await body(req);
      const title = String(b.title || '').trim().slice(0, 200);
      const description = String(b.description || '').trim().slice(0, 5000);
      const page = String(b.page || '').trim().slice(0, 100);
      const clientLogs = String(b.clientLogs || '').trim().slice(0, 5000);
      const screenshotData = String(b.screenshot || '').trim();
      const includeServerLog = b.includeServerLog !== false;

      if (!title) throw fail(400, 'Please enter a brief summary or error title');
      if (!description && !screenshotData) throw fail(400, 'Please provide an issue description or attach a screenshot');

      const c = mailCfg();
      if (!c.smtpUser || !c.smtpPass) {
        throw fail(503, 'Email configuration is missing on this server. Please ask the administrator to configure SMTP in Email & Alerts.');
      }
      const targetEmail = c.supportEmail || c.mailTo || c.smtpUser;
      if (!targetEmail) {
        throw fail(503, 'Support recipient email is not configured in Email & Alerts.');
      }

      const reporterName = user.fullName || user.username;
      const nowStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const attachments = [];

      // 1. Process screenshot
      let screenshotInlineHtml = '';
      let screenshotBuffer = null;
      let mimeType = 'image/png';
      let fileName = `screenshot_${user.username}_${formatDateTimeStamp()}.png`;
      if (screenshotData && screenshotData.startsWith('data:image/')) {
        const match = screenshotData.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          screenshotBuffer = Buffer.from(match[2], 'base64');
          const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
          fileName = `screenshot_${user.username}_${formatDateTimeStamp()}.${ext}`;
          attachments.push({
            name: fileName,
            type: mimeType,
            data: screenshotBuffer
          });
          screenshotInlineHtml = `
            <tr>
              <td style="padding:14px 28px">
                <div style="font-size:12px;font-weight:700;color:#c1272d;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Error Screenshot</div>
                <div style="border:1px solid #cbd5e1;border-radius:8px;padding:8px;background:#f8fafc;text-align:center">
                  <img src="cid:bug-screenshot" alt="Error Screenshot" style="max-width:100%;height:auto;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.1);display:block;margin:0 auto">
                </div>
              </td>
            </tr>
          `;
        }
      }

      // 2. Attach server.log
      let serverLogText = '';
      if (includeServerLog) {
        serverLogText = getRecentServerLogs(400);
        attachments.push({
          name: `server_${formatDateTimeStamp()}.log`,
          type: 'text/plain; charset=utf-8',
          data: Buffer.from(serverLogText, 'utf8')
        });
      }

      // 3. Attach browser console errors if any
      if (clientLogs) {
        attachments.push({
          name: `browser_console_${formatDateTimeStamp()}.log`,
          type: 'text/plain; charset=utf-8',
          data: Buffer.from(clientLogs, 'utf8')
        });
      }

      // 4. Construct Subject & Body
      const sub = `[BUG REPORT] ${title} [${reporterName} / ${user.role.toUpperCase()}]`;
      const text = [
        `AMIGO ACCOUNTS BUG & SUPPORT REPORT`,
        `==================================`,
        `Reported By : ${reporterName} (${user.username})`,
        `User Role   : ${user.role.toUpperCase()}`,
        `Contact     : ${user.contact || user.email || 'N/A'}`,
        `Date & Time : ${nowStr}`,
        `Active Page : ${page || 'General'}`,
        ``,
        `SUMMARY:`,
        title,
        ``,
        `DETAILS / WHAT HAPPENED:`,
        description || '(No additional description provided)',
        ``,
        clientLogs ? `BROWSER CONSOLE ERRORS:\n${clientLogs}\n` : '',
        includeServerLog ? `SERVER LOG: Attached as server.log (${attachments.find(x => x.name.startsWith('server_')) ? 'Yes' : 'No'})\n` : '',
        screenshotBuffer ? `SCREENSHOT: Attached as ${fileName}\n` : ''
      ].filter(Boolean).join('\n');

      const html = emailHtml({
        title: `Bug Report: ${title}`,
        preheader: `Issue submitted by ${reporterName} (${user.role})`,
        body: `
          <tr>
            <td style="padding:24px 28px 12px">
              <div style="font-size:12px;font-weight:700;color:#c1272d;text-transform:uppercase;letter-spacing:.8px">System Issue &amp; Support Ticket</div>
              <h1 style="margin:6px 0 10px;font-size:22px;line-height:1.3;color:#1c2333">${hx(title)}</h1>
              <div style="font-size:13px;color:#5b6477">
                Reported by <b>${hx(reporterName)}</b> &nbsp;·&nbsp; Role: <b style="color:#0b4f8a">${hx(user.role.toUpperCase())}</b> &nbsp;·&nbsp; ${hx(nowStr)}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 16px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:8px;padding:12px 16px;font-size:13px;color:#334155">
                <tr>
                  <td style="padding:4px 0"><b>Active Module:</b> ${hx(page || 'General')}</td>
                  <td style="padding:4px 0" align="right"><b>User Contact:</b> ${hx(user.contact || user.email || '-')}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0" colspan="2"><b>Attachments:</b> ${attachments.map(a => `<code>${hx(a.name)}</code>`).join(', ') || 'None'}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 28px 16px">
              <div style="font-size:12px;font-weight:700;color:#0b4f8a;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Issue Description</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-left:4px solid #0b6fc4;background:#fafbfe;border-radius:6px;padding:14px 16px;font-size:14px;line-height:1.6;color:#1c2333;white-space:pre-wrap">${hx(description || '(No description provided)')}</td>
                </tr>
              </table>
            </td>
          </tr>
          ${screenshotInlineHtml}
          ${clientLogs ? `
          <tr>
            <td style="padding:6px 28px 16px">
              <div style="font-size:12px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Recent Browser Errors</div>
              <pre style="background:#0f172a;color:#f8fafc;padding:12px 14px;border-radius:6px;font-size:12px;overflow-x:auto;font-family:Consolas,monospace;margin:0;max-height:160px">${hx(clientLogs)}</pre>
            </td>
          </tr>` : ''}
          <tr>
            <td style="padding:0 28px 24px">
              <div style="font-size:12px;color:#64748b;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px">
                ℹ️ <b>Support Info:</b> The full <code>server.log</code> and diagnostic files are attached to this email. You can inspect the logs directly in your email client.
              </div>
            </td>
          </tr>
        `
      });

      const images = [...mailImages()];
      if (screenshotBuffer) {
        images.push({
          cid: 'bug-screenshot',
          type: mimeType,
          name: fileName,
          data: screenshotBuffer
        });
      }

      try {
        await smtpSend(c, {
          to: targetEmail,
          subject: sub,
          text,
          html,
          images,
          attachments
        });
        return send(res, 200, { ok: true, recipient: targetEmail });
      } catch (err) {
        console.error('Support email failed:', err.message);
        throw fail(500, `Failed to send bug report email: ${err.message}`);
      }
    }
    throw fail(404, 'Not found');
  }

  if (a === 'activity') {
    if (m === 'POST' && id === 'ping') {
      const b = await body(req);
      const today = ldate();
      const nowMs = Date.now();
      const data = readActivity();
      if (!data[today]) data[today] = {};
      if (!data[today][user.id]) {
        data[today][user.id] = {
          userId: user.id,
          username: user.username,
          fullName: user.fullName || '',
          loginTime: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          lastPingTime: nowMs,
          status: b.status || 'active',
          activeMinutes: 0,
          idleMinutes: 0,
          offlineAlertSent: false,
          actions: [],
          timeline: [{ t: ltime(new Date()), status: b.status || 'active', view: b.view || 'dash' }]
        };
      }
      const rec = data[today][user.id];
      const deltaSec = (nowMs - (rec.lastPingTime || nowMs)) / 1000;
      if (deltaSec >= 4 && deltaSec <= 150) {
        if (b.status === 'idle') {
          rec.idleMinutes = (rec.idleMinutes || 0) + (deltaSec / 60);
        } else {
          rec.activeMinutes = (rec.activeMinutes || 0) + (deltaSec / 60);
        }
      }
      rec.lastPingTime = nowMs;
      rec.lastSeenAt = new Date().toISOString();
      rec.status = b.status || 'active';
      rec.offlineAlertSent = false; // Reset alert streak once employee pings back

      rec.timeline = rec.timeline || [];
      const lastTl = rec.timeline[rec.timeline.length - 1];
      if (!lastTl || lastTl.status !== rec.status || (b.view && lastTl.view !== b.view)) {
        rec.timeline.push({ t: ltime(new Date()), status: rec.status, view: b.view || '' });
        if (rec.timeline.length > 250) rec.timeline = rec.timeline.slice(-250);
      }

      writeActivity(data);
      return send(res, 200, {
        ok: true,
        activeMinutes: Math.round(rec.activeMinutes || 0),
        idleMinutes: Math.round(rec.idleMinutes || 0)
      });
    }

    if (m === 'GET' && id === 'me') {
      const today = ldate();
      const data = readActivity();
      const rec = (data[today] && data[today][user.id]) || { activeMinutes: 0, idleMinutes: 0, status: 'active' };
      return send(res, 200, {
        activeMinutes: Math.round(rec.activeMinutes || 0),
        idleMinutes: Math.round(rec.idleMinutes || 0),
        status: rec.status || 'active',
        lastSeenAt: rec.lastSeenAt || null
      });
    }

    throw fail(404, 'Not found');
  }

  if (a === 'monitoring') {
    if (user.role !== 'admin') throw fail(403, 'Admin only');

    if (id === 'settings') {
      if (m === 'GET') {
        const cfg = monitoringCfg(), mCfg = mailCfg();
        return send(res, 200, {
          ...cfg,
          smtpConfigured: !!(mCfg.smtpUser && mCfg.smtpPass),
          systemRecipient: mCfg.mailTo || ''
        });
      }
      if (m === 'PUT') {
        const b = await body(req);
        const cur = monitoringCfg();
        if (b.workStartTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.workStartTime)) throw fail(400, 'Work start time must be HH:MM');
        if (b.workEndTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.workEndTime)) throw fail(400, 'Work end time must be HH:MM');
        if (b.lunchStartTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.lunchStartTime)) throw fail(400, 'Lunch start time must be HH:MM');
        if (b.lunchEndTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.lunchEndTime)) throw fail(400, 'Lunch end time must be HH:MM');
        if (b.offlineThresholdMins !== undefined) {
          const th = +b.offlineThresholdMins;
          if (isNaN(th) || th < 10 || th > 720) throw fail(400, 'Offline threshold must be between 10 and 720 minutes');
          cur.offlineThresholdMins = th;
        }
        if (b.enabled !== undefined) cur.enabled = b.enabled !== false && b.enabled !== 'false';
        if (Array.isArray(b.workDays)) cur.workDays = b.workDays;
        if (b.workStartTime) cur.workStartTime = b.workStartTime;
        if (b.workEndTime) cur.workEndTime = b.workEndTime;
        if (b.lunchStartTime) cur.lunchStartTime = b.lunchStartTime;
        if (b.lunchEndTime) cur.lunchEndTime = b.lunchEndTime;
        if (b.alertEmails !== undefined) cur.alertEmails = String(b.alertEmails || '').trim();
        if (Array.isArray(b.holidays)) {
          cur.holidays = b.holidays.map(h => ({
            id: String(h.id || newId()),
            date: String(h.date || '').slice(0, 10),
            name: String(h.name || '').slice(0, 100)
          })).filter(h => /^\d{4}-\d{2}-\d{2}$/.test(h.date) && h.name);
        }
        await locked(() => fs.writeFileSync(path.join(DATA, 'monitoring.json'), JSON.stringify(cur, null, 2)));
        return send(res, 200, cur);
      }
    }

    if (id === 'test-alert' && m === 'POST') {
      const cfg = monitoringCfg(), mCfg = mailCfg();
      const recipients = String(cfg.alertEmails || mCfg.mailTo || '').split(',').map(x => x.trim()).filter(x => EMAIL_RE.test(x));
      if (!recipients.length) throw fail(400, 'Please set a valid recipient email in Alert Recipients or in Email & Alerts settings.');
      if (!mCfg.smtpUser || !mCfg.smtpPass) throw fail(400, 'Company SMTP email is not configured. Please set the sender Gmail & App Password in Email & Alerts first.');

      const dummyEmp = { fullName: 'Demo Employee', username: 'demo_emp', contact: '9876543210' };
      const dummyActions = [
        { t: '10:15 AM', type: 'Invoice', desc: 'Created invoice #AETX-26-27/01 for ABC Corp (₹45,000)' },
        { t: '11:40 AM', type: 'Voucher', desc: 'Added Payment Voucher #PV-08 (₹12,500)' },
        { t: '12:20 PM', type: 'Document', desc: 'Created Quotation #AE/26-27/14' }
      ];
      const html = offlineAlertHtml({
        employee: dummyEmp,
        inactiveMins: 95,
        lastSeenAt: new Date(Date.now() - 95 * 60000),
        actions: dummyActions,
        date: ldate()
      });

      try {
        await smtpSend(mCfg, {
          to: recipients.join(', '),
          subject: '⚠️ [TEST] Offline Alert: Demo Employee offline for 1h 35m',
          html,
          images: mailImages(),
          text: 'This is a test notification from the Employee Productivity Monitoring system.'
        });
        return send(res, 200, { ok: true, recipient: recipients.join(', ') });
      } catch (e) {
        throw fail(502, 'Could not send test email: ' + e.message);
      }
    }

    if (id === 'summary' && m === 'GET') {
      const urlObj = new URL(req.url, 'http://x');
      const targetDate = urlObj.searchParams.get('date') || ldate();
      const cfg = monitoringCfg();
      const allUsers = readTable('users');
      const employees = allUsers.filter(u => u.role === 'employee');
      const data = readActivity();
      const dayData = data[targetDate] || {};
      const updates = readTable('workupdates').filter(w => w.date === targetDate);

      const now = new Date();
      const curHM = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      const isLunchNow = curHM >= (cfg.lunchStartTime || '13:00') && curHM < (cfg.lunchEndTime || '14:00');
      const isWorkHoursNow = curHM >= (cfg.workStartTime || '09:30') && curHM <= (cfg.workEndTime || '18:30');

      const list = employees.map(emp => {
        const rec = dayData[emp.id];
        const wu = updates.find(w => w.userId === emp.id || w.username === emp.username);

        let liveStatus = 'not_logged_in';
        let inactiveMins = 0;
        let lastSeenAt = null;

        if (rec) {
          lastSeenAt = rec.lastSeenAt || rec.loginTime;
          const diffMs = Date.now() - new Date(lastSeenAt).getTime();
          const diffMins = diffMs / 60000;

          if (targetDate === ldate()) {
            if (diffMins <= 2) {
              liveStatus = rec.status === 'idle' ? 'idle' : 'active';
            } else if (isLunchNow) {
              liveStatus = 'lunch';
            } else {
              liveStatus = 'offline';
            }
          } else {
            liveStatus = 'completed';
          }
          inactiveMins = getWorkingInactiveMinutes(new Date(lastSeenAt), now, cfg);
        }

        return {
          id: emp.id,
          username: emp.username,
          fullName: emp.fullName || '',
          designation: emp.designation || '',
          contact: emp.contact || '',
          email: emp.email || '',
          photo: !!emp.photo,
          loginTime: rec?.loginTime || null,
          lastSeenAt: rec?.lastSeenAt || null,
          activeMinutes: Math.round(rec?.activeMinutes || 0),
          idleMinutes: Math.round(rec?.idleMinutes || 0),
          workingInactiveMinutes: Math.round(inactiveMins),
          liveStatus,
          actionsCount: (rec?.actions || []).length,
          offlineAlertSent: !!rec?.offlineAlertSent,
          offlineAlertSentAt: rec?.offlineAlertSentAt || null,
          workUpdate: wu ? { work: wu.work, pending: wu.pending, hours: wu.hours, emailStatus: wu.emailStatus, submittedAt: wu.submittedAt } : null
        };
      });

      return send(res, 200, {
        date: targetDate,
        isToday: targetDate === ldate(),
        isLunchNow,
        isWorkHoursNow,
        settings: cfg,
        employees: list
      });
    }

    if (id === 'employee' && sub && m === 'GET') {
      const urlObj = new URL(req.url, 'http://x');
      const targetDate = urlObj.searchParams.get('date') || ldate();
      const allUsers = readTable('users');
      const emp = allUsers.find(u => u.id === sub && u.role === 'employee');
      if (!emp) throw fail(404, 'Employee not found');

      const data = readActivity();
      const rec = (data[targetDate] && data[targetDate][emp.id]) || null;
      const wu = readTable('workupdates').find(w => w.date === targetDate && (w.userId === emp.id || w.username === emp.username));

      return send(res, 200, {
        date: targetDate,
        employee: safeUser(emp),
        activity: rec,
        workUpdate: wu || null
      });
    }

    throw fail(404, 'Not found');
  }

  const t = a; if (!SCHEMA[t] && a !== 'mail') throw fail(404, 'Not found');
  if (a === 'mail') {
    const c = mailCfg();
    if (m === 'GET' && id === 'sender') {
      return send(res, 200, { smtpUser: c.smtpUser, configured: !!(c.smtpUser && c.smtpPass) });
    }
    if (m === 'POST' && id === 'send') {
      if (!c.smtpUser || !c.smtpPass) {
        throw fail(400, 'Company SMTP email is not configured. Please set the sender Gmail & App Password in Email & Alerts first.');
      }
      const b = await body(req);
      const docType = b.docType || 'invoices';
      if (!hasPermission(user, docType, 'mail')) {
        throw fail(403, 'Permission denied: Cannot send email for ' + docType);
      }
      const to = String(b.to || '').trim();
      const cc = String(b.cc || '').trim();
      const bcc = String(b.bcc || '').trim();
      const subject = String(b.subject || '').trim();
      const text = String(b.text || b.body || '').trim();
      let html = b.html || '';

      if (!to) throw fail(400, 'Recipient email ("To") is required');
      const toList = to.split(',').map(x => x.trim()).filter(Boolean);
      if (!toList.length || toList.some(x => !EMAIL_RE.test(x))) throw fail(400, 'Invalid email address in "To" field');
      const ccList = cc ? cc.split(',').map(x => x.trim()).filter(Boolean) : [];
      if (ccList.some(x => !EMAIL_RE.test(x))) throw fail(400, 'Invalid email address in "Cc" field');
      const bccList = bcc ? bcc.split(',').map(x => x.trim()).filter(Boolean) : [];
      if (bccList.some(x => !EMAIL_RE.test(x))) throw fail(400, 'Invalid email address in "Bcc" field');
      if (!subject) throw fail(400, 'Email Subject is required');

      if (!html) {
        const bodyContent = `<tr><td style="padding:28px 32px 30px"><h2 style="margin:0 0 16px;font-size:20px;color:#1c2333">${hx(subject)}</h2><div style="font-size:14px;line-height:1.7;color:#374151;white-space:pre-wrap">${hx(text)}</div></td></tr>`;
        html = emailHtml({ title: subject, preheader: subject, body: bodyContent });
      }

      const attachments = (b.attachments || []).map(att => {
        let buf;
        if (att.base64) {
          buf = Buffer.from(att.base64, 'base64');
        } else if (typeof att.data === 'string' && att.data.startsWith('data:')) {
          const b64 = att.data.split(',')[1] || '';
          buf = Buffer.from(b64, 'base64');
        } else if (typeof att.data === 'string') {
          buf = Buffer.from(att.data, 'utf8');
        } else {
          buf = Buffer.from('');
        }
        return {
          name: oneLine(att.name || 'document'),
          type: att.type || 'application/octet-stream',
          data: buf
        };
      });

      const co = company();
      const fromName = co.name || 'Accounts App';

      try {
        await smtpSend(c, {
          to,
          cc,
          bcc,
          subject,
          text,
          html,
          fromName,
          exactSubject: true,
          images: mailImages(),
          attachments
        });
        return send(res, 200, { ok: true, message: `Email sent successfully to ${toList.join(', ')}` });
      } catch (e) {
        throw fail(502, 'Could not send email: ' + e.message);
      }
    }

    if (user.role !== 'admin') throw fail(403, 'Admin only');
    const pub = () => ({ smtpUser: c.smtpUser, smtpPassSet: !!c.smtpPass, mailTo: c.mailTo, supportEmail: c.supportEmail || '', alertTime: c.alertTime, otpEmployees: c.otpEmployees !== false, otpAdmin: c.otpAdmin !== false, faceEmployees: c.faceEmployees !== false });
    if (m === 'GET' && !id) return send(res, 200, pub());
    if (m === 'PUT' && !id) {
      const b = await body(req), to = String(b.mailTo || '').split(',').map(x => x.trim()).filter(Boolean);
      if (to.some(x => !EMAIL_RE.test(x))) throw fail(400, 'Invalid email address in recipients');
      const sup = String(b.supportEmail || '').split(',').map(x => x.trim()).filter(Boolean);
      if (sup.some(x => !EMAIL_RE.test(x))) throw fail(400, 'Invalid email address in Support Email');
      if (b.alertTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.alertTime)) throw fail(400, 'Alert time must be HH:MM');
      if (b.smtpUser && !EMAIL_RE.test(b.smtpUser)) throw fail(400, 'Sender must be an email address');
      c.smtpUser = oneLine(b.smtpUser); if (b.smtpPass) c.smtpPass = String(b.smtpPass).replace(/\s/g, ''); c.mailTo = to.join(', '); c.supportEmail = sup.join(', '); c.alertTime = b.alertTime || '17:30'; c.otpEmployees = b.otpEmployees !== false && b.otpEmployees !== 'false'; c.otpAdmin = b.otpAdmin !== false && b.otpAdmin !== 'false'; c.faceEmployees = b.faceEmployees !== false && b.faceEmployees !== 'false';
      if (!c.otpEmployees && !c.faceEmployees) throw fail(400, 'Keep at least one way for employees to verify (face check or emailed code) switched on.');
      await locked(() => fs.writeFileSync(path.join(DATA, 'mail.json'), JSON.stringify(c, null, 2))); return send(res, 200, pub());
    }
    if (m === 'POST' && id === 'test') {
      if (!c.smtpUser || !c.smtpPass || !c.mailTo) throw fail(400, 'Save sender, app password and recipient first');
      try { await smtpSend(c, { to: c.mailTo, subject: 'Test email from Accounts app', text: 'Email is working. Daily work updates will be sent to this address.', images: mailImages(), html: emailHtml({ title: 'Email is working', preheader: 'Your mail settings work.', body: `<tr><td style="padding:30px 32px 30px"><h1 style="margin:0 0 10px;font-size:23px;color:#1c2333">Email is working ✔</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#5b6477">Daily work updates and login codes will be sent from this account. You can close this message.</p></td></tr>` }) }); } catch (e) { throw fail(502, 'Could not send: ' + e.message); }
      return send(res, 200, {});
    }
    throw fail(405, 'Method not allowed');
  }
  if (t === 'docs' && id === 'next' && m === 'GET') {
    if (!DOCP[sub]) throw fail(400, 'Invalid type');
    const dt = new URL(req.url, 'http://x').searchParams.get('date') || ldate();
    return send(res, 200, { number: nextDocNumber(sub, /^\d{4}-\d{2}-\d{2}$/.test(dt) ? dt : ldate(), readTable('docs')) });
  }
  if (t === 'workupdates' && id === 'today' && m === 'GET') {
    const today = ldate(), mine = readTable('workupdates').some(x => x.userId === user.id && x.date === today);
    return send(res, 200, { date: today, required: user.role === 'employee', submitted: mine, alertTime: mailCfg().alertTime });
  }
  if (t === 'workupdates' && sub === 'resend' && m === 'POST') {
    if (user.role !== 'admin') throw fail(403, 'Admin only');
    const row = readTable(t).find(x => x.id === id); if (!row) throw fail(404, 'Not found');
    const st = await emailUpdate(row);
    await locked(() => { const L = readTable(t), x = L.find(y => y.id === id); if (x) { x.emailStatus = st; writeTable(t, L); } });
    return send(res, 200, { emailStatus: st });
  }
  const P = PERM[t];
  if (m === 'GET' && !id) {
    if (t === 'users' || t === 'purchases' || t === 'logins') {
      if (!P.r.includes(user.role)) throw fail(403, 'Not allowed');
    } else if (t === 'docs') {
      if (!hasPermission(user, 'quotation', 'view') && !hasPermission(user, 'pi', 'view') && !hasPermission(user, 'po', 'view')) {
        throw fail(403, 'Not allowed');
      }
    } else {
      if (!hasPermission(user, t, 'view')) throw fail(403, 'Not allowed');
    }
    let L = readTable(t);
    if (t === 'users') L = L.map(safeUser);
    if (t === 'docs' && user.role !== 'admin') L = L.filter(x => hasPermission(user, x.type, 'view'));
    if (t === 'workupdates' && user.role !== 'admin') L = L.filter(x => x.userId === user.id);
    return send(res, 200, L);
  }
  if (m === 'POST' && !id) {
    const b = await body(req);
    const targetMod = t === 'docs' ? (b.type || 'quotation') : t;
    if (t === 'users' || t === 'purchases') {
      if (!P.c.includes(user.role)) throw fail(403, 'Not allowed');
    } else if (t !== 'workupdates') {
      if (!hasPermission(user, targetMod, 'create')) throw fail(403, 'Permission denied: Cannot create ' + targetMod);
    }
    const row = await locked(async () => {
      const L = readTable(t), now = new Date().toISOString();
      let o;
      if (t === 'invoices') o = buildInvoice(b, L, user);
      else if (t === 'workupdates') o = buildUpdate(b, L, user);
      else if (t === 'docs') o = buildDoc(b, L, user);
      else if (t === 'sheets') o = buildSheet(b, L, user);
      else if (t === 'ledgers') o = buildLedger(b, L, user);
      else if (t === 'vouchers') o = buildVoucher(b, L, user);
      else {
        o = clean(b, t);
        for (const k of REQUIRED[t] || []) if (!o[k]) throw fail(400, k + ' is required');
        if (t === 'users') {
          if (!ADMIN.concat('employee').includes(o.role)) throw fail(400, 'Invalid role');
          if (String(b.password || '').length < 8) throw fail(400, 'Password must be at least 8 characters');
          if (L.some(x => x.username.toLowerCase() === o.username.toLowerCase())) throw fail(400, 'Username already exists');
          o.password = hash(b.password); o.id = newId(); applyFace(o, b, o.id); checkUser(o, {}, b);
        }
        if (t === 'products' || t === 'purchases') for (const k of ['rate','amount','gst']) if (k in o && o[k] !== '' && isNaN(o[k])) throw fail(400, k + ' must be a number');
      }
      o.id = o.id || newId(); o.createdAt = now; if (SCHEMA[t].includes('createdBy')) o.createdBy = user.username;
      L.push(o);
      if (db.isDbActive()) {
        await db.saveRecord(t, o);
        db.setCachedTable(t, L);
      } else {
        await writeTable(t, L);
      }
      return o;
    });
    if (t === 'workupdates') { // e-mail the update, then record whether it went out
      row.emailStatus = await emailUpdate(row);
      await locked(() => { const L = readTable(t), x = L.find(y => y.id === row.id); if (x) { x.emailStatus = row.emailStatus; writeTable(t, L); } });
    }
    try {
      if (t === 'invoices') logActivityAction(user, 'Invoice', `Created invoice #${row.number} for ${row.clientName || 'client'} (₹${row.total || 0})`);
      else if (t === 'vouchers') logActivityAction(user, 'Voucher', `Added ${row.voucherType || 'voucher'} #${row.voucherNo || ''} (₹${row.total || 0})`);
      else if (t === 'docs') logActivityAction(user, 'Document', `Created ${row.type || 'document'} #${row.number || ''}`);
      else if (t === 'sheets') logActivityAction(user, 'Sheet', `Created sheet: ${row.title || ''}`);
      else if (t === 'clients') logActivityAction(user, 'Client', `Added client: ${row.name || ''}`);
      else if (t === 'ledgers') logActivityAction(user, 'Ledger', `Created ledger: ${row.name || ''}`);
      else if (t === 'workupdates') logActivityAction(user, 'Work Update', `Submitted daily work update (${row.hours || ''} hrs reported)`);
    } catch {}
    return send(res, 201, t === 'users' ? safeUser(row) : row);
  }
  if ((m === 'PUT' || m === 'DELETE') && id) {
    const action = m === 'PUT' ? 'edit' : 'delete';
    if (t === 'users' || t === 'purchases') {
      if (user.role !== 'admin') throw fail(403, 'Admin only');
    }
    const L = readTable(t), i = L.findIndex(x => x.id === id); if (i < 0) throw fail(404, 'Not found');
    const targetMod = t === 'docs' ? (L[i].type || 'quotation') : t;
    if (t !== 'users' && t !== 'purchases') {
      if (!hasPermission(user, targetMod, action)) {
        throw fail(403, 'Permission denied: Cannot ' + action + ' ' + targetMod);
      }
      if (['sheets','vouchers'].includes(t) && user.role !== 'admin' && L[i].createdBy && L[i].createdBy !== user.username) {
        throw fail(403, 'You can only edit or delete your own entries');
      }
    }
    const row = await locked(async () => {
      if (m === 'DELETE') {
        if (t === 'users' && (L[i].id === user.id || L.filter(x => x.role === 'admin').length < 2 && L[i].role === 'admin')) throw fail(400, 'Cannot delete yourself or the last admin');
        if (t === 'users') fs.rmSync(path.join(PHOTOS, L[i].id + '.jpg'), { force: true });
        const deletedId = L[i].id;
        L.splice(i, 1);
        if (db.isDbActive()) {
          await db.deleteRecord(t, deletedId);
          db.setCachedTable(t, L);
        } else {
          await writeTable(t, L);
        }
        return {};
      } else {
        const b = await body(req);
        if (t === 'invoices') {
          Object.assign(L[i], buildInvoice(b, L.filter(x => x.id !== id), user, L[i]));
          if (db.isDbActive()) {
            await db.saveRecord(t, L[i]);
            db.setCachedTable(t, L);
          } else {
            await writeTable(t, L);
          }
          return L[i];
        }
        if (t === 'docs') {
          Object.assign(L[i], buildDoc(b, L, user, L[i]));
          if (db.isDbActive()) {
            await db.saveRecord(t, L[i]);
            db.setCachedTable(t, L);
          } else {
            await writeTable(t, L);
          }
          return L[i];
        }
        if (t === 'sheets') {
          Object.assign(L[i], buildSheet(b, L, user, L[i]));
          if (db.isDbActive()) {
            await db.saveRecord(t, L[i]);
            db.setCachedTable(t, L);
          } else {
            await writeTable(t, L);
          }
          return L[i];
        }
        if (t === 'ledgers') {
          Object.assign(L[i], buildLedger(b, L, user, L[i]));
          if (db.isDbActive()) {
            await db.saveRecord(t, L[i]);
            db.setCachedTable(t, L);
          } else {
            await writeTable(t, L);
          }
          return L[i];
        }
        if (t === 'vouchers') {
          Object.assign(L[i], buildVoucher(b, L, user, L[i]));
          if (db.isDbActive()) {
            await db.saveRecord(t, L[i]);
            db.setCachedTable(t, L);
          } else {
            await writeTable(t, L);
          }
          return L[i];
        }
        const o = clean(b, t);
        if (t === 'users') {
          delete o.password;
          if (b.password) {
            if (String(b.password).length < 8) throw fail(400, 'Password must be at least 8 characters');
            o.password = hash(b.password);
          }
          if (o.role && !BOTH.includes(o.role)) throw fail(400, 'Invalid role');
          if (b.permissions !== undefined) {
            o.permissions = typeof b.permissions === 'object' && b.permissions !== null
              ? b.permissions
              : (typeof b.permissions === 'string' ? (() => { try { return JSON.parse(b.permissions || '{}'); } catch { return {}; } })() : {});
          }
          applyFace(o, b, L[i].id);
          checkUser(o, L[i], b);
        }
        Object.assign(L[i], o);
        if (db.isDbActive()) {
          await db.saveRecord(t, L[i]);
          db.setCachedTable(t, L);
        } else {
          await writeTable(t, L);
        }
        return L[i];
      }
    });
    try {
      if (m === 'PUT' && row) {
        if (t === 'invoices') logActivityAction(user, 'Invoice', `Updated invoice #${row.number || ''}`);
        else if (t === 'vouchers') logActivityAction(user, 'Voucher', `Updated ${row.voucherType || 'voucher'} #${row.voucherNo || ''}`);
        else if (t === 'docs') logActivityAction(user, 'Document', `Updated ${row.type || 'document'} #${row.number || ''}`);
        else if (t === 'sheets') logActivityAction(user, 'Sheet', `Updated sheet: ${row.title || ''}`);
        else if (t === 'ledgers') logActivityAction(user, 'Ledger', `Updated ledger: ${row.name || ''}`);
      }
    } catch {}
    return send(res, 200, (t === 'invoices' || t === 'docs' || t === 'sheets') && row ? row : {});
  }
  throw fail(405, 'Method not allowed');
}

const DOCP = { quotation: ['quotePrefix', 'AE/', 0], pi: ['piPrefix', 'AEPI-', 3], po: ['poPrefix', 'AE/', 0] };
function nextDocNumber(type, date, L) { // e.g. AEPI-26-27-011, AE/26-27/30 (financial year April-March)
  const [k, def, pad] = DOCP[type], prefix = company()[k] || def, y = +date.slice(0, 4), s0 = +date.slice(5, 7) >= 4 ? y : y - 1;
  const base = prefix + String(s0).slice(2) + '-' + String(s0 + 1).slice(2) + (/[\/\-]$/.test(prefix) ? prefix.slice(-1) : '-');
  const n = Math.max(0, ...L.filter(x => x.type === type && x.number.startsWith(base)).map(x => parseInt(x.number.slice(base.length)) || 0)) + 1;
  return base + String(n).padStart(pad, '0');
}
function buildDoc(b, L, user, existing) {
  const type = existing ? existing.type : b.type;
  if (!DOCP[type]) throw fail(400, 'Invalid document type');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw fail(400, 'Invalid date');
  const d = b.data || {}, T = (v, n = 300) => String(v ?? '').trim().slice(0, n), num = v => v === '' || v == null || isNaN(+v) ? 0 : +v; // text like 'nil' counts as 0 but is shown as typed
  const same = L.filter(x => x.type === type && (!existing || x.id !== existing.id));
  const number = T(b.number, 40) || nextDocNumber(type, b.date, same);
  if (same.some(x => x.number === number)) throw fail(400, 'Number already used: ' + number);
  const toName = T(d.toName, 200); if (!toName) throw fail(400, 'Party name is required');
  if (!Array.isArray(d.items) || !d.items.length || d.items.length > 60) throw fail(400, 'Add at least one item');
  const data = { toName }; let total = 0;
  if (type === 'quotation') {
    Object.assign(data, { attn: T(d.attn), ref: T(d.ref), subject: T(d.subject), intro: T(d.intro, 800), terms: T(d.terms, 3000), sign: T(d.sign, 500) });
    data.items = d.items.map(i => { const q = +i.qty, rate = +i.rate; if (!i.desc || !(q > 0) || !(rate >= 0)) throw fail(400, 'Invalid item: ' + (i.desc || '(no description)')); const amount = r2(q * rate); total += amount; return { desc: T(i.desc, 400), qty: T(i.qty, 12), rate, amount }; });
    data.total = r2(total);
  } else {
    Object.assign(data, { toAddress: T(d.toAddress, 500), toGstin: T(d.toGstin, 20), toContact: T(d.toContact), toPhone: T(d.toPhone, 60) });
    if (type === 'pi') { data.poNo = T(d.poNo, 60); data.poDate = /^\d{4}-\d{2}-\d{2}$/.test(d.poDate || '') ? d.poDate : ''; } else data.payment = T(d.payment, 500);
    data.items = d.items.map(i => {
      const q = +i.qty, rate = +i.rate, disc = num(i.disc), pf = num(i.pf);
      if (!i.desc || !(q > 0) || !(rate >= 0) || !(disc >= 0 && disc <= 100) || !(pf >= 0)) throw fail(400, 'Invalid item: ' + (i.desc || '(no description)'));
      const amount = r2(q * rate * (1 - disc / 100) + pf); total += amount;
      return { desc: T(i.desc, 400), qty: T(i.qty, 12), uom: T(i.uom, 12), rate, disc: T(i.disc, 12), pf: T(i.pf, 12), delivery: T(i.delivery, 60), amount };
    });
    data.total = r2(total);
    data.taxType = ['IGST', 'CGST+SGST', 'NONE'].includes(d.taxType) ? d.taxType : 'IGST'; data.taxRate = data.taxType === 'NONE' ? 0 : +d.taxRate;
    if (!(data.taxRate >= 0 && data.taxRate <= 100)) throw fail(400, 'Invalid tax rate');
    data.taxAmount = r2(data.total * data.taxRate / 100); data.payable = r2(data.total + data.taxAmount);
  }
  return { type, number, date: b.date, party: toName, total: data.payable ?? data.total, data: JSON.stringify(data) };
}

function buildSheet(b, L, user, existing) {
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) throw fail(400, 'Title is required');
  const type = ['excel', 'word'].includes(b.type) ? b.type : 'excel';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : ldate();
  const category = String(b.category || 'General').trim().slice(0, 80);
  let data = typeof b.data === 'string' ? b.data : JSON.stringify(b.data || {});
  if (data.length > 800000) throw fail(400, 'Content is too large (max 800 KB)');
  return { id: existing?.id || newId(), title, type, date, category, data, createdBy: existing?.createdBy || user.username, createdAt: existing?.createdAt || new Date().toISOString() };
}

function buildLedger(b, L, user, existing) {
  const name = String(b.name || '').trim().slice(0, 150);
  if (!name) throw fail(400, 'Ledger name is required');
  if (L.some(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== existing?.id))
    throw fail(400, 'Ledger with this name already exists');
  const group = String(b.group || 'Sundry Debtors').trim().slice(0, 80);
  const openingBalance = Math.round((+b.openingBalance || 0) * 100) / 100;
  const balanceType = b.balanceType === 'Cr' ? 'Cr' : 'Dr';
  const contact = String(b.contact || '').trim().slice(0, 100);
  const phone = String(b.phone || '').trim().slice(0, 50);
  const gstin = String(b.gstin || '').trim().slice(0, 25);
  const address = String(b.address || '').trim().slice(0, 300);
  return {
    id: existing?.id || newId(),
    name,
    group,
    openingBalance,
    balanceType,
    contact,
    phone,
    gstin,
    address,
    createdBy: existing?.createdBy || user.username,
    createdAt: existing?.createdAt || new Date().toISOString()
  };
}

function buildVoucher(b, L, user, existing) {
  const voucherType = ['Payment', 'Receipt', 'Contra', 'Journal', 'Sales', 'Purchase'].includes(b.voucherType) ? b.voucherType : 'Payment';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : ldate();
  let entries = Array.isArray(b.entries) ? b.entries : [];
  if (typeof b.entries === 'string') {
    try { entries = JSON.parse(b.entries); } catch {}
  }
  if (!entries.length || entries.length < 2) throw fail(400, 'Voucher must have at least 2 entry lines (Dr & Cr)');
  
  let totalDr = 0, totalCr = 0;
  const cleanEntries = entries.map((e, idx) => {
    const ledgerName = String(e.ledgerName || '').trim().slice(0, 150);
    if (!ledgerName) throw fail(400, `Line ${idx + 1}: Select a ledger`);
    const type = e.type === 'Cr' ? 'Cr' : 'Dr';
    const amount = Math.round((+e.amount || 0) * 100) / 100;
    if (!(amount > 0)) throw fail(400, `Line ${idx + 1}: Amount must be greater than zero`);
    if (type === 'Dr') totalDr += amount;
    else totalCr += amount;
    return {
      ledgerId: String(e.ledgerId || ''),
      ledgerName,
      type,
      amount
    };
  });
  totalDr = Math.round(totalDr * 100) / 100;
  totalCr = Math.round(totalCr * 100) / 100;
  if (Math.abs(totalDr - totalCr) > 0.01) {
    throw fail(400, `Debit (₹${totalDr.toFixed(2)}) must equal Credit (₹${totalCr.toFixed(2)}). Difference: ₹${Math.abs(totalDr - totalCr).toFixed(2)}`);
  }
  
  const prefixMap = { Payment: 'PMNT', Receipt: 'RCPT', Contra: 'CNTR', Journal: 'JRNL', Sales: 'SALE', Purchase: 'PURC' };
  const pfx = prefixMap[voucherType] || 'VCH';
  let voucherNo = String(b.voucherNo || '').trim().slice(0, 50);
  if (!voucherNo) {
    const count = L.filter(x => x.voucherType === voucherType).length + 1;
    voucherNo = `${pfx}-${count}`;
  }
  const narration = String(b.narration || '').trim().slice(0, 500);

  return {
    id: existing?.id || newId(),
    voucherNo,
    voucherType,
    date,
    narration,
    entries: JSON.stringify(cleanEntries),
    total: totalDr,
    createdBy: existing?.createdBy || user.username,
    createdAt: existing?.createdAt || new Date().toISOString()
  };
}

function buildInvoice(b, L, user, existing) {
  const c = readTable('clients').find(x => x.id === b.clientId); if (!c) throw fail(400, 'Select a client');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw fail(400, 'Invalid date');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100) throw fail(400, 'Add at least one item');
  const co = company(), T = (v, n = 300) => String(v ?? '').trim().slice(0, n);
  let subtotal = 0, tax = 0;
  const items = b.items.map(i => {
    const qty = +i.qty, rate = +i.rate, gst = +i.gst || 0;
    if (!i.name || !(qty > 0) || !(rate >= 0) || gst < 0 || gst > 100) throw fail(400, 'Invalid item: ' + (i.name || '(no name)'));
    const amount = r2(qty * rate), t = r2(amount * gst / 100); subtotal += amount; tax += t;
    return { name: T(i.name, 200), hsn: T(i.hsn, 20), qty, unit: T(i.unit, 10), rate, gst, amount };
  });
  // Number format: PREFIX-FY/SEQ  e.g. AETX-26-27/51 (Indian FY: April to March)
  const y = +b.date.slice(0, 4), s0 = +b.date.slice(5, 7) >= 4 ? y : y - 1, fy = String(s0).slice(2) + '-' + String(s0 + 1).slice(2);
  const base = `${co.prefix || 'INV'}-${fy}/`;
  let number;
  if (existing) { number = T(b.number || existing.number, 40); if (L.some(x => x.number === number)) throw fail(400, 'Invoice number already exists'); }
  else number = base + (Math.max(0, ...L.filter(x => x.number.startsWith(base)).map(x => parseInt(x.number.slice(base.length)) || 0)) + 1);
  const same = b.sameShip !== false && b.sameShip !== 'false';
  const ship = same ? { shipName: c.name, shipAddress: c.address, shipGstin: c.gstin, shipContact: c.contact, shipMobile: c.mobile }
    : { shipName: T(b.shipName), shipAddress: T(b.shipAddress, 500), shipGstin: T(b.shipGstin, 20), shipContact: T(b.shipContact), shipMobile: T(b.shipMobile, 20) };
  if (!same && !ship.shipName) throw fail(400, 'Consignee name is required');
  const taxType = b.taxType === 'IGST' ? 'IGST' : 'CGST+SGST';
  return { number, date: b.date, state: T(b.state, 60) || `${co.state} ${co.stateCode}`.trim(), taxType, clientId: c.id, clientName: c.name, clientAddress: c.address, clientGstin: c.gstin, clientContact: c.contact || '', clientMobile: c.mobile || '',
    ...ship, poNumber: T(b.poNumber, 100), poDate: T(b.poDate, 20), items: JSON.stringify(items), subtotal: r2(subtotal), tax: r2(tax), total: r2(subtotal + tax) };
}

// ---------- Static ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};
function serve(req, res, p) {
  const f = path.normalize(path.join(PUB, p === '/' ? 'index.html' : p));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('Not found'); }
  const stat = fs.statSync(f);
  const ext = path.extname(f).toLowerCase();
  const ctype = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range && stat.size > 0) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    const chunksize = (end - start) + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': ctype,
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(f, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': ctype,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cache-Control': ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
    });
    fs.createReadStream(f).pipe(res);
  }
}

if (!IS_SERVERLESS) {
  try { init(); } catch (e) {}
}
const handler = async (req, res) => {
  try {
    if (db.isDbActive()) {
      await db.refreshCache();
    }
    let p = new URL(req.url, 'http://x').pathname;
    const matched = req.headers && (req.headers['x-matched-path'] || req.headers['x-vercel-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-original-url']);
    if (matched && matched.startsWith('/api/')) {
      p = new URL(matched, 'http://x').pathname;
    } else if (p.startsWith('/api/index.js') || p.startsWith('/api/[...path]') || p === '/api/index') {
      try {
        const u = new URL(req.url, 'http://x');
        const qp = u.searchParams.get('path');
        if (qp) p = '/api/' + qp;
      } catch {}
    }
    if (p === '/api/cron/check-inactivity' || p === '/api/cron/morning-sync') {
      if (db.isDbActive()) {
        try { await db.refreshCache(true); } catch (e) { console.error('Morning prewarm failed:', e.message); }
      }
      await checkInactivityAlerts();
      return send(res, 200, { ok: true, timestamp: new Date().toISOString() });
    }
    if (p.startsWith('/api/')) return await api(req, res, p.slice(5).split('/').filter(Boolean));
    serve(req, res, p);
  } catch (e) {
    if (!e.code || e.code >= 500) console.error(e);
    send(res, e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.code ? e.message : 'Server error' });
  }
};
module.exports = handler;

if (require.main === module && !IS_SERVERLESS) {
  let server;
  try { server = TLS ? https.createServer(TLS_OPTS, handler) : http.createServer(handler); }
  catch (e) { console.error('HTTPS could not start (' + e.message + '). Falling back to plain HTTP.'); TLS = false; server = http.createServer(handler); }
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : e.message); process.exit(1); });
  if (process.env.LAUNCHER_PID) setInterval(() => { try { process.kill(+process.env.LAUNCHER_PID, 0); } catch { console.log('Launcher is gone, shutting down.'); process.exit(0); } }, 5000); // never outlive the helper
  setInterval(checkInactivityAlerts, 60000); // Inactivity & offline monitoring checker (runs every minute)
  setTimeout(checkInactivityAlerts, 4000);
  server.listen(PORT, HOST, () => console.log(`Accounting app running: ${TLS ? 'https' : 'http'}://localhost:${PORT}  (LAN: ${TLS ? 'https' : 'http'}://<this-pc-ip>:${PORT})`));
  if (TLS && process.env.HTTP_REDIRECT_PORT) // optional: http://host -> https://host
    http.createServer((q, r) => {
      let h = String(q.headers.host || '').replace(/:\d+$/, ''); if (!/^[a-z0-9.\-]+$/i.test(h)) h = 'localhost';
      r.writeHead(301, { Location: `https://${h}${PORT === 443 ? '' : ':' + PORT}${q.url}` }); r.end();
    }).on('error', e => console.error('HTTP redirect not started:', e.message)).listen(+process.env.HTTP_REDIRECT_PORT, HOST);
}

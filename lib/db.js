'use strict';
/**
 * Database abstraction layer:
 * Supports Supabase PostgreSQL RDBMS via pg Pool (using Transaction/Session Pooler),
 * with graceful fallback to local CSV/JSON if running in offline mode.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool = null;
const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
  } catch (e) {
    console.warn('PostgreSQL pool failed to initialize:', e.message);
  }
}

const isDbActive = () => !!pool;

const DATA = path.join(__dirname, '..', 'data');
const SCHEMA = {
  users: ['id','username','fullName','password','role','designation','contact','email','photo','faceDescriptor','faceRequired','otpRequired','createdAt'],
  clients: ['id','name','email','phone','address','gstin','contact','mobile','createdAt'],
  products: ['id','name','hsn','rate','gst','createdAt'],
  invoices: ['id','number','date','state','taxType','clientId','clientName','clientAddress','clientGstin','clientContact','clientMobile','shipName','shipAddress','shipGstin','shipContact','shipMobile','poNumber','poDate','items','subtotal','tax','total','createdBy','createdAt'],
  purchases: ['id','date','vendor','description','amount','gst','createdBy','createdAt'],
  workupdates: ['id','date','userId','username','fullName','loginTime','submittedAt','work','pending','hours','emailStatus','createdAt'],
  logins: ['id','userId','username','loginAt'],
  docs: ['id','type','number','date','party','total','data','createdBy','createdAt'],
  sheets: ['id','title','type','date','category','data','createdBy','createdAt'],
  ledgers: ['id','name','group','openingBalance','balanceType','contact','phone','gstin','address','createdBy','createdAt'],
  vouchers: ['id','voucherNo','voucherType','date','narration','entries','total','createdBy','createdAt'],
};

// CSV parsing helpers for fallback
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
const csvFile = t => path.join(DATA, t + '.csv');

function readLocalCSV(t) {
  if (!fs.existsSync(csvFile(t))) return [];
  const rows = parseCSV(fs.readFileSync(csvFile(t), 'utf8').replace(/^\uFEFF/, ''));
  const head = rows.shift() || SCHEMA[t];
  return rows.map(r => Object.fromEntries(SCHEMA[t].map(k => [k, r[head.indexOf(k)] ?? ''])));
}

function writeLocalCSV(t, list) {
  const out = [SCHEMA[t].join(',')].concat(list.map(o => SCHEMA[t].map(k => esc(o[k])).join(','))).join('\n') + '\n';
  const tmp = csvFile(t) + '.tmp';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, csvFile(t));
}

// Convert DB snake_case columns to camelCase expected by the front-end
function toAppFormat(t, row) {
  if (!row) return null;
  if (t === 'users') {
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name || '',
      password: row.password,
      role: row.role,
      designation: row.designation || '',
      contact: row.contact || '',
      email: row.email || '',
      photo: row.photo || '',
      faceDescriptor: row.face_descriptor ? JSON.stringify(row.face_descriptor) : '',
      faceRequired: row.face_required || '',
      otpRequired: row.otp_required || '',
      createdAt: row.created_at
    };
  }
  if (t === 'invoices') {
    return {
      ...row,
      subtotal: row.subtotal != null ? +row.subtotal : 0,
      tax: row.tax != null ? +row.tax : 0,
      total: row.total != null ? +row.total : 0,
      clientId: row.client_id,
      clientName: row.client_name,
      clientAddress: row.client_address,
      clientGstin: row.client_gstin,
      clientContact: row.client_contact,
      clientMobile: row.client_mobile,
      shipName: row.ship_name,
      shipAddress: row.ship_address,
      shipGstin: row.ship_gstin,
      shipContact: row.ship_contact,
      shipMobile: row.ship_mobile,
      poNumber: row.po_number,
      poDate: row.po_date,
      taxType: row.tax_type,
      items: typeof row.items === 'object' ? JSON.stringify(row.items) : (row.items || '[]'),
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }
  if (t === 'docs') {
    return {
      ...row,
      total: row.total != null ? +row.total : 0,
      data: typeof row.data === 'object' ? JSON.stringify(row.data) : (row.data || '{}'),
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }
  if (t === 'sheets') {
    return {
      ...row,
      data: typeof row.data === 'object' ? JSON.stringify(row.data) : (row.data || '{}'),
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }
  if (t === 'vouchers') {
    return {
      ...row,
      total: row.total != null ? +row.total : 0,
      voucherNo: row.voucher_no,
      voucherType: row.voucher_type,
      entries: typeof row.entries === 'object' ? JSON.stringify(row.entries) : (row.entries || '[]'),
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }
  if (t === 'ledgers') {
    return {
      ...row,
      group: row.ledger_group,
      openingBalance: row.opening_balance != null ? +row.opening_balance : 0,
      balanceType: row.balance_type,
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }
  if (t === 'workupdates') {
    return {
      ...row,
      userId: row.user_id,
      fullName: row.full_name,
      loginTime: row.login_time,
      submittedAt: row.submitted_at,
      emailStatus: row.email_status,
      createdAt: row.created_at
    };
  }
  if (t === 'logins') {
    return {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      loginAt: row.login_at
    };
  }
  if (t === 'products') {
    return {
      ...row,
      rate: row.rate != null ? +row.rate : 0,
      gst: row.gst != null ? +row.gst : 0,
      createdAt: row.created_at
    };
  }
  if (t === 'purchases') {
    return {
      ...row,
      amount: row.amount != null ? +row.amount : 0,
      gst: row.gst != null ? +row.gst : 0,
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }
  return {
    ...row,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

// Convert App camelCase to DB snake_case for saving
function toDbFormat(t, o) {
  if (t === 'users') {
    let fd = null;
    try { if (o.faceDescriptor) fd = typeof o.faceDescriptor === 'string' ? JSON.parse(o.faceDescriptor) : o.faceDescriptor; } catch {}
    return {
      id: o.id,
      username: o.username,
      full_name: o.fullName || null,
      password: o.password,
      role: o.role || 'employee',
      designation: o.designation || null,
      contact: o.contact || null,
      email: o.email || null,
      photo: o.photo || null,
      face_descriptor: fd ? JSON.stringify(fd) : null,
      face_required: o.faceRequired || null,
      otp_required: o.otpRequired || null,
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'invoices') {
    let items = [];
    try { if (o.items) items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items; } catch {}
    return {
      id: o.id,
      number: o.number,
      date: o.date || '',
      state: o.state || '',
      tax_type: o.taxType || '',
      client_id: o.clientId || '',
      client_name: o.clientName || '',
      client_address: o.clientAddress || '',
      client_gstin: o.clientGstin || '',
      client_contact: o.clientContact || '',
      client_mobile: o.clientMobile || '',
      ship_name: o.shipName || '',
      ship_address: o.shipAddress || '',
      ship_gstin: o.shipGstin || '',
      ship_contact: o.shipContact || '',
      ship_mobile: o.shipMobile || '',
      po_number: o.poNumber || '',
      po_date: o.poDate || '',
      items: JSON.stringify(items),
      subtotal: +o.subtotal || 0,
      tax: +o.tax || 0,
      total: +o.total || 0,
      created_by: o.createdBy || '',
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'docs') {
    let data = {};
    try { if (o.data) data = typeof o.data === 'string' ? JSON.parse(o.data) : o.data; } catch {}
    return {
      id: o.id,
      type: o.type,
      number: o.number,
      date: o.date || '',
      party: o.party || '',
      total: +o.total || 0,
      data: JSON.stringify(data),
      created_by: o.createdBy || '',
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'sheets') {
    let data = {};
    try { if (o.data) data = typeof o.data === 'string' ? JSON.parse(o.data) : o.data; } catch {}
    return {
      id: o.id,
      title: o.title,
      type: o.type || '',
      date: o.date || '',
      category: o.category || '',
      data: JSON.stringify(data),
      created_by: o.createdBy || '',
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'vouchers') {
    let entries = [];
    try { if (o.entries) entries = typeof o.entries === 'string' ? JSON.parse(o.entries) : o.entries; } catch {}
    return {
      id: o.id,
      voucher_no: o.voucherNo || '',
      voucher_type: o.voucherType || '',
      date: o.date || '',
      narration: o.narration || '',
      entries: JSON.stringify(entries),
      total: +o.total || 0,
      created_by: o.createdBy || '',
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'ledgers') {
    return {
      id: o.id,
      name: o.name,
      ledger_group: o.group || o.ledger_group || '',
      opening_balance: +o.openingBalance || 0,
      balance_type: o.balanceType || 'Dr',
      contact: o.contact || '',
      phone: o.phone || '',
      gstin: o.gstin || '',
      address: o.address || '',
      created_by: o.createdBy || '',
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'workupdates') {
    return {
      id: o.id,
      date: o.date || '',
      user_id: o.userId || '',
      username: o.username || '',
      full_name: o.fullName || '',
      login_time: o.loginTime || '',
      submitted_at: o.submittedAt || '',
      work: o.work || '',
      pending: o.pending || '',
      hours: o.hours || '',
      email_status: o.emailStatus || '',
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'logins') {
    return {
      id: o.id,
      user_id: o.userId || '',
      username: o.username || '',
      login_at: o.loginAt || new Date().toISOString()
    };
  }
  if (t === 'products') {
    return {
      id: o.id,
      name: o.name,
      hsn: o.hsn || '',
      rate: +o.rate || 0,
      gst: +o.gst || 0,
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'purchases') {
    return {
      id: o.id,
      date: o.date || '',
      vendor: o.vendor || '',
      description: o.description || '',
      amount: +o.amount || 0,
      gst: +o.gst || 0,
      created_by: o.createdBy || '',
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  return o;
}

// -------------------------------------------------------------
// PUBLIC API
// -------------------------------------------------------------

async function readTable(t) {
  if (isDbActive()) {
    const { rows } = await pool.query(`SELECT * FROM public."${t}" ORDER BY created_at ASC`);
    return rows.map(r => toAppFormat(t, r));
  }
  return readLocalCSV(t);
}

async function writeTable(t, list) {
  if (isDbActive()) {
    // Truncate and replace or batch upsert
    for (const item of list) {
      await saveRecord(t, item);
    }
    return;
  }
  writeLocalCSV(t, list);
}

async function getRecord(t, id) {
  if (isDbActive()) {
    const { rows } = await pool.query(`SELECT * FROM public."${t}" WHERE id = $1 LIMIT 1`, [id]);
    return rows.length ? toAppFormat(t, rows[0]) : null;
  }
  const all = readLocalCSV(t);
  return all.find(x => x.id === id) || null;
}

async function saveRecord(t, record) {
  if (isDbActive()) {
    const dbRow = toDbFormat(t, record);
    const keys = Object.keys(dbRow);
    const vals = Object.values(dbRow);
    const cols = keys.map(k => `"${k}"`).join(', ');
    const params = keys.map((_, i) => `$${i + 1}`).join(', ');
    const updates = keys.filter(k => k !== 'id').map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');

    const sql = `
      INSERT INTO public."${t}" (${cols})
      VALUES (${params})
      ON CONFLICT (id) DO UPDATE SET ${updates}
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, vals);
    return toAppFormat(t, rows[0]);
  }
  const all = readLocalCSV(t);
  const idx = all.findIndex(x => x.id === record.id);
  if (idx >= 0) all[idx] = record;
  else all.push(record);
  writeLocalCSV(t, all);
  return record;
}

async function deleteRecord(t, id) {
  if (isDbActive()) {
    await pool.query(`DELETE FROM public."${t}" WHERE id = $1`, [id]);
    return true;
  }
  const all = readLocalCSV(t);
  const filtered = all.filter(x => x.id !== id);
  writeLocalCSV(t, filtered);
  return true;
}

async function getSetting(key, defaultVal = {}) {
  if (isDbActive()) {
    const { rows } = await pool.query(`SELECT value FROM public.app_settings WHERE key = $1 LIMIT 1`, [key]);
    if (rows.length && rows[0].value) return rows[0].value;
    return defaultVal;
  }
  const p = path.join(DATA, key + '.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return defaultVal;
}

async function saveSetting(key, val) {
  if (isDbActive()) {
    const valJson = typeof val === 'object' ? JSON.stringify(val) : val;
    await pool.query(`
      INSERT INTO public.app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    `, [key, valJson]);
    return val;
  }
  fs.writeFileSync(path.join(DATA, key + '.json'), JSON.stringify(val, null, 2));
  return val;
}

async function readActivity() {
  if (isDbActive()) {
    const { rows } = await pool.query(`SELECT * FROM public.activity_logs`);
    const result = {};
    for (const r of rows) {
      if (!result[r.date]) result[r.date] = {};
      result[r.date][r.user_id] = {
        username: r.username,
        loginTime: r.login_time,
        lastSeenAt: r.last_seen_at,
        activeMinutes: +r.active_minutes || 0,
        idleMinutes: +r.idle_minutes || 0,
        status: r.status,
        actions: r.actions || [],
        offlineAlertSent: r.offline_alert_sent,
        offlineAlertSentAt: r.offline_alert_sent_at
      };
    }
    return result;
  }
  const p = path.join(DATA, 'activity.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return {};
}

async function saveActivity(data) {
  if (isDbActive()) {
    for (const [dt, userMap] of Object.entries(data)) {
      for (const [uid, rec] of Object.entries(userMap)) {
        const id = dt + '_' + uid;
        const actions = JSON.stringify(rec.actions || []);
        await pool.query(`
          INSERT INTO public.activity_logs (id, date, user_id, username, login_time, last_seen_at, active_minutes, idle_minutes, status, actions, offline_alert_sent, offline_alert_sent_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          ON CONFLICT (id) DO UPDATE SET
            active_minutes = EXCLUDED.active_minutes,
            idle_minutes = EXCLUDED.idle_minutes,
            status = EXCLUDED.status,
            actions = EXCLUDED.actions,
            last_seen_at = EXCLUDED.last_seen_at,
            offline_alert_sent = EXCLUDED.offline_alert_sent,
            offline_alert_sent_at = EXCLUDED.offline_alert_sent_at,
            updated_at = NOW();
        `, [
          id, dt, uid, rec.username || '', rec.loginTime || '', rec.lastSeenAt || '',
          +rec.activeMinutes || 0, +rec.idleMinutes || 0, rec.status || 'offline',
          actions, !!rec.offlineAlertSent, rec.offlineAlertSentAt || null
        ]);
      }
    }
    return;
  }
  fs.writeFileSync(path.join(DATA, 'activity.json'), JSON.stringify(data, null, 2));
}

async function addLoginAudit({ id, userId, username, loginAt }) {
  if (isDbActive()) {
    await pool.query(`
      INSERT INTO public.logins (id, user_id, username, login_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO NOTHING;
    `, [id, userId, username, loginAt]);
    return;
  }
  const all = readLocalCSV('logins');
  all.push({ id, userId, username, loginAt });
  writeLocalCSV('logins', all.slice(-5000));
}

module.exports = {
  isDbActive,
  readTable,
  writeTable,
  getRecord,
  saveRecord,
  deleteRecord,
  getSetting,
  saveSetting,
  readActivity,
  saveActivity,
  addLoginAudit,
  SCHEMA
};

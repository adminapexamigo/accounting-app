const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');

function parseCSV(t) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { f += '"'; i++; }
        else { q = false; }
      } else { f += c; }
    } else if (c === '"') {
      q = true;
    } else if (c === ',') {
      r.push(f); f = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      r.push(f); f = '';
      rows.push(r); r = [];
    } else {
      f += c;
    }
  }
  if (f !== '' || r.length) { r.push(f); rows.push(r); }
  return rows.filter(x => !(x.length === 1 && x[0] === ''));
}

function readCSV(filename) {
  const p = path.join(DATA, filename);
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows.shift();
  return rows.map(row => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

const sqlEscape = v => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return isNaN(v) ? '0' : String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
};

const jsonEscape = obj => {
  if (!obj) return "'{}'::jsonb";
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return "'" + s.replace(/'/g, "''") + "'::jsonb";
};

let out = [];
out.push('-- ====================================================================');
out.push('-- AMIGO ACCOUNTING APP - DATA MIGRATION SEED SCRIPT');
out.push('-- 100% of data from local CSV and JSON files');
out.push('-- Safe: Uses ON CONFLICT DO UPDATE so it can be re-run safely');
out.push('-- ====================================================================\n');

// 1. Users
const users = readCSV('users.csv');
out.push(`-- 1. USERS (${users.length} records)`);
for (const u of users) {
  out.push(`INSERT INTO public.users (id, username, full_name, password, role, designation, contact, email, photo, face_descriptor, face_required, otp_required, created_at)
VALUES (${sqlEscape(u.id)}, ${sqlEscape(u.username)}, ${sqlEscape(u.fullName)}, ${sqlEscape(u.password)}, ${sqlEscape(u.role || 'employee')}, ${sqlEscape(u.designation)}, ${sqlEscape(u.contact)}, ${sqlEscape(u.email)}, ${sqlEscape(u.photo)}, ${u.faceDescriptor ? jsonEscape(u.faceDescriptor) : 'NULL'}, ${sqlEscape(u.faceRequired)}, ${sqlEscape(u.otpRequired)}, ${sqlEscape(u.createdAt || new Date().toISOString())})
ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, full_name=EXCLUDED.full_name, password=EXCLUDED.password, role=EXCLUDED.role, designation=EXCLUDED.designation, contact=EXCLUDED.contact, email=EXCLUDED.email;`);
}
out.push('');

// 2. Clients
const clients = readCSV('clients.csv');
out.push(`-- 2. CLIENTS (${clients.length} records)`);
for (const c of clients) {
  out.push(`INSERT INTO public.clients (id, name, email, phone, address, gstin, contact, mobile, created_at)
VALUES (${sqlEscape(c.id)}, ${sqlEscape(c.name)}, ${sqlEscape(c.email)}, ${sqlEscape(c.phone)}, ${sqlEscape(c.address)}, ${sqlEscape(c.gstin)}, ${sqlEscape(c.contact)}, ${sqlEscape(c.mobile)}, ${sqlEscape(c.createdAt || new Date().toISOString())})
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, phone=EXCLUDED.phone, address=EXCLUDED.address, gstin=EXCLUDED.gstin, contact=EXCLUDED.contact, mobile=EXCLUDED.mobile;`);
}
out.push('');

// 3. Products
const products = readCSV('products.csv');
out.push(`-- 3. PRODUCTS (${products.length} records)`);
for (const p of products) {
  out.push(`INSERT INTO public.products (id, name, hsn, rate, gst, created_at)
VALUES (${sqlEscape(p.id)}, ${sqlEscape(p.name)}, ${sqlEscape(p.hsn)}, ${+p.rate || 0}, ${+p.gst || 0}, ${sqlEscape(p.createdAt || new Date().toISOString())})
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, hsn=EXCLUDED.hsn, rate=EXCLUDED.rate, gst=EXCLUDED.gst;`);
}
out.push('');

// 4. Invoices
const invoices = readCSV('invoices.csv');
out.push(`-- 4. INVOICES (${invoices.length} records)`);
for (const inv of invoices) {
  let itemsJson = '[]';
  try { if (inv.items) { JSON.parse(inv.items); itemsJson = inv.items; } } catch {}
  out.push(`INSERT INTO public.invoices (id, number, date, state, tax_type, client_id, client_name, client_address, client_gstin, client_contact, client_mobile, ship_name, ship_address, ship_gstin, ship_contact, ship_mobile, po_number, po_date, items, subtotal, tax, total, created_by, created_at)
VALUES (${sqlEscape(inv.id)}, ${sqlEscape(inv.number)}, ${sqlEscape(inv.date)}, ${sqlEscape(inv.state)}, ${sqlEscape(inv.taxType)}, ${sqlEscape(inv.clientId)}, ${sqlEscape(inv.clientName)}, ${sqlEscape(inv.clientAddress)}, ${sqlEscape(inv.clientGstin)}, ${sqlEscape(inv.clientContact)}, ${sqlEscape(inv.clientMobile)}, ${sqlEscape(inv.shipName)}, ${sqlEscape(inv.shipAddress)}, ${sqlEscape(inv.shipGstin)}, ${sqlEscape(inv.shipContact)}, ${sqlEscape(inv.shipMobile)}, ${sqlEscape(inv.poNumber)}, ${sqlEscape(inv.poDate)}, ${jsonEscape(itemsJson)}, ${+inv.subtotal || 0}, ${+inv.tax || 0}, ${+inv.total || 0}, ${sqlEscape(inv.createdBy)}, ${sqlEscape(inv.createdAt || new Date().toISOString())})
ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, total=EXCLUDED.total, items=EXCLUDED.items, subtotal=EXCLUDED.subtotal, tax=EXCLUDED.tax;`);
}
out.push('');

// 5. Docs
const docs = readCSV('docs.csv');
out.push(`-- 5. DOCUMENTS (${docs.length} records)`);
for (const d of docs) {
  let dataJson = '{}';
  try { if (d.data) { JSON.parse(d.data); dataJson = d.data; } } catch {}
  out.push(`INSERT INTO public.docs (id, type, number, date, party, total, data, created_by, created_at)
VALUES (${sqlEscape(d.id)}, ${sqlEscape(d.type)}, ${sqlEscape(d.number)}, ${sqlEscape(d.date)}, ${sqlEscape(d.party)}, ${+d.total || 0}, ${jsonEscape(dataJson)}, ${sqlEscape(d.createdBy)}, ${sqlEscape(d.createdAt || new Date().toISOString())})
ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type, number=EXCLUDED.number, total=EXCLUDED.total, data=EXCLUDED.data;`);
}
out.push('');

// 6. Ledgers
const ledgers = readCSV('ledgers.csv');
out.push(`-- 6. LEDGERS (${ledgers.length} records)`);
for (const l of ledgers) {
  out.push(`INSERT INTO public.ledgers (id, name, ledger_group, opening_balance, balance_type, contact, phone, gstin, address, created_by, created_at)
VALUES (${sqlEscape(l.id)}, ${sqlEscape(l.name)}, ${sqlEscape(l.group)}, ${+l.openingBalance || 0}, ${sqlEscape(l.balanceType || 'Dr')}, ${sqlEscape(l.contact)}, ${sqlEscape(l.phone)}, ${sqlEscape(l.gstin)}, ${sqlEscape(l.address)}, ${sqlEscape(l.createdBy)}, ${sqlEscape(l.createdAt || new Date().toISOString())})
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ledger_group=EXCLUDED.ledger_group, opening_balance=EXCLUDED.opening_balance, balance_type=EXCLUDED.balance_type;`);
}
out.push('');

// 7. Logins
const logins = readCSV('logins.csv');
out.push(`-- 7. LOGINS (${logins.length} records)`);
for (const lg of logins) {
  out.push(`INSERT INTO public.logins (id, user_id, username, login_at)
VALUES (${sqlEscape(lg.id)}, ${sqlEscape(lg.userId)}, ${sqlEscape(lg.username)}, ${sqlEscape(lg.loginAt)})
ON CONFLICT (id) DO UPDATE SET login_at=EXCLUDED.login_at;`);
}
out.push('');

// 8. App Settings
out.push('-- 8. APP SETTINGS (Company, Mail, Monitoring, Sync)');
const settingsFiles = ['company.json', 'mail.json', 'monitoring.json', 'sync.json'];
for (const sf of settingsFiles) {
  const p = path.join(DATA, sf);
  if (fs.existsSync(p)) {
    const key = sf.replace('.json', '');
    const jsonStr = fs.readFileSync(p, 'utf8');
    out.push(`INSERT INTO public.app_settings (key, value, updated_at)
VALUES (${sqlEscape(key)}, ${jsonEscape(jsonStr)}, NOW())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();`);
  }
}
out.push('');

// 9. Activity Logs
const actPath = path.join(DATA, 'activity.json');
if (fs.existsSync(actPath)) {
  const act = JSON.parse(fs.readFileSync(actPath, 'utf8'));
  let actCount = 0;
  out.push('-- 9. ACTIVITY LOGS');
  for (const [dt, usersMap] of Object.entries(act)) {
    for (const [userId, rec] of Object.entries(usersMap)) {
      actCount++;
      const id = dt + '_' + userId;
      out.push(`INSERT INTO public.activity_logs (id, date, user_id, username, login_time, last_seen_at, active_minutes, idle_minutes, status, actions, offline_alert_sent, offline_alert_sent_at, updated_at)
VALUES (${sqlEscape(id)}, ${sqlEscape(dt)}, ${sqlEscape(userId)}, ${sqlEscape(rec.username || '')}, ${sqlEscape(rec.loginTime)}, ${sqlEscape(rec.lastSeenAt)}, ${+rec.activeMinutes || 0}, ${+rec.idleMinutes || 0}, ${sqlEscape(rec.status)}, ${jsonEscape(rec.actions || [])}, ${rec.offlineAlertSent ? 'TRUE' : 'FALSE'}, ${sqlEscape(rec.offlineAlertSentAt)}, NOW())
ON CONFLICT (id) DO UPDATE SET active_minutes=EXCLUDED.active_minutes, idle_minutes=EXCLUDED.idle_minutes, actions=EXCLUDED.actions, last_seen_at=EXCLUDED.last_seen_at;`);
    }
  }
  out.push(`-- Total activity logs inserted: ${actCount}\n`);
}

const targetPath = path.join(__dirname, '..', 'supabase', 'seed_data.sql');
fs.writeFileSync(targetPath, out.join('\n'));
console.log('Successfully generated ' + targetPath);
console.log('Total SQL statements generated: ' + out.length);

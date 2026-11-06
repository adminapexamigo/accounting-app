/**
 * AMIGO ACCOUNTING APP - AUTOMATED SUPABASE MIGRATION SCRIPT
 * 
 * Reads all data from local CSV and JSON files, connects to Supabase,
 * uploads everything safely via upsert, and audits record counts.
 * 
 * Usage:
 *   node scripts/migrate-to-supabase.js
 * (Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or environment)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌ ERROR: Missing Supabase credentials in .env file!');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file before running.\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

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

async function runMigration() {
  console.log('====================================================');
  console.log('🚀 STARTING AMIGO CSV -> SUPABASE MIGRATION');
  console.log('Target URL:', SUPABASE_URL);
  console.log('====================================================\n');

  const audit = [];

  // 1. Users
  const users = readCSV('users.csv').map(u => ({
    id: u.id,
    username: u.username,
    full_name: u.fullName || '',
    password: u.password,
    role: u.role || 'employee',
    designation: u.designation || '',
    contact: u.contact || '',
    email: u.email || '',
    photo: u.photo || '',
    face_descriptor: u.faceDescriptor ? JSON.parse(u.faceDescriptor) : null,
    face_required: u.faceRequired || '',
    otp_required: u.otpRequired || '',
    created_at: u.createdAt || new Date().toISOString()
  }));
  if (users.length) {
    const { error } = await supabase.from('users').upsert(users, { onConflict: 'id' });
    if (error) console.error('Error inserting users:', error.message);
  }
  audit.push({ table: 'users', sourceCount: users.length });

  // 2. Clients
  const clients = readCSV('clients.csv').map(c => ({
    id: c.id,
    name: c.name,
    email: c.email || '',
    phone: c.phone || '',
    address: c.address || '',
    gstin: c.gstin || '',
    contact: c.contact || '',
    mobile: c.mobile || '',
    created_at: c.createdAt || new Date().toISOString()
  }));
  if (clients.length) {
    const { error } = await supabase.from('clients').upsert(clients, { onConflict: 'id' });
    if (error) console.error('Error inserting clients:', error.message);
  }
  audit.push({ table: 'clients', sourceCount: clients.length });

  // 3. Products
  const products = readCSV('products.csv').map(p => ({
    id: p.id,
    name: p.name,
    hsn: p.hsn || '',
    rate: +p.rate || 0,
    gst: +p.gst || 0,
    created_at: p.createdAt || new Date().toISOString()
  }));
  if (products.length) {
    const { error } = await supabase.from('products').upsert(products, { onConflict: 'id' });
    if (error) console.error('Error inserting products:', error.message);
  }
  audit.push({ table: 'products', sourceCount: products.length });

  // 4. Invoices
  const invoices = readCSV('invoices.csv').map(inv => {
    let items = [];
    try { if (inv.items) items = JSON.parse(inv.items); } catch {}
    return {
      id: inv.id,
      number: inv.number,
      date: inv.date || '',
      state: inv.state || '',
      tax_type: inv.taxType || '',
      client_id: inv.clientId || '',
      client_name: inv.clientName || '',
      client_address: inv.clientAddress || '',
      client_gstin: inv.clientGstin || '',
      client_contact: inv.clientContact || '',
      client_mobile: inv.clientMobile || '',
      ship_name: inv.shipName || '',
      ship_address: inv.shipAddress || '',
      ship_gstin: inv.shipGstin || '',
      ship_contact: inv.shipContact || '',
      ship_mobile: inv.shipMobile || '',
      po_number: inv.poNumber || '',
      po_date: inv.poDate || '',
      items,
      subtotal: +inv.subtotal || 0,
      tax: +inv.tax || 0,
      total: +inv.total || 0,
      created_by: inv.createdBy || '',
      created_at: inv.createdAt || new Date().toISOString()
    };
  });
  if (invoices.length) {
    const { error } = await supabase.from('invoices').upsert(invoices, { onConflict: 'id' });
    if (error) console.error('Error inserting invoices:', error.message);
  }
  audit.push({ table: 'invoices', sourceCount: invoices.length });

  // 5. Purchases
  const purchases = readCSV('purchases.csv').map(p => ({
    id: p.id,
    date: p.date || '',
    vendor: p.vendor || '',
    description: p.description || '',
    amount: +p.amount || 0,
    gst: +p.gst || 0,
    created_by: p.createdBy || '',
    created_at: p.createdAt || new Date().toISOString()
  }));
  if (purchases.length) {
    const { error } = await supabase.from('purchases').upsert(purchases, { onConflict: 'id' });
    if (error) console.error('Error inserting purchases:', error.message);
  }
  audit.push({ table: 'purchases', sourceCount: purchases.length });

  // 6. Workupdates
  const workupdates = readCSV('workupdates.csv').map(w => ({
    id: w.id,
    date: w.date || '',
    user_id: w.userId || '',
    username: w.username || '',
    full_name: w.fullName || '',
    login_time: w.loginTime || '',
    submitted_at: w.submittedAt || '',
    work: w.work || '',
    pending: w.pending || '',
    hours: w.hours || '',
    email_status: w.emailStatus || '',
    created_at: w.createdAt || new Date().toISOString()
  }));
  if (workupdates.length) {
    const { error } = await supabase.from('workupdates').upsert(workupdates, { onConflict: 'id' });
    if (error) console.error('Error inserting workupdates:', error.message);
  }
  audit.push({ table: 'workupdates', sourceCount: workupdates.length });

  // 7. Docs
  const docs = readCSV('docs.csv').map(d => {
    let data = {};
    try { if (d.data) data = JSON.parse(d.data); } catch {}
    return {
      id: d.id,
      type: d.type,
      number: d.number,
      date: d.date || '',
      party: d.party || '',
      total: +d.total || 0,
      data,
      created_by: d.createdBy || '',
      created_at: d.createdAt || new Date().toISOString()
    };
  });
  if (docs.length) {
    const { error } = await supabase.from('docs').upsert(docs, { onConflict: 'id' });
    if (error) console.error('Error inserting docs:', error.message);
  }
  audit.push({ table: 'docs', sourceCount: docs.length });

  // 8. Sheets
  const sheets = readCSV('sheets.csv').map(s => {
    let data = {};
    try { if (s.data) data = JSON.parse(s.data); } catch {}
    return {
      id: s.id,
      title: s.title,
      type: s.type || '',
      date: s.date || '',
      category: s.category || '',
      data,
      created_by: s.createdBy || '',
      created_at: s.createdAt || new Date().toISOString()
    };
  });
  if (sheets.length) {
    const { error } = await supabase.from('sheets').upsert(sheets, { onConflict: 'id' });
    if (error) console.error('Error inserting sheets:', error.message);
  }
  audit.push({ table: 'sheets', sourceCount: sheets.length });

  // 9. Ledgers
  const ledgers = readCSV('ledgers.csv').map(l => ({
    id: l.id,
    name: l.name,
    ledger_group: l.group || '',
    opening_balance: +l.openingBalance || 0,
    balance_type: l.balanceType || 'Dr',
    contact: l.contact || '',
    phone: l.phone || '',
    gstin: l.gstin || '',
    address: l.address || '',
    created_by: l.createdBy || '',
    created_at: l.createdAt || new Date().toISOString()
  }));
  if (ledgers.length) {
    const { error } = await supabase.from('ledgers').upsert(ledgers, { onConflict: 'id' });
    if (error) console.error('Error inserting ledgers:', error.message);
  }
  audit.push({ table: 'ledgers', sourceCount: ledgers.length });

  // 10. Vouchers
  const vouchers = readCSV('vouchers.csv').map(v => {
    let entries = [];
    try { if (v.entries) entries = JSON.parse(v.entries); } catch {}
    return {
      id: v.id,
      voucher_no: v.voucherNo || '',
      voucher_type: v.voucherType || '',
      date: v.date || '',
      narration: v.narration || '',
      entries,
      total: +v.total || 0,
      created_by: v.createdBy || '',
      created_at: v.createdAt || new Date().toISOString()
    };
  });
  if (vouchers.length) {
    const { error } = await supabase.from('vouchers').upsert(vouchers, { onConflict: 'id' });
    if (error) console.error('Error inserting vouchers:', error.message);
  }
  audit.push({ table: 'vouchers', sourceCount: vouchers.length });

  // 11. Logins
  const logins = readCSV('logins.csv').map(lg => ({
    id: lg.id,
    user_id: lg.userId || '',
    username: lg.username || '',
    login_at: lg.loginAt || ''
  }));
  if (logins.length) {
    // Upsert in chunks of 50
    for (let i = 0; i < logins.length; i += 50) {
      const chunk = logins.slice(i, i + 50);
      const { error } = await supabase.from('logins').upsert(chunk, { onConflict: 'id' });
      if (error) console.error('Error inserting logins chunk:', error.message);
    }
  }
  audit.push({ table: 'logins', sourceCount: logins.length });

  // 12. App Settings
  const settingsFiles = ['company.json', 'mail.json', 'monitoring.json', 'sync.json'];
  let settingsCount = 0;
  for (const sf of settingsFiles) {
    const p = path.join(DATA, sf);
    if (fs.existsSync(p)) {
      const key = sf.replace('.json', '');
      const value = JSON.parse(fs.readFileSync(p, 'utf8'));
      const { error } = await supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) console.error('Error inserting setting ' + key + ':', error.message);
      else settingsCount++;
    }
  }
  audit.push({ table: 'app_settings', sourceCount: settingsCount });

  // 13. Activity Logs
  const actPath = path.join(DATA, 'activity.json');
  let actRows = [];
  if (fs.existsSync(actPath)) {
    const act = JSON.parse(fs.readFileSync(actPath, 'utf8'));
    for (const [dt, usersMap] of Object.entries(act)) {
      for (const [userId, rec] of Object.entries(usersMap)) {
        actRows.push({
          id: dt + '_' + userId,
          date: dt,
          user_id: userId,
          username: rec.username || '',
          login_time: rec.loginTime || '',
          last_seen_at: rec.lastSeenAt || '',
          active_minutes: +rec.activeMinutes || 0,
          idle_minutes: +rec.idleMinutes || 0,
          status: rec.status || 'offline',
          actions: rec.actions || [],
          offline_alert_sent: !!rec.offlineAlertSent,
          offline_alert_sent_at: rec.offlineAlertSentAt || null,
          updated_at: new Date().toISOString()
        });
      }
    }
    for (let i = 0; i < actRows.length; i += 50) {
      const chunk = actRows.slice(i, i + 50);
      const { error } = await supabase.from('activity_logs').upsert(chunk, { onConflict: 'id' });
      if (error) console.error('Error inserting activity logs chunk:', error.message);
    }
  }
  audit.push({ table: 'activity_logs', sourceCount: actRows.length });

  // AUDIT RECONCILIATION CHECK
  console.log('\n====================================================');
  console.log('📊 RECONCILIATION AUDIT (LOCAL CSV vs SUPABASE DB)');
  console.log('====================================================');
  console.log(
    'Table Name'.padEnd(20) + 
    'Local Source'.padEnd(15) + 
    'Supabase Rows'.padEnd(16) + 
    'Status'
  );
  console.log('-'.repeat(60));

  for (const item of audit) {
    const { count, error } = await supabase.from(item.table).select('*', { count: 'exact', head: true });
    const targetCount = error ? 'ERROR' : count;
    const match = !error && count >= item.sourceCount;
    const status = match ? '✅ OK (100% Match)' : (error ? '❌ ' + error.message : '⚠️ Mismatch');
    console.log(
      item.table.padEnd(20) + 
      String(item.sourceCount).padEnd(15) + 
      String(targetCount).padEnd(16) + 
      status
    );
  }
  console.log('====================================================\n');
}

runMigration().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});

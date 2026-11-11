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
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DATABASE_URL || process.env.POSTGRES_PRISMA_URL;

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

const DATA = process.env.VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, '..', 'data');
const SCHEMA = {
  users: ['id','username','fullName','password','role','designation','contact','email','photo','faceDescriptor','faceRequired','otpRequired','permissions','createdAt'],
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
  salaryslips: ['id','employeeId','employeeName','month','year','date','designation','department','bankName','bankAccountNo','bankIfsc','panNo','uanNo','totalDays','paidDays','lopDays','basic','hra','conveyance','specialAllowance','grossEarnings','pf','pt','tds','otherDeductions','totalDeductions','netPay','netPayWords','status','createdBy','createdAt'],
  leaves: ['id','userId','userName','leaveType','fromDate','toDate','days','reason','status','approvedBy','approvedAt','rejectionReason','appliedAt','reminderSentAt','createdBy','createdAt'],
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
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const out = [SCHEMA[t].join(',')].concat(list.map(o => SCHEMA[t].map(k => esc(o[k])).join(','))).join('\n') + '\n';
    const tmp = csvFile(t) + '.tmp';
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, csvFile(t));
  } catch {}
}

// Convert DB snake_case columns to camelCase expected by the front-end
function toAppFormat(t, row) {
  if (!row) return null;
  if (t === 'users') {
    const perms = row.permissions ? (typeof row.permissions === 'object' ? row.permissions : (() => { try { return JSON.parse(row.permissions); } catch { return {}; } })()) : {};
    const prof = perms.profile || {};
    const createdAtStr = row.created_at ? (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)) : (row.createdAt ? (row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt)) : new Date().toISOString());
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name || row.fullName || '',
      password: row.password,
      role: row.role,
      designation: row.designation || prof.designation || '',
      contact: row.contact || prof.contact || '',
      email: row.email || prof.email || '',
      photo: row.photo || '',
      faceDescriptor: row.face_descriptor ? (typeof row.face_descriptor === 'string' ? row.face_descriptor : JSON.stringify(row.face_descriptor)) : '',
      faceRequired: row.face_required || '',
      otpRequired: row.otp_required || '',
      permissions: perms,
      empId: row.emp_id || row.empId || prof.empId || ('AE-' + String(row.id || '').slice(0, 4).toUpperCase()),
      department: row.department || prof.department || 'General',
      dob: row.dob || prof.dob || '',
      gender: row.gender || prof.gender || '',
      bloodGroup: row.blood_group || row.bloodGroup || prof.bloodGroup || '',
      joiningDate: row.joining_date || row.joiningDate || prof.joiningDate || createdAtStr.slice(0, 10),
      fatherName: row.father_name || row.fatherName || prof.fatherName || '',
      emergencyContact: row.emergency_contact || row.emergencyContact || prof.emergencyContact || '',
      currentAddress: row.current_address || row.currentAddress || prof.currentAddress || '',
      permanentAddress: row.permanent_address || row.permanentAddress || prof.permanentAddress || '',
      aadhaarNo: row.aadhaar_no || row.aadhaarNo || prof.aadhaarNo || '',
      panNo: row.pan_no || row.panNo || prof.panNo || '',
      uanNo: row.uan_no || row.uanNo || prof.uanNo || '',
      esicNo: row.esic_no || row.esicNo || prof.esicNo || '',
      bankName: row.bank_name || row.bankName || prof.bankName || '',
      bankAccountNo: row.bank_account_no || row.bankAccountNo || prof.bankAccountNo || '',
      bankIfsc: row.bank_ifsc || row.bankIfsc || prof.bankIfsc || '',
      bankBranch: row.bank_branch || row.bankBranch || prof.bankBranch || '',
      annualCtc: row.annual_ctc != null ? +row.annual_ctc : (prof.annualCtc != null ? +prof.annualCtc : 0),
      salaryStructure: prof.salaryStructure || null,
      leavePolicy: prof.leavePolicy ? {
        pl: prof.leavePolicy.pl ?? 12,
        plBalance: prof.leavePolicy.plBalance ?? 12,
        cl: prof.leavePolicy.cl ?? 6,
        clBalance: prof.leavePolicy.clBalance ?? 6,
        sl: prof.leavePolicy.sl ?? 6,
        slBalance: prof.leavePolicy.slBalance ?? 6
      } : { pl: 12, cl: 6, sl: 6, plBalance: 12, clBalance: 6, slBalance: 6 },
      documents: prof.documents || {},
      createdAt: createdAtStr
    };
  }
  if (t === 'salaryslips') {
    return {
      ...row,
      totalDays: +(row.total_days ?? row.totalDays ?? 0),
      paidDays: +(row.paid_days ?? row.paidDays ?? 0),
      lopDays: +(row.lop_days ?? row.lopDays ?? 0),
      basic: +(row.basic ?? 0),
      hra: +(row.hra ?? 0),
      conveyance: +(row.conveyance ?? 0),
      specialAllowance: +(row.special_allowance ?? row.specialAllowance ?? 0),
      grossEarnings: +(row.gross_earnings ?? row.grossEarnings ?? 0),
      pf: +(row.pf ?? 0),
      pt: +(row.pt ?? 0),
      tds: +(row.tds ?? 0),
      otherDeductions: +(row.other_deductions ?? row.otherDeductions ?? 0),
      totalDeductions: +(row.total_deductions ?? row.totalDeductions ?? 0),
      netPay: +(row.net_pay ?? row.netPay ?? 0),
      employeeId: row.employee_id || row.employeeId || '',
      employeeName: row.employee_name || row.employeeName || '',
      bankName: row.bank_name || row.bankName || '',
      bankAccountNo: row.bank_account_no || row.bankAccountNo || '',
      bankIfsc: row.bank_ifsc || row.bankIfsc || '',
      panNo: row.pan_no || row.panNo || '',
      uanNo: row.uan_no || row.uanNo || '',
      netPayWords: row.net_pay_words || row.netPayWords || '',
      status: row.status || 'Published',
      createdBy: row.created_by || row.createdBy || '',
      createdAt: row.created_at || row.createdAt || ''
    };
  }
  if (t === 'leaves') {
    return {
      id: row.id,
      userId: row.user_id || row.userId || '',
      userName: row.user_name || row.userName || '',
      leaveType: row.leave_type || row.leaveType || 'Paid Leave (PL)',
      fromDate: row.from_date || row.fromDate || '',
      toDate: row.to_date || row.toDate || '',
      days: +(row.days ?? 1),
      reason: row.reason || '',
      status: row.status || 'Pending',
      approvedBy: row.approved_by || row.approvedBy || '',
      approvedAt: row.approved_at || row.approvedAt || '',
      rejectionReason: row.rejection_reason || row.rejectionReason || '',
      appliedAt: row.applied_at || row.appliedAt || '',
      reminderSentAt: row.reminder_sent_at || row.reminderSentAt || '',
      createdBy: row.created_by || row.createdBy || '',
      createdAt: row.created_at || row.createdAt || ''
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
  if (t === 'clients') {
    return {
      ...row,
      createdAt: row.created_at
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
  if (t === 'clients') {
    return {
      id: o.id,
      name: o.name,
      email: o.email || '',
      phone: o.phone || '',
      address: o.address || '',
      gstin: o.gstin || '',
      contact: o.contact || '',
      mobile: o.mobile || '',
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'users') {
    let fd = null;
    try { if (o.faceDescriptor) fd = typeof o.faceDescriptor === 'string' ? JSON.parse(o.faceDescriptor) : o.faceDescriptor; } catch {}
    const perms = typeof o.permissions === 'object' && o.permissions !== null ? { ...o.permissions } : (() => { try { return JSON.parse(o.permissions || '{}'); } catch { return {}; } })();
    perms.profile = {
      empId: o.empId || perms.profile?.empId || '',
      department: o.department || perms.profile?.department || '',
      dob: o.dob || perms.profile?.dob || '',
      gender: o.gender || perms.profile?.gender || '',
      bloodGroup: o.bloodGroup || perms.profile?.bloodGroup || '',
      joiningDate: o.joiningDate || perms.profile?.joiningDate || '',
      fatherName: o.fatherName || perms.profile?.fatherName || '',
      emergencyContact: o.emergencyContact || perms.profile?.emergencyContact || '',
      currentAddress: o.currentAddress || perms.profile?.currentAddress || '',
      permanentAddress: o.permanentAddress || perms.profile?.permanentAddress || '',
      aadhaarNo: o.aadhaarNo || perms.profile?.aadhaarNo || '',
      panNo: o.panNo || perms.profile?.panNo || '',
      uanNo: o.uanNo || perms.profile?.uanNo || '',
      esicNo: o.esicNo || perms.profile?.esicNo || '',
      bankName: o.bankName || perms.profile?.bankName || '',
      bankAccountNo: o.bankAccountNo || perms.profile?.bankAccountNo || '',
      bankIfsc: o.bankIfsc || perms.profile?.bankIfsc || '',
      bankBranch: o.bankBranch || perms.profile?.bankBranch || '',
      annualCtc: o.annualCtc != null ? +o.annualCtc : (perms.profile?.annualCtc != null ? +perms.profile.annualCtc : 0),
      salaryStructure: o.salaryStructure || perms.profile?.salaryStructure || null,
      leavePolicy: (o.leavePolicy !== undefined && o.leavePolicy !== null) ? o.leavePolicy : (perms.profile?.leavePolicy || null),
      documents: o.documents || perms.profile?.documents || {}
    };

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
      permissions: JSON.stringify(perms),
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'salaryslips') {
    return {
      id: o.id,
      employee_id: o.employeeId || '',
      employee_name: o.employeeName || '',
      month: o.month || '',
      year: o.year || '',
      date: o.date || new Date().toISOString().slice(0, 10),
      designation: o.designation || '',
      department: o.department || '',
      bank_name: o.bankName || '',
      bank_account_no: o.bankAccountNo || '',
      bank_ifsc: o.bankIfsc || '',
      pan_no: o.panNo || '',
      uan_no: o.uanNo || '',
      total_days: +(o.totalDays || 0),
      paid_days: +(o.paidDays || 0),
      lop_days: +(o.lopDays || 0),
      basic: +(o.basic || 0),
      hra: +(o.hra || 0),
      conveyance: +(o.conveyance || 0),
      special_allowance: +(o.specialAllowance || 0),
      gross_earnings: +(o.grossEarnings || 0),
      pf: +(o.pf || 0),
      pt: +(o.pt || 0),
      tds: +(o.tds || 0),
      other_deductions: +(o.otherDeductions || 0),
      total_deductions: +(o.totalDeductions || 0),
      net_pay: +(o.netPay || 0),
      net_pay_words: o.netPayWords || '',
      status: o.status || 'Published',
      created_by: o.createdBy || '',
      created_at: o.createdAt || new Date().toISOString()
    };
  }
  if (t === 'leaves') {
    return {
      id: o.id,
      user_id: o.userId || '',
      user_name: o.userName || '',
      leave_type: o.leaveType || 'Paid Leave (PL)',
      from_date: o.fromDate || '',
      to_date: o.toDate || '',
      days: +(o.days || 1),
      reason: o.reason || '',
      status: o.status || 'Pending',
      approved_by: o.approvedBy || '',
      approved_at: o.approvedAt || '',
      rejection_reason: o.rejectionReason || '',
      applied_at: o.appliedAt || new Date().toISOString(),
      reminder_sent_at: o.reminderSentAt || '',
      created_by: o.createdBy || '',
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
// IN-MEMORY CACHE FOR HIGH CONCURRENCY & ZERO LATENCY
// -------------------------------------------------------------
const cache = {
  tables: {},
  settings: {},
  activity: {}
};
let lastRefresh = 0;

let tableRevisions = {
  invoices: Date.now(),
  docs: Date.now(),
  sheets: Date.now(),
  ledgers: Date.now(),
  vouchers: Date.now(),
  clients: Date.now(),
  products: Date.now(),
  purchases: Date.now(),
  users: Date.now(),
  workupdates: Date.now(),
  salaryslips: Date.now(),
  leaves: Date.now()
};

function getRevisions() {
  const saved = cache.settings['table_revisions'];
  if (saved && typeof saved === 'object') {
    return { ...tableRevisions, ...saved };
  }
  return tableRevisions;
}

async function bumpRevision(t) {
  const now = Date.now();
  tableRevisions[t] = now;
  lastRefresh = 0;
  if (isDbActive()) {
    try {
      const cur = getRevisions();
      cur[t] = now;
      await saveSetting('table_revisions', cur);
    } catch (e) {
      console.error('Error bumping revision in DB:', e.message);
    }
  }
}

async function refreshCache(force = false) {
  if (!isDbActive()) return;
  const now = Date.now();
  if (!force && lastRefresh && (now - lastRefresh < 2000)) return; // 2-second cache throttle for rapid parallel requests
  try {
    const tablePromises = Object.keys(SCHEMA).map(async (t) => {
      try {
        const orderClause = t === 'logins' ? 'ORDER BY login_at ASC' : 'ORDER BY created_at ASC';
        const { rows } = await pool.query(`SELECT * FROM public."${t}" ${orderClause}`);
        return { t, rows: rows.map(r => toAppFormat(t, r)) };
      } catch (tableErr) {
        console.error(`Error querying DB for table ${t}:`, tableErr.message);
        return { t, rows: readLocalCSV(t) };
      }
    });

    const settingsPromise = pool.query(`SELECT key, value FROM public.app_settings`);
    const activityPromise = pool.query(`SELECT * FROM public.activity_logs`);

    const [tableResults, sResult, aResult] = await Promise.all([
      Promise.all(tablePromises),
      settingsPromise,
      activityPromise
    ]);

    for (const res of tableResults) {
      cache.tables[res.t] = res.rows;
    }
    for (const r of sResult.rows) {
      cache.settings[r.key] = r.value;
    }
    const act = {};
    for (const r of aResult.rows) {
      if (!act[r.date]) act[r.date] = {};
      act[r.date][r.user_id] = {
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
    cache.activity = act;
    lastRefresh = now;
  } catch (err) {
    console.error('Error refreshing cache from Supabase:', err.message);
  }
}

function getCachedTable(t) {
  if (cache.tables[t]) return cache.tables[t].slice();
  return readLocalCSV(t);
}

function setCachedTable(t, list) {
  cache.tables[t] = list;
}

function getCachedSetting(k) {
  if (cache.settings[k]) return cache.settings[k];
  const p = path.join(DATA, k + '.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return {};
}

function setCachedSetting(k, val) {
  cache.settings[k] = val;
}

function getCachedActivity() {
  if (cache.activity && Object.keys(cache.activity).length) return cache.activity;
  const p = path.join(DATA, 'activity.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return {};
}

// -------------------------------------------------------------
// PUBLIC API
// -------------------------------------------------------------

async function readTable(t) {
  if (isDbActive()) {
    const orderClause = t === 'logins' ? 'ORDER BY login_at ASC' : 'ORDER BY created_at ASC';
    const { rows } = await pool.query(`SELECT * FROM public."${t}" ${orderClause}`);
    const formatted = rows.map(r => toAppFormat(t, r));
    cache.tables[t] = formatted;
    return formatted;
  }
  return readLocalCSV(t);
}

async function writeTable(t, list) {
  cache.tables[t] = list;
  if (isDbActive()) {
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
    try {
      const dbRow = toDbFormat(t, record);
      const keys = Object.keys(dbRow);
      const vals = Object.values(dbRow);
      const cols = keys.map(k => `"${k}"`).join(', ');
      const params = keys.map((_, i) => '$' + (i + 1)).join(', ');
      const updates = keys.filter(k => k !== 'id').map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');

      const sql = `
        INSERT INTO public."${t}" (${cols})
        VALUES (${params})
        ON CONFLICT (id) DO UPDATE SET ${updates}
        RETURNING *;
      `;
      const { rows } = await pool.query(sql, vals);
      const saved = toAppFormat(t, rows[0]);
      lastRefresh = 0; // force immediate freshness on next cache check
      bumpRevision(t).catch(() => {});
      if (cache.tables[t]) {
        const idx = cache.tables[t].findIndex(x => x.id === saved.id);
        if (idx >= 0) cache.tables[t][idx] = saved;
        else cache.tables[t].push(saved);
      }
      return saved;
    } catch (dbErr) {
      console.warn(`Supabase save for ${t} failed (${dbErr.message}), falling back to local CSV`);
    }
  }
  const all = readLocalCSV(t);
  const idx = all.findIndex(x => x.id === record.id);
  if (idx >= 0) all[idx] = record;
  else all.push(record);
  writeLocalCSV(t, all);
  if (cache.tables[t]) {
    const cIdx = cache.tables[t].findIndex(x => x.id === record.id);
    if (cIdx >= 0) cache.tables[t][cIdx] = record;
    else cache.tables[t].push(record);
  }
  return record;
}

async function deleteRecord(t, id) {
  if (cache.tables[t]) {
    cache.tables[t] = cache.tables[t].filter(x => x.id !== id);
  }
  if (isDbActive()) {
    try {
      await pool.query(`DELETE FROM public."${t}" WHERE id = $1`, [id]);
      lastRefresh = 0; // force immediate freshness on next cache check
      bumpRevision(t).catch(() => {});
      return true;
    } catch (dbErr) {
      console.warn(`Supabase delete for ${t} failed (${dbErr.message}), falling back to local CSV`);
    }
  }
  const all = readLocalCSV(t);
  const filtered = all.filter(x => x.id !== id);
  writeLocalCSV(t, filtered);
  return true;
}

async function getSetting(key, defaultVal = {}) {
  if (cache.settings[key]) return cache.settings[key];
  if (isDbActive()) {
    const { rows } = await pool.query(`SELECT value FROM public.app_settings WHERE key = $1 LIMIT 1`, [key]);
    if (rows.length && rows[0].value) {
      cache.settings[key] = rows[0].value;
      return rows[0].value;
    }
    return defaultVal;
  }
  const p = path.join(DATA, key + '.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return defaultVal;
}

async function saveSetting(key, val) {
  cache.settings[key] = val;
  if (isDbActive()) {
    const valJson = typeof val === 'object' ? JSON.stringify(val) : val;
    await pool.query(`
      INSERT INTO public.app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    `, [key, valJson]);
    return val;
  }
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, key + '.json'), JSON.stringify(val, null, 2));
  } catch {}
  return val;
}

async function readActivity() {
  if (cache.activity && Object.keys(cache.activity).length) return cache.activity;
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
    cache.activity = result;
    return result;
  }
  const p = path.join(DATA, 'activity.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  }
  return {};
}

async function saveActivity(data) {
  cache.activity = data;
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
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'activity.json'), JSON.stringify(data, null, 2));
  } catch {}
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
  refreshCache,
  getCachedTable,
  setCachedTable,
  getCachedSetting,
  setCachedSetting,
  getCachedActivity,
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
  getRevisions,
  bumpRevision,
  pool,
  SCHEMA
};

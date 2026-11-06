-- ====================================================================
-- AMIGO ACCOUNTING APP - SUPABASE POSTGRESQL SCHEMA
-- Generated for migration from CSV to Supabase RDBMS
-- ====================================================================

-- Enable UUID extension if needed in future
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    designation TEXT,
    contact TEXT,
    email TEXT,
    photo TEXT,
    face_descriptor JSONB,
    face_required TEXT,
    otp_required TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLIENTS TABLE
CREATE TABLE IF NOT EXISTS public.clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    gstin TEXT,
    contact TEXT,
    mobile TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hsn TEXT,
    rate NUMERIC DEFAULT 0,
    gst NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. INVOICES TABLE
CREATE TABLE IF NOT EXISTS public.invoices (
    id TEXT PRIMARY KEY,
    number TEXT UNIQUE NOT NULL,
    date TEXT,
    state TEXT,
    tax_type TEXT,
    client_id TEXT,
    client_name TEXT,
    client_address TEXT,
    client_gstin TEXT,
    client_contact TEXT,
    client_mobile TEXT,
    ship_name TEXT,
    ship_address TEXT,
    ship_gstin TEXT,
    ship_contact TEXT,
    ship_mobile TEXT,
    po_number TEXT,
    po_date TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    subtotal NUMERIC DEFAULT 0,
    tax NUMERIC DEFAULT 0,
    total NUMERIC DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. PURCHASES TABLE
CREATE TABLE IF NOT EXISTS public.purchases (
    id TEXT PRIMARY KEY,
    date TEXT,
    vendor TEXT,
    description TEXT,
    amount NUMERIC DEFAULT 0,
    gst NUMERIC DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. WORK UPDATES TABLE
CREATE TABLE IF NOT EXISTS public.workupdates (
    id TEXT PRIMARY KEY,
    date TEXT,
    user_id TEXT,
    username TEXT,
    full_name TEXT,
    login_time TEXT,
    submitted_at TEXT,
    work TEXT,
    pending TEXT,
    hours TEXT,
    email_status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. LOGINS AUDIT TABLE
CREATE TABLE IF NOT EXISTS public.logins (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    login_at TEXT
);

-- 8. DOCUMENTS (Quotations / Proforma Invoices / Purchase Orders) TABLE
CREATE TABLE IF NOT EXISTS public.docs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    number TEXT NOT NULL,
    date TEXT,
    party TEXT,
    total NUMERIC DEFAULT 0,
    data JSONB DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. SHEETS TABLE
CREATE TABLE IF NOT EXISTS public.sheets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT,
    date TEXT,
    category TEXT,
    data JSONB DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. LEDGERS TABLE
CREATE TABLE IF NOT EXISTS public.ledgers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ledger_group TEXT,
    opening_balance NUMERIC DEFAULT 0,
    balance_type TEXT,
    contact TEXT,
    phone TEXT,
    gstin TEXT,
    address TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. VOUCHERS TABLE
CREATE TABLE IF NOT EXISTS public.vouchers (
    id TEXT PRIMARY KEY,
    voucher_no TEXT,
    voucher_type TEXT,
    date TEXT,
    narration TEXT,
    entries JSONB DEFAULT '[]'::jsonb,
    total NUMERIC DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. APP SETTINGS (Company, SMTP Mail, Employee Monitoring, Sync) TABLE
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. ACTIVITY LOGS (Employee Monitoring & Daily Activity Tracker) TABLE
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id TEXT PRIMARY KEY, -- usually formatted as date_userId
    date TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    login_time TEXT,
    last_seen_at TEXT,
    active_minutes NUMERIC DEFAULT 0,
    idle_minutes NUMERIC DEFAULT 0,
    status TEXT,
    actions JSONB DEFAULT '[]'::jsonb,
    offline_alert_sent BOOLEAN DEFAULT FALSE,
    offline_alert_sent_at TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====================================================================
-- INDEXES FOR HIGH QUERY PERFORMANCE
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_invoices_number ON public.invoices(number);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON public.invoices(date);
CREATE INDEX IF NOT EXISTS idx_docs_type_number ON public.docs(type, number);
CREATE INDEX IF NOT EXISTS idx_workupdates_date_user ON public.workupdates(date, user_id);
CREATE INDEX IF NOT EXISTS idx_logins_user_loginat ON public.logins(user_id, login_at);
CREATE INDEX IF NOT EXISTS idx_activity_date_user ON public.activity_logs(date, user_id);
CREATE INDEX IF NOT EXISTS idx_ledgers_name ON public.ledgers(name);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS)
-- We enable RLS and add a policy allowing service role / API full access
-- ====================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workupdates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow full access for backend API service role key
DO $$ 
DECLARE
  tbl text;
BEGIN
  FOR tbl IN 
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' 
    AND tablename IN ('users','clients','products','invoices','purchases','workupdates','logins','docs','sheets','ledgers','vouchers','app_settings','activity_logs')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access" ON public.%I;', tbl);
    EXECUTE format('CREATE POLICY "Service role full access" ON public.%I FOR ALL USING (true) WITH CHECK (true);', tbl);
  END LOOP;
END $$;

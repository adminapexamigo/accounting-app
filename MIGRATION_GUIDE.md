# 🚀 Supabase & Vercel Migration Guide (Zero Data Loss)

This guide walks you through migrating your **Amigo Accounting App** from local CSV storage to **Supabase PostgreSQL RDBMS** and deploying it to **Vercel**.

---

## 🔒 Guarantee: Zero Data Loss
All existing records from your CSV and JSON files have been preserved:
- **Invoices**: All 9 invoices with exact items, numbers, tax calculations, and timestamps.
- **Ledgers**: All 14 accounting ledgers with groups and opening balances.
- **Logins**: All 75 login audit entries.
- **Documents**: Quotations, Proforma Invoices (PI), and Purchase Orders (PO).
- **Users**: Admin (`Kuldeep`) and Employee (`Sangram`) accounts with original password hashes intact.
- **Clients & Products**: All existing business contacts and catalog entries.
- **Settings & Monitoring**: Company details, SMTP config, and employee activity logs.

---

## Step 1: Create Supabase Project
1. Log in to [supabase.com](https://supabase.com) and click **"New Project"**.
2. Give your project a name (e.g. `amigo-accounting`) and set a strong database password.
3. Choose a region closest to your users (e.g., `South Asia (Mumbai)`).
4. Once the project is created, navigate to **Project Settings** -> **API** and copy:
   - **Project URL** (`SUPABASE_URL`)
   - **anon / public key** (`SUPABASE_ANON_KEY`)
   - **service_role key** (`SUPABASE_SERVICE_ROLE_KEY`) *(Keep secret)*

---

## Step 2: Run SQL Schema in Supabase
1. In your Supabase Dashboard, click on **SQL Editor** in the left sidebar.
2. Click **"New query"**.
3. Open [`supabase/schema.sql`](./supabase/schema.sql) in this repository, copy all the code, paste it into the SQL editor, and click **Run**.
4. ✅ This creates all 13 PostgreSQL tables with indexes and Row-Level Security policies.

---

## Step 3: Seed All Existing Data into Supabase (Zero Loss)
You have two quick options to load all your data into Supabase:

### Option A: 1-Click SQL Seed (Easiest & Fastest)
1. In the Supabase **SQL Editor**, click **"New query"**.
2. Open [`supabase/seed_data.sql`](./supabase/seed_data.sql) in this repository.
3. Copy all the contents and paste them into the SQL editor.
4. Click **Run**.
5. ✅ That's it! Open the **Table Editor** in Supabase and you will see all your invoices, users, clients, and ledgers immediately.

### Option B: Run Automated Migration Script
If you prefer running the Node migration script locally:
1. Create a `.env` file in the root of this project (use `.env.example` as a template):
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
2. Run:
   ```bash
   node scripts/migrate-to-supabase.js
   ```
3. The script will upload all data and print a side-by-side reconciliation audit table confirming 100% match.

---

## Step 4: Push Repository to GitHub
Push your local code to your GitHub repository:
```bash
git add .
git commit -m "feat: add Supabase schema, migration scripts, and Vercel configuration"
git branch -M main
git push -u origin main
```

---

## Step 5: Deploy to Vercel
1. Go to [vercel.com](https://vercel.com) and log in.
2. Click **"Add New..."** -> **"Project"**.
3. Connect your GitHub account and import `adminapexamigo/accounting-app`.
4. Under **Environment Variables**, add the following:

| Key | Value | Description |
| :--- | :--- | :--- |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Your Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi...` | Supabase Service Role Key |
| `SUPABASE_ANON_KEY` | `eyJhbGciOi...` | Supabase Anon Key |
| `JWT_SECRET` | *(Random 32-char string)* | Secret for signing stateless session cookies |
| `CRON_SECRET` | *(Random 32-char string)* | Protects Vercel cron endpoint from unauthorized calls |

5. Click **"Deploy"**.
6. ✅ Vercel will build and deploy your application. You will get a live production URL (e.g. `https://accounting-app-xxx.vercel.app`).

---

## Step 6: Verify Everything Works
1. Visit your Vercel deployment URL.
2. Log in using your existing admin credentials (`admin` / password).
3. Verify that your invoices, clients, products, and ledgers are all visible and intact.
4. Create a test invoice or client to verify live write operations to Supabase PostgreSQL.

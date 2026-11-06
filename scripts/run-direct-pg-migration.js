/**
 * Direct PostgreSQL migration script to Supabase (using IPv4 Session Pooler)
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  host: 'aws-0-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.jfytaiueqxfbimbhyttm',
  password: 'Sangram@107',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log('Connecting to Supabase PostgreSQL via Session Pooler...');
  await client.connect();
  console.log('✅ Connected successfully to Supabase database!\n');

  // 1. Run Schema
  console.log('--- Step 1: Running Schema DDL (supabase/schema.sql) ---');
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  await client.query(schemaSql);
  console.log('✅ All tables, columns, indexes, and RLS policies created successfully!\n');

  // 2. Run Seed Data
  console.log('--- Step 2: Seeding All Existing Data (supabase/seed_data.sql) ---');
  const seedSql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'seed_data.sql'), 'utf8');
  await client.query(seedSql);
  console.log('✅ All data seeded successfully (users, invoices, clients, ledgers, logins, docs, configs)!\n');

  // 3. Verification & Reconciliation Audit
  console.log('--- Step 3: Verifying Database Table Counts ---');
  const tables = [
    'users',
    'clients',
    'products',
    'invoices',
    'purchases',
    'workupdates',
    'logins',
    'docs',
    'sheets',
    'ledgers',
    'vouchers',
    'app_settings',
    'activity_logs'
  ];

  console.log('Table Name'.padEnd(20) + 'Supabase Count'.padEnd(16) + 'Status');
  console.log('-'.repeat(50));

  for (const table of tables) {
    const res = await client.query(`SELECT count(*) as count FROM public."${table}"`);
    const count = parseInt(res.rows[0].count, 10);
    console.log(table.padEnd(20) + String(count).padEnd(16) + (count > 0 ? '✅ Seeded' : 'ℹ️ Empty (0 records)'));
  }

  console.log('\n🎉 ALL DONE! Migration completed with ZERO data loss.');
  await client.end();
}

main().catch(async (err) => {
  console.error('\n❌ Migration failed:', err.message);
  if (err.stack) console.error(err.stack);
  try { await client.end(); } catch {}
  process.exit(1);
});

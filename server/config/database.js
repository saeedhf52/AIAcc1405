const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/accounting.db');

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

function initDatabase() {
  db.exec(`
    -- 1. جدول اشخاص (Parties)
    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      phone TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. جدول دسته‌بندی‌ها (Categories)
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      type TEXT CHECK(type IN ('income', 'expense', 'both')) DEFAULT 'expense',
      icon TEXT DEFAULT 'tag',
      color TEXT DEFAULT '#3B82F6'
    );

    -- 3. جدول فرم ثبت تراکنش (Transactions)
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ایجاد بدهی', 'پرداخت', 'ایجاد طلب', 'دریافت')),
      party_id INTEGER,
      party_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      category_id INTEGER,
      description TEXT,
      tracking_code TEXT,
      reconciliation_status TEXT CHECK(reconciliation_status IN ('unreconciled', 'matched', 'partially')) DEFAULT 'unreconciled',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(party_id) REFERENCES parties(id) ON DELETE SET NULL,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    -- 4. جدول رسیدهای واریزی (Receipts)
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_number INTEGER,
      date TEXT NOT NULL,
      description TEXT,
      party_name TEXT,
      party_id INTEGER,
      account_number TEXT,
      amount INTEGER NOT NULL,
      source TEXT,
      document_number TEXT,
      dedup_hash TEXT UNIQUE,
      reconciliation_status TEXT CHECK(reconciliation_status IN ('unreconciled', 'matched', 'partially')) DEFAULT 'unreconciled',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(party_id) REFERENCES parties(id) ON DELETE SET NULL
    );

    -- 5. جدول خلاصه دفتر حساب (Ledger Summaries)
    CREATE TABLE IF NOT EXISTS ledger_summaries (
      party_name TEXT PRIMARY KEY,
      party_id INTEGER,
      total_claim INTEGER DEFAULT 0,
      total_paid INTEGER DEFAULT 0,
      balance INTEGER DEFAULT 0,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(party_id) REFERENCES parties(id) ON DELETE CASCADE
    );

    -- 6. جدول بودجه‌بندی (Budgets)
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      period_jalali TEXT NOT NULL,
      budget_limit INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE(category_id, period_jalali)
    );

    -- 7. جدول تاریخچه AI (AI Logs)
    CREATE TABLE IF NOT EXISTS ai_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input_type TEXT CHECK(input_type IN ('text', 'audio')) NOT NULL,
      raw_prompt TEXT,
      intent TEXT,
      response_json TEXT,
      status TEXT CHECK(status IN ('success', 'error', 'clarify')) DEFAULT 'success',
      execution_time_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ==========================================
    -- سیستم جدید حسابداری دوبل (Double-Entry Accounting)
    -- ==========================================

    -- 8. جدول کدینگ حساب‌ها (Chart of Accounts)
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      type TEXT CHECK(type IN ('asset', 'liability', 'equity', 'revenue', 'expense')) NOT NULL,
      parent_id INTEGER,
      FOREIGN KEY(parent_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    -- 9. جدول اسناد حسابداری / دفتر روزنامه (Journal Vouchers)
    CREATE TABLE IF NOT EXISTS journal_vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_number INTEGER UNIQUE NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      source_type TEXT CHECK(source_type IN ('TRANSACTION', 'RECEIPT', 'MANUAL')) DEFAULT 'MANUAL',
      source_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 10. جدول آرتیکل‌های سند بدهکار/بستانکار (Journal Entries)
    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      party_id INTEGER,
      debit INTEGER DEFAULT 0,
      credit INTEGER DEFAULT 0,
      description TEXT,
      FOREIGN KEY(voucher_id) REFERENCES journal_vouchers(id) ON DELETE CASCADE,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
      FOREIGN KEY(party_id) REFERENCES parties(id) ON DELETE SET NULL
    );

    -- ==========================================
    -- سیستم تایید هوشمند اشخاص (Party Pending Confirmations)
    -- ==========================================

    -- 11. جدول تاییدهای معلق هوش مصنوعی
    CREATE TABLE IF NOT EXISTS pending_confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input_type TEXT NOT NULL,
      suggested_party_name TEXT NOT NULL,
      candidate_party_id INTEGER,
      candidate_party_name TEXT,
      similarity_score REAL,
      intent_data TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'confirmed_existing', 'created_new', 'rejected')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ==========================================
    -- سیستم مغایرت‌یابی و اقلام باز (Reconciliations)
    -- ==========================================

    -- 12. جدول پیوند مغایرت‌یابی و مطابقت رسید با تراکنش
    CREATE TABLE IF NOT EXISTS reconciliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL,
      transaction_id INTEGER NOT NULL,
      matched_amount INTEGER NOT NULL,
      match_type TEXT CHECK(match_type IN ('auto_doc', 'auto_amount', 'manual')) DEFAULT 'manual',
      reconciled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
      FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    );
  `);

  // مایگریشن خودکار افزودن ستون‌های مورد نیاز به دیتابیس‌های موجود
  try {
    const receiptCols = db.prepare("PRAGMA table_info(receipts)").all().map(c => c.name);
    if (!receiptCols.includes('reconciliation_status')) {
      db.exec("ALTER TABLE receipts ADD COLUMN reconciliation_status TEXT CHECK(reconciliation_status IN ('unreconciled', 'matched', 'partially')) DEFAULT 'unreconciled'");
      db.exec("UPDATE receipts SET reconciliation_status = 'unreconciled' WHERE reconciliation_status IS NULL");
    }

    const txCols = db.prepare("PRAGMA table_info(transactions)").all().map(c => c.name);
    if (!txCols.includes('reconciliation_status')) {
      db.exec("ALTER TABLE transactions ADD COLUMN reconciliation_status TEXT CHECK(reconciliation_status IN ('unreconciled', 'matched', 'partially')) DEFAULT 'unreconciled'");
      db.exec("UPDATE transactions SET reconciliation_status = 'unreconciled' WHERE reconciliation_status IS NULL");
    }

    if (!txCols.includes('dedup_hash')) {
      db.exec("ALTER TABLE transactions ADD COLUMN dedup_hash TEXT");
    }
  } catch (err) {
    console.error('[Database Migration Error]:', err.message);
  }

  // ثبت حساب‌های پایه دوبل
  const accountCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get().count;
  if (accountCount === 0) {
    const insertAcc = db.prepare('INSERT INTO accounts (code, title, type, parent_id) VALUES (?, ?, ?, ?)');
    const defaultAccounts = [
      ['101', 'موجودی نقد و بانک‌ها', 'asset', null],
      ['102', 'حساب‌ها و اسناد دریافتنی (اشخاص)', 'asset', null],
      ['201', 'حساب‌ها و اسناد پرداختنی (بدهی‌ها)', 'liability', null],
      ['401', 'درآمدهای پروژه و خدمات', 'revenue', null],
      ['501', 'هزینه‌های ساخت و جاری', 'expense', null],
      ['301', 'سرمایه و جاری شرکا', 'equity', null]
    ];
    defaultAccounts.forEach(acc => insertAcc.run(acc[0], acc[1], acc[2], acc[3]));
  }
}

initDatabase();

module.exports = db;

// همگام‌سازی پس از خروجی db جهت جلوگیری از Circular Dependency
setTimeout(() => {
  try {
    const { recalculateAllLedgers } = require('../services/ledgerService');
    const { syncAllTransactionsToJournal } = require('../services/accountingService');
    recalculateAllLedgers();
    syncAllTransactionsToJournal();
  } catch (err) {
    console.error('[Database Post-Init Sync Error]:', err.message);
  }
}, 0);

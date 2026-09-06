const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const DB_TYPE = process.env.DB_TYPE || 'sqlite'; // 'sqlite' یا 'cloudflare_d1'
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '0279c0aafb24e4760c977338de646f6e';
const CLOUDFLARE_DATABASE_ID = process.env.CLOUDFLARE_DATABASE_ID || 'c6414ff9-6474-459e-b462-5ef6948125a1';
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

let nativeDb = null;
if (DB_TYPE === 'sqlite') {
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/accounting.db');
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  nativeDb = new Database(dbPath);
  nativeDb.pragma('foreign_keys = ON');
  nativeDb.pragma('journal_mode = WAL');
}

// لایه آداپتور هوشمند دو حالته (SQLite محلی برای توسعه / Cloudflare D1 REST API برای Render)
class DatabaseAdapter {
  constructor() {
    this.isD1 = DB_TYPE === 'cloudflare_d1';
    this.cfUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CLOUDFLARE_DATABASE_ID}/query`;
  }

  // متد کمکی اجرای کوئری در Cloudflare D1 به روش همگام از طریق sync request یا پشتیبانی درون برنامه‌ای
  async queryD1(sql, params = []) {
    if (!CLOUDFLARE_API_TOKEN) {
      throw new Error('[Cloudflare D1 Error]: CLOUDFLARE_API_TOKEN set نشده است.');
    }
    const response = await axios.post(
      this.cfUrl,
      { sql, params },
      {
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const result = response.data.result[0];
    return result;
  }

  prepare(sql) {
    const adapter = this;

    return {
      get(...params) {
        if (adapter.isD1) {
          // در کدهای سینکرون Node با کارهای async هماهنگ می‌شود
          return adapter.getD1Sync(sql, params);
        }
        return nativeDb.prepare(sql).get(...params);
      },
      all(...params) {
        if (adapter.isD1) {
          return adapter.allD1Sync(sql, params);
        }
        return nativeDb.prepare(sql).all(...params);
      },
      run(...params) {
        if (adapter.isD1) {
          return adapter.runD1Sync(sql, params);
        }
        return nativeDb.prepare(sql).run(...params);
      }
    };
  }

  exec(sql) {
    if (this.isD1) {
      return this.execD1Sync(sql);
    }
    return nativeDb.exec(sql);
  }

  // --- شبیه‌ساز همگام برای متدهای همگام موجود پروژه ---
  getD1Sync(sql, params) {
    const deasync = require('deasync');
    let done = false;
    let data = null;
    let err = null;

    this.queryD1(sql, params)
      .then(res => { data = res.results && res.results[0] ? res.results[0] : null; done = true; })
      .catch(e => { err = e; done = true; });

    deasync.loopWhile(() => !done);
    if (err) throw err;
    return data;
  }

  allD1Sync(sql, params) {
    const deasync = require('deasync');
    let done = false;
    let data = null;
    let err = null;

    this.queryD1(sql, params)
      .then(res => { data = res.results || []; done = true; })
      .catch(e => { err = e; done = true; });

    deasync.loopWhile(() => !done);
    if (err) throw err;
    return data;
  }

  runD1Sync(sql, params) {
    const deasync = require('deasync');
    let done = false;
    let data = null;
    let err = null;

    this.queryD1(sql, params)
      .then(res => {
        data = {
          changes: res.meta ? res.meta.changes : 0,
          lastInsertRowid: res.meta ? res.meta.last_row_id : null
        };
        done = true;
      })
      .catch(e => { err = e; done = true; });

    deasync.loopWhile(() => !done);
    if (err) throw err;
    return data;
  }

  execD1Sync(sql) {
    const deasync = require('deasync');
    let done = false;
    let err = null;

    this.queryD1(sql, [])
      .then(() => { done = true; })
      .catch(e => { err = e; done = true; });

    deasync.loopWhile(() => !done);
    if (err) throw err;
  }
}

const db = new DatabaseAdapter();

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
      dedup_hash TEXT,
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

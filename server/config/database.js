const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/accounting.db');

// مطمئن شدن از وجود پوشه data
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// فعال کردن کلیدهای خارجی و کارایی بالا
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
  `);

  // ثبت چند دسته‌بندی پیش‌فرض در صورت خالی بودن
  const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (catCount === 0) {
    const insertCat = db.prepare('INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)');
    const defaultCats = [
      ['ساخت و ساز', 'expense', 'building', '#EF4444'],
      ['خرید زمین', 'expense', 'map-pin', '#F59E0B'],
      ['حق الزحمه و دستمزد', 'expense', 'users', '#10B981'],
      ['حمل و نقل و کرایه', 'expense', 'truck', '#6366F1'],
      ['تاسیسات و ابزار', 'expense', 'wrench', '#8B5CF6'],
      ['متفرقه', 'both', 'grid', '#6B7280']
    ];
    defaultCats.forEach(c => insertCat.run(c[0], c[1], c[2], c[3]));
  }
}

initDatabase();

module.exports = db;

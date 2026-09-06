const db = require('../config/database');
const { getFormattedJalaliDate } = require('./jalaliUtils');

// دریافت کدهای حساب‌ها
function getAccountByCode(code) {
  return db.prepare('SELECT * FROM accounts WHERE code = ?').get(code);
}

// تولید شماره سند بعدی
function getNextVoucherNumber() {
  const row = db.prepare('SELECT MAX(voucher_number) as maxNum FROM journal_vouchers').get();
  return (row.maxNum || 0) + 1;
}

// ثبت خودکار سند حسابداری دوبل برای تراکنش
function createJournalVoucherForTransaction(tx) {
  // tx: { id, date, type, party_id, party_name, amount, description }
  const bankAcc = getAccountByCode('101');     // موجودی نقد و بانک
  const recAcc = getAccountByCode('102');      // حساب‌های دریافتنی (طلب)
  const payAcc = getAccountByCode('201');      // حساب‌های پرداختنی (بدهی)
  const expenseAcc = getAccountByCode('501');  // هزینه‌ها
  const revenueAcc = getAccountByCode('401');  // درآمدها

  const voucherNumber = getNextVoucherNumber();
  const desc = `سند تراکنش ${tx.type} - ${tx.party_name} - ${tx.description || ''}`;

  const voucherStmt = db.prepare(`
    INSERT INTO journal_vouchers (voucher_number, date, description, source_type, source_id)
    VALUES (?, ?, ?, 'TRANSACTION', ?)
  `);
  const voucherRes = voucherStmt.run(voucherNumber, tx.date || getFormattedJalaliDate(), desc, tx.id);
  const voucherId = voucherRes.lastInsertRowid;

  const entryStmt = db.prepare(`
    INSERT INTO journal_entries (voucher_id, account_id, party_id, debit, credit, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // الگوهای ثبت دوبل:
  if (tx.type === 'ایجاد طلب') {
    // بدهکار: حساب‌های دریافتنی / بستانکار: درآمدهای خدمات
    entryStmt.run(voucherId, recAcc.id, tx.party_id, tx.amount, 0, tx.description);
    entryStmt.run(voucherId, revenueAcc.id, null, 0, tx.amount, tx.description);
  } else if (tx.type === 'ایجاد بدهی') {
    // بدهکار: هزینه‌های جاری / بستانکار: حساب‌های پرداختنی (اشخاص)
    entryStmt.run(voucherId, expenseAcc.id, null, tx.amount, 0, tx.description);
    entryStmt.run(voucherId, payAcc.id, tx.party_id, 0, tx.amount, tx.description);
  } else if (tx.type === 'دریافت') {
    // بدهکار: بانک / بستانکار: حساب‌های دریافتنی (اشخاص)
    entryStmt.run(voucherId, bankAcc.id, null, tx.amount, 0, tx.description);
    entryStmt.run(voucherId, recAcc.id, tx.party_id, 0, tx.amount, tx.description);
  } else if (tx.type === 'پرداخت') {
    // بدهکار: حساب‌های پرداختنی (اشخاص) / بستانکار: بانک
    entryStmt.run(voucherId, payAcc.id, tx.party_id, tx.amount, 0, tx.description);
    entryStmt.run(voucherId, bankAcc.id, null, 0, tx.amount, tx.description);
  }

  return voucherId;
}

// گزارش دفتر روزنامه (General Journal)
function getGeneralJournal() {
  const vouchers = db.prepare(`
    SELECT jv.*,
      (SELECT SUM(debit) FROM journal_entries WHERE voucher_id = jv.id) as total_debit,
      (SELECT SUM(credit) FROM journal_entries WHERE voucher_id = jv.id) as total_credit
    FROM journal_vouchers jv
    ORDER BY jv.voucher_number DESC
  `).all();

  vouchers.forEach(v => {
    v.entries = db.prepare(`
      SELECT je.*, a.code as account_code, a.title as account_title, p.name as party_name
      FROM journal_entries je
      JOIN accounts a ON je.account_id = a.id
      LEFT JOIN parties p ON je.party_id = p.id
      WHERE je.voucher_id = ?
    `).all(v.id);
  });

  return vouchers;
}

// گزارش دفتر کل (General Ledger)
function getGeneralLedger(accountId) {
  const query = `
    SELECT je.*, jv.voucher_number, jv.date, jv.description as voucher_desc,
           a.title as account_title, p.name as party_name
    FROM journal_entries je
    JOIN journal_vouchers jv ON je.voucher_id = jv.id
    JOIN accounts a ON je.account_id = a.id
    LEFT JOIN parties p ON je.party_id = p.id
    ${accountId ? 'WHERE je.account_id = ?' : ''}
    ORDER BY jv.voucher_number ASC, je.id ASC
  `;

  return accountId ? db.prepare(query).all(accountId) : db.prepare(query).all();
}

// گزارش دفتر معین اشخاص (Subsidiary Ledger)
function getSubsidiaryLedger(partyId) {
  const query = `
    SELECT je.*, jv.voucher_number, jv.date, jv.description as voucher_desc,
           a.title as account_title, p.name as party_name
    FROM journal_entries je
    JOIN journal_vouchers jv ON je.voucher_id = jv.id
    JOIN accounts a ON je.account_id = a.id
    JOIN parties p ON je.party_id = p.id
    ${partyId ? 'WHERE je.party_id = ?' : ''}
    ORDER BY jv.voucher_number ASC, je.id ASC
  `;

  const entries = partyId ? db.prepare(query).all(partyId) : db.prepare(query).all();

  // محاسبه مانده شناور (Running Balance)
  let runningBalance = 0;
  return entries.map(entry => {
    runningBalance += (entry.debit - entry.credit);
    return {
      ...entry,
      balance: runningBalance,
      balance_type: runningBalance >= 0 ? 'بدهکار' : 'بستانکار'
    };
  });
}

// تراز آزمایشی (Trial Balance)
function getTrialBalance() {
  const rows = db.prepare(`
    SELECT a.id, a.code, a.title, a.type,
           SUM(je.debit) as total_debit,
           SUM(je.credit) as total_credit
    FROM accounts a
    LEFT JOIN journal_entries je ON a.id = je.account_id
    GROUP BY a.id
    ORDER BY a.code ASC
  `).all();

  return rows.map(r => {
    const debit = r.total_debit || 0;
    const credit = r.total_credit || 0;
    const balance = debit - credit;
    return {
      ...r,
      total_debit: debit,
      total_credit: credit,
      balance: Math.abs(balance),
      balance_type: balance >= 0 ? 'بدهکار' : 'بستانکار'
    };
  });
}

// ثبت خودکار سند حسابداری دوبل برای رسید بانکی
function createJournalVoucherForReceipt(receipt) {
  // receipt: { id, date, party_id, party_name, amount, description, document_number }
  const bankAcc = getAccountByCode('101');     // موجودی نقد و بانک
  const recAcc = getAccountByCode('102');      // حساب‌های دریافتنی (اشخاص)

  const voucherNumber = getNextVoucherNumber();
  const partyNameStr = receipt.party_name || 'ناشناس';
  const desc = `سند رسید واریزی بانکی - ${partyNameStr} - ${receipt.description || ''} (شماره سند/پیگیری: ${receipt.document_number || 'نامشخص'})`;

  const voucherStmt = db.prepare(`
    INSERT INTO journal_vouchers (voucher_number, date, description, source_type, source_id)
    VALUES (?, ?, ?, 'RECEIPT', ?)
  `);
  const voucherRes = voucherStmt.run(voucherNumber, receipt.date || getFormattedJalaliDate(), desc, receipt.id);
  const voucherId = voucherRes.lastInsertRowid;

  const entryStmt = db.prepare(`
    INSERT INTO journal_entries (voucher_id, account_id, party_id, debit, credit, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // الگو: بدهکار: موجودی نقد و بانک‌ها (۱۰۱) / بستانکار: حساب‌های دریافتنی - تفصیلی شخص (۱۰۲)
  entryStmt.run(voucherId, bankAcc.id, null, receipt.amount, 0, desc);
  entryStmt.run(voucherId, recAcc.id, receipt.party_id || null, 0, receipt.amount, desc);

  return voucherId;
}

// اسکریپت همگام‌سازی کامل رترواکتیو (تراکنش‌ها و رسیدها)
function syncAllTransactionsToJournal() {
  db.prepare('DELETE FROM journal_entries').run();
  db.prepare('DELETE FROM journal_vouchers').run();

  const txs = db.prepare('SELECT * FROM transactions ORDER BY id ASC').all();
  txs.forEach(tx => {
    createJournalVoucherForTransaction(tx);
  });

  const receipts = db.prepare('SELECT * FROM receipts ORDER BY id ASC').all();
  receipts.forEach(rec => {
    createJournalVoucherForReceipt(rec);
  });

  console.log(`[AccountingService] ${txs.length} تراکنش و ${receipts.length} رسید واریزی به اسناد دوبل تبدیل و ثبت شد.`);
}

module.exports = {
  createJournalVoucherForTransaction,
  createJournalVoucherForReceipt,
  getGeneralJournal,
  getGeneralLedger,
  getSubsidiaryLedger,
  getTrialBalance,
  syncAllTransactionsToJournal
};

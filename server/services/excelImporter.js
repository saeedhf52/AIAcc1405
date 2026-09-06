const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { normalizeNumbers, getFormattedJalaliDate, parseAmount } = require('./jalaliUtils');
const { recalculateAllLedgers } = require('./ledgerService');
const { syncAllTransactionsToJournal } = require('./accountingService');
const { findMatchingParty } = require('./partyMatcher');

function importExcelData(excelPath) {
  const targetPath = excelPath || process.env.EXCEL_SOURCE_PATH || 'D:\\SaeedHf52\\AiAcc1405\\Acc1405.xlsx';

  if (!fs.existsSync(targetPath)) {
    console.warn(`[ExcelImporter] فایل اکسل در مسیر ${targetPath} یافت نشد.`);
    return { success: false, message: 'فایل یافت نشد' };
  }

  console.log(`[ExcelImporter] در حال خواندن فایل اکسل: ${targetPath}`);
  const workbook = xlsx.readFile(targetPath);

  // 1. امپورت اشخاص از شیت 'اشخاص'
  if (workbook.SheetNames.includes('اشخاص')) {
    const sheet = workbook.Sheets['اشخاص'];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    const insertParty = db.prepare('INSERT OR IGNORE INTO parties (name) VALUES (?)');

    let importedParties = 0;
    for (let i = 1; i < rows.length; i++) {
      const name = normalizeNumbers(rows[i][0]);
      if (name) {
        insertParty.run(name);
        importedParties++;
      }
    }
    console.log(`[ExcelImporter] ${importedParties} طرف حساب وارد شد.`);
  }

  // 2. امپورت تراکنش‌ها از شیت 'فرم ثبت تراکنش'
  if (workbook.SheetNames.includes('فرم ثبت تراکنش')) {
    const sheet = workbook.Sheets['فرم ثبت تراکنش'];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    const getPartyId = db.prepare('SELECT id FROM parties WHERE name = ?');
    const insertParty = db.prepare('INSERT OR IGNORE INTO parties (name) VALUES (?)');
    const insertTx = db.prepare(`
      INSERT INTO transactions (date, type, party_id, party_name, amount, description, tracking_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // پاکسازی تراکنش‌های قدیمی برای جابجایی تکراری
    db.prepare('DELETE FROM transactions').run();

    let importedTxs = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;

      const rawDate = r[0];
      const type = normalizeNumbers(r[1]);
      const partyName = normalizeNumbers(r[2]);
      const amount = parseAmount(r[3]);
      const description = normalizeNumbers(r[4]);
      const trackingCode = normalizeNumbers(r[5]);

      if (!partyName || amount === 0) continue;

      const formattedDate = getFormattedJalaliDate(rawDate);

      // ثبت شخص در صورت عدم وجود
      insertParty.run(partyName);
      const partyObj = getPartyId.get(partyName);
      const partyId = partyObj ? partyObj.id : null;

      insertTx.run(formattedDate, type || 'ایجاد بدهی', partyId, partyName, amount, description || '', trackingCode || '');
      importedTxs++;
    }
    console.log(`[ExcelImporter] ${importedTxs} تراکنش وارد شد.`);
  }

  // 3. امپورت رسیدها از شیت 'رسیدهای واریزی'
  if (workbook.SheetNames.includes('رسیدهای واریزی')) {
    const sheet = workbook.Sheets['رسیدهای واریزی'];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    const getPartyId = db.prepare('SELECT id FROM parties WHERE name = ?');
    const insertReceipt = db.prepare(`
      INSERT OR IGNORE INTO receipts
      (row_number, date, description, party_name, party_id, account_number, amount, source, document_number, dedup_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.prepare('DELETE FROM receipts').run();

    let importedReceipts = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;

      const rowNum = parseAmount(r[0]);
      const formattedDate = getFormattedJalaliDate(r[1]);
      const description = normalizeNumbers(r[2]);
      const partyName = normalizeNumbers(r[3]);
      const accountNumber = normalizeNumbers(r[4]);
      const amount = parseAmount(r[5]);
      const source = normalizeNumbers(r[6]);
      const docNum = normalizeNumbers(r[7]);

      if (amount === 0) continue;

      const partyObj = partyName ? getPartyId.get(partyName) : null;
      const partyId = partyObj ? partyObj.id : null;

      // کلید یکتا برای جلوگیری از ثبت تکراری
      const dedupHash = docNum ? docNum : `${formattedDate}_${amount}_${partyName}`;

      insertReceipt.run(rowNum, formattedDate, description, partyName, partyId, accountNumber, amount, source, docNum, dedupHash);
      importedReceipts++;
    }
    console.log(`[ExcelImporter] ${importedReceipts} رسید واریزی وارد شد.`);
  }

  // 4. بازنویسی و محاسبه مجدد خلاصه دفتر حساب و اسناد حسابداری دوبل
  recalculateAllLedgers();
  syncAllTransactionsToJournal();
  console.log('[ExcelImporter] دفتر حساب و اسناد دوبل کامل بازنویسی و به‌روزرسانی شد.');

  return { success: true };
}

// اگر مستقیما اجرا شد
if (require.main === module) {
  importExcelData();
}

module.exports = importExcelData;

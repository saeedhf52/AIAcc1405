const db = require('../config/database');
const { similarity } = require('./partyMatcher');

// دریافت لیست رسیدهای واریزی بلاتکلیف (تسویه‌نشده)
function getUnreconciledReceipts() {
  return db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM reconciliations WHERE receipt_id = r.id) as match_count
    FROM receipts r
    WHERE r.reconciliation_status = 'unreconciled' OR r.reconciliation_status IS NULL
    ORDER BY r.id DESC
  `).all();
}

// دریافت لیست تراکنش‌ها و بدهی‌های تسویه‌نشده (اقلام باز)
function getOpenTransactions() {
  return db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM reconciliations WHERE transaction_id = t.id) as match_count
    FROM transactions t
    WHERE t.reconciliation_status = 'unreconciled' OR t.reconciliation_status IS NULL
    ORDER BY t.id DESC
  `).all();
}

// موتور تطبیق اتوماتیک (Auto Reconciliation Engine)
function runAutoReconciliation() {
  const openReceipts = getUnreconciledReceipts();
  const openTxs = getOpenTransactions();

  let matchedCount = 0;

  const insertMatch = db.prepare(`
    INSERT INTO reconciliations (receipt_id, transaction_id, matched_amount, match_type)
    VALUES (?, ?, ?, ?)
  `);

  const updateReceiptStatus = db.prepare(`
    UPDATE receipts SET reconciliation_status = 'matched' WHERE id = ?
  `);

  const updateTxStatus = db.prepare(`
    UPDATE transactions SET reconciliation_status = 'matched' WHERE id = ?
  `);

  openReceipts.forEach(receipt => {
    // 1. تطبیق بر اساس شماره سند/پیگیری کپی‌شده
    let matchedTx = null;
    let matchType = 'manual';

    if (receipt.document_number) {
      matchedTx = openTxs.find(t => t.tracking_code && t.tracking_code === receipt.document_number && t.reconciliation_status !== 'matched');
      if (matchedTx) matchType = 'auto_doc';
    }

    // 2. تطبیق بر اساس مبلغ دقیق + تشابه اسمی اشخاص (با الگوریتم Levenshtein)
    if (!matchedTx && receipt.party_name && receipt.amount) {
      matchedTx = openTxs.find(t => {
        if (t.reconciliation_status === 'matched' || t.amount !== receipt.amount) return false;
        if (!t.party_name) return false;
        const score = similarity(receipt.party_name, t.party_name);
        return score >= 0.75;
      });
      if (matchedTx) matchType = 'auto_amount';
    }

    // اگر تطبیقی پیدا شد، پیوند داده شود
    if (matchedTx) {
      insertMatch.run(receipt.id, matchedTx.id, receipt.amount, matchType);
      updateReceiptStatus.run(receipt.id);
      updateTxStatus.run(matchedTx.id);

      receipt.reconciliation_status = 'matched';
      matchedTx.reconciliation_status = 'matched';
      matchedCount++;
    }
  });

  return {
    success: true,
    matchedCount,
    message: `✅ موتور مغایرت‌یابی هوشمند **${matchedCount}** رسید بلاتکلیف را با تراکنش‌های اقلام باز با موفقیت تطبیق داد.`
  };
}

// تطبیق دستی توسط کاربر
function manualReconcile(receiptId, transactionId) {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);

  if (!receipt || !tx) {
    return { success: false, message: 'رسید یا تراکنش مورد نظر یافت نشد.' };
  }

  const matchedAmount = Math.min(receipt.amount, tx.amount);

  db.prepare(`
    INSERT INTO reconciliations (receipt_id, transaction_id, matched_amount, match_type)
    VALUES (?, ?, ?, 'manual')
  `).run(receiptId, transactionId, matchedAmount);

  db.prepare("UPDATE receipts SET reconciliation_status = 'matched' WHERE id = ?").run(receiptId);
  db.prepare("UPDATE transactions SET reconciliation_status = 'matched' WHERE id = ?").run(transactionId);

  return {
    success: true,
    message: 'تطبیق و مغایرت‌یابی دستی با موفقیت انجام شد.'
  };
}

// گزارش کامل تمام تطبیق‌های انجام‌شده
function getAllReconciliations() {
  return db.prepare(`
    SELECT rec.id, rec.matched_amount, rec.match_type, rec.reconciled_at,
           r.date as receipt_date, r.party_name as receipt_party, r.amount as receipt_amount, r.document_number,
           t.date as tx_date, t.party_name as tx_party, t.type as tx_type, t.amount as tx_amount
    FROM reconciliations rec
    JOIN receipts r ON rec.receipt_id = r.id
    JOIN transactions t ON rec.transaction_id = t.id
    ORDER BY rec.id DESC
  `).all();
}

module.exports = {
  getUnreconciledReceipts,
  getOpenTransactions,
  runAutoReconciliation,
  manualReconcile,
  getAllReconciliations
};

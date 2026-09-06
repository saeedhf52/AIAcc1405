const db = require('../config/database');

function recalculateLedgerForParty(partyName) {
  if (!partyName) return;

  // گرفتن party_id
  const party = db.prepare('SELECT id FROM parties WHERE name = ?').get(partyName);
  const partyId = party ? party.id : null;

  // 1. تراکنش‌ها
  const txRows = db.prepare('SELECT type, amount FROM transactions WHERE party_name = ?').all(partyName);
  let totalClaim = 0;
  let totalPaid = 0;

  txRows.forEach(row => {
    if (row.type === 'ایجاد طلب' || row.type === 'ایجاد بدهی') {
      totalClaim += row.amount;
    } else if (row.type === 'پرداخت' || row.type === 'دریافت') {
      totalPaid += row.amount;
    }
  });

  // 2. رسیدهای واریزی بانکی (پرداخت‌های دریافتی از طرف حساب)
  const receiptRows = db.prepare('SELECT amount FROM receipts WHERE party_name = ?').all(partyName);
  receiptRows.forEach(row => {
    totalPaid += row.amount;
  });

  const balance = totalClaim - totalPaid;

  // به‌روزرسانی خلاصه دفتر حساب
  const upsert = db.prepare(`
    INSERT INTO ledger_summaries (party_name, party_id, total_claim, total_paid, balance, last_updated)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(party_name) DO UPDATE SET
      party_id = excluded.party_id,
      total_claim = excluded.total_claim,
      total_paid = excluded.total_paid,
      balance = excluded.balance,
      last_updated = CURRENT_TIMESTAMP
  `);

  upsert.run(partyName, partyId, totalClaim, totalPaid, balance);
}

function recalculateAllLedgers() {
  const parties = db.prepare('SELECT name FROM parties').all();
  parties.forEach(p => recalculateLedgerForParty(p.name));
}

module.exports = {
  recalculateLedgerForParty,
  recalculateAllLedgers
};

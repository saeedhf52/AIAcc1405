const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../config/database');
const { processInputWithAI, commitTransactionData } = require('../services/aiService');
const { recalculateLedgerForParty, renamePartyInLedger } = require('../services/ledgerService');
const { getFormattedJalaliDate, normalizeNumbers, parseAmount } = require('../services/jalaliUtils');
const { createJournalVoucherForTransaction, createJournalVoucherForReceipt, updateJournalVoucherForTransaction, updateJournalVoucherForReceipt, deleteJournalVoucherForSource, getGeneralJournal, getGeneralLedger, getSubsidiaryLedger, getTrialBalance } = require('../services/accountingService');
const { getUnreconciledReceipts, getOpenTransactions, runAutoReconciliation, manualReconcile, getAllReconciliations } = require('../services/reconciliationService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// --- API هوش مصنوعی ---
router.post('/ai/process', upload.single('audio'), async (req, res) => {
  try {
    let inputType = 'text';
    let content = '';

    if (req.file) {
      inputType = 'audio';
      content = req.file.buffer.toString('base64');
    } else if (req.body.text) {
      inputType = 'text';
      content = req.body.text;
    } else {
      return res.status(400).json({ success: false, message: 'لطفاً متن یا فایل صوتی ارسال کنید.' });
    }

    const result = await processInputWithAI(inputType, content);
    res.json(result);
  } catch (error) {
    console.error('[API Route] AI Process Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- تاییدیه تشابه اسمی اشخاص (Party Confirmation Response) ---
router.post('/ai/confirm-party', (req, res) => {
  try {
    const { pendingId, choice, partyName } = req.body;
    // choice: 'EXISTING' یا 'NEW'
    const pending = db.prepare('SELECT * FROM pending_confirmations WHERE id = ?').get(pendingId);

    if (!pending) {
      return res.status(404).json({ success: false, message: 'تاییدیه مورد نظر یافت نشد یا قبلا نهایی شده است.' });
    }

    const intentData = JSON.parse(pending.intent_data);
    const t = intentData.transaction;
    const finalName = choice === 'EXISTING' ? pending.candidate_party_name : (partyName || pending.suggested_party_name);

    // ثبت نهایی تراکنش
    const result = commitTransactionData(
      getFormattedJalaliDate(t.date),
      t.type || 'ایجاد بدهی',
      finalName,
      parseAmount(t.amount),
      t.description || '',
      t.tracking || ''
    );

    // به روزرسانی وضع تاییدیه
    db.prepare("UPDATE pending_confirmations SET status = ? WHERE id = ?").run(
      choice === 'EXISTING' ? 'confirmed_existing' : 'created_new',
      pendingId
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- گزارشات حسابداری دوبل (Double-Entry Reports) ---
router.get('/accounting/journal', (req, res) => {
  try {
    const journal = getGeneralJournal();
    res.json({ success: true, data: journal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/accounting/general-ledger', (req, res) => {
  try {
    const { account_id } = req.query;
    const ledger = getGeneralLedger(account_id);
    res.json({ success: true, data: ledger });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/accounting/subsidiary-ledger', (req, res) => {
  try {
    const { party_id } = req.query;
    const ledger = getSubsidiaryLedger(party_id);
    res.json({ success: true, data: ledger });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/accounting/trial-balance', (req, res) => {
  try {
    const trial = getTrialBalance();
    res.json({ success: true, data: trial });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- مغایرت‌یابی و اقلام باز (Reconciliation API) ---
router.get('/reconciliation/unreconciled', (req, res) => {
  try {
    const receipts = getUnreconciledReceipts();
    const transactions = getOpenTransactions();
    const matches = getAllReconciliations();

    res.json({
      success: true,
      data: {
        receipts,
        transactions,
        matches
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/reconciliation/auto-match', (req, res) => {
  try {
    const result = runAutoReconciliation();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/reconciliation/manual-match', (req, res) => {
  try {
    const { receipt_id, transaction_id } = req.body;
    const result = manualReconcile(receipt_id, transaction_id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- آمار و شاخص‌های خلاصه داشبورد (KPIs) ---
router.get('/dashboard/summary', (req, res) => {
  try {
    const totalTransactions = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
    const totalReceipts = db.prepare('SELECT COUNT(*) as count FROM receipts').get().count;
    const totalParties = db.prepare('SELECT COUNT(*) as count FROM parties').get().count;
    const totalVouchers = db.prepare('SELECT COUNT(*) as count FROM journal_vouchers').get().count;

    const ledgerSummary = db.prepare(`
      SELECT
        SUM(total_claim) as totalClaim,
        SUM(total_paid) as totalPaid,
        SUM(balance) as totalBalance
      FROM ledger_summaries
    `).get();

    const recentTransactions = db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT 5').all();
    const topDebtors = db.prepare('SELECT party_name, balance FROM ledger_summaries ORDER BY balance DESC LIMIT 5').all();

    res.json({
      success: true,
      data: {
        totalTransactions,
        totalReceipts,
        totalParties,
        totalVouchers,
        totalClaim: ledgerSummary.totalClaim || 0,
        totalPaid: ledgerSummary.totalPaid || 0,
        totalBalance: ledgerSummary.totalBalance || 0,
        recentTransactions,
        topDebtors
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- تراکنش‌ها (Transactions) ---
router.get('/transactions', (req, res) => {
  try {
    const { party, type, search } = req.query;
    let query = 'SELECT * FROM transactions WHERE 1=1';
    const params = [];

    if (party) {
      query += ' AND party_name = ?';
      params.push(party);
    }
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (search) {
      query += ' AND (description LIKE ? OR party_name LIKE ? OR tracking_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY id DESC';
    const rows = db.prepare(query).all(...params);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/transactions', (req, res) => {
  try {
    const { date, type, party_name, amount, description, tracking_code } = req.body;
    if (!party_name || !amount) {
      return res.status(400).json({ success: false, message: 'نام طرف حساب و مبلغ الزامی است.' });
    }

    const normParty = normalizeNumbers(party_name);
    const parsedAmt = parseAmount(amount);
    const formattedDate = getFormattedJalaliDate(date);

    const result = commitTransactionData(formattedDate, type || 'ایجاد بدهی', normParty, parsedAmt, description, tracking_code);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/transactions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { date, type, party_name, amount, description, tracking_code } = req.body;
    if (!party_name || !amount) {
      return res.status(400).json({ success: false, message: 'نام طرف حساب و مبلغ الزامی است.' });
    }

    const oldTx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!oldTx) {
      return res.status(404).json({ success: false, message: 'تراکنش یافت نشد.' });
    }

    const normParty = normalizeNumbers(party_name);
    const parsedAmt = parseAmount(amount);
    const formattedDate = getFormattedJalaliDate(date);

    db.prepare('INSERT OR IGNORE INTO parties (name) VALUES (?)').run(normParty);
    const partyObj = db.prepare('SELECT id FROM parties WHERE name = ?').get(normParty);
    const partyId = partyObj ? partyObj.id : null;

    db.prepare(`
      UPDATE transactions
      SET date = ?, type = ?, party_id = ?, party_name = ?, amount = ?, description = ?, tracking_code = ?
      WHERE id = ?
    `).run(formattedDate, type || 'ایجاد بدهی', partyId, normParty, parsedAmt, description || '', normalizeNumbers(tracking_code || ''), id);

    recalculateLedgerForParty(oldTx.party_name);
    if (oldTx.party_name !== normParty) {
      recalculateLedgerForParty(normParty);
    }

    const updatedTx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    updateJournalVoucherForTransaction(updatedTx);

    res.json({ success: true, message: 'تراکنش با موفقیت ویرایش شد.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/transactions/:id', (req, res) => {
  try {
    const tx = db.prepare('SELECT party_name FROM transactions WHERE id = ?').get(req.params.id);
    if (tx) {
      deleteJournalVoucherForSource('TRANSACTION', req.params.id);
      db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
      recalculateLedgerForParty(tx.party_name);
    }
    res.json({ success: true, message: 'تراکنش حذف شد.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- مدیریت رسیدها (Receipts API) ---
router.get('/receipts', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM receipts ORDER BY id DESC').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/receipts', (req, res) => {
  try {
    const { date, party_name, amount, account_number, source, document_number, description } = req.body;
    if (!amount) {
      return res.status(400).json({ success: false, message: 'مبلغ الزامی است.' });
    }

    const normParty = normalizeNumbers(party_name || '');
    const parsedAmt = parseAmount(amount);
    const formattedDate = getFormattedJalaliDate(date);
    const docNum = normalizeNumbers(document_number || '');

    let partyId = null;
    if (normParty) {
      db.prepare('INSERT OR IGNORE INTO parties (name) VALUES (?)').run(normParty);
      const partyObj = db.prepare('SELECT id FROM parties WHERE name = ?').get(normParty);
      if (partyObj) partyId = partyObj.id;
    }

    const isSpecificDoc = docNum && docNum.length > 3 && !['چک', 'فیش', 'پایا', 'ساتنا', 'حواله', 'کارت'].includes(docNum);
    const dedupHash = isSpecificDoc ? `DOC_${docNum}` : `REC_${formattedDate}_${parsedAmt}_${normParty}`;

    const info = db.prepare(`
      INSERT INTO receipts
      (date, description, party_name, party_id, account_number, amount, source, document_number, dedup_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      formattedDate,
      normalizeNumbers(description || ''),
      normParty,
      partyId,
      normalizeNumbers(account_number || ''),
      parsedAmt,
      normalizeNumbers(source || ''),
      docNum,
      dedupHash
    );

    const receiptId = info.lastInsertRowid;
    if (normParty) recalculateLedgerForParty(normParty);

    const newReceipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
    createJournalVoucherForReceipt(newReceipt);

    res.json({ success: true, message: 'رسید واریزی با موفقیت ثبت شد.', data: newReceipt });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/receipts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { date, party_name, amount, account_number, source, document_number, description } = req.body;

    const oldReceipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
    if (!oldReceipt) {
      return res.status(404).json({ success: false, message: 'رسید مورد نظر یافت نشد.' });
    }

    const normParty = normalizeNumbers(party_name || '');
    const parsedAmt = parseAmount(amount);
    const formattedDate = getFormattedJalaliDate(date);
    const docNum = normalizeNumbers(document_number || '');

    let partyId = null;
    if (normParty) {
      db.prepare('INSERT OR IGNORE INTO parties (name) VALUES (?)').run(normParty);
      const partyObj = db.prepare('SELECT id FROM parties WHERE name = ?').get(normParty);
      if (partyObj) partyId = partyObj.id;
    }

    const isSpecificDoc = docNum && docNum.length > 3 && !['چک', 'فیش', 'پایا', 'ساتنا', 'حواله', 'کارت'].includes(docNum);
    const dedupHash = isSpecificDoc ? `DOC_${docNum}` : `REC_${formattedDate}_${parsedAmt}_${normParty}`;

    db.prepare(`
      UPDATE receipts
      SET date = ?, party_name = ?, party_id = ?, amount = ?, account_number = ?, source = ?, document_number = ?, description = ?, dedup_hash = ?
      WHERE id = ?
    `).run(
      formattedDate,
      normParty,
      partyId,
      parsedAmt,
      normalizeNumbers(account_number || ''),
      normalizeNumbers(source || ''),
      docNum,
      normalizeNumbers(description || ''),
      dedupHash,
      id
    );

    if (oldReceipt.party_name) recalculateLedgerForParty(oldReceipt.party_name);
    if (normParty && normParty !== oldReceipt.party_name) recalculateLedgerForParty(normParty);

    const updatedReceipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
    updateJournalVoucherForReceipt(updatedReceipt);

    res.json({ success: true, message: 'رسید واریزی با موفقیت ویرایش شد.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/receipts/:id', (req, res) => {
  try {
    const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
    if (receipt) {
      deleteJournalVoucherForSource('RECEIPT', req.params.id);
      db.prepare('DELETE FROM receipts WHERE id = ?').run(req.params.id);
      if (receipt.party_name) recalculateLedgerForParty(receipt.party_name);
    }
    res.json({ success: true, message: 'رسید واریزی حذف شد.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- مدیریت اشخاص (Parties API) ---
router.get('/parties', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM parties ORDER BY name ASC').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/parties', (req, res) => {
  try {
    const { name, phone, notes } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'نام شخص الزامی است.' });
    }
    const normName = normalizeNumbers(name);
    const info = db.prepare('INSERT INTO parties (name, phone, notes) VALUES (?, ?, ?)').run(normName, phone || '', notes || '');
    recalculateLedgerForParty(normName);
    res.json({ success: true, message: 'شخص جدید با موفقیت ایجاد شد.', partyId: info.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/parties/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, notes } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'نام شخص الزامی است.' });
    }

    const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
    if (!party) {
      return res.status(404).json({ success: false, message: 'شخص مورد نظر یافت نشد.' });
    }

    const normName = normalizeNumbers(name);
    db.prepare('UPDATE parties SET name = ?, phone = ?, notes = ? WHERE id = ?').run(normName, phone || '', notes || '', id);

    if (party.name !== normName) {
      renamePartyInLedger(party.name, normName, id);
    } else {
      recalculateLedgerForParty(normName);
    }

    res.json({ success: true, message: 'اطلاعات شخص با موفقیت به‌روزرسانی شد.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/parties/:id', (req, res) => {
  try {
    const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(req.params.id);
    if (party) {
      db.prepare('UPDATE transactions SET party_id = NULL WHERE party_id = ?').run(req.params.id);
      db.prepare('UPDATE receipts SET party_id = NULL WHERE party_id = ?').run(req.params.id);
      db.prepare('DELETE FROM ledger_summaries WHERE party_id = ? OR party_name = ?').run(req.params.id, party.name);
      db.prepare('DELETE FROM parties WHERE id = ?').run(req.params.id);
    }
    res.json({ success: true, message: 'شخص حذف شد.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM categories').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/ai/logs', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM ai_logs ORDER BY id DESC LIMIT 20').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../config/database');
const { processInputWithAI, commitTransactionData } = require('../services/aiService');
const { recalculateLedgerForParty } = require('../services/ledgerService');
const { getFormattedJalaliDate, normalizeNumbers, parseAmount } = require('../services/jalaliUtils');
const { createJournalVoucherForTransaction, getGeneralJournal, getGeneralLedger, getSubsidiaryLedger, getTrialBalance } = require('../services/accountingService');
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

router.delete('/transactions/:id', (req, res) => {
  try {
    const tx = db.prepare('SELECT party_name FROM transactions WHERE id = ?').get(req.params.id);
    if (tx) {
      db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
      recalculateLedgerForParty(tx.party_name);
    }
    res.json({ success: true, message: 'تراکنش حذف شد.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- سایر APIها ---
router.get('/receipts', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM receipts ORDER BY id DESC').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/ledger', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM ledger_summaries ORDER BY balance DESC').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/parties', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM parties ORDER BY name ASC').all();
    res.json({ success: true, data: rows });
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

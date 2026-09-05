const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../config/database');
const { processInputWithAI } = require('../services/aiService');
const { recalculateLedgerForParty, recalculateAllLedgers } = require('../services/ledgerService');
const { getFormattedJalaliDate, normalizeNumbers, parseAmount } = require('../services/jalaliUtils');

// تنظیمات آپلود فایل صوتی ویس در حافظه
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // حداکثر 10 مگابایت
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

// --- آمار و شاخص‌های خلاصه داشبورد (KPIs) ---
router.get('/dashboard/summary', (req, res) => {
  try {
    const totalTransactions = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
    const totalReceipts = db.prepare('SELECT COUNT(*) as count FROM receipts').get().count;
    const totalParties = db.prepare('SELECT COUNT(*) as count FROM parties').get().count;

    const ledgerSummary = db.prepare(`
      SELECT
        SUM(total_claim) as totalClaim,
        SUM(total_paid) as totalPaid,
        SUM(balance) as totalBalance
      FROM ledger_summaries
    `).get();

    // 5 تراکنش اخیر
    const recentTransactions = db.prepare(`
      SELECT * FROM transactions ORDER BY id DESC LIMIT 5
    `).all();

    // 5 طرف حساب با بیشترین طلب/مانده
    const topDebtors = db.prepare(`
      SELECT party_name, balance FROM ledger_summaries ORDER BY balance DESC LIMIT 5
    `).all();

    res.json({
      success: true,
      data: {
        totalTransactions,
        totalReceipts,
        totalParties,
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

    db.prepare('INSERT OR IGNORE INTO parties (name) VALUES (?)').run(normParty);
    const partyObj = db.prepare('SELECT id FROM parties WHERE name = ?').get(normParty);
    const partyId = partyObj ? partyObj.id : null;

    const info = db.prepare(`
      INSERT INTO transactions (date, type, party_id, party_name, amount, description, tracking_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(formattedDate, type || 'ایجاد بدهی', partyId, normParty, parsedAmt, normalizeNumbers(description || ''), normalizeNumbers(tracking_code || ''));

    recalculateLedgerForParty(normParty);

    res.json({ success: true, id: info.lastInsertRowid, message: 'تراکنش با موفقیت ثبت شد.' });
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

// --- رسیدها (Receipts) ---
router.get('/receipts', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM receipts ORDER BY id DESC').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- دفتر حساب (Ledger Summaries) ---
router.get('/ledger', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM ledger_summaries ORDER BY balance DESC').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- اشخاص (Parties) ---
router.get('/parties', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM parties ORDER BY name ASC').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- دسته‌بندی‌ها و بودجه‌ها ---
router.get('/categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM categories').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- لاگ‌های هوش مصنوعی (AI Logs) ---
router.get('/ai/logs', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM ai_logs ORDER BY id DESC LIMIT 20').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

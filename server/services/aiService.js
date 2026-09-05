const axios = require('axios');
const db = require('../config/database');
const { getFormattedJalaliDate, normalizeNumbers, parseAmount } = require('./jalaliUtils');
const { recalculateLedgerForParty } = require('./ledgerService');

const API_URL = process.env.AI_API_BASE_URL || 'https://saeed-9router-cloud.onrender.com/v1/chat/completions';
const API_KEY = process.env.AI_API_KEY || 'sk-433b65e8f172ca9a-6cijkx-4d45e864';
const MODEL_NAME = process.env.AI_MODEL_NAME || 'claude-smart-ai-kb';

async function processInputWithAI(inputType, content) {
  const startTime = Date.now();
  const todayJalali = getFormattedJalaliDate();

  const systemPrompt = `تو یک دستیار مالی و حسابداری هوشمند فارسی هستی. تاریخ امروز: ${todayJalali} است.
ورودی کاربر (متن یا فایل صوتی) را تحلیل کن. خروجی باید **فقط و فقط یک فایل JSON معتبر** بدون هیچ متن یا توضیح اضافه‌ای با ساختار زیر باشد:

{
  "intent": "TRANSACTION" یا "RECEIPT" یا "REPORT" یا "CLARIFY",
  "message": "پیام به کاربر (فقط اگر intent برابر CLARIFY بود)",
  "receipts": [
    {
      "date": "YYYY/MM/DD",
      "description": "...",
      "name": "...",
      "account": "...",
      "amount": 0,
      "source": "...",
      "document": "..."
    }
  ],
  "report_person": "نام شخص برای گزارش‌گیری",
  "transaction": {
    "date": "YYYY/MM/DD",
    "type": "ایجاد بدهی یا پرداخت یا ایجاد طلب یا دریافت",
    "name": "...",
    "amount": 0,
    "description": "...",
    "tracking": "..."
  }
}

قوانین بسیار مهم:
۱. فرمت تاریخ: همیشه باید ۱۰ رقمی جلالی (مثلاً ${todayJalali}) باشد. اگر سال ذکر نشد، سال جاری را در نظر بگیر.
۲. نوع تراکنش (type): فقط مجاز به استفاده از یکی از این ۴ کلمه دقیق هستی: 'ایجاد بدهی' ، 'پرداخت' ، 'ایجاد طلب' ، 'دریافت'.
۳. تبدیل تومان به ریال: اگر کاربر مبلغ را به 'تومان' گفت (مثلا ۲۰ میلیون تومان یا ۵۰۰ هزار تومان)، حتماً آن را در ۱۰ ضرب کن و به 'ریال' (مثلا 200000000 یا 5000000) ثبت کن. تمام مبالغ در خروجی JSON باید عدد انگلیسی و به ریال باشند.
۴. شفاف‌سازی (CLARIFY): اگر کاربر درخواست ثبت تراکنش داد اما اطلاعات مهمی مثل نام شخص، مبلغ یا بابت (شرح) نامشخص بود، intent را CLARIFY بگذار و در message بنویس دقیقاً چه چیزی کم است.
۵. شرح تراکنش: توضیحات کاربر را به دقت به عنوان شرح (description) استخراج کن.`;

  let messageContent = [];
  if (inputType === 'text') {
    messageContent.push({
      type: 'text',
      text: `${systemPrompt}\n\nمتن ورودی کاربر:\n${content}`
    });
  } else if (inputType === 'audio') {
    messageContent.push({
      type: 'text',
      text: `${systemPrompt}\n\nلطفا فایل صوتی پیوست شده را به دقت گوش بده و درخواست کاربر را استخراج و پردازش کن.`
    });
    messageContent.push({
      type: 'input_audio',
      input_audio: {
        data: content, // base64 string
        format: 'webm'
      }
    });
  }

  const payload = {
    model: MODEL_NAME,
    messages: [
      {
        role: 'user',
        content: messageContent
      }
    ]
  };

  try {
    const response = await axios.post(API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 45000
    });

    const choices = response.data?.choices;
    if (!choices || choices.length === 0) {
      throw new Error('پاسخ معتبری از API دریافت نشد.');
    }

    let rawText = choices[0].message?.content || '';
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    const data = JSON.parse(rawText);
    const executionTime = Date.now() - startTime;

    // ذخیره لاگ AI در دیتابیس
    db.prepare(`
      INSERT INTO ai_logs (input_type, raw_prompt, intent, response_json, status, execution_time_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      inputType,
      inputType === 'text' ? content : '[Audio Recording]',
      data.intent || 'UNKNOWN',
      JSON.stringify(data),
      data.intent === 'CLARIFY' ? 'clarify' : 'success',
      executionTime
    );

    // اجرای اکشن براساس Intent
    return await executeAIIntent(data);

  } catch (err) {
    console.error('[AIService] خطا در پردازش:', err.message);
    db.prepare(`
      INSERT INTO ai_logs (input_type, raw_prompt, intent, response_json, status, execution_time_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(inputType, inputType === 'text' ? content : '[Audio]', 'ERROR', err.toString(), 'error', Date.now() - startTime);

    return {
      success: false,
      message: `❌ خطا در پردازش هوش مصنوعی: ${err.message}`
    };
  }
}

async function executeAIIntent(data) {
  const todayJalali = getFormattedJalaliDate();

  // 1. شفاف‌سازی
  if (data.intent === 'CLARIFY') {
    return {
      success: true,
      intent: 'CLARIFY',
      message: `❓ نیاز به اطلاعات بیشتر:\n${data.message}`
    };
  }

  // 2. گزارش‌گیری از دفتر حساب
  if (data.intent === 'REPORT') {
    const person = normalizeNumbers(data.report_person || '');
    if (!person) {
      return {
        success: false,
        message: '❌ نام شخص برای گزارش‌گیری مشخص نشده است.'
      };
    }

    const row = db.prepare(`
      SELECT * FROM ledger_summaries
      WHERE party_name LIKE ? OR ? LIKE ('%' || party_name || '%')
    `).get(`%${person}%`, person);

    if (!row) {
      return {
        success: true,
        intent: 'REPORT',
        message: `❌ شخصی با نام '${person}' در دفتر حساب یافت نشد.`
      };
    }

    return {
      success: true,
      intent: 'REPORT',
      data: row,
      message: `📊 وضعیت حساب: **${row.party_name}**\n` +
               `🔹 کل طلب: **${Number(row.total_claim).toLocaleString('fa-IR')} ریال**\n` +
               `🔸 پرداختی: **${Number(row.total_paid).toLocaleString('fa-IR')} ریال**\n` +
               `🔻 مانده: **${Number(row.balance).toLocaleString('fa-IR')} ریال**`
    };
  }

  // 3. ثبت تراکنش دستی
  if (data.intent === 'TRANSACTION') {
    const t = data.transaction;
    if (!t || !t.name || !t.amount) {
      return {
        success: false,
        message: '❌ اطلاعات تراکنش ناقص است.'
      };
    }

    const partyName = normalizeNumbers(t.name);
    const amount = parseAmount(t.amount);
    const formattedDate = getFormattedJalaliDate(t.date || todayJalali);
    const txType = t.type || 'ایجاد بدهی';

    // ثبت یا یافتن طرف حساب
    db.prepare('INSERT OR IGNORE INTO parties (name) VALUES (?)').run(partyName);
    const partyObj = db.prepare('SELECT id FROM parties WHERE name = ?').get(partyName);
    const partyId = partyObj ? partyObj.id : null;

    const res = db.prepare(`
      INSERT INTO transactions (date, type, party_id, party_name, amount, description, tracking_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(formattedDate, txType, partyId, partyName, amount, t.description || '', normalizeNumbers(t.tracking || ''));

    recalculateLedgerForParty(partyName);

    return {
      success: true,
      intent: 'TRANSACTION',
      transactionId: res.lastInsertRowid,
      message: `✅ تراکنش جدید ثبت شد!\n` +
               `👤 شخص: **${partyName}**\n` +
               `🏷️ نوع: **${txType}**\n` +
               `💰 مبلغ: **${Number(amount).toLocaleString('fa-IR')} ریال** (${Number(amount / 10).toLocaleString('fa-IR')} تومان)\n` +
               `📅 تاریخ: ${formattedDate}`
    };
  }

  // 4. ثبت رسید بانکی
  if (data.intent === 'RECEIPT') {
    const receipts = Array.isArray(data.receipts) ? data.receipts : [data.receipts];
    let addedCount = 0;

    const insertParty = db.prepare('INSERT OR IGNORE INTO parties (name) VALUES (?)');
    const getPartyId = db.prepare('SELECT id FROM parties WHERE name = ?');
    const insertReceipt = db.prepare(`
      INSERT OR IGNORE INTO receipts
      (date, description, party_name, party_id, account_number, amount, source, document_number, dedup_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const rec of receipts) {
      const docNum = normalizeNumbers(rec.document || '');
      const amount = parseAmount(rec.amount);
      const partyName = normalizeNumbers(rec.name || '');
      const dateStr = getFormattedJalaliDate(rec.date || todayJalali);

      if (amount === 0) continue;

      let partyId = null;
      if (partyName) {
        insertParty.run(partyName);
        const pObj = getPartyId.get(partyName);
        if (pObj) partyId = pObj.id;
      }

      const dedupHash = docNum ? docNum : `${dateStr}_${amount}_${partyName}`;
      const info = insertReceipt.run(
        dateStr,
        normalizeNumbers(rec.description || ''),
        partyName,
        partyId,
        normalizeNumbers(rec.account || ''),
        amount,
        normalizeNumbers(rec.source || ''),
        docNum,
        dedupHash
      );

      if (info.changes > 0) {
        addedCount++;
        if (partyName) recalculateLedgerForParty(partyName);
      }
    }

    if (addedCount > 0) {
      return {
        success: true,
        intent: 'RECEIPT',
        addedCount,
        message: `✅ عملیات موفق! **${addedCount}** رسید جدید واریزی ثبت شد.`
      };
    } else {
      return {
        success: true,
        intent: 'RECEIPT',
        addedCount: 0,
        message: '⚠️ رسید جدیدی ثبت نشد (احتمالاً تکراری بود یا مبالغ نامعتبر بودند).'
      };
    }
  }

  return {
    success: false,
    message: '⚠️ متوجه قصد و درخواست شما نشدم. لطفا واضح‌تر بیان کنید.'
  };
}

module.exports = {
  processInputWithAI
};

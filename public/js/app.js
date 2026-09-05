let currentCurrency = 'IRR'; // 'IRR' یا 'TOMAN'
let ledgerChart = null;

let rawData = {
  summary: null,
  transactions: [],
  receipts: [],
  ledger: [],
  aiLogs: [],
  journal: [],
  trialBalance: [],
  reconciliation: { receipts: [], transactions: [], matches: [] }
};

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  loadAllData();
});

function toggleCurrency() {
  currentCurrency = currentCurrency === 'IRR' ? 'TOMAN' : 'IRR';
  const btn = document.getElementById('currency-toggle');
  btn.textContent = currentCurrency === 'IRR' ? 'ریال (IRR)' : 'تومان (TOMAN)';

  document.querySelectorAll('.currency-unit').forEach(el => {
    el.textContent = currentCurrency === 'IRR' ? 'ریال' : 'تومان';
  });

  renderAllViews();
}

function formatMoney(amount) {
  if (amount === null || amount === undefined) return '0';
  let num = Number(amount);
  if (currentCurrency === 'TOMAN') {
    num = Math.floor(num / 10);
  }
  return num.toLocaleString('fa-IR');
}

async function loadAllData() {
  try {
    const [sumRes, txRes, recRes, ledRes, aiRes, journalRes, trialRes, reconRes] = await Promise.all([
      fetch('/api/dashboard/summary').then(r => r.json()),
      fetch('/api/transactions').then(r => r.json()),
      fetch('/api/receipts').then(r => r.json()),
      fetch('/api/ledger').then(r => r.json()),
      fetch('/api/ai/logs').then(r => r.json()),
      fetch('/api/accounting/journal').then(r => r.json()),
      fetch('/api/accounting/trial-balance').then(r => r.json()),
      fetch('/api/reconciliation/unreconciled').then(r => r.json())
    ]);

    if (sumRes.success) rawData.summary = sumRes.data;
    if (txRes.success) rawData.transactions = txRes.data;
    if (recRes.success) rawData.receipts = recRes.data;
    if (ledRes.success) rawData.ledger = ledRes.data;
    if (aiRes.success) rawData.aiLogs = aiRes.data;
    if (journalRes.success) rawData.journal = journalRes.data;
    if (trialRes.success) rawData.trialBalance = trialRes.data;
    if (reconRes.success) rawData.reconciliation = reconRes.data;

    renderAllViews();
  } catch (err) {
    console.error('خطا در دریافت داده‌ها:', err);
  }
}

function renderAllViews() {
  renderKPIs();
  renderChart();
  renderTopDebtors();
  renderRecentTransactions();
  renderAllTransactionsTable();
  renderAllReceiptsTable();
  renderAllLedgerTable();
  renderAILogsTable();
  renderJournalVouchers();
  renderTrialBalance();
  renderReconciliationView();
}

// 1. کارت‌های KPI
function renderKPIs() {
  if (!rawData.summary) return;
  const s = rawData.summary;
  document.getElementById('kpi-claim').textContent = formatMoney(s.totalClaim);
  document.getElementById('kpi-paid').textContent = formatMoney(s.totalPaid);
  document.getElementById('kpi-balance').textContent = formatMoney(s.totalBalance);
  document.getElementById('kpi-tx-count').textContent = s.totalTransactions.toLocaleString('fa-IR');
  document.getElementById('kpi-receipt-count').textContent = s.totalReceipts.toLocaleString('fa-IR');
}

// 2. نمودار اصلی
function renderChart() {
  if (!rawData.ledger || rawData.ledger.length === 0) return;
  const top10 = rawData.ledger.slice(0, 10);

  const labels = top10.map(item => item.party_name);
  const claims = top10.map(item => currentCurrency === 'TOMAN' ? Math.floor(item.total_claim / 10) : item.total_claim);
  const paids = top10.map(item => currentCurrency === 'TOMAN' ? Math.floor(item.total_paid / 10) : item.total_paid);

  const ctx = document.getElementById('ledgerChart').getContext('2d');
  if (ledgerChart) ledgerChart.destroy();

  ledgerChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: `کل طلب (${currentCurrency === 'IRR' ? 'ریال' : 'تومان'})`,
          data: claims,
          backgroundColor: '#0ea5e9'
        },
        {
          label: `پرداختی (${currentCurrency === 'IRR' ? 'ریال' : 'تومان'})`,
          data: paids,
          backgroundColor: '#10b981'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Vazirmatn' } } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { family: 'Vazirmatn' } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#94a3b8', font: { family: 'Vazirmatn' } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

// 3. بدهکاران برتر
function renderTopDebtors() {
  const container = document.getElementById('top-debtors-list');
  container.innerHTML = '';
  if (!rawData.ledger) return;

  const debtors = rawData.ledger.filter(l => l.balance > 0).slice(0, 5);
  debtors.forEach(d => {
    const el = document.createElement('div');
    el.className = 'flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800';
    el.innerHTML = `
      <div>
        <div class="font-bold text-xs text-slate-200">${d.party_name}</div>
        <div class="text-[10px] text-slate-400">طرف حساب</div>
      </div>
      <div class="text-left">
        <div class="font-bold text-xs text-cyan-400">${formatMoney(d.balance)} ${currentCurrency === 'IRR' ? 'ریال' : 'تومان'}</div>
        <div class="text-[10px] text-slate-500">مانده طلب</div>
      </div>
    `;
    container.appendChild(el);
  });
}

// 4. آخرین تراکنش‌ها
function renderRecentTransactions() {
  const tbody = document.getElementById('recent-tx-tbody');
  tbody.innerHTML = '';
  if (!rawData.transactions) return;

  const recent = rawData.transactions.slice(0, 5);
  recent.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition';
    tr.innerHTML = `
      <td class="p-3 text-slate-400">${tx.date}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${getTxTypeBadge(tx.type)}">${tx.type}</span>
      </td>
      <td class="p-3 font-medium text-slate-200">${tx.party_name}</td>
      <td class="p-3 font-bold text-slate-100">${formatMoney(tx.amount)} ${currentCurrency === 'IRR' ? 'ریال' : 'تومان'}</td>
      <td class="p-3 text-slate-400 max-w-xs truncate">${tx.description || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 5. جدول تراکنش‌ها
function renderAllTransactionsTable() {
  const tbody = document.getElementById('all-tx-tbody');
  tbody.innerHTML = '';
  if (!rawData.transactions) return;

  rawData.transactions.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition';
    tr.innerHTML = `
      <td class="p-3 text-slate-500">#${tx.id}</td>
      <td class="p-3 text-slate-400">${tx.date}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${getTxTypeBadge(tx.type)}">${tx.type}</span>
      </td>
      <td class="p-3 font-medium text-slate-200">${tx.party_name}</td>
      <td class="p-3 font-bold text-slate-100">${formatMoney(tx.amount)} ${currentCurrency === 'IRR' ? 'ریال' : 'تومان'}</td>
      <td class="p-3 text-slate-400 max-w-xs truncate">${tx.description || '-'}</td>
      <td class="p-3 text-slate-500">${tx.tracking_code || '-'}</td>
      <td class="p-3 text-center">
        <button onclick="deleteTransaction(${tx.id})" class="text-rose-400 hover:text-rose-300 p-1">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  lucide.createIcons();
}

// 6. جدول رسیدها
function renderAllReceiptsTable() {
  const tbody = document.getElementById('all-receipts-tbody');
  tbody.innerHTML = '';
  if (!rawData.receipts) return;

  rawData.receipts.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition';
    tr.innerHTML = `
      <td class="p-3 text-slate-500">${r.row_number || r.id}</td>
      <td class="p-3 text-slate-400">${r.date}</td>
      <td class="p-3 font-medium text-slate-200">${r.party_name || '-'}</td>
      <td class="p-3 font-bold text-emerald-400">${formatMoney(r.amount)} ${currentCurrency === 'IRR' ? 'ریال' : 'تومان'}</td>
      <td class="p-3 text-slate-400 font-mono text-[11px]">${r.account_number || '-'}</td>
      <td class="p-3 text-slate-400 font-mono text-[11px]">${r.source || '-'}</td>
      <td class="p-3 text-slate-300 font-mono text-[11px]">${r.document_number || '-'}</td>
      <td class="p-3 text-slate-400 max-w-xs truncate">${r.description || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 7. جدول دفتر حساب
function renderAllLedgerTable() {
  const tbody = document.getElementById('all-ledger-tbody');
  tbody.innerHTML = '';
  if (!rawData.ledger) return;

  rawData.ledger.forEach(l => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition';
    tr.innerHTML = `
      <td class="p-3 font-bold text-slate-100">${l.party_name}</td>
      <td class="p-3 text-cyan-400 font-medium">${formatMoney(l.total_claim)} ${currentCurrency === 'IRR' ? 'ریال' : 'تومان'}</td>
      <td class="p-3 text-emerald-400 font-medium">${formatMoney(l.total_paid)} ${currentCurrency === 'IRR' ? 'ریال' : 'تومان'}</td>
      <td class="p-3 font-black ${l.balance > 0 ? 'text-amber-400' : 'text-slate-400'}">${formatMoney(l.balance)} ${currentCurrency === 'IRR' ? 'ریال' : 'تومان'}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${l.balance > 0 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-slate-800 text-slate-400'}">
          ${l.balance > 0 ? 'دارای مانده طلب' : 'تسویه شده'}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 8. دفتر روزنامه حسابداری دوبل
function renderJournalVouchers() {
  const container = document.getElementById('journal-vouchers-container');
  container.innerHTML = '';
  if (!rawData.journal || rawData.journal.length === 0) {
    container.innerHTML = '<div class="text-slate-500 text-xs text-center py-4">هیچ سند روزنامه‌ای ثبت نشده است.</div>';
    return;
  }

  rawData.journal.forEach(v => {
    const card = document.createElement('div');
    card.className = 'p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3';

    let entriesHtml = '';
    v.entries.forEach(e => {
      entriesHtml += `
        <tr class="border-b border-slate-800/50">
          <td class="py-2 px-3 text-slate-300 font-medium">${e.account_code} - ${e.account_title} ${e.party_name ? `(${e.party_name})` : ''}</td>
          <td class="py-2 px-3 text-emerald-400 font-mono font-bold">${e.debit > 0 ? formatMoney(e.debit) : '-'}</td>
          <td class="py-2 px-3 text-rose-400 font-mono font-bold">${e.credit > 0 ? formatMoney(e.credit) : '-'}</td>
          <td class="py-2 px-3 text-slate-400 text-[11px]">${e.description || '-'}</td>
        </tr>
      `;
    });

    card.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-0.5 rounded-lg bg-cyan-500/20 text-cyan-400 text-xs font-bold">سند شماره #${v.voucher_number}</span>
          <span class="text-xs text-slate-400">${v.date}</span>
        </div>
        <span class="text-xs font-bold text-slate-300">${v.description}</span>
      </div>
      <table class="w-full text-right text-xs">
        <thead class="text-slate-500 bg-slate-950/40">
          <tr>
            <th class="p-2">عنوان حساب</th>
            <th class="p-2">بدهکار</th>
            <th class="p-2">بستانکار</th>
            <th class="p-2">شرح ردیف</th>
          </tr>
        </thead>
        <tbody>
          ${entriesHtml}
        </tbody>
      </table>
    `;
    container.appendChild(card);
  });
}

// 9. تراز آزمایشی
function renderTrialBalance() {
  const tbody = document.getElementById('trial-balance-tbody');
  tbody.innerHTML = '';
  if (!rawData.trialBalance) return;

  rawData.trialBalance.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition';
    tr.innerHTML = `
      <td class="p-3 text-cyan-400 font-mono font-bold">${row.code}</td>
      <td class="p-3 font-bold text-slate-200">${row.title}</td>
      <td class="p-3 text-slate-400">${getAccountTypeLabel(row.type)}</td>
      <td class="p-3 font-mono text-emerald-400 font-bold">${formatMoney(row.total_debit)}</td>
      <td class="p-3 font-mono text-rose-400 font-bold">${formatMoney(row.total_credit)}</td>
      <td class="p-3 font-mono font-black text-slate-100">${formatMoney(row.balance)}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${row.balance_type === 'بدهکار' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">
          ${row.balance_type}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 10. مغایرت‌یابی و اقلام باز
function renderReconciliationView() {
  const receiptsTbody = document.getElementById('unreconciled-receipts-tbody');
  const txsTbody = document.getElementById('open-transactions-tbody');
  const matchesTbody = document.getElementById('matched-reconciliations-tbody');

  receiptsTbody.innerHTML = '';
  txsTbody.innerHTML = '';
  matchesTbody.innerHTML = '';

  const recData = rawData.reconciliation;

  // رسیدهای بلاتکلیف
  if (recData.receipts && recData.receipts.length > 0) {
    recData.receipts.forEach(r => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-amber-500/10 cursor-pointer transition';
      tr.innerHTML = `
        <td class="p-2 text-slate-400">${r.date}</td>
        <td class="p-2 font-medium text-slate-200">${r.party_name || 'نامشخص'}</td>
        <td class="p-2 font-bold text-amber-400">${formatMoney(r.amount)}</td>
        <td class="p-2 text-slate-400 font-mono text-[10px]">${r.document_number || '-'}</td>
      `;
      receiptsTbody.appendChild(tr);
    });
  } else {
    receiptsTbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500">رسید بلاتکلیفی وجود ندارد.</td></tr>';
  }

  // تراکنش‌های اقلام باز
  if (recData.transactions && recData.transactions.length > 0) {
    recData.transactions.forEach(t => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-cyan-500/10 cursor-pointer transition';
      tr.innerHTML = `
        <td class="p-2 text-slate-400">${t.date}</td>
        <td class="p-2 font-medium text-slate-200">${t.party_name}</td>
        <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${getTxTypeBadge(t.type)}">${t.type}</span></td>
        <td class="p-2 font-bold text-cyan-400">${formatMoney(t.amount)}</td>
      `;
      txsTbody.appendChild(tr);
    });
  } else {
    txsTbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500">تراکنش اقلام بازی وجود ندارد.</td></tr>';
  }

  // تاریخچه مطابقت‌ها
  if (recData.matches && recData.matches.length > 0) {
    recData.matches.forEach(m => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-800/30 transition';
      tr.innerHTML = `
        <td class="p-3 text-amber-300 font-medium">رسید ${m.receipt_party} (${formatMoney(m.receipt_amount)})</td>
        <td class="p-3 text-cyan-300 font-medium">تراکنش ${m.tx_party} - ${m.tx_type}</td>
        <td class="p-3 font-bold text-emerald-400">${formatMoney(m.matched_amount)}</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
            ${m.match_type === 'auto_doc' ? '⚡ اتوماتیک پیگیری' : (m.match_type === 'auto_amount' ? '⚡ اتوماتیک مبلغ' : '👤 دستی')}
          </span>
        </td>
        <td class="p-3 text-slate-500 text-[10px]">${new Date(m.reconciled_at).toLocaleTimeString('fa-IR')}</td>
      `;
      matchesTbody.appendChild(tr);
    });
  } else {
    matchesTbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">هیچ سابقه تطبیقی ثبت نشده است.</td></tr>';
  }
}

async function triggerAutoReconcile() {
  const res = await fetch('/api/reconciliation/auto-match', { method: 'POST' }).then(r => r.json());
  alert(res.message);
  loadAllData();
}

function renderAILogsTable() {
  const tbody = document.getElementById('all-ai-logs-tbody');
  tbody.innerHTML = '';
  if (!rawData.aiLogs) return;

  rawData.aiLogs.forEach(log => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition';
    tr.innerHTML = `
      <td class="p-3 text-slate-400">${new Date(log.created_at).toLocaleTimeString('fa-IR')}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${log.input_type === 'audio' ? 'bg-purple-500/20 text-purple-300' : 'bg-cyan-500/20 text-cyan-300'}">
          ${log.input_type === 'audio' ? '🎤 صوتی (ویس)' : '💬 متنی'}
        </span>
      </td>
      <td class="p-3 font-mono font-bold text-slate-200">${log.intent || '-'}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${log.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">
          ${log.status}
        </span>
      </td>
      <td class="p-3 text-slate-500">${log.execution_time_ms ? log.execution_time_ms + ' ms' : '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function getTxTypeBadge(type) {
  switch(type) {
    case 'ایجاد طلب': return 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20';
    case 'ایجاد بدهی': return 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
    case 'پرداخت': return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    case 'دریافت': return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
    default: return 'bg-slate-800 text-slate-400';
  }
}

function getAccountTypeLabel(type) {
  switch(type) {
    case 'asset': return 'دارایی';
    case 'liability': return 'بدهی';
    case 'equity': return 'سرمایه';
    case 'revenue': return 'درآمد';
    case 'expense': return 'هزینه';
    default: return type;
  }
}

// تغییر زبانه
function switchTab(tabId) {
  document.querySelectorAll('section[id^="view-"]').forEach(el => el.classList.add('hidden'));
  document.getElementById(`view-${tabId}`).classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('text-cyan-400', 'bg-slate-800/80');
    btn.classList.add('text-slate-400');
  });

  const activeNav = document.getElementById(`nav-${tabId}`);
  if (activeNav) {
    activeNav.classList.add('text-cyan-400', 'bg-slate-800/80');
    activeNav.classList.remove('text-slate-400');
  }

  const titles = {
    'dashboard': 'نمای کلی داشبورد',
    'transactions': 'دفتر ثبت تراکنش‌ها',
    'receipts': 'رسیدهای واریزی بانکی',
    'ledger': 'دفتر حساب اشخاص',
    'journal': 'دفتر روزنامه اسناد دوبل',
    'trial-balance': 'تراز آزمایشی ۴ ستونی',
    'reconciliation': 'مغایرت‌یابی و اقلام باز',
    'ai-logs': 'تاریخچه هوش مصنوعی 9router'
  };
  document.getElementById('page-title').textContent = titles[tabId] || 'دستیار مالی';
}

function filterTransactions() {
  const search = document.getElementById('tx-search').value.trim();
  const type = document.getElementById('tx-type-filter').value;

  fetch(`/api/transactions?search=${encodeURIComponent(search)}&type=${encodeURIComponent(type)}`)
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        rawData.transactions = res.data;
        renderAllTransactionsTable();
      }
    });
}

async function deleteTransaction(id) {
  if (!confirm('آیا از حذف این تراکنش اطمینان دارید؟')) return;
  const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' }).then(r => r.json());
  if (res.success) {
    loadAllData();
  }
}

// ارسال پیام متنی چت AI
async function sendTextMessage() {
  const input = document.getElementById('ai-text-input');
  const text = input.value.trim();
  if (!text) return;

  appendChatMessage('user', text);
  input.value = '';

  const loadingMsg = appendChatMessage('ai', '⏳ در حال پردازش متن توسط هوش مصنوعی...');

  try {
    const res = await fetch('/api/ai/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    }).then(r => r.json());

    loadingMsg.remove();

    if (res.intent === 'CONFIRM_PARTY') {
      appendPartyConfirmMessage(res);
    } else {
      appendChatMessage('ai', res.message || 'پردازش انجام شد.');
    }
    loadAllData();
  } catch (err) {
    loadingMsg.remove();
    appendChatMessage('ai', '❌ خطا در ارسال درخواست به AI.');
  }
}

// پیام کارت تایید تشابه اسمی
function appendPartyConfirmMessage(data) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'p-3 rounded-xl bg-amber-500/10 text-amber-200 border border-amber-500/30 space-y-2';
  div.innerHTML = `
    <div>🔍 ${data.message}</div>
    <div class="flex flex-col gap-1.5 pt-1">
      <button onclick="confirmPartyChoice(${data.pendingId}, 'EXISTING', '${data.candidateParty.name}')" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg text-xs transition">
        ✅ تایید شخص موجود: "${data.candidateParty.name}" (تشابه ${data.similarityScore}%)
      </button>
      <button onclick="confirmPartyChoice(${data.pendingId}, 'NEW', '${data.extractedName}')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs transition">
        ➕ ایجاد شخص جدید: "${data.extractedName}"
      </button>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function confirmPartyChoice(pendingId, choice, partyName) {
  const res = await fetch('/api/ai/confirm-party', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pendingId, choice, partyName })
  }).then(r => r.json());

  appendChatMessage('ai', res.message || 'تایید انجام شد.');
  loadAllData();
}

async function toggleVoiceRecord() {
  const micBtn = document.getElementById('mic-btn');

  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunks = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        sendAudioMessage(audioBlob);
      };

      mediaRecorder.start();
      isRecording = true;
      micBtn.classList.add('bg-rose-500', 'animate-pulse');
      micBtn.classList.remove('bg-slate-800');
      appendChatMessage('user', '🎤 در حال ضبط صدای شما... (مجدداً کلیک کنید تا ارسال شود)');
    } catch (err) {
      alert('دسترسی به میکروفون یافت نشد یا رد شد.');
    }
  } else {
    mediaRecorder.stop();
    isRecording = false;
    micBtn.classList.remove('bg-rose-500', 'animate-pulse');
    micBtn.classList.add('bg-slate-800');
  }
}

async function sendAudioMessage(audioBlob) {
  const loadingMsg = appendChatMessage('ai', '⏳ در حال ارسال فایل صوتی و استخراج درخواست...');
  const formData = new FormData();
  formData.append('audio', audioBlob, 'voice.webm');

  try {
    const res = await fetch('/api/ai/process', {
      method: 'POST',
      body: formData
    }).then(r => r.json());

    loadingMsg.remove();
    if (res.intent === 'CONFIRM_PARTY') {
      appendPartyConfirmMessage(res);
    } else {
      appendChatMessage('ai', res.message || 'پردازش انجام شد.');
    }
    loadAllData();
  } catch (err) {
    loadingMsg.remove();
    appendChatMessage('ai', '❌ خطا در پردازش فایل صوتی.');
  }
}

function appendChatMessage(sender, text) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `p-3 rounded-xl max-w-[85%] ${
    sender === 'user'
      ? 'bg-slate-800 text-slate-100 mr-auto border border-slate-700'
      : 'bg-cyan-500/10 text-cyan-200 ml-auto border border-cyan-500/20'
  }`;
  div.innerHTML = text.replace(/\n/g, '<br>');
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function toggleChatMinimize() {
  const body = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input-container');
  const icon = document.getElementById('chat-toggle-icon');

  body.classList.toggle('hidden');
  input.classList.toggle('hidden');
  icon.classList.toggle('rotate-180');
}

function openNewTxModal() {
  document.getElementById('tx-modal').classList.remove('hidden');
  document.getElementById('modal-date').value = new Date().toLocaleDateString('fa-IR');
}

function closeNewTxModal() {
  document.getElementById('tx-modal').classList.add('hidden');
}

async function submitNewTx(e) {
  e.preventDefault();
  const payload = {
    date: document.getElementById('modal-date').value,
    type: document.getElementById('modal-type').value,
    party_name: document.getElementById('modal-party').value,
    amount: document.getElementById('modal-amount').value,
    description: document.getElementById('modal-desc').value,
    tracking_code: document.getElementById('modal-tracking').value
  };

  const res = await fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json());

  if (res.success) {
    closeNewTxModal();
    loadAllData();
  } else {
    alert(res.message);
  }
}

let currentCurrency = 'IRR'; // 'IRR' یا 'TOMAN'
let ledgerChart = null;

let rawData = {
  summary: null,
  transactions: [],
  receipts: [],
  ledger: [],
  aiLogs: []
};

// ریکوردر صوتی
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
    const [sumRes, txRes, recRes, ledRes, aiRes] = await Promise.all([
      fetch('/api/dashboard/summary').then(r => r.json()),
      fetch('/api/transactions').then(r => r.json()),
      fetch('/api/receipts').then(r => r.json()),
      fetch('/api/ledger').then(r => r.json()),
      fetch('/api/ai/logs').then(r => r.json())
    ]);

    if (sumRes.success) rawData.summary = sumRes.data;
    if (txRes.success) rawData.transactions = txRes.data;
    if (recRes.success) rawData.receipts = recRes.data;
    if (ledRes.success) rawData.ledger = ledRes.data;
    if (aiRes.success) rawData.aiLogs = aiRes.data;

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

// 3. لیست بدهکاران برتر
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

// 4. آخرین تراکنش‌ها در داشبورد
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

// 5. جدول کامل تراکنش‌ها
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

// 6. جدول کامل رسیدها
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

// 8. جدول لاگ‌های AI
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
    'ai-logs': 'تاریخچه هوش مصنوعی 9router'
  };
  document.getElementById('page-title').textContent = titles[tabId] || 'دستیار مالی';
}

// فیلتر تراکنش‌ها
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

// حذف تراکنش
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
    appendChatMessage('ai', res.message || 'پردازش انجام شد.');
    loadAllData();
  } catch (err) {
    loadingMsg.remove();
    appendChatMessage('ai', '❌ خطا در ارسال درخواست به AI.');
  }
}

// رکورد ویس صوتی
async function toggleVoiceRecord() {
  const micBtn = document.getElementById('mic-btn');
  const micIcon = document.getElementById('mic-icon');

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
    appendChatMessage('ai', res.message || 'پردازش فایل صوتی انجام شد.');
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

// مودال ثبت دستی تراکنش
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

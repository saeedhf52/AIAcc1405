const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const db = require('./server/config/database');
const apiRoutes = require('./server/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// میدلورها
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// فایل‌های استاتیک فرانت‌اند
app.use(express.static(path.join(__dirname, 'public')));

// مسیرهای API
app.use('/api', apiRoutes);

// مسیر اصلی فرانت‌اند
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 دستیار هوشمند مالی و حسابداری روی پورت ${PORT} اجرا شد.`);
  console.log(`🌐 داشبورد وب: http://localhost:${PORT}`);
  console.log(`==================================================`);
});

# دستیار هوشمند مالی و حسابداری شخصی (Smart Financial Assistant)

نرم‌افزار هوشمند، مدرن و کامل حسابداری شخصی بر پایه **Node.js**، **SQLite**، **هوش مصنوعی (9router)** و **داشبورد فارسی راست‌چین (RTL)**.

## 🌟 ویژگی‌های کلیدی
- **دیتابیس محلی SQLite**: ذخیره‌سازی سریع، ایمن و مستقل تمام اشخاص، تراکنش‌ها و رسیدها.
- **پردازش دو مداله متنی و صوتی (AI)**: ثبت اتوماتیک تراکنش‌ها و رسیدها از روی متن فارسی یا فایل صوتی ثبت‌شده (ویس).
- **تبدیل خودکار تومان به ریال**: محاسبه دقیق مبالغ و استانداردسازی تمام مبالغ در دیتابیس به ریال.
- **داشبورد مدرن فارسی**: طراحی شیک با Vazirmatn، Tailwind CSS، کارت‌های KPI و نمودارهای مقایسه‌ای Chart.js.
- **واردات آسان داده‌های اکسل**: اسکریپت امپورت اتوماتیک از شیت‌های اکسل (`Acc1405.xlsx`).
- **پشتیبانی کامل از تاریخ جلالی (هجری شمسی)**: به صورت ۱۰ رقمی استاندار و دقیق (`1405/05/17`).

---

## 🛠️ راهنمای نصب و اجرای پروژه

### ۱. پیش‌نیازها
- Node.js (نسخه 18 یا بالاتر)

### ۲. نصب وابستگی‌ها
```bash
npm install
```

### ۳. تنظیم متغیرهای محیطی (`.env`)
فایل `.env` را در ریشه پروژه تنظیم کنید:
```env
PORT=3000
DATABASE_PATH=./data/accounting.db
EXCEL_SOURCE_PATH=D:\SaeedHf52\AiAcc1405\Acc1405.xlsx
AI_API_BASE_URL=https://saeed-9router-cloud.onrender.com/v1/chat/completions
AI_API_KEY=sk-433b65e8f172ca9a-6cijkx-4d45e864
AI_MODEL_NAME=claude-smart-ai-kb
```

### ۴. امپورت اولیه داده‌ها از اکسل
```bash
npm run seed
```

### ۵. اجرای برنامه
```bash
npm start
```
سپس مرورگر خود را باز کرده و وارد آدرس زیر شوید:
`http://localhost:3000`

---

## 📁 ساختار پوشه‌های پروژه
```text
/server
  /config (database.js)
  /routes (api.js)
  /services (aiService.js, excelImporter.js, jalaliUtils.js, ledgerService.js)
/public
  /js (app.js)
  index.html
/data (accounting.db)
server.js
package.json
```

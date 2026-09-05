const jalaali = require('jalaali-js');

function normalizeNumbers(str) {
  if (str === null || str === undefined) return '';
  str = String(str);
  const persianNumbers = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicNumbers  = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  for (let i = 0; i < 10; i++) {
    str = str.replace(persianNumbers[i], i).replace(arabicNumbers[i], i);
  }
  return str.trim();
}

function getFormattedJalaliDate(inputDate) {
  if (!inputDate) {
    const today = new Date();
    const jDate = jalaali.toJalaali(today);
    const m = jDate.jm < 10 ? '0' + jDate.jm : jDate.jm;
    const d = jDate.jd < 10 ? '0' + jDate.jd : jDate.jd;
    return `${jDate.jy}/${m}/${d}`;
  }
  let dStr = normalizeNumbers(inputDate);
  const parts = dStr.split('/');
  if (parts.length === 3) {
    const y = parts[0];
    const m = parts[1].length === 1 ? '0' + parts[1] : parts[1];
    const d = parts[2].length === 1 ? '0' + parts[2] : parts[2];
    return `${y}/${m}/${d}`;
  }
  return dStr;
}

function parseAmount(val) {
  if (!val) return 0;
  const normalized = normalizeNumbers(val).replace(/,/g, '').replace(/_/g, '');
  const num = parseInt(normalized, 10);
  return isNaN(num) ? 0 : num;
}

module.exports = {
  normalizeNumbers,
  getFormattedJalaliDate,
  parseAmount
};

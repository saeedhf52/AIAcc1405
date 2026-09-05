const db = require('../config/database');
const { normalizeNumbers } = require('./jalaliUtils');

// تمیزکاری نام جهت مقایسه (حذف پیشوندها و پسوندهای رایج)
function cleanPartyName(name) {
  if (!name) return '';
  let clean = normalizeNumbers(name);
  clean = clean.replace(/آقای|خانم|مهندس|حاج|دکتر|شرکت|گروه|جناب|صادق/g, '').trim();
  clean = clean.replace(/\s+/g, ' ');
  return clean;
}

// محاسبه درصد تشابه دو رشته (Levenshtein Distance)
function similarity(s1, s2) {
  let str1 = cleanPartyName(s1);
  let str2 = cleanPartyName(s2);

  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;

  if (str1.includes(str2) || str2.includes(str1)) {
    return 0.85; // تشابه زیر‌رشته‌ای بالا
  }

  const l1 = str1.length;
  const l2 = str2.length;
  const matrix = [];

  for (let i = 0; i <= l2; i++) matrix[i] = [i];
  for (let j = 0; j <= l1; j++) matrix[0][j] = j;

  for (let i = 1; i <= l2; i++) {
    for (let j = 1; j <= l1; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[l2][l1];
  const maxLen = Math.max(l1, l2);
  return (maxLen - distance) / maxLen;
}

// جستجوی نام‌های کاندید در جدول اشخاص
function findMatchingParty(extractedName) {
  if (!extractedName) return { action: 'NEW', party: null };

  const normInput = normalizeNumbers(extractedName);
  const parties = db.prepare('SELECT * FROM parties').all();

  let bestMatch = null;
  let highestScore = 0;

  for (const party of parties) {
    const score = similarity(normInput, party.name);
    if (score > highestScore) {
      highestScore = score;
      bestMatch = party;
    }
  }

  // 1. تشابه کامل (100% یا دقیق)
  if (highestScore >= 0.90) {
    return {
      action: 'EXACT',
      party: bestMatch,
      score: highestScore
    };
  }

  // 2. تشابه نسبی (نیازمند تایید کاربر)
  if (highestScore >= 0.50) {
    return {
      action: 'CONFIRM',
      party: bestMatch,
      score: highestScore
    };
  }

  // 3. شخص کاملاً جدید
  return {
    action: 'NEW',
    party: null,
    score: 0
  };
}

module.exports = {
  cleanPartyName,
  similarity,
  findMatchingParty
};

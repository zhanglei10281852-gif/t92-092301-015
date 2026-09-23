const MEAL_PRICES = { A: 12, B: 15, C: 18 };
const SUBSIDY_RATES = { low_income_full: 15, low_income: 10, normal: 5, senior_extra: 5 };
const SENIOR_AGE_THRESHOLD = 80;
const SENIOR_SUBSIDY = 3;

function calculateSubsidy(elderly, mealPrice) {
  const base = SUBSIDY_RATES[elderly.subsidy_category] ?? 0;
  const senior = Number(elderly.age) >= SENIOR_AGE_THRESHOLD ? SENIOR_SUBSIDY : 0;
  const total = Math.min(mealPrice, base + senior);
  return {
    baseSubsidy: Math.min(base, total),
    seniorSubsidy: Math.max(0, total - Math.min(base, total)),
    totalSubsidy: total,
    selfPayAmount: Math.max(0, mealPrice - total),
  };
}

function monthKey(date) {
  return String(date).slice(0, 7);
}

function orderNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `ORD${stamp}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

module.exports = { MEAL_PRICES, calculateSubsidy, monthKey, orderNumber };

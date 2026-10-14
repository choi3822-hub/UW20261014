// 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다 (문자열 비교 = 날짜 비교).
const DAY_MS = 86400000;

const toUtc = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (ymd, n) => fromUtc(toUtc(ymd) + n * DAY_MS);

export const diffDays = (from, to) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// 로컬 시간 기준 오늘 날짜
export function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// 전날 기준(D-1)
export const yesterday = (now = new Date()) => addDays(today(now), -1);

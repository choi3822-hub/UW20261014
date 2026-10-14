import { STATUSES, STATUS_LABEL, isClosed } from './status.js';
import { dateRange, diffDays } from './dates.js';

export const DEFAULT_SLA_DAYS = 3;

/**
 * 심사건 레코드
 * {
 *   appNo, applyDate, assignDate, channel, salesChannel, product, reviewer,
 *   history: [{ date, status }]   // 심사자 작업화면의 상태변경 이력 (날짜 오름차순)
 * }
 */

// 기준일 종료 시점의 상태. 기준일까지 분배되지 않았으면 null.
export function statusAsOf(rec, date) {
  if (rec.assignDate > date) return null;
  let status = 'ASSIGNED';
  for (const h of rec.history) {
    if (h.date > date) break;
    status = h.status;
  }
  return status;
}

// 기준일까지 종결되었다면 종결일, 아니면 null
export function closedDateAsOf(rec, date) {
  let closed = null;
  for (const h of rec.history) {
    if (h.date > date) break;
    closed = isClosed(h.status) ? h.date : null;
  }
  return closed;
}

// 기준일 시점의 파생 컬럼(상태, 경과일수, 지연여부)을 붙인 행
export function toRow(rec, baseDate, slaDays = DEFAULT_SLA_DAYS) {
  const status = statusAsOf(rec, baseDate);
  const closedDate = closedDateAsOf(rec, baseDate);
  const elapsedDays = diffDays(rec.assignDate, closedDate ?? baseDate);
  return {
    ...rec,
    status,
    statusLabel: STATUS_LABEL[status],
    closedDate,
    elapsedDays,
    delayed: !closedDate && elapsedDays > slaDays,
  };
}

/**
 * 조건 검색.
 * - 기간: 분배일자 기준 [from, to] (to는 기준일을 넘지 않음)
 * - channel / salesChannel / status: '' 이면 전체
 * 반환: { base, rows }
 *   base: 기간·채널·영업채널 조건만 적용 (전체 건수 = 비율의 분모)
 *   rows: base에 심사상태·지연건 조건까지 적용 (상세내역 / 엑셀)
 */
export function query(records, opts) {
  const {
    from, to, baseDate,
    channel = '', salesChannel = '', status = '', delayedOnly = false,
    slaDays = DEFAULT_SLA_DAYS,
  } = opts;
  const end = to < baseDate ? to : baseDate;
  const base = records
    .filter((r) => r.assignDate >= from && r.assignDate <= end)
    .filter((r) => !channel || r.channel === channel)
    .filter((r) => !salesChannel || r.salesChannel === salesChannel)
    .map((r) => toRow(r, baseDate, slaDays))
    .sort((a, b) => (a.assignDate === b.assignDate ? a.appNo.localeCompare(b.appNo) : a.assignDate < b.assignDate ? -1 : 1));
  const rows = base
    .filter((r) => !status || r.status === status)
    .filter((r) => !delayedOnly || r.delayed);
  return { base, rows };
}

const ratio = (n, total) => (total ? n / total : 0);

// 핵심지표: 상태별 건수/비율, 누적심사(종결)건수, 진행중, 지연
export function summarize(rows) {
  const total = rows.length;
  const counts = Object.fromEntries(STATUSES.map((s) => [s.code, 0]));
  let delayed = 0;
  for (const r of rows) {
    counts[r.status]++;
    if (r.delayed) delayed++;
  }
  const byStatus = STATUSES.map((s) => ({
    code: s.code, label: s.label, closed: s.closed,
    count: counts[s.code], ratio: ratio(counts[s.code], total),
  }));
  const closed = byStatus.filter((s) => s.closed).reduce((a, s) => a + s.count, 0);
  const inProgress = total - closed;
  return {
    total,
    byStatus,
    closed, closedRatio: ratio(closed, total),
    inProgress, inProgressRatio: ratio(inProgress, total),
    delayed, delayedRatio: ratio(delayed, total),
  };
}

// 일별 현황: 해당일 신규분배 / 해당일 종결 / 누적분배 / 누적종결 / 일말 진행중 / 일말 지연
export function dailyTrend(records, from, to, slaDays = DEFAULT_SLA_DAYS) {
  return dateRange(from, to).map((date) => {
    let assigned = 0, closedToday = 0, cumAssigned = 0, cumClosed = 0, delayed = 0;
    for (const r of records) {
      if (r.assignDate > date || r.assignDate < from) continue;
      cumAssigned++;
      if (r.assignDate === date) assigned++;
      const closedDate = closedDateAsOf(r, date);
      if (closedDate) {
        cumClosed++;
        if (closedDate === date) closedToday++;
      } else if (diffDays(r.assignDate, date) > slaDays) {
        delayed++;
      }
    }
    return {
      date, assigned, closed: closedToday, cumAssigned, cumClosed,
      inProgress: cumAssigned - cumClosed, delayed,
      closedRatio: ratio(cumClosed, cumAssigned),
    };
  });
}

// 심사자별 상태 건수
export function byReviewer(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.reviewer)) {
      map.set(r.reviewer, { reviewer: r.reviewer, total: 0, closed: 0, delayed: 0,
        counts: Object.fromEntries(STATUSES.map((s) => [s.code, 0])) });
    }
    const m = map.get(r.reviewer);
    m.total++;
    m.counts[r.status]++;
    if (r.closedDate) m.closed++;
    if (r.delayed) m.delayed++;
  }
  return [...map.values()]
    .map((m) => ({ ...m, inProgress: m.total - m.closed, closedRatio: ratio(m.closed, m.total) }))
    .sort((a, b) => a.reviewer.localeCompare(b.reviewer));
}

// 검색조건 콤보박스용 목록
export function distinct(records, key) {
  return [...new Set(records.map((r) => r[key]))].sort();
}

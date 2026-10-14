import { STATUSES, STATUS_LABEL } from './status.js';
import { summarize, dailyTrend, byReviewer } from './metrics.js';

const pct = (r) => Math.round(r * 1000) / 10; // 0.1234 -> 12.3

// 엑셀 다운로드용 시트 구성: 요약 / 일별현황 / 심사자별현황 / 상세내역
export function buildReportSheets({ base, rows }, opts) {
  const { from, to, baseDate, channel, salesChannel, status, delayedOnly, slaDays } = opts;
  const end = to < baseDate ? to : baseDate;
  const s = summarize(base);

  const summary = [
    ['항목', '값'],
    ['기준일', baseDate],
    ['조회기간(분배일자)', `${from} ~ ${end}`],
    ['채널', channel || '전체'],
    ['영업채널', salesChannel || '전체'],
    ['심사상태', status ? STATUS_LABEL[status] : '전체'],
    ['지연건만', delayedOnly ? 'Y' : 'N'],
    ['지연기준(SLA, 일)', slaDays],
    [],
    ['지표', '건수', '비율(%)'],
    ['전체(분배)건수', s.total, 100],
    ['누적심사(종결)건수', s.closed, pct(s.closedRatio)],
    ['진행중 건수', s.inProgress, pct(s.inProgressRatio)],
    ['심사지연건수', s.delayed, pct(s.delayedRatio)],
    ...s.byStatus.map((b) => [`  ${b.label}`, b.count, pct(b.ratio)]),
  ];

  const daily = [
    ['일자', '신규분배', '당일종결', '누적분배', '누적종결', '진행중', '지연', '누적종결률(%)'],
    ...dailyTrend(base, from, end, slaDays).map((d) => [
      d.date, d.assigned, d.closed, d.cumAssigned, d.cumClosed, d.inProgress, d.delayed, pct(d.closedRatio),
    ]),
  ];

  const reviewer = [
    ['심사자', '전체', ...STATUSES.map((x) => x.label), '종결', '진행중', '지연', '종결률(%)'],
    ...byReviewer(rows).map((m) => [
      m.reviewer, m.total, ...STATUSES.map((x) => m.counts[x.code]), m.closed, m.inProgress, m.delayed, pct(m.closedRatio),
    ]),
  ];

  const detail = [
    ['청약번호', '청약일자', '분배일자', '채널', '영업채널', '상품', '심사자', '심사상태', '종결일자', '경과일수', '지연여부'],
    ...rows.map((r) => [
      r.appNo, r.applyDate, r.assignDate, r.channel, r.salesChannel, r.product, r.reviewer,
      r.statusLabel, r.closedDate ?? '', r.elapsedDays, r.delayed ? 'Y' : 'N',
    ]),
  ];

  return [
    { name: '요약', rows: summary },
    { name: '일별현황', rows: daily },
    { name: '심사자별현황', rows: reviewer },
    { name: '상세내역', rows: detail },
  ];
}

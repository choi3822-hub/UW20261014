import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusAsOf, closedDateAsOf, toRow, query, summarize, dailyTrend, byReviewer } from '../src/metrics.js';

const rec = (appNo, assignDate, history, extra = {}) => ({
  appNo, applyDate: assignDate, assignDate, channel: '대면', salesChannel: '서울본부', product: '종신보험', reviewer: '김심사',
  history: [{ date: assignDate, status: 'ASSIGNED' }, ...history], ...extra,
});

const A = rec('A', '2026-10-01', [{ date: '2026-10-02', status: 'IN_REVIEW' }, { date: '2026-10-04', status: 'APPROVED' }]);
const B = rec('B', '2026-10-01', [{ date: '2026-10-01', status: 'IN_REVIEW' }, { date: '2026-10-02', status: 'PENDING_DOCS' }],
  { channel: 'TM', salesChannel: 'TM1센터', reviewer: '이심사' });
const C = rec('C', '2026-10-03', [{ date: '2026-10-03', status: 'DECLINED' }]);
const D = rec('D', '2026-10-06', []);

test('기준일 시점 상태는 기준일 이전 마지막 이력', () => {
  assert.equal(statusAsOf(A, '2026-09-30'), null);
  assert.equal(statusAsOf(A, '2026-10-01'), 'ASSIGNED');
  assert.equal(statusAsOf(A, '2026-10-03'), 'IN_REVIEW');
  assert.equal(statusAsOf(A, '2026-10-10'), 'APPROVED');
  assert.equal(closedDateAsOf(A, '2026-10-03'), null);
  assert.equal(closedDateAsOf(A, '2026-10-10'), '2026-10-04');
});

test('종결 후 재진행된 건은 미종결로 본다', () => {
  const r = rec('R', '2026-10-01', [{ date: '2026-10-02', status: 'APPROVED' }, { date: '2026-10-03', status: 'IN_REVIEW' }]);
  assert.equal(closedDateAsOf(r, '2026-10-02'), '2026-10-02');
  assert.equal(closedDateAsOf(r, '2026-10-05'), null);
});

test('경과일수와 지연 여부 (SLA 초과)', () => {
  const a = toRow(A, '2026-10-10', 3);
  assert.equal(a.elapsedDays, 3); // 종결일까지
  assert.equal(a.delayed, false);
  const b = toRow(B, '2026-10-10', 3);
  assert.equal(b.elapsedDays, 9);
  assert.equal(b.delayed, true);
  assert.equal(toRow(B, '2026-10-04', 3).delayed, false); // 3일 = 경계, 초과 아님
  assert.equal(toRow(B, '2026-10-05', 3).delayed, true);
});

test('조건 검색: 기간/채널/영업채널/상태/지연건', () => {
  const all = [A, B, C, D];
  const o = { from: '2026-10-01', to: '2026-10-31', baseDate: '2026-10-05', slaDays: 3 };
  // to가 기준일보다 늦으면 기준일까지만
  assert.deepEqual(query(all, o).base.map((r) => r.appNo), ['A', 'B', 'C']);
  assert.deepEqual(query(all, { ...o, from: '2026-10-02' }).base.map((r) => r.appNo), ['C']);
  assert.deepEqual(query(all, { ...o, channel: 'TM' }).rows.map((r) => r.appNo), ['B']);
  assert.deepEqual(query(all, { ...o, salesChannel: '서울본부' }).rows.map((r) => r.appNo), ['A', 'C']);
  const s = query(all, { ...o, status: 'DECLINED' });
  assert.deepEqual(s.rows.map((r) => r.appNo), ['C']);
  assert.equal(s.base.length, 3); // 상태 조건은 비율 분모에 영향 없음
  assert.deepEqual(query(all, { ...o, delayedOnly: true }).rows.map((r) => r.appNo), ['B']);
});

test('핵심지표: 상태별 건수/비율, 누적심사건수, 지연', () => {
  const { base } = query([A, B, C, D], { from: '2026-10-01', to: '2026-10-10', baseDate: '2026-10-10', slaDays: 3 });
  const s = summarize(base);
  assert.equal(s.total, 4);
  const by = Object.fromEntries(s.byStatus.map((b) => [b.code, b]));
  assert.equal(by.APPROVED.count, 1);
  assert.equal(by.DECLINED.count, 1);
  assert.equal(by.PENDING_DOCS.count, 1);
  assert.equal(by.ASSIGNED.count, 1);
  assert.equal(by.APPROVED.ratio, 0.25);
  assert.equal(s.byStatus.reduce((a, b) => a + b.count, 0), s.total);
  assert.equal(s.closed, 2);
  assert.equal(s.inProgress, 2);
  assert.equal(s.delayed, 2); // B(9일), D(4일)
  assert.equal(summarize([]).closedRatio, 0);
});

test('일별 현황: 신규분배/당일종결/누적', () => {
  const days = dailyTrend([A, B, C, D], '2026-10-01', '2026-10-06', 3);
  const by = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal(days.length, 6);
  assert.deepEqual([by['2026-10-01'].assigned, by['2026-10-01'].cumAssigned, by['2026-10-01'].cumClosed], [2, 2, 0]);
  assert.deepEqual([by['2026-10-03'].closed, by['2026-10-03'].cumClosed], [1, 1]);
  assert.deepEqual([by['2026-10-04'].closed, by['2026-10-04'].cumClosed, by['2026-10-04'].inProgress], [1, 2, 1]);
  assert.equal(by['2026-10-05'].delayed, 1); // B: 4일 경과
  assert.deepEqual([by['2026-10-06'].cumAssigned, by['2026-10-06'].inProgress], [4, 2]);
});

test('심사자별 현황', () => {
  const { rows } = query([A, B, C, D], { from: '2026-10-01', to: '2026-10-10', baseDate: '2026-10-10', slaDays: 3 });
  const list = byReviewer(rows);
  assert.deepEqual(list.map((m) => [m.reviewer, m.total, m.closed, m.delayed]), [['김심사', 3, 2, 1], ['이심사', 1, 0, 1]]);
});

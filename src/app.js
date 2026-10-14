import { STATUSES } from './status.js';
import { addDays, yesterday } from './dates.js';
import { query, summarize, dailyTrend, byReviewer, distinct, DEFAULT_SLA_DAYS } from './metrics.js';
import { buildReportSheets } from './report.js';
import { buildXlsx, XLSX_MIME } from './xlsx.js';
import { generateSampleData, CHANNELS } from './sampleData.js';

const PAGE = 100;
const DEFAULT_DAYS = 30;

const $ = (sel) => document.querySelector(sel);
const form = $('#search');
const fmt = (n) => n.toLocaleString('ko-KR');
const pct = (r) => `${(r * 100).toFixed(1)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 전날 기준(D-1) 데이터
const BASE = yesterday();
const records = generateSampleData({ endDate: BASE });

let result = { base: [], rows: [] };
let shown = PAGE;

function defaults() {
  return { baseDate: BASE, from: addDays(BASE, -(DEFAULT_DAYS - 1)), to: BASE,
    channel: '', salesChannel: '', status: '', delayedOnly: false, slaDays: DEFAULT_SLA_DAYS };
}

function readForm() {
  const f = new FormData(form);
  return {
    baseDate: f.get('baseDate'),
    from: f.get('from'),
    to: f.get('to'),
    channel: f.get('channel'),
    salesChannel: f.get('salesChannel'),
    status: f.get('status'),
    delayedOnly: f.get('delayedOnly') === 'on',
    slaDays: Math.max(0, Number(f.get('slaDays')) || 0),
  };
}

function writeForm(o) {
  form.baseDate.value = o.baseDate;
  form.from.value = o.from;
  form.to.value = o.to;
  form.channel.value = o.channel;
  fillSalesChannels();
  form.salesChannel.value = o.salesChannel;
  form.status.value = o.status;
  form.delayedOnly.checked = o.delayedOnly;
  form.slaDays.value = o.slaDays;
}

const options = (list) => list.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');

function fillSalesChannels() {
  const ch = form.channel.value;
  const list = ch ? CHANNELS[ch] : distinct(records, 'salesChannel');
  form.salesChannel.innerHTML = options([['', '전체'], ...list.map((v) => [v, v])]);
}

function initForm() {
  form.baseDate.max = BASE;
  form.channel.innerHTML = options([['', '전체'], ...distinct(records, 'channel').map((v) => [v, v])]);
  form.status.innerHTML = options([['', '전체'], ...STATUSES.map((s) => [s.code, s.label])]);
  writeForm(defaults());
}

function run() {
  const o = readForm();
  if (o.from > o.to) { alert('기간 시작일이 종료일보다 늦습니다.'); return false; }
  result = query(records, o);
  shown = PAGE;
  $('#baseLabel').textContent = o.baseDate;
  renderKpis(summarize(result.base));
  renderStatus(summarize(result.base), o.status);
  renderDaily(dailyTrend(result.base, o.from, o.to < o.baseDate ? o.to : o.baseDate, o.slaDays));
  renderReviewers(byReviewer(result.rows));
  renderDetail();
  return true;
}

function renderKpis(s) {
  const card = (label, value, ratio, cls = '') =>
    `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${fmt(value)}${ratio === undefined ? '' : `<small>${pct(ratio)}</small>`}</div></div>`;
  $('#kpis').innerHTML = card('전체(분배)건수', s.total)
    + card('누적심사(종결)건수', s.closed, s.closedRatio)
    + card('진행중 건수', s.inProgress, s.inProgressRatio)
    + card('심사지연건수', s.delayed, s.delayedRatio, s.delayed ? 'warn' : '');
}

function renderStatus(s, selected) {
  $('#statusBar').innerHTML = s.byStatus.filter((b) => b.count)
    .map((b) => `<span style="width:${b.ratio * 100}%;background:var(--s-${b.code})" title="${b.label} ${fmt(b.count)}건 (${pct(b.ratio)})"></span>`).join('');
  $('#statusBar').setAttribute('aria-label', s.byStatus.map((b) => `${b.label} ${pct(b.ratio)}`).join(', '));
  $('#statusTable').innerHTML = '<thead><tr><th>심사상태</th><th class="l">구분</th><th>건수</th><th>비율</th></tr></thead><tbody>'
    + s.byStatus.map((b) => `<tr class="clickable${b.code === selected ? ' selected' : ''}" data-status="${b.code}">
        <td><span class="dot" style="background:var(--s-${b.code})"></span>${b.label}</td>
        <td class="l">${b.closed ? '종결' : '진행중'}</td><td>${fmt(b.count)}</td><td>${pct(b.ratio)}</td></tr>`).join('')
    + `</tbody><tfoot><tr><td>합계</td><td></td><td>${fmt(s.total)}</td><td>${s.total ? '100.0%' : '-'}</td></tr></tfoot>`;
}

function renderDaily(days) {
  const rows = [...days].reverse(); // 최신일자 먼저
  $('#dailyTable').innerHTML = '<thead><tr><th>일자</th><th>신규분배</th><th>당일종결</th><th>누적분배</th><th>누적종결</th><th>진행중</th><th>지연</th><th class="l">누적종결률</th></tr></thead><tbody>'
    + rows.map((d) => `<tr><td>${d.date}</td><td>${fmt(d.assigned)}</td><td>${fmt(d.closed)}</td><td>${fmt(d.cumAssigned)}</td>
        <td>${fmt(d.cumClosed)}</td><td>${fmt(d.inProgress)}</td><td class="${d.delayed ? 'warn' : ''}">${fmt(d.delayed)}</td>
        <td class="l"><span class="bar" style="width:${Math.round(d.closedRatio * 80)}px"></span>${pct(d.closedRatio)}</td></tr>`).join('')
    + '</tbody>';
}

function renderReviewers(list) {
  const head = `<thead><tr><th>심사자</th><th>전체</th>${STATUSES.map((s) => `<th>${s.label}</th>`).join('')}<th>종결</th><th>진행중</th><th>지연</th><th>종결률</th></tr></thead>`;
  const sum = (f) => list.reduce((a, m) => a + f(m), 0);
  const total = sum((m) => m.total), closed = sum((m) => m.closed);
  $('#reviewerTable').innerHTML = head + '<tbody>'
    + list.map((m) => `<tr><td>${esc(m.reviewer)}</td><td>${fmt(m.total)}</td>${STATUSES.map((s) => `<td>${fmt(m.counts[s.code])}</td>`).join('')}
        <td>${fmt(m.closed)}</td><td>${fmt(m.inProgress)}</td><td class="${m.delayed ? 'warn' : ''}">${fmt(m.delayed)}</td><td>${pct(m.closedRatio)}</td></tr>`).join('')
    + `</tbody><tfoot><tr><td>합계</td><td>${fmt(total)}</td>${STATUSES.map((s) => `<td>${fmt(sum((m) => m.counts[s.code]))}</td>`).join('')}
        <td>${fmt(closed)}</td><td>${fmt(total - closed)}</td><td>${fmt(sum((m) => m.delayed))}</td><td>${total ? pct(closed / total) : '-'}</td></tr></tfoot>`;
}

function renderDetail() {
  const { rows } = result;
  $('#detailCount').textContent = `${fmt(rows.length)}건 중 ${fmt(Math.min(shown, rows.length))}건 표시 · 지연건 강조`;
  $('#detailTable').innerHTML = '<thead><tr><th>청약번호</th><th class="l">청약일자</th><th class="l">분배일자</th><th class="l">채널</th><th class="l">영업채널</th><th class="l">상품</th><th class="l">심사자</th><th class="l">심사상태</th><th class="l">종결일자</th><th>경과일수</th><th>지연</th></tr></thead><tbody>'
    + rows.slice(0, shown).map((r) => `<tr class="${r.delayed ? 'delayed' : ''}"><td>${esc(r.appNo)}</td><td class="l">${r.applyDate}</td><td class="l">${r.assignDate}</td>
        <td class="l">${esc(r.channel)}</td><td class="l">${esc(r.salesChannel)}</td><td class="l">${esc(r.product)}</td><td class="l">${esc(r.reviewer)}</td>
        <td class="l"><span class="dot" style="background:var(--s-${r.status})"></span>${r.statusLabel}</td><td class="l">${r.closedDate ?? '-'}</td>
        <td>${r.elapsedDays}</td><td class="${r.delayed ? 'warn' : ''}">${r.delayed ? 'Y' : ''}</td></tr>`).join('')
    + '</tbody>';
  $('#more').hidden = shown >= rows.length;
}

function download() {
  const o = readForm();
  const bytes = buildXlsx(buildReportSheets(result, o));
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `uw_status_${o.baseDate.replace(/-/g, '')}.xlsx` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
form.channel.addEventListener('change', fillSalesChannels);
$('#reset').addEventListener('click', () => { writeForm(defaults()); run(); });
$('#download').addEventListener('click', () => { if (run()) download(); });
$('#more').addEventListener('click', () => { shown += PAGE; renderDetail(); });
$('#statusTable').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-status]');
  if (!tr) return;
  form.status.value = form.status.value === tr.dataset.status ? '' : tr.dataset.status;
  run();
});

initForm();
run();

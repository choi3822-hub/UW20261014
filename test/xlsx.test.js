import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildXlsx } from '../src/xlsx.js';
import { buildReportSheets } from '../src/report.js';
import { query } from '../src/metrics.js';
import { generateSampleData } from '../src/sampleData.js';

test('xlsx는 ZIP 구조(로컬헤더 + EOCD)를 가진다', () => {
  const bytes = buildXlsx([{ name: '시트', rows: [['a', 'b'], [1, '<&>']] }]);
  const dv = new DataView(bytes.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(bytes.length - 12, true), 6); // 고정 5개 파일 + 시트 1
});

test('리포트는 요약/일별/심사자별/상세 4개 시트', () => {
  const baseDate = '2026-10-13';
  const opts = { from: '2026-09-14', to: baseDate, baseDate, channel: '', salesChannel: '', status: '', delayedOnly: false, slaDays: 3 };
  const res = query(generateSampleData({ endDate: baseDate }), opts);
  const sheets = buildReportSheets(res, opts);
  assert.deepEqual(sheets.map((s) => s.name), ['요약', '일별현황', '심사자별현황', '상세내역']);
  assert.equal(sheets[1].rows.length, 1 + 30);
  assert.equal(sheets[3].rows.length, 1 + res.rows.length);
});

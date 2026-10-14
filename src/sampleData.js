// 데모용 샘플 데이터 (심사자분배 + 심사자 작업화면 상태변경 이력).
// 실제 운영 시에는 이 모듈 대신 분배/작업 테이블을 조회하는 API 결과로 대체한다.
import { addDays } from './dates.js';

export const CHANNELS = {
  대면: ['서울본부', '경인본부', '영남본부', '호남본부'],
  TM: ['TM1센터', 'TM2센터'],
  CM: ['다이렉트'],
  GA: ['GA-A', 'GA-B', 'GA-C'],
  방카: ['방카-A은행', '방카-B은행'],
};
const PRODUCTS = ['종신보험', '건강보험', '암보험', '연금보험', '실손보험'];
const REVIEWERS = ['김심사', '이심사', '박심사', '최심사', '정심사', '한심사'];

// 결정적 난수 (같은 seed -> 같은 데이터)
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSampleData({ endDate, days = 60, perDay = [15, 40], seed = 20261014 } = {}) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const records = [];
  let seq = 0;

  for (let i = days - 1; i >= 0; i--) {
    const assignDate = addDays(endDate, -i);
    const n = int(perDay[0], perDay[1]);
    for (let k = 0; k < n; k++) {
      const channel = pick(Object.keys(CHANNELS));
      const history = [{ date: assignDate, status: 'ASSIGNED' }];
      let d = assignDate;
      const push = (gap, status) => {
        d = addDays(d, gap);
        if (d <= endDate) history.push({ date: d, status });
        return d <= endDate;
      };
      if (push(int(0, 2), 'IN_REVIEW')) {
        let ok = true;
        if (rand() < 0.25) ok = push(int(0, 1), 'PENDING_DOCS') && push(int(1, 4), 'IN_REVIEW');
        if (ok) {
          const r = rand();
          const final = r < 0.62 ? 'APPROVED' : r < 0.8 ? 'CONDITIONAL' : r < 0.92 ? 'DECLINED' : 'WITHDRAWN';
          // 일부 건은 장기 미결로 남겨 지연건 발생
          if (rand() > 0.04) push(int(0, 4), final);
        }
      }
      records.push({
        appNo: `AP${assignDate.replace(/-/g, '')}${String(++seq).padStart(5, '0')}`,
        applyDate: addDays(assignDate, -int(0, 2)),
        assignDate,
        channel,
        salesChannel: pick(CHANNELS[channel]),
        product: pick(PRODUCTS),
        reviewer: pick(REVIEWERS),
        history,
      });
    }
  }
  return records;
}

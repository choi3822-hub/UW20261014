// 심사상태 코드 정의
export const STATUSES = [
  { code: 'ASSIGNED', label: '분배완료(미착수)', closed: false },
  { code: 'IN_REVIEW', label: '심사중', closed: false },
  { code: 'PENDING_DOCS', label: '보완요청', closed: false },
  { code: 'APPROVED', label: '승인', closed: true },
  { code: 'CONDITIONAL', label: '조건부승인', closed: true },
  { code: 'DECLINED', label: '거절', closed: true },
  { code: 'WITHDRAWN', label: '철회/취소', closed: true },
];

export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.code, s.label]));
export const CLOSED_CODES = new Set(STATUSES.filter((s) => s.closed).map((s) => s.code));

export const isClosed = (code) => CLOSED_CODES.has(code);

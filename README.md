# UW20261014 · 일별 심사현황 대시보드

청약완료 후 **심사자분배 건수**와 **심사자 작업화면의 상태변경 이력**을 조합해
전날(D-1) 기준 일별 심사현황을 보여주는 화면입니다. 요구사항은 [docs/PRD.md](docs/PRD.md)를 참고하세요.

## 실행
```bash
npm start          # http://localhost:8080  (의존성 없음, Node 18+)
npm test           # 집계 로직 / 엑셀 생성 단위 테스트
```

## 기능 (PRD 대응)
| PRD | 구현 |
| --- | --- |
| 일별 심사현황 (전날 기준) | 기준일 기본값 = 어제. 상태변경 이력으로 기준일 종료 시점 상태를 재현 |
| 심사상태별 건수 및 비율 | 상태별 표 + 누적막대, 전체(분배) 건수 대비 비율 |
| 누적심사건수 | 종결(승인·조건부승인·거절·철회) 누적 건수, 일별 누적종결률 |
| 조건 검색 | 기간(분배일자) / 채널 / 영업채널 / 심사상태 / 지연건만 |
| 엑셀 다운로드 | `.xlsx` – 요약, 일별현황, 심사자별현황, 상세내역 시트 |
| 심사지연 관리 | 분배일로부터 SLA(기본 3일) 초과 미종결 건 집계·강조 |

## 구조
```
index.html, styles.css   화면
src/app.js               화면 로직
src/metrics.js           조건 검색 · 지표 집계 (상태별/일별/심사자별)
src/report.js            엑셀 시트 구성
src/xlsx.js              무의존 .xlsx 생성기
src/status.js            심사상태 코드 정의
src/sampleData.js        데모용 샘플 데이터 → 운영 시 분배/작업 테이블 조회 API로 교체
```

## 운영 데이터 연동
`src/app.js`의 `generateSampleData(...)` 를 아래 형태의 레코드를 반환하는 API 호출로 교체하면 됩니다.
```js
{ appNo, applyDate, assignDate, channel, salesChannel, product, reviewer,
  history: [{ date: 'YYYY-MM-DD', status: 'ASSIGNED' | 'IN_REVIEW' | 'PENDING_DOCS' | 'APPROVED' | 'CONDITIONAL' | 'DECLINED' | 'WITHDRAWN' }] }
```

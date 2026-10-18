// 청약·심사 진행현황 대시보드
// 원천 자료 4종(+상태이력)을 증권번호로 묶어 건별 "현재 상태"와 "체류시간"을 계산합니다.

const DAY = 24 * 3600e3;
const toTime = (s) => (s.length > 10 ? new Date(`${s.replace(" ", "T")}:00+09:00`) : new Date(`${s}T00:00:00+09:00`)).getTime();
const fmt = (n) => n.toLocaleString("ko-KR");
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "0.0");
const days1 = (d) => (d == null ? "-" : `${d.toFixed(1)}일`);

const DEADLINE_DAYS = 30; // 심사기일: 청약일로부터 30일 안에 서류확인까지 끝나야 함
const NEAR_DEADLINE = 7;  // 남은 기일이 7일 이하면 '임박'
const SCAN_LIMIT_DAYS = 3; // 청약일로부터 3영업일 안에 스캔되지 않으면 '스캔 지연'
// 영업일 = 주말 · 공휴일 제외 (신계약 자료에 맞춘 휴일 목록)
const HOLIDAYS = new Set(["2026-09-24", "2026-09-25", "2026-10-09", "2026-12-25"]);
const isBizDay = (ymd) => { const w = new Date(`${ymd}T00:00:00Z`).getUTCDay(); return w !== 0 && w !== 6 && !HOLIDAYS.has(ymd); };
// from 다음날부터 to 전날까지 지나간 영업일 수 (to 당일은 아직 진행 중이므로 제외)
function bizDaysElapsed(from, to) {
  let n = 0;
  for (let d = new Date(`${from}T00:00:00Z`); ; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    const ymd = d.toISOString().slice(0, 10);
    if (ymd >= to) return n;
    if (isBizDay(ymd)) n++;
  }
}

// 상태 정의: 화면 순서 · 구간 · 허용 체류일(SLA) · 어느 화면에서 오는지
//   심사 구간    = 스캔 완료 → 심사의견 작성
//   서류확인 구간 = 심사의견 작성 → 종결 (보완 포함)
const STATUSES = [
  { key: "청약완료", group: "진행중", phase: "스캔 전", sla: SCAN_LIMIT_DAYS, bizSla: true, src: "장기대기현황" },
  { key: "스캔완료", group: "진행중", phase: "심사", sla: 2, src: "심사자분배 · 미심사" },
  { key: "심사중", group: "진행중", phase: "심사", sla: 3, src: "심사자분배 · 심사중" },
  { key: "보완중", group: "진행중", phase: "서류확인", sla: 7, src: "심사자분배 · 보완중" },
  { key: "모니터링대기", group: "진행중", phase: "심사", sla: 3, src: "모니터링방" },
  { key: "성립대기", group: "진행중", phase: "서류확인", sla: 2, src: "심사자분배 · 성립처리" },
  { key: "반송", group: "종결", src: "신계약현황 · 반송" },
  { key: "성립", group: "종결", src: "신계약현황 · 성립" },
  { key: "확인필요", group: "점검", src: "어느 화면에도 없음" },
];
const BY_KEY = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const PROGRESS = STATUSES.filter((s) => s.group === "진행중").map((s) => s.key);
const REVIEW_STEPS = new Set(STATUSES.filter((s) => s.phase === "심사").map((s) => s.key));
const SCREEN_TO_STATUS = { 미심사: "스캔완료", 심사중: "심사중", 보완중: "보완중", 성립처리: "성립대기" };
const GROUP_CLS = { 진행중: "g-open", 종결: "g-done", 점검: "g-check" }; // 단계별 현황 표의 그룹 배경
const SUPP_OWNER = "보완의뢰"; // 보완중 건은 심사자가 아니라 보완 담당으로 분배됨 (PRD)
const CHANNELS = ["방카", "GA", "HB", "온라인"]; // 화면 표시 순서
const RESULT_TO_STATUS = { 성립: "성립", 반송: "반송" };

// ── 1. 원천 자료 합치기 ──────────────────────────────────────────
// 상태이력에서 건별 스캔완료 · 심사의견 작성 시각을 뽑습니다
function milestones(history) {
  const map = new Map();
  for (const h of history) {
    const m = map.get(h.증권번호) ?? map.set(h.증권번호, {}).get(h.증권번호);
    if (h.상태 !== "청약완료" && m.scan == null) m.scan = toTime(h.시작일시);
    if (REVIEW_STEPS.has(h.상태)) m.opinion = h.종료일시 ? toTime(h.종료일시) : null;
    // 심사기일: 심사자 분배(심사중 시작) → 심사의견 작성(심사중 종료)
    if (h.상태 === "심사중") { m.distAt = toTime(h.시작일시); m.distEndAt = h.종료일시 ? toTime(h.종료일시) : null; }
  }
  return map;
}

function mergeSources(t, asOf) {
  const ms = milestones(t["5_상태이력"]);
  const dist = new Map(t["3_심사자분배현황"].map((r) => [r.증권번호, r]));
  const mon = new Map(t["4_모니터링방"].map((r) => [r.증권번호, r]));
  const wait = new Map(t["2_장기대기현황"].map((r) => [r.증권번호, r]));

  return t["1_일일신계약현황"].map((m) => {
    const applied = toTime(m.청약일자);
    let status, since = null, uw = "";
    const d = dist.get(m.증권번호);
    // 뒤 단계일수록 먼저 확인 → 여러 목록에 겹쳐도 가장 진행된 단계로 판정
    if (m.처리결과) { status = RESULT_TO_STATUS[m.처리결과]; since = toTime(m.처리일시); }
    else if (d) { status = SCREEN_TO_STATUS[d.분배상태]; since = toTime(d.상태변경일시); uw = d.심사자; }
    else if (mon.has(m.증권번호)) { status = "모니터링대기"; since = toTime(mon.get(m.증권번호).입실일시); }
    else if (wait.has(m.증권번호)) { status = "청약완료"; since = applied; }
    else status = "확인필요";

    const open = BY_KEY[status].group === "진행중";
    const dwell = open ? (asOf - since) / DAY : null;
    const sla = BY_KEY[status].sla;
    const done = open || status === "확인필요" ? null : since;

    // 심사시간: 스캔 → 심사의견 / 서류확인시간: 심사의견 → 종결 (진행중이면 기준시각까지)
    const { scan = null, opinion = null, distAt = null, distEndAt = null } = ms.get(m.증권번호) ?? {};
    const review = scan == null ? null : ((opinion ?? asOf) - scan) / DAY;
    const docCheck = opinion == null ? null : ((done ?? asOf) - opinion) / DAY;
    const dLeft = DEADLINE_DAYS - (asOf - applied) / DAY;

    return {
      id: m.증권번호, date: m.청약일자, applied, branch: m.지점, channel: m.채널, product: m.상품, premium: Number(m.월보험료),
      status, since, uw, dwell, done,
      ...(status === "청약완료"
        ? (() => { const b = bizDaysElapsed(m.청약일자, new Date(asOf + 9 * 3600e3).toISOString().slice(0, 10));
            return { late: b >= SCAN_LIMIT_DAYS, near: b === SCAN_LIMIT_DAYS - 1 }; })()
        : { late: open && dwell > sla, near: open && dwell > sla * 0.7 && dwell <= sla }),
      reviewDays: distAt != null && distEndAt != null ? (distEndAt - distAt) / DAY : null,
      issueTime: status === "성립" && scan != null ? (since - scan) / DAY : null,
      leadTime: done == null ? null : (done - applied) / DAY,
      review, reviewDone: opinion != null, docCheck, docDone: opinion != null && done != null,
      dLeft: open ? dLeft : null, overdue: open && dLeft < 0, dueSoon: open && dLeft >= 0 && dLeft <= NEAR_DEADLINE,
    };
  });
}

// 기준시각 = 가장 최근의 한국시간 새벽 06:00 (06시 전에 열면 전날 06:00)
const latestCutoff = () => {
  const kst = new Date(Date.now() + 9 * 3600e3 - 6 * 3600e3);
  return `${kst.toISOString().slice(0, 10)} 06:00`;
};
const DATA = window.UW_DATA;
DATA.asOf = latestCutoff();
const AS_OF = toTime(DATA.asOf);
const CASES = mergeSources(DATA.tables, AS_OF);
const BIZ_DAYS = [...new Set(CASES.map((c) => c.date))].sort();

// ── 2. 필터 ───────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const F = { from: $("f-from"), to: $("f-to"), channel: $("f-channel"), branch: $("f-branch"), product: $("f-product"), status: $("f-status") };

function fillSelect(el, values, allLabel = "전체") {
  el.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option>${v}</option>`).join("");
}
const uniq = (key) => [...new Set(CASES.map((c) => c[key]))].sort((a, b) => a.localeCompare(b, "ko"));
fillSelect(F.channel, CHANNELS);
fillSelect(F.branch, uniq("branch"));
// 상품 목록은 고른 채널의 상품만 (채널마다 상품 3개). 채널이 전체면 모든 상품
function refreshProducts() {
  const keep = F.product.value;
  const list = [...new Set(CASES.filter((c) => !F.channel.value || c.channel === F.channel.value).map((c) => c.product))].sort((a, b) => a.localeCompare(b, "ko"));
  fillSelect(F.product, list);
  F.product.value = list.includes(keep) ? keep : ""; // 다른 채널 상품이 골라져 있었으면 전체로
}
refreshProducts();
fillSelect(F.status, STATUSES.map((s) => s.key));
F.from.min = F.to.min = BIZ_DAYS[0];
F.from.max = F.to.max = BIZ_DAYS.at(-1);

// 화면에 적용된 조회 조건. 필터를 바꿔도 '조회'를 눌러야 반영됩니다
let Q = {};
const readForm = () => Object.fromEntries(Object.entries(F).map(([k, el]) => [k, el.value]));
function markPending() {
  const pending = Object.entries(readForm()).some(([k, v]) => v !== Q[k]);
  $("search").classList.toggle("pending", pending);
  $("pending-note").hidden = !pending;
}
function search() {
  Q = readForm();
  page = 0;
  render();
  markPending();
}

function setRange(n) {
  F.from.value = n ? BIZ_DAYS[Math.max(0, BIZ_DAYS.length - n)] : BIZ_DAYS[0];
  F.to.value = BIZ_DAYS.at(-1);
  document.querySelectorAll("#presets .chip").forEach((b) => b.classList.toggle("on", Number(b.dataset.days) === n));
}

// 심사상태 필터는 상세 목록에만 적용합니다 (다른 화면은 전체 단계 분포를 봐야 하므로)
function baseFiltered() {
  const { from, to, channel, branch, product } = Q;
  return CASES.filter((c) =>
    (!from || c.date >= from) && (!to || c.date <= to) &&
    (!channel || c.channel === channel) && (!branch || c.branch === branch) && (!product || c.product === product));
}
const withStatus = (rows) => (Q.status ? rows.filter((c) => c.status === Q.status) : rows);

// ── 3. 화면 그리기 ────────────────────────────────────────────────
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
function renderKpis(rows) {
  const open = rows.filter((c) => BY_KEY[c.status].group === "진행중" && c.status !== "청약완료"); // 스캔 전(청약완료)은 진행중에서 제외
  const ok = rows.filter((c) => c.status === "성립");
  const back = rows.filter((c) => c.status === "반송");
  const waitingScan = rows.filter((c) => c.status === "청약완료");
  const scanLate = waitingScan.filter((c) => c.late);
  const due = rows.filter((c) => BY_KEY[c.status].group === "진행중" && (c.dueSoon || c.overdue));
  const avgLead = avg(ok.map((c) => c.leadTime));
  const revDays = rows.map((c) => c.reviewDays).filter((v) => v != null);
  const issue = rows.map((c) => c.issueTime).filter((v) => v != null);
  const tile = (label, value, unit, note, cls = "") =>
    `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}<small>${unit}</small></div><div class="note">${note}</div></div>`;
  // 청약 건수 구성표: 성립 · 반송 · 진행중 · 스캔 전 · 확인필요 → 합계(청약 건수)
  const check = rows.filter((c) => c.status === "확인필요");
  const cnt = (k) => open.filter((c) => c.status === k).length;
  // 진행중 상세: 상태별 건수를 작은 목록으로
  const openDetail = `<ul class="eq-detail">${[["심사중", "g1"], ["보완중", "g2"], ["모니터링대기", "g3"], ["스캔완료", "g4"], ["성립대기", "g5"]]
    .map(([k, cls]) => `<li><span><i class="sw ${cls}"></i>${k}</span><b>${fmt(cnt(k))}</b></li>`).join("")}</ul>`;
  const cols = [
    { cls: "m-wait", label: "청약완료(스캔 전)", n: waitingScan.length, note: "" },
    { cls: "m-ok", label: "진행중", n: open.length, note: openDetail },
    { cls: "m-review", label: "성립", n: ok.length, note: `평균 ${days1(avgLead)} 소요` },
    { cls: "m-back", label: "반송", n: back.length, note: "" },
    ...(check.length ? [{ cls: "m-check", label: "확인필요", n: check.length, note: "데이터 점검" }] : []),
  ];
  $("equation")?.replaceChildren(); // 예전 구성표 자리 (지금은 대시보드 상단 "청약 건수 구성" 카드가 대신함)
  $("kpis").innerHTML = [
    tile("평균 심사기일", avg(revDays)?.toFixed(1) ?? "-", "일", `심사분배 → 심사의견 작성 · ${fmt(revDays.length)}건`),
    tile("평균 성립시간", avg(issue)?.toFixed(1) ?? "-", "일", `스캔 → 심사 → 보완 완료 → 성립 · ${fmt(issue.length)}건`),
    tile(`⚠ 청약 스캔 지연건수(${SCAN_LIMIT_DAYS}영업일 초과)`, fmt(scanLate.length), "건", `스캔 전 ${fmt(waitingScan.length)}건 중 ${pct(scanLate.length, waitingScan.length)}%`, scanLate.length ? "alert" : ""),
    tile(`⏱ 심사기일 D-${NEAR_DEADLINE} 이내`, fmt(due.length), "건", `청약일 + ${DEADLINE_DAYS}일 안에 종결 필요`, due.length ? "alert" : ""),
  ].join("");
}

// 막대 길이 = 청약 건수(전체 대비), 막대 안 = 성립 · 반송 · 심사중 · 보완중 · 그 외 진행중 비율 (전체 + 채널별)
const MIX = [
  { key: "성립", cls: "m-ok", test: (c) => c.status === "성립" },
  { key: "반송", cls: "m-back", test: (c) => c.status === "반송" },
  { key: "심사중", cls: "m-review", test: (c) => c.status === "심사중" },
  { key: "보완중", cls: "m-supp", test: (c) => c.status === "보완중" },
  { key: "그 외 진행중", cls: "m-open", test: (c) => BY_KEY[c.status].group === "진행중" && !["심사중", "보완중", "청약완료"].includes(c.status) },
  { key: "청약완료(스캔 전)", cls: "m-wait", test: (c) => c.status === "청약완료" },
  { key: "확인필요", cls: "m-check", test: (c) => c.status === "확인필요" },
];
function renderMix(rows) {
  const lines = [["전체", rows], ...CHANNELS.filter((ch) => !Q.channel || ch === Q.channel).map((ch) => [ch, rows.filter((c) => c.channel === ch)])];
  const parts = (list) => MIX.map((m) => ({ ...m, n: list.filter(m.test).length }));
  $("mix-legend").innerHTML = parts(rows).filter((m) => m.n || m.key !== "확인필요")
    .map((m) => `<span class="mix-key"><i class="sw ${m.cls}"></i>${m.key} <strong>${fmt(m.n)}</strong> <span class="muted">${pct(m.n, rows.length)}%</span></span>`).join("");
  const maxN = Math.max(1, ...lines.map(([, list]) => list.length));
  // 채널 막대는 짧아 칸 안에 숫자가 안 들어가므로, 막대 오른쪽 여백에 항목별 건수를 적음
  const side = (list) => `<span class="mix-side">${parts(list).filter((m) => m.n).map((m) =>
    `<span><i class="sw ${m.cls}"></i>${m.key} <b>${fmt(m.n)}</b></span>`).join("")}</span>`;
  $("mix").innerHTML = lines.map(([name, list], i) => {
    const scale = (list.length / maxN) * 100;
    const segs = parts(list).filter((m) => m.n).map((m) => {
      const share = (m.n / list.length) * 100;
      const onScreen = (share * scale) / 100; // 전체 막대 폭 대비 실제 차지 비율
      const label = onScreen >= 9 ? `${i ? "" : `${m.key} `}${share.toFixed(1)}%` : onScreen >= 4 ? `${share.toFixed(0)}%` : "";
      return `<span class="seg ${m.cls}" style="flex-grow:${m.n}" title="${name} · ${m.key} ${fmt(m.n)}건 (${share.toFixed(1)}%)">${label}</span>`;
    }).join("");
    return `<div class="mix-row ${i ? "" : "total"}"><span class="mix-name">${name}</span>
      <div class="mix-track"><div class="mix-bar" style="width:${scale}%" role="img" aria-label="${name} 청약 ${fmt(list.length)}건 중 ${parts(list).map((m) => `${m.key} ${fmt(m.n)}건`).join(", ")}">${segs}</div>${i ? side(list) : ""}</div>
      <span class="mix-total">${fmt(list.length)}건</span></div>`;
  }).join("");
}

function renderStages(rows) {
  const total = rows.length;
  // 막대 길이는 그룹(진행중/종결) 안에서 비교 — 종결 건이 압도적으로 많아 진행중 막대가 묻히지 않도록
  const max = {};
  for (const s of STATUSES) max[s.group] = Math.max(max[s.group] ?? 1, rows.filter((c) => c.status === s.key).length);
  const phaseAvg = (phase, field) => avg(rows.filter((c) => BY_KEY[c.status].phase === phase && c[field] != null).map((c) => c[field]));
  let html = `<thead><tr><th>상태</th><th>구간</th><th>원천 화면</th><th class="num">건수</th><th class="num">비율</th><th class="bar-cell"></th>
    <th class="num">평균 체류</th><th class="num">최장 체류</th><th class="num">허용일</th><th class="num">기준 초과</th></tr></thead><tbody>`;
  let group = "";
  for (const s of STATUSES) {
    const list = rows.filter((c) => c.status === s.key);
    if (s.key === "확인필요" && !list.length) continue;
    if (s.group !== group) {
      group = s.group;
      // 그룹 이름 | 요약 (진행중만 현재 건 평균 경과를 붙임)
      const extra = group === "진행중"
        ? `<span class="grp-sep" aria-hidden="true"></span><span class="grp-sum">현재 건 평균 경과
            <span class="grp-chip">심사 구간 <b>${days1(phaseAvg("심사", "review"))}</b></span>
            <span class="grp-chip">서류확인 구간 <b>${days1(phaseAvg("서류확인", "docCheck"))}</b></span></span>` : "";
      html += `<tr class="group ${GROUP_CLS[group]}"><td colspan="10"><div class="grp"><span class="grp-name">${group}</span>${extra}</div></td></tr>`;
    }
    const open = s.group === "진행중";
    const dw = list.map((c) => c.dwell);
    const avg = open && dw.length ? dw.reduce((a, b) => a + b, 0) / dw.length : null;
    const late = list.filter((c) => c.late).length;
    html += `<tr class="row ${GROUP_CLS[s.group]} ${Q.status === s.key ? "on" : ""}" data-status="${s.key}">
      <td><strong>${s.key}</strong></td><td>${s.phase ? `<span class="phase ${s.phase === "심사" ? "rev" : s.phase === "서류확인" ? "doc" : ""}">${s.phase}</span>` : "-"}</td><td class="src">${s.src}</td>
      <td class="num">${fmt(list.length)}</td><td class="num">${pct(list.length, total)}%</td>
      <td class="bar-cell"><div class="bar ${open ? "" : "done"}" style="width:${(list.length / (s.group === "점검" ? total : max[s.group])) * 100}%" title="${s.key} ${fmt(list.length)}건"></div></td>
      <td class="num">${open ? days1(avg) : "-"}</td><td class="num">${open && dw.length ? days1(Math.max(...dw)) : "-"}</td>
      <td class="num">${s.sla ? `${s.sla}${s.bizSla ? "영업일" : "일"}` : "-"}</td>
      <td class="num">${open ? (late ? `<span class="badge late">⚠ ${fmt(late)}</span>` : `<span class="badge ok">✓ 0</span>`) : "-"}</td></tr>`;
  }
  $("stages").innerHTML = html + "</tbody>";
  $("stages").querySelectorAll("tr.row").forEach((tr) => tr.addEventListener("click", () => {
    // 상태 행 클릭은 바로 조회 (나머지 필터는 마지막으로 조회한 조건 유지)
    F.status.value = Q.status = Q.status === tr.dataset.status ? "" : tr.dataset.status;
    page = 0;
    render();
    markPending();
  }));
}

function renderHeat(rows) {
  const channels = CHANNELS.filter((ch) => !Q.channel || ch === Q.channel);
  const counts = channels.map((ch) => PROGRESS.map((st) => rows.filter((c) => c.channel === ch && c.status === st).length));
  const max = Math.max(1, ...counts.flat());
  let html = `<thead><tr><th>채널</th>${PROGRESS.map((s) => `<th class="num">${s}</th>`).join("")}<th class="num">합계</th></tr></thead><tbody>`;
  channels.forEach((ch, i) => {
    html += `<tr><td><strong>${ch}</strong></td>` + counts[i].map((n) => {
      const step = n ? Math.min(5, 1 + Math.floor((n / max) * 5)) : 0;
      return `<td class="cell ${step >= 4 ? "dark" : ""}" style="background:var(--heat-${step})" title="${ch} · ${fmt(n)}건">${n ? fmt(n) : "·"}</td>`;
    }).join("") + `<td class="num sum">${fmt(counts[i].reduce((a, b) => a + b, 0))}</td></tr>`;
  });
  $("heat").innerHTML = html + "</tbody>";
}

// ── 차트 (Chart.js) ──
const charts = {};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function chartBase() {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css("--surface"), titleColor: css("--ink"), bodyColor: css("--ink-2"), borderColor: css("--axis"), borderWidth: 1, padding: 10 } },
    scales: {
      x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: css("--muted"), font: { size: 11 } } },
      y: { grid: { color: css("--grid") }, border: { display: false }, ticks: { color: css("--muted"), font: { size: 11 } }, beginAtZero: true },
    },
  };
}
const legend = () => ({ display: true, position: "top", align: "end", labels: { color: css("--ink-2"), boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } });
function draw(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), config);
}

// 채널별 평균 심사기일 · 서류확인기일 (해당 구간이 끝난 건만)
function renderPhaseChart(rows) {
  const channels = CHANNELS.filter((ch) => !Q.channel || ch === Q.channel);
  const of = (ch, field, doneField) => rows.filter((c) => c.channel === ch && c[doneField]);
  const series = [
    { label: "심사기일", field: "review", done: "reviewDone", color: css("--series-1") },
    { label: "서류확인기일", field: "docCheck", done: "docDone", color: css("--series-2") },
  ];
  const base = chartBase();
  base.plugins.legend = legend();
  base.interaction = { mode: "index", intersect: false };
  base.scales.y.title = { display: true, text: "평균 일수", color: css("--muted") };
  base.plugins.tooltip.callbacks = {
    label: (ctx) => {
      const s = series[ctx.datasetIndex];
      return ` ${s.label} ${ctx.raw}일 · ${fmt(of(channels[ctx.dataIndex], s.field, s.done).length)}건`;
    },
  };
  draw("c-phase", {
    type: "bar",
    data: {
      labels: channels,
      datasets: series.map((s) => ({
        label: s.label, backgroundColor: s.color, borderRadius: 4, borderSkipped: "start", barPercentage: 0.75, categoryPercentage: 0.6,
        data: channels.map((ch) => +(avg(of(ch, s.field, s.done).map((c) => c[s.field])) ?? 0).toFixed(2)),
      })),
    },
    options: base,
  });
}

// 진행중 건의 심사기일(청약일 + 30일)까지 남은 일수 분포
const DUE_BUCKETS = [
  { label: "기일 초과", test: (d) => d < 0 },
  { label: "D-0~3", test: (d) => d >= 0 && d <= 3 },
  { label: "D-4~7", test: (d) => d > 3 && d <= 7 },
  { label: "D-8~14", test: (d) => d > 7 && d <= 14 },
  { label: "D-15~21", test: (d) => d > 14 && d <= 21 },
  { label: "D-22~30", test: (d) => d > 21 },
];
function renderDueChart(rows) {
  const open = rows.filter((c) => c.dLeft != null);
  const counts = DUE_BUCKETS.map((b) => open.filter((c) => b.test(c.dLeft)).length);
  const urgent = [css("--critical"), css("--critical"), css("--warning")];
  const base = chartBase();
  base.plugins.tooltip.callbacks = { label: (ctx) => ` ${fmt(ctx.raw)}건 (진행중의 ${pct(ctx.raw, open.length)}%)` };
  draw("c-due", {
    type: "bar",
    data: {
      labels: DUE_BUCKETS.map((b) => b.label),
      datasets: [{ data: counts, backgroundColor: counts.map((_, i) => urgent[i] ?? css("--series-1")), borderRadius: 4, borderSkipped: "start", barPercentage: 0.7 }],
    },
    options: base,
  });
}

// 처리일이 주말·휴일이면 다음 영업일로 묶음
const bizBucket = (time) => {
  const d = new Date(time + 9 * 3600e3).toISOString().slice(0, 10);
  return BIZ_DAYS.find((b) => b >= d) ?? null;
};

function renderTrend(rows) {
  const days = BIZ_DAYS.filter((d) => d >= Q.from && d <= Q.to);
  const applied = Object.fromEntries(days.map((d) => [d, 0]));
  const closed = Object.fromEntries(days.map((d) => [d, 0]));
  for (const c of rows) {
    if (c.date in applied) applied[c.date]++;
    if (c.done) { const b = bizBucket(c.done); if (b in closed) closed[b]++; }
  }
  const labels = days.map((d) => d.slice(5).replace("-", "/"));
  const base = chartBase();
  base.plugins.legend = legend();
  base.interaction = { mode: "index", intersect: false };
  draw("c-daily", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "청약", data: days.map((d) => applied[d]), backgroundColor: css("--series-1"), borderRadius: 4, borderSkipped: "start", barPercentage: 0.75, categoryPercentage: 0.7 },
        { label: "종결", data: days.map((d) => closed[d]), backgroundColor: css("--series-2"), borderRadius: 4, borderSkipped: "start", barPercentage: 0.75, categoryPercentage: 0.7 },
      ],
    },
    options: base,
  });

  // 일말(그날 24시) 기준으로 청약은 됐지만 아직 종결되지 않은 건
  const backlog = days.map((d) => {
    const cut = toTime(d) + DAY;
    return rows.filter((c) => c.applied < cut && (!c.done || c.done >= cut) && cut <= AS_OF + DAY).length;
  });
  const line = chartBase();
  line.interaction = { mode: "index", intersect: false };
  line.plugins.tooltip.callbacks = { label: (ctx) => ` 진행중 ${fmt(ctx.raw)}건` };
  draw("c-backlog", {
    type: "line",
    data: { labels, datasets: [{ data: backlog, borderColor: css("--series-1"), backgroundColor: css("--series-1"), borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.25 }] },
    options: line,
  });
}

let page = 0;
const PAGE = 50;
// 상세 목록 심사자 버튼: "" = 전체, "-" = 심사자 없음
let listUw = "";
const withUw = (rows) => (!listUw ? rows : rows.filter((c) => (listUw === "-" ? !c.uw : c.uw === listUw)));
function renderUwChips(rows) {
  const base = withStatus(rows);
  // 심사자 이름순, 보완의뢰는 맨 뒤
  const names = [...new Set(base.map((c) => c.uw).filter(Boolean))].sort((a, b) => (a === SUPP_OWNER) - (b === SUPP_OWNER) || a.localeCompare(b, "ko"));
  if (listUw && listUw !== "-" && !names.includes(listUw)) listUw = "";
  const chip = (v, label, n) => `<button type="button" class="uw-chip ${listUw === v ? "on" : ""}" data-uw="${v}" aria-pressed="${listUw === v}">${label}<b>${fmt(n)}</b></button>`;
  $("uw-chips").innerHTML = `<span class="uw-label">심사자</span>` + chip("", "전체", base.length) +
    names.map((u) => chip(u, u, base.filter((c) => c.uw === u).length)).join("") +
    chip("-", "심사자 없음", base.filter((c) => !c.uw).length);
}
function sortedList(rows) {
  return withUw(withStatus(rows)).slice().sort((a, b) => (a.dLeft ?? Infinity) - (b.dLeft ?? Infinity) || (b.dwell ?? -1) - (a.dwell ?? -1) || b.applied - a.applied);
}
// 초과(단계 기준 · 심사기일) = 은은한 붉은 바탕, 임박 = 은은한 살구 바탕
const rowTone = (c) => (c.late || c.overdue ? "tone-late" : c.near || c.dueSoon ? "tone-near" : "");
function renderList(rows) {
  const list = sortedList(rows);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  page = Math.min(page, pages - 1);
  renderUwChips(rows);
  $("list-count").textContent = `${fmt(list.length)}건${Q.status ? ` · ${Q.status}` : ""}${listUw ? ` · ${listUw === "-" ? "심사자 없음" : listUw}` : ""}`;
  const slaBadge = (c) => (c.late ? `<span class="badge late">⚠ 초과</span>` : c.near ? `<span class="badge near">● 임박</span>` : BY_KEY[c.status].group === "진행중" ? `<span class="badge ok">✓ 정상</span>` : "");
  // 아직 끝나지 않은 구간은 '경과 중'으로 흐리게 표시
  const span = (v, finished) => (v == null ? "-" : finished ? days1(v) : `<span class="running" title="진행 중 (기준시각까지 경과)">${days1(v)} ↻</span>`);
  const due = (c) => (c.dLeft == null ? `<span class="muted">종결 ${days1(c.leadTime)}</span>`
    : c.overdue ? `<span class="badge late">⚠ 기일 초과</span>`
    : c.dueSoon ? `<span class="badge late">⏱ D-${Math.floor(c.dLeft)}</span>` : `<span class="badge ok">D-${Math.floor(c.dLeft)}</span>`);
  $("list").innerHTML = `<thead><tr><th>증권번호</th><th>청약일자</th><th>채널</th><th>영업채널(지점)</th><th>상품</th><th class="num">월보험료</th>
    <th>현재 상태</th><th>심사자</th><th class="num">단계 체류</th><th>단계 기준</th><th class="num">심사시간</th><th class="num">서류확인시간</th><th>심사기일</th></tr></thead><tbody>` +
    list.slice(page * PAGE, (page + 1) * PAGE).map((c) => `<tr class="${rowTone(c)}"><td>${c.id}</td><td>${c.date}</td><td>${c.channel}</td><td>${c.branch}</td><td>${c.product}</td>
      <td class="num">${fmt(c.premium)}</td><td>${c.status}</td><td>${c.uw || "-"}</td>
      <td class="num ${c.late ? "late-num" : ""}">${days1(c.dwell)}</td><td>${slaBadge(c)}</td>
      <td class="num">${span(c.review, c.reviewDone)}</td><td class="num">${span(c.docCheck, c.docDone)}</td><td>${due(c)}</td></tr>`).join("") + "</tbody>";
  $("pager").innerHTML = `<button class="btn ghost" ${page ? "" : "disabled"} data-p="-1">이전</button><span>${page + 1} / ${pages}</span><button class="btn ghost" ${page < pages - 1 ? "" : "disabled"} data-p="1">다음</button>`;
  $("pager").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { page += Number(b.dataset.p); renderList(baseFiltered()); }));
}

function renderCheck(rows) {
  const miss = rows.filter((c) => c.status === "확인필요");
  $("check").innerHTML = miss.length
    ? `<p><span class="badge late">⚠ ${miss.length}건</span> 화면 이동 중이거나 자료 추출 시점이 달라 어느 목록에도 잡히지 않은 건입니다. 다음 날 자료에서도 계속 남아 있으면 담당자 확인이 필요합니다.</p>
       <p>${miss.map((c) => `${c.id} (${c.channel} · ${c.product})`).join(" · ")}</p>`
    : `<p><span class="badge ok">✓</span> 모든 건이 한 단계에 정상적으로 매칭되었습니다.</p>`;
}

function render() {
  const rows = baseFiltered();
  renderKpis(rows);
  renderMix(rows);
  renderStages(rows);
  renderHeat(rows);
  renderPhaseChart(rows);
  // 심사기일까지 남은 일수 차트는 대시보드에서 뺌
  renderTrend(rows);
  renderList(rows);
  renderCheck(rows);
  window.renderReport?.(rows);
  window.renderBrief?.(rows);
  window.renderRules?.(rows);
  window.renderVerify?.(rows);
}

// ── 4. 엑셀 다운로드 ──────────────────────────────────────────────
// 클로드 Artifact 안에서는 페이지가 직접 파일을 내려받을 수 없어 downloads 기능으로 저장을 요청합니다
async function saveWorkbook(wb, filename, noteId = "list-note") {
  const note = $(noteId);
  const downloads = window.claude?.use ? await window.claude.use("downloads") : null;
  if (!downloads) return XLSX.writeFile(wb, filename);
  try {
    await downloads.save({ filename, data: XLSX.write(wb, { type: "array", bookType: "xlsx" }) });
    note.textContent = noteId === "download-note" ? "" : "엑셀 파일을 저장했습니다";
  } catch (e) {
    note.textContent = e?.code === "declined" ? "" : e?.code === "rate_limited" ? "저장 창이 이미 열려 있습니다" : "이 화면에서는 엑셀 저장을 쓸 수 없습니다";
  }
}

// 엑셀 내용 만들기 (다운로드와 검증 탭의 미리보기가 같이 씀)
function buildWorkbook() {
  const rows = baseFiltered();
  const detail = sortedList(rows).map((c) => ({
    증권번호: c.id, 청약일자: c.date, 채널: c.channel, "영업채널(지점)": c.branch, 상품: c.product, 월보험료: c.premium,
    현재상태: c.status, 심사자: c.uw, "단계체류(일)": c.dwell == null ? "" : +c.dwell.toFixed(1), 단계기준초과: c.late ? "Y" : "",
    "심사시간(일)": c.review == null ? "" : +c.review.toFixed(1), 심사구간: c.review == null ? "" : c.reviewDone ? "완료" : "진행중",
    "서류확인시간(일)": c.docCheck == null ? "" : +c.docCheck.toFixed(1), 서류확인구간: c.docCheck == null ? "" : c.docDone ? "완료" : "진행중",
    심사기일: new Date(c.applied + DEADLINE_DAYS * DAY + 9 * 3600e3).toISOString().slice(0, 10),
    "남은기일(일)": c.dLeft == null ? "" : Math.floor(c.dLeft), 처리일시: c.done ? new Date(c.done + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "",
  }));
  const summary = STATUSES.map((s) => {
    const list = rows.filter((c) => c.status === s.key);
    return { 구분: s.group, 상태: s.key, 건수: list.length, "비율(%)": +pct(list.length, rows.length), "기준초과": list.filter((c) => c.late).length };
  });
  const cond = [
    { 항목: "기준시각", 값: DATA.asOf }, { 항목: "청약일", 값: `${Q.from} ~ ${Q.to}` },
    { 항목: "채널", 값: Q.channel || "전체" }, { 항목: "영업채널(지점)", 값: Q.branch || "전체" },
    { 항목: "상품", 값: Q.product || "전체" }, { 항목: "심사상태", 값: Q.status || "전체" },
    { 항목: "심사자", 값: listUw === "-" ? "심사자 없음" : listUw || "전체" },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "단계별요약");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "상세목록");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cond), "검색조건");
  return { wb, rows, summary, detail, cond };
}
const excelName = () => `청약심사현황_${DATA.asOf.slice(0, 10).replaceAll("-", "")}.xlsx`;
function downloadExcel(noteId) {
  saveWorkbook(buildWorkbook().wb, excelName(), noteId);
}
$("download")?.addEventListener("click", () => downloadExcel()); // 상단 엑셀 버튼은 없앰 (상세 목록 버튼 · 우클릭으로 받음)
$("list-excel").addEventListener("click", () => downloadExcel("list-note"));

// 상세 목록 우클릭 메뉴: 엑셀 다운로드
const ctx = $("list-menu");
function closeMenu() { ctx.hidden = true; }
$("list-body").addEventListener("contextmenu", (e) => {
  if (!e.target.closest("#list")) return;
  e.preventDefault();
  ctx.hidden = false;
  const { innerWidth: W, innerHeight: H } = window, r = ctx.getBoundingClientRect();
  ctx.style.left = `${Math.min(e.clientX, W - r.width - 8)}px`;
  ctx.style.top = `${Math.min(e.clientY, H - r.height - 8)}px`;
  ctx.querySelector("button").focus();
});
ctx.addEventListener("click", (e) => {
  const b = e.target.closest("[data-menu]");
  if (!b) return;
  closeMenu();
  downloadExcel("list-note");
});
document.addEventListener("click", (e) => { if (!ctx.hidden && !ctx.contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("scroll", closeMenu, { passive: true });

// ── 5. 이벤트 연결 ────────────────────────────────────────────────
$("asof").textContent = `전일 마감 기준 · ${DATA.asOf}`;
// 필터 · 기간 버튼은 바꾸는 즉시 조회해서 대시보드 · 브리핑 · 보고서에 바로 반영
Object.values(F).forEach((el) => el.addEventListener("change", () => {
  if (el === F.from || el === F.to) document.querySelectorAll("#presets .chip").forEach((b) => b.classList.remove("on"));
  if (el === F.channel) refreshProducts();
  search();
}));
document.querySelectorAll("#presets .chip").forEach((b) => b.addEventListener("click", () => { setRange(Number(b.dataset.days)); search(); }));
$("search").addEventListener("click", search);
$("uw-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-uw]");
  if (!b) return;
  listUw = b.dataset.uw;
  page = 0;
  renderList(baseFiltered());
  $("uw-chips").querySelector(`[data-uw="${listUw}"]`)?.focus();
});
// 상세 목록은 기본으로 접어 두고, 펼친 상태는 이 브라우저에만 기억
function setListOpen(open) {
  $("list-body").hidden = !open;
  $("list-toggle").setAttribute("aria-expanded", open);
  $("list-toggle").innerHTML = open ? '접기 <span aria-hidden="true">▴</span>' : '펼치기 <span aria-hidden="true">▾</span>';
}
$("list-toggle").addEventListener("click", () => {
  const open = $("list-body").hidden;
  setListOpen(open);
  try { localStorage.setItem("uw-list-open", open ? "1" : "0"); } catch {}
});
try { setListOpen(localStorage.getItem("uw-list-open") === "1"); } catch { setListOpen(false); }
// 상태 분류 규칙도 기본으로 접어 둠
$("rules-toggle").addEventListener("click", () => {
  const open = $("rules-dash").hidden;
  $("rules-dash").hidden = !open;
  $("rules-toggle").setAttribute("aria-expanded", open);
  $("rules-toggle").innerHTML = open ? '접기 <span aria-hidden="true">▴</span>' : '펼치기 <span aria-hidden="true">▾</span>';
});
$("reset").addEventListener("click", () => {
  [F.channel, F.branch, F.product, F.status].forEach((el) => (el.value = ""));
  refreshProducts();
  setRange(0);
  search();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

setRange(0);
search();

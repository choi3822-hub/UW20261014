// 한 장짜리 보고서: 현재 조회 조건(Q)으로 A4 한 장을 만들고, 미리보기 탭에서 확인 후 PDF · Word로 저장합니다.
// dashboard.js의 CASES · Q · baseFiltered 등을 그대로 씁니다.

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const one = (v) => (v == null ? "-" : v.toFixed(1));

function reportStats(rows) {
  const by = (k) => rows.filter((c) => c.status === k).length;
  const open = rows.filter((c) => BY_KEY[c.status].group === "진행중" && c.status !== "청약완료");
  const waiting = rows.filter((c) => c.status === "청약완료");
  const revDays = rows.map((c) => c.reviewDays).filter((v) => v != null);
  const issue = rows.map((c) => c.issueTime).filter((v) => v != null);
  return {
    total: rows.length, waiting: waiting.length, open: open.length, ok: by("성립"), back: by("반송"), check: by("확인필요"),
    detail: ["심사중", "보완중", "모니터링대기", "스캔완료", "성립대기"].map((k) => [k, by(k)]),
    revDays: avg(revDays), revN: revDays.length, issue: avg(issue), issueN: issue.length,
    scanLate: waiting.filter((c) => c.late).length,
    due: rows.filter((c) => BY_KEY[c.status].group === "진행중" && (c.dueSoon || c.overdue)).length,
  };
}

function reportHtml(rows) {
  const s = reportStats(rows);
  const cond = [
    `청약일 ${Q.from} ~ ${Q.to}`,
    `채널 ${Q.channel || "전체"}`, `지점 ${Q.branch || "전체"}`, `상품 ${Q.product || "전체"}`,
  ].join(" · ");
  const share = (n) => `${pct(n, s.total)}%`;

  // 1. 청약 건수 구성
  const mix = [["청약완료(스캔 전)", s.waiting], ["진행중", s.open], ["성립", s.ok], ["반송", s.back], ...(s.check ? [["확인필요", s.check]] : [])];
  const mixTable = `<table class="r-mix"><thead><tr>${mix.map(([k]) => `<th>${k}</th>`).join("")}<th class="r-total">청약 건수</th></tr></thead>
    <tbody><tr class="r-big">${mix.map(([, n]) => `<td>${fmt(n)}</td>`).join("")}<td class="r-total">${fmt(s.total)}</td></tr>
    <tr class="r-sub">${mix.map(([, n]) => `<td>${share(n)}</td>`).join("")}<td class="r-total">100%</td></tr></tbody></table>
    <p class="r-note">진행중 ${fmt(s.open)}건 = ${s.detail.map(([k, n]) => `${k} ${fmt(n)}`).join(" · ")}</p>`;

  // 2. 주요 지표
  const kpi = (label, value, unit, note, alert) =>
    `<div class="r-kpi${alert ? " alert" : ""}"><span>${label}</span><strong>${value}<small>${unit}</small></strong><em>${note}</em></div>`;
  const kpis = `<div class="r-kpis">
    ${kpi("평균 심사기일", one(s.revDays), "일", `심사분배 → 심사의견 · ${fmt(s.revN)}건`)}
    ${kpi("평균 성립시간", one(s.issue), "일", `스캔 → 성립 · ${fmt(s.issueN)}건`)}
    ${kpi(`스캔 지연(${SCAN_LIMIT_DAYS}영업일 초과)`, fmt(s.scanLate), "건", `스캔 전 ${fmt(s.waiting)}건 중 ${pct(s.scanLate, s.waiting)}%`, s.scanLate)}
    ${kpi(`심사기일 D-${NEAR_DEADLINE} 이내`, fmt(s.due), "건", `청약일 + ${DEADLINE_DAYS}일 안에 종결`, s.due)}
  </div>`;

  // 3. 채널별 현황
  const chRows = CHANNELS.filter((ch) => !Q.channel || ch === Q.channel).map((ch) => {
    const l = rows.filter((c) => c.channel === ch), t = reportStats(l);
    return `<tr><th>${ch}</th><td>${fmt(t.total)}</td><td>${fmt(t.waiting)}</td><td>${fmt(t.open)}</td><td>${fmt(t.ok)}</td><td>${fmt(t.back)}</td><td>${pct(t.ok, t.total)}%</td></tr>`;
  }).join("");
  const channelTable = `<table class="r-grid"><thead><tr><th>채널</th><th>청약</th><th>스캔 전</th><th>진행중</th><th>성립</th><th>반송</th><th>성립률</th></tr></thead>
    <tbody>${chRows}<tr class="r-sum"><th>합계</th><td>${fmt(s.total)}</td><td>${fmt(s.waiting)}</td><td>${fmt(s.open)}</td><td>${fmt(s.ok)}</td><td>${fmt(s.back)}</td><td>${pct(s.ok, s.total)}%</td></tr></tbody></table>`;

  // 4. 심사자별 진행 건
  const uwKeys = ["심사중", "성립대기"];
  const uws = [...new Set(rows.map((c) => c.uw).filter((u) => u && u !== SUPP_OWNER))].sort((a, b) => a.localeCompare(b, "ko"));
  const uwTable = `<table class="r-grid"><thead><tr><th>심사자</th>${uwKeys.map((k) => `<th>${k}</th>`).join("")}<th>계</th></tr></thead><tbody>${
    uws.length ? uws.map((u) => {
      const ns = uwKeys.map((k) => rows.filter((c) => c.uw === u && c.status === k).length);
      return `<tr><th>${esc(u)}</th>${ns.map((n) => `<td>${fmt(n)}</td>`).join("")}<td>${fmt(ns.reduce((a, b) => a + b, 0))}</td></tr>`;
    }).join("") : `<tr><td colspan="${uwKeys.length + 2}" class="r-empty">배정된 건이 없습니다</td></tr>`}
    <tr class="r-sum"><th>${SUPP_OWNER}</th><td colspan="${uwKeys.length}">보완중 (보완 담당으로 분배)</td><td>${fmt(rows.filter((c) => c.uw === SUPP_OWNER && c.status === "보완중").length)}</td></tr>
    <tr class="r-sum"><th>미배정</th><td colspan="${uwKeys.length}">스캔완료(심사자 배정 전)</td><td>${fmt(rows.filter((c) => c.status === "스캔완료").length)}</td></tr></tbody></table>`;

  // 5. 조치 필요 건: 채널별 · 사유별 건수만 (한 건이 여러 사유에 해당해도 합계는 한 번만 셈)
  const isOpenC = (c) => BY_KEY[c.status].group === "진행중";
  const REASONS = [
    ["스캔 지연", (c) => c.status === "청약완료" && c.late],
    ["단계 기준초과", (c) => isOpenC(c) && c.status !== "청약완료" && c.late],
    [`심사기일 D-${NEAR_DEADLINE}·초과`, (c) => isOpenC(c) && (c.dueSoon || c.overdue)],
  ];
  const urgent = rows.filter((c) => REASONS.some(([, f]) => f(c)));
  const actChans = CHANNELS.filter((ch) => !Q.channel || ch === Q.channel);
  const cell = (l, f) => { const v = l.filter(f).length; return `<td class="${v ? "r-flag" : ""}">${fmt(v)}</td>`; };
  const urgentTable = `<table class="r-grid"><thead><tr><th>채널</th>${REASONS.map(([k]) => `<th>${k}</th>`).join("")}<th>합계</th></tr></thead><tbody>${
      actChans.map((ch) => { const l = urgent.filter((c) => c.channel === ch);
        return `<tr><th>${ch}</th>${REASONS.map(([, f]) => cell(l, f)).join("")}<td><b>${fmt(l.length)}</b></td></tr>`; }).join("")
    }<tr class="r-sum"><th>합계</th>${REASONS.map(([, f]) => `<td>${fmt(urgent.filter(f).length)}</td>`).join("")}<td>${fmt(urgent.length)}</td></tr></tbody></table>
    <p class="r-note">건별 목록은 대시보드 상세 목록 · 엑셀 다운에서 확인</p>`;

  return `<header class="r-head">
      <div><p class="r-kicker">청약·심사 진행현황</p><h1>대시보드 보고서</h1></div>
      <dl><div><dt>기준시각</dt><dd>${DATA.asOf}</dd></div><div><dt>조회 조건</dt><dd>${esc(cond)}</dd></div></dl>
    </header>
    <section><h2>1. 청약 건수 구성</h2>${mixTable}</section>
    <section><h2>2. 주요 지표</h2>${kpis}</section>
    <div class="r-two">
      <section><h2>3. 채널별 현황</h2>${channelTable}</section>
      <section><h2>4. 심사자별 진행 건</h2>${uwTable}</section>
    </div>
    <section><h2>5. 조치 필요 건 <span>${fmt(urgent.length)}건</span></h2>${urgentTable}</section>
    <footer class="r-foot"><span>가상 데이터 · 심사상태 필터는 보고서에 적용하지 않습니다</span><span>작성 ${DATA.asOf.slice(0, 10)}</span></footer>`;
}

// ── 브리핑 보고서: 부서장 · 담당임원용 한 장 ──
function briefReportHtml(rows) {
  const b = window.briefData?.(rows);
  if (!b) return `<p class="r-note">브리핑 계산을 불러오는 중입니다</p>`;
  const { r1, exec: x } = b, dd = x.dd;
  const cond = [`청약일 ${Q.from} ~ ${Q.to}`, `채널 ${Q.channel || "전체"}`, `지점 ${Q.branch || "전체"}`, `상품 ${Q.product || "전체"}`].join(" · ");
  const kpi = (label, value, unit, note, cls = "") => `<div class="r-kpi ${cls}"><span>${label}</span><strong>${value}<small>${unit}</small></strong><em>${note}</em></div>`;
  const arrow = (n) => !n ? "전일과 같음" : `<span class="${n > 0 ? "bad" : "good"}">${n > 0 ? "▲" : "▼"} ${fmt(Math.abs(n))}</span> 전일 대비`;

  const verdict = `<div class="r-verdict ${x.signal}"><div class="r-sig"><i></i><b>${b.SIGNAL[x.signal]}</b></div>
    <div><p class="r-v-head">${x.head}</p><p class="r-v-sub">${x.sub}</p></div></div>`;
  const bigs = `<div class="r-kpis">
    ${kpi("처리 중인 계약", fmt(dd ? dd.eod : x.openN), "건", dd ? arrow(dd.eod - dd.eodPrev) : "지금 진행 중")}
    ${kpi("처리 지연", fmt(x.late), "건", `진행 중의 ${pct(x.late, x.openN)}%`, x.late ? "alert" : "")}
    ${kpi("청약 → 성립 기간", x.lead ? r1(x.lead.p50) : "-", "일", x.lead ? `중앙값 · 늦은 10% ${r1(x.lead.p90)}일↑` : "성립 건 없음")}
    ${kpi("성립 대기 보험료", r1(x.prem.sum / 1e8), "억원/월", `고액 ${fmt(x.prem.hiN)}건 · ${pct(x.prem.hiSum, x.prem.sum)}%`)}
  </div>`;
  const risks = x.risks.length
    ? `<ol class="r-risks">${x.risks.map((r) => `<li class="${r.tone}"><b>${r.title}</b><span><em>영향</em>${r.impact}</span><span><em>조치</em>${r.action}</span></li>`).join("")}</ol>`
    : `<p class="r-note">오늘 따로 챙길 일이 없습니다</p>`;
  const trend = x.trend.length >= 2
    ? `${b.sparkSvg(x.trend, "r-spark", 96)}<p class="r-note">${b.trendNote(x.trend)}</p>
       <table class="r-grid r-trend-table"><thead><tr>${x.trend.map((t) => `<th>${t.d.slice(5).replace("-", "/")}</th>`).join("")}</tr></thead>
       <tbody><tr>${x.trend.map((t) => `<td>${fmt(t.n)}</td>`).join("")}</tr></tbody></table>`
    : `<p class="r-note">추세는 조회 기간이 2영업일 이상일 때 보입니다</p>`;
  const sp = x.stp.ok ? (100 * x.stp.auto) / x.stp.ok : null;
  const stpBox = `<div class="r-stack">${kpi("자동 성립률", sp == null ? "-" : r1(sp), "%",
    `성립 ${fmt(x.stp.ok)}건 중 ${fmt(x.stp.auto)}건 · ${x.stp.ch.map(([c, v]) => `${c} ${r1(v)}%`).join(" · ")}`)}</div>`;
  const good = `<p class="r-good"><b>잘 되고 있는 것</b>${x.good.map((g) => `<span>${g}</span>`).join("<span>·</span>")}</p>`;

  const sla = b.sla.length ? `<div class="r-bars">${b.sla.map((y) => `<div class="r-bar-row"><span>${y.k}</span>
      <div class="r-track"><div class="r-fill ${y.rate < b.SLA_TARGET ? "warn" : ""}" style="width:${y.rate}%"></div><i style="left:${b.SLA_TARGET}%"></i></div>
      <b class="${y.rate < b.SLA_TARGET ? "r-flag" : ""}">${r1(y.rate)}%</b></div>`).join("")}</div>` : `<p class="r-note">끝난 구간이 없습니다</p>`;
  const uw = b.uw.length ? `<table class="r-grid"><thead><tr><th>심사자</th><th>보유</th><th>심사중</th><th>성립대기</th><th>기준초과</th></tr></thead><tbody>${
    b.uw.map(([k, u]) => `<tr><th>${esc(k)}</th><td><b>${fmt(u.n)}</b></td><td>${fmt(u.심사중)}</td><td>${fmt(u.성립대기)}</td><td class="${u.late ? "r-flag" : ""}">${fmt(u.late)}</td></tr>`).join("")
  }</tbody></table>` : `<p class="r-note">배정된 진행중 건이 없습니다</p>`;
  const acts = b.actions.filter((a) => a.list.length);
  const pick = acts.flatMap((a) => a.list.slice(0, 1).map((c) => [a, c])).slice(0, 4);
  const actions = pick.length ? `<table class="r-grid r-left"><thead><tr><th>사유</th><th>증권번호</th><th>청약일</th><th>채널</th><th>현재 상태</th><th>경과</th><th>담당</th></tr></thead><tbody>${
      pick.map(([a, c]) => `<tr><td class="r-flag">${a.label}</td><td>${c.id}</td><td>${c.date.slice(5)}</td><td>${c.channel}</td><td>${c.status}</td><td>${b.elapsed(c, a.key)}</td><td>${esc(b.owner(c))}</td></tr>`).join("")
    }</tbody></table>` : `<p class="r-note">조치가 필요한 건이 없습니다.</p>`;

  return `<header class="r-head">
      <div><p class="r-kicker">청약·심사 진행현황</p><h1>브리핑 보고서</h1></div>
      <dl><div><dt>기준시각</dt><dd>${DATA.asOf}</dd></div><div><dt>조회 조건</dt><dd>${esc(cond)}</dd></div></dl>
    </header>
    ${verdict}
    <section><h2>핵심 숫자</h2>${bigs}</section>
    <div class="r-two r-two-q2">
      <section><h2>주의할 것</h2>${risks}</section>
      <section><h2>자동 성립률 <span>심사자 없이 성립</span></h2>${stpBox}<h2 class="r-h2-gap">업무 잔량 추세 <span>영업일 마감 기준</span></h2>${trend}</section>
    </div>
    ${good}
    <div class="r-two r-two-even">
      <section><h2>참고 · 단계별 기준 내 처리율 <span>목표 ${b.SLA_TARGET}%(예시)</span></h2>${sla}</section>
      <section><h2>참고 · 심사자별 업무량</h2>${uw}</section>
    </div>
    <section><h2>참고 · 조치 대상 <span>사유별로 가장 오래된 1건 · 전체 목록은 대시보드</span></h2>${actions}</section>
    <footer class="r-foot"><span>가상 데이터 · 신호등: 심사 ${3}일 초과 건이 10%를 넘으면 주의</span><span>작성 ${DATA.asOf.slice(0, 10)}</span></footer>`;
}

let reportKind = "dash"; // dash = 대시보드 보고서, brief = 브리핑 보고서
const REPORT_TITLE = { dash: "대시보드 보고서", brief: "브리핑 보고서" };
function setReportKind(kind) {
  reportKind = kind;
  document.querySelectorAll("[data-kind]").forEach((b) => {
    b.classList.toggle("on", b.dataset.kind === kind);
    b.setAttribute("aria-pressed", b.dataset.kind === kind);
  });
  setNote("");
  renderReport(baseFiltered());
}
window.renderReport = (rows) => {
  $("report-sheet").dataset.kind = reportKind;
  $("report-sheet").innerHTML = reportKind === "brief" ? briefReportHtml(rows) : reportHtml(rows);
};
document.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => setReportKind(b.dataset.kind)));

// ── 탭 전환 ──
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("on", on);
    t.setAttribute("aria-selected", on);
  });
  document.querySelectorAll('[role="tabpanel"]').forEach((p) => (p.hidden = p.id !== `panel-${name}`));
  if (name === "dash") window.dispatchEvent(new Event("resize")); // 숨겨져 있던 차트 크기 맞춤
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
$("report-open").addEventListener("click", () => {
  if (!$("pending-note").hidden) search(); // 바뀐 조건이 있으면 먼저 조회
  // 브리핑 탭에서 누르면 브리핑 보고서, 그 외에는 대시보드 보고서
  if (!$("panel-brief").hidden) reportKind = "brief";
  else if (!$("panel-dash").hidden) reportKind = "dash";
  setReportKind(reportKind);
  showTab("report");
  $("panel-report").scrollIntoView({ block: "start", behavior: "smooth" });
});

// ── 저장 ──
const reportName = (ext) => `청약심사_${REPORT_TITLE[reportKind].replace(" ", "")}_${DATA.asOf.slice(0, 10).replaceAll("-", "")}.${ext}`;
function setNote(text) { $("report-note").textContent = text; }

async function offer(filename, data) {
  const downloads = window.claude?.use ? await window.claude.use("downloads") : null;
  if (!downloads) { // 아티팩트 밖에서 열었을 때
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(data), download: filename });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return setNote(`${filename} 저장을 시작했습니다`);
  }
  try {
    await downloads.save({ filename, data });
    setNote(`${filename} 저장했습니다. 받은 파일을 열어 인쇄할 수 있습니다`);
  } catch (e) {
    setNote(e?.code === "declined" ? "" : e?.code === "rate_limited" ? "저장 창이 이미 열려 있습니다" : "이 화면에서는 파일을 저장할 수 없습니다");
  }
}

$("report-pdf").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  if (!window.html2canvas || !window.jspdf) return setNote("PDF 도구를 불러오지 못했습니다. Word로 저장해 주세요");
  btn.disabled = true; setNote("PDF를 만드는 중입니다…");
  try {
    const sheet = $("report-sheet");
    const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const pdf = new jspdf.jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    let w = 210, h = (canvas.height / canvas.width) * 210;
    if (h > 297) { w = (297 / h) * 210; h = 297; } // 한 장에 맞춤
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (210 - w) / 2, 0, w, h);
    await offer(reportName("pdf"), pdf.output("blob"));
  } catch {
    setNote("PDF를 만들지 못했습니다. Word로 저장해 주세요");
  } finally {
    btn.disabled = false;
  }
});

// ── Word(.docx) 저장: 미리보기 화면의 내용을 표 · 문단으로 옮겨 편집 가능한 문서로 만듭니다 ──
const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js";
let docxLoading = null;
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  return (docxLoading ??= new Promise((ok, fail) => {
    const sc = Object.assign(document.createElement("script"), { src: DOCX_URL, onload: () => ok(window.docx), onerror: () => { docxLoading = null; fail(); } });
    document.head.appendChild(sc);
  }));
}

function sheetToDocx(D, sheet) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, ShadingType, BorderStyle, TableLayoutType } = D;
  const PAGE_W = 11906, MARGIN = 700, CONTENT = PAGE_W - MARGIN * 2; // A4 폭(twip)과 본문 폭
  const INK = "10241F", MUTED = "82958F", ACCENT = "00806B", ALERT = "B42323", ORANGE = "E07A3F", HEAD = "EEF6F3", LINE = "D9E5E1";
  const txt = (el) => el.textContent.replace(/\s+/g, " ").trim();
  // 글자 단위: <b>는 굵게, 빨강/초록 표시 클래스는 색을 유지
  function runs(node, base = {}) {
    const out = [];
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g, " "); if (t.trim() || t === " ") out.push(new TextRun({ text: t, ...base })); return; }
      if (n.nodeType !== 1 || n.matches("i.r-dot, br")) return;
      const st = { ...base };
      if (n.matches("b, strong")) st.bold = true;
      if (n.matches(".r-flag, .bad")) st.color = ALERT;
      if (n.matches(".good")) st.color = ACCENT;
      if (n.matches(".r-small")) st.color = MUTED;
      out.push(...runs(n, st));
    });
    return out;
  }
  const para = (children, opt = {}) => new Paragraph({ children, spacing: { after: 60 }, ...opt });
  const small = (text, color = MUTED) => para([new TextRun({ text, size: 16, color })]);
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (children, w, opt = {}) => new TableCell({ children, borders, width: { size: w, type: WidthType.DXA }, margins: { top: 30, bottom: 30, left: 80, right: 80 }, ...opt });
  const fixed = (w, cols) => ({ width: { size: w, type: WidthType.DXA }, columnWidths: cols, layout: TableLayoutType.FIXED });
  const split = (w, n, ratios) => { const r = ratios ?? Array(n).fill(1), sum = r.reduce((a, b) => a + b, 0); return r.map((x) => Math.floor((w * x) / sum)); };

  function htmlTable(t, W) {
    const trs = [...t.querySelectorAll("tr")];
    const n = Math.max(...trs.map((tr) => [...tr.children].reduce((a, c) => a + (c.colSpan || 1), 0)));
    const cols = split(W, n);
    const rows = trs.map((tr) => { let ci = 0; return new TableRow({
      tableHeader: !!tr.closest("thead"),
      children: [...tr.children].map((c) => {
        const head = c.tagName === "TH" && !!c.closest("thead");
        const big = !!c.closest(".r-big");
        const base = { size: big ? 28 : 16, bold: c.tagName === "TH" || c.classList.contains("r-total") };
        const span = c.colSpan || 1, w = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0); ci += span;
        return cell([para(runs(c, base), { alignment: c.closest(".r-left") && !c.classList.contains("r-num") ? AlignmentType.LEFT : head || c.closest(".r-mix") ? AlignmentType.CENTER : c.tagName === "TH" ? AlignmentType.LEFT : AlignmentType.RIGHT, spacing: { after: 0 } })], w,
          { columnSpan: c.colSpan > 1 ? c.colSpan : undefined, shading: head || tr.classList.contains("r-sum") ? { type: ShadingType.CLEAR, fill: HEAD, color: "auto" } : undefined });
      }),
    }); });
    return new Table({ rows, ...fixed(W, cols) });
  }
  function kpiTable(box, W) {
    const kpis = [...box.querySelectorAll(".r-kpi")];
    const vertical = box.classList.contains("r-stack");
    const cols = vertical ? [W] : split(W, kpis.length);
    const one = (k, i) => cell([
      para([new TextRun({ text: txt(k.querySelector("span")), size: 16, color: MUTED })], { spacing: { after: 20 } }),
      para(runs(k.querySelector("strong"), { size: 28, bold: true, color: k.classList.contains("alert") ? ALERT : INK }), { spacing: { after: 20 } }),
      para(runs(k.querySelector("em"), { size: 15, color: MUTED }), { spacing: { after: 0 } }),
    ], vertical ? W : cols[i]);
    return new Table({ ...fixed(W, cols), rows: vertical ? kpis.map((k) => new TableRow({ children: [one(k, 0)] })) : [new TableRow({ children: kpis.map(one) })] });
  }
  function barTable(box, W) {
    const cols = split(W, 3, [3, 5, 2]);
    return new Table({ ...fixed(W, cols), rows: [...box.querySelectorAll(".r-bar-row")].map((r) => {
      const name = txt(r.querySelector("span")), rate = r.querySelector("b"), w = parseFloat(r.querySelector(".r-fill").style.width) || 0;
      const warn = rate.classList.contains("r-flag");
      return new TableRow({ children: [
        cell([para([new TextRun({ text: name, size: 16 })], { spacing: { after: 0 } })], cols[0]),
        cell([para([new TextRun({ text: "█".repeat(Math.round(w / 5)), color: warn ? ORANGE : ACCENT, size: 12 })], { spacing: { after: 0 } })], cols[1]),
        cell([para([new TextRun({ text: txt(rate), bold: true, size: 16, color: warn ? ALERT : INK })], { alignment: AlignmentType.RIGHT, spacing: { after: 0 } })], cols[2]),
      ] });
    }) });
  }
  // 화면에서 나란히 놓인 두 구역은 Word에서도 테두리 없는 2칸 표로 나란히 배치
  function twoCol(el, W) {
    const gap = 240, kids = [...el.children], cols = split(W - gap, 2, el.classList.contains("r-two-q") ? [2, 3] : el.classList.contains("r-two-q2") ? [3, 2] : el.classList.contains("r-two-even") ? [1, 1] : [5, 4]);
    const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const nb = { top: none, bottom: none, left: none, right: none };
    return [new Table({ ...fixed(W, [cols[0], gap, cols[1]]), borders: { ...nb, insideHorizontal: none, insideVertical: none }, rows: [new TableRow({ children: [
      new TableCell({ width: { size: cols[0], type: WidthType.DXA }, borders: nb, margins: { left: 0, right: 0 }, children: block(kids[0], cols[0] - 120) }),
      new TableCell({ width: { size: gap, type: WidthType.DXA }, borders: nb, children: [para([])] }),
      new TableCell({ width: { size: cols[1], type: WidthType.DXA }, borders: nb, margins: { left: 0, right: 0 }, children: kids[1] ? block(kids[1], cols[1] - 120) : [para([])] }),
    ] })] })];
  }
  function block(el, W = CONTENT) {
    if (el.matches("header.r-head")) return [
      para([new TextRun({ text: txt(el.querySelector(".r-kicker")), bold: true, color: ACCENT, size: 18 })], { spacing: { after: 20 } }),
      para([new TextRun({ text: txt(el.querySelector("h1")), bold: true, size: 36 })], { spacing: { after: 40 } }),
      ...[...el.querySelectorAll("dl > div")].map((d) => para([new TextRun({ text: `${txt(d.querySelector("dt"))}  `, color: MUTED, size: 17 }), new TextRun({ text: txt(d.querySelector("dd")), size: 17 })], { spacing: { after: 20 } })),
      para([], { border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT } }, spacing: { after: 80 } }),
    ];
    if (el.matches(".r-two")) return twoCol(el, W);
    if (el.tagName.toLowerCase() === "svg") return [];
    if (el.matches(".r-verdict")) {
      const warn = el.classList.contains("warn");
      return [new Table({ ...fixed(W, [W]), rows: [new TableRow({ children: [new TableCell({ width: { size: W, type: WidthType.DXA }, borders,
        shading: { type: ShadingType.CLEAR, fill: warn ? "FFF1E0" : "E3F5EE", color: "auto" }, margins: { top: 100, bottom: 100, left: 160, right: 160 },
        children: [
          para([new TextRun({ text: `● ${txt(el.querySelector(".r-sig b"))}   `, bold: true, size: 24, color: warn ? "C2620F" : ACCENT }), new TextRun({ text: txt(el.querySelector(".r-v-head")), bold: true, size: 24 })], { spacing: { after: 40 } }),
          para([new TextRun({ text: txt(el.querySelector(".r-v-sub")), size: 17, color: "40605A" })], { spacing: { after: 0 } }),
        ] })] })] })];
    }
    if (el.matches(".r-risks")) return [...el.children].flatMap((li, i) => {
      const color = li.classList.contains("bad") ? ALERT : ORANGE, [im, ac] = li.querySelectorAll("span");
      return [
        para([new TextRun({ text: `${i + 1}  `, bold: true, color, size: 18 }), new TextRun({ text: txt(li.querySelector("b")), bold: true, size: 18 })], { spacing: { before: i ? 80 : 0, after: 10 } }),
        para([new TextRun({ text: "영향  ", color: MUTED, size: 15 }), new TextRun({ text: txt(im).replace(/^영향/, ""), size: 15 })], { spacing: { after: 0 }, indent: { left: 220 } }),
        para([new TextRun({ text: "조치  ", color: MUTED, size: 15 }), new TextRun({ text: txt(ac).replace(/^조치/, ""), size: 15 })], { spacing: { after: 0 }, indent: { left: 220 } }),
      ];
    });
    if (el.matches(".r-good")) return [para([...el.children].flatMap((n, i) => i === 0 ? [new TextRun({ text: `${txt(n)}   `, bold: true, color: ACCENT, size: 17 })] : runs(n, { size: 17 }).concat(new TextRun({ text: " ", size: 17 }))), { spacing: { before: 100, after: 40 } })];
    if (el.matches("section")) return [...el.children].flatMap((c) => {
      if (c.tagName === "H2") {
        const sub = c.querySelector("span");
        return [para([new TextRun({ text: txt(c).replace(sub ? txt(sub) : "", "").trim(), bold: true, size: 21 }), ...(sub ? [new TextRun({ text: `  ${txt(sub)}`, size: 15, color: MUTED })] : [])], { spacing: { before: 140, after: 60 } })];
      }
      return block(c, W);
    });
    if (el.tagName === "TABLE") return [htmlTable(el, W)];
    if (el.matches(".r-kpis, .r-stack")) return [kpiTable(el, W)];
    if (el.matches(".r-bars")) return [barTable(el, W)];
    if (el.matches("ul.r-brief")) return [...el.children].map((li) => {
      const k = li.querySelector(".r-dot")?.classList;
      const color = k?.contains("bad") ? ALERT : k?.contains("mid") ? ORANGE : ACCENT;
      return para([new TextRun({ text: "●  ", color, size: 17 }), ...runs(li, { size: 18 })], { spacing: { after: 40 } });
    });
    if (el.matches(".r-chips")) return [para([...el.children].flatMap((sp, i) => [...(i ? [new TextRun({ text: "   ·   ", color: MUTED, size: 16 })] : []), ...runs(sp, { size: 16 })]), { spacing: { after: 40 } })];
    if (el.matches(".r-note, p")) return [para([new TextRun({ text: txt(el), size: 15, color: MUTED })], { spacing: { before: 40, after: 20 } })];
    if (el.matches("footer.r-foot")) return [para([], { border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE } }, spacing: { before: 160, after: 20 } }), small([...el.children].map(txt).join("   ·   "))];
    return [...el.children].flatMap((c) => block(c, W));
  }

  return new Document({
    creator: "청약·심사 진행현황", title: `${REPORT_TITLE[reportKind]} ${DATA.asOf.slice(0, 10)}`,
    styles: { default: { document: { run: { font: "Malgun Gothic", size: 19, color: INK } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 640, bottom: 560, left: MARGIN, right: MARGIN } } },
      children: [...sheet.children].flatMap((c) => block(c)) }],
  });
}

$("report-docx").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true; setNote("Word 문서를 만드는 중입니다…");
  try {
    const D = await loadDocx();
    const blob = await D.Packer.toBlob(sheetToDocx(D, $("report-sheet")));
    await offer(reportName("docx"), blob);
  } catch {
    setNote("Word 문서를 만들지 못했습니다. PDF로 저장해 주세요");
  } finally {
    btn.disabled = false;
  }
});

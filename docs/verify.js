// 검증 탭: PRD 요구사항을 화면에서 직접 확인할 수 있도록 근거를 계산해 보여 줍니다.
// 기대값은 원천 자료(DATA.tables)에서 따로 계산하고, 실제값은 대시보드가 화면에 그린 결과를 읽어 비교합니다.
(() => {
  const RAW = DATA.tables["1_일일신계약현황"];
  const DIST = new Map(DATA.tables["3_심사자분배현황"].map((r) => [r.증권번호, r]));
  const MON = new Set(DATA.tables["4_모니터링방"].map((r) => r.증권번호));
  const WAIT = new Set(DATA.tables["2_장기대기현황"].map((r) => r.증권번호));
  const ok = (pass) => `<span class="vf-badge ${pass ? "pass" : "fail"}">${pass ? "✓ 일치" : "✕ 불일치"}</span>`;
  const n = (v) => `<span class="num">${fmt(v)}</span>`;

  // 원천 자료만으로 상태를 다시 판정 (대시보드 계산과 독립)
  const rawStatus = (r) => r.처리결과 ? r.처리결과
    : DIST.has(r.증권번호) ? SCREEN_TO_STATUS[DIST.get(r.증권번호).분배상태]
    : MON.has(r.증권번호) ? "모니터링대기" : WAIT.has(r.증권번호) ? "청약완료" : "확인필요";

  // ── 상태 분류 규칙 (대시보드 탭과 검증 탭에 같이 표시) ──
  const RULES = [
    { src: "일일 신계약현황", cond: "처리결과 = 성립", to: "성립", note: "종결" },
    { src: "일일 신계약현황", cond: "처리결과 = 반송", to: "반송", note: "종결" },
    { src: "심사자분배 현황판", cond: "분배상태 = 성립처리", to: "성립대기", note: "성립처리 완료 · 분배 화면에서 빠지고 성립 배치 대기" },
    { src: "심사자분배 현황판", cond: "분배상태 = 보완중", to: "보완중", note: "보완 담당(보완의뢰)으로 분배 · 고객 서류 회신 대기" },
    { src: "심사자분배 현황판", cond: "분배상태 = 심사중", to: "심사중", note: "심사자가 심사 중" },
    { src: "심사자분배 현황판", cond: "분배상태 = 미심사", to: "스캔완료", note: "스캔 후 심사자 배정 대기" },
    { src: "모니터링방", cond: "목록에 있음", to: "모니터링대기", note: "서류 완벽 · 질병심사 표준 · 모니터링 완료 후 성립 배치" },
    { src: "장기대기현황", cond: "목록에 있음", to: "청약완료", note: "스캔 전 (스캔되면 목록에서 사라짐)" },
    { src: "어느 자료에도 없음", cond: "-", to: "확인필요", note: "데이터 점검 대상" },
  ];
  function rulesHtml(rows) {
    const cnt = (st) => rows.filter((c) => c.status === st).length;
    const sum = RULES.reduce((a, r) => a + cnt(r.to), 0);
    let lastSrc = "", step = 0;
    const body = RULES.map((r) => {
      const first = r.src !== lastSrc; if (first) step++; lastSrc = r.src;
      return `<tr class="${first ? "vf-first" : ""}"><td class="vf-step">${first ? step : ""}</td><td>${first ? r.src : ""}</td><td>${r.cond}</td>
        <td><b>${r.to}</b></td><td class="muted">${r.note}</td><td class="num">${fmt(cnt(r.to))}</td></tr>`;
    }).join("");
    let overlap = 0;
    for (const r of RAW) if (!r.처리결과 && [DIST.has(r.증권번호), MON.has(r.증권번호), WAIT.has(r.증권번호)].filter(Boolean).length > 1) overlap++;
    return `<p class="vf-flow"><span>청약</span>→<span>장기대기 (스캔 전)</span>→<span>스캔 · 심사 개시</span>→<span>모니터링방 <small>서류 완벽 · 표준</small></span>
        <em>또는</em><span>심사자분배 <small>심사중 · 미심사 · 보완의뢰</small></span>→<span>성립 배치 (매일 06:00)</span>→<span>성립 / 반송</span></p>
      <div class="table-wrap"><table class="vf-table"><thead><tr><th>순서</th><th>확인하는 자료</th><th>조건</th><th>판정 상태</th><th>뜻</th><th class="num">건수</th></tr></thead>
      <tbody>${body}<tr class="vf-sum"><td></td><td colspan="4">합계 = 청약 건수 ${fmt(rows.length)}건</td><td class="num">${fmt(sum)} ${ok(sum === rows.length)}</td></tr></tbody></table></div>
      <p class="hint vf-hint">위에서부터 차례로 확인해 처음 맞는 규칙으로 상태를 정합니다. 한 건이 여러 자료에 겹치면 더 진행된 단계가 우선입니다 · 지금 자료에서 겹친 건 ${fmt(overlap)}건</p>`;
  }
  window.renderRules = (rows) => {
    const html = rulesHtml(rows);
    $("rules-dash").innerHTML = html;
    $("vf-rules").innerHTML = html;
  };

  // ── 데이터 구성: PRD 기준과 실제 가상데이터 비교 (조회 조건과 무관하게 전체 자료) ──
  function dataSpec() {
    const by = (f) => RAW.reduce((o, r) => ((o[f(r)] = (o[f(r)] ?? 0) + 1), o), {});
    const branches = Object.keys(by((r) => r.지점)), channels = Object.keys(by((r) => r.채널));
    const perCh = CHANNELS.map((ch) => {
      const prods = Object.entries(by((r) => (r.채널 === ch ? r.상품 : "")) ).filter(([k]) => k).sort((a, b) => a[1] - b[1]);
      const base = prods[0]?.[1] || 1, ratio = prods.map(([, v]) => v / base);
      const pass = prods.length === 3 && Math.abs(ratio[1] - 4) < 0.15 && Math.abs(ratio[2] - 10) < 0.15;
      return { ch, prods, ratio, pass, total: prods.reduce((a, [, v]) => a + v, 0) };
    });
    const rows = [
      ["총 청약 건수", "5,000건", `${fmt(RAW.length)}건`, RAW.length === 5000],
      ["지점 수", "10개", `${branches.length}개`, branches.length === 10],
      ["채널 수", "4개", `${channels.length}개 (${CHANNELS.join(" · ")})`, channels.length === 4],
      ["채널별 상품 수", "각 3개", perCh.map((p) => `${p.ch} ${p.prods.length}`).join(" · "), perCh.every((p) => p.prods.length === 3)],
      ["채널별 상품 청약 비율", "1 : 4 : 10", "아래 표 참고", perCh.every((p) => p.pass)],
    ];
    return `<div class="table-wrap"><table class="vf-table"><thead><tr><th>PRD 항목</th><th>PRD 기준</th><th>실제 가상데이터</th><th>결과</th></tr></thead><tbody>${
      rows.map(([k, want, got, pass]) => `<tr><td><b>${k}</b></td><td>${want}</td><td>${got}</td><td>${ok(pass)}</td></tr>`).join("")
    }</tbody></table></div>
    <div class="table-wrap"><table class="vf-table vf-ratio"><thead><tr><th>채널</th><th>상품 (적은 순)</th><th class="num">건수</th><th class="num">비율</th><th class="num">채널 합계</th><th>결과</th></tr></thead><tbody>${
      perCh.map((p) => `<tr class="vf-first"><td><b>${p.ch}</b></td><td>${p.prods.map(([k]) => k).join(" · ")}</td>
        <td class="num">${p.prods.map(([, v]) => fmt(v)).join(" : ")}</td><td class="num">${p.ratio.map((r) => r.toFixed(1)).join(" : ")}</td>
        <td class="num">${fmt(p.total)}</td><td>${ok(p.pass)}</td></tr>`).join("")
    }</tbody></table></div>
    <p class="hint vf-hint">비율 = 가장 적은 상품을 1로 놓았을 때 · 1,250건을 1:4:10으로 나누면 83.3 : 333.3 : 833.3이라 정수로 반올림해 83 : 333 : 834</p>`;
  }

  // ── 필터 시험: 실제 필터를 적용해 화면 결과를 읽고 원천 자료 계산과 비교 ──
  const lastDay = BIZ_DAYS.at(-1), from5 = BIZ_DAYS[Math.max(0, BIZ_DAYS.length - 5)];
  const TESTS = [
    { label: "기간 · 전일", set: { days: 1 }, want: (r) => r.청약일자 === lastDay },
    { label: "기간 · 최근 5영업일", set: { days: 5 }, want: (r) => r.청약일자 >= from5 },
    { label: "채널 · HB", set: { channel: "HB" }, want: (r) => r.채널 === "HB" },
    { label: "영업채널 · 강남지점", set: { branch: "강남지점" }, want: (r) => r.지점 === "강남지점" },
    { label: "심사상태 · 보완중", set: { status: "보완중" }, want: (r) => rawStatus(r) === "보완중", list: true },
    { label: "조합 · 최근 5영업일 + GA + 강남지점", set: { days: 5, channel: "GA", branch: "강남지점" }, want: (r) => r.청약일자 >= from5 && r.채널 === "GA" && r.지점 === "강남지점" },
  ];
  const shownTotal = () => Number(($("dx-total")?.textContent ?? "").replace(/[^0-9]/g, ""));
  const shownList = () => Number($("list-count").textContent.split("건")[0].replace(/[^0-9]/g, ""));
  function runFilterTests() {
    const saved = readForm(), savedUw = listUw, savedChip = document.querySelector("#presets .chip.on")?.dataset.days;
    listUw = "";
    const results = TESTS.map((t) => {
      setRange(t.set.days ?? 0);
      F.channel.value = t.set.channel ?? ""; refreshProducts(); F.branch.value = t.set.branch ?? ""; F.product.value = ""; F.status.value = t.set.status ?? "";
      search();
      const want = RAW.filter(t.want).length, got = t.list ? shownList() : shownTotal(), xl = buildWorkbook().detail.length;
      return { ...t, want, got, xl, cond: `${Q.from} ~ ${Q.to}${Q.channel ? ` · ${Q.channel}` : ""}${Q.branch ? ` · ${Q.branch}` : ""}${Q.status ? ` · ${Q.status}` : ""}` };
    });
    // 원래 조건으로 되돌림
    listUw = savedUw;
    F.channel.value = saved.channel; refreshProducts();
    Object.entries(saved).forEach(([k, v]) => (F[k].value = v));
    document.querySelectorAll("#presets .chip").forEach((b) => b.classList.toggle("on", b.dataset.days === savedChip));
    search();
    const allPass = results.every((r) => r.want === r.got && r.xl === (r.list ? r.got : r.want));
    $("vf-filter").innerHTML = `<p class="vf-summary">${ok(allPass)} ${results.length}개 시험 중 ${results.filter((r) => r.want === r.got).length}개 일치 · 시험 후 원래 조회 조건으로 되돌렸습니다</p>
      <div class="table-wrap"><table class="vf-table"><thead><tr><th>시험</th><th>적용된 조건</th><th class="num">기대 (원천 자료)</th><th class="num">화면 결과</th><th class="num">엑셀 행 수</th><th>결과</th></tr></thead><tbody>${
        results.map((r) => `<tr><td><b>${r.label}</b></td><td class="muted">${r.cond}</td><td class="num">${fmt(r.want)}</td><td class="num">${fmt(r.got)}<small class="muted"> ${r.list ? "상세 목록" : "청약 건수"}</small></td>
          <td class="num">${fmt(r.xl)}</td><td>${ok(r.want === r.got && r.xl === (r.list ? r.got : r.want))}</td></tr>`).join("")
      }</tbody></table></div>
      <p class="hint vf-hint">기대 = 원천 자료(일일 신계약현황)를 조건으로 직접 센 값 · 화면 결과 = 필터를 실제로 적용한 뒤 화면에 표시된 값 · 심사상태 필터는 상세 목록과 엑셀에 적용됩니다</p>`;
  }

  // ── 엑셀 확인: 다운로드할 파일을 실제로 만들고 다시 읽어 내용 확인 ──
  function checkExcel() {
    if (!window.XLSX) { $("vf-excel").innerHTML = `<p class="vf-summary">${ok(false)} 엑셀 도구를 불러오지 못했습니다</p>`; return; }
    const { wb, rows } = buildWorkbook();
    const back = XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), { type: "array" }); // 파일로 만든 뒤 다시 읽음
    const sheet = (name) => XLSX.utils.sheet_to_json(back.Sheets[name] ?? {});
    const sum = sheet("단계별요약"), det = sheet("상세목록"), cond = sheet("검색조건");
    const listN = sortedList(rows).length, sumN = sum.reduce((a, r) => a + (Number(r.건수) || 0), 0);
    const checks = [
      ["시트 구성", "단계별요약 · 상세목록 · 검색조건", back.SheetNames.join(" · "), back.SheetNames.join() === "단계별요약,상세목록,검색조건"],
      ["상세목록 행 수", `화면 상세 목록 ${fmt(listN)}건`, `${fmt(det.length)}행`, det.length === listN],
      ["단계별요약 건수 합계", `청약 건수 ${fmt(rows.length)}건`, `${fmt(sumN)}건`, sumN === rows.length],
      ["검색조건 시트", `청약일 ${Q.from} ~ ${Q.to}`, cond.find((r) => r.항목 === "청약일")?.값 ?? "-", cond.find((r) => r.항목 === "청약일")?.값 === `${Q.from} ~ ${Q.to}`],
    ];
    const cols = det[0] ? Object.keys(det[0]) : [];
    $("vf-excel").innerHTML = `<p class="vf-summary">${ok(checks.every((c) => c[3]))} 파일 이름 <b>${excelName()}</b> · 지금 조회 조건 그대로 만든 파일을 다시 읽어 확인했습니다</p>
      <div class="table-wrap"><table class="vf-table"><thead><tr><th>확인 항목</th><th>기대</th><th>파일 내용</th><th>결과</th></tr></thead><tbody>${
        checks.map(([k, w, g, p]) => `<tr><td><b>${k}</b></td><td>${w}</td><td>${g}</td><td>${ok(p)}</td></tr>`).join("")
      }</tbody></table></div>
      <p class="vf-sub">상세목록 시트 첫 3행 (열 ${cols.length}개)</p>
      <div class="table-wrap"><table class="vf-table vf-mini"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${
        det.slice(0, 3).map((r) => `<tr>${cols.map((c) => `<td>${r[c] ?? ""}</td>`).join("")}</tr>`).join("")
      }</tbody></table></div>`;
  }

  // ── PRD 대응표 ──
  function prdMap(rows) {
    const reviewed = rows.filter((c) => !["청약완료", "확인필요"].includes(c.status)).length;
    const late = rows.filter((c) => c.late).length;
    const statusSum = STATUSES.reduce((a, s) => a + rows.filter((c) => c.status === s.key).length, 0);
    const items = [
      ["핵심지표", "심사상태별 건수 및 비율", "대시보드 › 청약 건수 구성 · 심사 단계별 현황", `상태 ${STATUSES.length}개 합계 ${fmt(statusSum)}건 = 청약 ${fmt(rows.length)}건`, statusSum === rows.length],
      ["핵심지표", "상태별 건수 확인", "대시보드 › 심사 단계별 현황 (행을 누르면 그 상태만)", "아래 상태 분류 규칙의 상태별 건수", true],
      ["핵심지표", "누적 심사건수", "대시보드 › 일별 청약 · 종결, 일말 진행중 잔량", `스캔 후 심사가 시작된 누적 ${fmt(reviewed)}건`, true],
      ["데이터 추출", "기간 · 채널 · 영업채널 · 심사상태 조건 검색", "필터 영역 (바꾸는 즉시 반영)", "아래 필터 시험", null],
      ["데이터 추출", "엑셀 다운로드", "배너 · 상세 목록 버튼 · 우클릭", "아래 엑셀 확인", null],
      ["기대효과", "전체 건수 대비 진행 현황", "대시보드 › 청약 건수 대비 처리 현황", "채널별 막대 길이 = 청약 건수", true],
      ["기대효과", "심사 지연 건수 관리", "대시보드 › 지연 카드 · 상세 목록 색 표시, 브리핑 › 주의할 것", `현재 기준 초과 ${fmt(late)}건`, true],
      ["데이터 조합", "심사자분배 + 장기대기현황 + 모니터링방 조합 · 전날 기준, 당일 06:00 배치", "기준시각 (배너) · 상태 분류 규칙", `기준시각 ${DATA.asOf}`, DATA.asOf.endsWith("06:00")],
      ["업무 흐름", "장기대기 = 청약완료(스캔 전), 스캔 후 사라짐", "대시보드 › 상태 분류 규칙 4번", `청약완료 ${fmt(rows.filter((c) => c.status === "청약완료").length)}건`, true],
      ["업무 흐름", "분배 현황판 = 심사중 · 미심사 / 성립처리는 화면에서 빠짐 / 보완중은 보완 담당으로 분배", "대시보드 › 상태 분류 규칙 2번 · 상세 목록 심사자 \"보완의뢰\"",
        `심사중 ${fmt(rows.filter((c) => c.status === "심사중").length)} · 미심사 ${fmt(rows.filter((c) => c.status === "스캔완료").length)} · 보완의뢰 ${fmt(rows.filter((c) => c.uw === SUPP_OWNER).length)} · 성립대기 ${fmt(rows.filter((c) => c.status === "성립대기").length)}`,
        rows.filter((c) => c.status === "보완중").every((c) => c.uw === SUPP_OWNER)],
      ["업무 흐름", "모니터링방 건수 대시보드 포함", "대시보드 › 심사 단계별 현황 · 구성표 진행중", `모니터링대기 ${fmt(rows.filter((c) => c.status === "모니터링대기").length)}건`, true],
      ["가상데이터", "지점 10 · 채널 4 · 채널별 상품 3 · 1:4:10 · 총 5,000건", "검증 › 데이터 구성", "아래 데이터 구성", null],
    ];
    return `<div class="table-wrap"><table class="vf-table"><thead><tr><th>구분</th><th>PRD 요구사항</th><th>화면 위치</th><th>지금 값 · 확인 방법</th><th>결과</th></tr></thead><tbody>${
      items.map(([g, req, where, now, pass]) => `<tr><td class="muted">${g}</td><td><b>${req}</b></td><td>${where}</td><td>${now}</td><td>${pass == null ? `<span class="vf-badge wait">아래에서 확인</span>` : ok(pass)}</td></tr>`).join("")
    }</tbody></table></div>`;
  }

  window.renderVerify = (rows) => {
    $("vf-prd").innerHTML = prdMap(rows);
    $("vf-cond").textContent = `지금 조회 조건 · 청약일 ${Q.from} ~ ${Q.to}${Q.channel ? ` · ${Q.channel}` : ""}${Q.branch ? ` · ${Q.branch}` : ""}${Q.product ? ` · ${Q.product}` : ""}${Q.status ? ` · ${Q.status}` : ""}`;
  };
  $("vf-data").innerHTML = dataSpec();
  $("vf-run-filter").addEventListener("click", runFilterTests);
  $("vf-run-excel").addEventListener("click", checkExcel);
  if (Q.from) { const rows = baseFiltered(); window.renderRules(rows); window.renderVerify(rows); }
})();

// 브리핑 탭: 부서장 · 담당임원용 요약. 현재 조회 조건(Q)의 건으로 매번 다시 계산합니다.
(() => {
  const SLA_TARGET = 80;          // 단계별 기준 내 처리율 목표(%) · 예시 값
  const HIGH_PREMIUM = 200000;    // 고액 계약 기준(월보험료) · 예시 값
  const SMALL_SAMPLE = 100;       // 이 건수 미만 상품은 비율이 흔들리므로 흐리게 표시
  const REVIEW_DAYS = 3;          // 신호등: 심사(분배 → 의견)가 이 일수를 넘긴 건이
  const REVIEW_LIMIT = 10;        //         이 비율(%)을 넘으면 '주의'
  const SKEW_LIMIT = 1.5;         // 심사자 업무 쏠림: 최다 ÷ 최소가 이 배수를 넘으면 '주의할 것'에 표시
  const TREND_DAYS = 6;           // 업무 잔량 추세선 영업일 수
  // 사장님 화면에 쓰는 쉬운 말
  const PLAIN = { 청약완료: "접수 후 미착수", 스캔완료: "심사자 배정 대기", 심사중: "심사 중", 보완중: "서류 보완 대기", 모니터링대기: "자동심사 대기", 성립대기: "성립 처리 대기" };
  const r1 = (x) => (x == null || Number.isNaN(x) ? "-" : (Math.round(x * 10) / 10).toFixed(1));
  const won = (n) => {
    const eok = Math.floor(n / 1e8), man = Math.round((n % 1e8) / 1e4);
    return eok ? `${eok}억${man ? ` ${fmt(man)}만` : ""}원` : `${fmt(man)}만원`;
  };
  const kstDay = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
  const quant = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) * p)] : null; };
  const delta = (n, goodWhenDown) => {
    if (!n) return `<em class="bf-flat">― 0</em>`;
    const up = n > 0, bad = goodWhenDown == null ? false : up === goodWhenDown;
    return `<em class="${bad ? "bf-bad" : "bf-good"}">${up ? "▲" : "▼"} ${fmt(Math.abs(n))}</em>`;
  };

  // 건별 상태이력 (자동심사 · 보완 여부 · 구간별 기준 내 처리율)
  const HIST = new Map();
  for (const h of DATA.tables["5_상태이력"]) (HIST.get(h.증권번호) ?? HIST.set(h.증권번호, []).get(h.증권번호)).push(h);
  const went = (c, st) => (HIST.get(c.id) ?? []).some((h) => h.상태 === st);

  const isOpen = (c) => BY_KEY[c.status].group === "진행중";
  const bizToAsOf = (c) => bizDaysElapsed(c.date, kstDay(AS_OF));

  // ── 1. 3줄 브리핑 ──
  function briefLines(rows, dd) {
    const open = rows.filter(isOpen), late = open.filter((c) => c.late);
    const lateBy = {}; late.forEach((c) => (lateBy[c.status] = (lateBy[c.status] ?? 0) + 1));
    const lateTxt = Object.entries(lateBy).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k === "청약완료" ? `스캔 지연(${SCAN_LIMIT_DAYS}영업일 초과)` : `${k} 기준(${BY_KEY[k].sla}일) 초과`} ${fmt(n)}건`).join(", ");
    const due = open.filter((c) => c.dueSoon || c.overdue).length;
    const un = rows.filter((c) => c.status === "스캔완료");
    const unAvg = avg(un.map((c) => c.dwell));
    const lines = [
      late.length
        ? ["bad", `기준초과 <b>${fmt(late.length)}건</b>: ${lateTxt}`]
        : ["ok", `기준을 넘긴 진행중 건이 <b>없습니다</b>`],
      dd
        ? [dd.eod - dd.eodPrev > 0 ? "mid" : "ok",
           `${dd.d.slice(5)} 마감 잔량 <b>${fmt(dd.eod)}건</b>으로 전 영업일보다 ${fmt(Math.abs(dd.eod - dd.eodPrev))}건 ${dd.eod >= dd.eodPrev ? "늘었고" : "줄었고"}, 성립은 ${fmt(dd.ok)}건으로 ${fmt(Math.abs(dd.ok - dd.okPrev))}건 ${dd.ok >= dd.okPrev ? "많음" : "적음"}`]
        : ["mid", "비교할 전 영업일이 조회 기간에 없습니다"],
      [due ? "bad" : "ok", `심사기일 D-${NEAR_DEADLINE} 이내 <b>${fmt(due)}건</b>, 미배정 ${fmt(un.length)}건은 평균 ${r1(unAvg)}일 대기${unAvg != null && unAvg > BY_KEY["스캔완료"].sla ? ` (기준 ${BY_KEY["스캔완료"].sla}일 초과)` : ` (기준 ${BY_KEY["스캔완료"].sla}일 안)`}`],
    ];
    return lines;
  }
  const brief = (rows, dd) => `<ul class="bf-brief">${briefLines(rows, dd).map(([k, t]) => `<li><i class="bf-dot ${k}"></i><span>${t}</span></li>`).join("")}</ul>`;

  // ── 2. 전일 대비 ──
  function dayDelta(rows) {
    const days = BIZ_DAYS.filter((d) => (!Q.from || d >= Q.from) && (!Q.to || d <= Q.to));
    if (days.length < 2) return null;
    const [d0, d] = days.slice(-2);
    const at = (day) => ({
      inN: rows.filter((c) => c.date === day).length,
      ok: rows.filter((c) => c.status === "성립" && c.done && bizBucket(c.done) === day).length,
      eod: rows.filter((c) => c.date <= day && !(c.done && kstDay(c.done) <= day)).length,
    });
    const a = at(d), b = at(d0);
    return { d, d0, inN: a.inN, inPrev: b.inN, ok: a.ok, okPrev: b.ok, eod: a.eod, eodPrev: b.eod };
  }
  const tile = (label, n, prev, goodWhenDown, note) =>
    `<div class="bf-tile"><span>${label}</span><strong>${fmt(n)}</strong><div>${delta(n - prev, goodWhenDown)} <small>전일 ${fmt(prev)}${note ?? ""}</small></div></div>`;

  // ── 8. 진행중 보험료 ──
  function premium(rows) {
    const open = rows.filter(isOpen), hi = open.filter((c) => c.premium >= HIGH_PREMIUM);
    const sum = open.reduce((a, c) => a + c.premium, 0), hiSum = hi.reduce((a, c) => a + c.premium, 0);
    return `<div class="bf-big">${won(sum)}<small>진행중 ${fmt(open.length)}건 월보험료 합계</small></div>
      <div class="bf-split" role="img" aria-label="고액 ${hi.length}건 ${won(hiSum)}, 그 외 ${open.length - hi.length}건 ${won(sum - hiSum)}">
        <div class="s1" style="flex:${hiSum || 0.0001}">고액 ${fmt(hi.length)}건 · ${won(hiSum)}</div>
        <div class="s2" style="flex:${sum - hiSum || 0.0001}">그 외 ${fmt(open.length - hi.length)}건</div>
      </div>
      <p class="bf-note">고액 = 월보험료 ${fmt(HIGH_PREMIUM / 1e4)}만원 이상 (예시 기준) · 고액 비중 ${pct(hiSum, sum)}%</p>`;
  }

  // ── 3. 단계별 기준 내 처리율 (끝난 구간) ──
  function slaData(rows) {
    const acc = {};
    for (const c of rows) for (const h of HIST.get(c.id) ?? []) {
      const s = BY_KEY[h.상태];
      if (!s?.sla || s.bizSla || !h.종료일시) continue;
      const d = (toTime(h.종료일시) - toTime(h.시작일시)) / DAY;
      (acc[h.상태] ??= [0, 0])[0]++;
      if (d <= s.sla) acc[h.상태][1]++;
    }
    return Object.entries(acc).map(([k, [n, ok]]) => ({ k, n, rate: (100 * ok) / n })).sort((a, b) => b.rate - a.rate);
  }
  function slaRates(rows) {
    const list = slaData(rows);
    if (!list.length) return `<p class="bf-note">끝난 구간이 없습니다</p>`;
    return `<div class="bf-bars">${list.map((x) => `<div class="bf-bar-row"><span>${x.k}</span>
        <div class="bf-track"><div class="bf-fill ${x.rate < SLA_TARGET ? "warn" : ""}" style="width:${x.rate}%"></div><i class="bf-target" style="left:${SLA_TARGET}%"></i></div>
        <span class="bf-r ${x.rate < SLA_TARGET ? "bf-bad" : ""}">${r1(x.rate)}%</span></div>`).join("")}</div>
      <p class="bf-note"><i class="bf-target-key"></i>목표 ${SLA_TARGET}% (예시 값) · 끝난 구간 ${fmt(list.reduce((a, x) => a + x.n, 0))}개 기준 · 스캔 전 단계는 영업일 기준이라 제외</p>`;
  }

  // ── 4. 심사자별 업무량 ──
  function uwData(rows) {
    const map = {};
    for (const c of rows) if (c.uw && c.uw !== SUPP_OWNER && isOpen(c)) { // 보완의뢰는 심사자가 아니므로 제외
      const u = (map[c.uw] ??= { n: 0, 심사중: 0, 성립대기: 0, late: 0 });
      u.n++; if (u[c.status] != null) u[c.status]++; if (c.late) u.late++;
    }
    return Object.entries(map).sort((a, b) => b[1].n - a[1].n);
  }
  function reviewers(rows) {
    const list = uwData(rows);
    if (!list.length) return `<p class="bf-note">조건에 맞는 배정 건이 없습니다</p>`;
    const max = list[0][1].n, min = list.at(-1)[1].n;
    return `<div class="table-wrap"><table class="bf-table"><thead><tr><th>심사자</th><th>보유</th><th class="num">심사중</th><th class="num">성립대기</th><th class="num">기준초과</th></tr></thead><tbody>${
      list.map(([k, u], i) => `<tr class="${i === 0 && list.length > 1 && max > min * 1.2 ? "bf-hl" : ""}"><td><b>${k}</b></td>
        <td><span class="bf-mini" style="width:${Math.round((u.n / max) * 64)}px"></span><b class="num">${fmt(u.n)}</b></td>
        <td class="num">${fmt(u.심사중)}</td><td class="num">${fmt(u.성립대기)}</td>
        <td class="num ${u.late ? "bf-bad" : ""}">${fmt(u.late)}</td></tr>`).join("")
    }</tbody></table></div>
    <p class="bf-note">최다 ${list[0][0]} ${fmt(max)}건 · 최소 ${list.at(-1)[0]} ${fmt(min)}건 (${r1(max / min)}배) · 보완중 ${fmt(rows.filter((c) => c.uw === SUPP_OWNER && isOpen(c)).length)}건은 ${SUPP_OWNER}로 따로 분배 · 처리 건수(생산성)는 처리자 자료가 있어야 계산할 수 있습니다</p>`;
  }

  // ── 5. 자동심사율 ──
  function stp(rows) {
    const ok = rows.filter((c) => c.status === "성립");
    if (!ok.length) return `<p class="bf-note">성립 건이 없습니다</p>`;
    const auto = ok.filter((c) => !went(c, "심사중")).length;
    const chips = CHANNELS.filter((ch) => !Q.channel || ch === Q.channel).map((ch) => {
      const l = ok.filter((c) => c.channel === ch);
      return l.length ? [ch, (100 * l.filter((c) => !went(c, "심사중")).length) / l.length] : null;
    }).filter(Boolean); // 채널 순서 고정 (방카 · GA · HB · 온라인)
    return `<div class="bf-big">${r1((100 * auto) / ok.length)}%<small>성립 ${fmt(ok.length)}건 중 ${fmt(auto)}건</small></div>
      <div class="bf-split" role="img" aria-label="자동 성립 ${auto}건, 심사 후 성립 ${ok.length - auto}건">
        <div class="s1" style="flex:${auto || 0.0001}">자동 성립 ${fmt(auto)}</div><div class="s2" style="flex:${ok.length - auto || 0.0001}">심사 후 ${fmt(ok.length - auto)}</div>
      </div>
      <div class="bf-chips">${chips.map(([ch, v]) => `<span class="bf-chip">${ch}<b>${r1(v)}%</b></span>`).join("")}</div>
      <p class="bf-note">자동 성립 = 심사자 배정 없이 모니터링방만 거쳐 성립된 건</p>`;
  }

  // ── 6. 성립 기간 분포 ──
  function leadDist(rows) {
    const lt = rows.filter((c) => c.status === "성립" && c.leadTime != null).map((c) => c.leadTime);
    if (!lt.length) return `<p class="bf-note">성립 건이 없습니다</p>`;
    const p50 = quant(lt, 0.5), p90 = quant(lt, 0.9), mean = avg(lt);
    const top = Math.max(15, Math.ceil(p90 / 5) * 5), x = (v) => `${(v / top) * 100}%`;
    return `<div class="bf-range" role="img" aria-label="중앙값 ${r1(p50)}일, 평균 ${r1(mean)}일, 늦은 10퍼센트 ${r1(p90)}일 이상">
        <div class="bf-line"></div><div class="bf-band" style="width:${x(p50)}"></div>
        <div class="bf-mk" style="left:${x(p50)}"><i class="m50"></i><b>중앙 ${r1(p50)}일</b></div>
        <div class="bf-mk" style="left:${x(p90)}"><i class="m90"></i><b>늦은 10% ${r1(p90)}일↑</b></div>
      </div>
      <div class="bf-axis">${[0, top / 3, (2 * top) / 3, top].map((v, i) => `<span>${Math.round(v)}${i === 3 ? "일" : ""}</span>`).join("")}</div>
      <p class="bf-note">청약일 → 성립 · ${fmt(lt.length)}건 · 평균 ${r1(mean)}일 · 절반은 ${r1(p50)}일 안에, 늦은 10%는 ${r1(p90)}일 넘게 걸림</p>`;
  }

  // ── 7. 채널 · 상품 품질 ──
  const rate = (l) => {
    const rv = l.filter((c) => went(c, "심사중"));
    return { n: l.length, supp: rv.length ? (100 * rv.filter((c) => went(c, "보완중")).length) / rv.length : null, back: l.length ? (100 * l.filter((c) => c.status === "반송").length) / l.length : 0 };
  };
  function quality(rows) {
    const prods = [...new Set(rows.map((c) => c.product))].map((p) => ({ k: p, ...rate(rows.filter((c) => c.product === p)) }));
    const topS = prods.filter((p) => p.supp != null).sort((a, b) => b.supp - a.supp).slice(0, 4);
    const topB = prods.slice().sort((a, b) => b.back - a.back).slice(0, 4);
    const all = rate(rows);
    const name = (p) => `${p.k}${p.n < SMALL_SAMPLE ? ` <span class="bf-small">${fmt(p.n)}건</span>` : ""}`;
    const ch = CHANNELS.filter((c) => !Q.channel || c === Q.channel).map((c) => ({ k: c, ...rate(rows.filter((x) => x.channel === c)) }));
    return `<div class="table-wrap"><table class="bf-table"><thead><tr><th>보완율 높은 상품</th><th class="num">보완율</th><th>반송률 높은 상품</th><th class="num">반송률</th></tr></thead><tbody>${
      [0, 1, 2, 3].map((i) => `<tr><td>${topS[i] ? name(topS[i]) : ""}</td><td class="num ${i === 0 ? "bf-bad" : ""}">${topS[i] ? `${r1(topS[i].supp)}%` : ""}</td>
        <td>${topB[i] ? name(topB[i]) : ""}</td><td class="num ${i === 0 ? "bf-bad" : ""}">${topB[i] ? `${r1(topB[i].back)}%` : ""}</td></tr>`).join("")
    }</tbody></table></div>
    <div class="bf-chips">${ch.map((c) => `<span class="bf-chip">${c.k} 보완<b>${r1(c.supp)}%</b> · 반송<b>${r1(c.back)}%</b></span>`).join("")}</div>
    <p class="bf-note">보완율 = 심사를 거친 건 중 보완 요청이 나간 비율 · 전체 보완율 ${r1(all.supp)}%, 반송률 ${r1(all.back)}% · 흐린 숫자는 ${SMALL_SAMPLE}건 미만 상품</p>`;
  }

  // ── 9. 조치 필요 건 ──
  const ACTIONS = [
    { key: "scan", label: "스캔 지연", test: (c) => c.status === "청약완료" && c.late },
    { key: "sla", label: "단계 기준초과", test: (c) => isOpen(c) && c.status !== "청약완료" && c.late },
    { key: "due", label: `심사기일 D-${NEAR_DEADLINE}`, test: (c) => isOpen(c) && (c.dueSoon || c.overdue) },
    { key: "check", label: "확인필요", test: (c) => c.status === "확인필요" },
  ];
  let actionKey = "scan";
  const owner = (c) => c.uw || (c.status === "청약완료" ? "스캔 담당" : c.status === "스캔완료" ? "미배정" : c.status === "모니터링대기" ? "모니터링방" : "-");
  const elapsed = (c, key = actionKey) => c.status === "청약완료" ? `${bizToAsOf(c)}영업일` : key === "due" ? (c.overdue ? "기일 초과" : `D-${Math.floor(c.dLeft)}`) : c.dwell == null ? "-" : `${r1(c.dwell)}일`;
  function actions(rows) {
    const counts = ACTIONS.map((a) => ({ ...a, list: rows.filter(a.test) }));
    if (!counts.find((a) => a.key === actionKey)?.list.length) actionKey = (counts.find((a) => a.list.length) ?? counts[0]).key;
    const cur = counts.find((a) => a.key === actionKey);
    const list = cur.list.slice().sort((a, b) => (b.dwell ?? 0) - (a.dwell ?? 0));
    return `<div class="bf-chips" role="group" aria-label="사유 선택">${counts.map((a) =>
        `<button type="button" class="bf-chip btn-chip ${a.key === actionKey ? "on" : ""}" data-act="${a.key}" aria-pressed="${a.key === actionKey}">${a.label}<b>${fmt(a.list.length)}</b></button>`).join("")}</div>
      ${list.length ? `<div class="table-wrap"><table class="bf-table"><thead><tr><th>증권번호</th><th>청약일</th><th>채널</th><th>상품</th><th>현재 상태</th><th>경과</th><th>담당</th></tr></thead><tbody>${
        list.slice(0, 10).map((c) => `<tr><td>${c.id}</td><td>${c.date.slice(5)}</td><td>${c.channel}</td><td>${c.product}</td><td>${c.status}</td><td class="bf-bad">${elapsed(c)}</td><td>${owner(c)}</td></tr>`).join("")
      }</tbody></table></div>${list.length > 10 ? `<p class="bf-note">외 ${fmt(list.length - 10)}건 · 전체는 대시보드 상세 목록이나 엑셀에서 확인</p>` : ""}`
      : `<p class="bf-note">해당 건이 없습니다</p>`}`;
  }


  // ── 사장님 요약: 신호등 · 핵심 숫자 4개 · 주의할 것 · 잔량 추세 ──
  function execData(rows) {
    const dd = dayDelta(rows);
    const open = rows.filter(isOpen), late = open.filter((c) => c.late);
    const due = open.filter((c) => c.dueSoon || c.overdue).length;
    // 심사 3일 초과 비율: 끝난 심사는 분배 → 의견 기간, 진행 중인 심사는 지금까지 경과
    let revN = 0, revOver = 0, revOpenOver = 0;
    for (const c of rows) {
      if (c.reviewDays != null) { revN++; if (c.reviewDays > REVIEW_DAYS) revOver++; }
      else if (c.status === "심사중") { revN++; if (c.dwell > REVIEW_DAYS) { revOver++; revOpenOver++; } }
    }
    const revPct = revN ? (100 * revOver) / revN : 0;
    const signal = revPct > REVIEW_LIMIT ? "warn" : "ok";

    const ok = rows.filter((c) => c.status === "성립"), auto = ok.filter((c) => !went(c, "심사중")).length;
    const lt = ok.filter((c) => c.leadTime != null).map((c) => c.leadTime);
    const hi = open.filter((c) => c.premium >= HIGH_PREMIUM);
    const prem = { sum: open.reduce((a, c) => a + c.premium, 0), hiN: hi.length, hiSum: hi.reduce((a, c) => a + c.premium, 0) };

    // 주의할 것: 지연 사유별 → 심사 3일 초과 → 심사기일 임박 → 업무 쏠림
    const risks = [];
    if (signal === "warn") risks.push({ tone: "warn", title: `심사가 ${REVIEW_DAYS}일 넘게 걸린 건 ${r1(revPct)}%`,
      impact: `기준 ${REVIEW_LIMIT}%를 넘음 · 성립이 늦어져 고객 대기가 길어짐`, action: revOpenOver ? `지금 심사 중 ${REVIEW_DAYS}일 넘은 ${fmt(revOpenOver)}건 우선 처리` : `${fmt(revN)}건 중 ${fmt(revOver)}건이 ${REVIEW_DAYS}일 초과 · 심사 속도 점검` });
    const lateBy = {}; late.forEach((c) => (lateBy[c.status] ??= []).push(c));
    Object.entries(lateBy).sort((a, b) => b[1].length - a[1].length).forEach(([st, l]) => {
      if (st === "청약완료") risks.push({ tone: "bad", title: `접수 후 ${SCAN_LIMIT_DAYS}영업일 넘게 미착수 ${fmt(l.length)}건`,
        impact: "고객은 청약했는데 심사가 시작되지 않음", action: `스캔 담당 오늘 중 처리 · 가장 오래된 건 ${Math.max(...l.map(bizToAsOf))}영업일` });
      else if (st === "보완중") {
        const prods = [...new Set(rows.map((c) => c.product))].map((p) => ({ k: p, ...rate(rows.filter((c) => c.product === p)) }))
          .filter((p) => p.supp != null && p.n >= SMALL_SAMPLE).sort((a, b) => b.supp - a.supp);
        risks.push({ tone: "bad", title: `서류 보완 ${BY_KEY[st].sla}일 넘게 대기 ${fmt(l.length)}건`, impact: "고객 서류 회신이 늦어 성립이 밀림",
          action: `${SUPP_OWNER} 담당 · 영업 채널에 회신 독려${prods[0] ? ` · ${prods[0].k} 보완율 ${r1(prods[0].supp)}%로 가장 높음` : ""}` });
      } else risks.push({ tone: "bad", title: `${PLAIN[st] ?? st} ${BY_KEY[st].sla}일 넘김 ${fmt(l.length)}건`, impact: "정해진 처리 기간을 넘김", action: "담당 확인 후 오늘 처리" });
    });
    if (due) risks.push({ tone: "bad", title: `심사기일 D-${NEAR_DEADLINE} 이내 ${fmt(due)}건`, impact: `청약일 + ${DEADLINE_DAYS}일 안에 끝내야 함`, action: "기일 순서로 우선 처리" });
    const uw = uwData(rows);
    if (uw.length > 1) {
      const [maxK, maxU] = uw[0], [minK, minU] = uw.at(-1), ratio = maxU.n / Math.max(1, minU.n);
      if (ratio > SKEW_LIMIT) risks.push({ tone: "warn", title: "심사 업무 한 사람에게 쏠림",
        impact: `${maxK} ${fmt(maxU.n)}건, 가장 적은 ${minK}의 ${r1(ratio)}배 · 지연 ${fmt(maxU.late)}건`, action: "부서장 분배 조정" });
    }

    // 잔량 추세 (조회 기간 안 최근 영업일)
    const days = BIZ_DAYS.filter((d) => (!Q.from || d >= Q.from) && (!Q.to || d <= Q.to)).slice(-TREND_DAYS);
    const trend = days.map((d) => ({ d, n: rows.filter((c) => c.date <= d && !(c.done && kstDay(c.done) <= d)).length }));

    // 한 문장 결론
    const lateTxt = Object.entries(lateBy).sort((a, b) => b[1].length - a[1].length).slice(0, 2).map(([st, l]) => `${PLAIN[st] ?? st} ${fmt(l.length)}건`).join(", ");
    const head = signal === "warn"
      ? `심사 ${REVIEW_DAYS}일을 넘긴 건이 ${r1(revPct)}%로 기준(${REVIEW_LIMIT}%)을 넘었습니다`
      : `심사가 기준 안에서 진행되고 있습니다`;
    const sub = [
      late.length ? `처리 지연 ${fmt(late.length)}건은 ${lateTxt}에 몰려 있습니다.` : "처리 지연은 없습니다.",
      due ? `심사기일 임박 ${fmt(due)}건이 있습니다.` : "심사기일이 임박한 건은 없습니다.",
      signal === "ok" ? `심사 ${REVIEW_DAYS}일 초과 ${r1(revPct)}% (기준 ${REVIEW_LIMIT}% 이하)` : "",
    ].filter(Boolean).join(" ");

    return {
      signal, head, sub, revPct, dd, late: late.length, openN: open.length, due,
      lead: lt.length ? { p50: quant(lt, 0.5), p90: quant(lt, 0.9) } : null,
      prem, risks: risks.slice(0, 4), trend,
      stp: { ok: ok.length, auto, ch: CHANNELS.filter((ch) => !Q.channel || ch === Q.channel).map((ch) => {
        const l = ok.filter((c) => c.channel === ch); return l.length ? [ch, (100 * l.filter((c) => !went(c, "심사중")).length) / l.length, l.length] : null; }).filter(Boolean) },
      good: [...(due ? [] : [`심사기일 임박 <b>0건</b>`]), `반송률 <b>${r1(rate(rows).back)}%</b>`],
    };
  }
  const SIGNAL = { ok: "정상", warn: "주의" };

  // 추세선 (SVG): 화면과 PDF 보고서가 같이 씀
  function sparkSvg(trend, cls = "cx-spark", H = 130) {
    if (trend.length < 2) return `<p class="bf-note">추세는 조회 기간이 2영업일 이상일 때 보입니다</p>`;
    const vs = trend.map((t) => t.n), lo0 = Math.min(...vs), hi0 = Math.max(...vs), pad = Math.max(5, (hi0 - lo0) * 0.15);
    const base = H - 20, lo = lo0 - pad, hi = hi0 + pad, X = (i) => 20 + (260 * i) / (trend.length - 1), Y = (v) => base - ((v - lo) / (hi - lo)) * (base - 22);
    const pts = trend.map((t, i) => `${X(i).toFixed(1)},${Y(t.n).toFixed(1)}`);
    const iMax = vs.indexOf(hi0), last = trend.length - 1;
    const lbl = (i, anchor, dy) => `<text class="v" x="${X(i).toFixed(1)}" y="${(Y(vs[i]) + dy).toFixed(1)}" text-anchor="${anchor}">${fmt(vs[i])}</text>`;
    const dates = [0, Math.floor(last / 2), last].filter((v, i, a) => a.indexOf(v) === i);
    return `<svg class="${cls}" viewBox="0 0 300 ${H}" role="img" aria-label="최근 ${trend.length}영업일 업무 마감 잔량: ${trend.map((t) => `${t.d.slice(5)} ${fmt(t.n)}건`).join(", ")}">
      <path class="area" d="M${pts.join(" L")} L${X(last).toFixed(1)},${base} L20,${base} Z"/>
      <polyline class="line" points="${pts.join(" ")}"/>
      ${trend.map((t, i) => `<circle class="${i === last ? "end" : "dot"}" cx="${X(i).toFixed(1)}" cy="${Y(t.n).toFixed(1)}" r="${i === last ? 5 : 3}"/>`).join("")}
      ${iMax !== last ? lbl(iMax, "middle", -9) : ""}${lbl(last, "end", -10)}
      ${dates.map((i) => `<text x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? "start" : i === last ? "end" : "middle"}">${trend[i].d.slice(5).replace("-", "/")}</text>`).join("")}
    </svg>`;
  }
  function trendNote(trend) {
    if (trend.length < 2) return "";
    const vs = trend.map((t) => t.n), last = vs.at(-1), prev = vs.at(-2), iMax = vs.indexOf(Math.max(...vs));
    const peak = iMax !== vs.length - 1 ? `${trend[iMax].d.slice(5).replace("-", "/")}에 ${fmt(vs[iMax])}건으로 가장 많았고, ` : "기간 중 가장 많은 수준이고, ";
    return `${peak}어제는 ${last === prev ? "전 영업일과 같습니다" : `전 영업일보다 ${fmt(Math.abs(last - prev))}건 ${last > prev ? "늘었습니다" : "줄었습니다"}`}.`;
  }

  function renderExec(rows) {
    const x = execData(rows), dd = x.dd;
    const arrow = (n, goodWhenDown) => !n ? `<em class="bf-flat">― 전일과 같음</em>` : `<em class="${(n > 0) === goodWhenDown ? "bf-bad" : "bf-good"}">${n > 0 ? "▲" : "▼"} ${fmt(Math.abs(n))} 전일 대비</em>`;
    $("cx-verdict").className = `cx-verdict ${x.signal}`;
    $("cx-verdict").innerHTML = `<div class="cx-signal" role="img" aria-label="오늘 상태 ${SIGNAL[x.signal]}"><i></i><b>${SIGNAL[x.signal]}</b><small>오늘 상태</small></div>
      <div><h3>${x.head}</h3><p>${x.sub}</p><p class="cx-meta" id="bf-cond"></p></div>`;
    $("cx-big").innerHTML = [
      `<div class="cx-big"><span>처리 중인 계약</span><strong>${fmt(dd ? dd.eod : x.openN)}<small>건</small></strong>${dd ? arrow(dd.eod - dd.eodPrev, true) : ""}<p>${dd ? `어제(${dd.d.slice(5).replace("-", "/")}) 업무 마감 기준` : "지금 진행 중"}</p></div>`,
      `<div class="cx-big ${x.late ? "bad" : ""}"><span>처리 지연</span><strong>${fmt(x.late)}<small>건</small></strong><em class="${x.late ? "bf-bad" : "bf-good"}">진행 중의 ${pct(x.late, x.openN)}%</em><p>정해진 기간을 넘긴 건</p></div>`,
      `<div class="cx-big"><span>청약 → 성립 기간</span><strong>${x.lead ? r1(x.lead.p50) : "-"}<small>일</small></strong><em class="bf-flat">${x.lead ? `늦은 10%는 ${r1(x.lead.p90)}일 이상` : "성립 건 없음"}</em><p>고객이 기다리는 기간(중앙값)</p></div>`,
      `<div class="cx-big"><span>성립 대기 보험료</span><strong>${r1(x.prem.sum / 1e8)}<small>억원/월</small></strong><em class="bf-flat">고액 ${fmt(x.prem.hiN)}건이 ${pct(x.prem.hiSum, x.prem.sum)}%</em><p>지연 시 실적에 영향</p></div>`,
    ].join("");
    $("cx-risks").innerHTML = x.risks.length
      ? x.risks.map((r, i) => `<div class="cx-risk ${r.tone}"><span class="cx-no">${i + 1}</span><div><b>${r.title}</b>
          <dl><dt>영향</dt><dd>${r.impact}</dd><dt>조치</dt><dd>${r.action}</dd></dl></div></div>`).join("")
      : `<p class="cx-none">오늘 따로 챙길 일이 없습니다</p>`;
    $("cx-trend").innerHTML = sparkSvg(x.trend, "cx-spark", 96) + `<p class="cx-trend-note">${trendNote(x.trend)}${dd ? ` 어제 신규 <b>${fmt(dd.inN)}</b>건 · 성립 <b>${fmt(dd.ok)}</b>건.` : ""}</p>`;
    // 자동 성립률: 도넛 + 채널별 막대
    const st = x.stp, sp = st.ok ? (100 * st.auto) / st.ok : 0, R = 42, C = 2 * Math.PI * R;
    $("cx-stp").innerHTML = st.ok ? `<div class="cx-stp-top">
        <svg class="cx-donut" viewBox="0 0 110 110" role="img" aria-label="자동 성립률 ${r1(sp)}%">
          <circle class="track" cx="55" cy="55" r="${R}"/>
          <circle class="val" cx="55" cy="55" r="${R}" stroke-dasharray="${((sp / 100) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 55 55)"/>
          <text x="55" y="61" text-anchor="middle">${r1(sp)}%</text>
        </svg>
        <div><p class="cx-stp-big">성립 <b>${fmt(st.ok)}</b>건 중 <b>${fmt(st.auto)}</b>건이<br>심사자 없이 자동 성립</p>
          <p class="cx-stp-sub">심사 후 성립 ${fmt(st.ok - st.auto)}건 · 자동 성립이 늘수록 같은 인원으로 더 많이 처리</p></div>
      </div>
      <div class="cx-stp-bars">${st.ch.map(([ch, v, n]) =>
        `<div class="cx-stp-row"><span>${ch}</span><div class="cx-stp-track"><div style="width:${v}%"></div></div><b>${r1(v)}%</b></div>`).join("")}</div>`
      : `<p class="bf-note">조회 조건에 성립 건이 없습니다</p>`;
    $("cx-good").innerHTML = `<strong>잘 되고 있는 것</strong>${x.good.map((g) => `<span>${g}</span>`).join('<span aria-hidden="true">·</span>')}`;
  }
  $("cx-more").addEventListener("click", () => {
    const open = $("bf-detail").hidden;
    $("bf-detail").hidden = !open;
    $("cx-more").setAttribute("aria-expanded", open);
    $("cx-more").innerHTML = open ? '접기 <span aria-hidden="true">▴</span>' : '펼치기 <span aria-hidden="true">▾</span>';
  });

  // 브리핑 보고서(report.js)가 쓰는 계산 결과
  window.briefData = (rows) => {
    const dd = dayDelta(rows);
    const open = rows.filter(isOpen), hi = open.filter((c) => c.premium >= HIGH_PREMIUM);
    const ok = rows.filter((c) => c.status === "성립"), auto = ok.filter((c) => !went(c, "심사중")).length;
    const lt = ok.filter((c) => c.leadTime != null).map((c) => c.leadTime);
    const prods = [...new Set(rows.map((c) => c.product))].map((p) => ({ k: p, ...rate(rows.filter((c) => c.product === p)) }));
    return {
      SLA_TARGET, HIGH_PREMIUM, SMALL_SAMPLE, r1, won,
      lines: briefLines(rows, dd), dd,
      prem: { n: open.length, sum: open.reduce((a, c) => a + c.premium, 0), hiN: hi.length, hiSum: hi.reduce((a, c) => a + c.premium, 0) },
      sla: slaData(rows), uw: uwData(rows),
      stp: { ok: ok.length, auto, ch: CHANNELS.filter((ch) => !Q.channel || ch === Q.channel).map((ch) => {
        const l = ok.filter((c) => c.channel === ch); return l.length ? [ch, (100 * l.filter((c) => !went(c, "심사중")).length) / l.length] : null; }).filter(Boolean) },
      lead: lt.length ? { n: lt.length, p50: quant(lt, 0.5), p90: quant(lt, 0.9), mean: avg(lt) } : null,
      quality: { all: rate(rows), topS: prods.filter((p) => p.supp != null).sort((a, b) => b.supp - a.supp).slice(0, 3), topB: prods.slice().sort((a, b) => b.back - a.back).slice(0, 3) },
      actions: ACTIONS.map((a) => ({ key: a.key, label: a.label, list: rows.filter(a.test).sort((x, y) => (y.dwell ?? 0) - (x.dwell ?? 0)) })),
      owner, elapsed, exec: execData(rows), sparkSvg, trendNote, SIGNAL,
    };
  };


  // ── 대시보드 탭 상단: 오늘 상태 · 핵심 숫자 5칸 · 청약 건수 구성 · 오늘 챙길 것 · 채널별 현황 ──
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  function renderDashTop(rows) {
    const x = execData(rows), dd = x.dd;
    const d = new Date(`${DATA.asOf.slice(0, 10)}T00:00:00Z`);
    // 오늘 상태(브리핑 결론)는 브리핑 탭에만 둠 → 대시보드에는 그리지 않음
    if ($("dx-hero")) $("dx-hero").innerHTML = `<div>
        <p class="dx-eyebrow">${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${WEEK[d.getUTCDay()]}요일 아침 브리핑 <span class="dx-status"><i></i>${SIGNAL[x.signal]}</span></p>
        <h2>${x.head.replace(/(\d+(?:\.\d+)?%)/, "<em>$1</em>")}</h2>
        <p>${x.sub}</p>
      </div>
      <svg class="dx-art" viewBox="0 0 200 110" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path class="f" d="M30 30 C55 18 80 20 100 32 C120 20 145 18 170 30 L170 92 C145 80 120 82 100 94 C80 82 55 80 30 92 Z"/>
        <path d="M30 30 C55 18 80 20 100 32 C120 20 145 18 170 30 L170 92 C145 80 120 82 100 94 C80 82 55 80 30 92 Z M100 32 V94"/>
        <path d="M44 44 C58 39 72 40 86 46 M44 58 C58 53 72 54 86 60 M114 46 C128 40 142 39 156 44 M114 60 C128 54 142 53 156 58"/>
        <path d="M178 14 l3 6 6 1 -5 4 1 6 -5 -3 -5 3 1 -6 -5 -4 6 -1 z"/><circle cx="16" cy="18" r="4"/>
      </svg>`;

    const days = BIZ_DAYS.filter((v) => (!Q.from || v >= Q.from) && (!Q.to || v <= Q.to)).length;
    const st = x.stp, sp = st.ok ? (100 * st.auto) / st.ok : null;
    const k = (label, value, unit, note, cls = "") => `<div class="dx-kpi ${cls}"><span>${label}</span><strong>${value}<small>${unit}</small></strong><p>${note}</p></div>`;
    $("dx-kpis").innerHTML = [
      k("청약 건수", fmt(rows.length), "건", `${days}영업일 누적`),
      k("처리 중", fmt(dd ? dd.eod : x.openN), "건", dd ? (dd.eod === dd.eodPrev ? "전일과 같음" : `<b class="${dd.eod > dd.eodPrev ? "up" : "good"}">${dd.eod > dd.eodPrev ? "▲" : "▼"} ${fmt(Math.abs(dd.eod - dd.eodPrev))}</b> 전일 대비`) : "지금 진행 중"),
      k("처리 지연", fmt(x.late), "건", `진행 중의 ${pct(x.late, x.openN)}%`, x.late ? "bad" : ""),
      k("청약 → 성립", x.lead ? r1(x.lead.p50) : "-", "일", x.lead ? `늦은 10%는 ${r1(x.lead.p90)}일 이상` : "성립 건 없음"),
      k("자동 성립률", sp == null ? "-" : r1(sp), "%", st.ok ? `<b class="good">성립 ${fmt(st.ok)}건 중 ${fmt(st.auto)}건</b>` : "성립 건 없음"),
    ].join("");

    // 청약 건수 구성: 다섯 칸의 합 = 청약 건수
    const cnt = (s) => rows.filter((c) => c.status === s).length;
    const open = rows.filter((c) => isOpen(c) && c.status !== "청약완료");
    const parts = [
      ["스캔 전", cnt("청약완료"), "m-wait"], ["진행중", open.length, "m-ok"], ["성립", cnt("성립"), "m-review"],
      ["반송", cnt("반송"), "m-back"], ["확인필요", cnt("확인필요"), "m-check"],
    ];
    $("dx-comp-hint").innerHTML = `<span id="dx-total" class="dx-total">${fmt(rows.length)}</span>건 = 아래 다섯 칸의 합`;
    $("dx-comp").innerHTML = `<div class="dx-stack" role="img" aria-label="${parts.map(([n, v]) => `${n} ${fmt(v)}건`).join(", ")}">${
        parts.filter(([, v]) => v).map(([n, v, cls]) => `<div class="${cls}" style="flex:${v}" title="${n} ${fmt(v)}건"></div>`).join("")}</div>
      <div class="dx-legend">${parts.map(([n, v, cls]) => `<div><span><i class="sw ${cls}"></i>${n}</span><strong>${fmt(v)}</strong><em>${pct(v, rows.length)}%</em></div>`).join("")}</div>
      <div class="dx-pips">진행중 ${fmt(open.length)}건 =
        ${[["심사중", "심사중"], ["보완의뢰", "보완중"], ["모니터링", "모니터링대기"], ["배정 대기", "스캔완료"], ["성립 대기", "성립대기"]]
          .map(([n, s]) => `<span>${n} <b>${fmt(cnt(s))}</b></span>`).join("")}</div>`;

    $("dx-risk-n").textContent = `${x.risks.length}건`;
    $("dx-risks").innerHTML = x.risks.length
      ? x.risks.map((r, i) => `<div class="dx-risk"><span class="no">${i + 1}</span><div><b>${r.title}</b><p>${r.action}</p></div><span class="dx-tag ${r.tone}">${r.tone === "bad" ? "지연" : "주의"}</span></div>`).join("")
      : `<p class="cx-none">오늘 따로 챙길 일이 없습니다</p>`;

    // 채널별 현황 + 잔량 추세
    const chans = CHANNELS.filter((ch) => !Q.channel || ch === Q.channel).map((ch) => {
      const l = rows.filter((c) => c.channel === ch);
      return [ch, l.length, l.filter((c) => isOpen(c) && c.status !== "청약완료").length, l.filter((c) => c.status === "반송").length, l.filter((c) => c.status === "성립").length];
    });
    $("dx-chan").innerHTML = `<div class="table-wrap"><table class="dx-table"><thead><tr><th>채널</th><th>청약</th><th>진행중</th><th>반송</th><th>성립률</th></tr></thead><tbody>${
        chans.map(([ch, n, o, b, ok]) => `<tr><td>${ch}</td><td>${fmt(n)}</td><td>${fmt(o)}</td><td>${fmt(b)}</td><td><b>${pct(ok, n)}%</b></td></tr>`).join("")
      }</tbody></table></div>`; // 잔량 추세는 06 일별 추이에 있으므로 여기서는 표만
  }

  let lastRows = [];
  window.renderBrief = (rows) => {
    lastRows = rows;
    const dd = dayDelta(rows);
    renderExec(rows);
    renderDashTop(rows);
    $("bf-delta").innerHTML = dd
      ? `<p class="bf-sub">${dd.d} 마감 기준 · 전 영업일 ${dd.d0}</p><div class="bf-tiles">
          ${tile("신규 청약", dd.inN, dd.inPrev, null)}
          ${tile("성립 처리", dd.ok, dd.okPrev, false)}
          ${tile("마감 잔량", dd.eod, dd.eodPrev, true)}</div>`
      : `<p class="bf-note">조회 기간이 2영업일 이상이어야 비교할 수 있습니다</p>`;
    $("bf-premium").innerHTML = premium(rows);
    $("bf-sla").innerHTML = slaRates(rows);
    $("bf-uw").innerHTML = reviewers(rows);
    $("bf-stp").innerHTML = stp(rows);
    $("bf-lead").innerHTML = leadDist(rows);
    $("bf-quality").innerHTML = quality(rows);
    $("bf-actions").innerHTML = actions(rows);
    $("bf-cond").textContent = `기준시각 ${DATA.asOf} · 청약일 ${Q.from} ~ ${Q.to}${Q.channel ? ` · ${Q.channel}` : ""}${Q.branch ? ` · ${Q.branch}` : ""}${Q.product ? ` · ${Q.product}` : ""}`;
  };
  $("bf-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    actionKey = b.dataset.act;
    $("bf-actions").innerHTML = actions(lastRows);
    $("bf-actions").querySelector(`[data-act="${actionKey}"]`)?.focus();
  });
  if (Q.from) window.renderBrief(baseFiltered()); // dashboard.js의 첫 조회가 이미 끝났으면 바로 그림
})();

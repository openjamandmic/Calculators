/* Variable Speed Pump Calculator — ANSI/APSP-15 worksheet (V13, no flow lookup)
   The math is kept in PumpCalc.calc() so it can be checked on its own; the rest is display. */
(function (root) {
  "use strict";

  // Pipe size (in) → maximum GPM at 6 FPS and at 8 FPS.
  const PIPE = [
    { size: 1,   gpm6: 16,  gpm8: 21 },
    { size: 1.5, gpm6: 37,  gpm8: 50 },
    { size: 2,   gpm6: 62,  gpm8: 82 },
    { size: 2.5, gpm6: 88,  gpm8: 117 },
    { size: 3,   gpm6: 136, gpm8: 181 },
    { size: 4,   gpm6: 234, gpm8: 313 },
    { size: 6,   gpm6: 534, gpm8: 712 }
  ];

  const FILTERS = {
    cartridge: [
      ["CS100", 100, 100], ["CS150", 150, 125], ["CS200", 200, 125], ["CS250", 250, 125],
      ["CV340", 340, 127], ["CV460", 460, 150], ["CV580", 580, 150],
      ["CL340", 340, 127], ["CL460", 460, 150], ["CL580", 580, 150]
    ],
    sand: [
      ["JS60-SM", 3.14, 63], ["JS100-SM", 4.9, 98], ["SFSM60", 3.15, 63], ["SFSM100", 5, 100], ["SFSM100F", 5, 100],
      ["SFSM120", 5.9, 118], ["SFSM120F", 5.9, 118], ["SFSM140", 7.06, 141], ["SFSM140F", 7.06, 141],
      ["SFTM22-1.5", 2.6, 50], ["SFTM24-2.0", 3.04, 60],
      ["SFHT3461", 13.5, 203], ["SFHT3472", 15.3, 230], ["SFHT3484", 19.3, 290],
      ["SFHT4272", 21, 315], ["SFHT4284", 23, 345], ["SFHT4296", 26, 390]
    ],
    de: [["DEV48", 48, 96], ["DEV60", 60, 120]]
  };

  // 2400 RPM performance curves read from the published charts: [GPM, TDH ft] from shut-off to the
  // end of the printed line. Read to about ±1 ft, so a flowmeter reading always wins when there is one.
  const CURVES = {
    VSFHP130DVSP:   [[0, 29], [10, 28.5], [20, 27.5], [30, 25.5], [40, 23], [50, 19], [60, 13.5], [65, 9.5]],
    VSFHP165DVSP:   [[0, 35.5], [10, 35], [20, 34], [30, 32], [40, 29.5], [50, 26.5], [60, 23], [70, 19], [80, 14], [83, 12]],
    VSFHP185DVSP:   [[0, 38.5], [10, 38], [20, 37], [30, 35], [40, 32], [50, 29], [60, 26], [70, 22], [80, 17.5]],
    VSFHP185DV2ASP: [[0, 38], [10, 37.5], [20, 36.5], [30, 35.5], [40, 33.5], [50, 31], [60, 29], [70, 26], [80, 23.5], [90, 20.5], [100, 18.5]],
    VSFHP270DV2ASP: [[0, 48.5], [10, 47.5], [20, 46], [30, 44], [40, 42.5], [50, 40.5], [60, 38], [70, 35.5], [80, 32], [90, 28.5], [100, 24], [110, 18.5]],
    VSFHP3802ASP:   [[0, 50], [20, 48.5], [40, 46], [60, 42], [80, 37], [100, 31], [120, 24], [130, 19.5], [140, 10]],
    VSPHP270DV2ASP: [[0, 42.5], [20, 42.5], [40, 41.5], [50, 40], [60, 38], [70, 35], [80, 32], [90, 28], [100, 24.5], [110, 19.5], [113, 16.5]],
    VSSHP270DV2ASP: [[0, 41], [20, 41], [30, 40.5], [40, 40], [50, 38.5], [60, 36.5], [70, 33.5], [80, 30.5], [90, 27], [100, 22], [105, 18.5]],
    VSSHP3802ASP:   [[0, 49.5], [20, 49], [40, 47], [60, 44], [80, 39.5], [100, 34], [120, 27], [130, 22], [140, 13]]
  };

  // Flow at 2400 RPM for a given TDH, from a model's curve. status: ok | above (TDH higher than the
  // pump can make at 2400) | beyond (TDH below the end of the printed line; flow is past the chart).
  function flowFromCurve(model, tdh) {
    const c = CURVES[model];
    if (!c || !Number.isFinite(tdh)) return { gpm: NaN, status: "none" };
    if (tdh > c[0][1]) return { gpm: NaN, status: "above", shutoff: c[0][1] };
    const end = c[c.length - 1];
    if (tdh < end[1]) return { gpm: end[0], status: "beyond", endGpm: end[0], endTdh: end[1] };
    for (let k = 1; k < c.length; k++) {
      const [g0, h0] = c[k - 1], [g1, h1] = c[k];
      if (tdh <= h0 && tdh >= h1) {
        const t = h0 === h1 ? 1 : (h0 - tdh) / (h0 - h1);
        return { gpm: g0 + (g1 - g0) * t, status: "ok" };
      }
    }
    return { gpm: NaN, status: "none" };
  }

  const RPM_MAX = 3450, RPM_MIN = 600, REF_RPM = 2400;
  const LARGER = "You need a larger pump", SMALLER = "You need a smaller pump";

  // Smallest pipe whose limit is above the flow (the worksheet uses "flow < limit").
  function minPipe(gpm, fps) {
    if (!Number.isFinite(gpm)) return NaN;
    for (const p of PIPE) { if (gpm < (fps === 6 ? p.gpm6 : p.gpm8)) return p.size; }
    return null; // beyond the chart
  }
  function pipeLimit(size, fps) {
    const p = PIPE.find((r) => r.size === size);
    return p ? (fps === 6 ? p.gpm6 : p.gpm8) : NaN;
  }

  // RPM needed for a flow; carries the worksheet's "wrong size pump" messages.
  function rpmFor(gpm, measured) {
    const rpm = (REF_RPM / measured) * gpm;
    if (rpm > RPM_MAX) return { ok: false, rpm, text: LARGER };
    if (rpm < RPM_MIN) return { ok: false, rpm, text: SMALLER };
    return { ok: true, rpm, text: null };
  }

  // Max RPM allowed by a pipe limit (worksheet B32/B33).
  function maxRpmFor(limitGpm, measured, rpmMin) {
    if (!rpmMin.ok && rpmMin.text === LARGER) return { ok: false, rpm: NaN, text: LARGER };
    const r = (REF_RPM / measured) * limitGpm;
    const floor = rpmMin.ok ? rpmMin.rpm : RPM_MIN;
    if (r < floor) return { ok: true, rpm: floor + 10, text: null, note: "Pipe limit is below the minimum speed; set 10 RPM above minimum." };
    if (r > RPM_MAX) return { ok: true, rpm: RPM_MAX, text: null, capped: true };
    if (r < RPM_MIN) return { ok: false, rpm: r, text: SMALLER };
    return { ok: true, rpm: r, text: null };
  }

  function calc(i) {
    const o = {};
    const v = i.volume, m = i.gpm2400;
    // Flow (worksheet D6, D7)
    o.minFlow = v < 13000 ? 40 : Math.max(40, v / 720);
    o.peakFlow = v < 13000 ? 40 : v / 360;
    // TDH (B12)
    o.tdh = i.vacuum * 1.13 + i.psi * 2.31;
    // Pump capacity (B30)
    o.pumpMaxGpm = (m / REF_RPM) * RPM_MAX;
    o.gpmPer100Rpm = (m / REF_RPM) * 100;
    // Pipe sizing for peak flow (B23, B24, B26)
    o.minSuction6 = minPipe(o.peakFlow, 6);
    o.minPressure6 = minPipe(o.peakFlow, 6);
    o.minPressure8 = minPipe(o.peakFlow, 8);
    // Existing pipe limits (B28, B29)
    o.maxGpmPressure = pipeLimit(i.pressure, 8);
    o.maxGpmSuction = pipeLimit(i.suction, 6);
    // Speeds (B18–B21)
    o.rpmMin = rpmFor(o.minFlow, m);
    o.rpmPeak = rpmFor(o.peakFlow, m);
    o.rpmHeater = rpmFor(70, m);
    o.rpmHeatPump = rpmFor(55, m);
    // Max speeds (B32–B34)
    o.maxRpmPressure = maxRpmFor(o.maxGpmPressure, m, o.rpmMin);
    o.maxRpmSuction = maxRpmFor(o.maxGpmSuction, m, o.rpmMin);
    o.maxRpmAop = Math.min(RPM_MAX, (REF_RPM / m) * 90);
    const candidates = [o.maxRpmPressure, o.maxRpmSuction].filter((r) => r.ok).map((r) => r.rpm).concat([o.maxRpmAop]);
    o.rpmMaxRec = Math.min.apply(null, candidates);
    o.rpmMaxSource = !Number.isFinite(o.rpmMaxRec) ? "" : o.rpmMaxRec === o.maxRpmAop ? "90 GPM AOP limit"
      : (o.maxRpmPressure.ok && o.rpmMaxRec === o.maxRpmPressure.rpm) ? "8 FPS in the pressure pipe" : "6 FPS in the suction pipe";
    // Pipe needed for heater flows (B36–B40)
    o.heaterSuction6 = minPipe(70, 6);
    o.heaterPressure8 = minPipe(70, 8);
    o.heatPumpSuction6 = minPipe(55, 6);
    o.heatPumpPressure8 = minPipe(55, 8);
    // Warnings (C19–C21)
    o.flagPeak = o.rpmPeak.ok && o.maxRpmSuction.ok && o.rpmPeak.rpm > o.maxRpmSuction.rpm;
    o.flagHeater = o.heaterSuction6 > i.suction || o.heaterPressure8 > i.pressure;
    o.flagHeatPump = o.heatPumpSuction6 > i.suction || o.heatPumpPressure8 > i.pressure;
    // Operating cost (B52, B53)
    const ampsMin = i.ampsMinL2 === 0 ? i.ampsMinL1 : (i.ampsMinL1 + i.ampsMinL2) / 2;
    const ampsMax = i.ampsMaxL2 === 0 ? i.ampsMaxL1 : (i.ampsMaxL1 + i.ampsMaxL2) / 2;
    o.wattsMin = ampsMin * i.volts;
    o.wattsMax = ampsMax * i.volts;
    o.costMin = (o.wattsMin / 1000) * i.kwh;
    o.costMax = (o.wattsMax / 1000) * i.kwh;
    if (Number.isFinite(i.hoursMin) || Number.isFinite(i.hoursMax)) {
      const hMin = Number.isFinite(i.hoursMin) ? i.hoursMin : 0, hMax = Number.isFinite(i.hoursMax) ? i.hoursMax : 0;
      o.costDay = o.costMin * hMin + o.costMax * hMax;
    }
    // Filter sizing (B56–B58): based on the larger pipe limit
    o.sqftBasis = Math.max(o.maxGpmPressure, o.maxGpmSuction);
    o.sqftWhich = o.maxGpmPressure >= o.maxGpmSuction ? "pressure pipe at 8 FPS" : "suction pipe at 6 FPS";
    o.sqftCart = o.sqftBasis * 0.375;
    o.sqftSand = o.sqftBasis / 15;
    o.sqftDe = o.sqftBasis / 2;
    // Filter tables
    o.filters = {};
    for (const type of Object.keys(FILTERS)) {
      const need = type === "cartridge" ? o.sqftCart : type === "sand" ? o.sqftSand : o.sqftDe;
      o.filters[type] = FILTERS[type].map(([model, sqft, gpm]) => ({
        model, sqft, gpm,
        maxRpm: Math.min(RPM_MAX, (REF_RPM / m) * gpm),
        ansi: gpm > o.maxGpmPressure && sqft > need,
        pumpMax: gpm > o.pumpMaxGpm
      }));
    }
    return o;
  }

  root.PumpCalc = { calc, flowFromCurve, CURVES, PIPE, FILTERS, LARGER, SMALLER };
  if (typeof module !== "undefined" && module.exports) module.exports = root.PumpCalc;
})(typeof window !== "undefined" ? window : globalThis);

/* ---------------- page wiring ---------------- */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  const { fmt, num, setText, remember, copyText, toast } = window.FP;
  const { calc, LARGER } = window.PumpCalc;

  const IDS = ["volume", "suction", "pressure", "vacuum", "psi", "model", "gpm2400", "volts", "kwh",
    "ampsMinL1", "ampsMinL2", "ampsMaxL1", "ampsMaxL2", "hoursMin", "hoursMax"];
  const store = remember("fp-pump-v1", IDS);
  let filterType = "cartridge";
  let last = null;
  let flowSource = "curve"; // "curve" or "meter"
  try { if (localStorage.getItem("fp-pump-flowsrc") === "meter") flowSource = "meter"; } catch (e) { /* ignore */ }
  const { flowFromCurve, CURVES } = window.PumpCalc;

  // Fill the flow field from the model's curve when that is the chosen source.
  function applyCurve() {
    const model = document.getElementById("model").value;
    const hasCurve = !!CURVES[model];
    const gpmEl = document.getElementById("gpm2400");
    const hint = document.getElementById("flowHint");
    const useCurve = flowSource === "curve" && hasCurve;
    gpmEl.readOnly = useCurve;
    document.getElementById("srcCurve").disabled = !hasCurve;
    document.getElementById("srcCurve").setAttribute("aria-pressed", String(useCurve));
    document.getElementById("srcMeter").setAttribute("aria-pressed", String(!useCurve));
    let look = { status: "none", gpm: NaN };
    if (useCurve) {
      const tdh = num("vacuum") * 1.13 + num("psi") * 2.31;
      look = flowFromCurve(model, tdh);
      gpmEl.value = Number.isFinite(look.gpm) ? String(Math.round(look.gpm)) : "";
      if (look.status === "ok") hint.textContent = model + " curve @ " + fmt.dec(tdh, 1) + " ft TDH. Switch to Flowmeter to enter a measured value.";
      else if (look.status === "above") hint.textContent = "TDH " + fmt.dec(tdh, 1) + " ft exceeds the 2400 RPM shut-off head (" + look.shutoff + " ft). Check gauges.";
      else if (look.status === "beyond") hint.textContent = "TDH " + fmt.dec(tdh, 1) + " ft is below the end of the printed curve (" + look.endGpm + " GPM @ " + look.endTdh + " ft). Flow ≥ " + look.endGpm + " GPM; confirm with a flowmeter.";
      else hint.textContent = "Enter vacuum and pressure; flow is read off the " + model + " curve.";
    } else if (hasCurve) {
      hint.textContent = "Flowmeter reading. Switch to Pump curve to use the " + model + " curve.";
    } else {
      hint.textContent = model === "other" ? "No curve on file: enter flow from a flowmeter or the pump's curve at the TDH shown." : "Select a model or enter a flowmeter reading.";
    }
    return look;
  }

  function drawCurve(model, tdh, gpm) {
    const box = document.getElementById("curveBox");
    const c = CURVES[model];
    if (!c) { box.hidden = true; return; }
    box.hidden = false;
    setText("curveTitle", model);
    const W = 420, H = 220, L = 42, R = 12, T = 14, B = 34;
    const maxG = Math.ceil((c[c.length - 1][0] + 10) / 20) * 20, maxH = Math.ceil((c[0][1] + 5) / 10) * 10;
    const x = (g) => L + (g / maxG) * (W - L - R), y = (h) => T + (1 - h / maxH) * (H - T - B);
    let svg = "";
    for (let g = 0; g <= maxG; g += 20) svg += `<line class="grid" x1="${x(g)}" y1="${T}" x2="${x(g)}" y2="${H - B}"/><text class="tick" x="${x(g)}" y="${H - B + 14}" text-anchor="middle">${g}</text>`;
    for (let h = 0; h <= maxH; h += 10) svg += `<line class="grid" x1="${L}" y1="${y(h)}" x2="${W - R}" y2="${y(h)}"/><text class="tick" x="${L - 6}" y="${y(h) + 3.5}" text-anchor="end">${h}</text>`;
    svg += `<line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/><line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>`;
    svg += `<text class="lbl" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">Flow, GPM</text>`;
    svg += `<text class="lbl" transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">TDH, ft</text>`;
    svg += `<polyline class="line" points="${c.map(([g, h]) => x(g) + "," + y(h)).join(" ")}"/>`;
    if (Number.isFinite(tdh) && Number.isFinite(gpm)) {
      svg += `<line class="guide" x1="${L}" y1="${y(tdh)}" x2="${x(gpm)}" y2="${y(tdh)}"/><line class="guide" x1="${x(gpm)}" y1="${y(tdh)}" x2="${x(gpm)}" y2="${H - B}"/>`;
      svg += `<circle class="pt" cx="${x(gpm)}" cy="${y(tdh)}" r="6"/>`;
      const tx = x(gpm) + 10 > W - 80 ? x(gpm) - 10 : x(gpm) + 10, ta = x(gpm) + 10 > W - 80 ? "end" : "start";
      svg += `<text class="ptlbl" x="${tx}" y="${y(tdh) - 10}" text-anchor="${ta}">${Math.round(gpm)} GPM @ ${fmt.dec(tdh, 1)} ft</text>`;
    }
    document.getElementById("curveSvg").innerHTML = svg;
    setText("curveNote", Number.isFinite(tdh) && Number.isFinite(gpm) ? "Operating point at 2400 RPM from the gauge readings." : Number.isFinite(tdh) ? "A TDH of " + fmt.dec(tdh, 1) + " ft is off this curve." : "Enter the vacuum and pressure readings to place the operating point.");
  }

  // Blank fields stay NaN and their results show as "—"; a blank L2 reading counts as 0 (single-leg pump).
  function inputs() {
    const n = (id) => num(id);
    const amps = (id) => { const x = num(id); return Number.isFinite(x) ? x : 0; };
    const g = n("gpm2400");
    return {
      volume: n("volume"), suction: n("suction"), pressure: n("pressure"),
      vacuum: n("vacuum"), psi: n("psi"), gpm2400: g > 0 ? g : NaN,
      volts: n("volts"), kwh: n("kwh"),
      ampsMinL1: n("ampsMinL1"), ampsMinL2: amps("ampsMinL2"), ampsMaxL1: n("ampsMaxL1"), ampsMaxL2: amps("ampsMaxL2"),
      hoursMin: num("hoursMin"), hoursMax: num("hoursMax"),
      model: document.getElementById("model").value
    };
  }

  function rpmText(r) { return r.ok ? (Number.isFinite(r.rpm) ? fmt.int(r.rpm) + " RPM" : "—") : r.text; }
  function setRpm(id, r) {
    const el = document.getElementById(id);
    el.textContent = rpmText(r);
    el.classList.toggle("is-text", !r.ok);
  }
  function setFlag(id, show, text) {
    const el = document.getElementById(id);
    el.hidden = !show;
    if (show) el.textContent = text;
  }
  function tile(id, r, bad) {
    const el = document.getElementById(id);
    const t = el.closest(".tile");
    if (typeof r === "number") { el.innerHTML = Number.isFinite(r) ? fmt.int(r) + "<small>RPM</small>" : "—"; t.classList.remove("is-bad"); return; }
    if (r.ok) { el.innerHTML = Number.isFinite(r.rpm) ? fmt.int(r.rpm) + "<small>RPM</small>" : "—"; t.classList.remove("is-bad"); }
    else { el.textContent = r.text; t.classList.add("is-bad"); }
  }

  function render() {
    applyCurve();
    const i = inputs();
    const o = calc(i);
    last = { i, o };

    // hero
    const complete = [i.volume, i.suction, i.pressure, i.gpm2400].every(Number.isFinite);
    setText("heroNote", complete
      ? fmt.int(i.volume) + " gal · " + fmt.pipe(i.suction) + " suct / " + fmt.pipe(i.pressure) + " press · " + fmt.int(i.gpm2400) + " GPM @ 2400" + (flowSource === "curve" && CURVES[i.model] ? " (curve)" : " (meter)")
      : "Needs volume, pipe sizes and flow @ 2400 RPM. Entries are saved on this device.");
    tile("tMin", o.rpmMin);
    tile("tMax", o.rpmMaxRec);
    setText("tMaxSub", o.rpmMaxSource ? "Set by " + o.rpmMaxSource : "Lowest of the pipe and AOP limits");
    tile("tPeak", o.rpmPeak); tile("tHeater", o.rpmHeater); tile("tHeatPump", o.rpmHeatPump);
    const maxGpm = Math.min(o.maxGpmPressure, o.maxGpmSuction);
    document.getElementById("tMaxGpm").innerHTML = Number.isFinite(maxGpm) ? fmt.int(maxGpm) + "<small>GPM</small>" : "—";
    setText("tMaxGpmSub", !Number.isFinite(maxGpm) ? "Limited by pipe velocity" : o.maxGpmPressure <= o.maxGpmSuction ? "8 FPS in the pressure pipe" : "6 FPS in the suction pipe");

    // step 1
    setText("minFlow", fmt.int(o.minFlow)); setText("peakFlow", fmt.int(o.peakFlow));
    const over = (s, fps) => s === null ? "See chart (over " + (fps === 6 ? 534 : 712) + " GPM)" : fmt.pipe(s);
    setText("minSuction6", over(o.minSuction6, 6)); setText("minPressure6", over(o.minPressure6, 6)); setText("minPressure8", over(o.minPressure8, 8));
    setText("lblSuction", fmt.pipe(i.suction)); setText("lblPressure", fmt.pipe(i.pressure));
    setText("maxGpmSuction", fmt.int(o.maxGpmSuction)); setText("maxGpmPressure", fmt.int(o.maxGpmPressure));

    // step 2
    setText("tdh", fmt.dec(o.tdh, 1)); setText("pumpMaxGpm", fmt.int(o.pumpMaxGpm)); setText("gpmPerRpm", fmt.dec(o.gpmPer100Rpm, 2));
    drawCurve(i.model, o.tdh, i.gpm2400);

    // step 3
    setRpm("rpmMin", o.rpmMin); setRpm("rpmPeak", o.rpmPeak); setRpm("rpmHeater", o.rpmHeater); setRpm("rpmHeatPump", o.rpmHeatPump);
    const tooSmall = "Your pipe is too small for ANSI-15 compliance at this speed.";
    setFlag("flagPeak", o.flagPeak, tooSmall + " Peak flow exceeds 6 FPS in the " + fmt.pipe(i.suction) + " suction pipe.");
    setFlag("flagHeater", o.flagHeater, tooSmall + " 70 GPM needs at least " + fmt.pipe(o.heaterSuction6) + " suction and " + fmt.pipe(o.heaterPressure8) + " pressure pipe.");
    setFlag("flagHeatPump", o.flagHeatPump, tooSmall + " 55 GPM needs at least " + fmt.pipe(o.heatPumpSuction6) + " suction and " + fmt.pipe(o.heatPumpPressure8) + " pressure pipe.");
    setRpm("maxRpmPressure", o.maxRpmPressure); setRpm("maxRpmSuction", o.maxRpmSuction);
    setText("maxRpmAop", Number.isFinite(o.maxRpmAop) ? fmt.int(o.maxRpmAop) + " RPM" : "—");
    setText("rpmMaxRec", Number.isFinite(o.rpmMaxRec) ? fmt.int(o.rpmMaxRec) + " RPM" : "—");
    const notes = [];
    if (o.maxRpmPressure.note) notes.push("Pressure pipe: " + o.maxRpmPressure.note);
    if (o.maxRpmSuction.note) notes.push("Suction pipe: " + o.maxRpmSuction.note);
    if (!o.rpmMin.ok && o.rpmMin.text === LARGER) notes.push("The pump cannot reach the minimum flow at full speed, so the maximum speed limits do not apply until a larger pump is installed.");
    setFlag("flagMax", notes.length > 0, notes.join(" "));
    setText("pipeHeater", fmt.pipe(o.heaterSuction6) + " / " + fmt.pipe(o.heaterPressure8));
    setText("pipeHeatPump", fmt.pipe(o.heatPumpSuction6) + " / " + fmt.pipe(o.heatPumpPressure8));

    // step 4
    setText("wMin", fmt.int(o.wattsMin)); setText("wMax", fmt.int(o.wattsMax));
    setText("costMin", fmt.money(o.costMin, 3)); setText("costMax", fmt.money(o.costMax, 2));
    const daily = document.getElementById("dailyBlock");
    daily.hidden = !Number.isFinite(o.costDay);
    if (Number.isFinite(o.costDay)) {
      setText("costDay", fmt.money(o.costDay)); setText("costMonth", fmt.money(o.costDay * 30)); setText("costYear", fmt.money(o.costDay * 365, 0));
    }

    // step 5
    setText("sqftBasis", fmt.int(o.sqftBasis)); setText("sqftWhich", o.sqftWhich);
    setText("sqftCart", fmt.int(o.sqftCart)); setText("sqftSand", fmt.dec(o.sqftSand, 1)); setText("sqftDe", fmt.int(o.sqftDe));
    renderFilters(o);
    store.save();
  }

  function renderFilters(o) {
    const tbody = document.querySelector("#filterTable tbody");
    const rows = o.filters[filterType];
    const haveFlow = Number.isFinite(o.pumpMaxGpm), havePipe = Number.isFinite(o.maxGpmPressure) && Number.isFinite(o.sqftBasis);
    tbody.innerHTML = rows.map((f) => {
      const cls = (havePipe && f.ansi) ? "is-fit" : (havePipe && haveFlow && !f.pumpMax && !f.ansi ? "is-dim" : "");
      const sq = filterType === "cartridge" ? fmt.int(f.sqft) : fmt.dec(f.sqft, 2);
      const fit = !havePipe ? '<span class="pill">Needs pipe sizes</span>' : f.ansi ? '<span class="pill ok">Fits</span>' : '<span class="pill">Too small</span>';
      const cap = !haveFlow ? '<span class="pill">Needs measured flow</span>' : f.pumpMax ? '<span class="pill ok">No cap needed</span>' : '<span class="pill warn">Cap at ' + fmt.int(f.maxRpm) + ' RPM</span>';
      return `<tr class="${cls}"><td>${f.model}</td><td class="n">${sq}</td><td class="n">${fmt.int(f.gpm)}</td><td class="n">${fmt.int(f.maxRpm)}</td><td>${fit}</td><td>${cap}</td></tr>`;
    }).join("");
  }

  function summary() {
    if (!last) return "";
    const { i, o } = last;
    const r = (x) => rpmText(x);
    const L = [];
    L.push("VARIABLE SPEED PUMP — ANSI/APSP-15 WORKSHEET");
    L.push("Pool volume: " + fmt.int(i.volume) + " gal · Suction pipe: " + fmt.pipe(i.suction) + " · Pressure pipe: " + fmt.pipe(i.pressure));
    L.push("Pump: " + (i.model || "not selected") + " · " + fmt.int(i.gpm2400) + " GPM at 2400 RPM (" + (flowSource === "curve" && CURVES[i.model] ? "from pump curve" : "flowmeter") + ") · TDH " + fmt.dec(o.tdh, 1) + " ft (" + i.vacuum + " in Hg, " + i.psi + " psi)");
    L.push("");
    L.push("Minimum flow (2 turnovers): " + fmt.int(o.minFlow) + " GPM → " + r(o.rpmMin) + "  (set as minimum RPM)");
    L.push("Peak use flow (4 turnovers): " + fmt.int(o.peakFlow) + " GPM → " + r(o.rpmPeak) + (o.flagPeak ? "  ⚠ pipe too small at this speed" : ""));
    L.push("Gas heater 70 GPM → " + r(o.rpmHeater) + (o.flagHeater ? "  ⚠ pipe too small" : ""));
    L.push("Heat pump 55 GPM → " + r(o.rpmHeatPump) + (o.flagHeatPump ? "  ⚠ pipe too small" : ""));
    L.push("Max RPM: pressure pipe 8 FPS " + r(o.maxRpmPressure) + " · suction pipe 6 FPS " + r(o.maxRpmSuction) + " · AOP 90 GPM " + fmt.int(o.maxRpmAop) + " RPM");
    L.push("RECOMMENDED MAXIMUM RPM: " + fmt.int(o.rpmMaxRec) + " (" + o.rpmMaxSource + ")");
    L.push("");
    L.push("Max flow allowed: " + fmt.int(o.maxGpmPressure) + " GPM (pressure, 8 FPS) · " + fmt.int(o.maxGpmSuction) + " GPM (suction, 6 FPS) · pump max " + fmt.int(o.pumpMaxGpm) + " GPM at 3450");
    L.push("Minimum filter: cartridge " + fmt.int(o.sqftCart) + " sq ft · sand " + fmt.dec(o.sqftSand, 1) + " sq ft · DE " + fmt.int(o.sqftDe) + " sq ft");
    L.push("Operating cost: " + fmt.money(o.costMin, 3) + "/h at minimum speed · " + fmt.money(o.costMax, 2) + "/h at maximum speed (" + i.volts + " V, $" + i.kwh + "/kWh)");
    if (Number.isFinite(o.costDay)) L.push("With schedule: " + fmt.money(o.costDay) + "/day · " + fmt.money(o.costDay * 365, 0) + "/year");
    return L.join("\n");
  }

  // volume estimator
  function estimate() {
    const g = num("estShape"), l = num("estLen"), w = num("estWid"), d = num("estDepth");
    const gal = l * w * d * g;
    setText("estOut", Number.isFinite(gal) && gal > 0 ? fmt.int(gal) + " gal" : "—");
    return gal;
  }
  ["estShape", "estLen", "estWid", "estDepth"].forEach((id) => document.getElementById(id).addEventListener("input", estimate));
  document.getElementById("estUse").addEventListener("click", () => {
    const gal = estimate();
    if (Number.isFinite(gal) && gal > 0) { document.getElementById("volume").value = Math.round(gal / 100) * 100; render(); toast("Volume updated"); }
  });

  IDS.forEach((id) => { const el = document.getElementById(id); el.addEventListener("input", render); el.addEventListener("change", render); });
  function setSource(src) {
    flowSource = src;
    try { localStorage.setItem("fp-pump-flowsrc", src); } catch (e) { /* ignore */ }
    if (src === "meter") { document.getElementById("gpm2400").value = ""; document.getElementById("gpm2400").focus(); }
    render();
  }
  document.getElementById("srcCurve").addEventListener("click", () => setSource("curve"));
  document.getElementById("srcMeter").addEventListener("click", () => setSource("meter"));
  document.getElementById("model").addEventListener("change", () => { if (CURVES[document.getElementById("model").value]) setSource("curve"); else render(); });
  document.querySelectorAll(".tabs .chip").forEach((b) => b.addEventListener("click", () => {
    filterType = b.dataset.type;
    document.querySelectorAll(".tabs .chip").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (last) renderFilters(last.o);
  }));
  document.getElementById("copyBtn").addEventListener("click", () => copyText(summary()));
  document.getElementById("clearBtn").addEventListener("click", () => {
    IDS.concat(["estLen", "estWid", "estDepth"]).forEach((id) => { document.getElementById(id).value = ""; });
    flowSource = "curve";
    try { localStorage.removeItem("fp-pump-flowsrc"); } catch (e) { /* ignore */ }
    store.clear(); estimate(); render(); store.clear(); toast("All fields cleared");
  });

  render();
})();

/* LSI & Dosing Calculator
   LsiCalc holds the chemistry so it can be checked on its own; the rest is display.

   LSI = pH + TF + CF + AF − TDSF, with the factors read from the APSP / Taylor saturation index
   table (interpolated between chart points). Alkalinity is corrected for cyanuric acid first.

   Doses come from the carbonate system: adding acid, bicarbonate or soda ash changes total
   alkalinity and total carbonate in known amounts, and pH follows from the two. Solving for the
   target pH and alkalinity together gives the mix of products that lands on both. */
(function (root) {
  "use strict";

  const TF = [[32, 0.0], [37, 0.1], [46, 0.2], [53, 0.3], [60, 0.4], [66, 0.5], [76, 0.6], [84, 0.7], [94, 0.8], [105, 0.9]];
  const CF = [[5, 0.3], [25, 1.0], [50, 1.3], [75, 1.5], [100, 1.6], [150, 1.8], [200, 1.9], [300, 2.1], [400, 2.2], [800, 2.5], [1000, 2.6]];
  const AF = [[5, 0.7], [25, 1.4], [50, 1.7], [75, 1.9], [100, 2.0], [150, 2.2], [200, 2.3], [300, 2.5], [400, 2.6], [800, 2.9], [1000, 3.0]];

  function interp(table, x) {
    if (!Number.isFinite(x)) return NaN;
    if (x <= table[0][0]) return table[0][1];
    const last = table[table.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 1; i < table.length; i++) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return last[1];
  }
  function invInterp(table, y) {
    if (y <= table[0][1]) return table[0][0];
    const last = table[table.length - 1];
    if (y >= last[1]) return last[0];
    for (let i = 1; i < table.length; i++) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      if (y <= y1) return x0 + (x1 - x0) * (y - y0) / (y1 - y0);
    }
    return last[0];
  }
  const tdsFactor = (tds) => (tds < 1000 ? 12.1 : 12.2);
  const fToC = (f) => (f - 32) * 5 / 9;
  const cToF = (c) => c * 9 / 5 + 32;

  // Cyanurate share of total alkalinity, in ppm CaCO3 per ppm CYA, at a given pH.
  // Reproduces the APSP correction table (0.22 at pH 7.0 … 0.36 at pH 8.0).
  const CYA_PKA = 6.88, CYA_EQ = 50 / 129.07;
  function cyaFactor(pH) { return CYA_EQ / (1 + Math.pow(10, CYA_PKA - pH)); }
  function carbonateAlk(ta, cya, pH) { return ta - cya * cyaFactor(pH); }

  function lsi(w) {
    const carb = Math.max(0, carbonateAlk(w.ta, w.cya, w.ph));
    const tf = interp(TF, w.tempF), cf = interp(CF, w.ch), af = interp(AF, carb), tdsf = tdsFactor(w.tds);
    return { value: w.ph + tf + cf + af - tdsf, tf, cf, af, tdsf, carb };
  }
  function describe(v) {
    if (!Number.isFinite(v)) return { word: "—", cls: "", text: "" };
    if (v < -0.5) return { word: "Corrosive", cls: "is-low", text: "Aggressive water. It etches plaster, pits grout and corrodes metal, heater cores and salt cells." };
    if (v < -0.3) return { word: "Slightly corrosive", cls: "is-low", text: "Under-saturated. Surfaces and metal slowly give up calcium and corrode." };
    if (v <= 0.3) return { word: "Balanced", cls: "is-ok", text: "Saturated water. Surfaces and equipment are protected." };
    if (v <= 0.5) return { word: "Slightly scale-forming", cls: "is-high", text: "Over-saturated. Light scale starts on tile lines and in heaters." };
    return { word: "Scale-forming", cls: "is-high", text: "Calcium carbonate drops out of solution onto surfaces, tile, heater exchangers and salt cells. Cloudy water is likely." };
  }

  // Carbonate system: share of total carbonate present as alkalinity (HCO3⁻ + 2·CO3²⁻).
  const PK1 = 6.35, PK2 = 10.33;
  function g(pH) {
    const a1 = 1 / (1 + Math.pow(10, PK1 - pH) + Math.pow(10, pH - PK2));
    const a2 = a1 * Math.pow(10, pH - PK2);
    return a1 + 2 * a2;
  }
  // Total carbonate (mmol/L) that gives this alkalinity at this pH.
  function carbonateTotal(ph, ta, cya) {
    const carb = Math.max(0.5, carbonateAlk(ta, cya, ph));
    return (carb / 50) / g(ph);
  }
  // pH at which total carbonate CT and cyanuric acid give total alkalinity ta.
  function solvePh(CT, cya, ta) {
    let lo = 5, hi = 10.5;
    const f = (pH) => CT * g(pH) + cya * cyaFactor(pH) / 50 - ta / 50;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  const ACIDS = {
    ma31: { name: "muriatic acid 31.45%", liquid: true, w: 0.3145, rho: 1.16 },
    ma20: { name: "muriatic acid 20%", liquid: true, w: 0.20, rho: 1.10 },
    ma14: { name: "muriatic acid 14.5%", liquid: true, w: 0.145, rho: 1.07 },
    dry: { name: "dry acid (sodium bisulfate)", liquid: false, purity: 0.932 }
  };
  const CALCIUM = {
    di77: { name: "calcium chloride dihydrate 77%", purity: 0.77 },
    an94: { name: "calcium chloride anhydrous 94%", purity: 0.94 }
  };
  const G_PER_GAL = 3.78541, ML_PER_FLOZ = 29.5735, G_PER_OZ = 28.3495;
  const MW = { HCl: 36.461, NaHSO4: 120.06, NaHCO3: 84.007, Na2CO3: 105.99, CaCl2: 110.98, CaCO3: 100.09 };

  // Doses for one pool. cur/tgt in ppm; volume in gallons.
  function plan(cur, tgt, opt) {
    const L = cur.volume * G_PER_GAL;
    const per10k = Math.max(0.05, cur.volume / 10000);
    const out = { steps: [], after: {}, warnings: [], notes: [] };
    const EPS = 1e-4;
    const toGrams = (mmol, mw) => mmol * L * mw / 1000;

    // --- 1. dilution first (calcium and stabilizer only leave with the water) ---
    let chNow = cur.ch, cyaNow = cur.cya;
    const fill = Number.isFinite(opt.fillCh) ? Math.max(0, opt.fillCh) : 0;
    let fracCh = 0, fracCya = 0, chBlocked = false;
    if (tgt.ch < cur.ch - 10) {
      if (fill >= tgt.ch) chBlocked = true;
      else fracCh = (cur.ch - tgt.ch) / (cur.ch - fill);
    }
    if (tgt.cya < cur.cya - 5 && cur.cya > 0) fracCya = (cur.cya - tgt.cya) / cur.cya;
    const frac = Math.min(0.95, Math.max(fracCh, fracCya));
    if (frac > 0.005) {
      chNow = cur.ch - frac * (cur.ch - fill);
      cyaNow = cur.cya * (1 - frac);
      const fixes = [];
      if (fracCh > 0) fixes.push("calcium hardness to about " + Math.round(chNow) + " ppm");
      if (fracCya > 0) fixes.push("stabilizer to about " + Math.round(cyaNow) + " ppm");
      out.steps.push({ kind: "drain", title: "Drain and refill " + Math.round(frac * 100) + "% of the water", amount: { drainFrac: frac, gallons: frac * cur.volume },
        why: "No chemical lowers calcium or stabilizer. Refilling with " + Math.round(fill) + " ppm calcium fill water brings " + fixes.join(" and ") + ". Retest after refilling: the steps below assume pH and alkalinity are unchanged by the new water." });
    }
    if (chBlocked) {
      out.steps.push({ kind: "info", title: "Calcium hardness cannot be lowered by dilution here", why: "The fill water is at " + Math.round(fill) + " ppm, which is at or above the " + Math.round(tgt.ch) + " ppm target. Raise the calcium target or use a lower-hardness water source." });
    }

    // --- 2. alkalinity + pH together ---
    // After a drain the water is treated as having today's pH and alkalinity with the diluted stabilizer.
    const CT = carbonateTotal(cur.ph, cur.ta, cyaNow);
    const cyaFinalTarget = Math.max(tgt.cya, cyaNow);
    const cyaAlkT = cyaFinalTarget * cyaFactor(tgt.ph);
    const carbT = tgt.ta - cyaAlkT;
    let b = 0, s = 0, a = 0, r = 0;
    if (carbT <= 2) {
      out.warnings.push("A total alkalinity of " + Math.round(tgt.ta) + " ppm is too low for " + Math.round(cyaFinalTarget) + " ppm cyanuric acid at pH " + tgt.ph.toFixed(1) + ": almost none of it would be carbonate alkalinity. Raise the alkalinity target or lower the stabilizer target.");
    } else {
      const gT = g(tgt.ph);
      const CTt = (carbT / 50) / gT;
      const dA = (tgt.ta - cur.ta) / 50;   // meq/L of alkalinity to add (− = remove)
      const dC = CTt - CT;                 // mmol/L of carbonate to add (− = remove)
      if (dA >= 0) {
        if (dC >= dA) { b = dC; a = dC - dA; }
        else if (dC >= dA / 2) { s = dA - dC; b = 2 * dC - dA; }
        else { s = dA / 2; r = dA / 2 - dC; }
      } else {
        if (dC <= 0) { a = -dA; r = -dC; }
        else { b = dC; a = dC - dA; }
      }
      if (r > EPS && opt.noAeration) {
        // Without aeration the alkalinity target is out of reach, so hit the pH target alone:
        // acid if pH must come down, soda ash if it must go up. Alkalinity lands where it lands.
        b = 0; r = 0;
        const alkAtTarget = CT * gT * 50 + cyaAlkT; // total alkalinity once pH is on target with today's carbonate
        if (alkAtTarget < cur.ta) { a = (cur.ta - alkAtTarget) / 50; s = 0; }
        else { a = 0; s = ((alkAtTarget - cur.ta) / 50) / (2 - gT); }
        const taEnd = alkAtTarget < cur.ta ? alkAtTarget : cur.ta + 100 * s;
        out.notes.push("Without aeration, alkalinity will end near " + Math.round(taEnd) + " ppm instead of " + Math.round(tgt.ta) + " ppm. Only aeration moves pH up without adding alkalinity, so acid and soda ash alone cannot land on both targets.");
      }
      // Drop a balancing dose too small to bother with (under about 4 oz per 10,000 gal) when
      // another chemical is doing the real work; the readings below are recalculated without it.
      const acid = ACIDS[opt.acid];
      const acidQty = acid.liquid ? (a * L * MW.HCl / 1000) / (acid.w * acid.rho) / ML_PER_FLOZ : toGrams(a, MW.NaHSO4) / acid.purity / G_PER_OZ;
      const chem = (a > EPS) + (b > EPS) + (s > EPS);
      if (chem > 1) {
        if (a > EPS && acidQty < 4 * per10k) a = 0;
        if (b > EPS && toGrams(b, MW.NaHCO3) / G_PER_OZ < 4 * per10k) b = 0;
        if (s > EPS && toGrams(s, MW.Na2CO3) / G_PER_OZ < 4 * per10k) s = 0;
      }
      // Skip aeration when it would move pH by less than a tenth.
      if (r > EPS) {
        const phNoAir = solvePh(CT + b + s, cyaFinalTarget, cur.ta + 50 * (b + 2 * s - a));
        if (tgt.ph - phNoAir < 0.1) r = 0;
      }
    }
    const phAfterAcid = a > EPS ? solvePh(CT, cyaNow, cur.ta - 50 * a) : null;

    if (a > EPS) {
      const acid = ACIDS[opt.acid];
      const mmolH = a * L;
      let amount;
      if (acid.liquid) amount = { liquid: true, floz: (mmolH * MW.HCl / 1000) / (acid.w * acid.rho) / ML_PER_FLOZ };
      else amount = { liquid: false, grams: (mmolH * MW.NaHSO4 / 1000) / acid.purity };
      const stages = acid.liquid ? Math.ceil(amount.floz / (32 * per10k)) : Math.ceil(amount.grams / (907 * per10k));
      out.steps.push({ kind: "acid", title: "Add " + acid.name, amount,
        why: "Lowers total alkalinity by about " + Math.round(50 * a) + " ppm" + (phAfterAcid ? " and takes pH to about " + phAfterAcid.toFixed(1) : "") + ".",
        stages: Math.max(1, stages) });
    }
    if (b > EPS) {
      const grams = toGrams(b, MW.NaHCO3);
      out.steps.push({ kind: "bicarb", title: "Add sodium bicarbonate (alkalinity increaser)", amount: { liquid: false, grams },
        why: "Raises total alkalinity by about " + Math.round(50 * b) + " ppm with little effect on pH.", stages: Math.max(1, Math.ceil(grams / (1134 * per10k))) });
    }
    if (s > EPS) {
      const grams = toGrams(s, MW.Na2CO3);
      out.steps.push({ kind: "soda", title: "Add soda ash (pH increaser)", amount: { liquid: false, grams },
        why: "Raises pH and adds about " + Math.round(100 * s) + " ppm of alkalinity.", stages: Math.max(1, Math.ceil(grams / (454 * per10k))) });
    }
    if (a <= EPS && b <= EPS && s <= EPS && r <= EPS && carbT > 2) {
      out.steps.push({ kind: "none", title: "Alkalinity and pH: no change needed" });
    }
    out.notes.forEach((n) => out.steps.push({ kind: "info", title: "Alkalinity will miss its target", why: n }));

    // --- 3. calcium hardness up ---
    const dCh = tgt.ch - chNow;
    if (dCh > 5) {
      const cal = CALCIUM[opt.calcium];
      const grams = toGrams(dCh / MW.CaCO3, MW.CaCl2) / cal.purity;
      out.steps.push({ kind: "calcium", title: "Add " + cal.name, amount: { liquid: false, grams },
        why: "Raises calcium hardness by " + Math.round(dCh) + " ppm. Pre-dissolve in a bucket; it gets hot.", stages: Math.max(1, Math.ceil(grams / (4536 * per10k))) });
      chNow = tgt.ch;
    }

    // --- 4. stabilizer up ---
    const dCya = tgt.cya - cyaNow;
    if (dCya > 2.5) {
      const grams = dCya * L / 1000;
      out.steps.push({ kind: "cya", title: "Add cyanuric acid (stabilizer)", amount: { liquid: false, grams },
        why: "Raises stabilizer by " + Math.round(dCya) + " ppm. Dissolves slowly: add through the skimmer with the pump running, or in a sock. Retest after a few days.", stages: 1 });
      cyaNow = tgt.cya;
    }

    // --- 5. aeration last: it finishes pH without adding anything ---
    if (r > EPS) {
      out.steps.push({ kind: "air", title: "Aerate to raise pH" + (phAfterAcid ? " from about " + phAfterAcid.toFixed(1) : "") + " to " + tgt.ph.toFixed(1),
        why: "Run water features, point returns up, or use an air blower until pH reads " + tgt.ph.toFixed(1) + ". Aeration drives off carbon dioxide and raises pH without adding alkalinity, so no chemical is needed." + (phAfterAcid ? "" : " Soda ash would push alkalinity past the target.") });
    }

    // --- readings after the doses actually listed ---
    const alkF = cur.ta + 50 * (b + 2 * s - a);
    const CTf = Math.max(0.01, CT + b + s - r);
    out.after = { ph: solvePh(CTf, cyaNow, alkF), ta: alkF, ch: chNow, cya: cyaNow, tds: cur.tds, tempF: cur.tempF };
    out.doses = { acid: a, bicarb: b, soda: s, aerate: r, drain: frac };
    return out;
  }

  // Suggested targets: pH 7.5, TA 90, keep CYA in 30–50, calcium set so LSI ≈ 0 within 200–400.
  function suggest(cur) {
    const ph = 7.5, ta = 90;
    const cya = Math.min(50, Math.max(30, cur.cya || 40));
    const carb = Math.max(1, carbonateAlk(ta, cya, ph));
    const need = -(ph + interp(TF, cur.tempF) + interp(AF, carb) - tdsFactor(cur.tds));
    let ch = invInterp(CF, need);
    ch = Math.min(400, Math.max(200, Math.round(ch / 10) * 10));
    return { ph, ta, ch, cya };
  }

  root.LsiCalc = { lsi, describe, plan, suggest, interp, invInterp, cyaFactor, carbonateAlk, tdsFactor, fToC, cToF, g, solvePh, carbonateTotal, TF, CF, AF, ACIDS, CALCIUM };
  if (typeof module !== "undefined" && module.exports) module.exports = root.LsiCalc;
})(typeof window !== "undefined" ? window : globalThis);

/* ---------------- page wiring ---------------- */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  const { fmt, num, setText, remember, copyText, toast } = window.FP;
  const C = window.LsiCalc;

  const IDS = ["lsiVolume", "ph", "temp", "ta", "ch", "cya", "tds", "tPh", "tTa", "tCh", "tCya", "fillCh", "acidType", "calType", "cyaType"];
  const store = remember("fp-lsi-v1", IDS);
  let unit = "F";
  try { unit = localStorage.getItem("fp-lsi-unit") === "C" ? "C" : "F"; } catch (e) { /* ignore */ }
  let last = null;

  // Blank readings stay NaN (results show "—"); blank CYA counts as 0 and blank TDS as under 1,000 ppm.
  function current() {
    const t = num("temp");
    const cya = num("cya"), tds = num("tds");
    return {
      volume: num("lsiVolume"), ph: num("ph"), tempF: unit === "C" ? C.cToF(t) : t,
      ta: num("ta"), ch: num("ch"),
      cya: Number.isFinite(cya) ? Math.max(0, cya) : 0, cyaBlank: !Number.isFinite(cya),
      tds: Number.isFinite(tds) ? Math.max(0, tds) : 0, tdsBlank: !Number.isFinite(tds)
    };
  }
  function targets(cur) {
    const cya = num("tCya");
    return { ph: num("tPh"), ta: num("tTa"), ch: num("tCh"), cya: Number.isFinite(cya) ? Math.max(0, cya) : cur.cya, cyaBlank: !Number.isFinite(cya) };
  }
  const fin = (v) => Number.isFinite(v);
  const f2 = (v, d) => (fin(v) ? v.toFixed(d) : "—");
  function signed(v, d) {
    if (!fin(v)) return "—";
    const r = Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
    return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(d);
  }
  function gauge(valId, wordId, needleId, v, emptyWord) {
    const d = C.describe(v);
    const el = document.getElementById(valId);
    el.textContent = signed(v, 2);
    el.className = "gauge-value " + d.cls;
    setText(wordId, fin(v) ? d.word : emptyWord);
    const pct = fin(v) ? Math.max(0, Math.min(100, (Math.max(-1, Math.min(1, v)) + 1) * 50)) : 50;
    document.getElementById(needleId).style.left = pct + "%";
    document.getElementById(needleId).style.opacity = fin(v) ? "1" : ".25";
    return d;
  }
  function tempLabel(f) { return !fin(f) ? "—" : unit === "C" ? fmt.int(C.fToC(f)) + " °C" : fmt.int(f) + " °F"; }

  // amount formatting
  function dry(grams) {
    const oz = grams / 28.3495;
    if (oz < 16) return { big: fmt.dec(oz, 1) + " oz", alt: fmt.dec(grams, 0) + " g" };
    const lb = Math.floor(oz / 16), rem = oz - lb * 16;
    return { big: lb + " lb" + (rem >= 0.5 ? " " + fmt.dec(rem, 0) + " oz" : ""), alt: fmt.dec(oz / 16, 2) + " lb · " + fmt.dec(grams / 1000, 2) + " kg" };
  }
  function liquid(floz) {
    if (floz < 32) return { big: fmt.dec(floz, 1) + " fl oz", alt: fmt.dec(floz / 8, 1) + " cups · " + fmt.dec(floz * 29.5735, 0) + " mL" };
    if (floz < 128) { const qt = Math.floor(floz / 32), rem = floz - qt * 32; return { big: qt + " qt" + (rem >= 0.5 ? " " + fmt.dec(rem, 0) + " fl oz" : ""), alt: fmt.dec(floz, 0) + " fl oz · " + fmt.dec(floz * 0.0295735, 2) + " L" }; }
    const gal = Math.floor(floz / 128), rem = floz - gal * 128, qt = Math.round(rem / 32 * 2) / 2;
    return { big: gal + " gal" + (qt >= 0.5 ? " " + qt + " qt" : ""), alt: fmt.dec(floz, 0) + " fl oz · " + fmt.dec(floz * 0.0295735, 1) + " L" };
  }
  function amountOf(step) {
    if (!step.amount) return null;
    if (step.amount.drainFrac != null) return { big: fmt.int(step.amount.drainFrac * 100) + "% of the water", alt: "about " + fmt.int(step.amount.gallons) + " gallons" };
    return step.amount.liquid ? liquid(step.amount.floz) : dry(step.amount.grams);
  }

  function render() {
    const cur = current(), tgt = targets(cur);
    const opt = { acid: document.getElementById("acidType").value, calcium: document.getElementById("calType").value, fillCh: num("fillCh"), noAeration: document.getElementById("noAeration").checked };
    const haveTest = [cur.ph, cur.tempF, cur.ta, cur.ch].every(fin);
    const haveTargets = [tgt.ph, tgt.ta, tgt.ch].every(fin);
    const now = haveTest ? C.lsi(cur) : { value: NaN, tf: NaN, cf: NaN, af: NaN, tdsf: NaN, carb: NaN };
    const want = (haveTest && haveTargets) ? C.lsi({ ph: tgt.ph, tempF: cur.tempF, ta: tgt.ta, ch: tgt.ch, cya: tgt.cya, tds: cur.tds }) : { value: NaN };
    const canPlan = haveTest && haveTargets && fin(cur.volume) && cur.volume > 0;
    const p = canPlan ? C.plan(cur, tgt, opt) : null;
    const after = p ? C.lsi({ ph: p.after.ph, tempF: cur.tempF, ta: p.after.ta, ch: p.after.ch, cya: p.after.cya, tds: cur.tds }) : { value: NaN };
    last = { cur, tgt, opt, now, want, p, after };

    // hero
    const dNow = C.describe(now.value), dAfter = C.describe(after.value);
    setText("tLsi", signed(now.value, 2)); setText("tLsiWord", haveTest ? dNow.word : "Enter the water test");
    setText("tLsiAfter", signed(after.value, 2)); setText("tLsiAfterWord", p ? dAfter.word + " after the plan" : "Needs targets and volume");
    document.getElementById("tCarb").innerHTML = fin(now.carb) ? fmt.int(now.carb) + "<small>PPM</small>" : "—";
    document.getElementById("tVol").innerHTML = fin(cur.volume) && cur.volume > 0 ? fmt.int(cur.volume) + "<small>GAL</small>" : "—";

    // step 1
    const d = gauge("lsiValue", "lsiWord", "needle", now.value, "Enter pH, temperature, alkalinity and calcium");
    setText("lsiDesc", haveTest ? d.text : "");
    setText("fPh", f2(cur.ph, 1));
    setText("fTf", f2(now.tf, 2)); setText("fTfSub", tempLabel(cur.tempF));
    setText("fCf", f2(now.cf, 2)); setText("fCfSub", fin(cur.ch) ? fmt.int(cur.ch) + " ppm" : "—");
    setText("fAf", f2(now.af, 2)); setText("fAfSub", fin(now.carb) ? fmt.int(now.carb) + " ppm carbonate" + (cur.cyaBlank ? " (CYA 0)" : "") : "—");
    setText("fTds", f2(now.tdsf, 1)); setText("fTdsSub", cur.tdsBlank ? "assumed under 1,000 ppm" : fmt.int(cur.tds) + " ppm");
    setText("formula", haveTest
      ? "LSI = " + cur.ph.toFixed(1) + " + " + now.tf.toFixed(2) + " + " + now.cf.toFixed(2) + " + " + now.af.toFixed(2) + " − " + now.tdsf.toFixed(1) + " = " + signed(now.value, 2)
      : "LSI = pH + TF + CF + AF − TDSF");

    // step 2
    gauge("lsiTValue", "lsiTWord", "needleT", want.value, haveTest ? "Enter the target readings" : "Enter the water test first");
    const delta = (id, a, b, dec, unitTxt) => {
      const el = document.getElementById(id);
      if (!fin(a) || !fin(b)) { el.textContent = "—"; return; }
      const dv = b - a;
      el.textContent = Math.abs(dv) < (dec ? 0.05 : 0.5) ? "Hold at " + fmt.dec(a, dec) + (unitTxt || "") : fmt.dec(a, dec) + " → " + fmt.dec(b, dec) + (unitTxt || "") + "  (" + signed(dv, dec) + ")";
    };
    delta("dPh", cur.ph, tgt.ph, 1, ""); delta("dTa", cur.ta, tgt.ta, 0, " ppm"); delta("dCh", cur.ch, tgt.ch, 0, " ppm"); delta("dCya", cur.cya, tgt.cya, 0, " ppm");
    const ft = document.getElementById("flagTarget");
    ft.hidden = !p || p.warnings.length === 0; ft.textContent = p ? p.warnings.join(" ") : "";

    // step 3
    const plan = document.getElementById("plan");
    if (!p) {
      const missing = [];
      if (!(fin(cur.volume) && cur.volume > 0)) missing.push("the pool volume");
      if (!haveTest) missing.push("the water test (pH, temperature, alkalinity, calcium)");
      if (!haveTargets) missing.push("the target pH, alkalinity and calcium");
      plan.innerHTML = `<div class="dose is-none"><div class="dose-head"><h3>Amounts appear here</h3></div><p>Still needed: ${missing.join("; ")}.</p></div>`;
    } else {
      plan.innerHTML = p.steps.map((st, i) => {
        const amt = amountOf(st);
        const cls = (st.kind === "none" || st.kind === "info") ? "is-none" : st.kind === "drain" ? "is-drain" : st.kind === "air" ? "is-air" : "";
        const stages = st.stages > 1 && amt ? `<p><strong>Split into ${st.stages} applications</strong> of about ${st.amount.liquid ? liquid(st.amount.floz / st.stages).big : dry(st.amount.grams / st.stages).big} each, retesting between them.</p>` : "";
        return `<div class="dose ${cls}">
          <div class="dose-head"><h3>${i + 1}. ${st.title}</h3></div>
          ${amt ? `<div class="dose-amt"><span class="big">${amt.big}</span><span class="alt">${amt.alt}</span></div>` : ""}
          ${st.why ? `<p>${st.why}</p>` : ""}
          ${stages}
        </div>`;
      }).join("");
    }
    setText("aPh", p ? p.after.ph.toFixed(1) : "—"); setText("aTa", p ? fmt.int(p.after.ta) : "—"); setText("aCh", p ? fmt.int(p.after.ch) : "—"); setText("aCya", p ? fmt.int(p.after.cya) : "—");
    setText("aLsi", signed(after.value, 2)); setText("aLsiWord", p ? dAfter.word : "—");
    store.save();
  }

  function summaryText() {
    if (!last) return "";
    const { cur, tgt, now, p, after } = last;
    const L = [];
    L.push("LSI & DOSING PLAN — " + (fin(cur.volume) ? fmt.int(cur.volume) + " gal" : "volume not entered"));
    L.push("Test: pH " + f2(cur.ph, 1) + " · " + tempLabel(cur.tempF) + " · TA " + fmt.int(cur.ta) + " · CH " + fmt.int(cur.ch) + " · CYA " + fmt.int(cur.cya) + " · TDS " + (cur.tdsBlank ? "under 1,000" : fmt.int(cur.tds)));
    L.push("LSI now: " + signed(now.value, 2) + (fin(now.value) ? " (" + C.describe(now.value).word + ")   carbonate alkalinity " + fmt.int(now.carb) + " ppm" : ""));
    L.push("Targets: pH " + f2(tgt.ph, 1) + " · TA " + fmt.int(tgt.ta) + " · CH " + fmt.int(tgt.ch) + " · CYA " + fmt.int(tgt.cya));
    L.push("");
    if (!p) { L.push("Enter the pool volume, the water test and the targets to get amounts."); return L.join("\n"); }
    p.steps.forEach((st, i) => {
      const amt = amountOf(st);
      L.push((i + 1) + ". " + st.title + (amt ? ": " + amt.big + " (" + amt.alt + ")" : ""));
      if (st.why) L.push("   " + st.why);
      if (st.stages > 1 && amt) L.push("   Split into " + st.stages + " applications; retest between them.");
    });
    L.push("");
    L.push("After the plan: pH " + p.after.ph.toFixed(1) + " · TA " + fmt.int(p.after.ta) + " · CH " + fmt.int(p.after.ch) + " · CYA " + fmt.int(p.after.cya) + " → LSI " + signed(after.value, 2) + " (" + C.describe(after.value).word + ")");
    return L.join("\n");
  }

  function setUnit(u) {
    if (u === unit) return;
    const t = num("temp");
    if (fin(t)) document.getElementById("temp").value = u === "C" ? Math.round(C.fToC(t)) : Math.round(C.cToF(t));
    unit = u;
    document.getElementById("unitF").setAttribute("aria-pressed", String(u === "F"));
    document.getElementById("unitC").setAttribute("aria-pressed", String(u === "C"));
    try { localStorage.setItem("fp-lsi-unit", u); } catch (e) { /* ignore */ }
    render();
  }
  document.getElementById("unitF").setAttribute("aria-pressed", String(unit === "F"));
  document.getElementById("unitC").setAttribute("aria-pressed", String(unit === "C"));
  document.getElementById("unitF").addEventListener("click", () => setUnit("F"));
  document.getElementById("unitC").addEventListener("click", () => setUnit("C"));

  IDS.concat(["noAeration"]).forEach((id) => { const el = document.getElementById(id); el.addEventListener("input", render); el.addEventListener("change", render); });
  document.getElementById("suggestBtn").addEventListener("click", () => {
    const cur = current();
    if (!fin(cur.tempF)) { toast("Enter the water temperature first"); document.getElementById("temp").focus(); return; }
    const s = C.suggest(cur);
    document.getElementById("tPh").value = s.ph; document.getElementById("tTa").value = s.ta; document.getElementById("tCh").value = s.ch; document.getElementById("tCya").value = s.cya;
    render(); toast("Targets set for a balanced index");
  });
  document.getElementById("copyBtn").addEventListener("click", () => copyText(summaryText()));
  document.getElementById("clearBtn").addEventListener("click", () => {
    IDS.forEach((id) => { const el = document.getElementById(id); if (el.tagName === "SELECT") el.selectedIndex = 0; else el.value = ""; });
    document.getElementById("noAeration").checked = false;
    store.clear(); render(); store.clear(); toast("All fields cleared");
  });

  render();
})();



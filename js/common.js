/* Shared helpers: mobile menu, toast, clipboard, number formatting, remembered inputs. */
(function () {
  "use strict";

  const menuBtn = document.getElementById("menubtn");
  const navArea = document.getElementById("navarea");
  if (menuBtn && navArea) {
    menuBtn.addEventListener("click", () => {
      const open = navArea.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(open));
    });
  }

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Printing is not available when the page is shown inside another page (a preview frame),
  // so the button is only offered on the real site.
  const printBtn = document.getElementById("printBtn");
  if (printBtn) {
    let framed = false;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    if (framed) printBtn.hidden = true;
    else printBtn.addEventListener("click", () => window.print());
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function copyText(text) {
    const done = () => toast("Copied to the clipboard");
    const fail = () => {
      // Fallback: put the text in a temporary box and select it so the person can copy by hand.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "12px";
      ta.style.top = "12px";
      ta.style.width = "min(90vw, 600px)";
      ta.style.height = "40vh";
      ta.style.zIndex = "100";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      toast("Press Ctrl/Cmd + C to copy, then click anywhere");
      const remove = () => { ta.remove(); document.removeEventListener("click", remove); };
      setTimeout(() => document.addEventListener("click", remove), 50);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fail);
      } else fail();
    } catch (e) { fail(); }
  }

  const fmt = {
    int(n) { return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—"; },
    dec(n, d) { return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; },
    money(n, d) { return Number.isFinite(n) ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }) : "—"; },
    pipe(size) {
      if (size == null || !Number.isFinite(size)) return "—";
      const whole = Math.floor(size), frac = size - whole;
      const f = frac === 0.5 ? "½" : frac === 0.25 ? "¼" : frac === 0.75 ? "¾" : "";
      return (whole ? whole : "") + f + "\"";
    }
  };

  // Remembered inputs: a per-browser convenience only; the page works without it.
  function remember(key, ids) {
    const read = () => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } };
    const write = (data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* storage unavailable */ } };
    const clear = () => { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } };
    const saved = read();
    if (saved && typeof saved === "object") {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el && saved[id] != null) el.value = saved[id];
      });
    }
    const save = () => {
      const data = {};
      ids.forEach((id) => { const el = document.getElementById(id); if (el) data[id] = el.value; });
      write(data);
    };
    return { save, clear };
  }

  function num(id) {
    const el = document.getElementById(id);
    if (!el) return NaN;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : NaN;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  window.FP = { toast, copyText, fmt, remember, num, setText };
})();


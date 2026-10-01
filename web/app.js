// Settle web app — no build step, no framework. Every interpolation is escaped by `html`.

// ---------------------------------------------------------------- utilities
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const val = (v) => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join("") : v == null || v === false ? "" : esc(v);
const html = (strings, ...vals) => raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ""), ""));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const gbp = (p, cents = false) => {
  const v = (p || 0) / 100;
  return "£" + v.toLocaleString("en-GB", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
};
const money = (p) => {
  const pounds = Math.floor(Math.abs(p || 0) / 100), pence = Math.abs(p || 0) % 100;
  return html`£${pounds.toLocaleString("en-GB")}<small>.${String(pence).padStart(2, "0")}</small>`;
};
const fmtDate = (iso, opts = { day: "numeric", month: "short" }) => iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-GB", opts) : "";
const fmtDay = (iso) => fmtDate(iso, { weekday: "short", day: "numeric", month: "short" });
function ago(iso) {
  const d = new Date(iso), s = (Date.now() - d) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return "Yesterday";
  return fmtDate(iso);
}
const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const firstName = (n) => (n || "").split(" ")[0];
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function linkify(text) {
  return raw(esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'));
}

function toast(msg, { error = false, ms = 2600 } = {}) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " err" : "");
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 260); }, ms);
}

async function api(path, { method = "GET", body, quiet = false } = {}) {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong");
    err.status = res.status;
    if (res.status === 401 && !quiet && !path.startsWith("/api/login")) { state.me = null; go("/login"); }
    throw err;
  }
  return data;
}

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.classList.add("loading");
  btn.innerHTML = `<span class="spin"></span>${label}`;
  try { return await fn(); }
  catch (e) { toast(e.message, { error: true }); throw e; }
  finally { btn.classList.remove("loading"); btn.innerHTML = label; }
}

function countUp(el, to, { ms = 1100, format = (v) => gbp(v) } = {}) {
  if (reduced) { el.innerHTML = val(format(to)); return; }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = val(format(Math.round(to * e)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------------------------------------------------------------- Adaline-style motion
// Odometer: every digit is a 0–9 strip that rolls (with a touch of motion blur) into place.
// Markup is generated statically; call `rollIn(root)` to start the roll.
function odo(text, { small = "" } = {}) {
  const digits = (s, offset) => [...s].map((ch, i) => /\d/.test(ch)
    ? `<span class="odo" style="--d:${(offset + i) * 55}ms"><span class="odo-strip" data-v="${ch}">${"0123456789".split("").map((n) => `<span>${n}</span>`).join("")}</span></span>`
    : `<span class="odo-sym">${esc(ch)}</span>`).join("");
  const main = digits(text, 0);
  return raw(`<span class="odo-num" aria-label="${esc(text + small)}"><span aria-hidden="true">${main}${small ? `<small>${digits(small, text.length)}</small>` : ""}</span></span>`);
}
const odoMoney = (p) => {
  const pounds = Math.floor(Math.abs(p || 0) / 100), pence = Math.abs(p || 0) % 100;
  return odo("£" + pounds.toLocaleString("en-GB"), { small: "." + String(pence).padStart(2, "0") });
};
function rollIn(root = document) {
  const strips = $$(".odo-strip:not(.rolled)", root);
  if (!strips.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => strips.forEach((s) => {
    s.classList.add("rolled");
    s.style.transform = `translateY(-${+s.dataset.v * 10}%)`;
  })));
}

// Scramble: text decodes from random symbols, left to right.
const GLYPHS = "=$_~.&*^?/\\>%:;#+@!<|";
function scramble(el, { ms = 700 } = {}) {
  const target = el.dataset.text || el.textContent;
  el.dataset.text = target;
  if (reduced) { el.textContent = target; return; }
  const start = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - start) / ms);
    const fixed = Math.floor(k * target.length);
    el.textContent = [...target].map((ch, i) => i < fixed || ch === " " ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]).join("");
    if (k < 1) requestAnimationFrame(tick); else el.textContent = target;
  };
  requestAnimationFrame(tick);
}

// Run roll + scramble when an element scrolls into view (or straight away if already visible).
function revealOnScroll(root = document) {
  const targets = $$("[data-reveal]", root);
  const run = (el) => { rollIn(el); $$("[data-scramble]", el).forEach((s) => scramble(s)); if (el.matches("[data-scramble]")) scramble(el); el.classList.add("revealed"); };
  if (!("IntersectionObserver" in window)) return targets.forEach(run);
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: .3 });
  targets.forEach((t) => io.observe(t));
}

// ASCII field: a grid of symbols that quietly re-shuffles, like Adaline's hero.
function asciiField(el, { cols = 42, rows = 26 } = {}) {
  const line = () => Array.from({ length: cols }, () => GLYPHS[(Math.random() * GLYPHS.length) | 0]).join("");
  const grid = Array.from({ length: rows }, line);
  el.textContent = grid.join("\n");
  if (reduced) return;
  let last = 0;
  const tick = (t) => {
    if (!el.isConnected) return;
    if (t - last > 90) {
      last = t;
      for (let n = 0; n < 14; n++) {
        const r = (Math.random() * rows) | 0, c = (Math.random() * cols) | 0;
        grid[r] = grid[r].slice(0, c) + GLYPHS[(Math.random() * GLYPHS.length) | 0] + grid[r].slice(c + 1);
      }
      el.textContent = grid.join("\n");
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- icons (Lucide-style strokes)
const ICONS = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0zM8 21h8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  msg: '<path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-6.2A8 8 0 1 1 21 12z"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  pound: '<path d="M17 20H7s2-2 2-6V8a4 4 0 0 1 7.5-2M6 13h8"/>',
};
const icon = (n, size = 16) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`);
const logo = (href = "/") => html`<a class="logo" href="${href}"><span class="mark">${icon("check", 14)}</span>Settle</a>`;

// ---------------------------------------------------------------- state & router
const state = { me: undefined, invoiceFilter: "overdue", search: "", kbIndex: -1, drawerId: null, listCache: null };
const app = $("#app");

async function loadMe(force = false) {
  if (state.me !== undefined && !force) return state.me;
  try { state.me = await api("/api/me", { quiet: true }); } catch { state.me = null; }
  return state.me;
}

function go(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return render();
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  transition(render);
}

function transition(fn) {
  const appRoute = location.pathname.startsWith("/app/") || location.pathname === "/app";
  const inShell = appRoute && $(".shell");
  if (document.startViewTransition && !reduced && !inShell) {
    const t = document.startViewTransition(() => fn());
    t.ready.catch(() => {});
    t.finished.catch(() => {});
  } else fn();
}

addEventListener("popstate", () => transition(render));
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  const href = a.getAttribute("href");
  if (href.startsWith("#")) {
    const t = document.getElementById(href.slice(1));
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: reduced ? "auto" : "smooth" }); }
    return;
  }
  if (!href.startsWith("/") || href.startsWith("/static") || href.startsWith("/api") || href.startsWith("/pay")) return;
  e.preventDefault();
  go(href);
});

const ROUTES = [
  [/^\/$/, landing],
  [/^\/signup$/, () => authPage("signup")],
  [/^\/login$/, () => authPage("login")],
  [/^\/app\/connect$/, connectPage],
  [/^\/app\/setup$/, setupPage],
  [/^\/app\/golive$/, goLivePage],
  [/^\/app$/, () => shellPage("overview")],
  [/^\/app\/invoices$/, () => shellPage("invoices")],
  [/^\/app\/invoices\/(\d+)$/, (id) => shellPage("invoices", { open: +id })],
  [/^\/app\/activity$/, () => shellPage("activity")],
  [/^\/app\/settings$/, () => shellPage("settings")],
];

async function render() {
  const path = location.pathname;
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) {
      if (path.startsWith("/app")) {
        const me = await loadMe();
        if (!me) return go("/login", { replace: true });
      }
      return fn(...m.slice(1));
    }
  }
  app.innerHTML = val(html`<div class="center-page"><header>${logo()}</header><div class="auth"><h1>Page not found</h1><p>That link doesn't go anywhere.</p><a class="btn primary" href="/">Go home</a></div></div>`);
}

// ================================================================= LANDING (Goldsand-inspired)
let coinSeq = 0;
function coin(size = 260) {
  const id = `c${++coinSeq}`;
  return raw(`<svg class="coin" width="${size}" height="${size}" viewBox="0 0 200 200" aria-hidden="true">
    <defs>
      <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe7a6"/><stop offset=".35" stop-color="#e2b04f"/><stop offset=".7" stop-color="#b9831f"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>
      <linearGradient id="${id}b" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff2c4"/><stop offset=".45" stop-color="#e8bb5c"/><stop offset="1" stop-color="#a26e1a"/></linearGradient>
      <radialGradient id="${id}c" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a6716"/><stop offset="1" stop-color="#f3d38a"/></linearGradient>
    </defs>
    <circle cx="100" cy="100" r="96" fill="url(#${id}a)"/>
    <circle cx="100" cy="100" r="82" fill="url(#${id}b)"/>
    <circle cx="100" cy="100" r="82" fill="url(#${id}c)"/>
    <rect x="76" y="76" width="48" height="48" rx="5" transform="rotate(45 100 100)" fill="url(#${id}d)"/>
    <rect x="80" y="80" width="40" height="40" rx="3" transform="rotate(45 100 100)" fill="#fffaf0"/>
  </svg>`);
}
const coinStage = (size) => html`<div class="coin-stage" style="--s:${size}px"><i></i><i></i><i></i>${coin(size)}</div>`;

async function landing() {
  document.title = "Settle — Get paid without the awkward chase";
  const me = await loadMe();
  const cta = me ? "/app" : "/signup";
  app.innerHTML = val(html`
  <div class="gs">
  <header class="gs-nav"><div class="gs-wrap">
    <a href="/" class="gs-word">Settle</a>
    <nav><a href="#how">How it works</a><a href="#law">The law</a><a href="#pricing">Pricing</a><a href="#faq">Questions</a></nav>
    <div class="right">${me ? html`<a class="pill" href="/app">Open Settle</a>` : html`<a class="gs-link" href="/login">Log in</a><a class="pill" href="/signup">Start free</a>`}</div>
  </div></header>

  <main>
    <section class="gs-wrap gs-hero">
      <div class="gs-card hero-card">
        <div class="hero-copy rise" data-reveal>
          <a class="tag-chip" href="#law"><span data-scramble>UK Late Payment Act, built in</span> ↗</a>
          <h1>Get paid without<br>the awkward chase.</h1>
          <p>Credit control for UK businesses. Settle connects to Xero or QuickBooks and politely chases every overdue invoice on WhatsApp and email — so you never have to.</p>
          <div class="hero-actions"><a class="pill lg" href="${cta}">See what you're owed</a><span>Set up in 3 minutes · No card</span></div>
        </div>
        <div class="hero-art"><pre class="ascii" id="ascii" aria-hidden="true"></pre>${coinStage(250)}</div>
      </div>
    </section>

    <section class="gs-wrap gs-split">
      <div class="gs-split-copy">
        <h2>Meet Sarah,<br>from Accounts.</h2>
        <p>A named credit controller who writes like a person, not a system. She references the exact invoice, PO and payment link, notes promises, and hands disputes straight to you.</p>
        <ul class="gs-list">
          <li><b>Calm by default.</b> Friendly nudge first, firmer only when needed.</li>
          <li><b>Never argues.</b> Queries and disputes come to you, not her.</li>
          <li><b>Business hours only.</b> Weekdays, UK time, never twice in a week.</li>
        </ul>
      </div>
      <div class="phone gs-phone" aria-label="Example WhatsApp conversation">
        <div class="phone-top"><span class="avatar">S</span><div><b>Sarah · Brightside Ltd</b><div class="muted" style="font-size:12px">WhatsApp Business</div></div></div>
        <div class="phone-body">
          <div class="bubble out">Hi Olivia, it's Sarah from Brightside. Just a quick nudge that invoice INV-1042 (PO-8812) for £8,450.00 was due on 28 July. Would you mind taking a look when you get a sec?<time>09:12 <span class="tick">✓✓</span></time></div>
          <div class="bubble in">So sorry Sarah — stuck in approvals. I'll get it paid on Friday.<time>09:31</time></div>
          <div class="bubble out">Thanks Olivia, much appreciated. I've noted INV-1042 for payment on Friday 3 October.<time>09:31 <span class="tick">✓✓</span></time></div>
          <div class="bubble in">Paid ✅<time>Fri 10:04</time></div>
        </div>
      </div>
    </section>

    <section class="gs-wrap gs-compare" id="how">
      <div class="gs-split-copy">
        <h2>Less chasing.<br>More cash.</h2>
        <p>Chasing yourself costs hours and goodwill. Agencies cost commission and clients. Settle takes three minutes to set up, then runs quietly in the background.</p>
        <ol class="gs-steps">
          <li><span>01</span><div><b>Connect your books</b>Two clicks to link Xero or QuickBooks. Read-only.</div></li>
          <li><span>02</span><div><b>Meet Sarah</b>Pick her name and tone. Preview every message.</div></li>
          <li><span>03</span><div><b>Get paid</b>Chases go out on schedule. You see every reply.</div></li>
        </ol>
      </div>
      <div class="bars" aria-label="Effort required from you, by approach">
        <div class="bar-col"><div class="bar-ico">${icon("clock", 18)}</div><div class="bar-track"><div class="bar" style="--h:88%"></div></div><span>Doing it yourself</span><em>Hours of awkward calls</em></div>
        <div class="bar-col"><div class="bar-ico">${icon("scale", 18)}</div><div class="bar-track"><div class="bar" style="--h:58%"></div></div><span>Collection agency</span><em>Commission, strained clients</em></div>
        <div class="bar-col brand"><div class="bar-ico gold">${icon("check", 18)}</div><div class="bar-track"><div class="bar" style="--h:16%"></div></div><span>Settle</span><em>3 minutes, then hands-off</em></div>
        <div class="bars-cap">Effort required from you</div>
      </div>
    </section>

    <section class="gs-wrap gs-stats">
      <div class="gs-stats-head" data-reveal>
        <span class="tag-chip plain"><span data-scramble>The numbers</span></span>
        <h2>Late payment is expensive.<br>The law knows it.</h2>
        <p>UK small businesses lose time, cash and sleep to invoices paid late. The Late Payment Act gives you the right to charge for it.</p>
      </div>
      ${[
        ["14,000", "UK small firms", "close every year because of late payment"],
        ["86", "hours a year", "the average SME spends chasing unpaid invoices"],
        ["8%", "over base rate", "statutory interest on every late business invoice"],
        ["£100", "per invoice", "fixed compensation on debts over £10,000 (£40–£70 below)"],
      ].map(([n, label, desc]) => html`<div class="stat-row" data-reveal><div class="stat-n">${odo(n)}</div><div class="stat-l">${label}</div><div class="stat-d">${desc}</div><i class="stat-line"></i></div>`)}
      <small class="muted">Business-failure and hours figures as reported by the UK Office of the Small Business Commissioner.</small>
    </section>

    <section class="gs-wrap gs-law" id="law">
      <div class="gs-split-copy">
        <h2>The law already says<br>they owe you more.</h2>
        <p>The Late Payment of Commercial Debts (Interest) Act 1998 lets UK businesses charge other businesses statutory interest at 8% over the Bank of England base rate, plus £40–£100 compensation per invoice. Almost nobody asks — Sarah does, politely, and offers to waive it if they pay by Friday.</p>
      </div>
      <div class="gs-card calc">
        <b class="calc-title">What can you claim on a late invoice?</b>
        <div class="calc-in">
          <label class="field">Invoice amount<input class="input num" id="c-amt" inputmode="decimal" value="4,500"></label>
          <label class="field">Days overdue<input class="input num" id="c-days" inputmode="numeric" value="45"></label>
        </div>
        <div class="out" id="c-out">${calcRows(null)}</div>
        <small class="muted">Illustrative. Applies to business-to-business debts without a contractual late-payment clause.</small>
      </div>
    </section>

    <section class="gs-wrap" id="pricing">
      <div class="gs-head"><h2>Pays for itself on<br>the first invoice.</h2><p>Recover one late payment and the month is covered. Cancel any time.</p></div>
      <div class="gs-pricing">
        <div class="gs-card plan">
          <span class="plan-name">Pay as you collect</span>
          <div class="price num">£199<small> / month + 2% of what we collect</small></div>
          <ul>${["WhatsApp and email chasing", "Xero and QuickBooks", "Late Payment Act claims", "Replies handled by Sarah"].map((f) => html`<li>${icon("check", 15)}${f}</li>`)}</ul>
          <a class="pill ghost" href="${cta}">Start free</a>
        </div>
        <div class="gs-card plan dark">
          <span class="plan-name">Unlimited</span>
          <div class="price num">£449<small> / month, flat</small></div>
          <ul>${["Everything in Pay as you collect", "No success fee, ever", "Multiple personas and brands", "Priority UK support"].map((f) => html`<li>${icon("check", 15)}${f}</li>`)}</ul>
          <a class="pill gold" href="${cta}">Start free</a>
        </div>
      </div>
      <p class="gs-guarantee">${icon("shield", 16)} If Settle doesn't collect at least one overdue invoice in your first 30 days, you pay nothing.</p>
    </section>

    <section class="gs-wrap gs-faq" id="faq">
      <h2>Questions</h2>
      <div class="faq">
        ${[
          ["Will it upset my clients?", "Sarah is polite, brief and human — never threatening. Messages reference the exact invoice and PO number, and you preview every stage before anything is sent."],
          ["Is charging statutory interest legitimate?", "Yes. The Late Payment of Commercial Debts (Interest) Act 1998 gives UK businesses the right to claim interest and fixed compensation from other businesses that pay late. Settle only mentions it after two friendly reminders, and you can switch it off."],
          ["What happens when a client replies?", "Promises to pay are logged and chasing pauses until that date. 'Already paid' is checked against your books. Disputes and questions she can't answer come straight to you."],
          ["Do I need WhatsApp Business?", "No. Messages go from Settle's verified WhatsApp Business number under your company name, and by email from Sarah."],
          ["What if it doesn't work?", "If Settle doesn't collect at least one overdue invoice in your first 30 days, you won't be charged."],
        ].map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}
      </div>
    </section>

    <section class="gs-wrap">
      <div class="gs-card cta-card">
        <div class="cta-copy">
          <h3>Start collecting what you're<br>owed, without the awkward chase.</h3>
          <p>See exactly what's overdue in the next three minutes.</p>
          <a class="pill" href="${cta}">Get started free</a>
        </div>
        <div class="cta-art">${coinStage(190)}</div>
      </div>
    </section>
  </main>

  <footer class="gs-foot">
    <div class="gs-wrap gs-foot-top">
      <p>Credit control for<br>UK businesses.</p>
      <div class="gs-foot-links">
        <div><b>Product</b><a href="#how">How it works</a><a href="#pricing">Pricing</a><a href="/login">Log in</a></div>
        <div><b>Legal</b><a href="#law">Late Payment Act</a><span>Not legal advice</span></div>
        <div><b>Contact</b><a href="mailto:hello@settle.co">Email</a><span>WhatsApp</span></div>
      </div>
    </div>
    <div class="gs-giant" aria-hidden="true">Settle</div>
  </footer>
  </div>`);

  revealOnScroll(app);
  if ($("#ascii")) asciiField($("#ascii"));
  const nav = $(".gs-nav");
  const onScroll = () => nav && nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Bars grow when scrolled into view
  const bars = $(".bars");
  if (bars && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { bars.classList.add("in"); io.disconnect(); } }, { threshold: .35 });
    io.observe(bars);
  } else bars?.classList.add("in");

  const update = debounce(async () => {
    if (!$("#c-amt")) return; // navigated away
    const amount = parseFloat($("#c-amt").value.replace(/[£,\s]/g, ""));
    const days = parseInt($("#c-days").value, 10);
    if (!(amount > 0) || !(days >= 0)) return;
    try {
      const c = await api(`/api/public/claim?amount=${amount}&days=${days}`);
      if ($("#c-out")) $("#c-out").innerHTML = val(calcRows(c));
    } catch { /* keep last result */ }
  }, 180);
  $("#c-amt").addEventListener("input", update);
  $("#c-days").addEventListener("input", update);
  update();
}

function calcRows(c) {
  if (!c) return html`<div class="sk" style="height:18px"></div><div class="sk" style="height:18px"></div><div class="sk" style="height:24px"></div>`;
  return html`
    <div class="line"><span>Statutory interest (${c.annual_rate.toFixed(2)}% a year)</span><span class="num">${gbp(c.interest, true)}</span></div>
    <div class="line"><span>Fixed compensation</span><span class="num">${gbp(c.compensation, true)}</span></div>
    <div class="line total"><span>You can claim</span><span class="num">${gbp(c.total_claim, true)}</span></div>
    <div class="muted" style="font-size:12.5px">Growing by ${gbp(Math.round(c.daily_interest), true)} every day it stays unpaid.</div>`;
}

// ================================================================= AUTH
async function authPage(mode) {
  const me = await loadMe();
  if (me) return go(me.org.provider ? "/app" : "/app/connect", { replace: true });
  const signup = mode === "signup";
  document.title = signup ? "Create your account — Settle" : "Log in — Settle";
  app.innerHTML = val(html`
  <div class="center-page">
    <header>${logo()}<span class="muted" style="font-size:13px">${signup ? html`Have an account? <a href="/login">Log in</a>` : html`New here? <a href="/signup">Create an account</a>`}</span></header>
    <div class="auth rise">
      <h1>${signup ? "Let's get you paid." : "Welcome back."}</h1>
      <p>${signup ? "Free to set up. You'll see what you're owed before you commit to anything." : "Log in to see what Sarah's been up to."}</p>
      <form id="auth-form" novalidate>
        ${signup ? html`
          <label class="field">Your name<input class="input" name="name" autocomplete="name" required autofocus></label>
          <label class="field">Business name<input class="input" name="company" autocomplete="organization" required></label>` : ""}
        <label class="field">Work email<input class="input" name="email" type="email" autocomplete="email" required ${signup ? "" : raw("autofocus")}></label>
        <label class="field">Password ${signup ? html`<span class="hint">At least 8 characters</span>` : ""}<input class="input" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" required minlength="8"></label>
        <p class="form-err" id="form-err"></p>
        <button class="btn primary lg" type="submit">${signup ? "Create account" : "Log in"} ${icon("arrow", 16)}</button>
      </form>
      ${signup ? html`<div class="trust" style="justify-content:center"><span>${icon("lock", 14)} Bank-grade encryption</span><span>${icon("shield", 14)} Read-only access to your books</span></div>` : ""}
    </div>
  </div>`);
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target, btn = form.querySelector("button");
    const body = Object.fromEntries(new FormData(form));
    $("#form-err").textContent = "";
    btn.classList.add("loading");
    try {
      await api(signup ? "/api/signup" : "/api/login", { method: "POST", body });
      const me = await loadMe(true);
      go(me.org.provider ? "/app" : "/app/connect", { replace: true });
    } catch (err) {
      $("#form-err").textContent = err.message;
      form.animate?.([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 240 });
    } finally { btn.classList.remove("loading"); }
  });
}

// ================================================================= ONBOARDING
const onbHeader = (step) => html`<header>${logo("/app")}<div class="progress" aria-label="Step ${step} of 3">${[1, 2, 3].map((i) => html`<i class="${i <= step ? "on" : ""}"></i>`)}</div><a class="btn ghost sm" href="/app">Skip to dashboard</a></header>`;

async function connectPage() {
  document.title = "Connect your books — Settle";
  const params = new URLSearchParams(location.search);
  const me = await loadMe(true);
  if (params.get("error")) toast("That didn't connect. Please try again.", { error: true });
  if (params.get("connected")) return scanAndReveal(params.get("connected"), () => api("/api/sync", { method: "POST" }));

  const i = me.integrations;
  app.innerHTML = val(html`
  <div class="center-page">${onbHeader(1)}
    <div class="onb rise">
      <h1>Where do you send<br>invoices from?</h1>
      <p class="sub">Settle reads your unpaid invoices. It never changes anything in your books.</p>
      <div class="choices">
        <button class="choice" data-p="xero"><span class="ico" style="background:#13b5ea">xero</span><span><div class="t">Xero</div><div class="d">${i.xero ? "Connect in two clicks" : "Needs Xero app keys on this server — see README"}</div></span><span class="go">${icon("arrow")}</span></button>
        <button class="choice" data-p="quickbooks"><span class="ico" style="background:#2ca01c">qb</span><span><div class="t">QuickBooks Online</div><div class="d">${i.quickbooks ? "Connect in two clicks" : "Needs Intuit app keys on this server — see README"}</div></span><span class="go">${icon("arrow")}</span></button>
        <button class="choice" data-p="demo"><span class="ico" style="background:var(--ink);color:var(--bg)">${icon("sparkle", 18)}</span><span><div class="t">Try it with sample data</div><div class="d">A realistic UK ledger — see the whole flow in 60 seconds</div></span><span class="go">${icon("arrow")}</span></button>
      </div>
      <div class="trust"><span>${icon("lock", 14)} Read-only, encrypted connection</span><span>${icon("shield", 14)} Nothing is sent until you say go</span></div>
    </div>
  </div>`);

  $$(".choice").forEach((b) => b.addEventListener("click", async () => {
    const p = b.dataset.p;
    if (p === "demo") return scanAndReveal("demo", () => api("/api/connect/demo", { method: "POST" }));
    try {
      b.style.opacity = .6;
      const { url } = await api(`/api/connect/${p}`, { method: "POST" });
      location.href = url;
    } catch (e) { b.style.opacity = 1; toast(e.message, { error: true, ms: 4200 }); }
  }));
}

async function scanAndReveal(provider, work) {
  const name = { xero: "Xero", quickbooks: "QuickBooks", demo: "sample ledger" }[provider] || "books";
  const steps = [`Connecting to ${name}`, "Reading open invoices", "Matching customer contacts", "Calculating what you're owed"];
  app.innerHTML = val(html`
  <div class="center-page">${onbHeader(1)}
    <div class="onb rise">
      <h1>Reading your books…</h1>
      <p class="sub">This usually takes a few seconds.</p>
      <div class="scan">${steps.map((s, i) => html`<div class="scan-row" id="scan-${i}"><span class="dot"></span>${s}</div>`)}</div>
    </div>
  </div>`);
  const job = work();
  for (let i = 0; i < steps.length; i++) {
    const row = $(`#scan-${i}`);
    row.classList.add("active");
    await sleep(reduced ? 50 : 650);
    if (i === steps.length - 1) {
      try { await job; } catch (e) {
        toast(e.message, { error: true, ms: 4500 });
        history.replaceState({}, "", "/app/connect");
        return connectPage();
      }
    }
    row.classList.remove("active");
    row.classList.add("done");
    row.querySelector(".dot").innerHTML = val(icon("check", 12));
  }
  history.replaceState({}, "", "/app/connect");
  await loadMe(true);
  const o = await api("/api/overview");
  await sleep(reduced ? 0 : 250);
  reveal(o);
}

function agingBar(b) {
  const parts = [["a0", b.current, "Not due"], ["a1", b["1_30"], "1–30 days"], ["a2", b["31_60"], "31–60"], ["a3", b["61_90"], "61–90"], ["a4", b["90_plus"], "90+"]];
  return html`<div class="aging">${parts.filter((p) => p[1] > 0).map(([c, v]) => html`<i class="${c}" style="flex:${v}"></i>`)}</div>
    <div class="aging-legend">${parts.filter((p) => p[1] > 0).map(([c, v, l]) => html`<span><i class="${c}"></i>${l} <b class="num" style="color:var(--ink)">${gbp(v)}</b></span>`)}</div>`;
}

function reveal(o) {
  document.title = "Here's what you're owed — Settle";
  if (!o.overdue_count) {
    app.innerHTML = val(html`<div class="center-page">${onbHeader(1)}<div class="onb rise">
      <h1>Nothing's overdue. Nice.</h1><p class="sub">You have ${gbp(o.open_total)} in open invoices that aren't due yet. Set up Sarah now and she'll step in the moment one slips.</p>
      <a class="btn primary lg" href="/app/setup">Set up your credit controller ${icon("arrow", 16)}</a></div></div>`);
    return;
  }
  app.innerHTML = val(html`
  <div class="center-page">${onbHeader(1)}
    <div class="onb">
      <p class="sub fade-in" style="margin:0">Right now, you're owed</p>
      <div class="reveal-amount num" id="rv-amt">${odoMoney(o.overdue_total)}</div>
      <p class="sub rise" style="animation-delay:.9s">across <b style="color:var(--ink)">${o.overdue_count} overdue invoices</b> from ${o.customers_overdue} customers. The oldest is <b style="color:var(--ink)">${o.oldest_days} days</b> late.</p>
      <div class="rise" style="animation-delay:1.1s">${agingBar(o.buckets)}</div>
      <div class="card bonus rise" style="animation-delay:1.3s">
        <span class="ico">${icon("scale")}</span>
        <div><b>+ ${gbp(o.statutory_available, true)} you're legally entitled to</b><div class="muted" style="font-size:13px">Statutory interest and compensation under the Late Payment Act 1998.</div></div>
      </div>
      <div class="rise" style="animation-delay:1.5s;margin-top:28px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <a class="btn primary lg" href="/app/setup">Meet your credit controller ${icon("arrow", 16)}</a>
        <span class="muted" style="font-size:13px">Nothing is sent yet.</span>
      </div>
    </div>
  </div>`);
  rollIn($("#rv-amt"));
}

async function setupPage() {
  document.title = "Meet your credit controller — Settle";
  const me = await loadMe(true);
  if (!me.org.provider) return go("/app/connect", { replace: true });
  const s = structuredClone(me.org.settings);
  let stage = 1;
  app.innerHTML = val(html`
  <div class="center-page">${onbHeader(2)}
    <div class="onb wide rise">
      <div class="persona-grid">
        <div>
          <h1>Meet your credit<br>controller.</h1>
          <p class="sub">Clients hear from a named person on your team — never "noreply". Everything here can be changed later.</p>
          <div class="persona-form">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <label class="field">Name<input class="input" id="p-name" value="${s.persona_name}" maxlength="40"></label>
              <label class="field">Role<input class="input" id="p-role" value="${s.persona_role}" maxlength="40"></label>
            </div>
            <div class="field" style="display:grid;gap:6px;font-size:13px;font-weight:500;color:var(--ink-2)">Tone
              <div class="seg" id="p-tone">${["gentle", "balanced", "firm"].map((t) => html`<button type="button" data-v="${t}" class="${s.tone === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`)}</div>
            </div>
            <div>
              ${optRow("p-wa", "WhatsApp", "Most clients reply within the hour", s.channels.whatsapp)}
              ${optRow("p-email", "Email", "A fuller version with invoice details, from " + s.persona_name, s.channels.email)}
              ${optRow("p-stat", "Late Payment Act", "Mention statutory interest and compensation from stage 3", s.statutory)}
              ${optRow("p-auto", "Let Sarah answer simple replies", "Promises and 'already paid'. Disputes always come to you.", s.autopilot)}
            </div>
          </div>
        </div>
        <div class="preview-phone">
          <div class="preview-tabs" id="p-stages">${["Nudge", "Follow-up", "By Friday", "Statutory", "Final"].map((l, i) => html`<button data-s="${i + 1}" class="${i === 0 ? "on" : ""}">${i + 1} · ${l}</button>`)}</div>
          <div class="phone">
            <div class="phone-top"><span class="avatar" id="pv-av">${initials(s.persona_name)}</span><div><b id="pv-title">${s.persona_name} · ${me.org.name}</b><div class="muted" style="font-size:12px" id="pv-to">WhatsApp</div></div></div>
            <div class="phone-body" id="pv-body"><div class="sk" style="height:120px;width:82%;align-self:flex-end;border-radius:10px"></div></div>
          </div>
        </div>
      </div>
      <div class="sticky-cta"><a class="btn ghost" href="/app/connect">Back</a><button class="btn primary lg" id="p-next">Review first batch ${icon("arrow", 16)}</button></div>
    </div>
  </div>`);

  const refresh = debounce(async () => {
    try {
      const p = await api("/api/preview", { method: "POST", body: { settings: s, stage } });
      $("#pv-to").textContent = `To ${p.customer} · WhatsApp`;
      $("#pv-body").innerHTML = val(html`<div class="bubble out fade-in">${linkify(p.whatsapp)}<time>09:12 <span class="tick">✓✓</span></time></div>`);
    } catch { /* ignore */ }
  }, 120);
  const sync = () => {
    s.persona_name = $("#p-name").value.trim() || "Sarah";
    s.persona_role = $("#p-role").value.trim() || "Accounts";
    s.channels = { whatsapp: $("#p-wa").checked, email: $("#p-email").checked };
    s.statutory = $("#p-stat").checked;
    s.autopilot = $("#p-auto").checked;
    $("#pv-av").textContent = initials(s.persona_name);
    $("#pv-title").textContent = `${s.persona_name} · ${me.org.name}`;
    refresh();
  };
  $$("#p-name, #p-role").forEach((el) => el.addEventListener("input", sync));
  $$("#p-wa, #p-email, #p-stat, #p-auto").forEach((el) => el.addEventListener("change", sync));
  $$("#p-tone button").forEach((b) => b.addEventListener("click", () => {
    s.tone = b.dataset.v; $$("#p-tone button").forEach((x) => x.classList.toggle("on", x === b)); refresh();
  }));
  $$("#p-stages button").forEach((b) => b.addEventListener("click", () => {
    stage = +b.dataset.s; $$("#p-stages button").forEach((x) => x.classList.toggle("on", x === b)); refresh();
  }));
  $("#p-next").addEventListener("click", (e) => busy(e.currentTarget, async () => {
    if (!s.channels.whatsapp && !s.channels.email) throw new Error("Turn on at least one channel");
    await api("/api/settings", { method: "PUT", body: { settings: s } });
    await loadMe(true);
    go("/app/golive");
  }));
  refresh();
}

const optRow = (id, t, d, on) => html`<div class="opt-row"><div><div class="t">${t}</div><div class="d">${d}</div></div><label class="switch"><input type="checkbox" id="${id}" ${on ? raw("checked") : ""}><span></span><span class="sr">${t}</span></label></div>`;

async function goLivePage() {
  document.title = "Go live — Settle";
  const me = await loadMe(true);
  if (!me.org.provider) return go("/app/connect", { replace: true });
  const s = me.org.settings;
  const { invoices } = await api("/api/invoices?filter=queued");
  const ready = invoices.filter((i) => i.days_overdue >= s.min_days_overdue);
  const excluded = new Set();
  const total = () => ready.filter((i) => !excluded.has(i.id)).reduce((a, i) => a + i.amount_due, 0);
  const count = () => ready.length - excluded.size;

  app.innerHTML = val(html`
  <div class="center-page">${onbHeader(3)}
    <div class="onb rise">
      <h1>${ready.length ? "Ready when you are." : "You're all set."}</h1>
      <p class="sub">${ready.length ? html`${s.persona_name} will start with these ${ready.length} invoices. Untick anyone you'd rather handle yourself.` : html`Nothing is overdue enough to chase yet. ${s.persona_name} will start automatically when something is.`}</p>
      ${ready.length ? html`<div class="card batch">${ready.map((i) => html`
        <label class="batch-row">
          <input type="checkbox" checked data-id="${i.id}">
          <span><b>${i.customer.name}</b><div class="muted" style="font-size:13px">${i.number} · ${i.days_overdue} days late · ${i.next ? i.next.label : ""}</div></span>
          <span class="muted" style="font-size:12px">${[i.customer.phone && "WhatsApp", i.customer.email && "Email"].filter(Boolean).join(" + ") || "No contact"}</span>
          <b class="num">${gbp(i.amount_due)}</b>
        </label>`)}</div>` : ""}
      <div class="sticky-cta">
        <span class="muted" id="gl-sum">${ready.length ? html`<b style="color:var(--ink)" class="num">${gbp(total())}</b> across ${count()} invoices` : ""}</span>
        <button class="btn green lg" id="gl-go">${icon("zap", 16)} Start chasing</button>
      </div>
    </div>
  </div>`);

  $$(".batch-row input").forEach((cb) => cb.addEventListener("change", () => {
    cb.checked ? excluded.delete(+cb.dataset.id) : excluded.add(+cb.dataset.id);
    $("#gl-sum").innerHTML = val(html`<b style="color:var(--ink)" class="num">${gbp(total())}</b> across ${count()} invoices`);
  }));
  $("#gl-go").addEventListener("click", (e) => busy(e.currentTarget, async () => {
    const r = await api("/api/golive", { method: "POST", body: { exclude: [...excluded] } });
    await loadMe(true);
    app.innerHTML = val(html`<div class="center-page">${onbHeader(3)}<div class="onb rise" style="text-align:center;padding-top:80px">
      <div class="pay"><div class="done">${icon("check", 26)}</div></div>
      <h1>${s.persona_name}'s on it.</h1>
      <p class="sub">${r.sent ? `${r.sent} ${r.sent === 1 ? "chase has" : "chases have"} just gone out. You'll see replies here the moment they land.`
        : r.in_hours ? "Nothing needed sending right now — Sarah will pick things up as they fall due."
        : `It's outside business hours, so the first messages go out at ${String(r.hours.start).padStart(2, "0")}:00 on the next working day.`}</p>
      <a class="btn primary lg" href="/app">Go to your dashboard ${icon("arrow", 16)}</a></div></div>`);
  }));
}

// ================================================================= APP SHELL (minimal top bar)
const NAV = [["overview", "/app", "Overview"], ["invoices", "/app/invoices", "Invoices"], ["activity", "/app/activity", "Activity"], ["settings", "/app/settings", "Settings"]];

function renderShell() {
  const me = state.me;
  if (!$(".shell")) {
    app.innerHTML = val(html`<div class="shell">
      <header class="topbar"><div class="topbar-in">
        <a href="/app" class="wordmark">Settle</a>
        <nav class="tabsnav" id="nav"></nav>
        <div class="topbar-right"><div id="live-card"></div>
          <button class="who" id="who" title="${me.user.email}" aria-label="Account">${initials(me.user.name)}</button></div>
      </div></header>
      <main class="main" id="main"></main>
    </div>
    <div class="scrim" id="scrim"></div>
    <aside class="drawer" id="drawer" aria-hidden="true"></aside>`);
    $("#who").addEventListener("click", async () => {
      if (!confirm(`Signed in as ${me.user.email}.\n\nLog out?`)) return;
      await api("/api/logout", { method: "POST" }); state.me = null; go("/");
    });
    $("#scrim").addEventListener("click", () => closeDrawer());
  }
  renderLiveCard();
  return $("#main");
}

function renderNav(active, attention = null) {
  $("#nav").innerHTML = val(NAV.map(([k, href, label]) => html`<a href="${href}" class="${k === active ? "on" : ""}">${label}${k === "invoices" && attention ? html`<i class="dot-count">${attention}</i>` : ""}</a>`));
}

function renderLiveCard() {
  const me = state.me, s = me.org.settings, live = me.org.live;
  $("#live-card").innerHTML = val(html`<button class="status-pill ${live ? "on" : ""}" id="live-toggle" title="${live ? "Click to pause all chasing" : "Click to resume chasing"}">
    <span class="pulse ${live ? "" : "off"}"></span>${live ? `${s.persona_name} is chasing` : "Paused"}</button>`);
  $("#live-toggle").addEventListener("click", async () => {
    const on = !state.me.org.live;
    try {
      await api("/api/pause-all", { method: "POST", body: { paused: !on } });
      state.me.org.live = on;
      renderLiveCard();
      toast(on ? `${s.persona_name} is back on it` : "Paused. Nothing will be sent.");
    } catch (err) { toast(err.message, { error: true }); }
  });
}

const providerLabel = (p) => ({ xero: "Connected to Xero", quickbooks: "Connected to QuickBooks", demo: "Sample data" }[p] || "Not connected");

async function shellPage(name, opts = {}) {
  const me = await loadMe();
  if (!me.org.provider) return go("/app/connect", { replace: true });
  const main = renderShell();
  renderNav(name, state.attention);
  document.title = `${NAV.find((n) => n[0] === name)[2]} — Settle`;
  if (name !== "invoices" || !opts.open) closeDrawer(false);
  scrollTo(0, 0);
  if (name === "overview") return overviewPage(main);
  if (name === "invoices") return invoicesPage(main, opts.open);
  if (name === "activity") return activityPage(main);
  if (name === "settings") return settingsPage(main);
}

function banners() {
  const me = state.me;
  const out = [];
  if (!me.org.live) out.push(html`<div class="note warn"><span>${me.org.settings.persona_name} isn't sending anything yet.</span><a href="/app/golive">Review and start →</a></div>`);
  if (me.org.provider === "demo") out.push(html`<div class="note"><span>You're using sample data. Messages are simulated.</span><a href="/app/connect">Connect your books →</a></div>`);
  return out;
}

// ---------------------------------------------------------------- charts
// Single-series bar chart: rounded data-ends on a shared baseline, a hover label
// per bar, values in ink (never in the bar colour), one optional green highlight.
function barChart(bars, { height = 180, label, valueLabels = "all", fmt = (v) => gbp(v) } = {}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const summary = `${label}: ` + bars.map((b) => `${b.label} ${fmt(b.value)}`).join(", ");
  const showValue = (b, i) => valueLabels === "all" || (valueLabels === "highlight" && (b.highlight || b.value === max && b.value > 0));
  return html`<div class="chart" role="img" aria-label="${summary}" style="--h:${height}px">
    <div class="chart-plot">${bars.map((b, i) => html`
      <div class="col ${b.highlight ? "hi" : ""}" tabindex="0" aria-label="${b.label}: ${fmt(b.value)}" style="--p:${b.value ? Math.max(2, (b.value / max) * 100) : 0}%">
        <span class="val ${showValue(b, i) ? "" : "hover-only"}">${fmt(b.value)}</span>
        <span class="bar"></span>
        ${b.tip ? html`<span class="tip">${b.tip}</span>` : ""}
      </div>`)}</div>
    <div class="chart-axis">${bars.map((b) => html`<span>${b.label}</span>`)}</div>
    <table class="sr"><caption>${label}</caption>${bars.map((b) => html`<tr><th>${b.label}</th><td>${fmt(b.value)}</td></tr>`)}</table>
  </div>`;
}

function animateCharts(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => $$(".chart", root).forEach((c) => c.classList.add("in"))));
}

const gbpShort = (p) => {
  const v = (p || 0) / 100;
  if (v >= 1e6) return `£${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e4) return `£${Math.round(v / 1000)}k`;
  if (v >= 1000) return `£${(v / 1000).toFixed(1)}k`;
  return `£${Math.round(v)}`;
};

// ---------------------------------------------------------------- overview
async function overviewPage(main) {
  const me = state.me, s = me.org.settings;
  main.innerHTML = val(html`<div class="page">
    ${banners()}
    <section class="hero-num"><div class="sk" style="height:14px;width:120px"></div><div class="sk" style="height:64px;width:300px;margin:14px 0"></div><div class="sk" style="height:16px;width:420px;max-width:100%"></div></section>
    <div id="ov-rest"></div></div>`);

  const [o, attn] = await Promise.all([api("/api/overview"), api("/api/invoices?filter=attention")]);
  state.attention = o.attention_count;
  renderNav("overview", o.attention_count);
  const persona = s.persona_name;

  const sentence = o.overdue_count
    ? html`${o.overdue_count} late ${o.overdue_count === 1 ? "invoice" : "invoices"} from ${o.customers_overdue} ${o.customers_overdue === 1 ? "customer" : "customers"}. ${me.org.live ? `${persona} is chasing them for you.` : `${persona} is ready to start.`}`
    : html`Nothing is late. ${persona} will step in the moment something is.`;

  $(".hero-num").outerHTML = val(html`<section class="hero-num fade-in">
    <div class="eyebrow-s mono" data-scramble>You're owed</div>
    <div class="big num">${odoMoney(o.overdue_total)}</div>
    <p>${sentence}${o.attention_count ? html` <a href="/app/invoices?f=attention" class="needs">${o.attention_count} ${o.attention_count === 1 ? "needs" : "need"} you →</a>` : ""}</p>
  </section>`);

  const b = o.buckets;
  const weeks = o.weekly_collected;
  const lastIdx = weeks.length - 1;
  const anyCollected = weeks.some((w) => w.amount > 0);

  $("#ov-rest").innerHTML = val(html`
    <div class="charts-2 fade-in">
      <section class="block">
        <h2>Where your money is</h2>
        <p class="hint">Late money, money promised by a date, and money ${persona} has collected.</p>
        ${barChart([
          { label: "Late", value: o.overdue_total - o.promised_total, tip: "Not promised yet" },
          { label: "Promised", value: o.promised_total, tip: `${o.promised_count} ${o.promised_count === 1 ? "customer" : "customers"} gave a date` },
          { label: "Collected", value: o.collected_total, highlight: true, tip: `${o.collected_count} paid after a chase` },
        ], { label: "Where your money is" })}
      </section>
      <section class="block">
        <h2>How late it is</h2>
        <p class="hint">Older debts are harder to collect. Days past the due date.</p>
        ${barChart([
          { label: "1–30d", value: b["1_30"] },
          { label: "31–60d", value: b["31_60"] },
          { label: "61–90d", value: b["61_90"] },
          { label: "90d+", value: b["90_plus"] },
        ], { label: "Overdue money by age" })}
      </section>
    </div>

    <section class="block fade-in">
      <div class="block-head"><div><h2>Collected each week</h2><p class="hint">Payments that came in after ${persona} chased. This week in green.</p></div>
        <div class="block-total"><span class="muted">Last 8 weeks</span><b class="num">${odo(gbp(weeks.reduce((a, w) => a + w.amount, 0)))}</b></div></div>
      ${anyCollected
        ? barChart(weeks.map((w, i) => ({ label: i === lastIdx ? "This week" : fmtDate(w.start), value: w.amount, highlight: i === lastIdx, tip: `Week of ${fmtDate(w.start, { day: "numeric", month: "long" })}` })), { label: "Collected each week", height: 150, valueLabels: "highlight", fmt: gbpShort })
        : html`<div class="chart-empty">${barChart(weeks.map((w, i) => ({ label: i === lastIdx ? "This week" : fmtDate(w.start), value: 0 })), { label: "Collected each week", height: 90, valueLabels: "none" })}<p>No payments yet. Most customers pay within a week of the first message.</p></div>`}
    </section>

    <div class="charts-2 fade-in">
      <section class="block">
        <div class="block-head"><h2>Needs you</h2>${attn.invoices.length ? html`<a href="/app/invoices?f=attention" class="more">All ${attn.invoices.length} →</a>` : ""}</div>
        ${attn.invoices.length ? html`<ul class="simple-list">${attn.invoices.slice(0, 5).map((i) => html`<li data-inv="${i.id}"><span class="dot amber"></span><div><b>${i.customer.name}</b><span>${attentionReason(i)}</span></div><em class="num">${gbp(i.amount_due)}</em></li>`)}</ul>`
          : html`<p class="calm">Nothing right now. ${persona} is handling everything.</p>`}
      </section>
      <section class="block">
        <div class="block-head"><h2>Latest</h2><a href="/app/activity" class="more">All activity →</a></div>
        ${feed(o.activity.slice(0, 5))}
      </section>
    </div>`);
  animateCharts(main);
  rollIn(main);
  $$("[data-scramble]", main).forEach((el) => scramble(el));
  $$("[data-inv]", main).forEach((el) => el.addEventListener("click", () => el.dataset.inv !== "null" && go(`/app/invoices/${el.dataset.inv}`)));
}

function attentionReason(i) {
  if (i.state === "disputed") return "Raised a query. Over to you.";
  if (i.stage >= 5) return "Final reminder sent. Worth a call.";
  if (!i.customer.phone && !i.customer.email) return "No phone or email to contact them.";
  if (i.state === "promised") return `Promised to pay ${fmtDay(i.promised_date)}.`;
  return "Asked for more time or had a question.";
}

// Plain-English activity lines
function feedLine(m) {
  const who = m.customer_name || "A customer";
  const persona = state.me.org.settings.persona_name;
  if (m.direction === "in") return [who, `replied: “${m.body.split("\n")[0]}”`, "in"];
  if (m.direction === "out") {
    if (m.meta.owner) return ["You", `messaged ${who}`, "out"];
    if (m.meta.agent) return [persona, `answered ${who}`, "out"];
    const stage = m.meta.stage ? ` (${["", "friendly nudge", "follow-up", "pay by Friday", "Late Payment Act claim", "final reminder"][m.meta.stage]})` : "";
    return [persona, `${m.channel === "whatsapp" ? "WhatsApped" : "emailed"} ${who}${stage}`, "out"];
  }
  if (m.meta.kind === "collected") return [who, `paid. ${m.body.split("—")[1]?.split(".")[0]?.trim() || "Collected"}.`, "ok"];
  if (m.meta.kind === "agent") return [persona, m.body.replace(/\.$/, "") + ".", m.meta.needs_owner ? "warn" : "sys"];
  return ["", m.body, m.meta.needs_owner || ["escalated", "unreachable"].includes(m.meta.kind) ? "warn" : "sys"];
}

function feed(items) {
  if (!items.length) return html`<p class="calm">Nothing yet. Messages and replies will show up here.</p>`;
  return html`<ul class="simple-list feed">${items.map((m) => {
    const [who, what, kind] = feedLine(m);
    return html`<li data-inv="${m.invoice_id}"><span class="dot ${kind}"></span><div><span class="line">${who ? html`<b>${who}</b> ` : ""}${what}</span></div><time>${ago(m.created_at)}</time></li>`;
  })}</ul>`;
}

// ---------------------------------------------------------------- invoices
const TABS = [["overdue", "Late"], ["attention", "Needs you"], ["promised", "Promised"], ["paid", "Paid"], ["upcoming", "Not due yet"]];

function statusText(i) {
  const persona = state.me.org.settings.persona_name;
  if (i.status === "paid") return i.state === "collected" ? ["ok", "Collected"] : ["", "Paid"];
  if (i.needs_attention) return ["amber", "Needs you"];
  if (i.state === "promised") return ["blue", `Promised ${fmtDay(i.promised_date)}`];
  if (i.state === "disputed") return ["amber", "Query raised"];
  if (i.state === "paused") return ["", "Paused"];
  if (i.state === "chasing") return ["green", `${persona} is chasing`];
  if (i.days_overdue <= 0) return ["", "Not due yet"];
  return ["", state.me.org.live ? "Starting soon" : "Waiting to start"];
}
const stateBadge = (i) => { const [c, t] = statusText(i); return html`<span class="status"><span class="dot ${c}"></span>${t}</span>`; };

function daysCell(i) {
  if (i.status === "paid") return html`<span class="muted">${fmtDate(i.paid_at)}</span>`;
  if (i.days_overdue <= 0) return html`<span class="muted">Due ${i.days_overdue === 0 ? "today" : fmtDate(i.due_date)}</span>`;
  return html`<span class="num ${i.days_overdue > 60 ? "late-very" : ""}">${i.days_overdue} days</span>`;
}

async function invoicesPage(main, openId) {
  const f = new URLSearchParams(location.search).get("f");
  if (f && TABS.some(([k]) => k === f)) state.invoiceFilter = f;
  if (!$("#inv-page", main)) {
    main.innerHTML = val(html`<div class="page" id="inv-page">
      ${banners()}
      <div class="page-title"><h1>Invoices</h1>
        <div class="search">${icon("search")}<input class="input" id="q" placeholder="Search" value="${state.search}" autocomplete="off"><kbd>/</kbd></div></div>
      <div class="pills" id="tabs"></div>
      <div id="inv-table"></div></div>`);
    $("#q").addEventListener("input", (e) => { state.search = e.target.value; state.kbIndex = -1; drawTable(); });
    loadInvoices(true);
  }
  if (openId) openDrawer(openId);
}

async function loadInvoices(skeleton = false) {
  if (skeleton) {
    $("#inv-table").innerHTML = val(html`<div class="list">${[...Array(6)].map(() => html`<div class="list-row"><div class="sk" style="height:16px;width:200px"></div><div class="sk" style="height:16px;width:80px;margin-left:auto"></div></div>`)}</div>`);
    drawTabs({});
  }
  const data = await api(`/api/invoices?filter=${state.invoiceFilter}`);
  state.listCache = data;
  state.attention = data.counts.attention;
  renderNav("invoices", data.counts.attention);
  drawTabs(data.counts);
  drawTable();
}

function drawTabs(counts) {
  const el = $("#tabs");
  if (!el) return;
  el.innerHTML = val(TABS.map(([k, l]) => html`<button class="pill-tab ${state.invoiceFilter === k ? "on" : ""}" data-f="${k}">${l}${counts[k] ? html` <span class="num">${counts[k]}</span>` : ""}</button>`));
  $$(".pill-tab", el).forEach((b) => b.addEventListener("click", () => {
    state.invoiceFilter = b.dataset.f; state.kbIndex = -1;
    history.replaceState({}, "", "/app/invoices" + (b.dataset.f === "overdue" ? "" : `?f=${b.dataset.f}`));
    loadInvoices(); drawTabs(counts);
  }));
}

function filtered() {
  const q = state.search.trim().toLowerCase();
  const rows = state.listCache?.invoices || [];
  if (!q) return rows;
  return rows.filter((i) => [i.customer.name, i.customer.contact_name, i.number, i.reference].join(" ").toLowerCase().includes(q));
}

function drawTable() {
  const el = $("#inv-table");
  if (!el || !state.listCache) return;
  const rows = filtered();
  if (!rows.length) {
    const msg = state.search ? "No invoices match that search." : {
      overdue: "Nothing is late. Nice.", attention: "Nothing needs you right now.",
      promised: "No promises yet. When a customer gives a date, it shows here.",
      paid: "No payments yet.", upcoming: "No invoices waiting to fall due.",
    }[state.invoiceFilter];
    el.innerHTML = val(html`<p class="calm fade-in" style="padding:48px 0;text-align:center">${msg}</p>`);
    return;
  }
  const total = rows.reduce((a, i) => a + (i.status === "paid" ? i.collected_amount || i.total : i.amount_due), 0);
  el.innerHTML = val(html`<div class="list fade-in">
    <div class="list-head"><span>Customer</span><span class="hide-m">Late by</span><span class="hide-m">Status</span><span class="r">Amount</span></div>
    ${rows.map((i, n) => html`<div class="list-row row ${state.drawerId === i.id ? "sel" : ""} ${state.kbIndex === n ? "kb" : ""}" tabindex="0" data-id="${i.id}">
      <div class="who-cell"><b>${i.customer.name}</b><span>${i.number}${i.reference ? ` · ${i.reference}` : ""}</span></div>
      <div class="hide-m">${daysCell(i)}</div>
      <div class="hide-m">${stateBadge(i)}</div>
      <div class="r"><b class="num amt">${gbp(i.status === "paid" ? i.collected_amount || i.total : i.amount_due, true)}</b><span class="show-m">${stateBadge(i)}</span></div>
    </div>`)}
    <div class="list-foot"><span>${rows.length} ${rows.length === 1 ? "invoice" : "invoices"}</span><b class="num">${gbp(total, true)}</b></div>
  </div>`);
  $$(".row", el).forEach((r) => {
    r.addEventListener("click", () => go(`/app/invoices/${r.dataset.id}`));
    r.addEventListener("keydown", (e) => { if (e.key === "Enter") go(`/app/invoices/${r.dataset.id}`); });
  });
}

// keyboard: / search, j/k move, enter open, esc close
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === "Escape") {
    if (state.drawerId) { e.preventDefault(); closeDrawer(); }
    else if (typing) document.activeElement.blur();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || !$("#inv-page")) return;
  if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
  const rows = $$("#inv-table .row");
  if ((e.key === "j" || e.key === "k") && rows.length) {
    state.kbIndex = Math.max(0, Math.min(rows.length - 1, state.kbIndex + (e.key === "j" ? 1 : -1)));
    rows.forEach((r, n) => r.classList.toggle("kb", n === state.kbIndex));
    rows[state.kbIndex].scrollIntoView({ block: "nearest" });
    if (state.drawerId) go(`/app/invoices/${rows[state.kbIndex].dataset.id}`, { replace: true });
  }
  if (e.key === "Enter" && state.kbIndex >= 0 && rows[state.kbIndex]) go(`/app/invoices/${rows[state.kbIndex].dataset.id}`);
});

// ---------------------------------------------------------------- drawer
function closeDrawer(navigate = true) {
  const d = $("#drawer");
  if (!d) return;
  state.drawerId = null;
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  $("#scrim")?.classList.remove("open");
  $$(".row.sel").forEach((r) => r.classList.remove("sel"));
  if (navigate && location.pathname.startsWith("/app/invoices/")) go("/app/invoices", { replace: true });
}

async function openDrawer(id) {
  const d = $("#drawer");
  const switching = state.drawerId && state.drawerId !== id;
  state.drawerId = id;
  $$(".row").forEach((r) => r.classList.toggle("sel", +r.dataset.id === id));
  if (!switching) d.innerHTML = val(html`<div class="d-head"><div class="sk" style="height:16px;width:40%"></div><div class="sk" style="height:32px;width:55%;margin:14px 0 8px"></div><div class="sk" style="height:14px;width:70%"></div></div><div class="thread" style="flex:1"></div>`);
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("open");
  try {
    const inv = await api(`/api/invoices/${id}`);
    if (state.drawerId === id) drawDrawer(inv);
  } catch { closeDrawer(); }
}

function groupByDay(messages) {
  const out = [];
  let last = "";
  for (const m of messages) {
    const day = new Date(m.created_at).toDateString();
    if (day !== last) {
      const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString();
      out.push({ day: day === today ? "Today" : day === yest ? "Yesterday" : fmtDate(m.created_at, { weekday: "long", day: "numeric", month: "long" }) });
      last = day;
    }
    out.push(m);
  }
  return out;
}

function threadItem(m) {
  if (m.day) return html`<div class="day">${m.day}</div>`;
  const persona = state.me.org.settings.persona_name;
  const sim = m.status === "simulated" ? html` · <span class="status-sim">simulated</span>` : m.status === "failed" ? html` · <span style="color:var(--red)">failed</span>` : "";
  if (m.direction === "system") {
    const cls = m.meta.kind === "collected" || m.meta.kind === "paid" ? "ok" : m.meta.needs_owner || ["escalated", "unreachable"].includes(m.meta.kind) ? "warn" : "";
    return html`<div class="sys ${cls}">${m.meta.kind === "agent" ? html`${icon("sparkle", 12)} ` : ""}${m.body}</div>`;
  }
  if (m.channel === "email") {
    return html`<details class="email-card"><summary>${icon("mail", 14)}<span class="s">${m.subject}</span><span class="muted" style="font-size:11.5px">${clock(m.created_at)}${sim}</span></summary><pre>${linkify(m.body)}</pre></details>`;
  }
  const who = m.direction === "in" ? "" : m.meta.owner ? "You" : m.meta.agent ? `${persona} · auto-reply` : persona;
  return html`<div class="bubble ${m.direction} ${m.meta.agent ? "agent" : ""}">${who ? html`<span class="who">${who}</span>` : ""}${linkify(m.body)}<time>${clock(m.created_at)}${m.direction === "out" ? html` <span class="tick">✓✓</span>` : ""}${sim}</time></div>`;
}

const STEPS = ["Nudge", "Follow-up", "By Friday", "Late Payment Act", "Final"];

function stepper(inv) {
  const nextStage = inv.next?.stage || 0;
  return html`<ol class="stepper" aria-label="Chase progress">${STEPS.map((s, i) => {
    const n = i + 1;
    const cls = n <= inv.stage ? "done" : n === nextStage ? "next" : "";
    return html`<li class="${cls}"><span></span>${s}</li>`;
  })}</ol>`;
}

function drawerSummary(inv, persona) {
  const today = new Date().toISOString().slice(0, 10);
  const when = (d) => (d <= today ? (state.me.org.live ? "in the next business hours" : "once you start") : `on ${fmtDay(d)}`);
  if (inv.status === "paid") return inv.state === "collected" ? `Paid ${fmtDate(inv.paid_at)} after ${persona} chased. Nothing more to do.` : `Paid ${fmtDate(inv.paid_at)}.`;
  if (inv.state === "disputed") return `${firstName(inv.customer.contact_name) || "They"} raised a query. ${persona} has stopped until you reply.`;
  if (inv.state === "paused") return `Paused. ${persona} won't send anything until you resume.`;
  if (inv.state === "promised") return `Promised to pay on ${fmtDay(inv.promised_date)}. ${persona} checks in the day after if it hasn't arrived.`;
  if (inv.stage >= 5) return `${persona} has sent the final reminder. It's over to you now — a quick call usually does it.`;
  if (inv.days_overdue <= 0) return `Not due yet. If it isn't paid on time, ${persona} sends a friendly nudge ${inv.next?.date ? `on ${fmtDay(inv.next.date)}` : "a few days later"}.`;
  if (!inv.stage) return `Not contacted yet. ${persona} sends a ${inv.next?.label.toLowerCase() || "first message"} ${inv.next?.date ? when(inv.next.date) : "soon"}.`;
  return `${persona} has sent ${inv.stage} ${inv.stage === 1 ? "reminder" : "reminders"}. Next: ${inv.next?.label.toLowerCase()} ${inv.next?.date ? when(inv.next.date) : ""}.`;
}

function drawDrawer(inv) {
  const d = $("#drawer");
  const persona = state.me.org.settings.persona_name;
  const open = inv.status === "open";
  const demo = state.me.org.provider === "demo";
  const c = inv.claim;
  const replyMode = d.dataset.mode || (demo ? "customer" : "owner");

  d.innerHTML = val(html`
    <div class="d-head">
      <div class="top"><span class="muted num" style="font-size:13px">${inv.number}${inv.reference ? ` · ${inv.reference}` : ""}</span><button class="btn ghost sm" id="d-close" aria-label="Close">${icon("x", 16)}</button></div>
      <div class="amt num">${odoMoney(open ? inv.amount_due : inv.collected_amount || inv.total)}</div>
      <div class="meta"><b style="color:var(--ink)">${inv.customer.name}</b>${inv.customer.contact_name ? html`<span>· ${inv.customer.contact_name}</span>` : ""}${open && inv.days_overdue > 0 ? html`<span>· ${inv.days_overdue} days late</span>` : ""}</div>
      <p class="d-summary">${drawerSummary(inv, persona)}</p>
      ${open ? stepper(inv) : ""}
      ${open && inv.preview ? html`<button class="linkish" id="pv-toggle">See ${persona}'s next message</button><div class="preview-box" id="pv" hidden><div class="bubble out">${linkify(inv.preview.whatsapp)}</div></div>` : ""}
      ${open ? html`<div class="d-actions">
        ${inv.days_overdue > 0 && inv.stage < 5 && inv.state !== "disputed" ? html`<button class="btn sm primary" data-act="chase-now">${icon("send", 14)} Chase now</button>` : ""}
        ${inv.state === "paused" || inv.state === "disputed" ? html`<button class="btn sm" data-act="resume">${icon("play", 14)} Resume chasing</button>` : html`<button class="btn sm" data-act="pause">${icon("pause", 14)} Pause</button>`}
        <button class="btn sm" data-act="mark-paid">${icon("check", 14)} Mark paid</button>
        ${inv.needs_attention ? html`<button class="btn sm ghost" data-act="resolve">Dismiss alert</button>` : ""}
      </div>` : ""}
    </div>
    <div class="d-body" id="d-body">
      ${open && c && c.days_late > 0 ? html`<div class="d-section"><h4>Late Payment Act</h4>
        <div class="kv num"><span>Statutory interest (${c.annual_rate.toFixed(2)}%)</span><span>${gbp(c.interest, true)}</span><span>Fixed compensation</span><span>${gbp(c.compensation, true)}</span><span class="tot">Claimable now</span><span class="tot">${gbp(c.total_claim, true)}</span></div>
        <div class="muted" style="font-size:12px;margin-top:8px">${state.me.org.settings.statutory ? `${persona} mentions this from stage 3.` : "Mentions are switched off in Settings."} Accrues ${gbp(Math.round(c.daily_interest), true)} a day.</div></div>` : ""}
      <div class="d-section" style="padding-bottom:10px"><h4>Contact</h4>
        <div class="kv"><span>Mobile</span><span>${inv.customer.phone || html`<button class="linkish" id="add-contact">Add number</button>`}</span><span>Email</span><span>${inv.customer.email || "—"}</span><span>Due</span><span>${fmtDate(inv.due_date, { day: "numeric", month: "long", year: "numeric" })}</span></div>
      </div>
      <div class="thread" id="thread">${inv.messages.length ? groupByDay(inv.messages).map(threadItem) : html`<div class="sys">No messages yet. ${open ? `${persona} will start ${inv.next?.date ? "on " + fmtDay(inv.next.date) : "soon"}.` : ""}</div>`}</div>
    </div>
    ${open ? html`<div class="composer">
      ${demo ? html`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="seg" id="mode"><button data-m="customer" class="${replyMode === "customer" ? "on" : ""}">Reply as customer</button><button data-m="owner" class="${replyMode === "owner" ? "on" : ""}">Message as ${persona}</button></div><span class="muted" style="font-size:11.5px">Demo</span></div>` : ""}
      ${demo && replyMode === "customer" ? html`<div class="chips">${["Sorry! Will pay on Friday", "We paid this yesterday", "The invoice is wrong, we're missing a credit note", "Can we pay in two instalments?"].map((t) => html`<button class="chip" data-t="${t}">${t}</button>`)}</div>` : ""}
      <form class="row2" id="compose"><textarea class="input" id="msg" rows="1" placeholder="${demo && replyMode === "customer" ? `What does ${firstName(inv.customer.contact_name) || "the customer"} say?` : `Message ${inv.customer.contact_name || inv.customer.name} on WhatsApp as ${persona}`}"></textarea><button class="btn primary" style="height:40px;width:40px;padding:0" aria-label="Send">${icon("send", 16)}</button></form>
    </div>` : ""}`);

  rollIn(d);
  const body = $("#d-body");
  body.scrollTop = body.scrollHeight;
  $("#d-close").addEventListener("click", () => closeDrawer());
  $("#pv-toggle")?.addEventListener("click", (e) => { const p = $("#pv"); p.hidden = !p.hidden; e.target.textContent = p.hidden ? `See ${persona}'s next message` : "Hide message"; });
  $("#add-contact")?.addEventListener("click", () => editContact(inv));
  $$("[data-act]", d).forEach((b) => b.addEventListener("click", () => busy(b, async () => {
    const act = b.dataset.act;
    const updated = await api(`/api/invoices/${inv.id}/${act}`, { method: "POST" });
    toast({ "chase-now": "Sent", pause: "Chasing paused", resume: "Chasing resumed", "mark-paid": updated.state === "collected" ? `Collected ${gbp(updated.collected_amount)} 🎉` : "Marked as paid", resolve: "Dismissed" }[act]);
    drawDrawer(updated);
    loadInvoices();
  })));
  $$("#mode button", d).forEach((b) => b.addEventListener("click", () => { d.dataset.mode = b.dataset.m; drawDrawer(inv); $("#msg")?.focus(); }));
  $$(".chip", d).forEach((b) => b.addEventListener("click", () => { $("#msg").value = b.dataset.t; send(); }));

  const ta = $("#msg");
  if (!ta) return;
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; };
  ta.addEventListener("input", grow);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $("#compose").addEventListener("submit", (e) => { e.preventDefault(); send(); });

  async function send() {
    const text = ta.value.trim();
    if (!text) return;
    const asCustomer = demo && (d.dataset.mode || "customer") === "customer";
    // Optimistic bubble
    $("#thread").insertAdjacentHTML("beforeend", val(html`<div class="bubble ${asCustomer ? "in" : "out"} fade-in">${text}<time>${clock(new Date().toISOString())}</time></div>`));
    if (asCustomer) $("#thread").insertAdjacentHTML("beforeend", val(html`<div class="sys fade-in" id="typing">${icon("sparkle", 12)} ${persona} is reading…</div>`));
    body.scrollTop = body.scrollHeight;
    ta.value = ""; grow();
    try {
      const updated = await api(`/api/invoices/${inv.id}/${asCustomer ? "simulate" : "reply"}`, { method: "POST", body: { text } });
      if (asCustomer && !reduced) await sleep(450);
      drawDrawer(updated);
      loadInvoices();
    } catch (e) { toast(e.message, { error: true }); drawDrawer(inv); }
  }
}

function editContact(inv) {
  const box = $("#add-contact").closest(".d-section");
  box.innerHTML = val(html`<h4>Contact</h4><form id="cf" style="display:grid;gap:10px">
    <label class="field">Contact name<input class="input" name="contact_name" value="${inv.customer.contact_name || ""}"></label>
    <label class="field">Mobile<input class="input" name="phone" placeholder="07700 900123" value="${inv.customer.phone || ""}" autofocus></label>
    <label class="field">Email<input class="input" name="email" type="email" value="${inv.customer.email || ""}"></label>
    <div style="display:flex;gap:8px"><button class="btn primary sm">Save</button><button type="button" class="btn sm ghost" id="cf-cancel">Cancel</button></div></form>`);
  $("#cf-cancel").addEventListener("click", () => drawDrawer(inv));
  $("#cf").addEventListener("submit", (e) => {
    e.preventDefault();
    busy(e.submitter || $("#cf button"), async () => {
      await api(`/api/customers/${inv.customer.id}`, { method: "PUT", body: Object.fromEntries(new FormData(e.target)) });
      toast("Contact saved");
      drawDrawer(await api(`/api/invoices/${inv.id}`));
      loadInvoices();
    });
  });
}

// ---------------------------------------------------------------- activity
async function activityPage(main) {
  main.innerHTML = val(html`<div class="page">${banners()}<div class="page-title"><h1>Activity</h1></div>
    <div id="act"><div class="sk" style="height:20px;margin:14px 0"></div><div class="sk" style="height:20px;margin:14px 0"></div><div class="sk" style="height:20px;margin:14px 0"></div></div></div>`);
  const { activity } = await api("/api/activity");
  const days = [];
  for (const m of activity) {
    const key = new Date(m.created_at).toDateString();
    if (!days.length || days[days.length - 1].key !== key) days.push({ key, items: [] });
    days[days.length - 1].items.push(m);
  }
  const label = (key) => key === new Date().toDateString() ? "Today" : key === new Date(Date.now() - 864e5).toDateString() ? "Yesterday" : new Date(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  $("#act").innerHTML = val(days.length ? days.map((d) => html`<section class="day-group fade-in"><h3>${label(d.key)}</h3>${feed(d.items)}</section>`) : feed([]));
  $$("[data-inv]", main).forEach((el) => el.addEventListener("click", () => el.dataset.inv !== "null" && go(`/app/invoices/${el.dataset.inv}`)));
}

// ---------------------------------------------------------------- settings
async function settingsPage(main) {
  const data = await api("/api/settings");
  const org = data.org, s = structuredClone(org.settings), i = data.integrations;
  main.innerHTML = val(html`<div class="page"><div class="page-title"><h1>Settings</h1><span class="muted">Changes save automatically</span></div>
    <div class="settings fade-in">
      <div class="card panel"><h3>Your credit controller</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:8px 0 16px">
          <label class="field">Business name<input class="input" id="s-org" value="${org.name}"></label>
          <label class="field">Persona name<input class="input" id="s-name" value="${s.persona_name}"></label>
          <label class="field">Role<input class="input" id="s-role" value="${s.persona_role}"></label>
        </div>
        <div class="opt-row"><div><div class="t">Tone</div><div class="d">How direct ${s.persona_name} is from the first message</div></div><div class="seg" id="s-tone">${["gentle", "balanced", "firm"].map((t) => html`<button data-v="${t}" class="${s.tone === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`)}</div></div>
        ${optRow("s-wa", "WhatsApp", i.whatsapp ? "Connected to WhatsApp Business" : "Simulated until WhatsApp keys are added on the server", s.channels.whatsapp)}
        ${optRow("s-email", "Email", i.email ? "Sent via your SMTP provider" : "Simulated until SMTP is configured on the server", s.channels.email)}
        ${optRow("s-stat", "Late Payment Act", "Mention statutory interest and compensation from stage 3", s.statutory)}
        ${optRow("s-auto", "Autopilot replies", `${s.persona_name} answers promises and 'already paid' messages. Disputes always come to you.`, s.autopilot)}
        <div class="opt-row"><div><div class="t">Reply-to email</div><div class="d">Where email replies from customers land</div></div><input class="input" id="s-reply" style="max-width:260px" value="${s.reply_to}" type="email"></div>
      </div>
      <div class="card panel"><h3>Schedule</h3>
        <div class="cadence">${data.stages.map((st) => html`<div><b>${st.label}</b><span>${st.stage === 1 ? `${Math.max(st.days, s.min_days_overdue)}+` : `${st.days}+`} days late</span></div>`)}</div>
        <div class="opt-row"><div><div class="t">Start chasing after</div><div class="d">Days past the due date before the first nudge</div></div><div style="display:flex;align-items:center;gap:8px"><input class="input num" id="s-min" type="number" min="1" max="30" style="width:72px" value="${s.min_days_overdue}"><span class="muted">days</span></div></div>
        <div class="opt-row"><div><div class="t">Business hours</div><div class="d">Messages only go out Monday–Friday, UK time</div></div><div style="display:flex;align-items:center;gap:8px"><input class="input num" id="s-h1" type="number" min="0" max="23" style="width:64px" value="${s.hours.start}"><span class="muted">to</span><input class="input num" id="s-h2" type="number" min="1" max="24" style="width:64px" value="${s.hours.end}"></div></div>
      </div>
      <div class="card panel"><h3>Connections</h3>
        <div class="integr"><span class="ico" style="background:${org.provider === "quickbooks" ? "#2ca01c" : org.provider === "xero" ? "#13b5ea" : "var(--ink)"}">${org.provider === "quickbooks" ? "qb" : org.provider === "xero" ? "xero" : icon("sparkle", 14)}</span><div class="grow"><b>${providerLabel(org.provider)}</b><div class="muted" style="font-size:13px">${org.last_synced_at ? `Last synced ${ago(org.last_synced_at)}` : "Not synced yet"}</div></div><button class="btn sm" id="s-sync">${icon("refresh", 14)} Sync now</button><a class="btn sm" href="/app/connect">Change</a></div>
        <div class="integr"><span class="ico" style="background:#25d366">${icon("msg", 14)}</span><div class="grow"><b>WhatsApp Business</b><div class="muted" style="font-size:13px">${i.whatsapp ? "Live" : "Not configured — messages are simulated"}</div></div><span class="badge ${i.whatsapp ? "green" : ""}">${i.whatsapp ? "Live" : "Simulated"}</span></div>
        <div class="integr"><span class="ico" style="background:#6b7280">${icon("mail", 14)}</span><div class="grow"><b>Email</b><div class="muted" style="font-size:13px">${i.email ? "Live" : "Not configured — messages are simulated"}</div></div><span class="badge ${i.email ? "green" : ""}">${i.email ? "Live" : "Simulated"}</span></div>
        <div class="integr"><span class="ico" style="background:#d97757">${icon("sparkle", 14)}</span><div class="grow"><b>Reply understanding</b><div class="muted" style="font-size:13px">${i.agent ? "Claude reads and answers replies" : "Built-in rules (add ANTHROPIC_API_KEY for Claude)"}</div></div><span class="badge ${i.agent ? "green" : ""}">${i.agent ? "Claude" : "Rules"}</span></div>
      </div>
    </div></div>`);

  const save = debounce(async () => {
    try {
      const r = await api("/api/settings", { method: "PUT", body: { settings: s, name: $("#s-org").value.trim() } });
      state.me.org = r.org;
      renderLiveCard();
      toast("Saved", { ms: 1200 });
    } catch (e) { toast(e.message, { error: true }); }
  }, 500);
  const bind = (id, fn, ev = "input") => $(id).addEventListener(ev, () => { fn($(id)); save(); });
  bind("#s-org", () => {});
  bind("#s-name", (el) => { s.persona_name = el.value; });
  bind("#s-role", (el) => { s.persona_role = el.value; });
  bind("#s-reply", (el) => { s.reply_to = el.value.trim(); });
  bind("#s-wa", (el) => { s.channels.whatsapp = el.checked; }, "change");
  bind("#s-email", (el) => { s.channels.email = el.checked; }, "change");
  bind("#s-stat", (el) => { s.statutory = el.checked; }, "change");
  bind("#s-auto", (el) => { s.autopilot = el.checked; }, "change");
  bind("#s-min", (el) => { s.min_days_overdue = +el.value || 3; });
  bind("#s-h1", (el) => { s.hours.start = +el.value; });
  bind("#s-h2", (el) => { s.hours.end = +el.value; });
  $$("#s-tone button").forEach((b) => b.addEventListener("click", () => { s.tone = b.dataset.v; $$("#s-tone button").forEach((x) => x.classList.toggle("on", x === b)); save(); }));
  $("#s-sync").addEventListener("click", (e) => busy(e.currentTarget, async () => { const r = await api("/api/sync", { method: "POST" }); toast(`Synced ${r.count} invoices`); }));
}

// ---------------------------------------------------------------- boot
render();

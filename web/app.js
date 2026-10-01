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

// ================================================================= LANDING
async function landing() {
  document.title = "Settle — Get paid without the awkward chase";
  const me = await loadMe();
  app.innerHTML = val(html`
  <header class="site-nav"><div class="site">
    ${logo()}
    <nav><a href="#how">How it works</a><a href="#law">The law</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav>
    <div class="right">
      ${me ? html`<a class="btn primary" href="/app">Open Settle ${icon("arrow", 14)}</a>`
           : html`<a class="btn ghost" href="/login">Log in</a><a class="btn primary" href="/signup">Start free</a>`}
    </div>
  </div></header>

  <main>
    <section class="hero site">
      <span class="eyebrow rise"><b>New</b> Late Payment Act interest, calculated for you</span>
      <h1 class="rise" style="animation-delay:.05s">Get paid without<br>the <em>awkward</em> chase.</h1>
      <p class="lead rise" style="animation-delay:.1s">Connect Xero or QuickBooks in two clicks. Settle becomes <b>Sarah from Accounts</b> — a calm, polite credit controller who chases every overdue invoice on WhatsApp and email, so you never have to.</p>
      <div class="ctas rise" style="animation-delay:.15s">
        <a class="btn primary lg" href="${me ? "/app" : "/signup"}">See what you're owed ${icon("arrow", 16)}</a>
        <a class="btn lg" href="#how">How it works</a>
      </div>
      <div class="fine rise" style="animation-delay:.2s">Set up in 3 minutes · No card needed · If we don't collect, you don't pay</div>

      <div class="showcase">
        <div class="phone" aria-label="Example WhatsApp conversation">
          <div class="phone-top"><span class="avatar">S</span><div><b>Sarah · Brightside Ltd</b><div class="muted" style="font-size:12px">WhatsApp Business</div></div></div>
          <div class="phone-body">
            <div class="bubble out">Hi Olivia, it's Sarah from Brightside 👋 Just a quick nudge that invoice INV-1042 (PO-8812) for £8,450.00 was due on 28 July. Would you mind taking a look when you get a sec?<time>09:12 <span class="tick">✓✓</span></time></div>
            <div class="bubble in">Oh no — so sorry Sarah, that got stuck in approvals. I'll get it paid on Friday.<time>09:31</time></div>
            <div class="bubble out">Thanks Olivia, much appreciated. I've noted INV-1042 for payment on Friday 3 October. Here's the link in case it helps: pay.settle.co/k2x9<time>09:31 <span class="tick">✓✓</span></time></div>
            <div class="bubble in">Paid ✅<time>Fri 10:04</time></div>
          </div>
        </div>
        <div class="show-side">
          <div class="card stat-card"><div class="k">Overdue right now</div><div class="v num">£38,420<small>.50</small></div><div class="muted" style="font-size:13px">11 invoices · 10 customers</div>
            <div class="aging" style="margin-top:14px"><i class="a1" style="flex:9"></i><i class="a2" style="flex:14"></i><i class="a3" style="flex:5"></i><i class="a4" style="flex:11"></i></div></div>
          <div class="card stat-card collected-flash"><div class="k" style="color:var(--green)">Collected by Sarah this week</div><div class="v num" style="color:var(--green)">£14,690<small>.00</small></div><div class="muted" style="font-size:13px">Zero awkward phone calls</div></div>
          <div class="card stat-card"><div class="k">Late Payment Act claim available</div><div class="v num">£1,312<small>.77</small></div><div class="muted" style="font-size:13px">Interest + fixed compensation you're entitled to</div></div>
        </div>
      </div>
    </section>

    <section class="section site" style="padding-top:64px">
      <div class="facts">
        <div><b>14,000</b><span>UK small firms close every year because of late payment</span></div>
        <div><b>86 hours</b><span>the average SME spends each year chasing unpaid invoices</span></div>
        <div><b>£40–£100</b><span>compensation per late invoice, plus 8% over base — the law's on your side</span></div>
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px">Figures as reported by the UK Office of the Small Business Commissioner.</p>
    </section>

    <section class="section site" id="how">
      <h2>Three minutes to set up.<br>Then it just runs.</h2>
      <p class="sub">No IT department, no integration project, no new habit to learn.</p>
      <div class="steps">
        <div class="card step"><div class="n">1</div><h3>Connect your books</h3><p>Two clicks to link Xero or QuickBooks. Settle reads every overdue invoice, PO number and payment link.</p></div>
        <div class="card step"><div class="n">2</div><h3>Meet Sarah</h3><p>Name your credit controller and pick a tone. Preview every message before anything goes out.</p></div>
        <div class="card step"><div class="n">3</div><h3>Get paid</h3><p>Polite WhatsApp and email chases on a schedule. Promises are tracked, disputes come straight to you.</p></div>
      </div>
    </section>

    <section class="section site" id="law">
      <div class="law">
        <div class="law-copy">
          <h2>The law already says they owe you more.</h2>
          <p class="sub" style="margin-bottom:0">Under the Late Payment of Commercial Debts (Interest) Act 1998, UK businesses can charge other businesses statutory interest and fixed compensation on late invoices. Almost nobody does — because asking is awkward. Sarah asks for you.</p>
          <ul>
            <li>${icon("check")}<span><b>8% + Bank of England base rate</b>, simple interest, accruing daily from the due date.</span></li>
            <li>${icon("check")}<span><b>£40, £70 or £100</b> fixed compensation per invoice, depending on its size.</span></li>
            <li>${icon("check")}<span>Only mentioned when you allow it — with an offer to waive it if they pay by Friday.</span></li>
          </ul>
        </div>
        <div class="card calc">
          <b>What are you owed on a late invoice?</b>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label class="field">Invoice amount<input class="input num" id="c-amt" inputmode="decimal" value="4,500"></label>
            <label class="field">Days overdue<input class="input num" id="c-days" inputmode="numeric" value="45"></label>
          </div>
          <div class="out" id="c-out">${calcRows(null)}</div>
          <div class="muted" style="font-size:12px">Illustrative only. Applies to business-to-business debts without a contractual late-payment clause.</div>
        </div>
      </div>
    </section>

    <section class="section site" id="pricing">
      <h2>Pays for itself on the first invoice.</h2>
      <p class="sub">Recover one late payment and the month is covered. Cancel any time.</p>
      <div class="pricing">
        <div class="card plan">
          <b>Pay as you collect</b>
          <div class="price num">£199<small> /month + 2% of what we collect</small></div>
          <ul>${["WhatsApp + email chasing", "Xero & QuickBooks", "Late Payment Act claims", "Reply handling by Sarah"].map((f) => html`<li>${icon("check")}${f}</li>`)}</ul>
          <a class="btn lg" href="/signup">Start free</a>
        </div>
        <div class="card plan featured">
          <b>Unlimited</b>
          <div class="price num">£449<small> /month, flat</small></div>
          <ul>${["Everything in Pay as you collect", "No success fee, ever", "Multiple personas & brands", "Priority UK support"].map((f) => html`<li>${icon("check")}${f}</li>`)}</ul>
          <a class="btn primary lg" href="/signup">Start free</a>
        </div>
      </div>
      <div class="guarantee">${icon("shield", 20)} If Settle doesn't collect at least one overdue invoice in your first 30 days, you pay nothing.</div>
    </section>

    <section class="section site" id="faq">
      <h2>Questions</h2>
      <div class="faq" style="margin-top:28px">
        ${[
          ["Will it upset my clients?", "Sarah is polite, brief and human — never threatening. Messages reference the exact invoice and PO number, and you can preview every stage before anything is sent. Most clients simply pay; the chase was the only thing missing."],
          ["Is charging statutory interest legitimate?", "Yes. The Late Payment of Commercial Debts (Interest) Act 1998 gives UK businesses the right to claim interest and fixed compensation from other businesses that pay late. Settle only mentions it after two friendly reminders, and you can switch it off per business or entirely."],
          ["What happens when a client replies?", "Sarah reads the reply. Promises to pay are logged and chasing pauses until that date. 'Already paid' is checked against your books. Anything that looks like a dispute or a question she can't answer comes straight to you — she never argues."],
          ["Do I need WhatsApp Business?", "No. Messages are sent from Settle's verified WhatsApp Business number under your company name, and by email from Sarah. You can connect your own number later."],
          ["What does it cost if it doesn't work?", "Nothing. If Settle doesn't collect at least one overdue invoice in your first 30 days, you won't be charged."],
        ].map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}
      </div>
    </section>

    <section class="final">
      <h2 class="serif" style="font-size:clamp(36px,5vw,56px);margin:0 0 14px;line-height:1.05">Stop chasing. Start collecting.</h2>
      <p class="muted" style="font-size:17px;margin:0 0 28px">See exactly what you're owed in the next three minutes.</p>
      <a class="btn primary lg" href="${me ? "/app" : "/signup"}">Get started free ${icon("arrow", 16)}</a>
    </section>
  </main>
  <footer class="site-foot"><div class="site"><span>© ${new Date().getFullYear()} Settle · Made for UK businesses</span><span>Not legal advice. Statutory interest applies to business-to-business debts.</span></div></footer>`);

  const nav = $(".site-nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const update = debounce(async () => {
    if (!$("#c-amt")) return; // navigated away
    const amount = parseFloat($("#c-amt").value.replace(/[£,\s]/g, ""));
    const days = parseInt($("#c-days").value, 10);
    if (!(amount > 0) || !(days >= 0)) return;
    try {
      const c = await api(`/api/public/claim?amount=${amount}&days=${days}`);
      $("#c-out").innerHTML = val(calcRows(c));
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
      <div class="reveal-amount num" id="rv-amt">£0</div>
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
  countUp($("#rv-amt"), o.overdue_total, { ms: 1400, format: (v) => money(v) });
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

// ================================================================= APP SHELL
const NAV = [["overview", "/app", "home", "Overview"], ["invoices", "/app/invoices", "file", "Invoices"], ["activity", "/app/activity", "pulse", "Activity"], ["settings", "/app/settings", "cog", "Settings"]];

function renderShell() {
  const me = state.me, s = me.org.settings;
  if (!$(".shell")) {
    app.innerHTML = val(html`<div class="shell">
      <aside class="side">
        <div class="org"><span class="mark">${initials(me.org.name)}</span><div><b>${me.org.name}</b><span>${providerLabel(me.org.provider)}</span></div></div>
        <nav class="nav" id="nav"></nav>
        <div class="bottom">
          <div class="card live-card" id="live-card"></div>
          <div class="me"><span class="avatar soft">${initials(me.user.name)}</span><div style="min-width:0;flex:1"><div style="font-weight:500;font-size:13px">${me.user.name}</div><div class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${me.user.email}</div></div><button class="btn ghost sm" id="logout" title="Log out">${icon("out", 15)}</button></div>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>
    <div class="scrim" id="scrim"></div>
    <aside class="drawer" id="drawer" aria-hidden="true"></aside>`);
    $("#logout").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); state.me = null; go("/"); });
    $("#scrim").addEventListener("click", closeDrawer);
  }
  renderLiveCard();
  return $("#main");
}

function renderNav(active, attention = null) {
  $("#nav").innerHTML = val(NAV.map(([k, href, ic, label]) => html`<a href="${href}" class="${k === active ? "on" : ""}">${icon(ic)}${label}${k === "invoices" && attention ? html`<span class="count">${attention}</span>` : ""}</a>`));
}

function renderLiveCard() {
  const me = state.me, s = me.org.settings, live = me.org.live;
  $("#live-card").innerHTML = val(html`
    <div class="top"><span class="st"><span class="pulse ${live ? "" : "off"}"></span>${live ? `${s.persona_name} is chasing` : "Paused"}</span>
      <label class="switch" title="${live ? "Pause all chasing" : "Resume chasing"}"><input type="checkbox" id="live-toggle" ${live ? raw("checked") : ""}><span></span><span class="sr">Chasing on</span></label></div>
    <div class="muted" style="font-size:12px">${live ? `Weekdays ${s.hours.start}:00–${s.hours.end}:00` : "No messages will be sent"}</div>`);
  $("#live-toggle").addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      await api("/api/pause-all", { method: "POST", body: { paused: !on } });
      state.me.org.live = on;
      renderLiveCard();
      toast(on ? `${s.persona_name} is back on it` : "All chasing paused");
    } catch (err) { e.target.checked = !on; toast(err.message, { error: true }); }
  });
}

const providerLabel = (p) => ({ xero: "Connected to Xero", quickbooks: "Connected to QuickBooks", demo: "Sample data" }[p] || "Not connected");

async function shellPage(name, opts = {}) {
  const me = await loadMe();
  if (!me.org.provider) return go("/app/connect", { replace: true });
  const main = renderShell();
  renderNav(name, state.attention);
  const titles = { overview: "Overview", invoices: "Invoices", activity: "Activity", settings: "Settings" };
  document.title = `${titles[name]} — Settle`;
  if (name !== "invoices" || !opts.open) closeDrawer(false);
  if (name === "overview") return overviewPage(main);
  if (name === "invoices") return invoicesPage(main, opts.open);
  if (name === "activity") return activityPage(main);
  if (name === "settings") return settingsPage(main);
}

function banners() {
  const me = state.me;
  const parts = [];
  if (me.org.provider === "demo") parts.push(html`<div class="demo-banner">${icon("sparkle")} You're exploring with sample data. Messages are simulated — open an invoice to reply as the customer.<a href="/app/connect">Connect your books</a></div>`);
  if (!me.org.live) parts.push(html`<div class="demo-banner" style="background:var(--amber-bg);color:var(--amber)">${icon("pause")} ${me.org.settings.persona_name} isn't chasing yet.<a href="/app/golive">Review & go live</a></div>`);
  return parts;
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

// ---------------------------------------------------------------- overview
async function overviewPage(main) {
  const me = state.me;
  main.innerHTML = val(html`<div class="page">
    <div class="page-head"><div><h1>${greeting()}, ${firstName(me.user.name)}</h1><p>Here's where your money is.</p></div>
      <button class="btn sm" id="sync">${icon("refresh", 14)} Sync</button></div>
    ${banners()}
    <div class="kpis">${[0, 1, 2, 3].map(() => html`<div class="card kpi"><div class="sk" style="height:14px;width:60%"></div><div class="sk" style="height:30px;width:80%;margin:10px 0 8px"></div><div class="sk" style="height:12px;width:50%"></div></div>`)}</div>
    <div id="ov-rest"></div></div>`);
  $("#sync").addEventListener("click", (e) => busy(e.currentTarget, async () => { const r = await api("/api/sync", { method: "POST" }); toast(`Synced ${r.count} invoices`); overviewPage(main); }));

  const [o, attn] = await Promise.all([api("/api/overview"), api("/api/invoices?filter=attention")]);
  state.attention = o.attention_count;
  renderNav("overview", o.attention_count);
  const s = me.org.settings;
  $(".kpis").outerHTML = val(html`<div class="kpis fade-in">
    <div class="card kpi"><div class="k">${icon("clock", 14)} Overdue</div><div class="v amber num">${money(o.overdue_total)}</div><div class="s">${o.overdue_count} invoices · ${o.customers_overdue} customers</div></div>
    <div class="card kpi"><div class="k">${icon("msg", 14)} Promised</div><div class="v num">${money(o.promised_total)}</div><div class="s">${o.promised_count ? `${o.promised_count} ${o.promised_count === 1 ? "customer has" : "customers have"} given a date` : "No promises yet"}</div></div>
    <div class="card kpi"><div class="k">${icon("check", 14)} Collected by ${s.persona_name}</div><div class="v green num">${money(o.collected_month)}</div><div class="s">This month · ${gbp(o.collected_total)} all time</div></div>
    <div class="card kpi"><div class="k">${icon("scale", 14)} Late Payment Act</div><div class="v num">${money(o.statutory_available)}</div><div class="s">Interest + compensation available</div></div>
  </div>`);

  $("#ov-rest").innerHTML = val(html`
    <div class="card panel fade-in" style="margin-bottom:16px"><h3>Ageing <a href="/app/invoices">View invoices →</a></h3>${o.open_total ? agingBar(o.buckets) : html`<div class="muted">No open invoices.</div>`}</div>
    <div class="grid-2 fade-in">
      <div class="card panel"><h3>Recent activity <a href="/app/activity">See all →</a></h3>${feed(o.activity)}</div>
      <div class="card panel"><h3>Needs you ${attn.invoices.length ? html`<span class="badge amber plain">${attn.invoices.length}</span>` : ""}</h3>
        ${attn.invoices.length ? attn.invoices.slice(0, 6).map((i) => html`<div class="attn-item" data-inv="${i.id}"><span class="attn-dot"></span><div class="grow"><div><b>${i.customer.name}</b> · <span class="num">${gbp(i.amount_due)}</span></div><div>${attentionReason(i)}</div></div>${icon("arrow", 14)}</div>`)
          : html`<div class="empty"><div class="ico">${icon("check", 20)}</div><b>Nothing needs you</b>${s.persona_name} is handling everything.</div>`}
      </div>
    </div>`);
  $$("[data-inv]", main).forEach((el) => el.addEventListener("click", () => go(`/app/invoices/${el.dataset.inv}`)));
}

function attentionReason(i) {
  if (i.state === "disputed") return "Raised a query — over to you";
  if (i.stage >= 5) return "Final notice sent — worth a call";
  if (!i.customer.phone && !i.customer.email) return "No contact details";
  if (i.last_message) return i.last_message.body.split("\n")[0];
  return "Needs a look";
}

function feedIcon(m) {
  if (m.direction === "in") return ["in", "msg"];
  if (m.direction === "out") return m.channel === "whatsapp" ? ["wa", "msg"] : ["", "mail"];
  const k = m.meta.kind;
  if (k === "collected" || k === "paid") return ["ok", "check"];
  if (m.meta.needs_owner || k === "escalated" || k === "unreachable") return ["warn", "alert"];
  return ["", "sparkle"];
}

function feedTitle(m) {
  const who = m.customer_name || "";
  if (m.direction === "in") return `${who} replied`;
  if (m.direction === "out") return m.meta.agent ? `${state.me.org.settings.persona_name} replied to ${who}` : m.meta.owner ? `You messaged ${who}` : `${m.channel === "whatsapp" ? "WhatsApp" : "Email"} to ${who}`;
  if (m.meta.kind === "collected") return `${who} paid`;
  return who ? `${who} · ${m.number}` : "Update";
}

function feed(items) {
  if (!items.length) return html`<div class="empty"><div class="ico" style="background:var(--surface-2);color:var(--muted)">${icon("pulse", 20)}</div><b>No activity yet</b>Messages and replies will appear here.</div>`;
  return html`<div class="feed">${items.map((m) => {
    const [cls, ic] = feedIcon(m);
    return html`<div class="feed-item" data-inv="${m.invoice_id}"><span class="fi ${cls}">${icon(ic, 14)}</span><div style="min-width:0"><div class="tt">${feedTitle(m)}</div><div class="bd">${m.subject || m.body}</div></div><time>${ago(m.created_at)}</time></div>`;
  })}</div>`;
}

// ---------------------------------------------------------------- invoices
const TABS = [["overdue", "Overdue"], ["attention", "Needs you"], ["chasing", "Chasing"], ["promised", "Promised"], ["disputed", "On hold"], ["upcoming", "Not due"], ["paid", "Paid"]];

function stateBadge(i) {
  if (i.status === "paid") return i.state === "collected" ? html`<span class="badge green">Collected</span>` : html`<span class="badge">Paid</span>`;
  if (i.state === "promised") return html`<span class="badge blue">Promised ${fmtDate(i.promised_date)}</span>`;
  if (i.state === "disputed") return html`<span class="badge red">Query</span>`;
  if (i.state === "paused") return html`<span class="badge">Paused</span>`;
  if (i.state === "chasing") return html`<span class="badge amber">${i.stage_label}</span>`;
  if (i.days_overdue <= 0) return html`<span class="badge plain">Not due</span>`;
  return html`<span class="badge plain">Queued</span>`;
}

function daysCell(i) {
  if (i.status === "paid") return html`<span class="days muted">${fmtDate(i.paid_at)}</span>`;
  if (i.days_overdue <= 0) return html`<span class="days muted">Due ${i.days_overdue === 0 ? "today" : fmtDate(i.due_date)}</span>`;
  return html`<span class="days num ${i.days_overdue > 60 ? "very" : "late"}">${i.days_overdue}d late</span>`;
}

function nextCell(i) {
  if (!i.next) return "";
  if (!i.next.date) return i.next.label;
  const today = new Date().toISOString().slice(0, 10);
  return `${i.next.label} · ${i.next.date <= today ? "today" : fmtDay(i.next.date)}`;
}

async function invoicesPage(main, openId) {
  const existing = $("#inv-page", main);
  if (!existing) {
    main.innerHTML = val(html`<div class="page" id="inv-page">
      <div class="page-head"><div><h1>Invoices</h1><p>Everything Settle is tracking, synced from ${providerLabel(state.me.org.provider).replace("Connected to ", "")}.</p></div></div>
      ${banners()}
      <div class="toolbar"><div class="tabs" id="tabs"></div>
        <div class="search">${icon("search")}<input class="input" id="q" placeholder="Search customers or invoices" value="${state.search}" autocomplete="off"><kbd>/</kbd></div></div>
      <div id="inv-table"></div></div>`);
    $("#q").addEventListener("input", (e) => { state.search = e.target.value; state.kbIndex = -1; drawTable(); });
    loadInvoices(true);
  }
  if (openId) openDrawer(openId);
}

async function loadInvoices(skeleton = false) {
  if (skeleton) {
    $("#inv-table").innerHTML = val(html`<table class="table"><tbody>${[...Array(6)].map(() => html`<tr><td><div class="sk" style="height:16px;width:180px"></div></td><td><div class="sk" style="height:16px;width:70px"></div></td><td class="r"><div class="sk" style="height:16px;width:80px;margin-left:auto"></div></td><td class="hide-m"><div class="sk" style="height:16px;width:90px"></div></td></tr>`)}</tbody></table>`);
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
  el.innerHTML = val(TABS.map(([k, l]) => html`<button class="tab ${state.invoiceFilter === k ? "on" : ""}" data-f="${k}">${l}${counts[k] != null ? html`<span class="c num">${counts[k]}</span>` : ""}</button>`));
  $$(".tab", el).forEach((b) => b.addEventListener("click", () => { state.invoiceFilter = b.dataset.f; state.kbIndex = -1; loadInvoices(); drawTabs(counts); }));
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
    const msg = state.search ? ["No matches", "Try a different name or invoice number."] : {
      attention: ["Nothing needs you", "Replies that need a human will show up here."],
      promised: ["No promises yet", "When a customer commits to a date, it lands here."],
      disputed: ["Nothing on hold", "Queries and paused invoices appear here."],
      paid: ["No payments yet", "Collected invoices will show up here."],
    }[state.invoiceFilter] || ["All clear", "No invoices in this view."];
    el.innerHTML = val(html`<div class="empty fade-in"><div class="ico">${icon("check", 20)}</div><b>${msg[0]}</b>${msg[1]}</div>`);
    return;
  }
  el.innerHTML = val(html`<table class="table fade-in"><thead><tr><th>Customer</th><th class="hide-m">Invoice</th><th class="r">Amount</th><th>Due</th><th>Status</th><th class="hide-m">Next</th></tr></thead><tbody>
    ${rows.map((i, n) => html`<tr class="row ${state.drawerId === i.id ? "sel" : ""} ${state.kbIndex === n ? "kb" : ""}" tabindex="0" data-id="${i.id}">
      <td><div class="cust">${i.needs_attention ? html`<span class="attn-dot" title="Needs you"></span>` : ""}<span class="avatar soft" style="width:28px;height:28px;font-size:11px">${initials(i.customer.name)}</span><div style="min-width:0"><b>${i.customer.name}</b><span>${i.customer.contact_name || "—"}</span></div></div></td>
      <td class="hide-m"><span class="num">${i.number}</span>${i.reference ? html`<div class="muted" style="font-size:12px">${i.reference}</div>` : ""}</td>
      <td class="r num"><b style="font-weight:500">${gbp(i.status === "paid" ? i.collected_amount || i.total : i.amount_due, true)}</b></td>
      <td>${daysCell(i)}</td>
      <td>${stateBadge(i)}</td>
      <td class="hide-m"><span class="next">${nextCell(i)}</span></td>
    </tr>`)}</tbody></table>`);
  $$(".row", el).forEach((r) => {
    r.addEventListener("click", () => go(`/app/invoices/${r.dataset.id}`));
    r.addEventListener("keydown", (e) => { if (e.key === "Enter") go(`/app/invoices/${r.dataset.id}`); });
  });
}

// keyboard: / search, j/k move, enter open, esc close
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === "Escape") {
    if (state.drawerId) { e.preventDefault(); go("/app/invoices"); }
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
      <div class="amt num">${money(open ? inv.amount_due : inv.collected_amount || inv.total)}</div>
      <div class="meta"><b style="color:var(--ink)">${inv.customer.name}</b>${inv.customer.contact_name ? html`<span>· ${inv.customer.contact_name}</span>` : ""}${stateBadge(inv)}${open && inv.days_overdue > 0 ? html`<span class="days num ${inv.days_overdue > 60 ? "very" : "late"}">${inv.days_overdue} days late</span>` : ""}</div>
      ${open ? html`<div class="d-actions">
        ${inv.days_overdue > 0 && inv.stage < 5 && inv.state !== "disputed" ? html`<button class="btn sm primary" data-act="chase-now">${icon("send", 14)} Chase now</button>` : ""}
        ${inv.state === "paused" || inv.state === "disputed" ? html`<button class="btn sm" data-act="resume">${icon("play", 14)} Resume chasing</button>` : html`<button class="btn sm" data-act="pause">${icon("pause", 14)} Pause</button>`}
        <button class="btn sm" data-act="mark-paid">${icon("check", 14)} Mark paid</button>
        ${inv.needs_attention ? html`<button class="btn sm ghost" data-act="resolve">Dismiss alert</button>` : ""}
      </div>` : ""}
    </div>
    <div class="d-body" id="d-body">
      ${open && inv.next ? html`<div class="d-section"><h4>Next step</h4>
        <div class="next-box"><span class="ico">${icon(inv.next.date ? "clock" : "alert", 15)}</span><div style="flex:1"><b>${inv.next.label}</b><div class="muted" style="font-size:13px">${inv.next.date ? (inv.next.date <= new Date().toISOString().slice(0, 10) ? `Next business hours${state.me.org.live ? "" : " (once you go live)"}` : fmtDay(inv.next.date)) : `${persona} has paused on this one.`}</div></div>
        ${inv.preview ? html`<button class="linkish" id="pv-toggle">Preview</button>` : ""}</div>
        ${inv.preview ? html`<div class="preview-box" id="pv" hidden><div class="bubble out">${linkify(inv.preview.whatsapp)}</div></div>` : ""}
      </div>` : ""}
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

  const body = $("#d-body");
  body.scrollTop = body.scrollHeight;
  $("#d-close").addEventListener("click", () => closeDrawer());
  $("#pv-toggle")?.addEventListener("click", (e) => { const p = $("#pv"); p.hidden = !p.hidden; e.target.textContent = p.hidden ? "Preview" : "Hide"; });
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
  main.innerHTML = val(html`<div class="page"><div class="page-head"><div><h1>Activity</h1><p>Every message, reply and payment.</p></div></div>${banners()}
    <div class="card panel" id="act"><div class="sk" style="height:48px;margin-bottom:10px"></div><div class="sk" style="height:48px;margin-bottom:10px"></div><div class="sk" style="height:48px"></div></div></div>`);
  const { activity } = await api("/api/activity");
  $("#act").innerHTML = val(feed(activity));
  $("#act").classList.add("fade-in");
  $$("[data-inv]", main).forEach((el) => el.addEventListener("click", () => el.dataset.inv && go(`/app/invoices/${el.dataset.inv}`)));
}

// ---------------------------------------------------------------- settings
async function settingsPage(main) {
  const data = await api("/api/settings");
  const org = data.org, s = structuredClone(org.settings), i = data.integrations;
  main.innerHTML = val(html`<div class="page"><div class="page-head"><div><h1>Settings</h1><p>Changes save automatically.</p></div></div>
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

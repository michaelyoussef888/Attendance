'use strict';
// Data lives on the phone (localStorage) and is pushed to the Google Sheet whenever there is internet.
const STORE = 'attendance-v1';
const AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const $ = id => document.getElementById(id);

let S = load();
let cur = null;
let syncing = false;

function load() {
  try { return Object.assign({ key: '', sheet: '', names: [], dates: [], days: {} }, JSON.parse(localStorage.getItem(STORE) || '{}')); }
  catch (e) { return { key: '', sheet: '', names: [], dates: [], days: {} }; }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
function day(d) { return S.days[d] || (S.days[d] = { present: [], unmarked: [], dirty: false, rev: 0 }); }

/* ---------- dates: sheet gives 'MM-dd', school year runs Sep → Aug ---------- */
function fullDate(md) {
  const now = new Date();
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const m = +md.slice(0, 2), d = +md.slice(3);
  return new Date(m >= 8 ? start : start + 1, m - 1, d);
}
function label(md) { const m = +md.slice(0, 2), d = +md.slice(3); return 'الجمعة ' + d + ' ' + AR[m - 1]; }

/* ---------- server ---------- */
function configured() { return typeof SCRIPT_URL === 'string' && /^https:\/\/script\.google\.com\//.test(SCRIPT_URL); }

async function fetchInfo(key) {
  const r = await fetch(SCRIPT_URL + '?action=info&key=' + encodeURIComponent(key), { cache: 'no-store' });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'error');
  return j;
}

async function sync() {
  if (syncing || !configured() || !S.key) return;
  const dirty = Object.keys(S.days).filter(d => S.days[d].dirty);
  if (!dirty.length) { status(); return; }
  if (!navigator.onLine) { status(); return; }
  syncing = true; status('sending');
  const revs = {};
  const records = dirty.map(d => { revs[d] = S.days[d].rev; return { date: d, present: S.days[d].present, absent: S.days[d].unmarked }; });
  try {
    const r = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ key: S.key, records }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'error');
    const missing = [];
    (j.results || []).forEach(res => {
      const dd = S.days[res.date];
      if (!dd) return;
      if (res.ok && dd.rev === revs[res.date]) { dd.dirty = false; dd.unmarked = []; dd.sentAt = Date.now(); }
      if (res.missing && res.missing.length) missing.push(...res.missing);
    });
    save();
    status(missing.length ? 'missing:' + missing.join('، ') : null);
  } catch (e) {
    status('fail');
  } finally {
    syncing = false;
  }
}

function status(kind) {
  const el = $('status'), t = $('statusText');
  const pending = Object.keys(S.days).filter(d => S.days[d].dirty).length;
  let cls = 'ok', msg;
  if (!configured()) { cls = 'err'; msg = 'لينك الشيت مش متظبط في config.js'; }
  else if (kind === 'sending') { cls = 'wait'; msg = 'بيبعت للشيت…'; }
  else if (kind && kind.startsWith('missing:')) { cls = 'err'; msg = 'أسماء مش موجودة في الشيت: ' + kind.slice(8); }
  else if (kind === 'fail' && pending) { cls = 'err'; msg = 'ماقدرش يبعت. الحضور محفوظ على الموبايل وهيتبعت تاني لوحده'; }
  else if (pending) { cls = 'wait'; msg = navigator.onLine ? 'محفوظ على الموبايل، هيتبعت حالاً' : 'محفوظ على الموبايل — هيتبعت للشيت أول ما يبقى فيه نت'; }
  else {
    const d = cur && S.days[cur];
    msg = d && d.sentAt ? 'اتبعت للشيت ✓' : 'جاهز';
  }
  el.className = 'status ' + cls; t.textContent = msg;
  $('syncBtn').hidden = !pending;
  $('bar').hidden = !pending;
}

/* ---------- UI ---------- */
let rows = [];
function render() {
  $('setup').hidden = true; $('main').hidden = false;
  $('title').textContent = 'حضور ' + (S.sheet || 'الفصل').replace(/^غ\s+/, '');
  document.title = $('title').textContent;
  const sel = $('date'); sel.innerHTML = '';
  S.dates.forEach(md => { const o = document.createElement('option'); o.value = md; o.textContent = label(md); sel.appendChild(o); });
  if (!cur || S.dates.indexOf(cur) < 0) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    cur = S.dates.find(md => fullDate(md) >= today) || S.dates[S.dates.length - 1];
  }
  sel.value = cur;
  const list = $('list'); list.innerHTML = ''; rows = [];
  if (!S.names.length) { list.innerHTML = '<li class="empty">مافيش أسماء في الشيت</li>'; }
  S.names.forEach((n, i) => {
    const li = document.createElement('li'); li.className = 'row'; li.tabIndex = 0; li.setAttribute('role', 'button');
    li.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="nm"></span><span class="st">غائب</span>';
    li.querySelector('.nm').textContent = n;
    li.addEventListener('click', () => toggle(n));
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(n); } });
    list.appendChild(li); rows.push(li);
  });
  $('tot').textContent = S.names.length;
  paint(); status();
}

function paint() {
  const p = new Set(cur ? day(cur).present : []);
  rows.forEach((r, i) => {
    const on = p.has(S.names[i]);
    r.classList.toggle('on', on);
    r.querySelector('.st').textContent = on ? 'حاضر' : 'غائب';
    r.setAttribute('aria-pressed', on);
  });
  $('cnt').textContent = S.names.filter(n => p.has(n)).length;
}

let syncTimer = null;
function toggle(name) {
  const d = day(cur);
  const i = d.present.indexOf(name);
  if (i >= 0) { d.present.splice(i, 1); if (d.unmarked.indexOf(name) < 0) d.unmarked.push(name); }
  else { d.present.push(name); const j = d.unmarked.indexOf(name); if (j >= 0) d.unmarked.splice(j, 1); }
  d.dirty = true; d.rev++;
  save(); paint(); status();
  clearTimeout(syncTimer); syncTimer = setTimeout(sync, 2500);
}

function norm(t) { return t.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ڤ/g, 'ف').replace(/چ/g, 'ج'); }
$('q').addEventListener('input', () => {
  const q = norm($('q').value.trim());
  rows.forEach((r, i) => { r.hidden = !!q && !norm(S.names[i]).includes(q); });
});
$('date').addEventListener('change', () => { cur = $('date').value; paint(); status(); });
$('syncBtn').addEventListener('click', sync);

/* ---------- setup ---------- */
async function setup(key) {
  $('setupErr').textContent = '';
  if (!configured()) { $('setupErr').textContent = 'لينك الشيت مش متظبط في config.js'; return; }
  if (!key) { $('setupErr').textContent = 'اكتب كود الخدمة الأول'; return; }
  $('setupBtn').disabled = true; $('setupBtn').textContent = 'بيحمّل الأسماء…';
  try {
    const info = await fetchInfo(key);
    S.key = key; S.sheet = info.sheet; S.names = info.names; S.dates = info.dates; save();
    render();
  } catch (e) {
    $('setupErr').textContent = e.message === 'bad-key' ? 'الكود غلط' : 'محتاج نت أول مرة. اتأكد إن فيه نت وجرّب تاني';
  } finally {
    $('setupBtn').disabled = false; $('setupBtn').textContent = 'ابدأ';
  }
}
$('setupBtn').addEventListener('click', () => setup($('keyIn').value.trim()));
$('keyIn').addEventListener('input', () => { $('setupErr').textContent = ''; });

async function refreshInfo() {
  if (!navigator.onLine || !configured() || !S.key) return;
  try {
    const info = await fetchInfo(S.key);
    const changed = JSON.stringify(info.names) !== JSON.stringify(S.names) || JSON.stringify(info.dates) !== JSON.stringify(S.dates);
    S.sheet = info.sheet; S.names = info.names; S.dates = info.dates; save();
    if (changed) render();
  } catch (e) {}
}

/* ---------- start ---------- */
(function start() {
  const m = location.hash.match(/key=([^&]+)/);
  if (m) { history.replaceState(null, '', location.pathname); if (!S.key) { $('keyIn').value = decodeURIComponent(m[1]); } }
  if (S.key && S.names.length) { render(); refreshInfo().then(sync); }
  else { $('setup').hidden = false; if ($('keyIn').value) setup($('keyIn').value); }
  window.addEventListener('online', () => { status(); refreshInfo().then(sync); });
  window.addEventListener('offline', () => status());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  setInterval(sync, 30000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

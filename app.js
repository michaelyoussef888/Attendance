'use strict';
// Data lives on the phone (localStorage) and is pushed to the Google Sheet whenever there is internet.
const STORE = 'attendance-v1';
const APP_VERSION = '8';
const AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const $ = id => document.getElementById(id);

let S = load();
let cur = null;
let syncing = false;

function load() {
  const base = () => ({ key: '', sheet: '', names: [], dates: [], days: {}, birthdays: {}, hist: {}, seenBday: {} });
  try { return Object.assign(base(), JSON.parse(localStorage.getItem(STORE) || '{}')); }
  catch (e) { return base(); }
}
// drop records saved by the first version (dates without a year)
Object.keys(S.days).forEach(k => { if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) delete S.days[k]; });
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
function day(d) { return S.days[d] || (S.days[d] = { present: [], unmarked: [], dirty: false, rev: 0 }); }

/* ---------- dates: sheet gives 'yyyy-MM-dd' ---------- */
function fullDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function label(iso) { const [y, m, d] = iso.split('-').map(Number); return 'الجمعة ' + d + ' ' + AR[m - 1] + ' ' + y; }

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
      if (res.ok && dd.rev === revs[res.date]) { dd.dirty = false; dd.sentAt = Date.now(); }
      if (res.missing && res.missing.length) missing.push(...res.missing);
    });
    save();
    lastSyncDone = Date.now();
    status(missing.length ? 'missing:' + missing.join('، ') : null);
    setTimeout(refreshInfo, 500);
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
  else if (kind === 'fail-switch') { cls = 'err'; msg = 'فيه حضور لسه ماتبعتش. افتح النت وابعته الأول، وبعدين غيّر الفصل'; }
  else if (kind === 'fail-pull') { cls = 'err'; msg = 'ماقدرش يجيب آخر حضور من الشيت. اتأكد من النت'; }
  else if (kind === 'sending') { cls = 'wait'; msg = 'بيبعت للشيت…'; }
  else if (kind && kind.startsWith('missing:')) { cls = 'err'; msg = 'أسماء مش موجودة في الشيت: ' + kind.slice(8); }
  else if (kind === 'fail' && pending) { cls = 'err'; msg = 'ماقدرش يبعت. الحضور محفوظ على الموبايل وهيتبعت تاني لوحده'; }
  else if (pending) { cls = 'wait'; msg = navigator.onLine ? 'محفوظ على الموبايل، هيتبعت حالاً' : 'محفوظ على الموبايل — هيتبعت للشيت أول ما يبقى فيه نت'; }
  else {
    const d = cur && S.days[cur];
    msg = d && d.sentAt ? 'اتبعت للشيت ✓' : 'جاهز';
    if (S.lastPull) { const t = new Date(S.lastPull); msg += ' · آخر تحديث ' + t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0'); }
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
    li.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="nmw"><span class="nm"></span><span class="tags"></span></span><span class="st">غائب</span>';
    li.querySelector('.nm').textContent = n;
    li.addEventListener('click', () => toggle(n));
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(n); } });
    list.appendChild(li); rows.push(li);
  });
  $('tot').textContent = S.names.length;
  paint(); status(); maybeBirthdayPopup();
}

function paint() {
  const f = followUp();
  const bd = new Set(weekBirthdays(cur).map(b => b.name));
  let count = 0;
  rows.forEach((r, i) => {
    const n = S.names[i], on = cur ? isPresent(cur, n) : false;
    if (on) count++;
    r.classList.toggle('on', on);
    r.querySelector('.st').textContent = on ? 'حاضر' : 'غائب';
    r.setAttribute('aria-pressed', on);
    const tags = r.querySelector('.tags'); tags.innerHTML = '';
    if (bd.has(n)) tags.insertAdjacentHTML('beforeend', '<span class="tag bday">🎂 عيد ميلاد الأسبوع ده</span>');
    const s = f.streak[n] || 0;
    if (s >= ABSENT_ALERT) tags.insertAdjacentHTML('beforeend', '<span class="tag miss">غاب ' + s + ' مرات ورا بعض</span>');
  });
  $('cnt').textContent = count;
  const alerts = f.list.length + weekBirthdays(cur).length;
  $('followBtn').textContent = alerts ? 'متابعة (' + alerts + ')' : 'متابعة';
}

let syncTimer = null;
function toggle(name) {
  const d = day(cur);
  const was = isPresent(cur, name);
  const i = d.present.indexOf(name), j = d.unmarked.indexOf(name);
  if (was) { if (i >= 0) d.present.splice(i, 1); if (j < 0) d.unmarked.push(name); }
  else { if (i < 0) d.present.push(name); if (j >= 0) d.unmarked.splice(j, 1); }
  d.dirty = true; d.rev++;
  save(); paint(); status();
  clearTimeout(syncTimer); syncTimer = setTimeout(sync, 2500);
}

function norm(t) { return t.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ڤ/g, 'ف').replace(/چ/g, 'ج'); }
$('q').addEventListener('input', () => {
  const q = norm($('q').value.trim());
  rows.forEach((r, i) => { r.hidden = !!q && !norm(S.names[i]).includes(q); });
});
$('date').addEventListener('change', () => { cur = $('date').value; paint(); status(); maybeBirthdayPopup(); });
$('syncBtn').addEventListener('click', sync);

/* ---------- setup ---------- */
async function setup(key) {
  $('setupErr').textContent = '';
  if (!configured()) { $('setupErr').textContent = 'لينك الشيت مش متظبط في config.js'; return; }
  if (!key) { $('setupErr').textContent = 'اكتب كود الخدمة الأول'; return; }
  $('setupBtn').disabled = true; $('setupBtn').textContent = 'بيحمّل الأسماء…';
  try {
    const info = await fetchInfo(key);
    if (info.sheet !== S.sheet) { S.days = {}; cur = null; } // new class on this phone: start clean
    S.key = key; keepInfo(info); save();
    render();
  } catch (e) {
    $('setupErr').textContent = e.message === 'bad-key'
      ? 'الكود غلط. الموبايل بعت: ' + (key || '(فاضي)') + ' — قارنه بكود الفصل'
      : 'محتاج نت أول مرة. اتأكد إن فيه نت وجرّب تاني (' + e.message + ')';
  } finally {
    $('setupBtn').disabled = false; $('setupBtn').textContent = 'ابدأ';
  }
}
$('switchBtn').addEventListener('click', () => {
  const pending = Object.keys(S.days).filter(d => S.days[d].dirty).length;
  if (pending) { status('fail-switch'); return; }
  S.key = ''; save();
  $('keyIn').value = ''; $('main').hidden = true; $('bar').hidden = true; $('setup').hidden = false; $('keyIn').focus();
});
// Same code however the phone typed it: no case, no spaces, Arabic/Persian digits → 0-9, any dash → -
function cleanKey(k) {
  return String(k || '').toLowerCase()
    .replace(/[\u0660-\u0669]/g, c => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, c => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[\u2010-\u2015\u2212\u0640]/g, '-')
    .replace(/[\s\u200e\u200f\u061c]/g, '');
}
$('setupBtn').addEventListener('click', () => setup(cleanKey($('keyIn').value)));
$('keyIn').addEventListener('input', () => { $('setupErr').textContent = ''; });
$('keyIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setup(cleanKey($('keyIn').value)); } });
$('ver').textContent = 'إصدار ' + APP_VERSION;

let pulling = false, lastSyncDone = 0;
async function refreshInfo(manual) {
  if (pulling || syncing || !navigator.onLine || !configured() || !S.key) { if (manual) status(); return; }
  pulling = true;
  const started = Date.now();
  if (manual) { $('refreshBtn').textContent = 'بيحدّث…'; }
  try {
    const info = await fetchInfo(S.key);
    // a send finished while this was loading: this copy may miss it, so ask again
    if (lastSyncDone > started) { pulling = false; return refreshInfo(manual); }
    S.lastPull = Date.now();
    const changed = JSON.stringify(info.names) !== JSON.stringify(S.names) || JSON.stringify(info.dates) !== JSON.stringify(S.dates);
    keepInfo(info);
    // days already in the sheet: the sheet is now the truth, drop local copies
    Object.keys(S.days).forEach(d => { const dd = S.days[d]; if (!dd.dirty) { dd.present = []; dd.unmarked = []; } });
    save();
    if (changed) render(); else { paint(); status(); maybeBirthdayPopup(); }
  } catch (e) {
    if (manual) status('fail-pull');
  } finally {
    pulling = false;
    $('refreshBtn').textContent = 'تحديث';
  }
}
$('refreshBtn').addEventListener('click', () => { sync(); refreshInfo(true); });

function keepInfo(info) {
  S.sheet = info.sheet; S.names = info.names; S.dates = info.dates;
  S.birthdays = info.birthdays || {}; S.hist = info.hist || {};
}

/* ---------- attendance as the app sees it: sheet history + this phone's changes ---------- */
const ABSENT_ALERT = 3;          // alert after this many Fridays absent in a row
function isPresent(date, name) {
  const d = S.days[date];
  if (d && d.present.indexOf(name) >= 0) return true;
  if (d && d.unmarked.indexOf(name) >= 0) return false;
  const h = S.hist[name], k = S.dates.indexOf(date);
  return !!(h && k >= 0 && h[k] === 'p');
}
function heldService(date) { return S.names.some(n => isPresent(date, n)); }   // nobody present = no service (holiday)

function followUp() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const past = S.dates.filter(d => fullDate(d) < today && heldService(d));   // finished Fridays with a service
  const streak = {}, total = {}, lastSeen = {};
  S.names.forEach(n => {
    let s = 0, counting = true, t = 0, seen = null;
    for (let k = past.length - 1; k >= 0; k--) {
      const p = isPresent(past[k], n);
      if (p) { counting = false; if (!seen) seen = past[k]; } else { t++; if (counting) s++; }
    }
    streak[n] = s; total[n] = t; lastSeen[n] = seen;
  });
  const list = S.names.filter(n => streak[n] >= ABSENT_ALERT).sort((a, b) => streak[b] - streak[a]);
  return { streak, total, lastSeen, list, services: past.length };
}

/* ---------- birthdays ---------- */
function bdayIn(name, from, to) {         // birthday occurrence between two dates, or null
  const b = S.birthdays[name]; if (!b) return null;
  const [by, bm, bd] = b.split('-').map(Number);
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
    let d = new Date(y, bm - 1, bd);
    if (d.getMonth() !== bm - 1) d = new Date(y, bm - 1, 28);       // 29 Feb in a normal year
    if (d >= from && d <= to) return { name, date: d, age: y - by };
  }
  return null;
}
function weekBirthdays(date) {            // the 7 days ending on that Friday: celebrate them at this service
  if (!date) return [];
  const fri = fullDate(date), sat = new Date(fri); sat.setDate(fri.getDate() - 6);
  return S.names.map(n => bdayIn(n, sat, fri)).filter(Boolean).sort((a, b) => a.date - b.date);
}
function upcomingBirthdays(days) {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(from.getDate() + days);
  return S.names.map(n => bdayIn(n, from, to)).filter(Boolean).sort((a, b) => a.date - b.date);
}
const WD = ['الأحد','الاتنين','التلات','الأربع','الخميس','الجمعة','السبت'];
function dayName(d) { return WD[d.getDay()] + ' ' + d.getDate() + ' ' + AR[d.getMonth()]; }
function bdayLine(b) { return '<li><b></b><span>' + dayName(b.date) + ' · يكمل ' + b.age + ' سنين</span></li>'; }
function fillNames(ul, items) { ul.querySelectorAll('li').forEach((li, i) => { li.querySelector('b').textContent = items[i].name; }); }

function maybeBirthdayPopup() {
  const list = weekBirthdays(cur);
  const key = S.sheet + '|' + cur;
  if (!list.length || S.seenBday[key]) return;
  S.seenBday[key] = true; save();
  const ul = $('bdayList'); ul.innerHTML = list.map(bdayLine).join(''); fillNames(ul, list);
  $('bdayTitle').textContent = list.length === 1 ? 'عيد ميلاد الأسبوع ده' : 'أعياد ميلاد الأسبوع ده (' + list.length + ')';
  $('bdayPop').hidden = false; $('bdayOk').focus();
}

function openFollow() {
  const f = followUp();
  const wk = weekBirthdays(cur), up = upcomingBirthdays(30).filter(b => !wk.some(w => w.name === b.name));
  const sec = [];
  sec.push('<h3>أعياد ميلاد أسبوع ' + label(cur).replace('الجمعة ', '') + '</h3>' +
    (wk.length ? '<ul class="plist" id="fW">' + wk.map(bdayLine).join('') + '</ul>' : '<p class="none">مافيش</p>'));
  sec.push('<h3>أعياد ميلاد الشهر الجاي</h3>' +
    (up.length ? '<ul class="plist" id="fU">' + up.map(bdayLine).join('') + '</ul>' :
      '<p class="none">' + (Object.keys(S.birthdays).length ? 'مافيش' : 'مافيش تواريخ ميلاد في الشيت لسه') + '</p>'));
  sec.push('<h3>محتاجين افتقاد · غابوا ' + ABSENT_ALERT + ' مرات ورا بعض أو أكتر</h3>' +
    (f.list.length ? '<ul class="plist" id="fA">' + f.list.map(n =>
      '<li><b></b><span>غاب ' + f.streak[n] + ' مرات ورا بعض · ' + f.total[n] + ' غياب من ' + f.services +
      (f.lastSeen[n] ? ' · آخر حضور ' + label(f.lastSeen[n]).replace('الجمعة ', '') : ' · ماحضرش لسه') + '</span></li>').join('') + '</ul>'
      : '<p class="none">كله تمام</p>'));
  const top = S.names.slice().sort((a, b) => f.total[b] - f.total[a]).filter(n => f.total[n] > 0).slice(0, 10);
  sec.push('<h3>الأكتر غياب من أول السنة</h3>' +
    (top.length ? '<ul class="plist" id="fT">' + top.map(n => '<li><b></b><span>' + f.total[n] + ' غياب من ' + f.services + '</span></li>').join('') + '</ul>' : '<p class="none">مافيش</p>'));
  $('followBody').innerHTML = sec.join('');
  if (wk.length) fillNames($('fW'), wk);
  if (up.length) fillNames($('fU'), up);
  if (f.list.length) fillNames($('fA'), f.list.map(n => ({ name: n })));
  if (top.length) fillNames($('fT'), top.map(n => ({ name: n })));
  $('followPop').hidden = false; $('followClose').focus();
}
$('followBtn').addEventListener('click', openFollow);
$('followClose').addEventListener('click', () => { $('followPop').hidden = true; });
$('bdayOk').addEventListener('click', () => { $('bdayPop').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('bdayPop').hidden = true; $('followPop').hidden = true; } });

/* ---------- start ---------- */
(function start() {
  const m = location.hash.match(/key=([^&]+)/);
  if (m) { history.replaceState(null, '', location.pathname); if (!S.key) { $('keyIn').value = cleanKey(decodeURIComponent(m[1])); } }
  if (S.key && S.names.length) { render(); refreshInfo().then(sync); }
  else { $('setup').hidden = false; if ($('keyIn').value) setup(cleanKey($('keyIn').value)); }
  if (!S.key) { $('main').hidden = true; $('setup').hidden = false; }
  window.addEventListener('online', () => { status(); refreshInfo().then(sync); });
  window.addEventListener('offline', () => status());
  // keep every phone in step with the sheet: on return to the app and every 20 seconds while it's on screen
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync(); refreshInfo(); } });
  window.addEventListener('pageshow', () => refreshInfo());
  setInterval(sync, 30000);
  setInterval(() => { if (document.visibilityState === 'visible') refreshInfo(); }, 20000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

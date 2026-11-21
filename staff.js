'use strict';
// Servants' follow-up: a servant (own code, tied to their phone) or أمين الخدمة (admin code).
// Uses helpers from app.js at call time: S, save, $, SCRIPT_URL, configured, fullDate, label, AR, isLocked, isoDay, EDIT_IDLE_SEC.
const Staff = (() => {
  const YES = '✓', NO = '✘', EXC = 'بإعتذار', UNEXC = 'بدون إعتذار';
  let cur = null, tab = 0, editUntil = 0, syncing = false, pulling = false, lastSyncDone = 0, started = false, popupShown = '';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const st = () => S.staff || (S.staff = { data: null, q: {} });
  const today = () => isoDay(new Date());
  const isAdmin = () => S.role === 'admin';
  const tabs = () => { const d = st().data; if (!d) return []; return isAdmin() ? d.tabs : [{ sheet: d.sheet, dates: d.dates, tasks: d.tasks, servants: [{ name: d.name, hist: d.hist, exc: '' }] }]; };
  const T = () => tabs()[tab] || tabs()[0];
  const qKey = (sheet, name, date) => sheet + '|' + name + '|' + date;

  /* ---------- values: sheet history + this phone's unsent changes ---------- */
  function taskVal(t, sv, k, date) {
    const q = st().q[qKey(t.sheet, sv.name, date)];
    const task = t.tasks[k];
    if (q && q.tasks && task in q.tasks) return q.tasks[task];
    const i = t.dates.indexOf(date), c = sv.hist[k] && sv.hist[k][i];
    return c === 'y' ? YES : c === 'n' ? NO : '';
  }
  function excVal(t, sv, date) {
    const q = st().q[qKey(t.sheet, sv.name, date)];
    if (q && q.excuse !== undefined) return q.excuse;
    const c = (sv.exc || '')[t.dates.indexOf(date)];
    return c === 'b' ? EXC : c === 'x' ? UNEXC : '';
  }
  const attIdx = t => t.tasks.findIndex(x => x.indexOf('حضور') >= 0);
  function setVal(t, sv, date, task, v, excuse) {
    const key = qKey(t.sheet, sv.name, date);
    const q = st().q[key] || (st().q[key] = { id: key, sheet: t.sheet, name: sv.name, date, tasks: {}, rev: 0 });
    if (task !== null) q.tasks[task] = v;
    if (excuse !== undefined) q.excuse = excuse;
    q.rev++; q.editedOn = today(); q.dirty = true;
    save(); paint();
    clearTimeout(setVal.t); setVal.t = setTimeout(sync, 2000);
  }
  const pending = () => Object.values(st().q).filter(q => q.dirty).length;

  // a Friday where somebody attended, the servant didn't, and no excuse decided yet
  function needsExcuse() {
    const out = [];
    tabs().forEach(t => {
      const a = attIdx(t); if (a < 0) return;
      t.dates.forEach(date => {
        if (date > today() || isLocked(date)) return;
        if (!t.servants.some(sv => taskVal(t, sv, a, date) === YES)) return;
        t.servants.forEach(sv => { if (taskVal(t, sv, a, date) !== YES && !excVal(t, sv, date)) out.push({ t, sv, date }); });
      });
    });
    return out;
  }

  /* ---------- who can edit ---------- */
  // servant: from that Friday until it locks a week later (same rule as Code.gs STAFF_GRACE_DAYS); admin: until it locks
  function canEditDate(date) { return isAdmin() ? !isLocked(date) : (date <= today() && !isLocked(date)); }
  const editOpen = () => Date.now() < editUntil;

  /* ---------- screen ---------- */
  function shell() {
    $('setup').hidden = true; $('main').hidden = true; $('bar').hidden = true; $('staff').hidden = false;
    const admin = isAdmin(), d = st().data;
    $('staff').innerHTML = `
      <header class="sh">
        <div class="top"><div>
          <h1>${admin ? 'أمين الخدمة · متابعة الخدام' : 'متابعتي · ' + esc(d.name)}</h1>
          <div class="sub">${admin ? 'كل الخدام' : esc(d.sheet.replace(/^.*كشف متابعة الخدام\s*/, 'فصل '))} · <button id="sSwitch" class="link" type="button">تغيير الكود</button></div>
        </div></div>
        <div class="controls">
          ${admin ? '<select id="sTab" aria-label="الفصل"></select>' : ''}
          <select id="sDate" aria-label="الجمعة"></select>
        </div>
        <div id="sStatus" class="status ok" role="status"><span class="dot"></span><span id="sStatusText" style="flex:1;min-width:0">جاهز</span><button id="sRefresh" class="link" type="button" style="color:inherit">تحديث</button></div>
        ${admin ? '<button id="sExcBanner" class="excbanner" type="button" hidden></button>' : ''}
      </header>
      <div id="sBody"></div>
      ${admin ? '' : '<h3 class="hh">تاريخي</h3><div id="sHist"></div>'}
      <div class="bar" id="sBar"><div class="in"><button id="sEdit" class="editbtn" type="button">🔒 دوس هنا عشان تعدّل</button><button id="sSend" class="sendbtn" type="button" hidden>ابعت</button></div></div>
      <div class="overlay center" id="sExcPop" hidden role="dialog" aria-modal="true" aria-labelledby="sExcTitle"><div class="sheet">
        <h2 id="sExcTitle">خدام غايبين محتاجين تحديد الإعتذار</h2><div id="sExcList"></div>
        <button id="sExcClose" class="primary" type="button">قفل</button></div></div>`;
    if (admin) {
      const sel = $('sTab');
      tabs().forEach((t, i) => { const o = document.createElement('option'); o.value = i; o.textContent = t.sheet.replace(/^.*كشف متابعة الخدام\s*/, ''); sel.appendChild(o); });
      sel.value = tab;
      sel.onchange = () => { tab = +sel.value; editUntil = 0; fillDates(); paint(); };
      $('sExcBanner').onclick = openExcuses;
      $('sExcClose').onclick = () => { $('sExcPop').hidden = true; };
    }
    $('sDate').onchange = () => { cur = $('sDate').value; editUntil = 0; paint(); };
    $('sSwitch').onclick = () => {
      if (pending()) { status('فيه تعديلات لسه ماتبعتتش. افتح النت وابعتها الأول', 'err'); return; }
      S.key = ''; S.role = ''; S.staff = null; save();
      $('staff').hidden = true; $('setup').hidden = false; $('keyIn').value = ''; $('keyIn').focus();
    };
    $('sRefresh').onclick = () => { sync(); pull(true); };
    $('sSend').onclick = sync;
    $('sEdit').onclick = () => { editUntil = editOpen() ? 0 : Date.now() + EDIT_IDLE_SEC * 1000; paint(); };
    fillDates();
  }

  function fillDates() {
    const t = T(), sel = $('sDate'); if (!t) return;
    sel.innerHTML = '';
    t.dates.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = label(d); sel.appendChild(o); });
    if (!cur || t.dates.indexOf(cur) < 0) {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      // the servant sees today, or the last Friday; أمين الخدمة sees the last Friday that has passed or today
      cur = t.dates.filter(d => fullDate(d) <= now).pop() || t.dates[0];
    }
    sel.value = cur;
  }

  function status(msg, cls) {
    const el = $('sStatus'); if (!el) return;
    const p = pending();
    if (!msg) {
      if (p) { cls = 'wait'; msg = navigator.onLine ? 'محفوظ على الموبايل، هيتبعت حالاً' : 'محفوظ على الموبايل — هيتبعت أول ما يبقى فيه نت'; }
      else if (!canEditDate(cur)) { cls = 'lock'; msg = isAdmin() ? '🔒 الجمعة دي اتقفلت · للعرض بس' : (cur > today() ? '🔒 الجمعة دي لسه ماجاتش' : '🔒 الجمعة دي اتقفلت · للعرض بس'); }
      else {
        cls = 'ok'; msg = 'جاهز';
        if (cur < today()) { const l = fullDate(cur); l.setDate(l.getDate() + LOCK_AFTER_DAYS - 1); msg += ' · مفتوحة للتعديل لحد ' + dayName(l); }
      }
      if (!p && st().lastPull) { const t = new Date(st().lastPull); msg += ' · آخر تحديث ' + t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0'); }
    }
    el.className = 'status ' + (cls || 'ok'); $('sStatusText').textContent = msg;
    $('sSend').hidden = !p;
  }

  function editUI() {
    const b = $('sEdit'); if (!b) return;
    const can = canEditDate(cur);
    b.hidden = !can;
    if (!can) return;
    const open = editOpen();
    b.classList.toggle('open', open);
    if (open) { const s = Math.ceil((editUntil - Date.now()) / 1000); b.textContent = '🔓 التعديل مفتوح · بيقفل بعد ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' · دوس تقفله'; }
    else b.textContent = '🔒 دوس هنا عشان تعدّل';
  }

  function seg(on, txt, cls, attrs) { return `<button type="button" class="seg ${cls}${on ? ' on' : ''}" aria-pressed="${on}" ${attrs}>${txt}</button>`; }

  function paint() {
    const t = T(); if (!t || !$('sBody')) return;
    const can = canEditDate(cur) && editOpen();
    const a = attIdx(t);
    $('sBody').innerHTML = t.servants.map((sv, si) => {
      const absent = a >= 0 && taskVal(t, sv, a, cur) !== YES && cur <= today();
      const rows = t.tasks.map((task, k) => {
        const v = taskVal(t, sv, k, cur);
        return `<div class="trow"><span class="tname">${esc(task)}</span>
          ${seg(v === YES, YES, 'yes', `data-s="${si}" data-k="${k}" data-v="${YES}"`)}${seg(v === NO, NO, 'no', `data-s="${si}" data-k="${k}" data-v="${NO}"`)}</div>`;
      }).join('');
      const e = isAdmin() ? excVal(t, sv, cur) : '';
      const exc = isAdmin() ? `<div class="trow exc${absent && !e ? ' need' : ''}"><span class="tname">الإعتذار</span>
          ${seg(e === EXC, EXC, 'mid', `data-s="${si}" data-e="${EXC}"`)}${seg(e === UNEXC, UNEXC, 'no', `data-s="${si}" data-e="${UNEXC}"`)}</div>` : '';
      return `<section class="scard${can ? '' : ' ro'}">
        ${isAdmin() ? `<div class="shead"><b>${esc(sv.name)}</b>${absent ? '<span class="tag miss">ماحضرش الخدمة</span>' : ''}</div>` : ''}
        ${isAdmin() && sv.notes ? `<div class="notes">📝 ${esc(sv.notes)}</div>` : ''}
        ${rows}${exc}${isAdmin() ? lastFour(t, sv) : ''}</section>`;
    }).join('') || '<p class="empty">مافيش خدام في التاب ده</p>';
    $('sBody').querySelectorAll('button.seg').forEach(b => b.onclick = () => tap(b));
    if (!isAdmin()) history();
    if (isAdmin()) {
      const n = needsExcuse().length, bn = $('sExcBanner');
      bn.hidden = !n; bn.textContent = '⚠️ ' + n + ' خدام غايبين محتاجين تحديد إعتذار · افتح';
    }
    editUI(); status();
  }

  function tap(b) {
    const t = T();
    if (!canEditDate(cur)) { status(); return; }
    if (!editOpen()) { const e = $('sEdit'); e.classList.remove('hint'); void e.offsetWidth; e.classList.add('hint'); return; }
    editUntil = Date.now() + EDIT_IDLE_SEC * 1000;
    const sv = t.servants[+b.dataset.s];
    if (b.dataset.e) { const now = excVal(t, sv, cur); setVal(t, sv, cur, null, null, now === b.dataset.e ? '' : b.dataset.e); return; }
    const task = t.tasks[+b.dataset.k], now = taskVal(t, sv, +b.dataset.k, cur);
    setVal(t, sv, cur, task, now === b.dataset.v ? '' : b.dataset.v);
  }

  // أمين الخدمة: the 4 Fridays before the one on screen, under each servant
  const HIST_WEEKS = 4;
  function lastFour(t, sv) {
    const weeks = t.dates.filter(d => d < cur && d <= today()).slice(-HIST_WEEKS).reverse();
    if (!weeks.length) return '';
    const short = s => s.replace(/^ال/, '').split(' ')[0];
    let yes = 0, all = 0;
    const body = weeks.map(d => {
      const cells = t.tasks.map((_, k) => { const v = taskVal(t, sv, k, d); if (v) { all++; if (v === YES) yes++; } return '<td class="' + (v === YES ? 'hy' : v === NO ? 'hn' : '') + '">' + (v || '·') + '</td>'; }).join('');
      const e = excVal(t, sv, d);
      return '<tr><td class="hd">' + label(d).replace('الجمعة ', '').replace(/ \d{4}$/, '') + '</td>' + cells + '<td class="he">' + (e === EXC ? '<span class="ex b">بإعتذار</span>' : e === UNEXC ? '<span class="ex x">بدون</span>' : '') + '</td></tr>';
    }).join('');
    return `<details class="last4" open><summary>آخر ${weeks.length} جمعات · ${yes} ✓ من ${all}</summary>
      <div class="hscroll"><table class="htab mini"><thead><tr><th></th>${t.tasks.map(x => '<th>' + esc(short(x)) + '</th>').join('')}<th>إعتذار</th></tr></thead>
      <tbody>${body}</tbody></table></div></details>`;
  }

  // the servant's own record: every Friday so far, read only
  function history() {
    const t = T(), sv = t.servants[0], el = $('sHist');
    const past = t.dates.filter(d => d <= today()).reverse();
    const short = s => s.replace(/^ال/, '').split(' ')[0];
    const counts = t.tasks.map((_, k) => past.reduce((a, d) => { const v = taskVal(t, sv, k, d); if (v === YES) a.y++; if (v === NO) a.n++; return a; }, { y: 0, n: 0 }));
    el.innerHTML = `<div class="hscroll"><table class="htab"><thead><tr><th>الجمعة</th>${t.tasks.map(x => '<th>' + esc(short(x)) + '</th>').join('')}</tr></thead>
      <tbody><tr class="sum"><td>المجموع</td>${counts.map(c => `<td><span class="hy">${c.y}✓</span> <span class="hn">${c.n}✘</span></td>`).join('')}</tr>
      ${past.map(d => '<tr><td>' + label(d).replace('الجمعة ', '') + '</td>' + t.tasks.map((_, k) => { const v = taskVal(t, sv, k, d); return '<td class="' + (v === YES ? 'hy' : v === NO ? 'hn' : '') + '">' + (v || '·') + '</td>'; }).join('') + '</tr>').join('')}
      </tbody></table></div>`;
  }

  function openExcuses() {
    const list = needsExcuse();
    if (!list.length) { $('sExcPop').hidden = true; return; }
    $('sExcList').innerHTML = list.map((x, i) => `<div class="exrow"><div><b>${esc(x.sv.name)}</b>
      <span>${esc(x.t.sheet.replace(/^.*كشف متابعة الخدام\s*/, ''))} · ${label(x.date).replace('الجمعة ', '')}</span></div>
      <div class="exbtns"><button type="button" class="seg mid" data-i="${i}" data-e="${EXC}">${EXC}</button><button type="button" class="seg no" data-i="${i}" data-e="${UNEXC}">${UNEXC}</button></div></div>`).join('');
    $('sExcList').querySelectorAll('button').forEach(b => b.onclick = () => {
      const x = list[+b.dataset.i];
      setVal(x.t, x.sv, x.date, null, null, b.dataset.e);     // a deliberate choice in this window: no edit button needed
      openExcuses();
    });
    $('sExcPop').hidden = false;
  }

  /* ---------- server ---------- */
  async function pull(manual) {
    if (pulling || syncing || !navigator.onLine || !configured() || !S.key) { if (manual) status(); return; }
    pulling = true; const t0 = Date.now();
    try {
      const r = await fetch(SCRIPT_URL + '?action=info&key=' + encodeURIComponent(S.key) + '&dev=' + encodeURIComponent(S.dev), { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) { status(errText(j.error), 'err'); return; }
      if (lastSyncDone > t0) { pulling = false; return pull(manual); }
      st().data = j; st().lastPull = Date.now();
      // drop local copies the sheet now has
      Object.keys(st().q).forEach(k => { if (!st().q[k].dirty) delete st().q[k]; });
      save();
      const sel = $('sTab'); if (sel && sel.options.length !== tabs().length) shell();
      paint();
      if (isAdmin() && !popupShown) { popupShown = '1'; if (needsExcuse().length) openExcuses(); }
    } catch (e) { if (manual) status('ماقدرش يجيب آخر بيانات. اتأكد من النت', 'err'); }
    finally { pulling = false; }
  }

  async function sync() {
    if (syncing || !configured() || !S.key || !navigator.onLine) { status(); return; }
    const recs = Object.values(st().q).filter(q => q.dirty);
    if (!recs.length) { status(); return; }
    syncing = true; status('بيبعت…', 'wait');
    const revs = {}; recs.forEach(q => revs[q.id] = q.rev);
    try {
      const r = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ key: S.key, dev: S.dev, records: recs.map(q => ({ id: q.id, sheet: q.sheet, name: q.name, date: q.date, editedOn: q.editedOn, tasks: q.tasks, excuse: q.excuse })) }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      const refused = [];
      (j.results || []).forEach(res => {
        const q = st().q[res.id]; if (!q) return;
        if (res.ok && q.rev === revs[res.id]) q.dirty = false;
        if (!res.ok) { refused.push(label(q.date)); delete st().q[res.id]; }
      });
      save(); lastSyncDone = Date.now();
      if (refused.length) status('الشيت رفض تعديل على جمعة مقفولة: ' + refused.join('، '), 'err'); else status();
      setTimeout(() => pull(), 500);
    } catch (e) {
      status(e.message === 'other-device' || e.message === 'bad-key' || e.message === 'too-many' ? errText(e.message) : 'ماقدرش يبعت. محفوظ على الموبايل وهيتبعت لوحده', 'err');
    } finally { syncing = false; }
  }

  function errText(code) {
    return ({ 'other-device': 'الكود ده مربوط بموبايل تاني. كلّم أمين الخدمة يفك الربط',
      'bad-key': 'الكود اتغيّر أو اتمسح. دوس تغيير الكود واكتب الكود الجديد',
      'too-many': 'محاولات غلط كتير من الموبايل ده. استنى ساعة وجرّب تاني',
      'servant-not-found': 'اسمك مش موجود في شيت الخدام. كلّم أمين الخدمة' })[code] || ('حصلت مشكلة: ' + code);
  }

  return {
    errText,
    start(info) {
      if (info) { st().data = info; st().lastPull = Date.now(); save(); }
      if (!st().data) return false;
      cur = null; tab = 0; popupShown = '';
      shell(); paint();
      if (!info) pull();
      else if (isAdmin()) { popupShown = '1'; if (needsExcuse().length) openExcuses(); }
      if (!started) {
        started = true;
        setInterval(() => { if (editUntil && !editOpen()) { editUntil = 0; paint(); } else editUI(); }, 1000);
        setInterval(() => { if (S.role === 'servant' || S.role === 'admin') { if (document.visibilityState === 'visible') pull(); sync(); } }, 20000);
        window.addEventListener('online', () => { if (S.role === 'servant' || S.role === 'admin') { sync(); pull(); } });
        document.addEventListener('visibilitychange', () => {
          if (S.role !== 'servant' && S.role !== 'admin') return;
          if (document.visibilityState === 'hidden') { editUntil = 0; paint(); } else { sync(); pull(); }
        });
      }
      return true;
    },
  };
})();

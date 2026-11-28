import * as L from './logic.js';
import { rpc, getToken, setToken, clearToken, ApiError } from './api.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

const state = {
  loginText: '',
  openStory: null,
  snap: null, token: '', view: 'home', sort: 'pct', profileId: null,
  day: null, draft: null, week: null, bf: null,
  admin: null, modal: null, error: '', busy: false,
};

// ------------------------------------------------------------ hulpjes
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initial = (name) => esc((name || '?').trim().charAt(0).toUpperCase());
const me = () => state.snap.me;
const isAdmin = () => me().role === 'admin';
const today = () => state.snap.today;
const S = () => state.snap.settings;
const goalsOf = (id) => state.snap.goals.filter((g) => g.member_id === id);
const memberById = (id) => state.snap.members.find((m) => m.id === id);

let toastTimer;
function toast(msg, err = false) {
  $toast.textContent = msg;
  $toast.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.className = ''; }, err ? 5000 : 2200);
}

function setPath(path, value) {
  const keys = path.split('.');
  let o = state;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function siteLink(token) {
  return location.origin + location.pathname + '#t=' + token;
}

// ------------------------------------------------------------ laden
async function load() {
  try {
    state.snap = await rpc('xm_snapshot', { p_token: state.token });
    state.error = '';
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403 || /niet geldig/.test(e.message))) {
      clearToken();
      state.token = '';
      state.snap = null;
      state.error = 'Deze link werkt niet (meer). Vraag de beheerder om een nieuwe link.';
    } else {
      state.error = e.message;
    }
  }
  render();
}

async function call(fn, args, okMsg) {
  if (state.busy) return null;
  state.busy = true;
  try {
    const r = await rpc(fn, { p_token: state.token, ...args });
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, true);
    return null;
  } finally {
    state.busy = false;
  }
}

async function refresh() {
  try { state.snap = await rpc('xm_snapshot', { p_token: state.token }); } catch (e) { toast(e.message, true); }
  render();
}

// ------------------------------------------------------------ pagina's
function layout(content) {
  const m = me();
  const nav = [['home', 'Overzicht'], ['checkin', 'Check-in'], ['stories', 'Strijdverhalen'], ['profile', 'Mijn doelen']];
  return `
  <header class="top"><div class="top-in">
    <div class="brand"><div class="logo">X</div>${esc(S().site_name)}</div>
    <nav class="nav">
      ${nav.map(([v, l]) => `<button data-act="nav" data-v="${v}" class="${state.view === v || (v === 'checkin' && state.view === 'backfill') ? 'on' : ''}">${l}</button>`).join('')}
      ${isAdmin() ? `<button data-act="nav" data-v="admin" class="admin ${state.view === 'admin' ? 'on' : ''}">Beheer</button>` : ''}
    </nav>
    <div class="who"><span>${esc(m.name)}</span><span class="avatar">${initial(m.name)}</span></div>
  </div></header>
  <main>${content}</main>${state.modal ? renderModal() : ''}`;
}

function renderLogin() {
  $app.innerHTML = `<div class="login card">
    <div class="brand" style="margin-bottom:16px"><div class="logo">X</div>X-man challenge</div>
    <h2>Welkom</h2>
    <p>Je logt in met je persoonlijke link. Die heb je van de beheerder gekregen.</p>
    <p>Open die link op deze telefoon of computer; daarna onthoudt de site je.</p>
    ${state.error ? `<p style="color:var(--bad);font-weight:600">${esc(state.error)}</p>` : ''}
    <div class="field"><label>Zit je in de app op je beginscherm? Plak hier je persoonlijke link of code</label>
      <input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://…#t=… of alleen de code" data-bind="loginText" value="${esc(state.loginText || '')}">
      <button class="btn pri" data-act="login">Inloggen</button></div>
    <p class="muted small">Link kwijt? Vraag de beheerder om een nieuwe.</p></div>`;
}

function teaser() {
  const items = L.recentStories(state.snap, 3);
  const newest = items[0] ? items[0].created_at : null;
  return `<section class="card teaser"><h3>Nieuwste strijdverhalen</h3>
    <div class="list">${items.map((st, i) => `<button class="tease" data-act="openStoryFromHome" data-k="${esc(storyKey(st))}">
      <span class="avatar sm">${initial(st.name)}</span>
      <span class="grow"><b>${esc(st.title)}</b><span class="small muted" style="display:block">${esc(st.name)} · ${L.fmtShort(st.day)}</span><span class="small tease-pre">${esc(String(st.body).split(/\n+/)[0])}</span></span>
      ${i === 0 && newest && (Date.now() - new Date(newest).getTime()) < 36 * 3600 * 1000 ? '<span class="chip done">Nieuw</span>' : ''}</button>`).join('') || '<p class="empty">Nog geen strijdverhalen. Schrijf de eerste bij je check-in.</p>'}</div>
    <button class="btn" style="margin-top:12px;width:100%" data-act="nav" data-v="stories">Alle strijdverhalen →</button></section>`;
}

function viewHome() {
  const s = S(), t = today();
  const total = L.totalDays(s);
  const idx = L.dayIndex(s, t);
  const started = idx >= 0;
  const week = L.weekNumber(s, t);
  const ms = L.milestoneDates(s);
  const cur = L.currentMilestone(s, t);
  const pctNow = Math.max(0, Math.min(100, ((idx + 1) / total) * 100));
  const rows = L.sortBoard(L.buildBoard(state.snap, t), state.sort);
  const doneToday = rows.filter((r) => r.today);
  const notYet = rows.filter((r) => !r.today);
  const feed = L.recentActivity(state.snap, 8);

  const timeline = `
  <div class="timeline">
    <div class="tl-track"></div><div class="tl-fill" style="width:${started ? pctNow : 0}%"></div>
    ${started ? `<div class="tl-now" style="left:${Math.min(Math.max(pctNow, 6), 94)}%"><span>Nu · week ${week}</span><i></i></div>` : ''}
    ${ms.map((d, i) => {
      const p = ((L.dayIndex(s, d) + 1) / total) * 100;
      const end = i === 3;
      return `<div class="tl-ms ${end ? 'end' : ''}" style="left:${p}%"></div>
        <div class="tl-lb ${end ? 'end' : ''}" style="left:${p}%">${end ? L.fmtShort(d).replace(/^\w+ /, '') : 'wk ' + (i + 1) * 10}</div>`;
    }).join('')}
  </div>`;

  const board = rows.map((r, i) => {
    const m = r.member;
    const status = r.today ? `<span class="chip done">${r.today.status === 'done' ? 'Getraind' : 'Rustdag'}</span>`
      : (r.idleDays !== null && r.idleDays >= 3 ? `<span class="chip warn">${r.idleDays} dagen stil</span>` : '');
    return `<button class="brow ${m.id === me().id ? 'me' : ''}" data-act="profile" data-id="${m.id}">
      <div class="rank">${i + 1}</div>
      <span class="avatar sm">${initial(m.name)}</span>
      <div class="bname"><b>${esc(m.name)}</b><span>${esc(r.goalText)}</span></div>
      <div class="bar"><div class="bar-top"><span>${r.pct === null ? '–' : r.pct + '%'}</span>${r.delta ? `<span class="muted">${r.delta > 0 ? '+' : ''}${r.delta} deze week</span>` : ''}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${r.pct || 0}%"></div></div></div>
      <div class="reg"><b>${r.reg === null ? '–' : r.reg}</b><span>regelmaat</span></div>
      <div>${status}</div></button>`;
  }).join('');

  return `
  <section class="card">
    <div class="row"><div><div class="eyebrow">Waar staan we</div>
      <div class="big">${started ? `Week ${week} van ${L.totalWeeks(s)}` : 'Nog niet begonnen'}</div></div>
      <div class="muted">Start ${L.fmtDate(s.start_date)}, laatste dag ${L.fmtDate(s.end_date)}.<br>Eerstvolgende tussendoel: <b style="color:var(--ink)">${L.MILESTONE_LABELS[cur].toLowerCase()}</b>, op ${L.fmtDate(ms[cur])}</div></div>
    ${timeline}
  </section>
  <div class="cols">
    <section class="card grow">
      <div class="row"><h2>Scorebord</h2><div><span class="small muted">Sorteer op </span>
        <button class="pill ${state.sort === 'pct' ? 'on' : ''}" data-act="sort" data-v="pct">Voortgang</button>
        <button class="pill ${state.sort === 'reg' ? 'on' : ''}" data-act="sort" data-v="reg">Regelmaat</button></div></div>
      <div class="board">${board || '<p class="empty">Nog geen deelnemers.</p>'}</div>
      <p class="small muted">Voortgang = hoe ver je bent richting je doel van ${L.MILESTONE_LABELS[cur].toLowerCase()}. Regelmaat = hoeveel van je geplande trainingen je hebt gedaan.</p>
    </section>
    <div class="side">
      <section class="card"><h3>Vandaag ingecheckt</h3>
        <div class="list">
          ${doneToday.map((r) => `<div class="li"><span class="avatar sm">${initial(r.member.name)}</span><span class="grow">${esc(r.member.name)}</span><span class="chip done">${r.today.status === 'done' ? 'Getraind' : 'Rustdag'}</span></div>`).join('') || '<p class="empty">Nog niemand.</p>'}
          ${notYet.length && doneToday.length ? `<p class="small muted">Nog niet: ${notYet.map((r) => esc(r.member.name)).join(', ')}</p>` : ''}
        </div>
        <button class="btn lime" style="margin-top:14px;width:100%" data-act="nav" data-v="checkin">Zelf inchecken</button>
      </section>
      ${teaser()}
      <section class="card"><h3>Laatste activiteit</h3>
        <div class="list">${feed.map((f) => `<div><b>${esc(f.name)}</b> <span class="muted small">${L.fmtShort(f.day)}</span><br><span class="small">${esc(f.text)}</span></div>`).join('') || '<p class="empty">Nog niets ingevuld.</p>'}</div>
      </section>
    </div>
  </div>`;
}

// ---- check-in
function draftFor(day, memberId) {
  const e = state.snap.entries.find((x) => x.member_id === memberId && x.day === day);
  const values = {};
  for (const g of goalsOf(memberId)) {
    if (g.kind === 'frequentie') continue;
    const k = state.snap.measurements.find((x) => x.goal_id === g.id && x.day === day);
    values[g.id] = k ? L.formatValue(g.kind, k.value) : '';
  }
  const st = L.findStory(state.snap, memberId, day);
  return { status: e ? e.status : null, feel: e ? e.feel : null, values, story: { title: st ? st.title : '', body: st ? st.body : '', open: !!st } };
}

function fillableDays() {
  const s = S();
  const last = L.lastFillableDay(s, today());
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = L.addDays(last, -i);
    if (d >= s.start_date) out.push(d);
  }
  return out.reverse();
}

function measureFields(prefix, goals, values) {
  return goals.filter((g) => g.kind !== 'frequentie').map((g) => `
    <div class="field"><label>${esc(g.name)}${g.kind === 'gewicht' || g.kind === 'aantal' ? (g.unit ? ' (' + esc(g.unit) + ')' : '') : ''}</label>
    <input type="text" inputmode="${g.kind === 'tijd' ? 'text' : 'decimal'}" placeholder="${L.KINDS[g.kind].placeholder}" value="${esc(values[g.id] ?? '')}" data-bind="${prefix}.${g.id}">
    <small>${L.KINDS[g.kind].hint}. Leeg laten als je het niet gemeten hebt.</small></div>`).join('');
}

function viewCheckin() {
  const id = me().id;
  if (!state.day) state.day = L.lastFillableDay(S(), today());
  if (!state.draft) state.draft = draftFor(state.day, id);
  const d = state.draft;
  const days = fillableDays();
  const has = (day) => state.snap.entries.some((e) => e.member_id === id && e.day === day);
  return `
  <section class="card" style="max-width:560px;width:100%;margin:0 auto">
    <h2>Check-in</h2>
    <p class="muted small" style="margin:4px 0 0">${L.fmtLong(state.day)}${state.day === today() ? ' (vandaag)' : ''}</p>
    <div class="days">${days.map((x) => `<button class="dayb ${x === state.day ? 'on' : ''} ${has(x) ? 'has' : ''}" data-act="day" data-v="${x}"><span>${L.weekdayShort(x)}</span><b>${L.dayNumber(x)}</b></button>`).join('')}</div>
    <div class="seg"><button data-act="status" data-v="done" class="${d.status === 'done' ? 'on' : ''}">Getraind</button><button data-act="status" data-v="rest" class="${d.status === 'rest' ? 'on' : ''}">Rustdag</button></div>
    ${measureFields('draft.values', goalsOf(id), d.values)}
    <div class="field"><label>Hoe voelde het?</label><div class="feel">${[1, 2, 3, 4, 5].map((n) => `<button data-act="feel" data-v="${n}" class="${d.feel === n ? 'on' : ''}">${n}</button>`).join('')}</div><small>1 = zwaar, 5 = top (niet verplicht)</small></div>
    ${storyBox(d.story)}
    <button class="btn pri" style="width:100%;margin-top:18px" data-act="saveDay">Opslaan</button>
    ${has(state.day) ? `<button class="btn" style="width:100%;margin-top:8px" data-act="clearDay">Deze dag leegmaken</button>` : ''}
    <p style="margin:16px 0 0"><a href="#" data-act="nav" data-v="backfill">Een dag van eerder invullen →</a></p>
  </section>`;
}

function storyBox(st) {
  const chev = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;transition:transform .2s;transform:rotate(${st.open ? 180 : 0}deg)"><path d="M6 9l6 6 6-6"/></svg>`;
  const pen = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;
  return `<button class="story-toggle" data-act="toggleStory" aria-expanded="${st.open}">${pen}<span class="grow"><b>Schrijf een strijdverhaal</b><span>Niet verplicht. Iedereen kan het lezen.</span></span>${chev}</button>
  ${st.open ? `<div class="story-form">
    <div class="field" style="margin-top:0"><label for="stitle">Titel</label><input id="stitle" type="text" maxlength="${L.STORY_MAX_TITLE}" placeholder="Bijvoorbeeld: Mijn eerste 5 km onder de 27" data-bind="draft.story.title" value="${esc(st.title)}"></div>
    <div class="field"><label for="sbody">Jouw verhaal</label><textarea id="sbody" rows="6" maxlength="${L.STORY_MAX_BODY}" placeholder="Hoe ging het? Wat viel op? Wat wil je delen met de groep?" data-bind="draft.story.body">${esc(st.body)}</textarea></div>
    <div class="row small muted" style="margin-top:6px"><span>Zichtbaar voor iedereen in de challenge</span><span id="scount">${st.body.length} / ${L.STORY_MAX_BODY}</span></div>
    <p class="small muted" style="margin:6px 0 0">Titel en tekst allebei leeg laten en opslaan verwijdert je strijdverhaal van deze dag.</p>
  </div>` : ''}`;
}

// ---- strijdverhalen lezen
function viewStories() {
  const list = L.recentStories(state.snap);
  if (state.openStory === null && list.length) state.openStory = storyKey(list[0]);
  return `
  <section class="card" style="max-width:640px;width:100%;margin:0 auto">
    <div class="eyebrow">Van iedereen</div><h2 style="font-size:30px;margin-top:2px">Strijdverhalen</h2>
    <p class="muted small" style="margin:4px 0 0">Schrijf er zelf een bij je check-in. Tik op een verhaal om het te lezen.</p>
  </section>
  ${list.length === 0 ? '<section class="card" style="max-width:640px;width:100%;margin:0 auto"><p class="empty">Nog geen strijdverhalen. Schrijf de eerste bij je check-in.</p></section>' : ''}
  ${list.map((st) => {
    const key = storyKey(st), open = state.openStory === key, own = st.member_id === me().id;
    const paras = String(st.body).split(/\n+/).map((x) => x.trim()).filter(Boolean);
    return `<article class="card story" style="max-width:640px;width:100%;margin:0 auto">
      <div class="li"><span class="avatar sm">${initial(st.name)}</span><div class="grow"><b>${esc(st.name)}</b><div class="small muted">${L.fmtShort(st.day)} · week ${L.weekNumber(S(), st.day)}</div></div></div>
      <h3 style="font-size:19px;margin-top:12px">${esc(st.title)}</h3>
      ${open ? `<div class="story-body">${paras.map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : `<p class="story-preview">${esc(paras[0] || '')}</p>`}
      <div class="row" style="justify-content:flex-start;margin-top:12px;gap:8px">
        <button class="pill" aria-expanded="${open}" data-act="openStory" data-k="${esc(key)}">${open ? 'Inklappen' : 'Lees verder'}</button>
        ${own ? `<button class="btn sm" data-act="edit" data-v="${st.day}">Wijzig</button>` : ''}
      </div></article>`;
  }).join('')}`;
}

function storyKey(st) { return st.member_id + '|' + st.day; }

// ---- eerdere weken
function weekDays(w) {
  const s = S();
  const last = L.lastFillableDay(s, today());
  const start = L.addDays(s.start_date, (w - 1) * 7);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = L.addDays(start, i);
    if (d >= s.start_date && d <= last) out.push(d);
  }
  return out;
}

function initBackfill(w) {
  state.week = w;
  state.bf = {};
  for (const d of weekDays(w)) state.bf[d] = draftFor(d, me().id);
}

function viewBackfill() {
  const id = me().id;
  const curWeek = L.weekNumber(S(), L.lastFillableDay(S(), today()));
  if (!state.bf) initBackfill(Math.min(state.week || curWeek, curWeek));
  const goals = goalsOf(id).filter((g) => g.kind !== 'frequentie');
  const tabs = Array.from({ length: curWeek }, (_, i) => i + 1);
  return `
  <section class="card">
    <h2>Eerdere weken invullen</h2>
    <p class="muted small">Kies een week en vul per dag in of je getraind hebt. Je kunt alleen je eigen gegevens aanpassen.</p>
    <div class="tabs">${tabs.map((w) => `<button class="pill ${w === state.week ? 'on' : ''}" data-act="week" data-v="${w}">Week ${w}</button>`).join('')}</div>
    <div>${Object.keys(state.bf).map((d) => {
      const x = state.bf[d];
      return `<div class="wrow"><div class="dl">${L.fmtShort(d)}</div>
        <div class="seg"><button data-act="bfstatus" data-d="${d}" data-v="done" class="${x.status === 'done' ? 'on' : ''}">Getraind</button><button data-act="bfstatus" data-d="${d}" data-v="rest" class="${x.status === 'rest' ? 'on' : ''}">Rust</button><button data-act="bfstatus" data-d="${d}" data-v="" class="${!x.status ? 'on' : ''}">Leeg</button></div>
        ${goals.length ? `<div class="vals">${goals.map((g) => `<label>${esc(g.name)}<input type="text" placeholder="${L.KINDS[g.kind].placeholder}" value="${esc(x.values[g.id] ?? '')}" data-bind="bf.${d}.values.${g.id}"></label>`).join('')}</div>` : ''}
      </div>`;
    }).join('')}</div>
    <div class="row" style="margin-top:16px"><button class="btn" data-act="bfrest">Lege dagen op rustdag zetten</button><button class="btn pri" data-act="bfsave">Week opslaan</button></div>
  </section>`;
}

// ---- profiel
function viewProfile() {
  const id = state.profileId || me().id;
  const m = memberById(id) || me();
  const own = m.id === me().id;
  const s = S(), t = today();
  const cur = L.currentMilestone(s, t);
  const prog = L.memberProgress(m, state.snap, t, cur);
  const reg = L.regularity(m, state.snap, t);
  const weeks = L.weeklyCounts(state.snap.entries, m.id, s, t);
  const plan = L.plannedPerWeek(m, state.snap, cur);
  const goals = goalsOf(m.id);
  const ms = L.milestoneDates(s);
  const log = state.snap.entries.filter((e) => e.member_id === m.id).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 14);
  const goalById = new Map(goals.map((g) => [g.id, g]));

  return `
  <section class="card">
    <div class="row"><div><div class="eyebrow">${own ? 'Mijn doelen' : 'Profiel'}</div><div class="big">${esc(m.name)}</div></div>
      ${!own ? `<button class="btn" data-act="profile" data-id="${me().id}">Naar mijn eigen profiel</button>` : ''}</div>
    <div class="row" style="justify-content:flex-start;gap:32px;margin-top:16px">
      <div><div class="big" style="font-size:44px">${prog.pct === null ? '–' : prog.pct + '%'}</div><div class="muted small">voortgang naar ${L.MILESTONE_LABELS[cur].toLowerCase()}</div></div>
      <div><div class="big" style="font-size:44px">${reg.score === null ? '–' : reg.score}</div><div class="muted small">regelmaat (${reg.done} van ${reg.planned} gepland)</div></div>
      <div><div class="big" style="font-size:44px">${L.streak(state.snap.entries, m.id, t)}</div><div class="muted small">dagen op rij ingevuld</div></div>
    </div>
  </section>
  <section class="card"><h3>Trainingen per week</h3>
    <div class="grid">${weeks.map((n, i) => {
      const p = L.plannedPerWeek(m, state.snap, L.milestoneOfWeek(i + 1));
      const cls = n === null ? 'future' : n === 0 ? '' : n < p ? 'l1' : n === p ? 'l2' : 'l3';
      return `<div class="cell ${cls}" title="Week ${i + 1}">${n === null ? '' : n}</div>`;
    }).join('')}</div>
    <p class="small muted">Elk vakje is een week. Plan nu: ${plan}× per week.</p>
  </section>
  <section class="card"><h3>Doelen</h3>
    ${goals.length === 0 ? '<p class="empty">De beheerder heeft nog geen doelen ingesteld.</p>' : goals.map((g) => {
      const now = L.goalCurrent(g, state.snap, t);
      const f = (i) => L.fmt(g, g.targets[i]);
      return `<div style="margin-top:14px"><b>${esc(g.name)}</b> <span class="muted small">(${g.better === 'lager' ? 'lager' : 'hoger'} is beter)</span>
      <div class="tablewrap"><table><tr><th>Start</th><th>Nu</th>${L.MILESTONE_LABELS.map((l, i) => `<th class="${i === cur ? 'cur' : ''}">${l}<br><span style="text-transform:none;letter-spacing:0">${L.fmtShort(ms[i]).replace(/^\w+ /, '')}</span></th>`).join('')}</tr>
      <tr><td>${L.fmt(g, g.start)}</td><td><b>${now === null ? '–' : L.fmt(g, now)}</b></td>${[0, 1, 2, 3].map((i) => `<td class="${i === cur ? 'cur' : ''}">${f(i)}</td>`).join('')}</tr></table></div></div>`;
    }).join('')}
  </section>
  <section class="card"><h3>Logboek</h3>
    <div class="list">${log.map((e) => {
      const ks = state.snap.measurements.filter((k) => k.member_id === m.id && k.day === e.day).map((k) => { const g = goalById.get(k.goal_id); return g ? `${esc(g.name)} ${L.fmt(g, k.value)}` : ''; }).filter(Boolean);
      return `<div class="li"><div class="grow"><b>${L.fmtShort(e.day)}</b> · ${e.status === 'done' ? 'Getraind' : 'Rustdag'}${e.feel ? ` · gevoel ${e.feel}` : ''}${ks.length ? `<br><span class="small muted">${ks.join(' · ')}</span>` : ''}</div>
      ${own ? `<button class="btn sm" data-act="edit" data-v="${e.day}">Wijzig</button>` : ''}</div>`;
    }).join('') || '<p class="empty">Nog niets ingevuld.</p>'}</div>
  </section>`;
}

// ---- beheer
function viewAdmin() {
  if (state.admin && state.admin.editing) return viewGoalEditor();
  const s = S();
  const ms = state.snap.members;
  const adminCount = ms.filter((m) => m.role === 'admin').length;
  return `
  <section class="card"><h2>Beheer</h2>
    <p class="muted small">Elke deelnemer heeft een eigen persoonlijke link, zonder wachtwoord. Een link laat je maar één keer zien, direct na het aanmaken. Ben je hem kwijt, maak dan een nieuwe link; de oude werkt dan niet meer.</p></section>
  <section class="card"><h3>Challenge</h3>
    <div class="g2">
      <div class="field"><label>Eerste dag (dd-mm-jjjj)</label><input type="text" data-bind="admin.start" value="${esc(state.admin.start)}"></div>
      <div class="field"><label>Laatste dag (dd-mm-jjjj)</label><input type="text" data-bind="admin.end" value="${esc(state.admin.end)}"></div>
    </div>
    <div class="field"><label>Naam van de site</label><input type="text" data-bind="admin.siteName" value="${esc(state.admin.siteName)}"></div>
    <p class="small muted">Nu: ${L.totalDays(s)} dagen, ${L.totalWeeks(s)} weken.</p>
    <button class="btn pri" data-act="saveSettings">Opslaan</button>
  </section>
  <section class="card"><h3>Deelnemers (${ms.length})</h3>
    <div class="list">${ms.map((m) => `
      <div style="border:1px solid var(--line);border-radius:12px;padding:12px">
        <div class="li"><span class="avatar sm">${initial(m.name)}</span><div class="grow"><b>${esc(m.name)}</b> ${m.role === 'admin' ? '<span class="chip done">beheerder</span>' : ''}<br><span class="small muted">${goalsOf(m.id).length} doel(en)</span></div></div>
        <div class="row" style="justify-content:flex-start;margin-top:10px;gap:8px">
          <button class="btn sm lime" data-act="goals" data-id="${m.id}">Doelen</button>
          <button class="btn sm" data-act="resetLink" data-id="${m.id}">Nieuwe link</button>
          <button class="btn sm" data-act="rename" data-id="${m.id}">Naam</button>
          ${m.role === 'admin' ? (adminCount > 1 ? `<button class="btn sm" data-act="role" data-id="${m.id}" data-v="member">Geen beheerder meer</button>` : '') : `<button class="btn sm" data-act="role" data-id="${m.id}" data-v="admin">Maak beheerder</button>`}
          ${m.id !== me().id ? `<button class="btn sm danger" data-act="delete" data-id="${m.id}">Verwijder</button>` : ''}
        </div></div>`).join('')}</div>
    <div class="field" style="margin-top:20px"><label>Deelnemer toevoegen</label>
      <div class="li"><input type="text" placeholder="Voornaam" data-bind="admin.newName" value="${esc(state.admin.newName)}" maxlength="40"><button class="btn pri" data-act="addMember">Toevoegen</button></div></div>
  </section>`;
}

function blankGoal() {
  return { id: '', name: '', kind: 'tijd', better: 'lager', unit: '', start: '', targets: ['', '', '', ''] };
}

function openGoalEditor(memberId) {
  const goals = goalsOf(memberId).map((g) => ({
    id: g.id, name: g.name, kind: g.kind, better: g.better, unit: g.unit || '',
    start: L.formatValue(g.kind, g.start), targets: g.targets.map((x) => L.formatValue(g.kind, x)),
  }));
  state.admin.editing = { memberId, goals };
  render();
}

function viewGoalEditor() {
  const ed = state.admin.editing;
  const m = memberById(ed.memberId);
  const ms = L.milestoneDates(S());
  return `
  <section class="card">
    <div class="row"><h2>Doelen van ${esc(m.name)}</h2><button class="btn" data-act="closeGoals">Terug</button></div>
    <p class="muted small">Vul per doel de startwaarde in en wat ${esc(m.name)} wil bereiken bij elke tussenstap. Een deelnemer kan meerdere doelen hebben.</p>
    ${ed.goals.map((g, i) => `<div class="gedit">
      <div class="g2">
        <div class="field" style="margin-top:0"><label>Naam van het doel</label><input type="text" data-bind="admin.editing.goals.${i}.name" value="${esc(g.name)}" placeholder="bijv. 5 km hardlopen" maxlength="80"></div>
        <div class="field" style="margin-top:0"><label>Soort</label><select data-bind="admin.editing.goals.${i}.kind" data-rerender="1">${Object.entries(L.KINDS).map(([k, v]) => `<option value="${k}" ${g.kind === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      </div>
      ${L.KINDS[g.kind].hasUnit ? `<div class="field"><label>Eenheid</label><input type="text" list="units" maxlength="12" data-bind="admin.editing.goals.${i}.unit" value="${esc(g.unit)}" placeholder="kg, %, cm, herhalingen, …"><small>Typ zelf een eenheid of kies er een. Leeg laten mag ook.</small></div>` : ''}
      <div class="g2"><div class="field"><label>Wat is beter?</label><select data-bind="admin.editing.goals.${i}.better"><option value="lager" ${g.better === 'lager' ? 'selected' : ''}>Lager (tijd, gewicht kwijt)</option><option value="hoger" ${g.better === 'hoger' ? 'selected' : ''}>Hoger (meer kilo's, herhalingen)</option></select></div>
        <div class="field"><label>Startwaarde</label><input type="text" data-bind="admin.editing.goals.${i}.start" value="${esc(g.start)}" placeholder="${L.KINDS[g.kind].placeholder}"></div></div>
      <div class="field"><label>Doelen per tussenstap</label><div class="g4">${[0, 1, 2, 3].map((j) => `<div><small>${L.MILESTONE_LABELS[j]} (${L.fmtShort(ms[j]).replace(/^\w+ /, '')})</small><input type="text" data-bind="admin.editing.goals.${i}.targets.${j}" value="${esc(g.targets[j])}" placeholder="${L.KINDS[g.kind].placeholder}"></div>`).join('')}</div>
      <small>${L.KINDS[g.kind].hint}</small></div>
      <button class="btn sm danger" style="margin-top:10px" data-act="rmGoal" data-i="${i}">Doel verwijderen</button>
    </div>`).join('')}
    <datalist id="units">${['kg', '%', 'cm', 'km', 'm', 'minuten', 'herhalingen', 'kcal', 'stappen', 'liter'].map((u) => `<option value="${u}">`).join('')}</datalist>
    <div class="row" style="margin-top:16px"><button class="btn lime" data-act="addGoal">+ Doel toevoegen</button><button class="btn pri" data-act="saveGoals">Doelen opslaan</button></div>
  </section>`;
}

function renderModal() {
  const m = state.modal;
  if (m.type === 'link') {
    return `<div class="modal-bg"><div class="modal"><h3>Link voor ${esc(m.name)}</h3>
      <p>Stuur deze link naar ${esc(m.name)} (bijvoorbeeld via WhatsApp). Je ziet hem maar één keer. Wie de link heeft, kan als deze persoon inloggen.</p>
      <div class="linkbox">${esc(siteLink(m.token))}</div>
      <div class="row"><button class="btn lime" data-act="copyLink">Kopieer link</button><button class="btn" data-act="closeModal">Klaar</button></div></div></div>`;
  }
  if (m.type === 'confirmDelete') {
    return `<div class="modal-bg"><div class="modal"><h3>${esc(m.name)} verwijderen?</h3>
      <p>Alle trainingen, metingen en doelen van ${esc(m.name)} worden definitief verwijderd. Dit kan niet ongedaan worden gemaakt.</p>
      <div class="row"><button class="btn danger" data-act="doDelete">Ja, verwijder</button><button class="btn" data-act="closeModal">Annuleren</button></div></div></div>`;
  }
  return '';
}

// ------------------------------------------------------------ renderen
function render() {
  if (!state.snap) { renderLogin(); return; }
  if (!state.admin) {
    state.admin = { start: L.isoToDMY(S().start_date), end: L.isoToDMY(S().end_date), siteName: S().site_name, newName: '', editing: null };
  }
  const views = { home: viewHome, stories: viewStories, checkin: viewCheckin, backfill: viewBackfill, profile: viewProfile, admin: viewAdmin };
  const v = state.view === 'admin' && !isAdmin() ? 'home' : state.view;
  const scroll = window.scrollY;
  $app.innerHTML = layout(views[v]());
  window.scrollTo(0, scroll);
  for (const sel of ['.days .on', '.tabs .on']) {
    const el = $app.querySelector(sel);
    const box = el && el.parentElement;
    if (box) box.scrollLeft += el.getBoundingClientRect().left - box.getBoundingClientRect().left - (box.clientWidth - el.clientWidth) / 2;
  }
}

function go(view) {
  state.view = view;
  state.modal = null;
  if (view === 'checkin') { state.day = null; state.draft = null; }
  if (view === 'stories' && state.view !== 'stories') { /* behoud gekozen verhaal */ }
  if (view === 'backfill') { state.bf = null; }
  if (view === 'profile') state.profileId = state.profileId || me().id;
  if (view === 'admin') { state.admin = null; }
  render();
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------ acties
const actions = {
  toggleStory() { state.draft.story.open = !state.draft.story.open; render(); },
  openStory(el) { state.openStory = state.openStory === el.dataset.k ? '' : el.dataset.k; render(); },
  openStoryFromHome(el) { state.openStory = el.dataset.k; go('stories'); },
  login() {
    const m = /(?:[#&]t=)?([0-9a-fA-F]{20,})\s*$/.exec((state.loginText || '').trim());
    if (!m) { state.error = 'Dat lijkt geen geldige link of code. Kopieer de hele link nog eens.'; return renderLogin(); }
    setToken(m[1]);
    state.token = m[1];
    state.error = '';
    state.loginText = '';
    load();
  },
  nav(el) { if (el.dataset.v === 'profile') state.profileId = me().id; go(el.dataset.v); },
  sort(el) { state.sort = el.dataset.v; render(); },
  profile(el) { state.profileId = el.dataset.id; state.view = 'profile'; render(); window.scrollTo(0, 0); },
  day(el) { state.day = el.dataset.v; state.draft = draftFor(state.day, me().id); render(); },
  status(el) { state.draft.status = state.draft.status === el.dataset.v ? null : el.dataset.v; render(); },
  feel(el) { const n = +el.dataset.v; state.draft.feel = state.draft.feel === n ? null : n; render(); },
  edit(el) { state.day = el.dataset.v; state.draft = draftFor(state.day, me().id); state.view = 'checkin'; render(); window.scrollTo(0, 0); },

  async saveDay() {
    const r = collectValues(goalsOf(me().id), state.draft.values);
    if (r.error) return toast(r.error, true);
    if (!state.draft.status && Object.values(r.values).some((v) => v !== null)) return toast('Kies eerst getraind of rustdag', true);
    const stDraft = state.draft.story;
    const had = !!L.findStory(state.snap, me().id, state.day);
    const wants = stDraft.title.trim() || stDraft.body.trim();
    if (wants && (!stDraft.title.trim() || !stDraft.body.trim())) return toast('Een strijdverhaal heeft een titel én een tekst nodig', true);
    const ok = await call('xm_save_day', { p_day: state.day, p_status: state.draft.status, p_feel: state.draft.feel, p_values: r.values }, wants || had ? null : 'Opgeslagen');
    if (ok && (wants || had)) {
      const ok2 = await call('xm_save_story', { p_day: state.day, p_title: stDraft.title, p_body: stDraft.body }, 'Opgeslagen');
      if (!ok2) { await refresh(); return; }
    }
    if (ok) { await refresh(); state.draft = draftFor(state.day, me().id); render(); }
  },
  async clearDay() {
    const clear = {};
    for (const g of goalsOf(me().id)) if (g.kind !== 'frequentie') clear[g.id] = null;
    const ok = await call('xm_save_day', { p_day: state.day, p_status: null, p_feel: null, p_values: clear }, 'Dag leeggemaakt');
    if (ok) { await refresh(); state.draft = draftFor(state.day, me().id); render(); }
  },

  week(el) { initBackfill(+el.dataset.v); render(); },
  bfstatus(el) { state.bf[el.dataset.d].status = el.dataset.v || null; render(); },
  bfrest() { for (const d of Object.keys(state.bf)) if (!state.bf[d].status) state.bf[d].status = 'rest'; render(); },
  async bfsave() {
    const goals = goalsOf(me().id);
    let saved = 0;
    for (const d of Object.keys(state.bf)) {
      const x = state.bf[d], orig = draftFor(d, me().id);
      if (JSON.stringify({ s: x.status, v: x.values }) === JSON.stringify({ s: orig.status, v: orig.values })) continue;
      const r = collectValues(goals, x.values);
      if (r.error) return toast(`${L.fmtShort(d)}: ${r.error}`, true);
      if (!x.status && Object.values(r.values).some((v) => v !== null)) return toast(`${L.fmtShort(d)}: kies getraind of rust`, true);
      const ok = await call('xm_save_day', { p_day: d, p_status: x.status, p_feel: orig.feel, p_values: r.values });
      if (!ok) return;
      saved++;
    }
    toast(saved ? `${saved} dag(en) opgeslagen` : 'Niets gewijzigd');
    const w = state.week;
    await refresh();
    initBackfill(w); render();
  },

  async saveSettings() {
    const a = state.admin;
    const start = L.dmyToISO(a.start), end = L.dmyToISO(a.end);
    if (!start || !end) return toast('Gebruik de vorm dd-mm-jjjj', true);
    if (await call('xm_admin_set_settings', { p_start: start, p_end: end, p_site_name: a.siteName }, 'Opgeslagen')) { state.admin = null; await refresh(); }
  },
  async addMember() {
    const name = state.admin.newName.trim();
    if (!name) return toast('Vul een naam in', true);
    const r = await call('xm_admin_add_member', { p_name: name });
    if (r) { state.admin.newName = ''; state.modal = { type: 'link', name: r.name, token: r.token }; await refresh(); }
  },
  async resetLink(el) {
    const m = memberById(el.dataset.id);
    if (!confirm(`Nieuwe link voor ${m.name} maken? De oude link werkt dan niet meer.`)) return;
    const r = await call('xm_admin_reset_token', { p_member_id: m.id });
    if (r) { state.modal = { type: 'link', name: m.name, token: r.token }; render(); }
  },
  async rename(el) {
    const m = memberById(el.dataset.id);
    const name = prompt('Nieuwe naam', m.name);
    if (!name || !name.trim()) return;
    if (await call('xm_admin_rename_member', { p_member_id: m.id, p_name: name }, 'Naam aangepast')) await refresh();
  },
  async role(el) {
    if (await call('xm_admin_set_role', { p_member_id: el.dataset.id, p_role: el.dataset.v }, 'Rol aangepast')) await refresh();
  },
  delete(el) { state.modal = { type: 'confirmDelete', id: el.dataset.id, name: memberById(el.dataset.id).name }; render(); },
  async doDelete() {
    const id = state.modal.id; state.modal = null;
    if (await call('xm_admin_delete_member', { p_member_id: id }, 'Verwijderd')) await refresh(); else render();
  },
  closeModal() { state.modal = null; render(); },
  async copyLink() {
    try { await navigator.clipboard.writeText(siteLink(state.modal.token)); toast('Link gekopieerd'); } catch { toast('Kopiëren lukt niet. Selecteer de tekst zelf.', true); }
  },
  goals(el) { openGoalEditor(el.dataset.id); },
  closeGoals() { state.admin.editing = null; render(); },
  addGoal() { state.admin.editing.goals.push(blankGoal()); render(); },
  rmGoal(el) { if (confirm('Dit doel verwijderen? Ingevulde metingen van dit doel gaan ook weg.')) { state.admin.editing.goals.splice(+el.dataset.i, 1); render(); } },
  async saveGoals() {
    const ed = state.admin.editing, out = [];
    for (const g of ed.goals) {
      const label = g.name.trim() || 'Naamloos doel';
      if (!g.name.trim()) return toast('Elk doel heeft een naam nodig', true);
      const start = L.parseValue(g.kind, g.start);
      const targets = g.targets.map((t) => L.parseValue(g.kind, t));
      if (start === null || Number.isNaN(start)) return toast(`${label}: startwaarde klopt niet`, true);
      if (targets.some((t) => t === null || Number.isNaN(t))) return toast(`${label}: vul alle vier de doelen in`, true);
      out.push({ id: g.id || null, name: g.name.trim(), kind: g.kind, better: g.better, unit: L.KINDS[g.kind].hasUnit ? g.unit.trim() : '', start, targets });
    }
    if (await call('xm_admin_save_goals', { p_member_id: ed.memberId, p_goals: out }, 'Doelen opgeslagen')) {
      state.admin.editing = null; await refresh();
    }
  },
};

function collectValues(goals, texts) {
  const values = {};
  for (const g of goals) {
    if (g.kind === 'frequentie') continue;
    const v = L.parseValue(g.kind, texts[g.id]);
    if (Number.isNaN(v)) return { error: `"${g.name}": dit getal klopt niet (${L.KINDS[g.kind].hint})` };
    values[g.id] = v;
  }
  return { values };
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.preventDefault();
  const fn = actions[el.dataset.act];
  if (fn) fn(el);
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset && el.dataset.bind && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    setPath(el.dataset.bind, el.value);
    if (el.id === 'sbody') { const c = document.getElementById('scount'); if (c) c.textContent = el.value.length + ' / ' + L.STORY_MAX_BODY; }
  }
});
document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset && el.dataset.bind && el.tagName === 'SELECT') {
    setPath(el.dataset.bind, el.value);
    const km = /^(admin\.editing\.goals\.\d+)\.kind$/.exec(el.dataset.bind);
    if (km) {
      const g = state.admin.editing.goals[+km[1].split('.').pop()];
      if (g.kind === 'gewicht' && !g.unit) g.unit = 'kg';
      if (g.kind === 'tijd') g.better = 'lager';
    }
    if (el.dataset.rerender) render();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.snap && !state.admin?.editing && state.view === 'home') refresh();
});

// ------------------------------------------------------------ start
(function boot() {
  const m = /[#&]t=([0-9a-fA-F]{20,})/.exec(location.hash);
  if (m) {
    setToken(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
  state.token = getToken();
  if (!state.token) { renderLogin(); return; }
  load();
})();

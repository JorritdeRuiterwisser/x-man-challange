// Rekenlogica van de X-man challenge. Geen scherm, geen netwerk: alleen
// datums, waarden, voortgang en regelmaat. Zo is alles apart te testen.

export const MS_PER_DAY = 86400000;
export const DEFAULT_WEEKLY_PLAN = 3; // geplande trainingen per week als er geen frequentiedoel is

const WEEKDAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const WEEKDAYS_LONG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

// ---------------------------------------------------------------- datums
// Dagen zijn tekst in de vorm "2026-10-19". We rekenen in UTC zodat
// zomer- en wintertijd nooit een dag verschuiven.

export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) throw new Error('Ongeldige datum: ' + iso);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toISO(new Date(parseISO(iso).getTime() + n * MS_PER_DAY));
}

export function diffDays(a, b) {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / MS_PER_DAY);
}

export function minISO(a, b) {
  return a <= b ? a : b;
}

export function fmtShort(iso) {
  const d = parseISO(iso);
  return WEEKDAYS_SHORT[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS_SHORT[d.getUTCMonth()];
}

export function fmtLong(iso) {
  const d = parseISO(iso);
  const w = WEEKDAYS_LONG[d.getUTCDay()];
  return w.charAt(0).toUpperCase() + w.slice(1) + ' ' + d.getUTCDate() + ' ' + MONTHS_LONG[d.getUTCMonth()];
}

export function fmtDate(iso) {
  const d = parseISO(iso);
  return d.getUTCDate() + ' ' + MONTHS_LONG[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

export function weekdayShort(iso) {
  return WEEKDAYS_SHORT[parseISO(iso).getUTCDay()];
}

export function dayNumber(iso) {
  return parseISO(iso).getUTCDate();
}

// dd-mm-jjjj  <->  jjjj-mm-dd
export function dmyToISO(text) {
  const m = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})\s*$/.exec(text || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  if (d.getUTCFullYear() !== +m[3] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[1]) return null;
  return toISO(d);
}

export function isoToDMY(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

// ---------------------------------------------------------------- weken en tussenstappen

export function totalDays(settings) {
  return diffDays(settings.end_date, settings.start_date) + 1;
}

export function totalWeeks(settings) {
  return Math.ceil(totalDays(settings) / 7);
}

// 1 voor de eerste week. Voor de start: 0. Na het einde: het laatste weeknummer.
export function weekNumber(settings, dayISO) {
  const idx = diffDays(dayISO, settings.start_date);
  if (idx < 0) return 0;
  return Math.min(Math.floor(idx / 7) + 1, totalWeeks(settings));
}

export function dayIndex(settings, dayISO) {
  return diffDays(dayISO, settings.start_date);
}

// De vier tussenstappen: einde van week 10, 20, 30 en de laatste dag.
export function milestoneDates(settings) {
  const end = settings.end_date;
  return [69, 139, 209].map((n) => minISO(addDays(settings.start_date, n), end)).concat([end]);
}

export const MILESTONE_LABELS = ['Week 10', 'Week 20', 'Week 30', 'Laatste dag'];

// Welke tussenstap is nu aan de beurt (de eerste die nog niet voorbij is).
export function currentMilestone(settings, todayISO) {
  const dates = milestoneDates(settings);
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= todayISO) return i;
  }
  return dates.length - 1;
}

// Bij welke tussenstap hoort een weeknummer (week 1-10 -> 0, 11-20 -> 1, 21-30 -> 2, rest -> 3)
export function milestoneOfWeek(week) {
  if (week <= 10) return 0;
  if (week <= 20) return 1;
  if (week <= 30) return 2;
  return 3;
}

export function lastFillableDay(settings, todayISO) {
  return minISO(settings.end_date, todayISO);
}

// ---------------------------------------------------------------- waarden

export const KINDS = {
  tijd: { label: 'Tijd', hint: 'minuten:seconden, bijvoorbeeld 26:00', placeholder: '26:00' },
  gewicht: { label: 'Getal met eenheid (bijv. kg, %)', hint: 'een getal, bijvoorbeeld 77,5', placeholder: '77,5', hasUnit: true },
  aantal: { label: 'Aantal of ander getal', hint: 'een getal, bijvoorbeeld 10', placeholder: '10', hasUnit: true },
  frequentie: { label: 'Keer per week', hint: 'trainingen per week, bijvoorbeeld 4', placeholder: '4' },
};

// Tekst -> getal. Geeft null terug voor leeg, NaN voor ongeldig.
// Tijden komen als seconden terug.
export function parseValue(kind, text) {
  const t = String(text ?? '').trim();
  if (t === '') return null;
  if (kind === 'tijd') {
    if (!t.includes(':')) {
      const minutes = Number(t.replace(',', '.'));
      return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : NaN;
    }
    const parts = t.split(':');
    if (parts.length < 2 || parts.length > 3) return NaN;
    if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p.trim()))) return NaN;
    const nums = parts.map((p) => Number(p.trim()));
    const sec = nums[nums.length - 1];
    const min = nums[nums.length - 2];
    const hrs = parts.length === 3 ? nums[0] : 0;
    if (sec >= 60) return NaN;
    if (parts.length === 3 && min >= 60) return NaN;
    const total = hrs * 3600 + min * 60 + sec;
    return total > 0 ? total : NaN;
  }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : NaN; // 0 is toegestaan
}

export function formatValue(kind, n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  if (kind === 'tijd') {
    const total = Math.round(n);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }
  if (kind === 'gewicht') return n.toFixed(1).replace('.', ',');
  if (kind === 'frequentie') return String(Math.round(n));
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

// Eenheid achter een waarde, bijvoorbeeld " kg" of "× per week"
export function unitText(goal) {
  if (goal.kind === 'frequentie') return '× per week';
  if (goal.kind === 'tijd') return '';
  return goal.unit ? ' ' + goal.unit : '';
}

// Waarde met eenheid, bijvoorbeeld "81,4 kg"
export function fmt(goal, n) {
  return formatValue(goal.kind, n) + unitText(goal);
}

// ---------------------------------------------------------------- voortgang

// Hoe ver ben je (0 tot 1) tussen je startpunt en het doel. Werkt voor lager
// en hoger is beter: (nu - start) / (doel - start).
export function fractionToTarget(start, target, current, better) {
  if (current === null || current === undefined || Number.isNaN(current)) return 0;
  if (target === start) {
    return better === 'lager' ? (current <= target ? 1 : 0) : (current >= target ? 1 : 0);
  }
  const f = (current - start) / (target - start);
  return Math.max(0, Math.min(1, f));
}

export function latestMeasurement(measurements, goalId, asOfISO) {
  let best = null;
  for (const m of measurements) {
    if (m.goal_id !== goalId || m.day > asOfISO) continue;
    if (best === null || m.day > best.day) best = m;
  }
  return best;
}

// Aantal getrainde dagen in de 7 dagen t/m asOf
export function trainingsLast7(entries, memberId, asOfISO) {
  const from = addDays(asOfISO, -6);
  let n = 0;
  for (const e of entries) {
    if (e.member_id === memberId && e.status === 'done' && e.day >= from && e.day <= asOfISO) n++;
  }
  return n;
}

// Huidige stand van een doel
export function goalCurrent(goal, snapshot, asOfISO) {
  if (goal.kind === 'frequentie') {
    return trainingsLast7(snapshot.entries, goal.member_id, asOfISO);
  }
  const m = latestMeasurement(snapshot.measurements, goal.id, asOfISO);
  return m ? m.value : null;
}

// Voortgang van een deelnemer richting de huidige tussenstap.
// pct is null als iemand geen doelen heeft.
export function memberProgress(member, snapshot, asOfISO, milestoneIdx) {
  const goals = snapshot.goals.filter((g) => g.member_id === member.id);
  const perGoal = goals.map((g) => {
    const target = g.targets[milestoneIdx];
    const current = goalCurrent(g, snapshot, asOfISO);
    const frac = fractionToTarget(g.start, target, current, g.better);
    return { goal: g, target, current, frac, pct: Math.round(frac * 100) };
  });
  if (perGoal.length === 0) return { pct: null, perGoal };
  const avg = perGoal.reduce((sum, x) => sum + x.frac, 0) / perGoal.length;
  return { pct: Math.round(avg * 100), perGoal };
}

// ---------------------------------------------------------------- regelmaat

export function plannedPerWeek(member, snapshot, milestoneIdx) {
  const freq = snapshot.goals.find((g) => g.member_id === member.id && g.kind === 'frequentie');
  return freq ? freq.targets[milestoneIdx] : DEFAULT_WEEKLY_PLAN;
}

// Regelmaat: hoeveel van je geplande trainingen heb je gedaan?
// De lopende week telt naar verhouding mee, zodat je op maandag niet
// meteen achterloopt.
export function regularity(member, snapshot, todayISO) {
  const s = snapshot.settings;
  const last = lastFillableDay(s, todayISO);
  const idx = dayIndex(s, last);
  if (idx < 0) return { score: null, done: 0, planned: 0 };
  const weeks = Math.floor(idx / 7) + 1;
  let sumDone = 0;
  let sumPlanned = 0;
  let totalDone = 0;
  for (let w = 1; w <= weeks; w++) {
    const wStart = addDays(s.start_date, (w - 1) * 7);
    const wEnd = addDays(wStart, 6);
    const elapsed = w < weeks ? 7 : idx - (w - 1) * 7 + 1;
    const plan = plannedPerWeek(member, snapshot, milestoneOfWeek(w)) * (elapsed / 7);
    let done = 0;
    for (const e of snapshot.entries) {
      if (e.member_id === member.id && e.status === 'done' && e.day >= wStart && e.day <= wEnd && e.day <= last) done++;
    }
    totalDone += done;
    sumDone += Math.min(done, plan);
    sumPlanned += plan;
  }
  if (sumPlanned === 0) return { score: null, done: totalDone, planned: 0 };
  return {
    score: Math.round((sumDone / sumPlanned) * 100),
    done: totalDone,
    planned: Math.round(sumPlanned),
  };
}

// ---------------------------------------------------------------- reeksen en activiteit

export function entryMap(entries, memberId) {
  const map = new Map();
  for (const e of entries) if (e.member_id === memberId) map.set(e.day, e);
  return map;
}

// Aantal dagen op rij ingevuld. Een nog lege vandaag breekt de reeks niet.
export function streak(entries, memberId, todayISO) {
  const map = entryMap(entries, memberId);
  let day = map.has(todayISO) ? todayISO : addDays(todayISO, -1);
  let n = 0;
  while (map.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

// Dagen sinds de laatste invulling (0 = vandaag). null als er nog nooit iets is ingevuld.
export function daysSinceLast(entries, memberId, todayISO) {
  let last = null;
  for (const e of entries) {
    if (e.member_id === memberId && e.day <= todayISO && (last === null || e.day > last)) last = e.day;
  }
  return last === null ? null : diffDays(todayISO, last);
}

// Trainingen per week voor het raster op het profiel. null = week is nog niet begonnen.
export function weeklyCounts(entries, memberId, settings, todayISO) {
  const weeks = totalWeeks(settings);
  const last = lastFillableDay(settings, todayISO);
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    const wStart = addDays(settings.start_date, (w - 1) * 7);
    if (wStart > last) {
      out.push(null);
      continue;
    }
    const wEnd = addDays(wStart, 6);
    let n = 0;
    for (const e of entries) {
      if (e.member_id === memberId && e.status === 'done' && e.day >= wStart && e.day <= wEnd) n++;
    }
    out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------- scorebord en feed

export function buildBoard(snapshot, todayISO) {
  const s = snapshot.settings;
  const ms = currentMilestone(s, todayISO);
  const weekAgo = addDays(todayISO, -7);
  return snapshot.members.map((member) => {
    const now = memberProgress(member, snapshot, todayISO, ms);
    const before = memberProgress(member, snapshot, weekAgo, ms);
    const reg = regularity(member, snapshot, todayISO);
    const first = now.perGoal[0];
    const extra = now.perGoal.length - 1;
    let goalText = 'Nog geen doelen';
    if (first) {
      goalText = first.goal.name + ': ' + fmt(first.goal, first.target);
      if (extra > 0) goalText += ` (+${extra} ${extra === 1 ? 'doel' : 'doelen'})`;
    }
    const today = snapshot.entries.find((e) => e.member_id === member.id && e.day === todayISO) || null;
    return {
      member,
      pct: now.pct,
      delta: now.pct === null || before.pct === null ? null : now.pct - before.pct,
      reg: reg.score,
      regDone: reg.done,
      regPlanned: reg.planned,
      goalText,
      streak: streak(snapshot.entries, member.id, todayISO),
      idleDays: daysSinceLast(snapshot.entries, member.id, todayISO),
      today,
    };
  });
}

export function sortBoard(rows, by) {
  const key = by === 'reg' ? 'reg' : 'pct';
  const other = key === 'pct' ? 'reg' : 'pct';
  return rows.slice().sort((a, b) => {
    const av = a[key] === null ? -1 : a[key];
    const bv = b[key] === null ? -1 : b[key];
    if (bv !== av) return bv - av;
    const ao = a[other] === null ? -1 : a[other];
    const bo = b[other] === null ? -1 : b[other];
    if (bo !== ao) return bo - ao;
    return a.member.name.localeCompare(b.member.name, 'nl');
  });
}

// Laatste activiteiten van de groep, nieuwste eerst.
export function recentActivity(snapshot, limit = 8) {
  const byId = new Map(snapshot.members.map((m) => [m.id, m]));
  const goalById = new Map(snapshot.goals.map((g) => [g.id, g]));
  const items = snapshot.entries
    .slice()
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
    .slice(0, limit);
  return items.map((e) => {
    const parts = [e.status === 'done' ? 'Getraind' : 'Rustdag'];
    for (const k of snapshot.measurements) {
      if (k.member_id === e.member_id && k.day === e.day) {
        const g = goalById.get(k.goal_id);
        if (g) parts.push(g.name + ' ' + fmt(g, k.value));
      }
    }
    const m = byId.get(e.member_id);
    return { name: m ? m.name : '?', day: e.day, text: parts.join(' · '), updated_at: e.updated_at };
  });
}

// ---------------------------------------------------------------- strijdverhalen

export const STORY_MAX_TITLE = 80;
export const STORY_MAX_BODY = 1500;

// Nieuwste strijdverhalen eerst, met de naam van de schrijver erbij.
export function recentStories(snapshot, limit = 60) {
  const byId = new Map(snapshot.members.map((m) => [m.id, m]));
  return (snapshot.stories || [])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, limit)
    .map((st) => ({ ...st, name: byId.has(st.member_id) ? byId.get(st.member_id).name : '?' }));
}

export function findStory(snapshot, memberId, dayISO) {
  return (snapshot.stories || []).find((x) => x.member_id === memberId && x.day === dayISO) || null;
}

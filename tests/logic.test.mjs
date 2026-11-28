import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const S = { start_date: '2026-10-19', end_date: '2027-07-18' };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('weken en dagen', () => {
  assert.equal(L.totalDays(S), 273);
  assert.equal(L.totalWeeks(S), 39);
  assert.equal(L.weekNumber(S, '2026-11-25'), 6);
  assert.equal(L.weekNumber(S, '2026-10-19'), 1);
  assert.equal(L.weekNumber(S, '2026-10-18'), 0);
  assert.equal(L.weekNumber(S, '2027-12-01'), 39);
});
t('tussenstappen', () => {
  assert.deepEqual(L.milestoneDates(S), ['2026-12-27', '2027-03-07', '2027-05-16', '2027-07-18']);
  assert.equal(L.currentMilestone(S, '2026-11-25'), 0);
  assert.equal(L.currentMilestone(S, '2026-12-28'), 1);
  assert.equal(L.currentMilestone(S, '2027-09-01'), 3);
});
t('datums over zomertijd', () => {
  assert.equal(L.addDays('2027-03-27', 1), '2027-03-28');
  assert.equal(L.diffDays('2027-03-29', '2027-03-26'), 3);
  assert.equal(L.dmyToISO('31-02-2026'), null);
  assert.equal(L.dmyToISO('19-10-2026'), '2026-10-19');
  assert.equal(L.isoToDMY('2026-10-19'), '19-10-2026');
});
t('waarden', () => {
  assert.equal(L.parseValue('tijd', '26:30'), 1590);
  assert.equal(L.parseValue('tijd', '1:02:03'), 3723);
  assert.ok(Number.isNaN(L.parseValue('tijd', '26:75')));
  assert.equal(L.parseValue('gewicht', '81,4'), 81.4);
  assert.equal(L.parseValue('aantal', ''), null);
  assert.ok(Number.isNaN(L.parseValue('aantal', 'abc')));
  assert.equal(L.formatValue('tijd', 1590), '26:30');
  assert.equal(L.formatValue('gewicht', 81.4), '81,4');
});
t('voortgang beide richtingen', () => {
  assert.equal(L.fractionToTarget(100, 80, 90, 'lager'), 0.5);
  assert.equal(L.fractionToTarget(100, 150, 125, 'hoger'), 0.5);
  assert.equal(L.fractionToTarget(100, 80, 110, 'lager'), 0);
  assert.equal(L.fractionToTarget(100, 80, 70, 'lager'), 1);
  assert.equal(L.fractionToTarget(100, 80, null, 'lager'), 0);
});

const snap = {
  settings: S,
  members: [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bas' }],
  goals: [
    { id: 'g1', member_id: 'a', name: 'Gewicht', kind: 'gewicht', better: 'lager', start: 90, targets: [85, 82, 80, 78] },
    { id: 'g2', member_id: 'a', name: 'Trainen', kind: 'frequentie', better: 'hoger', start: 1, targets: [4, 4, 4, 4] },
  ],
  entries: [], measurements: [],
};
// Anna traint 4x in week 1 (19-22 okt) en 2x in week 2
for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-26', '2026-10-27'])
  snap.entries.push({ member_id: 'a', day: d, status: 'done', updated_at: d });
snap.measurements.push({ member_id: 'a', goal_id: 'g1', day: '2026-11-20', value: 87.5 });

t('voortgang lid', () => {
  const p = L.memberProgress(snap.members[0], snap, '2026-10-27', 0);
  // gewicht: geen meting t/m 27 okt -> 0; frequentie: 6 dagen in laatste 7, doel 4 start 1 -> 1
  assert.equal(p.pct, 50);
  const p2 = L.memberProgress(snap.members[0], snap, '2026-11-25', 0);
  assert.equal(p2.perGoal[0].pct, 50); // (87.5-90)/(85-90)
  assert.equal(L.memberProgress(snap.members[1], snap, '2026-11-25', 0).pct, null);
});
t('regelmaat', () => {
  // t/m 27 okt: week1 plan 3 (min(4,3)=3), week2 plan 3*(2/7)... maar frequentiedoel 4
  const r = L.regularity(snap.members[0], snap, '2026-10-27');
  assert.equal(r.done, 6);
  const expected = Math.round(((4) + Math.min(2, 4 * 2 / 7)) / (4 + 4 * 2 / 7) * 100);
  assert.equal(r.score, expected);
  assert.equal(L.regularity(snap.members[1], snap, '2026-10-19').score, 0);
  assert.equal(L.regularity(snap.members[1], snap, '2026-10-18').score, null);
});
t('reeks en inactiviteit', () => {
  assert.equal(L.streak(snap.entries, 'a', '2026-10-22'), 4);
  assert.equal(L.streak(snap.entries, 'a', '2026-10-23'), 4); // lege vandaag breekt niet
  assert.equal(L.streak(snap.entries, 'a', '2026-10-24'), 0);
  assert.equal(L.daysSinceLast(snap.entries, 'a', '2026-10-30'), 3);
  assert.equal(L.daysSinceLast(snap.entries, 'b', '2026-10-30'), null);
});
t('scorebord en sortering', () => {
  const rows = L.buildBoard(snap, '2026-11-25');
  assert.equal(rows.length, 2);
  const s = L.sortBoard(rows, 'pct');
  assert.equal(s[0].member.name, 'Anna');
  assert.equal(s[1].pct, null);
  assert.match(rows[0].goalText, /\(\+1 doel\)/);
});
t('weekraster', () => {
  const w = L.weeklyCounts(snap.entries, 'a', S, '2026-11-25');
  assert.equal(w.length, 39); assert.equal(w[0], 4); assert.equal(w[1], 2);
  assert.equal(w[5], 0); assert.equal(w[6], null);
});
console.log(`\n${n} testgroepen geslaagd`);
t('nul en eenheden', () => {
  assert.equal(L.parseValue('aantal', '0'), 0);
  assert.equal(L.parseValue('gewicht', '0,0'), 0);
  assert.ok(Number.isNaN(L.parseValue('tijd', '0:00')));
  assert.ok(Number.isNaN(L.parseValue('aantal', '-1')));
  assert.equal(L.fmt({ kind: 'gewicht', unit: '%' }, 18.5), '18,5 %');
  assert.equal(L.fmt({ kind: 'gewicht', unit: 'kg' }, 81), '81,0 kg');
  assert.equal(L.fmt({ kind: 'aantal', unit: '' }, 0), '0');
  assert.equal(L.fmt({ kind: 'frequentie' }, 4), '4× per week');
  assert.equal(L.fractionToTarget(0, 10, 5, 'hoger'), 0.5);
});
t('strijdverhalen', () => {
  const sn = { members: [{ id: 'a', name: 'Anna' }], stories: [
    { member_id: 'a', day: '2026-11-20', title: 'Oud', body: 'x', created_at: '2026-11-20T10:00:00Z' },
    { member_id: 'a', day: '2026-11-25', title: 'Nieuw', body: 'y', created_at: '2026-11-25T10:00:00Z' }] };
  const r = L.recentStories(sn);
  assert.equal(r[0].title, 'Nieuw'); assert.equal(r[0].name, 'Anna');
  assert.equal(L.findStory(sn, 'a', '2026-11-20').title, 'Oud');
  assert.equal(L.findStory(sn, 'a', '2026-11-21'), null);
  assert.deepEqual(L.recentStories({ members: [] }), []);
});

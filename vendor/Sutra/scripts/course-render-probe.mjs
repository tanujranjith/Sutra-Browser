// Render probe: extracts the full Course Hub + All Due module (data + render)
// from app.js and exercises renderCourseHubView / renderAllDueView against a
// DOM stub to catch render-time runtime errors. One-shot, not CI.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(root, 'src/core/app.js'), 'utf8');
const startMarker = "const COURSE_TYPES = ['class', 'ap', 'activity', 'self_study', 'other'];";
const endMarker = "function setActiveView(view) {\n            const requestedView";
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);
if (startIdx < 0 || endIdx < 0) { console.error('markers not found', startIdx, endIdx); process.exit(1); }
const block = src.slice(startIdx, endIdx);

// ---- DOM/stubs ----
function makeEl() {
  const el = {
    _html: '', _text: '',
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); this._html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    get textContent() { return this._text; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {}, style: {}, appendChild() {}, remove() {}, focus() {}, click() {},
    setAttribute() {}, getAttribute() { return null; }, children: [], value: ''
  };
  return el;
}
const mounts = { courseHubMount: makeEl(), allDueMount: makeEl() };
const document = {
  getElementById: (id) => mounts[id] || null,
  createElement: () => makeEl(),
  querySelector: () => null, querySelectorAll: () => [],
  body: Object.assign(makeEl(), { dataset: { view: 'courses' } }),
  addEventListener() {}
};
let store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const window = { addEventListener() {}, dispatchEvent() {}, open() {}, showCustomConfirmDialog: () => Promise.resolve(true), atelierPrompt: () => Promise.resolve('x') };
class CustomEvent { constructor(t) { this.type = t; } }
const indexedDB = undefined;
let idN = 0; const generateId = () => '_' + (idN++).toString(36);
const showToast = () => {};
const persistAppData = () => {};
function normalizeDeadlineDate(rawDate, rawTime) { const d = String(rawDate || '').trim(); if (!d) return null; const t = String(rawTime || '').trim(); const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T${/^\d{2}:\d{2}$/.test(t) ? t : '23:59'}:00` : d; const o = new Date(iso); return isNaN(o) ? null : o; }
function startOfDay(d) { const o = new Date(d); o.setHours(0, 0, 0, 0); return o; }
function collectWorkspaceDeadlines() {
  const out = []; const now = new Date();
  const hw = JSON.parse(localStorage.getItem('hwTasks:v2') || '[]');
  const courses = JSON.parse(localStorage.getItem('hwCourses:v2') || '[]');
  const map = new Map(courses.map(c => [String(c.id), c.name]));
  hw.forEach(t => { if (!t || t.done) return; const due = normalizeDeadlineDate(t.dueDate, t.dueTime); if (!due) return; out.push({ id: `hw:${t.id}`, source: 'homework', sourceId: String(t.id), sourceCourseId: String(t.courseId || ''), title: t.title, subtitle: map.get(String(t.courseId)) || '', due, dueDate: t.dueDate, dueTime: t.dueTime, priority: t.priority || 'medium', status: 'open', overdue: due < now }); });
  return out;
}
let pages = [{ id: 'p1', title: 'Rotational Motion Notes', creationContext: { courseId: 'hc1' }, updatedAt: new Date().toISOString() }];
let reviewWorkspace = { decks: [{ id: 'd1', name: 'AP Physics deck' }] };
let apStudyWorkspace = { subjects: [{ id: 's1', name: 'Physics C', tags: ['Kinematics', 'Dynamics'] }] };
let timeBlocks = [];
let courseWorkspace;
const setActiveView = () => {}; const createNewPage = () => {}; const startFocusSession = () => {}; const openCourseFile = null;

const factory = new Function(
  'localStorage', 'window', 'document', 'CustomEvent', 'indexedDB', 'generateId', 'showToast', 'persistAppData',
  'normalizeDeadlineDate', 'startOfDay', 'collectWorkspaceDeadlines', 'pages', 'reviewWorkspace', 'apStudyWorkspace', 'timeBlocks',
  'setActiveView', 'createNewPage', 'startFocusSession', 'setCW',
  block +
  `\n;courseWorkspace = getDefaultCourseWorkspace(); setCW(courseWorkspace);` +
  `\nreturn { migrateAndBridgeCourses, renderCourseHubView, renderAllDueView, createCourse, createAssignmentForCourse, get cw(){return courseWorkspace;}, setCw(v){courseWorkspace=v;} };`
);

const api = factory(localStorage, window, document, CustomEvent, indexedDB, generateId, showToast, persistAppData,
  normalizeDeadlineDate, startOfDay, collectWorkspaceDeadlines, pages, reviewWorkspace, apStudyWorkspace, timeBlocks,
  setActiveView, createNewPage, startFocusSession, (v) => { courseWorkspace = v; });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };

try {
  // Empty-state render
  api.renderCourseHubView();
  ok(mounts.courseHubMount.innerHTML.includes('No courses yet'), 'Course Hub empty state renders');
  api.renderAllDueView();
  ok(mounts.allDueMount.innerHTML.includes('Nothing due') || mounts.allDueMount.innerHTML.includes('All Due'), 'All Due empty state renders');

  // Seed data + populated render
  store['hwCourses:v2'] = JSON.stringify([{ id: 'hc1', name: 'AP Physics C', type: 'class' }]);
  store['hwTasks:v2'] = JSON.stringify([
    { id: 't1', courseId: 'hc1', title: 'Rotational motion lab', dueDate: '2020-01-01', dueTime: '09:10', done: false, priority: 'high' },
    { id: 't2', courseId: 'hc1', title: 'Kinematics Problem Set', dueDate: '2999-01-05', dueTime: '23:59', done: false, priority: 'medium' }
  ]);
  api.migrateAndBridgeCourses({ source: 'hydrate' });

  api.renderCourseHubView();
  const ch = mounts.courseHubMount.innerHTML;
  ok(ch.includes('AP Physics C'), 'course name rendered');
  ok(ch.includes('Upcoming Assignments'), 'overview panel rendered');
  ok(ch.includes('cw-dropzone'), 'dropzone rendered');
  ok(ch.includes('Grade Snapshot'), 'grade snapshot rendered');
  ok(ch.includes('Rotational motion lab'), 'assignment shown in overview');
  ok(ch.includes('cw-stat'), 'stat cards rendered');

  api.renderAllDueView();
  const ad = mounts.allDueMount.innerHTML;
  ok(ad.includes('Everything Due'), 'Everything Due card rendered');
  ok(ad.includes('Overdue'), 'overdue stat rendered');
  ok(ad.includes('Quick Actions'), 'quick actions rendered');
  ok(ad.includes("Today's Schedule"), 'today schedule rendered');
  ok(ad.includes('Recent Files'), 'recent files rendered');
  ok(ad.includes('Rotational motion lab'), 'overdue item in table');
  ok(ad.includes('By Course'), 'by-course rendered');
} catch (e) {
  fail++; console.error('RENDER THREW:', e && e.stack ? e.stack : e);
}

console.log(`\nCourse render probe: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);

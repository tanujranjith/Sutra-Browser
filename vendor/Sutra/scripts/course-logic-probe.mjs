// Ad-hoc logic probe for Course Hub / All Due service layer.
// Extracts the data/service/migration/aggregation block from app.js and runs
// it against minimal stubs. NOT part of CI — a one-shot correctness check.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(root, 'src/core/app.js'), 'utf8');

const startMarker = "const COURSE_TYPES = ['class', 'ap', 'activity', 'self_study', 'other'];";
const endMarker = "// COURSE HUB & ALL DUE — rendering, interactions, generic modal, seed";
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);
if (startIdx < 0 || endIdx < 0) { console.error('markers not found', startIdx, endIdx); process.exit(1); }
const block = src.slice(startIdx, endIdx);

// ---- stubs ----
let store = {}; // localStorage backing
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const events = [];
const window = { dispatchEvent: (e) => { events.push(e.type); }, };
const document = { createElement: () => { let _t = ''; return { set textContent(v){ _t = String(v); }, get innerHTML(){ return _t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); } }; } };
class CustomEvent { constructor(t){ this.type = t; } }
const indexedDB = undefined; // exercise graceful-degradation path
let generateIdN = 0;
const generateId = () => '_' + (generateIdN++).toString(36) + Math.floor(Math.random()*1e6).toString(36);
const toasts = [];
const showToast = (m) => toasts.push(m);
let persistCount = 0;
const persistAppData = () => { persistCount++; };
function normalizeDeadlineDate(rawDate, rawTime) {
  const dateStr = String(rawDate || '').trim(); if (!dateStr) return null;
  const timeStr = String(rawTime || '').trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T${/^\d{2}:\d{2}$/.test(timeStr) ? timeStr : '23:59'}:00` : dateStr;
  const d = new Date(iso); return isNaN(d) ? null : d;
}
function startOfDay(d){ const o = new Date(d); o.setHours(0,0,0,0); return o; }
// Minimal collectWorkspaceDeadlines: read homework store like the real one.
function collectWorkspaceDeadlines() {
  const out = []; const now = new Date();
  const hw = JSON.parse(localStorage.getItem('hwTasks:v2') || '[]');
  const courses = JSON.parse(localStorage.getItem('hwCourses:v2') || '[]');
  const map = new Map(courses.map(c => [String(c.id), c.name]));
  hw.forEach(t => { if (!t || t.done) return; const due = normalizeDeadlineDate(t.dueDate, t.dueTime); if (!due) return;
    out.push({ id:`hw:${t.id}`, source:'homework', sourceId:String(t.id), sourceCourseId:String(t.courseId||''), title:t.title, subtitle: map.get(String(t.courseId))||'', due, dueDate:t.dueDate, dueTime:t.dueTime, priority:t.priority||'medium', status:t.done?'done':'open', overdue: due<now }); });
  return out;
}
let pages = [], reviewWorkspace = { decks: [] }, apStudyWorkspace = { subjects: [] }, timeBlocks = [];
let courseWorkspace; // assigned below from getDefaultCourseWorkspace

// Evaluate the block, capturing the functions we need via a trailing return.
const factory = new Function(
  'localStorage','window','document','CustomEvent','indexedDB','generateId','showToast','persistAppData',
  'normalizeDeadlineDate','startOfDay','collectWorkspaceDeadlines','pages','reviewWorkspace','apStudyWorkspace','timeBlocks','setCourseWorkspace','getCourseWorkspace',
  block + `\n;courseWorkspace = getDefaultCourseWorkspace(); setCourseWorkspace(courseWorkspace);` +
  `\nreturn { getDefaultCourseWorkspace, normalizeCourseWorkspace, migrateAndBridgeCourses, createCourse, updateCourse, archiveCourse, hardDeleteCourse, getCourses, getCourseById, getAssignmentsForCourse, createAssignmentForCourse, getAllDueItems, groupDueItemsByRange, getUpcomingMajorDeadlines, calculateCourseStats, addCourseResourceLink, getFilesForCourse, get cw(){ return courseWorkspace; } };`
);

let cwRef;
const api = factory(localStorage, window, document, CustomEvent, indexedDB, generateId, showToast, persistAppData,
  normalizeDeadlineDate, startOfDay, collectWorkspaceDeadlines, pages, reviewWorkspace, apStudyWorkspace, timeBlocks,
  (v) => { cwRef = v; }, () => cwRef);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };

// 1) Defaults + normalize
const def = api.getDefaultCourseWorkspace();
ok(def.schemaVersion === 1 && Array.isArray(def.courses), 'default workspace shape');
ok(api.normalizeCourseWorkspace({ courses: [{ name: 'X', type: 'misc' }] }).courses[0].type === 'activity', 'misc->activity normalize');

// 2) Seed legacy homework, migrate
store['hwCourses:v2'] = JSON.stringify([{ id: 'hc1', name: 'AP Physics', type: 'class' }, { id: 'hc2', name: 'Robotics', type: 'misc' }]);
store['hwTasks:v2'] = JSON.stringify([
  { id: 't1', courseId: 'hc1', title: 'Rotational lab', dueDate: '2020-01-01', dueTime: '09:10', done: false, priority: 'high' },
  { id: 't2', courseId: 'hc1', title: 'Energy Notes', dueDate: '2999-01-01', dueTime: '23:59', done: false, priority: 'low' }
]);
api.migrateAndBridgeCourses({ source: 'hydrate' });
let cw = api.cw;
ok(cw.courses.length === 2, 'migrated 2 homework courses');
ok(cw.courses.find(c => c.id === 'hc1' && c.type === 'class'), 'class type preserved + id preserved');
ok(cw.courses.find(c => c.id === 'hc2' && c.type === 'activity'), 'misc mapped to activity');

// 3) Idempotent migration (no dupes)
api.migrateAndBridgeCourses({ source: 'hydrate' });
api.migrateAndBridgeCourses({ source: 'hydrate' });
ok(api.cw.courses.length === 2, 'migration idempotent (no duplicate courses)');

// 4) Assignments via course service map to homework store
const assigns = api.getAssignmentsForCourse('hc1');
ok(assigns.length === 2, 'getAssignmentsForCourse reads homework tasks');
ok(assigns[0].type && typeof assigns[0].type === 'string', 'assignment type classified');
api.createAssignmentForCourse('hc1', { title: 'New FRQ practice', dueDate: '2999-02-02', priority: 'high' });
ok(JSON.parse(store['hwTasks:v2']).length === 3, 'createAssignmentForCourse wrote to hwTasks:v2');
ok(events.includes('homework:updated'), 'homework:updated dispatched on assignment create');

// 5) createCourse bridges into homework
const nc = api.createCourse({ name: 'AP English', type: 'ap', teacherName: 'Ms. Carter' });
ok(api.cw.courses.some(c => c.id === nc.id), 'createCourse added to workspace');
ok(JSON.parse(store['hwCourses:v2']).some(c => c.id === nc.id), 'createCourse bridged to homework lane');

// 6) Stats
const stats = api.calculateCourseStats();
ok(stats.activeCourses === 3, 'calculateCourseStats activeCourses=3 (' + stats.activeCourses + ')');
ok(stats.openAssignments >= 3, 'open assignments counted');

// 7) All Due aggregation + grouping
const due = api.getAllDueItems({});
ok(due.length >= 3, 'getAllDueItems aggregates (' + due.length + ')');
const grouped = api.groupDueItemsByRange(due);
ok('overdue' in grouped && 'today' in grouped && 'nextWeek' in grouped, 'range groups present');
ok(grouped.overdue.some(i => i.title === 'Rotational lab'), 'past-dated item is overdue');
const filtered = api.getAllDueItems({ search: 'rotational' });
ok(filtered.length === 1 && filtered[0].title === 'Rotational lab', 'search filters due items');
const byCourse = api.getAllDueItems({ courseId: 'hc1' });
ok(byCourse.every(i => i.courseId === 'hc1'), 'course filter on due items');

// 8) archive + hard delete
api.archiveCourse('hc2', true);
ok(api.getCourses({ filter: 'active' }).every(c => c.id !== 'hc2'), 'archive hides from active');
ok(api.getCourses({ filter: 'archived' }).some(c => c.id === 'hc2'), 'archived filter shows it');
api.hardDeleteCourse('hc1', { deleteAssignments: true });
ok(!api.getCourseById('hc1'), 'hardDeleteCourse removes course');
ok(JSON.parse(store['hwTasks:v2']).every(t => t.courseId !== 'hc1'), 'hardDelete cascaded homework tasks');

// 9) resource link
api.addCourseResourceLink(nc.id, { name: 'AP Classroom', url: 'https://x' });
ok(api.getFilesForCourse(nc.id).some(f => f.kind === 'link' && f.url === 'https://x'), 'resource link stored as file meta');

console.log(`\nCourse logic probe: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);

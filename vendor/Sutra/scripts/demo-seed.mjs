// Shared demo-data seed for Sutra screenshot/marketing captures.
// Produces a believable late-spring high-school junior workspace: AP courses,
// graded work, upcoming finals, homework, notes, review decks, timeline blocks,
// college-app deadlines, and life/business workspaces. All dates are anchored
// to "today" so captures always look current.
//
// Exported as a string of browser-evaluable code so the capture harness can run
// it inside page.evaluate without a bundler.

export const SEED_FN = function seedSutraDemo() {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = (offset) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return iso(d);
  };

  const out = { courses: {}, notes: 0, decks: 0, tasks: 0 };

  // ---- Courses ----------------------------------------------------------
  const hub = window.courseHub;
  const courseDefs = [
    { name: 'AP Calculus BC', short: 'Calc BC', type: 'ap', teacherName: 'Ms. Whitfield', room: '305', subjectArea: 'Mathematics', color: '#6C63FF' },
    { name: 'AP Biology', short: 'Bio', type: 'ap', teacherName: 'Dr. Okafor', room: '212', subjectArea: 'Science', color: '#2BB673' },
    { name: 'AP U.S. History', short: 'APUSH', type: 'ap', teacherName: 'Mr. Delgado', room: '118', subjectArea: 'History', color: '#E07A3F' },
    { name: 'English Literature', short: 'English', type: 'class', teacherName: 'Ms. Hartley', room: '224', subjectArea: 'English', color: '#C84B8C' },
    { name: 'Spanish IV', short: 'Spanish', type: 'class', teacherName: 'Sra. Ibáñez', room: '140', subjectArea: 'World Language', color: '#3FA7E0' }
  ];
  const courses = {};
  courseDefs.forEach((c) => {
    const created = hub.createCourse({
      name: c.name, shortName: c.short, type: c.type,
      teacherName: c.teacherName, room: c.room, subjectArea: c.subjectArea, color: c.color
    });
    courses[c.short] = created;
    out.courses[c.short] = created.id;
  });

  // ---- Grades -----------------------------------------------------------
  const gp = window.SutraGradePlanner;
  function grade(course, cats, entries) {
    gp.setCategoriesForCourse(course.id, cats);
    entries.forEach((e) => gp.addEntryForCourse(course.id, e));
  }
  grade(courses['Calc BC'],
    [{ id: 'tests', name: 'Tests', weight: 60 }, { id: 'hw', name: 'Homework', weight: 25 }, { id: 'quiz', name: 'Quizzes', weight: 15 }],
    [
      { categoryId: 'tests', title: 'Unit 6 — Integrals', score: 91, maxScore: 100, status: 'graded' },
      { categoryId: 'tests', title: 'Unit 7 — Series', score: 86, maxScore: 100, status: 'graded' },
      { categoryId: 'quiz', title: 'Taylor Series Quiz', score: 18, maxScore: 20, status: 'graded' },
      { categoryId: 'hw', title: 'Problem Set 9', score: 10, maxScore: 10, status: 'graded' },
      { categoryId: 'tests', title: 'Final Exam', score: null, maxScore: 100, status: 'upcoming' }
    ]);
  grade(courses['Bio'],
    [{ id: 'tests', name: 'Exams', weight: 50 }, { id: 'lab', name: 'Labs', weight: 30 }, { id: 'hw', name: 'Homework', weight: 20 }],
    [
      { categoryId: 'tests', title: 'Genetics Exam', score: 88, maxScore: 100, status: 'graded' },
      { categoryId: 'lab', title: 'Enzyme Lab Report', score: 47, maxScore: 50, status: 'graded' },
      { categoryId: 'lab', title: 'Photosynthesis Lab', score: null, maxScore: 50, status: 'missing' },
      { categoryId: 'hw', title: 'Ch. 14 Reading Guide', score: 19, maxScore: 20, status: 'graded' }
    ]);
  grade(courses['APUSH'],
    [{ id: 'tests', name: 'Tests', weight: 55 }, { id: 'essay', name: 'Essays (DBQ/LEQ)', weight: 30 }, { id: 'hw', name: 'Homework', weight: 15 }],
    [
      { categoryId: 'essay', title: 'Gilded Age DBQ', score: 6, maxScore: 7, status: 'graded' },
      { categoryId: 'tests', title: 'Cold War Unit Test', score: 90, maxScore: 100, status: 'graded' }
    ]);

  // ---- Tasks (Today) ----------------------------------------------------
  const fa = window.flowAssistant;
  function task(t) { fa.applyAction(Object.assign({ type: 'create_task' }, t)); out.tasks++; }
  task({ title: 'Review Taylor & Maclaurin series', dueDate: day(0), dueTime: '16:00', priority: 'high', difficulty: 'hard' });
  task({ title: 'Outline APUSH LEQ on Reconstruction', dueDate: day(0), dueTime: '19:30', priority: 'high', difficulty: 'medium' });
  task({ title: 'Flashcards: Bio genetics terms', dueDate: day(0), priority: 'medium', difficulty: 'easy' });
  task({ title: 'Re-submit Photosynthesis lab', dueDate: day(-1), priority: 'high', difficulty: 'medium' });
  task({ title: 'Email Ms. Whitfield about retake', dueDate: day(1), priority: 'medium', difficulty: 'easy' });

  // ---- Homework ---------------------------------------------------------
  function hw(t) { fa.applyAction(Object.assign({ type: 'create_homework' }, t)); }
  hw({ title: 'Problem Set 10 (Series convergence)', courseName: 'AP Calculus BC', dueDate: day(1), difficulty: 'hard' });
  hw({ title: 'Read Ch. 16 + reading guide', courseName: 'AP Biology', dueDate: day(2), difficulty: 'medium' });
  hw({ title: 'Annotate "The Great Gatsby" Ch. 7–9', courseName: 'English Literature', dueDate: day(3), difficulty: 'medium' });
  hw({ title: 'Spanish IV: subjunctive worksheet', courseName: 'Spanish IV', dueDate: day(0), difficulty: 'easy' });
  hw({ title: 'APUSH timeline review notes', courseName: 'AP U.S. History', dueDate: day(4), difficulty: 'easy' });

  // ---- Notes ------------------------------------------------------------
  function note(title, body, tags, classKey) {
    const res = fa.applyAction({ type: 'create_page', title, body, tags });
    out.notes++;
    return res;
  }
  note('Calc BC — Series Cheat Sheet',
    '# Convergence tests at a glance\n\n- **nth-term test** — if lim a_n ≠ 0, diverges.\n- **Geometric** — converges iff |r| < 1, sum = a / (1 − r).\n- **p-series** — converges iff p > 1.\n- **Ratio test** — L < 1 converges, L > 1 diverges, L = 1 inconclusive.\n- **Alternating series** — terms decrease to 0 ⇒ converges.\n\n## Taylor / Maclaurin\nf(x) = Σ f⁽ⁿ⁾(a)/n! · (x − a)ⁿ\n\nKey expansions: eˣ, sin x, cos x, 1/(1−x).',
    ['math', 'finals']);
  note('Biology — Genetics Unit',
    '# Mendelian genetics\n\n- Law of segregation / independent assortment.\n- Punnett squares: monohybrid 3:1, dihybrid 9:3:3:1.\n\n## Molecular\n- Replication is **semiconservative**.\n- Transcription → translation (central dogma).\n- Codon table basics; start = AUG.',
    ['biology', 'finals']);
  note('APUSH — Reconstruction LEQ plan',
    '# Thesis\nReconstruction reshaped citizenship but failed to secure lasting equality.\n\n## Evidence\n- 13th / 14th / 15th Amendments\n- Freedmen\'s Bureau\n- Compromise of 1877 → end of federal enforcement\n\n## Analysis\nContinuity vs. change in Black political participation, 1865–1900.',
    ['history', 'essay']);
  note('English — The Great Gatsby motifs',
    '# Motifs\n- The green light → hope, the unreachable dream.\n- Eyes of Dr. T.J. Eckleburg → moral decay.\n- East vs. West Egg → old vs. new money.\n\n> "So we beat on, boats against the current..."',
    ['english']);

  // ---- Review decks -----------------------------------------------------
  if (typeof window.createReviewDeck === 'function' && typeof window.bulkImportReviewCards === 'function') {
    const d1 = window.createReviewDeck({ name: 'Calc BC — Series & Convergence', description: 'Finals review' });
    window.bulkImportReviewCards(d1.id,
      'Geometric series converges when?\t|r| < 1\n' +
      'p-series converges when?\tp > 1\n' +
      'Ratio test: L < 1 means?\tConverges absolutely\n' +
      'Maclaurin series of eˣ?\tΣ xⁿ / n!\n' +
      'nth-term test tells you?\tIf lim a_n ≠ 0, the series diverges');
    out.decks++;
    const d2 = window.createReviewDeck({ name: 'AP Bio — Genetics', description: 'Unit 5 terms' });
    window.bulkImportReviewCards(d2.id,
      'Semiconservative replication?\tEach new DNA has one old + one new strand\n' +
      'Codon for start?\tAUG (methionine)\n' +
      'Dihybrid cross ratio?\t9:3:3:1\n' +
      'Law of segregation?\tAlleles separate during gamete formation');
    out.decks++;
  }

  // ---- Timeline blocks (today) -----------------------------------------
  function block(b) { fa.applyAction(Object.assign({ type: 'create_timeline_block' }, b)); }
  block({ name: 'AP Calculus BC', date: day(0), start: '08:00', end: '09:30', category: 'class' });
  block({ name: 'AP Biology', date: day(0), start: '09:40', end: '11:10', category: 'class' });
  block({ name: 'Lunch + flashcards', date: day(0), start: '11:10', end: '12:00', category: 'break' });
  block({ name: 'AP U.S. History', date: day(0), start: '12:10', end: '13:40', category: 'class' });
  block({ name: 'Calc finals review', date: day(0), start: '16:00', end: '17:30', category: 'study' });
  block({ name: 'APUSH LEQ outline', date: day(0), start: '19:30', end: '20:30', category: 'study' });

  // ---- AP subjects (Testing Hub) ---------------------------------------
  try {
    if (window.apStudyWorkspace && Array.isArray(window.apStudyWorkspace.subjects)) {
      const subj = window.apStudyWorkspace.subjects;
      const mk = (o) => Object.assign({
        id: 'apsubject_' + Math.random().toString(36).slice(2, 9),
        examTime: '08:00', quickTasks: [], description: '', noteId: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }, o);
      subj.push(mk({ name: 'AP Calculus BC', examDate: day(5), teacherName: 'Ms. Whitfield', currentUnit: 'Unit 10 — Series', totalUnitCount: 10, targetScore: 5, confidenceLevel: 4, readiness: 78, color: '#6C63FF' }));
      subj.push(mk({ name: 'AP Biology', examDate: day(8), teacherName: 'Dr. Okafor', currentUnit: 'Unit 6 — Gene Expression', totalUnitCount: 8, targetScore: 4, confidenceLevel: 3, readiness: 64, color: '#2BB673' }));
      subj.push(mk({ name: 'AP U.S. History', examDate: day(12), teacherName: 'Mr. Delgado', currentUnit: 'Period 8 — Cold War', totalUnitCount: 9, targetScore: 4, confidenceLevel: 3, readiness: 59, color: '#E07A3F' }));
      if (typeof window.normalizeApStudyWorkspace === 'function') {
        try { window.apStudyWorkspace = window.normalizeApStudyWorkspace(window.apStudyWorkspace); } catch (e) {}
      }
    }
  } catch (e) {}

  // ---- College-app deadlines -------------------------------------------
  function col(c) { try { fa.applyAction(Object.assign({ type: 'create_college_task' }, c)); } catch (e) {} }
  col({ kind: 'deadline', title: 'Common App — open & draft activities list', dueDate: day(40) });
  col({ kind: 'essay', title: 'Personal statement — first draft', dueDate: day(55) });
  col({ kind: 'scholarship', title: 'Coca-Cola Scholars application', dueDate: day(72) });

  // ---- Persist & render -------------------------------------------------
  try { window.persistAppData && window.persistAppData(); } catch (e) {}
  ['renderAcademicWorkspace', 'renderTaskViews', 'renderPagesList', 'renderTimeline',
   'renderCourseHubView', 'renderAllDueView', 'renderApStudyWorkspace', 'renderCollegeAppWorkspace',
   'renderLifeWorkspace', 'renderBusinessWorkspace'].forEach((fn) => {
    try { if (typeof window[fn] === 'function') window[fn](); } catch (e) {}
  });
  try { window.flowAssistant && window.flowAssistant.refresh && window.flowAssistant.refresh(); } catch (e) {}

  return out;
};

export const SEED_SRC = `(${SEED_FN.toString()})()`;

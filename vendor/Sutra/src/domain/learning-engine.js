/* Confidence calibration, mistake correction, readiness, and exam sprint plans. */
(function (global) {
  'use strict';

  var mastery = global.SutraMastery;
  if (!mastery && typeof module !== 'undefined' && module.exports) mastery = require('./mastery.js');
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
  function id(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  function norm(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  // Stable, content-derived id for a mistake that carries no id of its own, so
  // that a retry (double-click, re-apply after a transient persist failure)
  // dedupes against the card it already created instead of minting a fresh
  // random id every call. Distinct mistakes still fingerprint differently.
  function fingerprint(text) {
    var s = String(text || ''), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function stableMistakeId(source) {
    if (source && source.id) return String(source.id);
    var basis = norm(source && (source.question || source.prompt || source.title)) + '|'
      + norm(source && (source.correction || source.correctAnswer || source.explanation || source.lesson)) + '|'
      + norm(source && (source.courseId || source.courseName || source.examId));
    return 'mistake_fp_' + fingerprint(basis);
  }

  function startConfidenceCheck(workspace, input, options) {
    var next = clone(workspace || {}), row = input || {};
    next.confidenceObservations = list(next.confidenceObservations);
    var key = norm(row.key || row.topic || row.concept);
    if (!key) throw new Error('Confidence check requires a topic key.');
    var observation = {
      id: String(row.id || id('prediction')),
      key: key,
      confidence: clamp01(row.confidence),
      correctness: null,
      sourceId: String(row.sourceId || ''),
      courseId: String(row.courseId || row.classId || ''),
      predictedAt: String(options && options.now || row.predictedAt || new Date().toISOString()),
      revealedAt: null
    };
    next.confidenceObservations.push(observation);
    return { workspace: next, receipt: { changedIds: [observation.id], warnings: [], undo: { removeConfidenceObservationIds: [observation.id] }, persistenceStatus: 'pending' }, observation: observation };
  }

  function resolveConfidenceCheck(workspace, predictionId, result, options) {
    var next = clone(workspace || {});
    next.confidenceObservations = list(next.confidenceObservations);
    var index = next.confidenceObservations.findIndex(function (row) { return String(row && row.id) === String(predictionId); });
    if (index < 0) throw new Error('Confidence prediction was not found.');
    var prediction = next.confidenceObservations[index];
    if (prediction.correctness !== null && prediction.correctness !== undefined) throw new Error('Confidence prediction was already resolved.');
    next.confidenceObservations.splice(index, 1);
    var observedAt = String(options && options.now || new Date().toISOString());
    var recorded = mastery.recordObservation(next, {
      id: prediction.id,
      key: prediction.key,
      confidence: prediction.confidence,
      correctness: result && result.correctness !== undefined ? result.correctness : (result && result.correct ? 1 : 0),
      sourceId: prediction.sourceId,
      courseId: prediction.courseId,
      observedAt: observedAt
    }, { now: observedAt });
    var resolved = recorded.workspace.confidenceObservations.find(function (row) { return row.id === prediction.id; });
    if (resolved) {
      resolved.predictedAt = prediction.predictedAt;
      resolved.revealedAt = observedAt;
    }
    recorded.receipt.changedIds.unshift(prediction.id);
    recorded.receipt.undo = { predictionBefore: prediction, masteryBefore: recorded.receipt.undo && recorded.receipt.undo.masteryBefore };
    return { workspace: recorded.workspace, receipt: recorded.receipt, observation: resolved };
  }

  function getCalibration(workspace, options) {
    var rows = list(workspace && workspace.confidenceObservations).filter(function (row) { return row && row.correctness !== null && row.correctness !== undefined; });
    if (options && options.courseId) rows = rows.filter(function (row) { return String(row.courseId || '') === String(options.courseId); });
    if (!rows.length) return { samples: 0, brierScore: null, averageConfidence: null, accuracy: null, calibrationGap: null, tendency: 'unknown', buckets: [] };
    var confidenceSum = 0, accuracySum = 0, brier = 0;
    var buckets = [{ min: 0, max: .25 }, { min: .25, max: .5 }, { min: .5, max: .75 }, { min: .75, max: 1 }].map(function (bucket) { return Object.assign(bucket, { count: 0, confidence: 0, accuracy: 0 }); });
    rows.forEach(function (row) {
      var confidence = clamp01(row.confidence), correctness = clamp01(row.correctness);
      confidenceSum += confidence; accuracySum += correctness; brier += Math.pow(confidence - correctness, 2);
      var bucket = buckets[Math.min(3, Math.floor(confidence * 4))];
      bucket.count += 1; bucket.confidence += confidence; bucket.accuracy += correctness;
    });
    var averageConfidence = confidenceSum / rows.length, accuracy = accuracySum / rows.length, gap = averageConfidence - accuracy;
    return {
      samples: rows.length,
      brierScore: Math.round(brier / rows.length * 1000) / 1000,
      averageConfidence: Math.round(averageConfidence * 1000) / 1000,
      accuracy: Math.round(accuracy * 1000) / 1000,
      calibrationGap: Math.round(gap * 1000) / 1000,
      tendency: Math.abs(gap) < .08 ? 'calibrated' : (gap > 0 ? 'overconfident' : 'underconfident'),
      buckets: buckets.filter(function (bucket) { return bucket.count; }).map(function (bucket) { return { range: [bucket.min, bucket.max], count: bucket.count, confidence: Math.round(bucket.confidence / bucket.count * 1000) / 1000, accuracy: Math.round(bucket.accuracy / bucket.count * 1000) / 1000 }; })
    };
  }

  function createCorrectionFromMistake(workspace, mistake, options) {
    var next = clone(workspace || {}), source = mistake || {}, opts = options || {};
    next.reviewWorkspace = next.reviewWorkspace && typeof next.reviewWorkspace === 'object' ? next.reviewWorkspace : { decks: [], items: [], sessions: [], settings: {} };
    next.reviewWorkspace.decks = list(next.reviewWorkspace.decks);
    next.reviewWorkspace.items = list(next.reviewWorkspace.items);
    next.tasks = list(next.tasks);
    next.taskDependencies = list(next.taskDependencies);
    var mistakeId = stableMistakeId(source);
    var duplicate = next.reviewWorkspace.items.find(function (item) { return item && item.sourceType === 'mistake' && String(item.sourceId) === mistakeId; });
    if (duplicate) return { workspace: next, receipt: { changedIds: [], warnings: ['A correction card already exists for this mistake.'], undo: null, persistenceStatus: 'unchanged' }, card: duplicate };
    var deckName = String(opts.deckName || (source.courseName ? source.courseName + ' — Mistake Corrections' : 'Mistake Corrections'));
    var deck = next.reviewWorkspace.decks.find(function (row) { return norm(row && row.name) === norm(deckName); });
    var changed = [];
    if (!deck) {
      deck = { id: id('deck'), name: deckName, description: 'Cards generated from reviewed mistakes.', subject: String(source.courseName || source.subject || ''), sourceType: 'mistake_corrections', sourceId: String(source.examId || source.courseId || ''), archived: false, studyMode: 'flashcards', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      next.reviewWorkspace.decks.push(deck); changed.push(deck.id);
    }
    var prompt = String(source.question || source.prompt || source.title || 'What should you do differently next time?').trim();
    var answer = String(source.correction || source.correctAnswer || source.explanation || source.lesson || '').trim();
    if (!answer) throw new Error('A correction card requires the correct answer or lesson learned.');
    var now = String(opts.now || new Date().toISOString());
    var card = { id: id('item'), deckId: deck.id, prompt: prompt, answer: answer, hint: String(source.category || ''), imageUrl: '', starred: true, mastery: 'new', correctCount: 0, incorrectCount: 0, studyTimeSeconds: 0, tags: ['mistake-correction'].concat(list(source.tags)), sourceType: 'mistake', sourceId: mistakeId, sourceNoteId: String(source.noteId || ''), sourceAssignmentId: String(source.assignmentId || ''), difficulty: String(source.difficulty || 'medium'), status: 'new', nextReviewAt: now, lastReviewedAt: null, intervalDays: 0, ease: 2.5, repetitions: 0, lapses: 0, generationReason: 'Created from a reviewed mistake to practice the corrected reasoning.', sourceCitation: { kind: 'mistake', id: mistakeId }, createdAt: now, updatedAt: now };
    next.reviewWorkspace.items.push(card); changed.push(card.id);
    var task = null;
    if (opts.createFollowUpTask !== false) {
      task = { id: id('task'), title: 'Retry: ' + String(source.title || source.question || 'mistake').slice(0, 140), notes: 'Practice the linked correction card without looking at the answer.', dueAt: String(opts.followUpAt || new Date((Date.parse(now) || Date.now()) + 3 * 86400000).toISOString()), priority: 'medium', difficulty: 'medium', completed: false, linkedReviewItemId: card.id, sourceType: 'mistake_follow_up', sourceId: mistakeId, createdAt: now, updatedAt: now };
      next.tasks.push(task); changed.push(task.id);
    }
    return { workspace: next, receipt: { changedIds: changed, warnings: [], undo: { removeDeckIds: changed.indexOf(deck.id) >= 0 ? [deck.id] : [], removeReviewItemIds: [card.id], removeTaskIds: task ? [task.id] : [] }, persistenceStatus: 'pending' }, card: card, task: task };
  }

  function computeReadiness(workspace, exam, options) {
    var source = exam || {}, nowMs = Date.parse(options && options.now || '') || Date.now();
    var examMs = Date.parse(source.examDate || source.date || source.dueAt || '');
    var daysUntil = Number.isFinite(examMs) ? Math.ceil((examMs - nowMs) / 86400000) : null;
    var topicPrefix = norm(source.masteryPrefix || source.courseId || source.id);
    var topics = mastery.getMemoryMap(workspace || {}, { now: new Date(nowMs).toISOString() }).filter(function (row) { return !topicPrefix || row.key.indexOf(topicPrefix) === 0; });
    var masteryScore = topics.length ? topics.reduce(function (sum, row) { return sum + clamp01(row.score); }, 0) / topics.length : .35;
    var mistakes = list(source.mistakes || (workspace && workspace.testingHub && workspace.testingHub.mistakes)).filter(function (row) { return !source.id || !row.examId || String(row.examId) === String(source.id); });
    var unresolved = mistakes.filter(function (row) { return row && row.resolved !== true; });
    var mistakeScore = mistakes.length ? 1 - unresolved.length / mistakes.length : .55;
    var practice = list(source.practiceTests || source.practice || []);
    var practiceScore = practice.length ? practice.reduce(function (sum, row) { var value = Number(row.percent !== undefined ? row.percent : row.score); return sum + Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)) / 100; }, 0) / practice.length : .4;
    var recencyScore = practice.some(function (row) { return nowMs - (Date.parse(row.completedAt || row.date || '') || 0) <= 7 * 86400000; }) ? 1 : (practice.length ? .65 : .3);
    var score = Math.round((masteryScore * .45 + practiceScore * .25 + mistakeScore * .2 + recencyScore * .1) * 100);
    var assumptions = [];
    if (!topics.length) assumptions.push('No canonical topic mastery is linked to this exam.');
    if (!practice.length) assumptions.push('No scored practice is entered.');
    if (!mistakes.length) assumptions.push('No mistake history is entered.');
    if (daysUntil === null) assumptions.push('No exam date is set.');
    return { score: score, label: score >= 85 ? 'Ready' : score >= 70 ? 'Nearly ready' : score >= 50 ? 'Building' : 'Needs focus', daysUntil: daysUntil, components: { mastery: Math.round(masteryScore * 100), practice: Math.round(practiceScore * 100), mistakeResolution: Math.round(mistakeScore * 100), recency: Math.round(recencyScore * 100) }, weakTopics: topics.filter(function (row) { return row.state !== 'mastered'; }).slice(0, 12), unresolvedMistakes: unresolved.slice(0, 20), assumptions: assumptions, confidence: assumptions.length <= 1 ? 'high' : assumptions.length === 2 ? 'medium' : 'low' };
  }

  function buildFinal72Plan(workspace, exam, options) {
    var readiness = computeReadiness(workspace, exam, options), source = exam || {};
    if (readiness.daysUntil === null || readiness.daysUntil > 3) return { eligible: false, reason: 'Final-72-hours mode begins three days before the exam.', readiness: readiness, blocks: [], checklist: [] };
    var topics = readiness.weakTopics.map(function (row) { return row.key; });
    var mistakes = readiness.unresolvedMistakes.map(function (row) { return String(row.title || row.question || row.category || 'Review a mistake'); });
    var blocks = [];
    [3, 2, 1].forEach(function (day, index) {
      var topic = topics[index % Math.max(1, topics.length)] || 'highest-yield concepts';
      blocks.push({ id: 'final72-' + day + '-recall', dayBeforeExam: day, minutes: day === 1 ? 30 : 45, kind: 'active_recall', title: 'Active recall: ' + topic, reason: 'Weak or decaying mastery receives retrieval practice first.' });
      if (mistakes.length) blocks.push({ id: 'final72-' + day + '-mistakes', dayBeforeExam: day, minutes: 30, kind: 'mistake_review', title: 'Redo mistakes without notes', reason: 'Unresolved mistakes are higher leverage than rereading.' });
      if (day > 1) blocks.push({ id: 'final72-' + day + '-timed', dayBeforeExam: day, minutes: 40, kind: 'timed_practice', title: 'Timed mixed practice', reason: 'Calibrates pacing and readiness under exam conditions.' });
    });
    return { eligible: true, readiness: readiness, blocks: blocks, protectedSleepHours: Math.max(7, Number(options && options.protectedSleepHours) || 8), checklist: ['Confirm exam time and location', 'Pack required materials and identification', 'Set two alarms', 'Stop heavy study before the protected sleep window', 'Review only the one-page essentials sheet on exam morning'], warnings: readiness.daysUntil < 0 ? ['The exam date has passed; verify the date before scheduling.'] : [], reviewRequired: true };
  }

  var api = { VERSION: '1.0.0', startConfidenceCheck: startConfidenceCheck, resolveConfidenceCheck: resolveConfidenceCheck, getCalibration: getCalibration, createCorrectionFromMistake: createCorrectionFromMistake, computeReadiness: computeReadiness, buildFinal72Plan: buildFinal72Plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraLearning = api;
}(typeof window !== 'undefined' ? window : globalThis));

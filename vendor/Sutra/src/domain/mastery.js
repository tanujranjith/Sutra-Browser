/* Canonical local mastery observations and memory-map derivation. */
(function (global) {
  'use strict';
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
  function keyOf(value) { return String(value || '').trim().toLowerCase(); }
  function classify(score, attempts, lastObservedAt, nowMs) {
    if (!attempts) return 'unstudied';
    var ageDays = Math.max(0, nowMs - (Date.parse(lastObservedAt || '') || nowMs)) / 86400000;
    var decayed = score * Math.pow(0.985, ageDays);
    if (decayed >= 0.82 && attempts >= 3) return 'mastered';
    if (decayed >= 0.55) return 'shaky';
    return ageDays >= 14 ? 'forgotten' : 'shaky';
  }
  function getTopicState(workspace, topicKey, options) {
    var key = keyOf(topicKey);
    var row = list(workspace && workspace.masteryRecords).find(function (item) { return keyOf(item && item.key) === key; });
    if (!row) return { key: key, score: 0, attempts: 0, state: 'unstudied', lastObservedAt: '' };
    var nowMs = Date.parse(options && options.now || '') || Date.now();
    return Object.assign({}, clone(row), { state: classify(clamp(row.score), Number(row.attempts) || 0, row.lastObservedAt, nowMs) });
  }
  function recordObservation(workspace, observation, options) {
    var next = clone(workspace || {});
    next.masteryRecords = list(next.masteryRecords);
    next.confidenceObservations = list(next.confidenceObservations);
    var obs = observation || {};
    var key = keyOf(obs.key || obs.topic || obs.concept);
    if (!key) throw new Error('Mastery observation requires a topic key.');
    var now = String(options && options.now || obs.observedAt || new Date().toISOString());
    var correctness = clamp(obs.correctness !== undefined ? obs.correctness : (obs.correct ? 1 : 0));
    var confidence = clamp(obs.confidence !== undefined ? obs.confidence : 0.5);
    var signal = clamp(correctness * 0.8 + (1 - Math.abs(confidence - correctness)) * 0.2);
    var index = next.masteryRecords.findIndex(function (item) { return keyOf(item && item.key) === key; });
    var previous = index >= 0 ? next.masteryRecords[index] : { key: key, score: 0, attempts: 0, courseId: String(obs.courseId || ''), sources: [] };
    var attempts = (Number(previous.attempts) || 0) + 1;
    var score = attempts === 1 ? signal : clamp((Number(previous.score) || 0) * 0.72 + signal * 0.28);
    var intervalDays = score >= 0.85 ? 14 : score >= 0.65 ? 5 : 1;
    var row = Object.assign({}, previous, { key: key, score: Math.round(score * 1000) / 1000, attempts: attempts, lastObservedAt: now, nextReviewAt: new Date((Date.parse(now) || Date.now()) + intervalDays * 86400000).toISOString(), updatedAt: now });
    row.sources = Array.from(new Set(list(previous.sources).concat(obs.sourceId ? [String(obs.sourceId)] : []))).slice(-50);
    if (index >= 0) next.masteryRecords[index] = row; else next.masteryRecords.push(row);
    var observationRow = { id: String(obs.id || ('confidence-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7))), key: key, correctness: correctness, confidence: confidence, sourceId: String(obs.sourceId || ''), courseId: String(obs.courseId || ''), observedAt: now };
    next.confidenceObservations.push(observationRow);
    return { workspace: next, receipt: { changedIds: [key, observationRow.id], warnings: [], undo: { masteryBefore: index >= 0 ? clone(previous) : null }, persistenceStatus: 'pending' } };
  }
  function getMemoryMap(workspace, options) {
    return list(workspace && workspace.masteryRecords).map(function (item) { return getTopicState(workspace, item.key, options); })
      .sort(function (a, b) { return a.score - b.score || a.key.localeCompare(b.key); });
  }
  var api = { getTopicState: getTopicState, recordObservation: recordObservation, getMemoryMap: getMemoryMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.SutraMastery = api;
}(typeof window !== 'undefined' ? window : globalThis));

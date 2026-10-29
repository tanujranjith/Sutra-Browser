import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const D = require('../../src/features/assistant/intelligence-diagnostics.js');

test('context-limit 4xx bodies classify as context-length, unrelated 4xx do not', () => {
  assert.equal(D.classifyHttpError(400, 'maximum context length is 8192 tokens'), 'context-length');
  assert.equal(D.classifyHttpError(400, 'reduce the length of the messages'), 'context-length');
  assert.equal(D.classifyHttpError(400, 'too many tokens'), 'context-length');
  assert.equal(D.classifyHttpError(422, 'input is too long for the model'), 'context-length');
  // Not too broad: an unrelated 400 stays unsupported-endpoint.
  assert.equal(D.classifyHttpError(400, 'invalid temperature parameter'), 'unsupported-endpoint');
  assert.equal(D.classifyHttpError(400, ''), 'unsupported-endpoint');
  // context-length is a known category, never `unknown`.
  assert.ok(D.isKnownErrorCategory('context-length'));
  assert.ok(D.ERROR_CATEGORIES.includes('context-length'));
});

test('the rest of the HTTP classification switch is preserved exactly', () => {
  assert.equal(D.classifyHttpError(401, ''), 'invalid-key');
  assert.equal(D.classifyHttpError(403, ''), 'expired-authentication');
  assert.equal(D.classifyHttpError(404, ''), 'unavailable-model');
  assert.equal(D.classifyHttpError(429, ''), 'rate-limit');
  assert.equal(D.classifyHttpError(413, ''), 'oversized-attachment');
  assert.equal(D.classifyHttpError(503, 'overloaded'), 'provider-overload');
  assert.equal(D.classifyHttpError(500, 'boom'), 'provider-error');
  assert.equal(D.classifyHttpError(0, 'Failed to fetch'), 'network-failure');
  assert.equal(D.classifyHttpError(0, 'aborted'), 'cancelled');
  assert.equal(D.classifyHttpError(0, 'mystery'), 'unknown');
});

test('usage normalization is defensive across providers', () => {
  const oa = D.extractUsage('openai_compatible', { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, prompt_tokens_details: { cached_tokens: 6 } } });
  assert.deepEqual([oa.available, oa.inputTokens, oa.outputTokens, oa.totalTokens, oa.cacheReadTokens], [true, 10, 20, 30, 6]);

  const an = D.extractUsage('anthropic', { usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80, cache_creation_input_tokens: 20 } });
  assert.equal(an.totalTokens, 250);
  assert.equal(an.cacheReadTokens, 80);
  assert.equal(an.cacheWriteTokens, 20);

  const ge = D.extractUsage('gemini', { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12, cachedContentTokenCount: 3 } });
  assert.equal(ge.totalTokens, 12);
  assert.equal(ge.cacheReadTokens, 3);
});

test('missing or malformed usage is unavailable, never a measured zero, never throws', () => {
  assert.equal(D.extractUsage('openai_compatible', {}).available, false);
  assert.equal(D.extractUsage('openai_compatible', {}).inputTokens, null);
  assert.equal(D.extractUsage('anthropic', { usage: 'nope' }).available, false);
  assert.equal(D.extractUsage('gemini', { usageMetadata: 42 }).available, false);
  assert.equal(D.extractUsage('openai_compatible', null).available, false);
});

test('streaming usage merges split Anthropic events and finalizes a correct total', () => {
  let acc = null;
  acc = D.mergeUsage(acc, D.extractStreamEventUsage('anthropic', { type: 'message_start', message: { usage: { input_tokens: 200, cache_read_input_tokens: 40 } } }));
  acc = D.mergeUsage(acc, D.extractStreamEventUsage('anthropic', { type: 'message_delta', usage: { output_tokens: 30 } }));
  const fin = D.finalizeStreamUsage(acc, 'anthropic');
  assert.equal(fin.inputTokens, 200);
  assert.equal(fin.outputTokens, 30);
  assert.equal(fin.cacheReadTokens, 40);
  assert.equal(fin.totalTokens, 270);
  assert.equal(D.extractStreamEventUsage('openai_compatible', { choices: [{ delta: { content: 'x' } }] }), null);
});

test('include_usage is gated to known cloud providers only', () => {
  assert.equal(D.supportsStreamUsageOption('openai', { type: 'openai_compatible' }), true);
  assert.equal(D.supportsStreamUsageOption('groq', { type: 'openai_compatible' }), true);
  assert.equal(D.supportsStreamUsageOption('local', { type: 'openai_compatible', isLocal: true }), false);
  assert.equal(D.supportsStreamUsageOption('anthropic', { type: 'anthropic' }), false);
});

test('retry eligibility keys on status; generic provider-error is not retried', () => {
  assert.equal(D.isRetryable({ status: 500, category: 'provider-error' }), true);
  assert.equal(D.isRetryable({ status: 502, category: 'provider-error' }), true);
  assert.equal(D.isRetryable({ status: 503, category: 'provider-overload' }), true);
  assert.equal(D.isRetryable({ status: 504, category: 'provider-error' }), true);
  assert.equal(D.isRetryable({ status: 429, category: 'rate-limit' }), true);
  assert.equal(D.isRetryable({ status: 0, category: 'provider-error' }), false);
  assert.equal(D.isRetryable({ status: 400, category: 'context-length' }), false);
  assert.equal(D.DEFAULT_MAX_RETRIES, 1);
});

test('Retry-After parses seconds and HTTP-date, capped and clamped', () => {
  assert.equal(D.parseRetryAfter('5'), 5000);
  assert.equal(D.parseRetryAfter('0'), 0);
  assert.equal(D.parseRetryAfter('120'), D.RETRY_AFTER_MAX_MS);
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(D.parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now), 10000);
  assert.equal(D.parseRetryAfter('Wed, 31 Dec 2025 23:59:50 GMT', now), 0);
  assert.equal(D.parseRetryAfter('garbage'), null);
  assert.equal(D.parseRetryAfter(null), null);
  const b = D.computeBackoffMs(null, now, 0.5);
  assert.ok(b >= D.RETRY_JITTER_MIN_MS && b <= D.RETRY_JITTER_MAX_MS);
  assert.equal(D.computeBackoffMs('3', now), 3000);
});

test('reasoning-aware timeout scales only when justified; explicit caller stays authoritative', () => {
  assert.equal(D.computeEffectiveTimeout({}).timeoutMs, D.DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(D.computeEffectiveTimeout({}).scaled, false);
  assert.equal(D.computeEffectiveTimeout({ reasoningPlan: { apply: true, effort: 'high' } }).timeoutMs, D.TIMEOUT_CEILING_MS);
  assert.equal(D.computeEffectiveTimeout({ reasoningPlan: { apply: true, effort: 'medium' } }).timeoutMs, Math.round(D.DEFAULT_REQUEST_TIMEOUT_MS * 1.5));
  assert.equal(D.computeEffectiveTimeout({ reasoningPlan: { apply: true, disabled: true, effort: 'high' } }).scaled, false);
  const explicit = D.computeEffectiveTimeout({ callerTimeoutMs: 5000, reasoningPlan: { apply: true, effort: 'high' } });
  assert.equal(explicit.timeoutMs, 5000);
  assert.equal(explicit.scaled, false);
  assert.equal(D.computeEffectiveTimeout({ callerTimeoutMs: 10000, allowScaling: true, reasoningPlan: { apply: true, effort: 'medium' } }).timeoutMs, 15000);
  assert.ok(D.TIMEOUT_CEILING_MS >= 300000 && D.TIMEOUT_CEILING_MS <= 360000);
});

test('per-response stats hide zero/unavailable usage and only show cache hits with tokens', () => {
  const withCache = D.describeResponseStats({ latencyMs: 1200, usage: { available: true, inputTokens: 10, outputTokens: 20, totalTokens: 30, cacheReadTokens: 8 } });
  assert.ok(withCache.some(r => r.key === 'cache'));
  const noCache = D.describeResponseStats({ latencyMs: 1200, usage: { available: true, inputTokens: 10, outputTokens: 20, totalTokens: 30, cacheReadTokens: 0 } });
  assert.ok(!noCache.some(r => r.key === 'cache'));
  const noUsage = D.describeResponseStats({ latencyMs: 900, usage: { available: false } });
  assert.equal(noUsage.length, 1);
  assert.equal(noUsage[0].key, 'latency');
  assert.equal(D.humanizeLatency(0), null);
  assert.equal(D.humanizeLatency(1200), '1.2 s');
  assert.equal(D.humanizeLatency(500), '500 ms');
});

test('aggregate diagnostics exclude unavailable usage and average measured latency', () => {
  const agg = D.summarizeDiagnostics([
    { ok: true, durationMs: 1000, usage: { available: true, inputTokens: 10, outputTokens: 20, totalTokens: 30 } },
    { ok: true, durationMs: 3000, usage: { available: false } },
    { ok: false, durationMs: 0, retryCount: 1, streamStalled: true, partial: true, usage: { available: true, inputTokens: 5, outputTokens: 5, totalTokens: 10, cacheReadTokens: 4 } }
  ]);
  assert.equal(agg.avgLatencyMs, 2000);
  assert.equal(agg.tokens.total, 40);
  assert.equal(agg.retries, 1);
  assert.equal(agg.stalledStreams, 1);
  assert.equal(agg.partialStreams, 1);
  assert.equal(agg.cacheHits, 1);
  assert.equal(agg.requests, 3);
  const empty = D.summarizeDiagnostics([]);
  assert.equal(empty.avgLatencyMs, null);
  assert.equal(empty.tokens.available, false);
});

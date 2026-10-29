/* =============================================================================
   Sutra Intelligence — Diagnostics & Reliability Core
   =============================================================================
   Pure, dual-mode (browser + CommonJS). NO DOM access, NO network access.

   Single source of truth for the deterministic reliability + observability
   logic that hardens src/core/app.js's Intelligence request core:

     - HTTP error classification (adds a distinct `context-length` category)
     - Provider usage normalization (OpenAI-compatible / Anthropic / Gemini)
     - Streaming usage accumulation (defensive, event-by-event)
     - Retry eligibility + Retry-After parsing (seconds AND HTTP-date)
     - Reasoning-aware timeout scaling under one authoritative deadline
     - Aggregate + per-response diagnostics summaries (in-memory only)

   Honesty rules (enforced here, relied on everywhere):
   - Missing usage metadata is UNAVAILABLE, never a measured zero.
   - Cache hits are reported ONLY when the provider actually returned
     cache-read tokens (> 0). We never infer caching.
   - A generic `provider-error` is retried ONLY when the real HTTP status is
     a transient 5xx (500/502/503/504) — never on category alone.
   - Nothing here is persisted or transmitted; app.js keeps these results in
     the ephemeral in-memory diagnostics buffer only.

   Exposed as window.SutraIntelligenceDiagnostics + module.exports. Loaded
   before flow-assistant.js and app.js (see src/config/feature-manifest.js).
   ============================================================================= */
(function () {
    'use strict';

    /* -----------------------------------------------------------------------
       Centralized, documented constants
       -----------------------------------------------------------------------
       These are the tuned reliability knobs. They are intentionally in ONE
       place so the docs, the tests, and the runtime never drift. */

    // Baseline single-shot request timeout for a normal chat turn.
    var DEFAULT_REQUEST_TIMEOUT_MS = 180000;        // 3 min
    // At most one automatic retry by default (bounded; opts.maxRetries overrides).
    var DEFAULT_MAX_RETRIES = 1;
    // Jittered fallback backoff window when the provider gives no Retry-After.
    var RETRY_JITTER_MIN_MS = 800;
    var RETRY_JITTER_MAX_MS = 1500;
    // A stream that emits nothing for this long is treated as stalled.
    var STREAM_IDLE_TIMEOUT_MS = 45000;             // 45 s of silence
    // Hard ceiling for any single request, even with reasoning scaling.
    var TIMEOUT_CEILING_MS = 330000;                // 5.5 min
    // A provider-declared Retry-After is honored but capped so a hostile or
    // buggy header cannot pin the request open indefinitely.
    var RETRY_AFTER_MAX_MS = 60000;                 // 1 min
    // Don't start a retry unless at least this much of the deadline remains
    // (a fetch + parse needs headroom to be worth attempting).
    var MIN_RETRY_BUDGET_MS = 4000;

    // Reasoning-aware timeout scaling. Applied ONLY when the request is not
    // pinned to an explicit caller timeout (or the caller opts in). A normal
    // 'auto' chat has no active reasoning plan, so it stays on the baseline.
    var REASONING_EFFORT_MULTIPLIERS = {
        minimal: 1, low: 1, medium: 1.5, high: 2, xhigh: 2.5, max: 3
    };
    // Extra wall-clock granted per reasoning budget token, capped. A large
    // 30k-token thinking budget adds up to +90 s before the ceiling clamps.
    var REASONING_BUDGET_MS_PER_TOKEN = 3;
    var REASONING_BUDGET_ADD_CAP_MS = 90000;
    // A caller-flagged long-running operation (e.g. study-material generation)
    // gets at least this multiplier.
    var LONG_RUNNING_MULTIPLIER = 1.5;

    /* -----------------------------------------------------------------------
       Error category catalog
       ----------------------------------------------------------------------- */

    // The fixed, known set of Intelligence error categories. `context-length`
    // is a first-class member so it never falls through to `unknown`.
    var ERROR_CATEGORIES = [
        'invalid-key', 'expired-authentication', 'unavailable-model', 'rate-limit',
        'oversized-attachment', 'provider-overload', 'provider-error', 'context-length',
        'unsupported-endpoint', 'cancelled', 'timeout', 'stream-stalled', 'csp-block',
        'network-failure', 'empty-response', 'privacy-audit', 'unsafe-endpoint',
        'partial-response', 'unknown'
    ];

    function isKnownErrorCategory(category) {
        for (var i = 0; i < ERROR_CATEGORIES.length; i += 1) {
            if (ERROR_CATEGORIES[i] === category) return true;
        }
        return false;
    }

    // Case-insensitive substrings that mark a context / token-limit failure.
    // Kept specific enough that an unrelated 400 (bad request, invalid param)
    // does NOT get misclassified as a context failure.
    var CONTEXT_LENGTH_PATTERNS = [
        'context length', 'context_length', 'context window',
        'maximum context', 'max context', 'maximum context length',
        'too many tokens', 'reduce the length', 'reduce the input',
        'maximum number of tokens', 'exceeds the maximum', 'exceed the context',
        'input is too long', 'prompt is too long', 'string too long',
        'is too long for', 'requested tokens', 'token limit', 'tokens exceeds',
        'context_length_exceeded'
    ];

    function isContextLengthMessage(message) {
        var text = String(message == null ? '' : message).toLowerCase();
        if (!text) return false;
        for (var i = 0; i < CONTEXT_LENGTH_PATTERNS.length; i += 1) {
            if (text.indexOf(CONTEXT_LENGTH_PATTERNS[i]) >= 0) return true;
        }
        return false;
    }

    // Classify a provider HTTP status (+ optional message) into a fixed
    // category. status === 0 means "no HTTP response" (network/exception).
    // Mirrors the historical app.js switch exactly, with the single addition
    // of `context-length` for token/context-limit 4xx bodies.
    function classifyHttpError(status, message) {
        status = Number(status) || 0;
        var text = String(message == null ? '' : message);
        if (status === 401) return 'invalid-key';
        if (status === 403) return 'expired-authentication';
        if (status === 404) return 'unavailable-model';
        if (status === 429) return 'rate-limit';
        if (status === 413) return 'oversized-attachment';
        if (status >= 500 && /overload|capacity/i.test(text)) return 'provider-overload';
        if (status >= 500) return 'provider-error';
        if (status >= 400) {
            // A 4xx whose body names a context/token limit is a context failure,
            // NOT an unsupported endpoint. Everything else stays as before.
            if (isContextLengthMessage(text)) return 'context-length';
            return 'unsupported-endpoint';
        }
        // No HTTP response — infer from the thrown error text.
        var lower = text.toLowerCase();
        if (lower.indexOf('abort') >= 0) return 'cancelled';
        if (lower.indexOf('timeout') >= 0 || lower.indexOf('timed out') >= 0) return 'timeout';
        if (lower.indexOf('content security policy') >= 0 || lower.indexOf('csp') >= 0) return 'csp-block';
        if (lower.indexOf('failed to fetch') >= 0 || lower.indexOf('network') >= 0) return 'network-failure';
        return 'unknown';
    }

    // Human-facing guidance for a category. Only the categories that benefit
    // from an actionable hint are listed; callers keep their own fallbacks.
    function guidanceForCategory(category) {
        switch (category) {
            case 'context-length':
                return 'The request is too large. Lower Workspace Access or remove an attachment.';
            case 'rate-limit':
                return 'The provider is rate-limiting. Wait a moment and try again.';
            case 'provider-overload':
                return 'The provider is temporarily overloaded. Retrying shortly may help.';
            case 'stream-stalled':
                return 'The response stream went idle and was stopped. Any partial answer was kept.';
            default:
                return '';
        }
    }

    /* -----------------------------------------------------------------------
       Usage normalization
       ----------------------------------------------------------------------- */

    function num(value) {
        return (typeof value === 'number' && isFinite(value)) ? value : null;
    }

    function unavailableUsage(raw) {
        return {
            available: false,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            rawProviderUsage: (raw && typeof raw === 'object') ? raw : null
        };
    }

    // Normalize one provider response's usage block into the canonical shape.
    // Never throws. Absent usage → { available: false, ...nulls }.
    function extractUsage(providerType, data) {
        try {
            if (!data || typeof data !== 'object') return unavailableUsage(null);

            if (providerType === 'anthropic') {
                var au = data.usage;
                if (!au || typeof au !== 'object') return unavailableUsage(null);
                var aIn = num(au.input_tokens);
                var aOut = num(au.output_tokens);
                var aCacheRead = num(au.cache_read_input_tokens);
                var aCacheWrite = num(au.cache_creation_input_tokens);
                if (aIn == null && aOut == null && aCacheRead == null && aCacheWrite == null) {
                    return unavailableUsage(au);
                }
                // Anthropic's input_tokens excludes cached/created cache tokens;
                // the true total is input + output + cache read + cache created.
                var aTotal = null;
                if (aIn != null || aOut != null || aCacheRead != null || aCacheWrite != null) {
                    aTotal = (aIn || 0) + (aOut || 0) + (aCacheRead || 0) + (aCacheWrite || 0);
                }
                return {
                    available: true,
                    inputTokens: aIn,
                    outputTokens: aOut,
                    totalTokens: aTotal,
                    cacheReadTokens: aCacheRead,
                    cacheWriteTokens: aCacheWrite,
                    rawProviderUsage: au
                };
            }

            if (providerType === 'gemini') {
                var gm = data.usageMetadata;
                if (!gm || typeof gm !== 'object') return unavailableUsage(null);
                var gIn = num(gm.promptTokenCount);
                var gOut = num(gm.candidatesTokenCount);
                var gTotal = num(gm.totalTokenCount);
                var gCache = num(gm.cachedContentTokenCount);
                if (gIn == null && gOut == null && gTotal == null) return unavailableUsage(gm);
                if (gTotal == null && (gIn != null || gOut != null)) gTotal = (gIn || 0) + (gOut || 0);
                return {
                    available: true,
                    inputTokens: gIn,
                    outputTokens: gOut,
                    totalTokens: gTotal,
                    cacheReadTokens: gCache,     // Gemini reports cached prompt tokens here when present.
                    cacheWriteTokens: null,      // No separate cache-creation counter is exposed.
                    rawProviderUsage: gm
                };
            }

            // openai_compatible (default): OpenAI, Groq, OpenRouter, DeepSeek, xAI,
            // Perplexity, and local endpoints all use the { usage: {...} } shape.
            var ou = data.usage;
            if (!ou || typeof ou !== 'object') return unavailableUsage(null);
            var oIn = num(ou.prompt_tokens);
            var oOut = num(ou.completion_tokens);
            var oTotal = num(ou.total_tokens);
            var oCache = null;
            // Cached prompt tokens, where the provider exposes them.
            if (ou.prompt_tokens_details && typeof ou.prompt_tokens_details === 'object') {
                oCache = num(ou.prompt_tokens_details.cached_tokens);
            }
            if (oCache == null && num(ou.cached_tokens) != null) oCache = num(ou.cached_tokens);
            if (oIn == null && oOut == null && oTotal == null) return unavailableUsage(ou);
            if (oTotal == null && (oIn != null || oOut != null)) oTotal = (oIn || 0) + (oOut || 0);
            return {
                available: true,
                inputTokens: oIn,
                outputTokens: oOut,
                totalTokens: oTotal,
                cacheReadTokens: oCache,
                cacheWriteTokens: null,
                rawProviderUsage: ou
            };
        } catch (err) {
            // Usage parsing must never break response delivery.
            return unavailableUsage(null);
        }
    }

    // Pull normalized usage from ONE streaming SSE event, or null if this
    // event carries no usage. Providers deliver usage on different events:
    //   - openai-compatible: a final chunk with `usage` (needs include_usage)
    //   - anthropic: `message_start` (input/cache) then `message_delta` (output)
    //   - gemini: `usageMetadata` on the last (and sometimes every) chunk
    function extractStreamEventUsage(providerType, evt) {
        try {
            if (!evt || typeof evt !== 'object') return null;
            if (providerType === 'anthropic') {
                if (evt.type === 'message_start' && evt.message && evt.message.usage) {
                    return extractUsage('anthropic', evt.message);
                }
                if (evt.type === 'message_delta' && evt.usage) {
                    return extractUsage('anthropic', evt);
                }
                return null;
            }
            if (providerType === 'gemini') {
                return evt.usageMetadata ? extractUsage('gemini', evt) : null;
            }
            // openai_compatible
            return evt.usage ? extractUsage('openai_compatible', evt) : null;
        } catch (err) {
            return null;
        }
    }

    function maxNullable(a, b) {
        if (a == null) return (b == null ? null : b);
        if (b == null) return a;
        return Math.max(a, b);
    }

    // Merge a newly-seen usage snapshot into the running stream accumulator.
    // Token counts are monotonic across a stream (output grows, input is
    // fixed), so per-field max is safe and order-independent.
    function mergeUsage(accumulator, next) {
        if (!next || !next.available) return accumulator || null;
        if (!accumulator || !accumulator.available) {
            return {
                available: true,
                inputTokens: next.inputTokens,
                outputTokens: next.outputTokens,
                totalTokens: next.totalTokens,
                cacheReadTokens: next.cacheReadTokens,
                cacheWriteTokens: next.cacheWriteTokens,
                rawProviderUsage: next.rawProviderUsage
            };
        }
        return {
            available: true,
            inputTokens: maxNullable(accumulator.inputTokens, next.inputTokens),
            outputTokens: maxNullable(accumulator.outputTokens, next.outputTokens),
            totalTokens: maxNullable(accumulator.totalTokens, next.totalTokens),
            cacheReadTokens: maxNullable(accumulator.cacheReadTokens, next.cacheReadTokens),
            cacheWriteTokens: maxNullable(accumulator.cacheWriteTokens, next.cacheWriteTokens),
            rawProviderUsage: next.rawProviderUsage || accumulator.rawProviderUsage
        };
    }

    // Finalize a streamed accumulator: recompute the total from components so
    // a per-event partial total (e.g. Anthropic's message_delta reporting only
    // output tokens) never becomes the reported total.
    function finalizeStreamUsage(accumulator, providerType) {
        if (!accumulator || !accumulator.available) return unavailableUsage(null);
        var input = accumulator.inputTokens;
        var output = accumulator.outputTokens;
        var cacheR = accumulator.cacheReadTokens;
        var cacheW = accumulator.cacheWriteTokens;
        var total = accumulator.totalTokens;
        if (providerType === 'gemini') {
            // Gemini streams an authoritative totalTokenCount; keep it, but
            // synthesize one if it was somehow absent.
            if (total == null && (input != null || output != null)) total = (input || 0) + (output || 0);
        } else if (input != null || output != null) {
            total = (input || 0) + (output || 0);
            if (providerType === 'anthropic') total += (cacheR || 0) + (cacheW || 0);
        }
        return {
            available: true,
            inputTokens: input,
            outputTokens: output,
            totalTokens: total,
            cacheReadTokens: cacheR,
            cacheWriteTokens: cacheW,
            rawProviderUsage: accumulator.rawProviderUsage
        };
    }

    // Only apply OpenAI-style `stream_options: { include_usage: true }` where
    // it is actually supported. Arbitrary local endpoints may reject unknown
    // params, so they are excluded by default.
    var STREAM_USAGE_OPT_PROVIDERS = ['openai', 'openrouter', 'groq', 'deepseek', 'xai', 'perplexity'];
    function supportsStreamUsageOption(provider, providerConfig) {
        if (providerConfig && providerConfig.isLocal) return false;
        if (providerConfig && providerConfig.type && providerConfig.type !== 'openai_compatible') return false;
        return STREAM_USAGE_OPT_PROVIDERS.indexOf(String(provider)) >= 0;
    }

    /* -----------------------------------------------------------------------
       Retry + deadline policy
       ----------------------------------------------------------------------- */

    var RETRYABLE_CATEGORIES = ['rate-limit', 'provider-overload'];
    var RETRYABLE_STATUSES = [500, 502, 503, 504];

    // Is this failure worth an automatic retry? A transient 5xx OR an explicit
    // rate-limit / overload. A generic `provider-error` alone is NOT retryable
    // unless its real status is one of the transient 5xx codes.
    function isRetryable(info) {
        info = info || {};
        var status = Number(info.status) || 0;
        var category = String(info.category || '');
        if (RETRYABLE_STATUSES.indexOf(status) >= 0) return true;
        if (RETRYABLE_CATEGORIES.indexOf(category) >= 0) return true;
        return false;
    }

    // Parse a Retry-After header value into a delay in ms, or null if absent /
    // unparseable. Supports both delta-seconds and an HTTP-date. `nowMs` lets
    // callers (and tests) supply the reference time for the HTTP-date form.
    function parseRetryAfter(value, nowMs) {
        if (value == null) return null;
        var raw = String(value).trim();
        if (!raw) return null;
        if (/^\d+$/.test(raw)) {
            var secs = parseInt(raw, 10);
            if (!isFinite(secs) || secs < 0) return null;
            return Math.min(secs * 1000, RETRY_AFTER_MAX_MS);
        }
        var whenMs = Date.parse(raw);
        if (!isFinite(whenMs)) return null;
        var reference = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
        var delta = whenMs - reference;
        if (delta <= 0) return 0;
        return Math.min(delta, RETRY_AFTER_MAX_MS);
    }

    // Backoff for the next retry: honor Retry-After when present and sane,
    // otherwise a jittered short delay. `random01` is injectable for tests.
    function computeBackoffMs(retryAfterHeader, nowMs, random01) {
        var declared = parseRetryAfter(retryAfterHeader, nowMs);
        if (declared != null) return declared;
        var r = (typeof random01 === 'number' && random01 >= 0 && random01 <= 1)
            ? random01
            : (typeof Math !== 'undefined' && Math.random ? Math.random() : 0.5);
        return Math.round(RETRY_JITTER_MIN_MS + r * (RETRY_JITTER_MAX_MS - RETRY_JITTER_MIN_MS));
    }

    /* -----------------------------------------------------------------------
       Reasoning-aware timeout scaling
       -----------------------------------------------------------------------
       Returns { timeoutMs, scaled, multiplier, budgetAddMs, reason }.

       Rules:
       - An explicit caller timeout is authoritative and is NOT scaled unless
         the caller passes allowScaling: true.
       - Otherwise the baseline is scaled up by reasoning effort + budget +
         a long-running-operation bump, clamped to the hard ceiling.
       - A normal 'auto' chat (no active reasoning plan) stays on the baseline. */
    function computeEffectiveTimeout(opts) {
        opts = opts || {};
        var base = num(opts.baseTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
        var ceiling = num(opts.ceilingMs) || TIMEOUT_CEILING_MS;
        var callerExplicit = (typeof opts.callerTimeoutMs === 'number' && isFinite(opts.callerTimeoutMs) && opts.callerTimeoutMs > 0);

        if (callerExplicit && !opts.allowScaling) {
            return {
                timeoutMs: Math.min(opts.callerTimeoutMs, ceiling),
                scaled: false,
                multiplier: 1,
                budgetAddMs: 0,
                reason: 'explicit-caller'
            };
        }

        var start = callerExplicit ? opts.callerTimeoutMs : base;
        var plan = opts.reasoningPlan || null;
        var multiplier = 1;
        var budgetAddMs = 0;
        var reasons = [];

        if (plan && plan.apply && !plan.disabled) {
            var effort = String(plan.effort || '');
            var effMult = REASONING_EFFORT_MULTIPLIERS[effort];
            if (typeof effMult === 'number' && effMult > multiplier) {
                multiplier = effMult;
                reasons.push('effort:' + effort);
            }
            var budget = num(plan.budgetTokens) || 0;
            if (budget > 0) {
                budgetAddMs = Math.min(budget * REASONING_BUDGET_MS_PER_TOKEN, REASONING_BUDGET_ADD_CAP_MS);
                reasons.push('budget:' + budget);
            }
        }

        if (opts.longRunningOperation) {
            if (LONG_RUNNING_MULTIPLIER > multiplier) multiplier = LONG_RUNNING_MULTIPLIER;
            reasons.push('long-running');
        }

        var scaledMs = Math.round(start * multiplier + budgetAddMs);
        var timeoutMs = Math.min(Math.max(scaledMs, start), ceiling);
        return {
            timeoutMs: timeoutMs,
            scaled: timeoutMs !== start,
            multiplier: multiplier,
            budgetAddMs: budgetAddMs,
            reason: reasons.join(',') || 'baseline'
        };
    }

    /* -----------------------------------------------------------------------
       Presentation helpers (return plain data; callers own DOM rendering)
       ----------------------------------------------------------------------- */

    function humanizeLatency(ms) {
        var v = Number(ms);
        if (!isFinite(v) || v <= 0) return null;
        if (v < 1000) return Math.round(v) + ' ms';
        var s = v / 1000;
        if (s < 10) return s.toFixed(1) + ' s';
        if (s < 60) return Math.round(s) + ' s';
        var m = Math.floor(s / 60);
        var rem = Math.round(s % 60);
        return m + ' min ' + rem + ' s';
    }

    // Build the ordered list of { key, label, value } rows for the per-response
    // details chip. Only includes information that is actually available — a
    // request with no reported usage shows latency alone, never "0 tokens".
    function describeResponseStats(stats) {
        stats = stats || {};
        var rows = [];
        var latency = humanizeLatency(stats.latencyMs);
        if (latency) rows.push({ key: 'latency', label: 'Latency', value: latency });

        var usage = stats.usage;
        if (usage && usage.available) {
            if (typeof usage.inputTokens === 'number') rows.push({ key: 'input', label: 'Input', value: usage.inputTokens.toLocaleString() + ' tok' });
            if (typeof usage.outputTokens === 'number') rows.push({ key: 'output', label: 'Output', value: usage.outputTokens.toLocaleString() + ' tok' });
            if (typeof usage.totalTokens === 'number') rows.push({ key: 'total', label: 'Total', value: usage.totalTokens.toLocaleString() + ' tok' });
            if (typeof usage.cacheReadTokens === 'number' && usage.cacheReadTokens > 0) {
                rows.push({ key: 'cache', label: 'Cache hit', value: usage.cacheReadTokens.toLocaleString() + ' tok' });
            }
        }
        if (stats.reasoningEffort && stats.reasoningEffort !== 'auto') {
            rows.push({ key: 'reasoning', label: 'Reasoning', value: String(stats.reasoningEffort) });
        }
        if (stats.retryCount) rows.push({ key: 'retries', label: 'Retries', value: String(stats.retryCount) });
        if (stats.streamStalled) rows.push({ key: 'stalled', label: 'Stream', value: 'stalled' });
        if (stats.partial) rows.push({ key: 'partial', label: 'Response', value: 'partial' });
        return rows;
    }

    // Does a per-response stat set carry anything worth disclosing?
    function hasReportableStats(stats) {
        return describeResponseStats(stats).length > 0;
    }

    /* -----------------------------------------------------------------------
       Aggregate diagnostics (over the in-memory buffer only)
       ----------------------------------------------------------------------- */

    // Summarize a slice of the in-memory diagnostics buffer. Unavailable usage
    // is EXCLUDED from token totals rather than counted as zero. Latency is
    // averaged only over requests that actually measured a positive duration.
    function summarizeDiagnostics(entries) {
        var list = Array.isArray(entries) ? entries : [];
        var latencies = [];
        var totalInput = 0, totalOutput = 0, totalTokens = 0, anyTokens = false;
        var retries = 0, stalled = 0, partial = 0, cacheHits = 0;
        var requests = 0, okCount = 0, errorCount = 0, cancelledCount = 0;

        for (var i = 0; i < list.length; i += 1) {
            var e = list[i];
            if (!e || typeof e !== 'object') continue;
            requests += 1;
            if (e.ok) okCount += 1;
            else if (e.cancelled) cancelledCount += 1;
            else errorCount += 1;

            if (typeof e.durationMs === 'number' && e.durationMs > 0) latencies.push(e.durationMs);
            if (e.retryCount) retries += Number(e.retryCount) || 0;
            if (e.streamStalled) stalled += 1;
            if (e.partial) partial += 1;

            var u = e.usage;
            if (u && u.available) {
                if (typeof u.inputTokens === 'number') { totalInput += u.inputTokens; anyTokens = true; }
                if (typeof u.outputTokens === 'number') { totalOutput += u.outputTokens; anyTokens = true; }
                if (typeof u.totalTokens === 'number') { totalTokens += u.totalTokens; anyTokens = true; }
                if (typeof u.cacheReadTokens === 'number' && u.cacheReadTokens > 0) cacheHits += 1;
            }
        }

        var avgLatencyMs = latencies.length
            ? Math.round(latencies.reduce(function (a, b) { return a + b; }, 0) / latencies.length)
            : null;

        return {
            requests: requests,
            ok: okCount,
            errors: errorCount,
            cancelled: cancelledCount,
            avgLatencyMs: avgLatencyMs,
            latencySamples: latencies.length,
            tokens: anyTokens
                ? { available: true, input: totalInput, output: totalOutput, total: totalTokens || (totalInput + totalOutput) }
                : { available: false, input: 0, output: 0, total: 0 },
            retries: retries,
            stalledStreams: stalled,
            partialStreams: partial,
            cacheHits: cacheHits
        };
    }

    /* ----------------------------------------------------------------------- */

    var api = {
        VERSION: 1,

        // Constants (documented; consumed by app.js + tests)
        DEFAULT_REQUEST_TIMEOUT_MS: DEFAULT_REQUEST_TIMEOUT_MS,
        DEFAULT_MAX_RETRIES: DEFAULT_MAX_RETRIES,
        RETRY_JITTER_MIN_MS: RETRY_JITTER_MIN_MS,
        RETRY_JITTER_MAX_MS: RETRY_JITTER_MAX_MS,
        STREAM_IDLE_TIMEOUT_MS: STREAM_IDLE_TIMEOUT_MS,
        TIMEOUT_CEILING_MS: TIMEOUT_CEILING_MS,
        RETRY_AFTER_MAX_MS: RETRY_AFTER_MAX_MS,
        MIN_RETRY_BUDGET_MS: MIN_RETRY_BUDGET_MS,
        REASONING_EFFORT_MULTIPLIERS: REASONING_EFFORT_MULTIPLIERS,

        ERROR_CATEGORIES: ERROR_CATEGORIES,
        RETRYABLE_STATUSES: RETRYABLE_STATUSES,
        RETRYABLE_CATEGORIES: RETRYABLE_CATEGORIES,

        // Error classification
        classifyHttpError: classifyHttpError,
        isContextLengthMessage: isContextLengthMessage,
        isKnownErrorCategory: isKnownErrorCategory,
        guidanceForCategory: guidanceForCategory,

        // Usage
        extractUsage: extractUsage,
        extractStreamEventUsage: extractStreamEventUsage,
        mergeUsage: mergeUsage,
        finalizeStreamUsage: finalizeStreamUsage,
        unavailableUsage: unavailableUsage,
        supportsStreamUsageOption: supportsStreamUsageOption,

        // Retry / deadline
        isRetryable: isRetryable,
        parseRetryAfter: parseRetryAfter,
        computeBackoffMs: computeBackoffMs,
        computeEffectiveTimeout: computeEffectiveTimeout,

        // Presentation + aggregation
        humanizeLatency: humanizeLatency,
        describeResponseStats: describeResponseStats,
        hasReportableStats: hasReportableStats,
        summarizeDiagnostics: summarizeDiagnostics
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.SutraIntelligenceDiagnostics = api;
})();

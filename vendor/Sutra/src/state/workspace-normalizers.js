/*
 * workspace-normalizers.js — pure workspace-state normalizers, extracted from
 * src/core/app.js as the first incremental step of decomposing the 64k-line
 * global runtime (see docs/architecture/SUTRA_ARCHITECTURE.md → "Staged app.js
 * extraction plan").
 *
 * Loaded as a classic <script> BEFORE app.js in Sutra.html, so these top-level
 * declarations live in the SAME shared global scope they did inside app.js —
 * every existing call site in app.js (and elsewhere) resolves unchanged. There
 * is no DOM, no storage, and no dependency on app.js internals here, so this is
 * the safe end of the extraction seam and can be unit-tested in isolation.
 *
 * Owns:
 *   - OPTIONAL_FEATURE_VIEWS      the registry of optional, toggleable views
 *   - SUTRA_FEATURE_PACKS         student-facing grouping for advanced surfaces
 *   - STUDENT_DEFAULT_ENABLED_VIEWS  fresh-install, student-first defaults
 *   - getDefaultEnabledViews()    builds the default enabled-views map
 *   - normalizeEnabledViews(raw)  merges stored prefs over the defaults
 */

const OPTIONAL_FEATURE_VIEWS = ['today', 'timeline', 'notes', 'college', 'homework', 'courses', 'alldue', 'apstudy', 'collegeapp', 'life', 'business', 'review', 'cramhub', 'assistantview'];

// Packs are presentation only: turning one off hides entry points but never
// deletes its workspace data. Keep this declarative registry separate from
// app.js so Settings, onboarding, and future pack controls share one vocabulary.
const SUTRA_FEATURE_PACKS = Object.freeze({
    academic: Object.freeze({ label: 'Academic Pack', views: Object.freeze(['courses', 'alldue', 'apstudy', 'review', 'cramhub']) }),
    college: Object.freeze({ label: 'College Pack', views: Object.freeze(['collegeapp', 'college']) }),
    life: Object.freeze({ label: 'Life Pack', views: Object.freeze(['life']) }),
    work: Object.freeze({ label: 'Work Pack', views: Object.freeze(['business']) }),
    assistant: Object.freeze({ label: 'Assistant Pack', views: Object.freeze(['assistantview']) }),
    customization: Object.freeze({ label: 'Customization Pack', views: Object.freeze([]) })
});

// Student-first default navigation: the daily-loop core surfaces are on;
// broader optional modules (AP Study, College planning, Life, Business, Course
// Hub) are off by default and enabled from Settings → Feature packs or through
// onboarding.
// Existing users keep their saved selections — normalizeEnabledViews only
// overrides keys actually present in stored preferences. Review/Cram Hub stay
// "enabled" so their consolidated Testing Hub redirects work even though they
// render no standalone tab.
// Canonical Assistant policy (single source of truth): the LOCAL Assistant
// shell ships enabled in every fresh workspace — its gate is the
// `assistant.enabled` preference (canonical default true, see
// getDefaultWorkspacePreferences), which isViewEnabled() consults directly for
// 'assistantview'. Provider/network access remains a separate opt-in, and this
// set intentionally does NOT list 'assistantview': adding it here would couple
// two different gates (pack visibility vs assistant preference) that must stay
// independent. The manifest's assistant.defaultEnabled mirrors this policy.
// Focus is not a top-level tab — it is accessed from the sidebar, Today view,
// and command palette across every mode.
const STUDENT_DEFAULT_ENABLED_VIEWS = new Set(['today', 'homework', 'notes', 'timeline', 'review', 'cramhub']);

function getDefaultEnabledViews() {
    return OPTIONAL_FEATURE_VIEWS.reduce((acc, view) => {
        acc[view] = STUDENT_DEFAULT_ENABLED_VIEWS.has(view);
        return acc;
    }, {});
}

function normalizeEnabledViews(raw) {
    const normalized = getDefaultEnabledViews();
    if (!raw || typeof raw !== 'object') return normalized;
    OPTIONAL_FEATURE_VIEWS.forEach(view => {
        if (Object.prototype.hasOwnProperty.call(raw, view)) {
            normalized[view] = raw[view] !== false;
        }
    });
    return normalized;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OPTIONAL_FEATURE_VIEWS, SUTRA_FEATURE_PACKS, STUDENT_DEFAULT_ENABLED_VIEWS, getDefaultEnabledViews, normalizeEnabledViews };
}

/* Post-load Help & Docs reconciliation.
 *
 * The generated Help page lives in the classic app runtime. Keep this small
 * compatibility layer separate so documentation can be refreshed without
 * touching the large core-runtime source or changing its load-order contract.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || typeof buildHelpPageContentV2 !== 'function') return;

    var original = buildHelpPageContentV2;
    var CURRENT_CONTRACTS = `
<h2 id="current-workspace-contracts">Current Workspace Contracts</h2>
<p>This section reflects the current August 2026 workspace behavior. Advanced features remain available, but the daily loop stays focused on the next useful action.</p>
<ul>
  <li><strong>Daily loop:</strong> Home is the command center; Capture previews tasks, homework, notes, reminders, study sessions, and Timeline blocks; Homework is the canonical schoolwork list; Create, Timeline, Review, Focus, and Data remain first-class daily surfaces.</li>
  <li><strong>Navigation:</strong> desktop More and phone All sections are derived from canonical tabs. Create owns the contextual page tree; other workspaces use the full canvas by default. Hidden feature packs keep their data.</li>
  <li><strong>Home:</strong> calm, study, everything, and custom presets can reorder, hide, and resize existing cards. The phone Home shell stays compact and touch-friendly.</li>
  <li><strong>Canvas:</strong> pan/zoom, minimap, selection, drawing, shapes, sticky notes, connectors, groups, tables, layout tools, locking, and local export use the owning page save path.</li>
  <li><strong>Slides:</strong> a native Create surface with themes, layouts, text, shapes, charts, local images, speaker notes, presentation/printing, and experimental PPTX packaging. Decks live on <code>page.slides</code> and round-trip through encrypted backups and Sync.</li>
  <li><strong>PDFs:</strong> when the PDF workspace preview is enabled, a PDF opens as a contextual offline reader/editor with search, selectable text, forms, Sutra-owned annotations, page organization, and explicit original/clean/annotated exports. Create attaches the exact original by default; Convert to Note is a separate local text-extraction action.</li>
  <li><strong>Timeline:</strong> Month, Planner, Week, and Day views; keyboard calendar controls; local-preview, source-scoped ICS import; no reminders for imported calendar events; and atomic Push time with preview and undo.</li>
  <li><strong>Assistant:</strong> OpenAI, Anthropic, Gemini, Groq, OpenRouter, NVIDIA NIM, Mistral AI, Together AI, DeepSeek, xAI, Perplexity, and validated OpenAI-compatible local endpoints are available. Keys and local endpoint settings stay device-local. Canvas/Slides edits are bounded, approval-based, and undoable.</li>
  <li><strong>Backup and Sync:</strong> encrypted <code>.sutra</code> remains the recommended backup. Optional unencrypted <code>.sutra</code> export is explicit and excludes Assistant chats unless opted in. Sutra Sync Beta is off by default, separate from backups, and requires explicit setup plus a passphrase.</li>
  <li><strong>Safety:</strong> duress deletion is an optional irreversible locked-note action with honest offline-device and downloaded-backup limits. Generic network failures never authorize Sync wipe.</li>
  <li><strong>Mobile:</strong> the unified bottom bar, accessible sheets, safe-area spacing, responsive Timeline, stable Create editor, usable Assistant composer, and shared Focus duration are the supported phone workflow.</li>
</ul>
<p>For implementation and privacy contracts, use the repository guides under <code>docs/features/</code>, <code>docs/privacy-security/</code>, and <code>docs/architecture/</code>.</p>
<p><button type="button" class="help-anchor-btn help-anchor-top-btn" data-editor-anchor="top">Back to top</button></p>
`;

    buildHelpPageContentV2 = function () {
        var html = original();
        var tocMarker = '<h2 id="toc">Table of Contents</h2>\n<ol>';
        html = html.replace(tocMarker, tocMarker + '<li><button type="button" class="help-anchor-btn" data-editor-anchor="current-workspace-contracts">Current workspace contracts</button></li>');
        var footerMarker = '<hr style="border: none; border-top: 2px solid var(--border); margin: 24px 0;">\n<p style="text-align: center;';
        html = html.replace(footerMarker, CURRENT_CONTRACTS + '\n<hr style="border: none; border-top: 2px solid var(--border); margin: 24px 0;">\n<p style="text-align: center;');
        return html;
    };

    try {
        if (typeof window.ensureHelpPagesForAllSpaces === 'function') window.ensureHelpPagesForAllSpaces();
        if (typeof window.persistAppData === 'function') window.persistAppData('help-docs-refresh');
    } catch (error) {
        if (typeof window.reportError === 'function') window.reportError(error, { source: 'help-docs-refresh' });
    }
}());

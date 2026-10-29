(function (global) {
  'use strict';

  // HTML Pages were introduced after the original page model. Some early
  // exports therefore identify the page as `html` while storing the authored
  // document in the ordinary page content field. Normalize that shape before
  // the canonical workspace migration/normalizer runs so the source remains
  // editable as an HTML Page after restore.
  if (!global || !global.SutraMigrations
    || typeof global.SutraMigrations.migrateWorkspace !== 'function') return;

  var migrations = global.SutraMigrations;
  if (migrations.migrateWorkspace.__sutraHtmlPageTransferCompat === true) return;
  var migrateWorkspace = migrations.migrateWorkspace;
  var LEGACY_HTML_TYPES = Object.freeze({
    html: true,
    htmlpage: true,
    'html-page': true,
    html_page: true
  });

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function legacyHtmlPage(page) {
    if (!isObject(page)) return page;
    var type = String(page.type || '').trim().toLowerCase();
    if (!LEGACY_HTML_TYPES[type]) return page;

    var documentRecord = isObject(page.htmlDocument) ? page.htmlDocument : {};
    var source;
    if (typeof documentRecord.source === 'string') source = documentRecord.source;
    else if (typeof page.html === 'string') source = page.html;
    else if (typeof page.source === 'string') source = page.source;
    else source = typeof page.content === 'string' ? page.content : '';

    return Object.assign({}, page, {
      // The current runtime intentionally uses the normal page type plus the
      // dedicated document discriminator. The canonical page normalizer will
      // retain this document and normalize its timestamps/version.
      content: '',
      htmlDocument: Object.assign({}, documentRecord, { version: 1, source: source })
    });
  }

  function prepareWorkspace(input) {
    if (!isObject(input)) return input;
    if (Array.isArray(input.pages)) {
      return Object.assign({}, input, {
        pages: input.pages.map(legacyHtmlPage)
      });
    }
    return input;
  }

  function compatibleMigrateWorkspace(input, options) {
    return migrateWorkspace.call(this, prepareWorkspace(input), options);
  }

  compatibleMigrateWorkspace.__sutraHtmlPageTransferCompat = true;
  migrations.migrateWorkspace = compatibleMigrateWorkspace;
}(window));

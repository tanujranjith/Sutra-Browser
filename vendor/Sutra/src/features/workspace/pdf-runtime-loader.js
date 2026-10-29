/* Parser-synchronous local PDF.js fallback for direct file mode and Firefox. */
(function () {
  'use strict';
  if (location.protocol !== 'file:' && !/Firefox\//.test(navigator.userAgent)) return;
  document.write('<script src="assets/vendor/pdfjs/build/pdf.worker.sutra.min.js?v=6.1.200"><\/script>'); // sutra-allow-html: literal local-only PDF.js fallback, no user-controlled input
  document.write('<script src="assets/vendor/pdfjs/build/pdf.sutra.min.js?v=6.1.200"><\/script>'); // sutra-allow-html: literal local-only PDF.js fallback, no user-controlled input
}());

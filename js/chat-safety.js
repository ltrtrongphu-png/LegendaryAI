(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LegendaryChatSafety = api;
})(typeof globalThis === 'object' ? globalThis : null, function () {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeImageSource(value) {
    var source = String(value || '').trim();
    if (!source || /[\u0000-\u001f\u007f]/.test(source)) return '';

    // Only raster data URLs are accepted; SVG/data:text payloads are not.
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);base64,[a-z0-9+/=\r\n]+$/i.test(source)) {
      return source;
    }

    // Retain older externally hosted generated-image links only over HTTPS.
    try {
      var parsed = new URL(source);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) {
        return parsed.href;
      }
    } catch (_) {}
    return '';
  }

  return { escapeHtml: escapeHtml, safeImageSource: safeImageSource };
});

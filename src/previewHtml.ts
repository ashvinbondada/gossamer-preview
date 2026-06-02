export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function buildHtml(previewUrl: string, title: string): string {
  const nonce = Math.random().toString(36).slice(2);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #1e1e1e; color: #ccc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  body { display: flex; flex-direction: column; }
  .toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: #252526; border-bottom: 1px solid #333; flex-shrink: 0; }
  .toolbar button { background: #2d2d30; color: #ccc; border: 1px solid #3c3c3c; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
  .toolbar button:hover { background: #37373a; }
  .toolbar button.active { background: #094771; border-color: #007acc; color: #fff; }
  .toolbar .spacer { flex: 1; }
  .toolbar .zoom-label { font-size: 11px; color: #888; min-width: 38px; text-align: center; }
  .toolbar .url { font-size: 11px; color: #888; margin-left: 8px; user-select: text; }
  .find { display: none; align-items: center; gap: 6px; padding: 4px 8px; background: #1e1e1e; border-bottom: 1px solid #333; }
  .find.visible { display: flex; }
  .find input { background: #2d2d30; color: #ccc; border: 1px solid #3c3c3c; border-radius: 3px; padding: 3px 6px; font-size: 12px; width: 200px; }
  .find input:focus { outline: 1px solid #007acc; }
  .find .count { font-size: 11px; color: #888; min-width: 50px; }
  .frame-wrap { flex: 1; overflow: auto; background: white; }
  iframe { width: 100%; height: 100%; border: none; display: block; transform-origin: 0 0; background: white; }
</style>
</head>
<body>
<div class="toolbar">
  <button id="reload" title="Reload">⟳</button>
  <button id="zoomOut" title="Zoom out (Cmd/Ctrl+-)">−</button>
  <span class="zoom-label" id="zoomLabel">100%</span>
  <button id="zoomIn" title="Zoom in (Cmd/Ctrl+=)">+</button>
  <button id="zoomReset" title="Reset zoom (Cmd/Ctrl+0)">⟲</button>
  <button id="findBtn" title="Find (Cmd/Ctrl+F)">⌕ Find</button>
  <button id="editSrc" title="Edit HTML source">✎ Edit Source</button>
  <span class="spacer"></span>
  <span class="url">${escapeHtml(previewUrl)}</span>
</div>
<div class="find" id="findBar">
  <input id="findInput" type="text" placeholder="Find in page" autocomplete="off" />
  <span class="count" id="findCount">0 / 0</span>
  <button id="findPrev" title="Previous (Shift+Enter)">▲</button>
  <button id="findNext" title="Next (Enter)">▼</button>
  <button id="findClose" title="Close (Esc)">✕</button>
</div>
<div class="frame-wrap" id="wrap">
  <iframe id="frame" src="${escapeAttr(previewUrl)}"></iframe>
</div>
<script nonce="${nonce}">
(function() {
  var frame = document.getElementById('frame');
  var wrap = document.getElementById('wrap');
  var zoom = 1;
  var zoomLabel = document.getElementById('zoomLabel');

  function applyZoom() {
    frame.style.transform = 'scale(' + zoom + ')';
    frame.style.width = (100 / zoom) + '%';
    frame.style.height = (100 / zoom) + '%';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
  }
  function setZoom(z) { zoom = Math.max(0.25, Math.min(4, z)); applyZoom(); }

  document.getElementById('zoomIn').onclick = function() { setZoom(zoom + 0.1); };
  document.getElementById('zoomOut').onclick = function() { setZoom(zoom - 0.1); };
  document.getElementById('zoomReset').onclick = function() { setZoom(1); };
  document.getElementById('reload').onclick = function() { frame.contentWindow.location.reload(); };
  var vscodeApi = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;
  var editSrcBtn = document.getElementById('editSrc');
  editSrcBtn.onclick = function() {
    if (vscodeApi) vscodeApi.postMessage({ type: 'editSource' });
  };

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (msg && msg.type === 'editSourceState') {
      editSrcBtn.classList.toggle('active', msg.open);
      editSrcBtn.title = msg.open ? 'Close HTML source' : 'Edit HTML source';
    }
  });

  var findBar = document.getElementById('findBar');
  var findInput = document.getElementById('findInput');
  var findCount = document.getElementById('findCount');
  var matches = [];
  var currentIndex = -1;
  var highlightClass = '__gossamer_hit__';
  var activeClass = '__gossamer_hit_active__';

  function ensureStyle() {
    try {
      var doc = frame.contentDocument;
      if (!doc) return null;
      if (!doc.getElementById('__gossamer_find_style__')) {
        var style = doc.createElement('style');
        style.id = '__gossamer_find_style__';
        style.textContent =
          '.' + highlightClass + ' { background: #ffd54f; color: #000; }' +
          '.' + activeClass + ' { background: #ff9800; color: #000; }';
        doc.head.appendChild(style);
      }
      return doc;
    } catch (e) { return null; }
  }

  function clearMatches() {
    var doc = ensureStyle();
    if (!doc) { matches = []; currentIndex = -1; return; }
    var marks = doc.querySelectorAll('mark.' + highlightClass);
    marks.forEach(function(m) {
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    matches = [];
    currentIndex = -1;
  }

  function search(query) {
    clearMatches();
    if (!query) { updateCount(); return; }
    var doc = ensureStyle();
    if (!doc) { updateCount(); return; }
    var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    var q = query.toLowerCase();
    nodes.forEach(function(node) {
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var idx = lower.indexOf(q);
      if (idx < 0) return;
      var parent = node.parentNode;
      var cursor = 0;
      var frag = doc.createDocumentFragment();
      while (idx >= 0) {
        if (idx > cursor) frag.appendChild(doc.createTextNode(text.slice(cursor, idx)));
        var mark = doc.createElement('mark');
        mark.className = highlightClass;
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        matches.push(mark);
        cursor = idx + q.length;
        idx = lower.indexOf(q, cursor);
      }
      if (cursor < text.length) frag.appendChild(doc.createTextNode(text.slice(cursor)));
      parent.replaceChild(frag, node);
    });
    if (matches.length > 0) focusMatch(0);
    updateCount();
  }

  function focusMatch(i) {
    if (matches.length === 0) return;
    if (currentIndex >= 0 && matches[currentIndex]) matches[currentIndex].classList.remove(activeClass);
    currentIndex = (i + matches.length) % matches.length;
    var m = matches[currentIndex];
    m.classList.add(activeClass);
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    updateCount();
  }

  function updateCount() {
    findCount.textContent = (matches.length === 0 ? 0 : currentIndex + 1) + ' / ' + matches.length;
  }

  function openFind() {
    findBar.classList.add('visible');
    findInput.focus();
    findInput.select();
  }
  function closeFind() {
    findBar.classList.remove('visible');
    clearMatches();
    updateCount();
    findInput.value = '';
  }

  document.getElementById('findBtn').onclick = openFind;
  document.getElementById('findClose').onclick = closeFind;
  document.getElementById('findNext').onclick = function() { focusMatch(currentIndex + 1); };
  document.getElementById('findPrev').onclick = function() { focusMatch(currentIndex - 1); };

  findInput.addEventListener('input', function() { search(findInput.value); });
  findInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); focusMatch(currentIndex + (e.shiftKey ? -1 : 1)); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });

  function handleKey(e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'f') { e.preventDefault(); openFind(); }
    else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(zoom + 0.1); }
    else if (mod && e.key === '-') { e.preventDefault(); setZoom(zoom - 0.1); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom(1); }
    else if (e.key === 'Escape' && findBar.classList.contains('visible')) { e.preventDefault(); closeFind(); }
  }
  document.addEventListener('keydown', handleKey, true);
  frame.addEventListener('load', function() {
    try {
      frame.contentDocument.addEventListener('keydown', function(e) {
        var mod = e.metaKey || e.ctrlKey;
        if (mod && (e.key === 'f' || e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
          handleKey(e);
        }
      }, true);
    } catch (err) {}
  });
})();
</script>
</body>
</html>`;
}

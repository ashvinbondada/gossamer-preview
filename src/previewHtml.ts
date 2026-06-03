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
  var lastTotal = 0;
  var lastCurrent = 0;
  var findSeq = 0;

  function sendFind(query) {
    findSeq++;
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'gossamer-find', query: query, seq: findSeq }, '*');
    }
  }
  function sendNav(direction) {
    findSeq++;
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'gossamer-find-nav', direction: direction, seq: findSeq }, '*');
    }
  }
  function sendClear() {
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'gossamer-find-clear' }, '*');
    }
  }

  function updateCount() {
    findCount.textContent = lastCurrent + ' / ' + lastTotal;
  }

  function openFind() {
    findBar.classList.add('visible');
    findInput.focus();
    findInput.select();
  }
  function closeFind() {
    findBar.classList.remove('visible');
    sendClear();
    lastTotal = 0; lastCurrent = 0;
    updateCount();
    findInput.value = '';
  }

  document.getElementById('findBtn').onclick = openFind;
  document.getElementById('findClose').onclick = closeFind;
  document.getElementById('findNext').onclick = function() { sendNav(1); };
  document.getElementById('findPrev').onclick = function() { sendNav(-1); };

  findInput.addEventListener('input', function() { sendFind(findInput.value); });
  findInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); sendNav(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'gossamer-find-result') {
      if (msg.seq && msg.seq < findSeq) return;
      lastTotal = msg.total || 0;
      lastCurrent = msg.current || 0;
      updateCount();
    } else if (msg.type === 'gossamer-key') {
      handleKey({
        key: msg.key,
        metaKey: !!msg.metaKey,
        ctrlKey: !!msg.ctrlKey,
        shiftKey: !!msg.shiftKey,
        preventDefault: function() {}
      });
    }
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
  // On iframe navigation, re-run the active query so highlights persist across reloads.
  frame.addEventListener('load', function() {
    if (findBar.classList.contains('visible') && findInput.value) {
      sendFind(findInput.value);
    }
  });
})();
</script>
</body>
</html>`;
}

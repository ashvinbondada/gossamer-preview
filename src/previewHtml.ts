export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Wrap raw HTML with a <base href> tag so relative URLs (<img src="x.png">,
// <link href="style.css">) resolve against the live-reload HTTP server. The
// previewUrl is the server URL — we extract its directory and inject as base.
// This makes srcdoc-loaded HTML behave like server-loaded HTML for assets.
export function wrapWithBase(rawHtml: string, previewUrl: string): string {
  // Lazy-require to avoid circular import at module load time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { injectReloadScript } = require('./liveReload');

  // Compute the base directory of the URL (strip the filename).
  const baseUrl = previewUrl.replace(/\/[^/]*$/, '/');
  const baseTag = `<base href="${escapeAttr(baseUrl)}">`;
  // Inject the <base href> after <head> if present, else before first content.
  let withBase: string;
  if (/<head[^>]*>/i.test(rawHtml)) {
    withBase = rawHtml.replace(/<head[^>]*>/i, (m) => m + baseTag);
  } else if (/<html[^>]*>/i.test(rawHtml)) {
    withBase = rawHtml.replace(/<html[^>]*>/i, (m) => m + '<head>' + baseTag + '</head>');
  } else {
    withBase = baseTag + rawHtml;
  }

  // ALSO inject the keydown forwarder + find helper. Without this, host
  // shortcuts (Cmd+P, Cmd+Shift+P) and our toolbar Find don't work when
  // focus is inside the previewed page. injectReloadScript adds the same
  // script the HTTP server adds for external browsers.
  return injectReloadScript(withBase);
}

export function buildToolbarMarkup(previewUrl: string, title: string): string {
  return `<div class="frame-wrap" id="wrap">
  <div class="skeleton" id="skeleton" aria-hidden="true">
    <div class="skel-line skel-line-1"></div>
    <div class="skel-line skel-line-2"></div>
    <div class="skel-line skel-line-3"></div>
    <div class="skel-line skel-line-4"></div>
  </div>
  <iframe id="frame" src="about:blank" data-base-href="${escapeAttr(previewUrl)}"></iframe>

  <div class="toolbar" id="toolbar">
    <div class="controls-left">
      <button id="reload" title="Reload">⟳</button>
      <button id="zoomOut" title="Zoom out (Cmd/Ctrl+-)">−</button>
      <span class="zoom-label" id="zoomLabel">100%</span>
      <button id="zoomIn" title="Zoom in (Cmd/Ctrl+=)">+</button>
      <button id="zoomReset" title="Reset zoom (Cmd/Ctrl+0)">⟲</button>
      <div class="divider"></div>
    </div>

    <button class="find-trigger" id="findBtn" title="Find (Cmd/Ctrl+F)">
      <span>⌕</span>
      <span class="label">Find</span>
    </button>

    <div class="find-area" id="findArea">
      <input id="findInput" type="text" placeholder="Find in page" autocomplete="off" />
      <span class="count" id="findCount">0 / 0</span>
      <div class="nav-group">
        <button class="icon-btn" id="findPrev" title="Previous (Shift+Enter)">▲</button>
        <button class="icon-btn" id="findNext" title="Next (Enter)">▼</button>
      </div>
      <button class="close-btn" id="findClose" title="Close (Esc)">✕</button>

      <div class="history" id="history">
        <div class="history-header">
          <span>Recent searches</span>
          <button class="history-clear" id="historyClear">Clear</button>
        </div>
        <div id="historyList"></div>
      </div>
    </div>

    <div class="controls-right">
      <div class="divider"></div>
      <button id="editSrc" title="Edit HTML source">✎ Edit</button>
      <button id="copyFile" title="Copy relative path">
        <span id="copyIcon">⎘</span>
      </button>
    </div>
  </div>
</div>`;
}

// Internal dev-only flag. Hard-coded false for shipped builds. Flip to true
// locally to reveal a perf-timing overlay in the webview (parent + iframe marks).
// Not exposed as a setting — there's no user-facing toggle and no command for it.
const PERF_OVERLAY_ENABLED = false;

// Flip to true locally for a build with a clipboard-debug overlay. Shows every
// copy/cut event as it flows from the iframe → parent → clipboard. Click the
// overlay to clear. Always false in shipped builds.
const CLIPBOARD_DEBUG_ENABLED = false;

export function buildPreviewScript(title: string, copyPath?: string): string {
  const toCopy = copyPath ?? title;
  const perfHeader = PERF_OVERLAY_ENABLED ? `
  // ===== PERF INSTRUMENTATION (dev-only, gated by PERF_OVERLAY_ENABLED) =====
  var __PERF_T0 = performance.now();
  var __PERF_MARKS = [];
  function __mark(name) {
    var t = performance.now() - __PERF_T0;
    __PERF_MARKS.push({ name: name, t: t });
    try { console.log('[gossamer-perf] ' + t.toFixed(1).padStart(7) + 'ms  ' + name); } catch (e) {}
    __renderPerfOverlay();
  }
  function __renderPerfOverlay() {
    var el = document.getElementById('__gossamer_perf');
    if (!el) {
      el = document.createElement('div');
      el.id = '__gossamer_perf';
      el.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:99999;' +
        'background:rgba(0,0,0,0.82);color:#0f0;font:11px/1.45 SF Mono,monospace;' +
        'padding:8px 10px;border-radius:6px;border:1px solid #333;pointer-events:auto;' +
        'max-width:340px;white-space:pre;cursor:pointer';
      el.title = 'click to copy timings';
      el.addEventListener('click', function() {
        var text = __PERF_MARKS.map(function(m) { return m.t.toFixed(1) + 'ms\\t' + m.name; }).join('\\n');
        try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) {}
        el.style.borderColor = '#0f0';
        setTimeout(function() { el.style.borderColor = '#333'; }, 800);
      });
      document.body.appendChild(el);
    }
    var lines = ['[gossamer perf]'];
    for (var i = 0; i < __PERF_MARKS.length; i++) {
      lines.push(__PERF_MARKS[i].t.toFixed(1).padStart(7) + ' ms  ' + __PERF_MARKS[i].name);
    }
    el.textContent = lines.join('\\n');
  }
  __mark('script start (DOM ready)');
  // ===== END PERF =====
` : `
  // Perf instrumentation disabled. __mark is a no-op so calls compile away cheaply.
  function __mark() {}
`;
  const clipDebug = CLIPBOARD_DEBUG_ENABLED ? `
  // ===== CLIPBOARD DEBUG OVERLAY (dev-only) =====
  function __clip(msg) {
    var el = document.getElementById('__gossamer_clip');
    if (!el) {
      el = document.createElement('div');
      el.id = '__gossamer_clip';
      el.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:99999;' +
        'background:rgba(0,0,0,0.85);color:#ffd54f;font:11px/1.45 SF Mono,monospace;' +
        'padding:8px 10px;border-radius:6px;border:1px solid #444;pointer-events:auto;' +
        'max-width:480px;max-height:280px;overflow:auto;white-space:pre-wrap;cursor:pointer';
      el.title = 'click to clear';
      el.addEventListener('click', function() { el.textContent = '[clip] cleared\\n'; });
      document.body.appendChild(el);
      el.textContent = '[clip] ready\\n';
    }
    var t = new Date().toISOString().substr(11, 12);
    el.textContent += '[' + t + '] ' + msg + '\\n';
    el.scrollTop = el.scrollHeight;
    try { console.log('[gossamer-clip]', msg); } catch (e) {}
  }
  __clip('parent script init');
  ` : `
  function __clip() {}
`;
  return `(function() {
${perfHeader}
${clipDebug}
  var frame = document.getElementById('frame');
  var wrap = document.getElementById('wrap');
  var toolbar = document.getElementById('toolbar');
  var zoom = 1;
  var zoomLabel = document.getElementById('zoomLabel');
  var FILENAME = ${JSON.stringify(title)};
  var COPY_TARGET = ${JSON.stringify(toCopy)};

  __mark('elements queried');

  function applyZoom() {
    // At zoom=1 we leave transform empty so the iframe doesn't get a compositor
    // layer pinned at first paint. Only opt into the scale transform when needed.
    if (zoom === 1) {
      frame.style.transform = '';
      frame.style.width = '100%';
      frame.style.height = '100%';
    } else {
      frame.style.transform = 'scale(' + zoom + ')';
      frame.style.width = (100 / zoom) + '%';
      frame.style.height = (100 / zoom) + '%';
    }
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
  }
  function setZoom(z) { zoom = Math.max(0.25, Math.min(4, z)); applyZoom(); }

  document.getElementById('zoomIn').onclick = function() { setZoom(zoom + 0.1); };
  document.getElementById('zoomOut').onclick = function() { setZoom(zoom - 0.1); };
  document.getElementById('zoomReset').onclick = function() { setZoom(1); };
  document.getElementById('reload').onclick = function() { if (frame.contentWindow) frame.contentWindow.location.reload(); };

  var vscodeApi = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;
  var editSrcBtn = document.getElementById('editSrc');
  editSrcBtn.onclick = function() { if (vscodeApi) vscodeApi.postMessage({ type: 'editSource' }); };

  // copy filename
  var copyBtn = document.getElementById('copyFile');
  var copyIcon = document.getElementById('copyIcon');
  copyBtn.onclick = function() {
    var done = function() {
      copyIcon.textContent = '✓';
      setTimeout(function() { copyIcon.textContent = '⎘'; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(COPY_TARGET).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = COPY_TARGET; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  };

  // Edit source state from extension
  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (msg && msg.type === 'editSourceState') {
      editSrcBtn.classList.toggle('active', msg.open);
      editSrcBtn.title = msg.open ? 'Close HTML source' : 'Edit HTML source';
    }
  });

  // ===== Find =====
  var findInput = document.getElementById('findInput');
  var findCount = document.getElementById('findCount');
  var findBtn = document.getElementById('findBtn');
  var findClose = document.getElementById('findClose');
  var findNext = document.getElementById('findNext');
  var findPrev = document.getElementById('findPrev');
  var lastTotal = 0;
  var lastCurrent = 0;
  var findSeq = 0;
  var lastAcceptedSeq = -1;

  function sendFind(query) {
    findSeq++;
    if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'gossamer-find', query: query, seq: findSeq }, '*');
  }
  function sendNav(direction) {
    findSeq++;
    if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'gossamer-find-nav', direction: direction, seq: findSeq }, '*');
  }
  function sendClear() {
    if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'gossamer-find-clear' }, '*');
  }
  function updateCount() { findCount.textContent = lastCurrent + ' / ' + lastTotal; }

  // ===== history (session-local, in-memory) =====
  var historyEl = document.getElementById('history');
  var historyList = document.getElementById('historyList');
  var historyClear = document.getElementById('historyClear');
  var history = [];
  var historyIndex = -1;

  function renderHistory() {
    historyList.innerHTML = '';
    if (history.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No searches yet';
      historyList.appendChild(empty);
      return;
    }
    history.forEach(function(q, i) {
      var row = document.createElement('div');
      row.className = 'history-item' + (i === historyIndex ? ' active' : '');
      var ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = '⌕';
      var tx = document.createElement('span'); tx.className = 'text'; tx.textContent = q;
      row.appendChild(ic); row.appendChild(tx);
      row.addEventListener('mousedown', function(e) { e.preventDefault(); applyHistory(i); });
      historyList.appendChild(row);
    });
  }
  function showHistory() { renderHistory(); historyEl.classList.add('visible'); }
  function hideHistory() { historyEl.classList.remove('visible'); historyIndex = -1; }
  function applyHistory(i) {
    if (i < 0 || i >= history.length) return;
    historyIndex = i;
    findInput.value = history[i];
    sendFind(findInput.value);
    hideHistory();
  }
  function pushHistory(q) {
    if (!q) return;
    history = history.filter(function(h) { return h !== q; });
    history.unshift(q);
    if (history.length > 20) history.length = 20;
  }
  historyClear.addEventListener('click', function(e) { e.preventDefault(); history = []; renderHistory(); });

  function openFind() {
    toolbar.classList.add('open');
    setTimeout(function() { findInput.focus(); findInput.select(); showHistory(); }, 80);
  }
  function clearInput() {
    findInput.value = '';
    sendClear();
    lastTotal = 0; lastCurrent = 0;
    updateCount();
    showHistory();
    findInput.focus();
  }
  function closeFind() {
    if (findInput.value) pushHistory(findInput.value);
    toolbar.classList.remove('open');
    findInput.value = '';
    sendClear();
    lastTotal = 0; lastCurrent = 0;
    lastAcceptedSeq = -1;
    updateCount();
    hideHistory();
  }

  findBtn.onclick = function() { toolbar.classList.contains('open') ? closeFind() : openFind(); };
  findClose.onclick = closeFind;
  findNext.onclick = function() { sendNav(1); };
  findPrev.onclick = function() { sendNav(-1); };

  findInput.addEventListener('input', function() {
    historyIndex = -1;
    var v = findInput.value;
    if (v) { hideHistory(); sendFind(v); }
    else { sendClear(); lastTotal = 0; lastCurrent = 0; updateCount(); showHistory(); }
  });
  findInput.addEventListener('focus', function() { if (!findInput.value) showHistory(); });
  document.addEventListener('mousedown', function(e) {
    if (!historyEl.contains(e.target) && e.target !== findInput) hideHistory();
  });

  findInput.addEventListener('keydown', function(e) {
    var histVisible = historyEl.classList.contains('visible') && history.length > 0;
    if (e.key === 'ArrowDown' && histVisible) {
      e.preventDefault();
      historyIndex = Math.min(history.length - 1, historyIndex + 1);
      renderHistory();
      return;
    }
    if (e.key === 'ArrowUp' && histVisible) {
      e.preventDefault();
      historyIndex = Math.max(-1, historyIndex - 1);
      renderHistory();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (histVisible && historyIndex >= 0) { applyHistory(historyIndex); return; }
      sendNav(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (findInput.value) clearInput();
      else closeFind();
      return;
    }
  });

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'gossamer-find-result') {
      // Drop strictly-older replies than the last one we accepted.
      if (typeof msg.seq === 'number' && msg.seq < lastAcceptedSeq) return;
      if (typeof msg.seq === 'number') lastAcceptedSeq = msg.seq;
      lastTotal = msg.total || 0;
      lastCurrent = msg.current || 0;
      updateCount();
    } else if (msg.type === 'gossamer-srcdoc') {
      // Extension host sent the iframe's HTML content as a string. Assign as
      // srcdoc. This replaces the old src=http://... approach which caused
      // Cursor's webview disposal to hang for ~10-13s on window reload.
      __clip('PARENT got srcdoc len=' + (msg.html ? msg.html.length : 0));
      if (typeof msg.html === 'string') {
        // Preserve scroll position across reloads by reading the iframe's
        // scrollY before swap and restoring after the new doc loads. Best-effort.
        var savedScroll = 0;
        try {
          if (frame.contentWindow) savedScroll = frame.contentWindow.scrollY || 0;
        } catch (e) {}
        frame.srcdoc = msg.html;
        if (savedScroll > 0) {
          frame.addEventListener('load', function once() {
            frame.removeEventListener('load', once);
            try { frame.contentWindow.scrollTo(0, savedScroll); } catch (e) {}
          });
        }
      }
    } else if (msg.type === 'gossamer-key') {
      handleKey({
        key: msg.key,
        metaKey: !!msg.metaKey,
        ctrlKey: !!msg.ctrlKey,
        shiftKey: !!msg.shiftKey,
        preventDefault: function() {}
      });
    } else if (msg.type === 'gossamer-host-key') {
      // Relay an iframe-side chord up to the extension host. The host has a
      // hardcoded map of chord → VS Code command and will dispatch.
      if (vscodeApi) {
        vscodeApi.postMessage({
          type: 'host-key',
          key: msg.key, code: msg.code,
          metaKey: !!msg.metaKey, ctrlKey: !!msg.ctrlKey,
          shiftKey: !!msg.shiftKey, altKey: !!msg.altKey,
        });
      }
    } else if (msg.type === 'gossamer-clipboard-write') {
      // The iframe forwards selection text up to us because navigator.clipboard
      // fails silently inside cross-origin iframes within vscode-webview://.
      // The parent webview has full clipboard permission — do the write here.
      var text = typeof msg.text === 'string' ? msg.text : '';
      __clip('PARENT got clipboard-write text.len=' + text.length + ' preview=' + JSON.stringify(text.slice(0, 40)));
      if (text) {
        var nav = navigator.clipboard && navigator.clipboard.writeText;
        __clip('  navigator.clipboard.writeText available: ' + !!nav);
        try {
          if (nav) {
            navigator.clipboard.writeText(text).then(
              function() { __clip('  SUCCESS: navigator.clipboard.writeText wrote ' + text.length + ' chars'); },
              function(err) { __clip('  REJECT: navigator.clipboard.writeText: ' + (err && err.message ? err.message : err)); }
            );
          } else {
            __clip('  fallback: execCommand');
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { __clip('  execCommand THREW: ' + e.message); }
            document.body.removeChild(ta);
            __clip('  execCommand returned: ' + ok);
          }
        } catch (e) {
          __clip('  THREW: ' + (e && e.message ? e.message : e));
        }
      } else {
        __clip('  empty text, skipped');
      }
    }
  });

  function handleKey(e) {
    var mod = e.metaKey || e.ctrlKey;
    // Early-return for anything we don't handle so VS Code's host can still forward
    // chords like Cmd+P / Cmd+Shift+P that share the modifier.
    var isOurKey =
      (mod && (e.key === 'f' || e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) ||
      (e.key === 'Escape' && toolbar.classList.contains('open'));
    if (!isOurKey) return;

    if (mod && e.key === 'f') { e.preventDefault(); openFind(); }
    else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(zoom + 0.1); }
    else if (mod && e.key === '-') { e.preventDefault(); setZoom(zoom - 0.1); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom(1); }
    else if (e.key === 'Escape' && toolbar.classList.contains('open')) {
      // If the find input itself originated this event, let its own handler deal with it.
      if (e.target === findInput) return;
      e.preventDefault();
      if (findInput.value) clearInput();
      else closeFind();
    }
  }
  // Bubble phase (not capture) on document. handleKey strictly early-returns for
  // any key not in our allowlist, and only preventDefaults the six we handle.
  // This matches v2.0.4's working behavior (which used capture but didn't actually
  // wire the iframe-side listener due to a cross-origin bug).
  document.addEventListener('keydown', handleKey, false);

  var skeleton = document.getElementById('skeleton');
  function hideSkeleton() {
    if (!skeleton) return;
    skeleton.classList.add('hidden');
    // Remove from DOM after the fade so it stops animating and gets out of the
    // compositor layer tree.
    setTimeout(function() { if (skeleton && skeleton.parentNode) skeleton.parentNode.removeChild(skeleton); }, 320);
  }

  if (frame && frame.addEventListener) {
    __mark('iframe load listener attached');
    frame.addEventListener('load', function() {
      __mark('iframe LOAD fired');
      hideSkeleton();
      try {
        var fdoc = frame.contentDocument;
        if (fdoc) __mark('iframe contentDocument readyState=' + fdoc.readyState);
      } catch (e) { __mark('iframe cross-origin (expected)'); }
      if (toolbar.classList.contains('open') && findInput.value) sendFind(findInput.value);
    });
    // Safety net: if the load event already fired before this script ran (race),
    // drop the skeleton on the next tick.
    setTimeout(function() {
      try {
        if (frame.contentDocument && frame.contentDocument.readyState === 'complete') hideSkeleton();
      } catch (e) { /* cross-origin = it's loaded, hide */ hideSkeleton(); }
    }, 0);
  }

  var dimTimer = null;
  var wakeTimer = null;
  var WAKE_SWEEP_MS = 1400;
  function bumpToolbar() {
    // Only play the warm sweep when waking from an already-dimmed state.
    // The initial call from page load skips this because .dimmed isn't set yet.
    var wasDimmed = toolbar.classList.contains('dimmed');
    toolbar.classList.remove('dimmed');
    if (wasDimmed) {
      // Restart the animation cleanly if the user re-wakes mid-sweep.
      toolbar.classList.remove('waking');
      // Force reflow so the re-added class restarts the keyframes.
      void toolbar.offsetWidth;
      toolbar.classList.add('waking');
      if (wakeTimer) clearTimeout(wakeTimer);
      wakeTimer = setTimeout(function() { toolbar.classList.remove('waking'); }, WAKE_SWEEP_MS);
    }
    if (dimTimer) clearTimeout(dimTimer);
    dimTimer = setTimeout(function() {
      if (!toolbar.classList.contains('open')) toolbar.classList.add('dimmed');
    }, 2200);
  }
  if (wrap && wrap.addEventListener) {
    wrap.addEventListener('mousemove', bumpToolbar);
    toolbar.addEventListener('mouseenter', function() { toolbar.classList.remove('dimmed'); if (dimTimer) clearTimeout(dimTimer); });
    toolbar.addEventListener('mouseleave', bumpToolbar);
    // The iframe is cross-origin (or srcdoc same-origin) and its internal
    // mousemove events do NOT bubble to the parent. But mouseenter on the
    // iframe ELEMENT itself fires in the parent DOM when the cursor crosses
    // into the iframe rectangle. That's our signal to wake the toolbar.
    if (frame && frame.addEventListener) {
      frame.addEventListener('mouseenter', bumpToolbar);
    }
  }
  bumpToolbar();
  __mark('script init done');

  // Capture browser-level navigation timing once available.
  setTimeout(function() {
    try {
      var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || performance.timing || null;
      if (nav && nav.responseEnd != null) {
        __mark('nav.responseEnd=' + (nav.responseEnd|0) + ' domInteractive=' + (nav.domInteractive|0) + ' domComplete=' + (nav.domComplete|0));
      }
    } catch (e) {}
  }, 0);

  // Window onload (after iframe and all subresources).
  window.addEventListener('load', function() { __mark('window LOAD (everything done)'); });
})();`;
}

export const PREVIEW_STYLES = `
  html, body { margin: 0; padding: 0; height: 100%; background: #0d0d0f; color: #e6e6e6; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; }
  body { display: flex; flex-direction: column; overflow: hidden; }

  .frame-wrap { position: relative; flex: 1; overflow: auto; background: white; }
  iframe { width: 100%; height: 100%; border: none; display: block; transform-origin: 0 0; background: white; position: relative; z-index: 2; }

  /* Skeleton: paints immediately, sits behind the iframe, fades out after first
     iframe load. Pure CSS, no JS gating on first paint = no script-blocking cost. */
  .skeleton {
    position: absolute; inset: 0;
    background: #fafafa;
    padding: 64px 72px;
    z-index: 1;
    opacity: 1;
    transition: opacity 240ms ease;
    pointer-events: none;
    overflow: hidden;
  }
  .skeleton.hidden { opacity: 0; }
  .skel-line {
    height: 14px;
    border-radius: 4px;
    background: linear-gradient(90deg, #eee 0%, #f5f5f5 50%, #eee 100%);
    background-size: 200% 100%;
    animation: skel-shimmer 1400ms ease-in-out infinite;
    margin-bottom: 16px;
  }
  .skel-line-1 { width: 38%; height: 22px; margin-bottom: 28px; }
  .skel-line-2 { width: 78%; }
  .skel-line-3 { width: 92%; }
  .skel-line-4 { width: 64%; }
  @keyframes skel-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .toolbar {
    position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
    z-index: 10;
    /* Solid opaque background — backdrop-filter was forcing per-frame readback
       and compositor work, hurting first paint by 100-300ms in the webview. */
    background: rgba(20,20,22,0.94);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    display: flex; align-items: center;
    padding: 4px;
    overflow: visible;
    width: auto;
    transition: width 360ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease;
    will-change: width;
    max-width: calc(100% - 32px);
    opacity: 1;
  }
  .toolbar.dimmed { opacity: 0.25; }
  .toolbar.open { width: min(640px, calc(100% - 32px)); }

  /* Warm orange rotating border that plays once when the toolbar wakes from idle.
     Technique (no mask gymnastics): a pseudo-element behind the toolbar carries
     two stacked backgrounds — an opaque dark fill on padding-box (which hides the
     interior) and a conic-gradient on border-box (which shows through the
     transparent border). Animating --wake-angle via @property rotates the conic
     gradient smoothly.
     Refs:
       https://codetv.dev/blog/animated-css-gradient-border
       https://css-tricks.com/almanac/functions/c/conic-gradient/  */
  @property --wake-angle {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }
  .toolbar::before {
    content: '';
    position: absolute;
    inset: -2px;
    z-index: -1;
    border-radius: 999px;
    border: 2px solid transparent;
    pointer-events: none;
    opacity: 0;
    background:
      linear-gradient(rgba(20,20,22,0.94), rgba(20,20,22,0.94)) padding-box,
      conic-gradient(
        from var(--wake-angle),
        rgba(255,140,60,0) 0deg,
        rgba(255,140,60,0) 70deg,
        rgba(255,160,70,0.95) 140deg,
        rgba(255,210,90,1) 180deg,
        rgba(255,160,70,0.95) 220deg,
        rgba(255,140,60,0) 290deg,
        rgba(255,140,60,0) 360deg
      ) border-box;
    will-change: --wake-angle, opacity;
  }
  .toolbar.waking::before {
    /* Longer total duration so the fade-out trails off into the background
       instead of cutting off abruptly when the rotation finishes. */
    animation: toolbar-wake-spin 1400ms cubic-bezier(0.22, 1, 0.36, 1) 1;
  }
  @keyframes toolbar-wake-spin {
    0%   { --wake-angle: 0deg;    opacity: 0; }
    10%  { opacity: 1; }
    /* Full rotation completes at ~60% so the remaining 40% of the timeline
       is a slow opacity decay back to zero — settles like an ember dimming. */
    60%  { --wake-angle: 360deg;  opacity: 1; }
    100% { --wake-angle: 360deg;  opacity: 0; }
  }

  .toolbar button {
    background: transparent; color: #e6e6e6; border: none; cursor: pointer;
    border-radius: 999px; padding: 6px 12px; font-size: 12.5px;
    display: inline-flex; align-items: center; gap: 6px;
    transition: background 100ms ease;
    font-family: inherit;
    flex-shrink: 0; white-space: nowrap;
  }
  .toolbar button:hover { background: rgba(255,255,255,0.1); }
  .toolbar button.active { background: rgba(124,158,255,0.18); color: #fff; }
  .toolbar .zoom-label { color: #b0b0b8; font-size: 11px; padding: 0 6px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .toolbar .divider { width: 1px; height: 18px; background: rgba(255,255,255,0.1); margin: 0 4px; flex-shrink: 0; }

  .controls-left, .controls-right { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }

  .find-trigger {
    background: transparent; color: #e6e6e6; border: none; cursor: pointer;
    border-radius: 999px; padding: 6px 12px; font-size: 12.5px;
    display: inline-flex; align-items: center; gap: 6px;
    flex-shrink: 0; white-space: nowrap;
    font-family: inherit;
  }
  .find-trigger:hover { background: rgba(255,255,255,0.1); }
  .toolbar.open .find-trigger { padding: 6px 8px; }
  .toolbar.open .find-trigger .label { display: none; }

  .find-area {
    position: relative;
    display: inline-flex; align-items: center;
    width: 0; overflow: hidden;
    opacity: 0;
    flex: 1;
    transition: opacity 200ms ease 120ms, width 360ms cubic-bezier(0.22, 1, 0.36, 1);
    margin: 0;
  }
  .toolbar.open .find-area { width: 100%; opacity: 1; margin: 0 4px; }
  .find-area input {
    background: transparent;
    color: #fff;
    -webkit-text-fill-color: #fff;
    caret-color: #fff;
    border: none; outline: none;
    font-family: inherit; font-size: 13.5px;
    flex: 1 1 auto;
    min-width: 140px;
    padding: 6px 8px;
  }
  .find-area input::placeholder { color: #8a8a93; opacity: 1; }
  .find-area .count { color: #b0b0b8; font-size: 11.5px; padding: 0 10px; font-variant-numeric: tabular-nums; min-width: 56px; text-align: right; flex-shrink: 0; }
  .find-area .nav-group { display: inline-flex; gap: 2px; flex-shrink: 0; }
  .find-area .icon-btn { padding: 6px 10px; }
  .find-area .close-btn { padding: 6px 10px; }

  .history {
    position: absolute; top: 100%; margin-top: 8px;
    left: 0; right: 0;
    background: rgba(20,20,22,0.97);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.4);
    padding: 6px;
    display: none;
    z-index: 11;
    max-height: 260px;
    overflow-y: auto;
  }
  .history.visible { display: block; }
  .history-header {
    font-size: 10.5px; color: #6a6a72; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 6px 12px 4px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .history-clear {
    background: transparent; border: none; color: #6a6a72; cursor: pointer;
    font-size: 10.5px; padding: 2px 6px; border-radius: 4px;
    font-family: inherit; text-transform: none; letter-spacing: 0;
  }
  .history-clear:hover { color: #e6e6e6; background: rgba(255,255,255,0.06); }
  .history-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    color: #d4d4dc; font-size: 13px;
    border-radius: 8px;
    cursor: pointer;
  }
  .history-item .ic { color: #6a6a72; font-size: 12px; }
  .history-item .text { flex: 1; font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .history-item:hover, .history-item.active { background: rgba(255,255,255,0.07); }
  .history-item.active { background: rgba(124,158,255,0.14); }
  .history-empty { color: #6a6a72; font-size: 12px; padding: 14px 12px; text-align: center; font-style: italic; }
`;


export function buildHtml(previewUrl: string, title: string, copyPath?: string): string {
  const nonce = Math.random().toString(36).slice(2);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>${PREVIEW_STYLES}</style>
</head>
<body>
${buildToolbarMarkup(previewUrl, title)}
<script nonce="${nonce}">
${buildPreviewScript(title, copyPath)}
</script>
</body>
</html>`;
}

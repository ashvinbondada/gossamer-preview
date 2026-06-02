export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function buildDiffHtml(htmlA: string, htmlB: string, labelA: string, labelB: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { display: flex; flex-direction: column; height: 100vh; background: #1e1e1e; color: #ccc; font-family: sans-serif; }
  .labels { display: flex; height: 32px; }
  .label { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 12px; background: #2d2d2d; border-bottom: 1px solid #444; }
  .label + .label { border-left: 1px solid #444; }
  .frames { display: flex; flex: 1; overflow: hidden; }
  iframe { flex: 1; border: none; background: white; }
  iframe + iframe { border-left: 2px solid #444; }
</style>
</head>
<body>
<div class="labels">
  <div class="label">${escapeHtml(labelA)}</div>
  <div class="label">${escapeHtml(labelB)}</div>
</div>
<div class="frames">
  <iframe id="frameA" srcdoc="${escapeAttr(htmlA)}" sandbox="allow-scripts allow-same-origin"></iframe>
  <iframe id="frameB" srcdoc="${escapeAttr(htmlB)}" sandbox="allow-scripts allow-same-origin"></iframe>
</div>
<script>
(function() {
  var frameA = document.getElementById('frameA');
  var frameB = document.getElementById('frameB');
  var syncing = false;

  function syncScroll(source, target) {
    if (syncing) return;
    syncing = true;
    try {
      var sw = source.contentWindow;
      var tw = target.contentWindow;
      if (sw && tw) {
        tw.scrollTo(sw.scrollX, sw.scrollY);
      }
    } catch(e) {}
    syncing = false;
  }

  function onLoad(frame, other) {
    try {
      frame.contentWindow.addEventListener('scroll', function() {
        syncScroll(frame, other);
      });
    } catch(e) {}
    runDiff();
  }

  frameA.addEventListener('load', function() { onLoad(frameA, frameB); });
  frameB.addEventListener('load', function() { onLoad(frameB, frameA); });

  function runDiff() {
    try {
      var docsA = frameA.contentDocument;
      var docsB = frameB.contentDocument;
      if (!docsA || !docsB) return;

      var elemsA = docsA.body.querySelectorAll('*');
      var elemsB = docsB.body.querySelectorAll('*');
      var len = Math.min(elemsA.length, elemsB.length);

      for (var i = 0; i < len; i++) {
        var rA = elemsA[i].getBoundingClientRect();
        var rB = elemsB[i].getBoundingClientRect();
        var changed = Math.abs(rA.width - rB.width) > 2 ||
                      Math.abs(rA.height - rB.height) > 2 ||
                      Math.abs(rA.top - rB.top) > 2 ||
                      Math.abs(rA.left - rB.left) > 2;
        if (changed) {
          elemsA[i].style.outline = '2px solid rgba(255,80,80,0.7)';
          elemsB[i].style.outline = '2px solid rgba(80,180,255,0.7)';
        }
      }

      for (var j = len; j < elemsA.length; j++) {
        elemsA[j].style.outline = '2px solid rgba(255,80,80,0.7)';
      }
      for (var k = len; k < elemsB.length; k++) {
        elemsB[k].style.outline = '2px solid rgba(80,180,255,0.7)';
      }
    } catch(e) {}
  }
})();
</script>
</body>
</html>`;
}

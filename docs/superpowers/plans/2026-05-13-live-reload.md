# Live Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an HTML file is saved, Simple Browser refreshes automatically via WebSocket — no manual reload needed.

**Architecture:** A local Node HTTP server serves the HTML file with an injected WebSocket reload script. A WebSocket server runs on the same port via the HTTP `upgrade` event. When `onDidSaveTextDocument` fires, all connected WebSocket clients receive a reload signal. `simpleBrowser.show` points to `http://localhost:<port>/` instead of `file://`.

**Tech Stack:** TypeScript, VS Code API, Node.js built-ins (`http`, `crypto`, `fs`)

---

## File Structure

- **Create:** `src/liveReload.ts` — HTTP server, WebSocket server, save listener
- **Modify:** `src/extension.ts` — wire up liveReload, pass localhost URL to simpleBrowser.show

---

### Task 1: Refactor extension.ts to extract open listener

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Replace extension.ts with refactored version**

```typescript
import * as vscode from 'vscode';

let lastOpenedUri = '';

export function registerOpenListener(
  context: vscode.ExtensionContext,
  getPreviewUrl: (fileUri: string) => string
) {
  const listener = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.uri.scheme !== 'file') {
      return;
    }
    const isHtml =
      doc.languageId === 'html' || doc.fileName.endsWith('.html');
    if (!isHtml) {
      return;
    }
    const uriString = doc.uri.toString();
    if (uriString === lastOpenedUri) {
      return;
    }
    lastOpenedUri = uriString;

    const openEditor = vscode.workspace
      .getConfiguration('gossamer-preview')
      .get<boolean>('openEditor', false);

    const previewUrl = getPreviewUrl(uriString);
    vscode.commands.executeCommand('simpleBrowser.show', previewUrl).then(() => {
      if (!openEditor) {
        vscode.window.tabGroups.all.forEach((group) => {
          group.tabs.forEach((tab) => {
            if (
              tab.input instanceof vscode.TabInputText &&
              tab.input.uri.toString() === uriString
            ) {
              vscode.window.tabGroups.close(tab);
            }
          });
        });
      }
    });
  });

  context.subscriptions.push(listener);
}

export function activate(context: vscode.ExtensionContext) {
  registerOpenListener(context, (fileUri) => fileUri);
}

export function deactivate() {}
```

- [ ] **Step 2: Compile and verify no errors**

```bash
cd /Users/mystiquant/html-auto-preview && npx tsc -p ./ 2>&1
```
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
cd /Users/mystiquant/html-auto-preview
git add src/extension.ts
git commit -m "refactor: extract registerOpenListener from activate"
```

---

### Task 2: Build liveReload.ts — HTTP server + file serving

**Files:**
- Create: `src/liveReload.ts`

- [ ] **Step 1: Create src/liveReload.ts with HTTP server and file serving**

```typescript
import * as http from 'http';
import * as fs from 'fs';
import * as vscode from 'vscode';

const WS_RELOAD_SCRIPT = `
<script>
(function() {
  var ws = new WebSocket('ws://' + location.host);
  ws.onmessage = function(e) { if (e.data === 'reload') location.reload(); };
  ws.onclose = function() { setTimeout(function() { location.reload(); }, 1000); };
})();
</script>
`;

function injectReloadScript(html: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', WS_RELOAD_SCRIPT + '</body>');
  }
  return html + WS_RELOAD_SCRIPT;
}

export class LiveReloadServer {
  private server: http.Server;
  private clients: Set<any> = new Set();
  private currentFilePath = '';
  public port = 0;

  constructor() {
    this.server = http.createServer((req, res) => {
      if (!this.currentFilePath) {
        res.writeHead(404);
        res.end('No file loaded');
        return;
      }
      try {
        const html = fs.readFileSync(this.currentFilePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(injectReloadScript(html));
      } catch {
        res.writeHead(500);
        res.end('Error reading file');
      }
    });
  }

  start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  setFile(filePath: string) {
    this.currentFilePath = filePath;
  }

  reload() {
    this.clients.forEach((ws) => {
      if (ws.readyState === 1) {
        ws.send('reload');
      }
    });
  }

  dispose() {
    this.clients.forEach((ws) => ws.terminate?.());
    this.clients.clear();
    this.server.close();
  }
}
```

- [ ] **Step 2: Compile and verify**

```bash
cd /Users/mystiquant/html-auto-preview && npx tsc -p ./ 2>&1
```
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
cd /Users/mystiquant/html-auto-preview
git add src/liveReload.ts
git commit -m "feat: add LiveReloadServer with HTTP file serving"
```

---

### Task 3: Add WebSocket server to liveReload.ts

**Files:**
- Modify: `src/liveReload.ts`

- [ ] **Step 1: Add WebSocket upgrade handling to the constructor**

Add this import at the top of `src/liveReload.ts`:
```typescript
import * as crypto from 'crypto';
```

Add this method to `LiveReloadServer` class, and call `this.setupWebSocket()` at the end of the constructor:

```typescript
private setupWebSocket() {
  this.server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const acceptKey = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
    );

    const ws = {
      readyState: 1,
      send: (msg: string) => {
        const payload = Buffer.from(msg);
        const frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x81;
        frame[1] = payload.length;
        payload.copy(frame, 2);
        socket.write(frame);
      },
      terminate: () => socket.destroy(),
    };

    this.clients.add(ws);
    socket.on('close', () => this.clients.delete(ws));
    socket.on('error', () => this.clients.delete(ws));
  });
}
```

- [ ] **Step 2: Compile and verify**

```bash
cd /Users/mystiquant/html-auto-preview && npx tsc -p ./ 2>&1
```
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
cd /Users/mystiquant/html-auto-preview
git add src/liveReload.ts
git commit -m "feat: add WebSocket server for live reload signaling"
```

---

### Task 4: Wire liveReload into extension.ts

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Update extension.ts to start the server and use localhost URL**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { LiveReloadServer } from './liveReload';

let lastOpenedUri = '';

export function registerOpenListener(
  context: vscode.ExtensionContext,
  getPreviewUrl: (fileUri: string) => string
) {
  const listener = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.uri.scheme !== 'file') {
      return;
    }
    const isHtml =
      doc.languageId === 'html' || doc.fileName.endsWith('.html');
    if (!isHtml) {
      return;
    }
    const uriString = doc.uri.toString();
    if (uriString === lastOpenedUri) {
      return;
    }
    lastOpenedUri = uriString;

    const openEditor = vscode.workspace
      .getConfiguration('gossamer-preview')
      .get<boolean>('openEditor', false);

    const previewUrl = getPreviewUrl(uriString);
    vscode.commands.executeCommand('simpleBrowser.show', previewUrl).then(() => {
      if (!openEditor) {
        vscode.window.tabGroups.all.forEach((group) => {
          group.tabs.forEach((tab) => {
            if (
              tab.input instanceof vscode.TabInputText &&
              tab.input.uri.toString() === uriString
            ) {
              vscode.window.tabGroups.close(tab);
            }
          });
        });
      }
    });
  });

  context.subscriptions.push(listener);
}

export async function activate(context: vscode.ExtensionContext) {
  const server = new LiveReloadServer();
  await server.start();

  context.subscriptions.push({ dispose: () => server.dispose() });

  // On save, update file and signal reload
  const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== 'file') return;
    const isHtml = doc.languageId === 'html' || doc.fileName.endsWith('.html');
    if (!isHtml) return;
    server.setFile(doc.fileName);
    server.reload();
  });
  context.subscriptions.push(saveListener);

  registerOpenListener(context, (fileUri) => {
    const filePath = vscode.Uri.parse(fileUri).fsPath;
    server.setFile(filePath);
    return `http://127.0.0.1:${server.port}/`;
  });
}

export function deactivate() {}
```

- [ ] **Step 2: Compile and verify**

```bash
cd /Users/mystiquant/html-auto-preview && npx tsc -p ./ 2>&1
```
Expected: no output (success)

- [ ] **Step 3: Manual test**
  - Open Cursor
  - Open any `.html` file — Simple Browser should open showing the page via `http://127.0.0.1:<port>/`
  - Edit the file and save — Simple Browser should refresh automatically

- [ ] **Step 4: Commit**

```bash
cd /Users/mystiquant/html-auto-preview
git add src/extension.ts
git commit -m "feat: wire LiveReloadServer into extension activation"
```

---

### Task 5: Package, publish, and push

**Files:**
- No code changes

- [ ] **Step 1: Package**

```bash
cd /Users/mystiquant/html-auto-preview && npx vsce package 2>&1
```
Expected: `gossamer-preview-2.0.0.vsix` (after bumping version)

- [ ] **Step 2: Bump version and publish**

```bash
cd /Users/mystiquant/html-auto-preview && npx vsce publish minor 2>&1
```
Expected: `DONE  Published ashvinbondada.gossamer-preview v2.0.0`

- [ ] **Step 3: Push to GitHub**

```bash
cd /Users/mystiquant/html-auto-preview && git push
```

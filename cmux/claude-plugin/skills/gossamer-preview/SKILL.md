---
name: gossamer-preview
description: Preview and live-reload HTML inside cmux's embedded browser. Use when working inside cmux (the macOS terminal for AI agents) and you generate, edit, or are asked to show/preview an HTML file (a doc, mockup, dashboard, chart, or UI) so the user can see it rendered and watch it update live as you edit.
---

# Gossamer Preview (cmux)

You are running inside **cmux**, which has an embedded browser. Use the `gossamer`
CLI to render HTML there with live reload, so the user sees your output rendered —
not just the source.

## When to use

- You just generated an `.html` file the user will want to look at.
- The user asks to "preview", "open in the browser", "show me", or "render" an HTML file.
- You're iterating on an HTML file and want changes to appear live.

If the project ships the gossamer-cmux plugin's PostToolUse hook, HTML you write is
opened automatically — you usually don't need to call anything. Use the commands
below when there's no hook, or to open a specific existing file.

## Commands

```bash
gossamer open path/to/file.html   # serve + open in cmux's browser, beside this pane
gossamer open report.html --tab   # open as a new browser surface instead of a split
gossamer status                   # what's being served, and on which URL
gossamer stop                     # stop the preview daemon
```

`gossamer open` starts a small local server (stable URL `http://127.0.0.1:7654`),
registers the file, and tells cmux to open it. After that, **just edit the file** —
the browser reloads automatically. Relative assets (CSS, JS, images) next to the
file are served too, so multi-file pages render correctly.

## Notes

- One daemon serves every file; calling `gossamer open` again for another file
  adds a tab rather than restarting anything.
- Only `.html`/`.htm` files are previewable.
- If the `gossamer` binary isn't installed, run it via `npx gossamer-cmux open <file>`.

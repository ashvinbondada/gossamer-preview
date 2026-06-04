# Gossamer Preview

![Gossamer](https://raw.githubusercontent.com/ashvinbondada/gossamer-preview/main/gossamer.png)

**The canvas for agentic coding.** Live-preview the HTML docs, UIs, and interfaces your AI agent generates — auto-opened, live-reloaded, and rendered right inside your editor.

## The Workflow

AI coding agents like Claude, Claude Code, and Cursor generate HTML files as rich visual context — layouts, component mockups, data visualizations, design specs. Gossamer Preview automatically opens those files in the built-in browser the moment you open them, and live-reloads as you or your agent edits them.

## Features

- **Auto-open** — preview opens instantly when you open an HTML file
- **Live reload** — browser updates automatically as you edit, no Cmd+S required
- **Multi-file** — each HTML file gets its own browser tab with independent live reload
- **Stable URL** — always served on `http://127.0.0.1:7654/<filename>.html`, so reopening Cursor doesn't break your tab
- **Edit Source toggle** — open and close the HTML source editor alongside the preview with one click
- **Find in page** — Cmd/Ctrl+F search with match highlighting and navigation
- **Zoom controls** — zoom in/out/reset via toolbar or Cmd/Ctrl+`+`/`-`/`0`
- **VS Code shortcuts work inside the preview** — Cmd/Ctrl+P (Quick Open), Cmd/Ctrl+Shift+P (Command Palette), Cmd/Ctrl+S (Save), Cmd/Ctrl+W (Close), Cmd/Ctrl+B (Sidebar), Cmd/Ctrl+`` ` `` (Terminal) — all work even when focus is in the previewed page. (Custom keybindings for these chords are not currently honored inside the preview; defaults are used.)
- **Update notifications** — in-editor banner when a new version is installed, with a changelog link
- **Zero config** — no setup, no dependencies, just install and open an HTML file

## How It Works

1. Your agent generates an `.html` file
2. You open the file in Cursor or VS Code
3. The preview opens automatically in a split panel at `http://127.0.0.1:7654/<filename>.html`
4. As you or your agent edits the file, the browser reloads automatically
5. Use the toolbar to find text, zoom, or toggle the source editor open/closed

## Installation

Search **Gossamer Preview** in the VS Code or Cursor extension marketplace, or install via CLI:

```bash
cursor --install-extension ashvinbondada.gossamer-preview
# or
code --install-extension ashvinbondada.gossamer-preview
```

## Requirements

- VS Code `^1.80.0` or Cursor (any recent version)
- No additional dependencies

## Telemetry & Privacy

Gossamer Preview sends a small amount of **anonymous** usage and error telemetry (extension version, feature usage, errors). We never collect file contents, file paths, workspace names, or anything that identifies you personally.

The identifier is VS Code's anonymous `machineId`, which resets when you reinstall the editor.

**To disable telemetry**, set `gossamer-preview.telemetry.enabled` to `false`, or turn off `telemetry.telemetryLevel` globally — either takes effect immediately, no reload required.

**Full details:** see [PRIVACY.md](PRIVACY.md) for the complete list of what we collect, what we don't, how to opt out, and how to request data deletion.

# Gossamer Preview

![Gossamer](https://raw.githubusercontent.com/ashvinbondada/gossamer-preview/main/gossamer.png)

Instantly preview AI-generated HTML files in the Cursor/VS Code Simple Browser with live reload — without leaving your editor.

## The Workflow

AI coding agents like Claude, Claude Code, and Cursor generate HTML files as rich visual context — layouts, component mockups, data visualizations, design specs. Gossamer Preview automatically opens those files in the built-in browser the moment you open them, and live-reloads as you or your agent edits them.

## Features

- **Auto-open** — Simple Browser opens instantly when you open an HTML file
- **Live reload** — browser updates automatically as you edit, no Cmd+S required
- **Multi-file** — each HTML file gets its own browser tab with its own live reload
- **Stable URL** — always served on `http://127.0.0.1:7654/<filename>.html`, so reopening Cursor doesn't break your browser tab
- **Zero config** — no setup, no dependencies, just install and open an HTML file

## How It Works

1. Your agent generates an `.html` file
2. You open the file in Cursor or VS Code
3. Simple Browser opens automatically in a split panel at `http://127.0.0.1:7654/<filename>.html`
4. As you or your agent edits the file, the browser reloads automatically

## Installation

Search **Gossamer Preview** in the VS Code or Cursor extension marketplace, or install via CLI:

```bash
cursor --install-extension ashvinbondada.gossamer-preview
# or
code --install-extension ashvinbondada.gossamer-preview
```

## Configuration

By default, only Simple Browser opens (no editor tab). To also open the raw HTML in the editor:

```json
"gossamer-preview.openEditor": true
```

## Requirements

- VS Code `^1.80.0` or Cursor (any recent version)
- No additional dependencies

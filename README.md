# Gossamer Preview

![Gossamer](https://raw.githubusercontent.com/ashvinbondada/gossamer-preview/main/gossamer.png)

Instantly preview AI-generated HTML files in the Cursor/VS Code Simple Browser without leaving your editor.

## The Workflow

AI coding agents like Claude, Claude Code, and Cursor generate HTML files as rich visual context — layouts, component mockups, data visualizations, design specs. Gossamer Preview automatically opens those files in the built-in browser the moment you open them, so you can see the rendered output alongside your code without any manual steps.

## How It Works

1. Your agent generates an `.html` file
2. You open the file in Cursor or VS Code
3. Simple Browser opens automatically in a split panel
4. You see the rendered HTML instantly — no browser switching, no manual commands

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

# Gossamer Preview for cmux

**The canvas for agentic coding — for [cmux](https://cmux.com).**

Render the HTML your AI agent generates — docs, UIs, dashboards, mockups —
right inside cmux's embedded browser, auto-opened and **live-reloaded** as you
or your agent edit.

This is the cmux-native sibling of the [Gossamer Preview](../README.md) VS
Code/Cursor extension. cmux already gives you a real embedded browser, find,
zoom, and navigation — so this is a small, zero-dependency CLI + daemon that
serves your HTML with live reload and tells cmux to open it.

## How it works

1. `gossamer open foo.html` starts a tiny local server (stable URL
   `http://127.0.0.1:7654`), registers the file, and opens it in cmux's browser
   beside your terminal.
2. A filesystem watcher pushes a reload over Server-Sent Events whenever the
   file (or a sibling CSS/JS/image) changes.
3. You just keep editing — the preview reloads itself, preserving scroll
   position.

Relative assets next to the file are served for real over HTTP, so multi-file
pages render correctly (unlike a bare `file://` open).

## Install

```bash
npm install -g gossamer-cmux      # provides the `gossamer` command
# or run ad-hoc with: npx gossamer-cmux open file.html
```

### As a Claude Code plugin (auto-open)

So agent-generated HTML opens automatically while you work in cmux:

```
/plugin marketplace add ashvinbondada/gossamer-preview
/plugin install gossamer-cmux@gossamer
```

The plugin adds a `PostToolUse` hook that runs `gossamer open` whenever the agent
writes or edits an `.html` file inside a cmux terminal, plus a `gossamer-preview`
skill so the agent knows to preview HTML on request.

### cmux command palette

Copy [`.cmux/cmux.json`](.cmux/cmux.json) into your project's `.cmux/` (or merge
into `~/.config/cmux/cmux.json`) to get palette entries — **Gossamer: Start
preview daemon**, **status**, **stop**, and a **Gossamer Preview** workspace that
puts a terminal and the preview browser side by side. Reload with
`cmux reload-config` (or `Cmd+Shift+,`).

## Usage

```bash
gossamer open path/to/file.html    # serve + open in cmux's browser (split)
gossamer open report.html --tab    # open as a new browser surface instead
gossamer serve                     # start the daemon only (usually automatic)
gossamer status                    # show what's being served
gossamer stop                      # stop the daemon
```

| Option | Meaning |
| --- | --- |
| `-p, --port <N>` | Port to serve on (default `7654`) |
| `--split` / `--no-split` / `--tab` | Force browser placement (default: split inside cmux) |
| `--no-open` | Only serve and print the URL; don't drive cmux |

## Design notes

- **Zero runtime dependencies** — Node built-ins only (`http`, `fs`, `child_process`).
- **One daemon, many files** — each `gossamer open` registers with the running
  daemon (spawning it if needed) rather than starting a second server, keeping
  the URL stable across reopens.
- **Live reload is SSE, not WebSocket** — simpler and reconnects on its own; no
  surface-id tracking needed because the page reloads itself.
- macOS only for now (cmux is macOS). The CLI runs anywhere; only the
  `cmux browser` integration requires cmux.

See [`deploy.sh`](deploy.sh) for the publish process.

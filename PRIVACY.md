# Gossamer Preview — Privacy Notice

Last updated: 2026-06-06

This extension collects a small amount of **anonymous** usage and error data to help us understand which features are used, catch regressions, and prioritize improvements. We try to take the smallest possible amount of data needed to do that, and never collect anything that identifies you personally.

## What we collect

| Category | Examples |
|---|---|
| **Extension lifecycle** | extension version, activation, changelog viewed |
| **Feature usage** | preview opened (via custom editor or command), find used, host shortcut dispatched (which command name), live reload triggered, diff comparison opened |
| **Errors** | exception messages and stack traces from inside the extension code (e.g., live-reload server failed to start), with the context of where they happened |

Each event includes:
- The extension version (e.g. `2.1.0`)
- An anonymous device identifier (see below)

## What we do NOT collect

We never collect:
- The contents of any HTML file you preview
- File paths, file names, workspace names, or folder names
- Anything you type into the find bar or any other input
- Your name, email, IP address, or any account information
- Selection or clipboard contents
- Anything that could identify you personally

## How we identify you

We use [`vscode.env.machineId`](https://code.visualstudio.com/api/references/vscode-api#env), the anonymous installation identifier that VS Code/Cursor provides to all extensions. This identifier:

- Is generated locally on your machine when you install VS Code/Cursor.
- Is **not** linked to any real-world identity (no account, no email, no IP).
- Resets when you reinstall the editor or set up a new machine.
- Cannot be reverse-mapped to a specific user by us or by anyone else.

This is the same anonymous identifier that Microsoft's own telemetry uses.

## Where the data goes

Events are sent to [PostHog](https://posthog.com), a product analytics platform that is itself SOC 2 Type II certified, GDPR compliant, and CCPA compliant. Data is processed in PostHog's US infrastructure.

PostHog acts as our data processor. They never share, sell, or resell collected data.

## How to disable telemetry

Gossamer Preview has its own telemetry switch, and it is the **only** gate. In VS Code/Cursor settings (JSON):

```json
{
  "gossamer-preview.telemetry.enabled": false
}
```

Or through the Settings UI: search for "Gossamer Preview" and uncheck "Telemetry: Enabled."

The setting takes effect immediately — no reload required.

### Note on the global VS Code telemetry setting

The global `telemetry.telemetryLevel` setting in VS Code/Cursor does **not** control Gossamer Preview's telemetry. If you have global telemetry off but want Gossamer telemetry off too, you must disable it explicitly via the setting above.

**Changed in 2.1.4:** Previously, Gossamer Preview also honored `telemetry.telemetryLevel`. As of 2.1.4, the per-extension setting is the only gate. This was made deliberately, with an updated CHANGELOG entry, so the behavior change is visible to users.

## Data deletion requests

Because we do not collect anything that identifies you personally, we generally cannot locate "your" data. If you would still like us to delete events associated with a specific anonymous machineId, email us with that machineId and we will delete the matching events from PostHog.

To find your machineId:
1. Open VS Code/Cursor.
2. Cmd+Shift+P → "Developer: Toggle Developer Tools."
3. In the console, run `vscode.env.machineId` (you may need to grant permission).

**Contact:** ashvinsaibondada@gmail.com

## Changes to this notice

We may update this document when the events we collect change. The "Last updated" date at the top reflects the most recent change. Material changes will be noted in the extension's CHANGELOG.

## Open source

The extension source code is at https://github.com/ashvinbondada/gossamer-preview. Telemetry is implemented in `src/posthog.ts`; every event capture call is in the repo, so you can audit exactly what gets sent.

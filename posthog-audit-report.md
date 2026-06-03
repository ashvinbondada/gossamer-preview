# PostHog Audit Report

## Summary

The Gossamer Preview VS Code extension integrates PostHog via `posthog-node` in the extension host (server-side Node.js only — no browser SDK). Installation and event-capture checks are fully healthy; two warnings in the Identification area relate to the use of `vscode.env.machineId` as the distinct ID and a potential race between early error captures and the deferred `identify()` call.

**Counts**

- **Errors**: 0 (must fix)
- **Warnings**: 2 (should fix)
- **Suggestions**: 0 (nice to have)
- **Passes**: 8

**Problematic items** _(only `error`, `warning`, `suggestion` — no passes)_

| Severity | Area | Check | File | Details |
|----------|------|-------|------|---------|
| `warning` | Identification | Stable distinct_id (not session UUID) | `src/posthog.ts:41` | distinctId is `vscode.env.machineId` — a device-scoped identifier that resets on reinstall or a new machine, not a persistent authenticated user/account ID |
| `warning` | Identification | identify() called before captures / flag evals | `src/posthog.ts:41` | identify() is deferred via setImmediate; captureException() at extension.ts:87 can fire before setImmediate runs, so early error events are captured anonymously |

---

## Recommended actions

1. **Identification · Stable distinct_id (not session UUID)** — `vscode.env.machineId` is a device-scoped identifier that resets on reinstall or when the user moves to a new machine, rather than a stable authenticated user or account ID. _Why it matters:_ Device-level IDs produce person-count inflation (each reinstall creates a new person record), break cross-device user stitching, and make retention and funnel analysis unreliable because the same human appears as multiple distinct users. _Fix:_ Decide whether device-level anonymous tracking is intentional; if not, store a UUID in `context.globalState` on first activation and use that as `distinctId` at `src/posthog.ts:41`. See [PostHog identify docs](https://posthog.com/docs/getting-started/identify-users).

2. **Identification · identify() called before captures / flag evals** — `initPostHog()` (and the `identify()` call inside it) is deferred via `setImmediate`, but `captureException()` at `extension.ts:87` can fire in the same tick if `server.start()` rejects, producing an anonymous error event before identity is established. _Why it matters:_ Error events captured before `identify()` land under the anonymous distinct ID, severing them from the identified user — they become invisible in per-user analyses, funnel attribution, and person-level timelines. _Fix:_ Inline or eagerly await `initPostHog` before calling `server.start()`, or guard `captureException` so it always has the `_distinctId` set; see `src/posthog.ts:29` and `src/extension.ts:53–87`. See [PostHog identify docs](https://posthog.com/docs/getting-started/identify-users).

---

## Full audit

### Installation

This section verifies that a PostHog SDK is present in the project's dependency manifests, that it is on a current version, and that the initialization call is correctly placed, uses an env-sourced token, and runs in the appropriate runtime.

| Check | Status | File | Details |
|-------|--------|------|---------|
| PostHog SDK installed | `pass` | — | posthog-node@5.35.13 |
| SDK version up to date | `pass` | — | installed 5.35.13, latest 5.35.13 |
| Initialization is correct | `pass` | `src/posthog.ts:29` | init present, token from process.env.POSTHOG_API_KEY, called via setImmediate in activate() |

### Identification

This section verifies that users are identified correctly: stable distinct IDs, timely identify() calls before captures or flag evaluations, consistent IDs across runtimes, and proper reset on logout or account switch.

| Check | Status | File | Details |
|-------|--------|------|---------|
| Stable distinct_id (not session UUID) | `warning` | `src/posthog.ts:41` | distinctId is vscode.env.machineId (set in extension.ts:55) — device-scoped, resets on reinstall or new machine; flag for human review to confirm device-level anonymous tracking is intentional |
| identify() called before captures / flag evals | `warning` | `src/posthog.ts:41` | identify() is deferred via setImmediate (extension.ts:53–57); captureException() at extension.ts:87 can fire before setImmediate runs, so early error captures are anonymous |
| Same distinct_id across client and server | `pass` | `src/posthog.ts:37` | Single runtime only — PostHog initialized exclusively in the VS Code extension host; no client-side browser SDK present |
| reset() called on logout / account switch | `pass` | `src/posthog.ts:29` | No logout or account-switch flow found; VS Code extension with stable machineId, no user session concept |

### Event Capture

This section verifies that event names are static strings (not dynamic), that browser captures route through a reverse proxy to avoid ad-blocker drops, and that key growth-funnel events are explicitly tracked.

| Check | Status | File | Details |
|-------|--------|------|---------|
| Event names are static and consistent | `pass` | `src/extension.ts:33` | All posthog.capture() calls use static string literals; no template literals or dynamic variables found |
| Captures route through a reverse proxy | `pass` | `src/posthog.ts:37` | Server-only SDK — no browser runtime; reverse proxy is not needed |
| Key activation events captured | `pass` | `src/extension.ts:1` | No auth/billing paths detected — VS Code HTML preview extension with no signup, activation, purchase, or subscription surfaces |

---

## About this audit

The PostHog wizard runs a five-stage chain: SDK installation → init correctness → identification → event capture → this report. Each stage resolves one or more checks against the project's source tree, recording every result — pass or otherwise — in the ledger this report was generated from.

- `error` items break correctness now (events lost, identity broken). Fix first.
- `warning` items work today but cause subtle data-quality bugs. Fix when convenient.
- `suggestion` items are best-practice improvements with measurable upside.

Re-run `posthog-wizard audit` after applying fixes to refresh the ledger.

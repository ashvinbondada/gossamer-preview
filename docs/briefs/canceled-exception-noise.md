# `Canceled` Exception Noise in PostHog Error Tracking

**Status:** Benign / no action needed  
**First seen:** 2026-06-06  
**PostHog issues:**
- [019e9dfc-f1df — `nx` variant](https://us.posthog.com/project/453271/error_tracking/019e9dfc-f1df-7190-9a75-e44472dc3f8e)
- [019e9dfc-f253 — `SP.terminate` variant](https://us.posthog.com/project/453271/error_tracking/019e9dfc-f253-7081-bac0-6fbfb407e235)

---

## What it is

Both issues are an unhandled `Canceled` rejection originating from VS Code's internal
`extensionHostProcess.js`, not from Gossamer's own code. The error type and value are
literally the string `"Canceled"` — VS Code's own sentinel for a cancelled async operation.

**Issue A** (`nx` variant) — top frame: `nx` at line 435 of `extensionHostProcess.js`  
**Issue B** (`SP.terminate` variant) — top frame: `ta` at line 411, triggered via `SP.terminate`

Both were first and last seen on the same day (2026-06-06, 17:31–17:55 UTC), 12 users each,
0 sessions attached. All 24 affected users fired *only* this one exception — no
`extension activated`, no `preview opened`, nothing else.

---

## Call stack summary

```
process.processTicksAndRejections   (node internals)
extensionHostProcess.js:532         (VS Code host bootstrap)
extensionHostProcess.js:435         i._remoteCall  →  r.<computed>  →  nx
```

The rejection surfaces through VS Code's RPC layer (`_remoteCall`). This is the channel VS
Code uses to talk between the extension host process and the renderer. When the host is torn
down (window close, reload, crash, or the extension is uninstalled mid-session) any in-flight
`_remoteCall` promises are rejected with `Canceled`. Node's `unhandledRejection` handler then
picks it up and our PostHog SDK captures it.

---

## Why these users show nothing else

These users never completed activation from Gossamer's perspective. Likely scenarios:

1. Opened VS Code, the extension host started, an internal VS Code RPC fired, the user
   immediately closed the window — Gossamer never got to run its own activation path.
2. Installed the extension and then immediately uninstalled or disabled it.
3. A VS Code window reload happened before `extension activated` could be sent.

Because `$process_person_profile` is `false` on these events, PostHog never identified them
as real users — they exist as anonymous persons with no profile.

---

## Signal vs noise

| Signal | Noise |
|--------|-------|
| Users who fire `extension activated` but then hit a `Canceled` | Users whose *only* event is `Canceled` |
| `Canceled` with Gossamer source files in the stack | `Canceled` with only `extensionHostProcess.js` frames |
| Rising `Canceled` volume correlated with a release | Flat background rate of ~24/day |

The 24 exceptions on 2026-06-06 are pure noise — no Gossamer frames, no activation, no session.

---

## When to pay attention

Escalate if any of the following become true:

- The daily `Canceled` count spikes sharply after a release (suggests the new version is
  triggering cancellations during normal usage, not just at host teardown).
- `Canceled` exceptions appear for users who *also* fired `extension activated` — that means
  the cancellation is happening during real usage, not just at shutdown.
- A stack frame from Gossamer's own source files (`out/extension.js`, `previewPanel`,
  `localhostBridge`, etc.) appears in the trace.

---

## Suppression recommendation

If these issues become noisy in the PostHog error tracking UI, suppress them with a rule that
matches:

- `$exception_types` contains `"Canceled"`  
- AND `$exception_sources` contains only `extensionHostProcess.js` (i.e. no Gossamer frames)

Do **not** suppress all `Canceled` errors globally — a future Gossamer bug could legitimately
produce one and you'd lose the signal.

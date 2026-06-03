// PostHog client wrapper.
//
// Defensive design: this module MUST NOT prevent the extension from activating
// even if `posthog-node` is missing, fails to load, or throws at any point.
// All exports are safe no-ops in that case. Telemetry being broken should never
// hang or fail the user's editor.

let _client: any | undefined;
let _distinctId = 'anonymous';
let _version = 'unknown';
let _PostHog: any | undefined;

function tryLoadSdk(): any | undefined {
  if (_PostHog !== undefined) return _PostHog;
  try {
    // require, not import, so a missing module is a runtime warning not a hard
    // activation failure.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('posthog-node');
    _PostHog = mod.PostHog ?? mod.default ?? mod;
  } catch (err) {
    // Stash an empty sentinel so we don't retry on every call.
    _PostHog = null;
    try { console.warn('[gossamer] posthog-node not available; telemetry disabled', err); } catch {}
  }
  return _PostHog;
}

export function initPostHog(machineId: string, version: string): void {
  _distinctId = machineId;
  _version = version;
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return;
  const PostHog = tryLoadSdk();
  if (!PostHog) return;
  try {
    _client = new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST,
      enableExceptionAutocapture: true,
    });
    _client.identify({
      distinctId: _distinctId,
      properties: {
        $set: { extension_version: _version },
        $set_once: { first_seen_version: _version },
      },
    });
  } catch (err) {
    _client = undefined;
    try { console.warn('[gossamer] posthog init failed; telemetry disabled', err); } catch {}
  }
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  try {
    _client?.capture({
      distinctId: _distinctId,
      event,
      properties: { extension_version: _version, ...properties },
    });
  } catch {/* never propagate */}
}

export function captureException(error: unknown, properties?: Record<string, unknown>): void {
  try {
    _client?.captureException(error, _distinctId, properties);
  } catch {/* never propagate */}
}

export function shutdownPostHog(): Promise<void> {
  try {
    const p = _client?.shutdown?.() ?? Promise.resolve();
    _client = undefined;
    return p;
  } catch {
    _client = undefined;
    return Promise.resolve();
  }
}

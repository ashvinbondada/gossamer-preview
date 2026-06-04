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

// Synchronously record the identity. Safe to call from activate() before the
// SDK is loaded — any captures fired before connectPostHog() resolves still
// reference the correct distinctId, so once the SDK connects and queued events
// are flushed they have the right identity from the start.
export function setIdentity(machineId: string, version: string): void {
  _distinctId = machineId;
  _version = version;
}

// PostHog project key for the Gossamer Preview project. Public-safe by design:
// project API keys (phc_*) can only WRITE events to the project, not read.
// Embedded so shipped extensions report telemetry without users needing to
// configure anything. Override via POSTHOG_API_KEY env var for local dev.
const POSTHOG_PROJECT_KEY = 'phc_pmcKFyMAXmBzCXsbTChVyc6Jynn5A2otKHQxRnktRPum';
const POSTHOG_DEFAULT_HOST = 'https://us.i.posthog.com';

// Actually load the SDK and open a connection. Heavier — defer via setImmediate.
export function connectPostHog(): void {
  const apiKey = process.env.POSTHOG_API_KEY || POSTHOG_PROJECT_KEY;
  if (!apiKey) return;
  const PostHog = tryLoadSdk();
  if (!PostHog) return;
  try {
    _client = new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST || POSTHOG_DEFAULT_HOST,
      enableExceptionAutocapture: true,
    });
    _client.identify({
      distinctId: _distinctId,
      properties: {
        extension_version: _version,
        $set: { extension_version: _version },
        $set_once: { first_seen_version: _version },
      },
    });
  } catch (err) {
    _client = undefined;
    try { console.warn('[gossamer] posthog init failed; telemetry disabled', err); } catch {}
  }
}

// Back-compat shim: initPostHog is what extension.ts currently calls. It does
// both steps. Kept for callers that want the old single-call API.
export function initPostHog(machineId: string, version: string): void {
  setIdentity(machineId, version);
  connectPostHog();
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

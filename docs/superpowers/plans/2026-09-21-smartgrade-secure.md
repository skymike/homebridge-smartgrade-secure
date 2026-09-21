# SmartGrade Secure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a locally installable Homebridge plugin that exposes supported SmartGrade water heaters as switches with cloud-reported state.

**Architecture:** A separate HTTPS client handles app tokens, phone/code login, discovery, and explicit power writes. A dynamic Homebridge platform restores cached accessories and polls cloud state. A local command-line setup flow stores tokens outside the package and source tree.

**Tech Stack:** TypeScript, Node.js 22/24, native fetch, Homebridge HAP dynamic platform, Node test runner. No MQTT dependency in version one.

**Spec:** `docs/smartgrade-investigation.md`, proposed design approved by the user on 2026-09-21; subsequent protocol findings narrow its implementation.

## Global Constraints

- Package name: `homebridge-smartgrade-secure`; platform name: `SmartGradeSecure`.
- Expose supported water heaters as HomeKit switches with confirmed cloud state.
- Credentials and tokens must stay out of logs and source control.
- Do not repeat uncertain writes automatically.
- Temperature controls require capability and payload evidence; defer them from version one.
- Use HTTPS polling, initially every 30 seconds, configurable from 15 to 300 seconds.
- Preserve cloud timers and `max_on_min`.
- Do not publish, deploy to the user's existing Homebridge, or operate a real heater as part of automated tests.

## Review Focus

1. Missing/null state must produce an unavailable characteristic, not a false off indication.
2. A write timeout may follow an accepted command; issue no second write and reconcile using reads.
3. Expired/revoked user sessions require interactive login without repeated verification-code requests.
4. Partial discovery failure must preserve cached accessories rather than delete them.
5. Restarted accessory registration must preserve stable UUIDs without leaking session data into accessory context.

## File structure

| File | Responsibility |
| --- | --- |
| `src/protocol.ts` | Validate API responses and map supported devices |
| `src/client.ts` | HTTPS headers, timeouts, authentication, discovery, power |
| `src/session.ts` | Atomic session-file loading/saving and expiry checks |
| `src/setup.ts` | Interactive phone/code login and read-only device listing |
| `src/platform.ts` | Homebridge lifecycle, discovery, polling and cache restoration |
| `src/accessory.ts` | Switch reads/writes and unavailable-state handling |
| `src/index.ts`, `src/settings.ts` | Registration entrypoint and constants |
| `config.schema.json` | Session path, device selection and polling settings |
| `test/*.test.mjs` | Offline protocol, session, platform and package tests |
| `test/fixtures/*.json` | Synthetic data shaped from APK evidence |
| `README.md` | Setup, supported models, operation and verification limits |

## Task 1: Validated cloud protocol

**Create:** `src/protocol.ts`, `src/client.ts`, `test/protocol.test.mjs`, `test/client.test.mjs`, package and TypeScript configuration.

**Interfaces:**

```ts
interface Device {
  id: string;
  siteId: string;
  name: string;
  productId: number;
  online: boolean;
  on: boolean | null;
  firmware?: string;
}
interface Session {
  appToken: string;
  appExpiresAt: number; // Unix seconds
  userToken: string;
  userId: string;
  userExpiresAt: number; // Unix seconds, decoded scheduling hint only
}
// A decoded JWT payload is not local proof of server authorization.
// The cloud must validate the token on every authenticated request.
parseDevice(value: unknown): Device;
class SmartGradeClient {
  getProfile(): Promise<{ id: string }>;
  listDevices(): Promise<Device[]>;
  getDevice(siteId: string, deviceId: string): Promise<Device>;
  setPower(deviceId: string, on: boolean): Promise<Device>;
}
```

- [ ] Write failing assertions for true, false, null, missing and invalid switch fields, mismatched device IDs, offline devices, malformed arrays, and product 6 detection.

```js
assert.equal(parseDevice({id:'heater',site_id:'site',name:'Boiler',product_id:6,is_online:true,switch_1:null}).on, null);
assert.throws(() => parseDevice({id:'heater',site_id:'site',name:'Boiler',product_id:6,is_online:true,switch_1:'false'}));
```

- [ ] Use a local fake HTTP server behind an injected transport to record actual requests. Production origin remains fixed to `https://api.iotechv.com/`, redirect handling rejects redirects, and path segments are encoded.
- [ ] Assert `POST /api/v1/devices/heater/power` receives exactly `{"power_on":false}` and both token headers. Simulate a dropped response after recording the request; assert one POST only.
- [ ] Assert HTTP 401, 403, 429, timeout and invalid JSON yield redacted typed errors. Never include server response bodies, headers or raw transport exceptions in logged error text.
- [ ] Implement the observed request shapes. Use a 20-second request deadline. No automatic mutation retries. Read retries are bounded and must not overlap polling cycles.
- [ ] Run `npm test` and `npm run build`; inspect failures before proceeding.

## Task 2: Local login and session lifecycle

**Create:** `src/session.ts`, `src/setup.ts`, `test/session.test.mjs`, `test/setup.test.mjs`.

**Interfaces:** `loadSession(path): Promise<Session>`, `saveSession(path, session): Promise<void>`, `requestLoginCode(mobile): Promise<void>`, `verifyLoginCode(code): Promise<Session>`.

- [ ] Write failing tests for missing/malformed session files, concurrent app-token refresh, expiry within one hour, invalid JWT payloads, failed verification, and persistence interrupted before rename.
- [ ] Implement atomic session writes with owner-only mode where supported. Refuse symlink targets. Store only required session fields; never store verification codes.
- [ ] Setup accepts app-bootstrap credentials from a private local configuration or environment. Provide a local APK-extraction step so embedded application credentials are not hardcoded into the distributable package. Alternatively allow the user to supply an app token and its expiry; without bootstrap credentials, report required reauthentication when it expires.
- [ ] Request the phone number interactively, obtain the app token, send `{"customer":{"mobile":phone}}`, then request the code and exchange `{"user":{"code":code}}`. Code input must not echo or enter shell history.
- [ ] Refresh the app token before its expiry using a shared in-flight promise. Expired user tokens stop operations with a clear re-login message; background polling never requests verification codes.
- [ ] Validate login using `GET /api/v1/users/profile`, verify the returned user identity matches the login response, and show a redacted read-only device summary.
- [ ] Test with fake endpoints only. Run the whole suite before continuing.

## Task 3: Homebridge switch platform

**Create:** `src/platform.ts`, `src/accessory.ts`, `src/index.ts`, `src/settings.ts`, `config.schema.json`, `test/platform.test.mjs`, `test/accessory.test.mjs`.

**Interfaces:** `SmartGradePlatform.configureAccessory(accessory)`, `discoverDevices(): Promise<void>`, `WaterHeaterAccessory.getOn(): Promise<boolean>`, `setOn(value): Promise<void>`.

- [ ] Write failing lifecycle tests using real Homebridge accessory/service classes with an API harness. Two discoveries must register one accessory; restoring its cached UUID must register none.
- [ ] Test offline/null/stale state, malformed responses, partial site failures, shutdown during polling, read responses racing a write, and rapidly alternating on/off requests.
- [ ] Generate stable UUIDs from platform identity and device ID. Register each new platform accessory before constructing its service wrapper, preserving the AUX registration-order fix.
- [ ] Default discovery to product 6; allow an explicit device-ID selection within supported products. Unknown products are listed during setup but do not silently gain a switch.
- [ ] Initialize `AccessoryInformation` and a `Switch` service. Use HAP communication errors for offline, stale or unknown state. Never initialize an unknown device to a fabricated off value.
- [ ] Serialize commands per device, wait for the explicit power response, and reconcile with a fresh GET. A POST acknowledgement alone must not be presented as proof of physical switching.
- [ ] Poll without overlap every configured interval; suppress obsolete read results after newer commands. Stop timers and abort active reads on shutdown.
- [ ] Preserve cached accessories on discovery failure. Cache only device metadata, never tokens.
- [ ] Run all tests, the TypeScript build, and `git diff --check`.

## Task 4: Package and verification handoff

**Create:** `README.md`, `.env.example` containing names only, and `test/package.test.mjs`; update package scripts and an explicit package file allowlist.

- [ ] Document setup and supported boiler product 6, session expiry and re-login, polling latency, unavailable-state behavior, and unverified live operation.
- [ ] Assert package contents exclude `research`, APKs, credentials, sessions, tests and local logs. Inspect `npm pack --dry-run --json`, then create an installable tarball with `npm pack`.
- [ ] Test the packed plugin's registration entrypoint in a temporary local Homebridge harness without cloud credentials or network access.
- [ ] Run the complete suite and build once against the final tree. Record the tarball hash and exact results.
- [ ] After local implementation passes, obtain the user's login through the private setup flow and verify read-only discovery. A live on/off test requires a named device and the user's explicit authorization. Deployment/publication remain separate actions.

## Plan self-review

- Approved scope is covered by Tasks 1–4; temperature and MQTT are explicitly deferred based on evidence.
- All five review-focus failure modes have assigned tests.
- Client/session/device interfaces are named consistently.
- No live cloud availability, token lifetime, or physical control is claimed by offline tests.

## Execution recommendation

Use native execution in this task: the same protocol findings inform authentication, control and state reconciliation. This avoids duplicating decompilation context between implementers. Implementation-plan review and execution selection are the remaining workflow gate.

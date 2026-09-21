# Implementation status

## Delivered

- Cloud client with app/user token headers, phone/code login, discovery, explicit power commands and bounded requests.
- Atomic private session storage, local bootstrap extraction, non-echoing setup prompts, app-token renewal and user-session re-login handling.
- Homebridge HAP switch platform for product types 6 and 7 with persistent accessory IDs, serialized commands, readback, unavailable-state handling and shutdown cleanup.
- Config schema, setup documentation, private alpha tarball and a Windows/Linux CI matrix.

## Verification performed locally

- TypeScript build succeeded.
- 39 offline tests passed with actual Homebridge 1.11.4 classes.
- The same 39 tests passed with actual Homebridge 2.4.0 classes.
- The 26-file package allowlist and isolated entrypoint registration check passed.
- Independent review identified a discovery/write race, a device-site migration issue, and a late completion from a stopped setter. All three were reproduced as failing tests, fixed, and passed in the complete suite.

## Implementation decisions

- Used a development branch in the clean dedicated checkout so local ignored APK research remains accessible. No unrelated user changes were present.
- Used pnpm and its lockfile because this runtime provides pnpm, not npm. The built package remains installable with npm.
- Session/bootstrap parsing lives alongside protocol types. Private storage and interactive prompts have separate modules.
- All HTTP calls use native fetch in production; tests inject transport or route it to a local server. Tests never access the heater cloud.
- A user may supply a session without bootstrap credentials, but app-token expiry then requires reconfiguration. No undocumented refresh endpoint is invented.
- The test harness loads the installed Homebridge API implementation relative to its resolved entrypoint because Homebridge 1 and 2 package their files differently. Production code does not import Homebridge internals.
- HTTPS polling is the initial status mechanism. Plaintext MQTT from the APK is not used.

## Remaining verification

SMS login, profile validation, device discovery, and read-only status retrieval were verified against the live cloud on 2026-09-21. Both discovered type-7 boilers were online and off. Live responses required numeric account-ID normalization and plain-array device lists. The single-device GET returned HTTP 405; status reads now fall back to the site device list with exact identity validation. An authorized brief on/off test of the selected boiler succeeded, with independent cloud reads confirming both transitions and final off state. The APK power endpoint returned HTTP 404; the verified control endpoint is POST devices/{id}/toggle_switches with an explicit switch_1 boolean. Its response can contain the old state, so success requires subsequent readback. Physical relay operation was not independently observed. Alpha.2 is installed on the authorized homebridge-pi host, which runs Homebridge 2.4.0 and Node 24.20.0. Both boilers were registered. The custom UI server was verified via its real IPC interface on that host: saved login recognized, bootstrap available, and both supported boilers discovered. The new SMS UI flow is covered by synthetic tests; no additional live SMS was requested. The plugin has not been merged to main or published to npm.

No deferred minor findings from the independent review.

## Settings UI

The Homebridge custom settings page supports phone/OTP login, cloud discovery, polling interval and per-device exclusions. Tokens remain in private files; the UI receives only login availability and allowlisted device fields. SMS requests have a 60-second cooldown per UI server and pending logins expire after 10 minutes. Excluded cached accessories are unregistered on restart even during cloud failure. A one-time private bootstrap file is still required. Cloud device names are trimmed for HomeKit compatibility.

The installed settings page was also verified in Homebridge UI 5.29.0: SMS controls rendered, Discover devices returned both boilers, and Save settings succeeded with both boilers included. No new SMS or device power command was sent during UI verification.

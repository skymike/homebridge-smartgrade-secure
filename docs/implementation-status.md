# Implementation status

## Delivered

- Cloud client with app/user token headers, phone/code login, discovery, explicit power commands and bounded requests.
- Atomic private session storage, local bootstrap extraction, non-echoing setup prompts, app-token renewal and user-session re-login handling.
- Homebridge HAP switch platform for product types 6 and 7 with persistent accessory IDs, serialized commands, readback, unavailable-state handling and shutdown cleanup.
- Config schema, setup documentation, private alpha tarball and a Windows/Linux CI matrix.

## Verification performed locally

- TypeScript build succeeded.
- 36 offline tests passed with actual Homebridge 1.11.4 classes.
- The same 36 tests passed with actual Homebridge 2.4.0 classes.
- The 21-file package allowlist and isolated entrypoint registration check passed.
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

SMS login, profile validation, device discovery, and read-only status retrieval were verified against the live cloud on 2026-09-21. Both discovered type-7 boilers were online and off. Live responses required numeric account-ID normalization and plain-array device lists. The single-device GET returned HTTP 405; status reads now fall back to the site device list with exact identity validation. Cloud-to-physical status freshness remains unverified. Physical control requires an explicitly authorized test of a named heater. The plugin has not been installed on the user's Homebridge, merged to main, or published to npm.

No deferred minor findings from the independent review.

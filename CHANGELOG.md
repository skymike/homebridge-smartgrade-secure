# Changelog

## 0.1.0

First public release.

- SmartGrade Secure cloud boiler switches for product types 6 and 7.
- Homebridge settings page with phone/SMS OTP login and cloud discovery.
- Per-device exclusions and configurable status polling.
- Private session storage and application-token renewal.
- Explicit on/off commands, cloud readback and protection against stale responses.
- Compatibility tests with Homebridge 1 and 2 on Node 22 and 24.

One-time extraction of application credentials from the user's own APK is required. User-session expiry requires another SMS login. This version does not expose temperature, timer editing, energy reporting, Matter or local control.

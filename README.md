# Homebridge SmartGrade Secure

An experimental Homebridge plugin for SmartGrade Secure water-heater switches using the IoTech cloud. It exposes supported heaters as switches in Apple Home.

## Status

Initial implementation with offline protocol and Homebridge tests. Account login and physical heater operation have not yet been verified. No package has been published to npm.

- [Protocol findings and design](docs/smartgrade-investigation.md)
- [Implementation plan](docs/superpowers/plans/2026-09-21-smartgrade-secure.md)

## Supported devices and behavior

- SmartGrade product types **6 and 7**, identified by the Android app as boiler switches.
- Explicit on/off commands, cloud-reported status, and HTTPS polling every 30 seconds by default.
- Unknown, offline or stale state reports unavailable. A command is checked with a subsequent cloud read; an HTTP acknowledgement alone is not treated as proof of physical operation.
- Timed-out writes are never automatically resent. Commands for the same heater are serialized.
- Existing cloud timers and `max_on_min` are preserved.
- Other device types, temperature controls and MQTT are not enabled in this version.

Requires Node.js 22 or 24 and Homebridge 1.8+ or 2.x. Local tests run against Homebridge 1.11.4 and 2.4.0.

## Install a local build

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm test
pnpm pack
```

The result is `homebridge-smartgrade-secure-0.1.0-alpha.1.tgz`. Install this tarball through your Homebridge installation's normal local-package process. For a conventional npm-based Homebridge host:

```sh
npm install -g /absolute/path/homebridge-smartgrade-secure-0.1.0-alpha.1.tgz
```

Use the account and permissions appropriate to your installation. The plugin is HAP-only; it does not require Matter.

## Private setup

The cloud requires an app token as well as your account token. The APK includes application bootstrap credentials; they are deliberately not included in this repository or package.

1. Use [JADX](https://github.com/skylot/jadx) locally to decode your own SmartGrade Secure APK. The inspected version is `3.0.3`, package `il.co.dealor`. Locate `sources/il/co/dealor/BuildConfig.java` in the decoded output.
2. Create a private directory owned by the account running Homebridge. On Linux, give the directory mode `700`; on Windows, restrict its NTFS permissions to that account. Files created by the setup tool use mode `600` on systems that support it.
3. Extract only the bootstrap fields into your private directory:

```sh
smartgrade-setup extract-bootstrap --from /path/to/BuildConfig.java --out /private/smartgrade/bootstrap.json
```

4. Log in using your usual SmartGrade phone number and the code you receive:

```sh
smartgrade-setup login --bootstrap /private/smartgrade/bootstrap.json --session /private/smartgrade/session.json
```

The phone number and code are entered in the terminal without echo. Do not put them in command arguments, issues, or logs. Setup saves the session atomically and lists devices without operating them. Both private files must be readable by Homebridge; keep them out of the repository.

For an uninstalled local build, replace `smartgrade-setup` with `node dist/setup.js`.

Alternatively supply `SMARTGRADE_APP_USERNAME` and `SMARTGRADE_APP_PASSWORD` through your local environment when running setup. The running Homebridge plugin uses its `bootstrapFile` for app-token renewal.

## Homebridge configuration

```json
{
  "platform": "SmartGradeSecure",
  "name": "SmartGrade Secure",
  "sessionFile": "/private/smartgrade/session.json",
  "bootstrapFile": "/private/smartgrade/bootstrap.json",
  "pollInterval": 30,
  "includeDeviceIds": []
}
```

Paths must be absolute. On Windows, JSON paths can use forward slashes, such as `C:/private/smartgrade/session.json`.

- `pollInterval`: 15–300 seconds. Cloud changes may take a polling interval to appear in Home.
- `includeDeviceIds`: leave empty for all supported boilers, or select IDs printed by setup. Selecting an ID does not enable unsupported product types.
- `bootstrapFile`: optional only while the saved app token remains valid. Configure it for automatic app-token renewal.

The user token is separate from the app token. The inspected application requires another login when the user token is near expiry; no user-token refresh endpoint was found. Run the same login command again to replace the session. The plugin reloads it on later requests. It never requests verification codes in the background.

Read-only diagnostics:

```sh
smartgrade-setup list --bootstrap /private/smartgrade/bootstrap.json --session /private/smartgrade/session.json
```

Cached accessories are retained and marked unavailable after failed discovery. Devices absent from the account remain unavailable; remove unwanted cached accessories through Homebridge's normal UI. Restart Homebridge after changing configuration.

## Verification

Tests use synthetic fixtures shaped from the APK, a local HTTP server, and actual Homebridge accessory classes. They cover authentication, token expiry, storage, command payloads, unavailable state, cache restoration, command ordering, and stale responses. They do not establish live API availability or physical control.

The GitHub workflow runs Node 22/24 on Windows/Linux and checks the packed plugin's entrypoint and file allowlist. No cloud credentials are required for CI.

## Private research

APKs, decompiled sources, embedded application credentials, account sessions, and local tools are excluded from version control. Only authored documentation and, as development proceeds, original plugin code belong in this repository.

This is an unofficial integration, unaffiliated with SmartGrade or IoTech. Redistribution is not licensed at this stage.

<p align="center">
  <img src="https://raw.githubusercontent.com/skymike/homebridge-smartgrade-secure/main/assets/smartgrade-secure.png" alt="SmartGrade Secure" width="160">
</p>

# Homebridge SmartGrade Secure

[![npm version](https://img.shields.io/npm/v/homebridge-smartgrade-secure)](https://www.npmjs.com/package/homebridge-smartgrade-secure)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-smartgrade-secure)](https://www.npmjs.com/package/homebridge-smartgrade-secure)
[![GitHub release](https://img.shields.io/github/v/release/skymike/homebridge-smartgrade-secure)](https://github.com/skymike/homebridge-smartgrade-secure/releases)
[![Build](https://github.com/skymike/homebridge-smartgrade-secure/actions/workflows/test.yml/badge.svg)](https://github.com/skymike/homebridge-smartgrade-secure/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/skymike/homebridge-smartgrade-secure/blob/main/LICENSE)

Bring SmartGrade Secure **water boilers into Apple Home** through Homebridge and the IoTech cloud. Turn a boiler on or off, discover your cloud devices, and choose which boilers appear in Homebridge.

An independent, unofficial integration. Initial public release: cloud login, discovery and on/off state transitions have been tested on type-7 boilers. Physical relay operation was not independently observed. This project is not Homebridge Verified and is not affiliated with SmartGrade or IoTech.

## Features

- **SMS login in Homebridge:** request a code and sign in from the plugin settings page.
- **Cloud discovery:** find supported boilers in owned and shared sites.
- **Device selection:** uncheck a boiler to exclude it from Homebridge without changing its power or deleting it from SmartGrade.
- **On/off switches in Apple Home:** explicit desired-state commands followed by cloud readback.
- **Status updates:** HTTPS polling, every 30 seconds by default.
- **Private sessions:** cloud tokens stay in restricted files, outside Homebridge configuration and accessory caches.
- **App-token renewal:** automatic with the private bootstrap file; a new SMS login is needed when the user session expires.

## Compatibility

| Requirement | Supported |
| --- | --- |
| Node.js | 22.14+ on the 22.x line, or 24.x |
| Homebridge | 1.8+ or 2.x; tested with 1.11.4 and 2.4.0 |
| Homebridge UI | Custom settings page; tested with 5.29.0 |
| SmartGrade product 6 | Boiler switch under plaster; APK-identified, not live-tested |
| SmartGrade product 7 | Boiler box switch; live cloud control tested |
| Apple Home | HAP switch accessories through Homebridge |

An internet connection and a SmartGrade Secure account are required. Temperature control, thermostat services, energy reporting, timer editing, local LAN control, MQTT and Matter are not implemented. Existing cloud timers and maximum-on-time settings are left unchanged.

## Installation

In **Homebridge UI → Plugins**, search for `homebridge-smartgrade-secure` and install it.

For a conventional npm-based installation:

```sh
npm install -g homebridge-smartgrade-secure
```

Use the account and permissions appropriate to your Homebridge installation. Follow the one-time application setup below before requesting your first SMS code.

## One-time application setup

The cloud requires application credentials as well as your SMS-authenticated account. **Application credentials are not distributed in this package.** Extract them locally from your own SmartGrade Secure APK. The inspected app is version `3.0.3`, package `il.co.dealor`.

1. Decode the APK with [JADX](https://github.com/skylot/jadx) and locate `sources/il/co/dealor/BuildConfig.java`.
2. Create a private directory under your Homebridge storage directory. On Linux, make it readable only by the Homebridge service account. On Windows, restrict its NTFS permissions to that account.
3. Run the setup command as that account. For the standard Linux storage path:

```sh
mkdir -p /var/lib/homebridge/smartgrade-private
chmod 700 /var/lib/homebridge/smartgrade-private
smartgrade-setup extract-bootstrap \
  --from /path/to/decoded/sources/il/co/dealor/BuildConfig.java \
  --out /var/lib/homebridge/smartgrade-private/bootstrap.json
```

The setup tool reads the expected fields without evaluating Java code. It writes a private JSON file and does not print the credentials. If Homebridge uses another storage directory, use that path instead.

## Sign in and discover boilers

1. Open **Plugins → Homebridge Smartgrade Secure → Plugin Config**.
2. Enter the phone number used in SmartGrade Secure. Israeli accounts may require the local `05…` format.
3. Click **Request SMS code**, enter the received code, then click **Sign in**.
4. Click **Discover devices**. The page shows each device's name and cloud-reported status; unsupported devices cannot be selected.
5. Leave the boilers you want checked. Uncheck any boiler to exclude it.
6. Set the refresh interval, click **Save settings**, then restart Homebridge.

Requests are limited to one SMS per 60 seconds within the settings session. A pending login expires after 10 minutes. Phone numbers and OTP codes are not saved in the configuration. The plugin never requests SMS codes in the background.

Excluding a boiler removes its cached Homebridge accessory after restart, including when the cloud is unavailable. It does not remove the device from your SmartGrade account. Re-including it may require restoring its room or automations in Apple Home.

## Configuration

The settings page writes this platform block. For manual configuration, add it to `platforms`:

```json
{
  "platform": "SmartGradeSecure",
  "name": "SmartGrade Secure",
  "sessionFile": "/var/lib/homebridge/smartgrade-private/session.json",
  "bootstrapFile": "/var/lib/homebridge/smartgrade-private/bootstrap.json",
  "pollInterval": 30,
  "excludeDeviceIds": []
}
```

| Option | Default | Description |
| --- | --- | --- |
| `name` | `SmartGrade Secure` | Platform name in Homebridge |
| `sessionFile` | Required | Absolute path to the private saved account session |
| `bootstrapFile` | Recommended | Absolute path to application credentials for SMS login and app-token renewal |
| `pollInterval` | `30` | Status refresh in seconds, from 15 to 300 |
| `excludeDeviceIds` | `[]` | Boiler IDs to remove from Homebridge after restart |
| `includeDeviceIds` | `[]` | Advanced manual allowlist; empty means all supported devices, subject to exclusions |

The settings page manages exclusions and resets the advanced allowlist. On Windows, use absolute JSON paths such as `C:/Homebridge/smartgrade-private/session.json`.

### Terminal login and diagnostics

```sh
smartgrade-setup login \
  --bootstrap /var/lib/homebridge/smartgrade-private/bootstrap.json \
  --session /var/lib/homebridge/smartgrade-private/session.json

smartgrade-setup list \
  --bootstrap /var/lib/homebridge/smartgrade-private/bootstrap.json \
  --session /var/lib/homebridge/smartgrade-private/session.json
```

Terminal prompts hide the phone number and code. The `list` command is read-only. For a source checkout, replace `smartgrade-setup` with `node dist/setup.js`.

## How control works

A HomeKit command sends an explicit `switch_1` boolean over HTTPS. Commands for a boiler run sequentially. The cloud command response can contain the old state, so the plugin checks subsequent device status before reporting success. Uncertain writes are not automatically repeated.

Offline, unknown or stale states report unavailable rather than inventing an off state. Polling eventually picks up changes made through the app or physical controls. Cloud readback confirms the server-reported state, not an independent measurement of the physical relay or water temperature.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Application credentials missing | Complete the one-time bootstrap extraction and confirm the Homebridge account can read the file. |
| SMS does not arrive | Use the app's phone-number format, wait before requesting another code, and check the official app. |
| Session needs login | Request a fresh SMS in plugin settings. User-session refresh is not available in the inspected protocol. |
| No boilers found | Confirm the account and site access in SmartGrade. Only product types 6 and 7 are exposed. |
| Boiler missing from Apple Home | Check its inclusion checkbox, save settings, and restart Homebridge. |
| No response or unavailable | Check the boiler in SmartGrade, internet access, and the saved session; allow the next poll. |
| A command fails but state changes later | The request may have reached the cloud. Check status before issuing another command. |

## Security and support

Never attach bootstrap files, session files, phone numbers, OTP codes or unredacted account/device details to an issue. Private files, APKs and decompiled vendor sources are excluded from Git and npm. Linux session files use mode `600`; Windows permissions depend on the directory ACL.

For a bug report, include the plugin, Homebridge and Node versions, the device product type, and a redacted error message. Use [GitHub Issues](https://github.com/skymike/homebridge-smartgrade-secure/issues). For sensitive issues, see [SECURITY.md](https://github.com/skymike/homebridge-smartgrade-secure/blob/main/SECURITY.md).

## Development

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm pack
node test/package.check.mjs homebridge-smartgrade-secure-0.1.0.tgz
```

The suite covers authentication, session storage, command transport, unavailable state, stale-response races, accessory restoration, exclusions and the custom UI server. Tests use synthetic data and never operate cloud devices. CI tests Windows/Linux with Node 22/24 and Homebridge 1/2.

Contributions are welcome through pull requests. Keep protocol fixtures synthetic, add regression tests for behavior changes, and do not commit credentials or vendor code.

## Releases

GitHub tags use `vX.Y.Z`; npm versions use `X.Y.Z`. The initial 0.1.0 release bootstraps the npm package manually; subsequent version tags use the trusted publisher. The release workflow checks that the tag matches `package.json`, runs tests, and publishes using npm trusted publishing. Stable versions use npm's `latest` tag; prereleases use `next`. See [GitHub releases](https://github.com/skymike/homebridge-smartgrade-secure/releases) and [CHANGELOG.md](https://github.com/skymike/homebridge-smartgrade-secure/blob/main/CHANGELOG.md).

## License and acknowledgements

Original plugin code is released under the [MIT License](https://github.com/skymike/homebridge-smartgrade-secure/blob/main/LICENSE). The supplied SmartGrade logo identifies the compatible app; its artwork and trademarks belong to their respective owners and are not covered by the code license.

Thanks to the Homebridge project and its custom UI tools. This is an independently developed integration for SmartGrade Secure users, not an official SmartGrade or IoTech product.

# SmartGrade Secure investigation

## Inspected artifact

- File: `C:\Users\Michael\Downloads\SmartGrade-Secure_3.0.3_apkcube.apk`
- SHA-256: `11C2B4A853FA6363F425999737EDEEF2FDD5FA7E0262ED7AA6747AFE1715115D`
- Inspected: 2026-09-21, ZIP inventory and DEX string table.
- Decoded manifest confirms package `il.co.dealor`, version `3.0.3`, version code `122`.

## Evidence

The `classes2.dex` string table contains:

- Application classes in `il.co.dealor`, including `RetrofitApi`, `MqttConnector`, `DeviceMqttStorage`, and device control entities.
- REST base URL: `https://api.iotechv.com/`.
- MQTT URL: `tcp://vernemq.iotechv.com:1883`.
- `api/v1/apps/token`, `api/v1/users/login/code`, `api/v1/users/profile`.
- `api/v1/users/{uuid}/sites`, `api/v1/sites/{site_id}/devices`.
- `api/v1/devices/{device_id}/power`, `/toggle_switches`, `/thermostat`.
- Device action, future action, timer, energy, and usage-statistics endpoints.
- A boiler icon identifier, `ic_device_boiler`.

Strings establish candidate protocol components, not their HTTP methods, payloads, authentication requirements, or availability for a particular device. No cloud account was accessed and no device commands were sent.

## Proposed plugin design

Build a separate `homebridge-smartgrade-secure` dynamic platform. Use the AUX plugin's accessory registration and cache handling as reference, with a new IoTech cloud client rather than assuming its AUX protocol applies.

1. Decode login, token persistence, site/device discovery, power writes, and status reads from the APK.
2. Expose each supported water heater as a HomeKit switch with confirmed cloud state. Only expose temperature or thermostat controls when device capability and payload evidence support them.
3. Use HTTP status retrieval if confirmed by the app; add MQTT status updates only after identifying topic/authentication/payload behavior. Bound retries and avoid automatic repetition of uncertain writes.
4. Keep credentials and tokens out of logs and source control. Provide a setup flow appropriate to the actual login mechanism.
5. Test protocol mapping and Homebridge accessory persistence with sanitized fixtures, then verify account discovery and a user-authorized physical control test.

## Decompiled protocol findings

JADX 1.5.5 decoded the app into local `research/decompiled` and resources into `research/resources`. Source decompilation reported 28 errors across the whole APK; the relevant methods below were readable. Resource decoding completed successfully. Decompiled proprietary code and embedded application credentials are excluded from Git and must not be included in the plugin package.

### Authentication

Evidence: `presentation/di/module/ApplicationModule.java`, `presentation/viewmodel/RegisterViewModel.java`, `data/repository/LoginApiStorage.java`, and the `data/entity/login` and `data/entity/user` models (paths relative to `research/decompiled/sources/il/co/dealor`).

1. `GET /api/v1/apps/token` uses HTTP Basic authentication with application credentials from the APK's `BuildConfig`. Response contains `token` and `exp`.
2. `POST /api/v1/customers` sends `{"customer":{"mobile":"<phone>"}}` with `X-APP-TOKEN: Bearer <app token>`. The app submits absent name/email as null model fields, which its Gson configuration omits. The UI moves to code entry on `success: true`.
3. `POST /api/v1/users/login/code` sends `{"user":{"code":"<verification code>"}}` with the same app-token header. Response contains `jwt` and `user`, including the user `id`. Do not substitute a phone/password login or Firebase flow.
4. Authenticated API calls include both `Authorization: Bearer <user JWT>` and `X-APP-TOKEN: Bearer <app token>`.
5. `TokenLocalStorage` fetches a new app token when it expires within one hour. `IsNeedRegisterUseCase` routes back to login when the user token expires within one hour. No user-token refresh endpoint was found in `RetrofitApi`; do not invent silent renewal or assume tokens are permanent.

### Discovery and power

Evidence: `data/connection/RetrofitApi.java`, `data/entity/device/DeviceEntity.java`, `data/entity/device/control/PowerEntity.java`, and `data/repository/DeviceControlApiStorage.java`.

- `GET /api/v1/users/profile` returns the user.
- `GET /api/v1/users/{uuid}/sites?shared=true` returns `{"sites":[...]}`.
- `GET /api/v1/sites/{site_id}/devices` returns `{"devices":[...]}`.
- `GET /api/v1/sites/{site_id}/devices/{device_id}` returns `{"device":{...}}`.
- `POST /api/v1/devices/{device_id}/power` sends `{"power_on":true}` or `{"power_on":false}` and returns a device entity. This is an explicit desired power state, not a blind toggle.
- Device fields include `id`, `site_id`, `name`, `product_id`, `firmware`, `is_online`, nullable `switch_1` through `switch_3`, and `max_on_min`.
- `product_id: 6` maps to the resource `title_device_type6`, whose English text is "Smart switch boiler under plaster". Product 2 is a socket adapter and must not be assumed to be a boiler.
- Unknown or null switch state must remain unknown; do not coerce it to off. Preserve existing heater timers and `max_on_min`.

### Optional MQTT status

Evidence: `data/connection/MqttConnector.java` and `DevicePowerOn.java`.

- Broker: `tcp://vernemq.iotechv.com:1883`; app uses user ID as username and user JWT as password, clean sessions and a 30-second keepalive.
- Power topic: `s/{siteId}/{deviceId}/power`; fields include `switch_1`, `switch_2`, `switch_3`, `switch_on`, and `t`. The observed application callback uses the numbered switch fields.
- Site availability topic: `s/{siteId}/online`.
- Version one should use HTTPS polling. The observed MQTT URL is unencrypted, so it is not an appropriate default for sending the user's token. A secure broker endpoint has not been established.

## Remaining live verification

- Confirm the user's heater is product 6 or inspect its actual model before adding another product mapping.
- Confirm the phone/code flow and token lifetime against the user's own account through a local setup flow.
- Confirm cloud-read freshness and command response behavior with a deliberately authorized on/off test.

## Implementation references

- [Official JADX releases](https://github.com/skylot/jadx/releases).
- [Homebridge dynamic platform lifecycle](https://developers.homebridge.io/homebridge/interfaces/DynamicPlatformPlugin.html).
- [Official Homebridge plugin template](https://github.com/homebridge/homebridge-plugin-template).

An initial plugin implementation now exists with offline protocol and Homebridge tests. Installation on the user's Homebridge, npm publication, account login verification and physical device control have not been performed.

## Live API verification (2026-09-21)

The authenticated profile and login response return numeric user IDs; these are normalized to strings without coercing tokens or accepting unsafe numeric IDs. Site/device IDs remain strings. Site device-list responses are plain arrays. The APK single-device GET currently returns HTTP 405, so readback falls back only for that status to the authenticated site device list and validates the exact device and site identity.

Product 7 maps to `title_device_type7`, whose English APK resource is "Smart switch boiler box". The two account boilers use this type, so types 6 and 7 are supported. Login, discovery and status were verified. A user-authorized brief on/off test confirmed both state transitions through independent cloud reads, ending off. The APK /power route returned HTTP 404; POST /api/v1/devices/{device_id}/toggle_switches with {"switch_1":true} or {"switch_1":false} succeeded. Despite its name, this submits an explicit state. Its response contained the previous state, so bounded follow-up reads remain necessary. Physical relay operation was not independently observed.

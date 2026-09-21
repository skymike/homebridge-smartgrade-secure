# Homebridge SmartGrade Secure

Homebridge integration in development for SmartGrade Secure water heaters using the IoTech cloud.

## Status

APK protocol investigation and the implementation plan are available. Plugin implementation and live device verification are pending; this repository is not yet an installable Homebridge plugin.

- [Protocol findings and design](docs/smartgrade-investigation.md)
- [Implementation plan](docs/superpowers/plans/2026-09-21-smartgrade-secure.md)

## Initial scope

- Phone and verification-code login through a private local setup flow.
- Supported boiler discovery, on/off control, and cloud-reported state in Apple Home.
- HTTPS polling, persistent accessory identity, and explicit handling of unavailable devices.
- Preserve existing heater timers and maximum-on duration.

The inspected APK identifies product type 6 as a boiler switch. Support for a particular heater still requires checking its cloud device record and testing it with its owner's authorization.

## Private research

APKs, decompiled sources, embedded application credentials, account sessions, and local tools are excluded from version control. Only authored documentation and, as development proceeds, original plugin code belong in this repository.

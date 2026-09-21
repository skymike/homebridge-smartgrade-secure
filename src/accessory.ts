import type { API, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { supported } from './protocol.js';
import type { Device } from './protocol.js';

export interface DeviceClient {
  getDevice(siteId: string, deviceId: string): Promise<Device>;
  setPower(deviceId: string, on: boolean): Promise<Device>;
}

export class WaterHeaterAccessory {
  private readonly service: Service;
  private state?: Device;
  private observedAt = 0;
  private revision = 0;
  private stopped = false;
  private queued = 0;
  private tail: Promise<void> = Promise.resolve();
  private refreshing?: Promise<void>;

  constructor(
    private readonly api: API,
    readonly accessory: PlatformAccessory,
    private readonly identity: Device,
    private readonly client: () => DeviceClient,
    private readonly options: { staleMs: number; confirmationDelayMs?: number },
  ) {
    accessory.getService(api.hap.Service.AccessoryInformation)!
      .setCharacteristic(api.hap.Characteristic.Manufacturer, 'SmartGrade')
      .setCharacteristic(api.hap.Characteristic.Model, 'Boiler switch (product 6)')
      .setCharacteristic(api.hap.Characteristic.SerialNumber, identity.id)
      .setCharacteristic(api.hap.Characteristic.FirmwareRevision, identity.firmware || 'Unknown');
    this.service = accessory.getService(api.hap.Service.Switch) ?? accessory.addService(api.hap.Service.Switch, identity.name);
    this.service.getCharacteristic(api.hap.Characteristic.On).onGet(() => this.getOn()).onSet(value => this.setOn(value));
    this.invalidate();
  }

  get generation(): number { return this.revision; }
  get siteId(): string { return this.identity.siteId; }
  private failure(): Error { return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE); }
  private matches(device: Device): boolean {
    return device.id === this.identity.id && device.siteId === this.identity.siteId && supported(device);
  }

  apply(device: Device, generation = this.revision): void {
    if (this.stopped || generation !== this.revision) return;
    if (!this.matches(device)) { this.invalidate(generation); return; }
    this.state = device;
    this.observedAt = Date.now();
    if (device.online && device.on !== null) this.service.updateCharacteristic(this.api.hap.Characteristic.On, device.on);
    else this.service.updateCharacteristic(this.api.hap.Characteristic.On, this.failure());
  }

  invalidate(generation = this.revision): void {
    if (generation !== this.revision) return;
    this.state = undefined;
    this.observedAt = 0;
    this.service.updateCharacteristic(this.api.hap.Characteristic.On, this.failure());
  }

  async refresh(): Promise<void> {
    if (this.stopped || this.queued) return;
    if (this.refreshing) return this.refreshing;
    const generation = this.revision;
    this.refreshing = (async () => {
      try { this.apply(await this.client().getDevice(this.identity.siteId, this.identity.id), generation); }
      catch { this.invalidate(generation); }
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  async getOn(): Promise<boolean> {
    if (this.stopped || this.queued) throw this.failure();
    if (!this.state || !this.state.online || this.state.on === null || Date.now() - this.observedAt > this.options.staleMs) await this.refresh();
    if (this.stopped || this.queued || !this.state?.online || this.state.on === null || Date.now() - this.observedAt > this.options.staleMs) throw this.failure();
    return this.state.on;
  }

  async setOn(value: CharacteristicValue): Promise<void> {
    if (typeof value !== 'boolean' || this.stopped) throw this.failure();
    this.queued++;
    this.revision++;
    const operation = this.tail.catch(() => {}).then(async () => {
      if (this.stopped) throw this.failure();
      // Invalidates reads started before this queued command actually executes.
      const generation = ++this.revision;
      const client = this.client();
      try {
        const before = await client.getDevice(this.identity.siteId, this.identity.id);
        if (this.stopped || !this.matches(before) || !before.online) throw this.failure();
        this.invalidate(generation);
        await client.setPower(this.identity.id, value);
        for (let attempt = 0; attempt < 3; attempt++) {
          if (this.stopped) throw this.failure();
          const actual = await client.getDevice(this.identity.siteId, this.identity.id);
          if (this.stopped) throw this.failure();
          this.apply(actual, generation);
          if (this.matches(actual) && actual.online && actual.on === value) return;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, this.options.confirmationDelayMs ?? 750));
        }
        throw this.failure();
      } catch {
        // The write may have reached the heater: reconcile only with a read.
        if (!this.stopped) {
          try { this.apply(await client.getDevice(this.identity.siteId, this.identity.id), generation); }
          catch { this.invalidate(generation); }
        }
        throw this.failure();
      }
    });
    this.tail = operation;
    try { await operation; } finally { this.revision++; this.queued--; }
  }

  stop(): void {
    this.stopped = true;
    this.revision++;
    this.invalidate();
  }
}

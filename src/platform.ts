import { isAbsolute } from 'node:path';
import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { SmartGradeClient } from './client.js';
import { WaterHeaterAccessory } from './accessory.js';
import type { DeviceClient } from './accessory.js';
import { CloudError, parseDevice, supported } from './protocol.js';
import type { Device } from './protocol.js';
import { loadBootstrap, loadSession, saveSession } from './session.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export interface CloudClient extends DeviceClient { listDevices(): Promise<Device[]>; close(): void }
export interface Config extends PlatformConfig { sessionFile?: string; bootstrapFile?: string; pollInterval?: number; includeDeviceIds?: string[]; excludeDeviceIds?: string[] }

async function createClient(config: Config): Promise<CloudClient> {
  const credentials = config.bootstrapFile ? await loadBootstrap(config.bootstrapFile) : undefined;
  return new SmartGradeClient({
    credentials, loadSession: () => loadSession(config.sessionFile!),
    saveSession: value => saveSession(config.sessionFile!, value),
  });
}

export class SmartGradePlatform implements DynamicPlatformPlugin {
  private readonly cache = new Map<string, PlatformAccessory>();
  private readonly wrappers = new Map<string, WaterHeaterAccessory>();
  private readonly interval: number;
  private configError = false;
  private client?: CloudClient;
  private creating?: Promise<CloudClient>;
  private discovering?: Promise<void>;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private lastError?: string;

  constructor(
    private readonly log: Logger,
    private readonly config: Config,
    private readonly api: API,
    private readonly factory: (config: Config) => Promise<CloudClient> = createClient,
  ) {
    const interval = config.pollInterval ?? 30;
    this.interval = interval * 1000;
    this.configError = !config.sessionFile || !isAbsolute(config.sessionFile) ||
      Boolean(config.bootstrapFile && !isAbsolute(config.bootstrapFile)) ||
      !Number.isInteger(interval) || interval < 15 || interval > 300 ||
      (config.excludeDeviceIds !== undefined && (!Array.isArray(config.excludeDeviceIds) || config.excludeDeviceIds.some(id => typeof id !== 'string' || !id.trim()))) ||
      (config.includeDeviceIds !== undefined && (!Array.isArray(config.includeDeviceIds) || config.includeDeviceIds.some(id => typeof id !== 'string' || !id.trim())));
    api.on('didFinishLaunching', () => { void this.cycle(); });
    api.on('shutdown', () => this.stop());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cache.set(accessory.UUID, accessory);
    try {
      const old = accessory.context.device;
      const device = parseDevice({
        id: old?.id, site_id: old?.siteId, name: old?.name, product_id: old?.productId,
        is_online: false, switch_1: null, firmware: old?.firmware,
      });
      if (supported(device) && this.selected(device)) this.bind(accessory, device);
      else this.disable(accessory);
    } catch { this.disable(accessory); }
  }

  private disable(accessory: PlatformAccessory): void {
    const failure = () => new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    accessory.getService(this.api.hap.Service.Switch)?.getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(() => { throw failure(); }).onSet(() => { throw failure(); }).updateValue(failure());
  }

  private selected(device: Device): boolean {
    return !this.config.excludeDeviceIds?.includes(device.id) && (!this.config.includeDeviceIds?.length || this.config.includeDeviceIds.includes(device.id));
  }

  private bind(accessory: PlatformAccessory, device: Device): WaterHeaterAccessory {
    const wrapper = new WaterHeaterAccessory(this.api, accessory, device, () => {
      if (!this.client || this.stopped) throw new CloudError('CLOSED', 'Cloud client is not ready.');
      return this.client;
    }, { staleMs: Math.max(60_000, this.interval * 2) });
    this.wrappers.set(accessory.UUID, wrapper);
    return wrapper;
  }

  async discoverDevices(): Promise<void> {
    if (this.stopped) return;
    if (this.configError) throw new CloudError('CONFIG', 'Set an absolute session file path and a polling interval from 15 to 300 seconds.');
    for (const [uuid, accessory] of this.cache) {
      if (this.config.excludeDeviceIds?.includes(accessory.context.device?.id)) {
        this.wrappers.get(uuid)?.stop();
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.wrappers.delete(uuid);
        this.cache.delete(uuid);
      }
    }
    if (this.discovering) return this.discovering;
    this.discovering = this.discover().finally(() => { this.discovering = undefined; });
    return this.discovering;
  }

  private async discover(): Promise<void> {
    const generations = new Map([...this.wrappers].map(([id, wrapper]) => [id, wrapper.generation]));
    try {
      if (!this.client) {
        this.creating ??= this.factory(this.config).finally(() => { this.creating = undefined; });
        this.client = await this.creating;
      }
      if (this.stopped) { this.client.close(); return; }
      const devices = await this.client.listDevices();
      if (this.stopped) return;
      const seen = new Set<string>();
      for (const device of devices) {
        const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${device.id}`);
        if (!supported(device) || !this.selected(device)) continue;
        seen.add(uuid);
        let accessory = this.cache.get(uuid);
        if (!accessory) {
          accessory = new this.api.platformAccessory(device.name, uuid);
          accessory.context = { device: this.metadata(device) };
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.cache.set(uuid, accessory);
        }
        accessory.context = { device: this.metadata(device) };
        let wrapper = this.wrappers.get(uuid);
        let rebound = false;
        if (wrapper && wrapper.siteId !== device.siteId) {
          wrapper.stop();
          wrapper = undefined;
          rebound = true;
        }
        wrapper ??= this.bind(accessory, device);
        wrapper.apply(device, rebound ? wrapper.generation : generations.get(uuid) ?? wrapper.generation);
        this.api.updatePlatformAccessories([accessory]);
      }
      for (const [uuid, wrapper] of this.wrappers) if (!seen.has(uuid)) wrapper.invalidate(generations.get(uuid));
    } catch (error) {
      for (const [uuid, wrapper] of this.wrappers) wrapper.invalidate(generations.get(uuid));
      throw error;
    }
  }

  private metadata(device: Device): Partial<Device> {
    return { id: device.id, siteId: device.siteId, name: device.name, productId: device.productId, firmware: device.firmware };
  }

  private async cycle(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.discoverDevices();
      if (this.lastError) this.log.info('SmartGrade cloud connection restored.');
      this.lastError = undefined;
    } catch (error) {
      const message = error instanceof CloudError ? error.message : 'SmartGrade cloud is unavailable.';
      if (message !== this.lastError) this.log.warn(message);
      this.lastError = message;
    } finally {
      if (!this.stopped && !this.configError) this.timer = setTimeout(() => { void this.cycle(); }, this.interval).unref();
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    for (const wrapper of this.wrappers.values()) wrapper.stop();
    this.client?.close();
  }
}

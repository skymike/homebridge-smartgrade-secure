import { arrayField, CloudError, expiry, invalidResponse, jwtExpiry, nonempty, object, parseDevice, parseSession } from './protocol.js';
import type { Bootstrap, Device, Session } from './protocol.js';

export interface ClientOptions {
  session?: Session;
  loadSession?: () => Promise<Session>;
  saveSession?: (session: Session) => Promise<void>;
  credentials?: Bootstrap;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class SmartGradeClient {
  private readonly transport: typeof fetch;
  private readonly pending = new Set<AbortController>();
  private closed = false;
  private session?: Session;
  private app?: { token: string; exp: number };
  private renewal?: Promise<void>;
  private revokedToken?: string;
  private loginRequested = false;

  constructor(private readonly options: ClientOptions) {
    this.transport = options.fetch ?? fetch;
    if (options.session) this.acceptSession(options.session);
  }

  private acceptSession(value: Session): void {
    const session = parseSession(value);
    this.session = session;
    if (!this.app || this.app.exp < session.appExpiresAt) this.app = { token: session.appToken, exp: session.appExpiresAt };
  }

  private async userHeaders(): Promise<Record<string, string>> {
    if (this.options.loadSession) this.acceptSession(await this.options.loadSession());
    if (!this.session || this.session.userExpiresAt < Date.now() / 1000 + 3600 || this.session.userToken === this.revokedToken) {
      throw new CloudError('AUTH', 'SmartGrade session needs login. Run smartgrade-setup login.');
    }
    await this.ensureApp();
    return { Authorization: `Bearer ${this.session.userToken}`, 'X-APP-TOKEN': `Bearer ${this.app!.token}` };
  }

  private async ensureApp(): Promise<void> {
    if (this.app && this.app.exp >= Date.now() / 1000 + 3600) return;
    if (!this.renewal) {
      this.renewal = this.renewApp().finally(() => { this.renewal = undefined; });
    }
    await this.renewal;
  }

  private async renewApp(): Promise<void> {
    const credentials = this.options.credentials;
    if (!credentials) throw new CloudError('AUTH', 'App token expired. Configure the private bootstrap file and log in again.');
    const username = nonempty(credentials.username), password = nonempty(credentials.password);
    if (username.includes(':')) throw new CloudError('INPUT', 'Invalid application username.');
    const response = object(await this.raw('apps/token', 'GET', undefined, {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    }));
    const app = { token: nonempty(response.token), exp: expiry(response.exp) };
    if (app.exp < Date.now() / 1000 + 3600) return invalidResponse();
    if (this.session) {
      const next = { ...this.session, appToken: app.token, appExpiresAt: app.exp };
      await this.options.saveSession?.(next);
      this.session = next;
    }
    this.app = app;
  }

  async requestLoginCode(mobile: string): Promise<void> {
    if (!/^\+?[0-9]{7,15}$/.test(mobile)) throw new CloudError('INPUT', 'Enter the phone number used in SmartGrade Secure.');
    this.loginRequested = false;
    await this.ensureApp();
    const response = object(await this.raw('customers', 'POST', { customer: { mobile } }, { 'X-APP-TOKEN': `Bearer ${this.app!.token}` }));
    if (response.success !== true) throw new CloudError('AUTH', 'The cloud did not accept the login request.');
    this.loginRequested = true;
  }

  async verifyLoginCode(code: string): Promise<Session> {
    if (!this.loginRequested || !/^[0-9]{4,8}$/.test(code)) throw new CloudError('AUTH', 'Request and enter a valid verification code first.');
    const response = object(await this.raw('users/login/code', 'POST', { user: { code } }, { 'X-APP-TOKEN': `Bearer ${this.app!.token}` }));
    const userToken = nonempty(response.jwt), userId = nonempty(object(response.user).id);
    const next: Session = {
      userToken, userId, userExpiresAt: jwtExpiry(userToken), appToken: this.app!.token, appExpiresAt: this.app!.exp,
    };
    if (next.userExpiresAt < Date.now() / 1000 + 3600) throw new CloudError('AUTH', 'The cloud returned an expired user session.');
    const profile = object(await this.raw('users/profile', 'GET', undefined, {
      Authorization: `Bearer ${userToken}`, 'X-APP-TOKEN': `Bearer ${this.app!.token}`,
    }));
    if (nonempty(profile.id) !== userId) return invalidResponse();
    await this.options.saveSession?.(next);
    this.session = next;
    this.loginRequested = false;
    return { ...next };
  }

  close(): void {
    this.closed = true;
    for (const controller of this.pending) controller.abort();
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const headers = await this.userHeaders();
    try { return await this.raw(path, method, body, headers); }
    catch (error) {
      if (error instanceof CloudError && error.status === 401) this.revokedToken = headers.Authorization!.slice(7);
      throw error;
    }
  }

  private async raw(path: string, method: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
    if (this.closed) throw new CloudError('CLOSED', 'Cloud client is stopped.');
    const controller = new AbortController();
    this.pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    try {
      const response = await this.transport(`https://api.iotechv.com/api/v1/${path}`, {
        method, redirect: 'error', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new CloudError('HTTP', `Cloud request failed (HTTP ${response.status}).`, response.status);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof CloudError) throw error;
      throw new CloudError('NETWORK', 'Cloud request failed or timed out.');
    } finally {
      clearTimeout(timeout);
      this.pending.delete(controller);
    }
  }

  async getProfile(): Promise<{ id: string }> {
    const id = nonempty(object(await this.request('users/profile')).id);
    if (id !== this.session?.userId) return invalidResponse();
    return { id };
  }

  async listDevices(): Promise<Device[]> {
    const user = await this.getProfile();
    const sites = arrayField(await this.request(`users/${encodeURIComponent(user.id)}/sites?shared=true`), 'sites');
    const devices = new Map<string, Device>();
    const visited = new Set<string>();
    for (const site of sites) {
      const id = nonempty(object(site).id);
      if (visited.has(id)) continue;
      visited.add(id);
      const rows = arrayField(await this.request(`sites/${encodeURIComponent(id)}/devices`), 'devices');
      for (const row of rows) {
        const device = parseDevice(row);
        if (device.siteId !== id) return invalidResponse();
        devices.set(device.id, device);
      }
    }
    return [...devices.values()];
  }

  async getDevice(siteId: string, deviceId: string): Promise<Device> {
    const response = await this.request(`sites/${encodeURIComponent(nonempty(siteId))}/devices/${encodeURIComponent(nonempty(deviceId))}`);
    const device = parseDevice(object(response).device);
    if (device.id !== deviceId || device.siteId !== siteId) return invalidResponse();
    return device;
  }

  async setPower(deviceId: string, on: boolean): Promise<Device> {
    if (typeof on !== 'boolean') throw new CloudError('INPUT', 'Power state must be a boolean.');
    const device = parseDevice(await this.request(`devices/${encodeURIComponent(nonempty(deviceId))}/power`, 'POST', { power_on: on }));
    if (device.id !== deviceId) return invalidResponse();
    return device;
  }
}

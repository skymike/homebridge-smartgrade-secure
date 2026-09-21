import { readFile, mkdir } from 'node:fs/promises';
import { join, isAbsolute, dirname } from 'node:path';
import { SmartGradeClient } from './client.js';
import type { ClientOptions } from './client.js';
import { CloudError, supported } from './protocol.js';
import { loadBootstrap, loadSession, saveSession } from './session.js';

type LoginClient = Pick<SmartGradeClient, 'requestLoginCode' | 'verifyLoginCode' | 'listDevices' | 'close'>;
export class SetupController {
  private pending?: { client: LoginClient; sessionFile: string; expires: number };
  private nextSms = 0;
  private busy = false;
  constructor(private storage: string, private configPath: string,
    private factory: (options: ClientOptions) => LoginClient = options => new SmartGradeClient(options)) {}

  private async paths(): Promise<{ sessionFile: string; bootstrapFile: string }> {
    const config = JSON.parse(await readFile(this.configPath, 'utf8'));
    const platform = config.platforms?.find((p: { platform?: string }) => p.platform === 'SmartGradeSecure') ?? {};
    const directory = join(this.storage, 'smartgrade-private');
    const sessionFile = platform.sessionFile ?? join(directory, 'session.json');
    const bootstrapFile = platform.bootstrapFile ?? join(directory, 'bootstrap.json');
    if (typeof sessionFile !== 'string' || !isAbsolute(sessionFile) || typeof bootstrapFile !== 'string' || !isAbsolute(bootstrapFile)) {
      throw new CloudError('CONFIG', 'Private file paths must be absolute.');
    }
    return { sessionFile, bootstrapFile };
  }

  async status() {
    const paths = await this.paths();
    let bootstrapReady = false, loggedIn = false;
    try { await loadBootstrap(paths.bootstrapFile); bootstrapReady = true; } catch { /* report availability only */ }
    try { loggedIn = (await loadSession(paths.sessionFile)).userExpiresAt > Date.now() / 1000 + 3600; } catch { /* no session */ }
    return { ...paths, bootstrapReady, loggedIn };
  }

  async requestCode(phone: unknown) {
    if (this.busy || Date.now() < this.nextSms) throw new CloudError('WAIT', 'Wait 60 seconds before requesting another SMS.');
    if (typeof phone !== 'string' || !/^\+?[0-9]{7,15}$/.test(phone)) throw new CloudError('INPUT', 'Enter your SmartGrade phone number.');
    this.busy = true;
    let client: LoginClient | undefined;
    try {
      const paths = await this.paths();
      const credentials = await loadBootstrap(paths.bootstrapFile);
      this.close();
      client = this.factory({ credentials });
      this.nextSms = Date.now() + 60_000;
      await client.requestLoginCode(phone);
      this.pending = { client, sessionFile: paths.sessionFile, expires: Date.now() + 10 * 60_000 };
      return { sent: true };
    } catch (error) { client?.close(); throw error; }
    finally { this.busy = false; }
  }

  async verify(code: unknown) {
    if (this.busy || !this.pending || Date.now() > this.pending.expires) throw new CloudError('AUTH', 'Request an SMS code first.');
    if (typeof code !== 'string' || !/^[0-9]{4,8}$/.test(code)) throw new CloudError('INPUT', 'Enter the verification code.');
    this.busy = true;
    try {
      const session = await this.pending.client.verifyLoginCode(code);
      await mkdir(dirname(this.pending.sessionFile), { recursive: true, mode: 0o700 });
      await saveSession(this.pending.sessionFile, session);
      this.close();
      return { loggedIn: true };
    } finally { this.busy = false; }
  }

  async discover() {
    const paths = await this.paths();
    const client = this.factory({ session: await loadSession(paths.sessionFile),
      credentials: await loadBootstrap(paths.bootstrapFile), saveSession: s => saveSession(paths.sessionFile, s) });
    try {
      return (await client.listDevices()).map(d => ({ id: d.id, name: d.name, online: d.online, on: d.on, supported: supported(d) }));
    } finally { client.close(); }
  }
  close() { this.pending?.client.close(); this.pending = undefined; }
}

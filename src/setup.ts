#!/usr/bin/env node
import { resolve } from 'node:path';
import { SmartGradeClient } from './client.js';
import { CloudError, supported } from './protocol.js';
import { extractBootstrap, loadBootstrap, loadSession, saveSession } from './session.js';
import { secretPrompt } from './prompt.js';

const help = `SmartGrade Secure setup (no device commands)
  smartgrade-setup extract-bootstrap --from <BuildConfig.java> --out <private-bootstrap.json>
  smartgrade-setup login --session <private-session.json> --bootstrap <private-bootstrap.json>
  smartgrade-setup list --session <private-session.json> [--bootstrap <private-bootstrap.json>]

Existing parent directories must be private to your user/Homebridge account.
Instead of --bootstrap, set SMARTGRADE_APP_USERNAME and SMARTGRADE_APP_PASSWORD.
Phone and verification code are requested interactively and are not echoed.
`;

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (!args.length || args[0] === '--help') { process.stdout.write(help); return; }
  const command = args[0];
  if (!['login', 'list', 'extract-bootstrap'].includes(command!)) throw new CloudError('INPUT', 'Unknown setup command. Use --help.');
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!key || !value || value.startsWith('--') || !['--session', '--bootstrap', '--from', '--out'].includes(key) || values.has(key)) {
      throw new CloudError('INPUT', 'Invalid setup arguments. Use --help.');
    }
    values.set(key, value);
  }
  const path = (key: string) => {
    const value = values.get(key);
    if (!value) throw new CloudError('INPUT', `Missing ${key}. Use --help.`);
    return resolve(value);
  };
  if (command === 'extract-bootstrap') {
    await extractBootstrap(path('--from'), path('--out'));
    process.stdout.write('Private bootstrap file saved. Values were not printed.\n');
    return;
  }
  const sessionPath = path('--session');
  const credentials = values.has('--bootstrap') ? await loadBootstrap(path('--bootstrap')) :
    process.env.SMARTGRADE_APP_USERNAME && process.env.SMARTGRADE_APP_PASSWORD ?
      { username: process.env.SMARTGRADE_APP_USERNAME, password: process.env.SMARTGRADE_APP_PASSWORD } : undefined;
  const client = new SmartGradeClient({
    credentials,
    loadSession: command === 'list' ? () => loadSession(sessionPath) : undefined,
    saveSession: value => saveSession(sessionPath, value),
  });
  try {
    if (command === 'login') {
      if (!credentials) throw new CloudError('INPUT', 'Provide the private bootstrap file or application credential environment variables.');
      const mobile = (await secretPrompt('SmartGrade phone number (hidden): ')).trim();
      await client.requestLoginCode(mobile);
      const code = (await secretPrompt('Verification code (hidden): ')).trim();
      await client.verifyLoginCode(code);
      process.stdout.write('Login verified and session saved. No device commands were sent.\n');
    }
    const devices = await client.listDevices();
    process.stdout.write(JSON.stringify(devices.map(device => ({
      id: device.id, name: device.name, productId: device.productId,
      supported: supported(device), online: device.online, on: device.on,
    })), null, 2) + '\n');
  } finally { client.close(); }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error instanceof CloudError ? error.message : 'Setup failed. Check the local file paths and permissions.'}\n`);
    process.exitCode = 1;
  });
}

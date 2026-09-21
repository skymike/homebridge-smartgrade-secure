import { readFile } from 'node:fs/promises';
export const rawDevice = JSON.parse(await readFile(new URL('./fixtures/device.json', import.meta.url)));
export const session = () => ({ appToken: 'fixture-app', appExpiresAt: 4102444800, userToken: 'fixture-user', userId: 'user-1', userExpiresAt: 4102444800 });
export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
export const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

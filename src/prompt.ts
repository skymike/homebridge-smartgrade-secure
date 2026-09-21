import { emitKeypressEvents } from 'node:readline';
import type { ReadStream } from 'node:tty';
import type { Writable } from 'node:stream';
import { CloudError } from './protocol.js';

export function secretPrompt(label: string, input: ReadStream = process.stdin, output: Writable = process.stdout): Promise<string> {
  if (!input.isTTY || !input.setRawMode) return Promise.reject(new CloudError('INPUT', 'Login requires an interactive terminal.'));
  output.write(label);
  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (cancelled: boolean) => {
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.removeListener('error', onEnd);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write('\n');
      if (cancelled) reject(new CloudError('INPUT', 'Login cancelled.'));
      else resolve(value);
      value = '';
    };
    const onEnd = () => done(true);
    const onKey = (text: string, key: { name?: string; ctrl?: boolean; meta?: boolean } = {}) => {
      if ((key.ctrl && (key.name === 'c' || key.name === 'd')) || key.name === 'escape') return done(true);
      if (key.name === 'return' || key.name === 'enter') return done(false);
      if (key.name === 'backspace') value = value.slice(0, -1);
      else if (!key.ctrl && !key.meta && text && /^[\x20-\x7e]+$/.test(text) && value.length + text.length <= 128) value += text;
    };
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onEnd);
  });
}

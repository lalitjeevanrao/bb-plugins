import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { VERSION } from '@earendil-works/pi-coding-agent';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeCollector } from './initialize.mjs';

export default function extension(pi: unknown) {
  if (!/^thr_[a-zA-Z0-9_-]{1,100}$/.test(process.env.BB_THREAD_ID ?? '')) return;
  initializeCollector(pi, { builtinProviders, version: VERSION, directory: join(homedir(), '.pi', 'agent', 'copilot-session-credits'), statusDirectory: join(homedir(), '.pi', 'agent', 'copilot-session-credits-status') });
}

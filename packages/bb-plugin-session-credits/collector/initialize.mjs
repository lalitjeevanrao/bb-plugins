import { createProbe } from './probe.mjs';
import { createReadiness } from './readiness.mjs';

export function initializeCollector(pi, { builtinProviders, version, directory, statusDirectory }) {
  const readiness = createReadiness(statusDirectory, version);
  let failure = 'Collector initialization failed. Check Pi diagnostics and private receipt-folder permissions.';
  try {
    pi.on('session_start', (_event, ctx) => readiness.start(ctx));
    pi.on('session_shutdown', () => readiness.stop());
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version ?? '');
    if (!match || Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 5)) {
      readiness.update('unsupported');
      failure = 'Pi 1.5.0+ is required for Copilot credit capture. Use the same authenticated Pi runtime as BB.';
      throw Error(failure);
    }
    const provider = builtinProviders().find(provider => provider.id === 'github-copilot');
    createProbe({ provider, directory, autoStart: true, onStatus: state => readiness.update(state) })(pi);
  } catch {
    if (!failure.startsWith('Pi 1.5.0')) readiness.update('error');
    process.stderr.write(`Copilot session credits: ${failure}\n`);
    try { pi.on('session_start', (_event, ctx) => { readiness.start(ctx); ctx.ui.notify(failure, 'warning'); }); } catch {}
    try { pi.registerCommand('copilot-probe', { description: 'Show collector setup failure (no model call)', handler: async (_args, ctx) => ctx.ui.notify(failure, 'warning') }); } catch {}
  }
}

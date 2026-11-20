// Process identity used to prove that the process behind a receipt, lock or status marker has exited.
// Only SHA-256 digests are stored. Without a full identity nothing is ever judged dead.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readlinkSync } from 'node:fs';

const HEX = /^[a-f0-9]{64}$/;
const digest = (domain, value) => createHash('sha256').update(domain + '\0' + value).digest('hex');
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });

function probeIdentity() {
  try {
    let machine, boot, pidns;
    if (process.platform === 'darwin') {
      machine = /"IOPlatformUUID" = "([0-9A-Fa-f-]{36})"/.exec(run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']))?.[1];
      boot = run('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']).trim();
      pidns = 'darwin';
    } else if (process.platform === 'linux') {
      for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { machine = readFileSync(path, 'utf8').trim(); if (machine) break; } catch {} }
      boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      pidns = readlinkSync('/proc/self/ns/pid');
    }
    if (!/^[0-9A-Za-z-]{16,64}$/.test(machine ?? '') || !/^[0-9A-Za-z-]{16,64}$/.test(boot ?? '') || !pidns) return null;
    return { machine: digest('pi-machine-v1', machine.toLowerCase()), boot: digest('pi-boot-v1', boot.toLowerCase()), pidns: digest('pi-pidns-v1', pidns) };
  } catch { return null; }
}

let cached;
/** This process's identity `{ pid, machine, boot, pidns }`, or null when the platform cannot prove one. */
export function processIdentity() {
  if (cached === undefined) cached = probeIdentity();
  return cached && { pid: process.pid, ...cached };
}

export const validIdentity = value => value !== null && typeof value === 'object' && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 2147483647 && HEX.test(value.machine ?? '') && HEX.test(value.boot ?? '') && HEX.test(value.pidns ?? '');

/**
 * True only when `writer` provably no longer runs: same machine, and either an earlier boot, or the same boot and
 * PID namespace with no such process. Anything else (other machine, other namespace, EPERM, PID reuse) is alive.
 */
export function writerExited(writer, self = processIdentity(), alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }) {
  if (!validIdentity(writer) || !validIdentity(self) || writer.machine !== self.machine) return false;
  if (writer.boot !== self.boot) return true;
  if (writer.pidns !== self.pidns || writer.pid === self.pid) return false;
  return !alive(writer.pid);
}

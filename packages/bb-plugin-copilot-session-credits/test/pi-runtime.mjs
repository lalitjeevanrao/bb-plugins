import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
export function piRuntime() {
  let root = process.env.PI_PACKAGE_DIR;
  if (!root) {
    root = dirname(realpathSync(execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()));
    while (root !== dirname(root)) {
      if (existsSync(join(root, 'package.json')) && JSON.parse(readFileSync(join(root, 'package.json'))).name === '@earendil-works/pi-coding-agent') break;
      root = dirname(root);
    }
  }
  root = realpathSync(root);
  return { root, version: JSON.parse(readFileSync(join(root, 'package.json'))).version };
}

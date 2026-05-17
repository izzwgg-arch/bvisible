import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let loaded = false;

/**
 * Load ~/.bvisible-smoke.env into process.env (only keys not already set).
 * Never logs file contents or password values.
 */
export function loadSmokeEnvFromFile(): void {
  if (loaded) return;
  loaded = true;

  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return;

  const file = join(home, '.bvisible-smoke.env');
  if (!existsSync(file)) return;

  const content = readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

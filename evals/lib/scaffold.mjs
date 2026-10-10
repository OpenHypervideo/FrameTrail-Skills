/*
 * The scaffold of every case: builds the case's setup (expect.json → setup) in the current folder, which is the run's workspace. Each case's scaffold.sh calls it with the case's folder name:
 *
 *     node "$(dirname "$0")/../lib/scaffold.mjs" "$(basename "$(dirname "$0")")"
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './setups.mjs';

const EVALS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name) || !fs.existsSync(path.join(EVALS, name, 'expect.json'))) {
    console.error('Usage: node scaffold.mjs <case folder>; no case "' + name + '" in ' + EVALS);
    process.exit(2);
}

try {
    build(JSON.parse(fs.readFileSync(path.join(EVALS, name, 'expect.json'), 'utf8')).setup, process.cwd());
} catch (e) {
    console.error(e.message);
    process.exit(1);
}

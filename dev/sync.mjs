/*
 * Copies what the plugin uses of FrameTrail from a FrameTrail working copy into this repository, and writes vendor.lock.json. Nothing it writes is edited by hand: change FrameTrail, then sync again.
 *
 *     node dev/sync.mjs --frametrail=<FrameTrail working copy, at a tag or commit>
 *     node dev/sync.mjs --frametrail=<dir> --check      # write nothing; exit 1 when something would change
 *     node dev/sync.mjs --frametrail=<dir> --allow-dirty
 *
 * Without --frametrail: FRAMETRAIL_DIR, else ../frametrail. The working copy must be clean where the files come from (--allow-dirty marks the version "-dirty" in the lock instead).
 *
 * What is copied (VENDORED below), keeping FrameTrail's relative layout where the scripts require each other:
 *
 * - src/_shared/frametrail-core/serialization/*.js, schema/*.js → plugin/vendor/frametrail/, with LICENSE.md, THIRD-PARTY-NOTICES.md and a package.json that makes Node read the scripts as CommonJS and names the FrameTrail release they are based on (frametrailRelease: the latest tag at the commit, without its "v"; the library a new project file loads from jsDelivr);
 * - docs/DATA-MODEL.md, HTML-FORMAT.md, TYPES.md → plugin/skills/frametrail-hypervideo/references/frametrail/, links to each other kept, links to the rest of FrameTrail pointed at its repository;
 * - tests/fixtures/data/<name>/ → tests/fixtures/frametrail/<name>/;
 * - tests/fixtures/lint/data/*.json (data sets as bundles: the lecture, a project, legacy forms) → tests/fixtures/frametrail-bundles/, which the evaluation's workspaces are made from.
 *
 * Each target folder belongs to the sync: files there that FrameTrail no longer has are removed. vendor.lock.json records FrameTrail's version (git describe) and commit, and the SHA-256 of every file written; tests/run.mjs checks the files against it.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LOCK = path.join(ROOT, 'vendor.lock.json');

const REPOSITORY = 'https://github.com/OpenHypervideo/FrameTrail';

// The scripts, as FrameTrail has them below src/_shared/frametrail-core/.
const SCRIPTS = [
    'serialization/FrameTrailKeyframes.js',
    'serialization/FrameTrailSerializer.js',
    'serialization/FrameTrailHTMLFormat.js',
    'serialization/FrameTrailLint.js',
    'schema/FrameTrailSchema.js',
    'schema/FrameTrailSchemas.js'
];

const DOCS     = ['docs/DATA-MODEL.md', 'docs/HTML-FORMAT.md', 'docs/TYPES.md'];
const NOTICES  = ['LICENSE.md', 'THIRD-PARTY-NOTICES.md'];
const FIXTURES = 'tests/fixtures/data';
const BUNDLES  = 'tests/fixtures/lint/data';

// The folders the sync owns, relative to this repository.
export const VENDORED = {
    scripts:  'plugin/vendor/frametrail',
    docs:     'plugin/skills/frametrail-hypervideo/references/frametrail',
    fixtures: 'tests/fixtures/frametrail',
    bundles:  'tests/fixtures/frametrail-bundles'
};

/**
 * The package.json of the vendored scripts: CommonJS, and the release they are based on (left out when there is none).
 */
export function packageJSON(release) {
    return JSON.stringify(Object.assign({ type: 'commonjs' }, release ? { frametrailRelease: release } : {}), null, 4) + '\n';
}

/**
 * The release a tag names, as jsDelivr and npm name it ("v1.4.1" → "1.4.1"), or null for a tag that names none.
 */
export function releaseOf(tag) {
    const m = /^v?(\d+\.\d+\.\d+\S*)$/.exec(String(tag || '').trim());
    return m ? m[1] : null;
}


/* ---------------------------------------------------------------------- */

export const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');

// Every file below dir (relative paths, '/'), leaving out names that start with a dot.
export function filesBelow(dir, rel = '') {
    if (!fs.existsSync(path.join(dir, rel))) { return []; }
    return fs.readdirSync(path.join(dir, rel)).sort().flatMap((name) => {
        if (name.startsWith('.')) { return []; }
        const file = rel ? rel + '/' + name : name;
        return fs.statSync(path.join(dir, file)).isDirectory() ? filesBelow(dir, file) : [file];
    });
}

/**
 * Links in a vendored doc: one to another vendored doc stays relative (they are siblings here), one to anything else in FrameTrail points to its repository. Absolute links and anchors stay as they are.
 */
export function rewriteLinks(text, docPath) {
    return text.replace(/\]\(([^)\s]+)\)/g, (all, target) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) { return all; }
        const hash     = target.indexOf('#'),
              file     = (hash >= 0) ? target.slice(0, hash) : target,
              anchor   = (hash >= 0) ? target.slice(hash) : '',
              resolved = path.posix.normalize(path.posix.join(path.posix.dirname(docPath), file));
        if (DOCS.includes(resolved)) { return '](' + path.posix.basename(resolved) + anchor + ')'; }
        return '](' + REPOSITORY + (file.endsWith('/') ? '/tree/main/' : '/blob/main/') + resolved.replace(/\/$/, '') + (file.endsWith('/') ? '/' : '') + anchor + ')';
    });
}

function git(dir, ...args) {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * What the sync writes for a FrameTrail working copy: { files: { path: Buffer }, frametrail: { version, commit } }.
 */
export function vendoredFiles(frametrail, { allowDirty = false } = {}) {

    const core = 'src/_shared/frametrail-core/';

    for (const file of SCRIPTS.map((script) => core + script).concat(DOCS, NOTICES)) {
        if (!fs.existsSync(path.join(frametrail, file))) {
            throw new Error('Not a FrameTrail working copy with ' + file + ': ' + frametrail);
        }
    }

    let commit, version, release;
    try {
        commit  = git(frametrail, 'rev-parse', 'HEAD');
        version = (() => { try { return git(frametrail, 'describe', '--tags'); } catch (e) { return commit.slice(0, 7); } })();
        release = (() => { try { return releaseOf(git(frametrail, 'describe', '--tags', '--abbrev=0')); } catch (e) { return null; } })();
    } catch (e) {
        throw new Error('Not a git working copy: ' + frametrail);
    }

    const sources = [core + 'serialization', core + 'schema'].concat(DOCS, NOTICES, [FIXTURES, BUNDLES]),
          dirty   = git(frametrail, 'status', '--porcelain', '--', ...sources);
    if (dirty) {
        if (!allowDirty) { throw new Error('The FrameTrail working copy has changes where the files come from (--allow-dirty to sync anyway):\n' + dirty); }
        version += '-dirty';
    }

    const files = {},
          read  = (file) => fs.readFileSync(path.join(frametrail, file));

    for (const script of SCRIPTS) { files[VENDORED.scripts + '/' + script] = read(core + script); }
    for (const notice of NOTICES) { files[VENDORED.scripts + '/' + notice] = read(notice); }
    files[VENDORED.scripts + '/package.json'] = Buffer.from(packageJSON(release));

    for (const doc of DOCS) {
        files[VENDORED.docs + '/' + path.posix.basename(doc)] = Buffer.from(rewriteLinks(read(doc).toString('utf8'), doc));
    }

    for (const file of filesBelow(path.join(frametrail, FIXTURES))) {
        files[VENDORED.fixtures + '/' + file] = read(FIXTURES + '/' + file);
    }
    for (const file of filesBelow(path.join(frametrail, BUNDLES)).filter((file) => file.endsWith('.json'))) {
        files[VENDORED.bundles + '/' + file] = read(BUNDLES + '/' + file);
    }

    return { files, frametrail: { version, commit } };

}

// The files there are now in the vendored folders, by path.
export function presentFiles() {
    const present = {};
    for (const dir of Object.values(VENDORED)) {
        for (const file of filesBelow(path.join(ROOT, dir))) { present[dir + '/' + file] = fs.readFileSync(path.join(ROOT, dir, file)); }
    }
    return present;
}

export function lockOf(vendored) {
    const files = {};
    for (const file of Object.keys(vendored.files).sort()) { files[file] = sha256(vendored.files[file]); }
    return JSON.stringify({ frametrail: vendored.frametrail, files }, null, 4) + '\n';
}

// { added, changed, removed }: how the vendored folders differ from what is wanted.
export function differences(wanted, present) {
    return {
        added:   Object.keys(wanted).filter((file) => !(file in present)).sort(),
        changed: Object.keys(wanted).filter((file) => file in present && sha256(present[file]) !== sha256(wanted[file])).sort(),
        removed: Object.keys(present).filter((file) => !(file in wanted)).sort()
    };
}


/* ---------------------------------------------------------------------- */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {

    const option     = (name) => { const arg = process.argv.find((a) => a.startsWith('--' + name + '=')); return arg ? arg.slice(name.length + 3) : undefined; },
          frametrail = path.resolve(ROOT, option('frametrail') || process.env.FRAMETRAIL_DIR || path.join('..', 'frametrail')),
          check      = process.argv.includes('--check');

    let vendored;
    try {
        vendored = vendoredFiles(frametrail, { allowDirty: process.argv.includes('--allow-dirty') });
    } catch (e) {
        console.error(e.message);
        process.exit(2);
    }

    const diff  = differences(vendored.files, presentFiles()),
          count = diff.added.length + diff.changed.length + diff.removed.length;

    console.log('FrameTrail ' + vendored.frametrail.version + ' (' + vendored.frametrail.commit + ') at ' + frametrail);
    for (const [label, list] of [['added', diff.added], ['changed', diff.changed], ['removed', diff.removed]]) {
        for (const file of list) { console.log('  ' + label.padEnd(8) + file); }
    }

    if (check) {
        console.log(count ? count + ' vendored file(s) differ from this FrameTrail.' : 'The vendored files are those of this FrameTrail.');
        process.exit(count ? 1 : 0);
    }

    for (const file of diff.removed) { fs.rmSync(path.join(ROOT, file)); }
    for (const file of diff.added.concat(diff.changed)) {
        fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
        fs.writeFileSync(path.join(ROOT, file), vendored.files[file]);
    }
    // Folders left empty by removals.
    for (const dir of Object.values(VENDORED)) {
        (function prune(rel) {
            const full = path.join(ROOT, rel);
            if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) { return; }
            for (const name of fs.readdirSync(full)) { prune(rel + '/' + name); }
            if (rel !== dir && fs.readdirSync(full).length === 0) { fs.rmdirSync(full); }
        })(dir);
    }
    fs.writeFileSync(LOCK, lockOf(vendored));

    console.log(count ? 'Synced ' + count + ' file(s); wrote vendor.lock.json.' : 'Nothing changed; wrote vendor.lock.json.');

}

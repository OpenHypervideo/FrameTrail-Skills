/*
 * The repository's tests. No dependencies and no FrameTrail checkout, Node 20 or later:
 *
 *     node tests/run.mjs
 *     node tests/run.mjs --drift     # after syncing a newer FrameTrail (drift.yml): the README's version is not checked
 *
 * - The vendored files: exactly those of vendor.lock.json, unchanged; the scripts load under require() and work together on the vendored fixtures.
 * - The plugin: the marketplace and plugin manifests, what plugin/ holds, each skill's frontmatter, the hooks.
 * - The scripts: check.mjs by hand and as the hooks (run as Claude Code runs them, on copies of the vendored fixtures), user-id.mjs.
 * - The text written here for the model, tested against the vendored truth: JSON examples tagged with a schema validate, type names exist, the files it names exist (see CLAUDE.md, "Text").
 * - The evaluation (evals/, dev/eval.mjs) without running a model: the case folders, the workspaces, every check on scripted changes, the grading of kept runs.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { VENDORED, LOCK, sha256, filesBelow, presentFiles, rewriteLinks, packageJSON, releaseOf } from '../dev/sync.mjs';
import * as Check from '../plugin/scripts/check.mjs';
import { SETUPS, build as buildSetup } from '../evals/lib/setups.mjs';
import { CHECKS, grade, readData } from '../evals/lib/checks.mjs';
import { finalMessage, keptRun, gradeResults, table } from '../dev/eval.mjs';

const require = createRequire(import.meta.url);
const ROOT    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN  = path.join(ROOT, 'plugin');
const DRIFT   = process.argv.includes('--drift');

const vendor     = (file) => require(path.join(ROOT, VENDORED.scripts, file));
const Serializer = vendor('serialization/FrameTrailSerializer.js');
const HTMLFormat = vendor('serialization/FrameTrailHTMLFormat.js');
const Lint       = vendor('serialization/FrameTrailLint.js');
const Schema     = vendor('schema/FrameTrailSchema.js');
const Schemas    = vendor('schema/FrameTrailSchemas.js');

const validator     = Schema.create(Schemas);
const lintValidator = Schema.create([Lint.RESULT_SCHEMA]);

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const errorList = (errors) => errors.map((e) => '    ' + (e.path || '(document)') + ': ' + e.message).join('\n');


/* ---------------------------------------------------------------------- */
/*  The vendored files                                                    */
/* ---------------------------------------------------------------------- */

describe('vendored FrameTrail', () => {

    const lock = readJSON(LOCK);

    test('vendor.lock.json names FrameTrail\'s version and commit, and every file in sorted order', () => {
        assert.equal(typeof lock.frametrail.version, 'string');
        assert.match(lock.frametrail.commit, /^[0-9a-f]{40}$/);
        const files = Object.keys(lock.files);
        assert.deepEqual(files, [...files].sort());
        for (const file of files) { assert.match(lock.files[file], /^[0-9a-f]{64}$/, file); }
    });

    test('the vendored folders hold exactly the locked files, unchanged (edit FrameTrail and sync, never the copies)', () => {
        const present  = presentFiles(),
              missing  = Object.keys(lock.files).filter((file) => !(file in present)),
              extra    = Object.keys(present).filter((file) => !(file in lock.files)),
              changed  = Object.keys(lock.files).filter((file) => file in present && sha256(present[file]) !== lock.files[file]);
        assert.deepEqual({ missing, extra, changed }, { missing: [], extra: [], changed: [] });
    });

    test('the scripts load under require(), as CommonJS whatever surrounds them; package.json names the release they are based on', () => {
        // The release is the latest tag at the vendored commit: v1.4.1-5-g64ebec8 → 1.4.1.
        const release = releaseOf(lock.frametrail.version.replace(/-dirty$/, '').replace(/-\d+-g[0-9a-f]+$/, ''));
        assert.deepEqual(readJSON(path.join(ROOT, VENDORED.scripts, 'package.json')), release ? { type: 'commonjs', frametrailRelease: release } : { type: 'commonjs' });
        assert.deepEqual([releaseOf('v1.4.1'), releaseOf('2.0.0-beta.1'), releaseOf('nightly'), releaseOf('')], ['1.4.1', '2.0.0-beta.1', null, null]);
        assert.deepEqual(JSON.parse(packageJSON(null)), { type: 'commonjs' });
        assert.equal(typeof Serializer.readBundle, 'function');
        assert.equal(typeof Lint.run, 'function');
        assert.equal(typeof HTMLFormat.readProject, 'function');
        assert.ok(Array.isArray(Schemas) && Schemas.length > 0);
        assert.ok(fs.existsSync(path.join(ROOT, VENDORED.scripts, 'LICENSE.md')) && fs.existsSync(path.join(ROOT, VENDORED.scripts, 'THIRD-PARTY-NOTICES.md')));
    });

    test('the docs link to each other, and to FrameTrail\'s repository for everything else', () => {
        const docs = filesBelow(path.join(ROOT, VENDORED.docs));
        assert.deepEqual(docs, ['DATA-MODEL.md', 'HTML-FORMAT.md', 'TYPES.md']);
        for (const doc of docs) {
            const text = fs.readFileSync(path.join(ROOT, VENDORED.docs, doc), 'utf8');
            for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
                if (/^https?:/.test(target) || target.startsWith('#')) { continue; }
                assert.ok(docs.includes(target.split('#')[0]), doc + ' links to ' + target);
            }
        }
        assert.equal(rewriteLinks('[a](EXTENDING.md#x) [b](../schemas/) [c](TYPES.md) [d](#here) [e](https://example.org)', 'docs/DATA-MODEL.md'),
            '[a](https://github.com/OpenHypervideo/FrameTrail/blob/main/docs/EXTENDING.md#x) [b](https://github.com/OpenHypervideo/FrameTrail/tree/main/schemas/) [c](TYPES.md) [d](#here) [e](https://example.org)');
    });

    test('TYPES.md describes every type the schemas know (except the legacy button)', () => {
        const text  = fs.readFileSync(path.join(ROOT, VENDORED.docs, 'TYPES.md'), 'utf8'),
              types = knownTypes().filter((type) => type !== 'button' && type !== 'codesnippet');
        assert.deepEqual(types.filter((type) => !text.includes('### `' + type + '`')), []);
    });

    for (const name of fs.readdirSync(path.join(ROOT, VENDORED.fixtures)).filter((entry) => !entry.startsWith('.')).sort()) {

        test('they work together on the fixture ' + name + ': schemas, folder check, bundles, lint, the HTML format', () => {

            const files = readFolder(path.join(ROOT, VENDORED.fixtures, name));

            for (const file of Object.keys(files).filter((file) => file.endsWith('.json'))) {
                const schema = Serializer.schemaOfFile(file);
                assert.ok(schema, file + ' has a schema');
                const errors = validator.validate(schema, files[file]);
                assert.ok(!errors.length, file + ':\n' + errorList(errors));
            }

            assert.deepEqual(Lint.checkFolder(files), []);

            const project = Serializer.readBundle(files, 'folder'),
                  errors  = validator.validate('project-bundle.schema.json', project);
            assert.ok(!errors.length, errorList(errors));

            for (const id of Object.keys(project.hypervideos)) {
                const result = Lint.run(Lint.partsOf(project, { hypervideoId: id }));
                assert.deepEqual(lintValidator.validate('lint-result.schema.json', result), [], 'hypervideo ' + id);
            }

            const page = HTMLFormat.writeProject(files, null, { library: { css: '', js: '' }, datapath: './' });
            assert.deepStrictEqual(HTMLFormat.parse(page)[0].bundle, HTMLFormat.projectBundle(files));
            assert.equal(HTMLFormat.firstBlockText(page).indexOf('<'), -1, 'no "<" in the data block');

        });

    }

});

// A _data folder as the serializer's folder format reads it: JSON parsed, subtitles and CSS as text.
function readFolder(dir) {
    const files = {};
    for (const file of filesBelow(dir)) {
        if (file.endsWith('.json')) { files[file] = readJSON(path.join(dir, file)); }
        else if (/\.(vtt|css)$/.test(file)) { files[file] = fs.readFileSync(path.join(dir, file), 'utf8'); }
    }
    return files;
}


/* ---------------------------------------------------------------------- */
/*  The plugin                                                            */
/* ---------------------------------------------------------------------- */

// What plugin/ may hold: what users install, no tests or development tools.
const PLUGIN_ENTRIES = ['.claude-plugin', 'hooks', 'scripts', 'skills', 'vendor'];

// The frontmatter of a SKILL.md: "key: value" lines between the --- lines.
function frontmatter(text) {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!m) { return null; }
    const fields = {};
    for (const line of m[1].split('\n')) {
        const kv = /^([a-z][a-z0-9_-]*):\s*(.*)$/.exec(line);
        if (kv) { fields[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, '$2'); }
    }
    return fields;
}

describe('the plugin', () => {

    const marketplace = readJSON(path.join(ROOT, '.claude-plugin', 'marketplace.json')),
          manifest    = readJSON(path.join(PLUGIN, '.claude-plugin', 'plugin.json'));

    test('the marketplace lists the plugin in plugin/, under the name of its manifest', () => {
        assert.equal(marketplace.name, 'frametrail-skills');
        assert.ok(marketplace.owner && marketplace.owner.name);
        assert.equal(marketplace.plugins.length, 1);
        const entry = marketplace.plugins[0];
        assert.equal(entry.source, './plugin');
        assert.equal(entry.name, manifest.name);
        assert.equal(entry.version, undefined, 'the version is plugin.json\'s');
    });

    test('the manifest has the metadata a listing shows', () => {
        assert.equal(manifest.name, 'frametrail');
        for (const key of ['version', 'description', 'repository', 'license']) { assert.ok(manifest[key], key); }
        assert.equal(manifest.license, 'MIT');
        assert.ok(manifest.author && manifest.author.name);
    });

    test('plugin/ holds only what users install', () => {
        assert.deepEqual(fs.readdirSync(PLUGIN).filter((name) => name !== '.DS_Store' && !PLUGIN_ENTRIES.includes(name)), []);
    });

    for (const skill of fs.readdirSync(path.join(PLUGIN, 'skills')).filter((name) => !name.startsWith('.'))) {
        test('skill ' + skill + ': frontmatter with its name and a description, under 500 lines', () => {
            const text   = fs.readFileSync(path.join(PLUGIN, 'skills', skill, 'SKILL.md'), 'utf8'),
                  fields = frontmatter(text);
            assert.ok(fields, 'SKILL.md starts with frontmatter');
            assert.equal(fields.name, skill);
            assert.ok(fields.description && fields.description.length <= 1536, 'a description of at most 1536 characters');
            assert.ok(text.split('\n').length < 500, 'under 500 lines');
        });
    }

});


/* ---------------------------------------------------------------------- */
/*  Text written for the model                                            */
/* ---------------------------------------------------------------------- */

// Every type an item's body can have: the attribute schemas, and the code snippet's.
function knownTypes() {
    const types = Schemas.map((schema) => /\/attributes\/([a-z]+)\.schema\.json$/.exec(schema.$id)).filter(Boolean).map((m) => m[1]);
    return [...new Set(types.concat(Object.keys(Serializer.RESOURCE_TYPES)))].sort();
}

/**
 * Problems with a Markdown text written for the model, as messages:
 *
 * - a fenced block tagged `json frametrail:<schema>` (a file in FrameTrail's schemas/ without ".schema.json", optionally with a fragment: frametrail:content-item, frametrail:common#/$defs/keyframe) that is no JSON or does not validate;
 * - a type named like `quiz` type, a `text` overlay, type `hotspot` that FrameTrail does not know;
 * - a file it names that does not exist: a relative Markdown link (from the text's folder), ${CLAUDE_PLUGIN_ROOT}/… (from plugin/), ${CLAUDE_SKILL_DIR}/… (from the skill's folder).
 */
function textProblems(text, { file, skillDir }) {

    const problems = [],
          types    = knownTypes(),
          lineOf   = (index) => text.slice(0, index).split('\n').length;

    // Fences may be indented (inside a list item).
    for (const m of text.matchAll(/^[ \t]*```json[ \t]+frametrail:(\S+)[ \t]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)) {
        const [name, fragment] = m[1].split('#'),
              schema = name + '.schema.json' + (fragment ? '#' + fragment : '');
        let data;
        try { data = JSON.parse(m[2]); } catch (e) { problems.push('line ' + lineOf(m.index) + ': the example is no JSON: ' + e.message); continue; }
        if (!validator.has(name + '.schema.json')) { problems.push('line ' + lineOf(m.index) + ': no schema ' + name + '.schema.json'); continue; }
        const errors = validator.validate(schema, data);
        if (errors.length) { problems.push('line ' + lineOf(m.index) + ': the example does not follow ' + schema + ':\n' + errorList(errors)); }
    }

    const named = [...text.matchAll(/`([a-z][a-z0-9]*)` (?:types?|overlays?|annotations?|items?|resources?)\b/g), ...text.matchAll(/\btypes? `([a-z][a-z0-9]*)`/g)];
    for (const m of named) {
        if (!types.includes(m[1])) { problems.push('line ' + lineOf(m.index) + ': no type `' + m[1] + '`'); }
    }

    const exists = (target) => fs.existsSync(target);
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1].split('#')[0];
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(m[1])) { continue; }
        if (!exists(path.resolve(path.dirname(file), target))) { problems.push('line ' + lineOf(m.index) + ': no file ' + target); }
    }
    for (const m of text.matchAll(/\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_SKILL_DIR)\}\/([^\s`'")\]]+)/g)) {
        const base   = (m[1] === 'CLAUDE_PLUGIN_ROOT') ? PLUGIN : skillDir,
              target = m[2].replace(/[.,;:]+$/, '');
        if (!exists(path.join(base, target))) { problems.push('line ' + lineOf(m.index) + ': no file ${' + m[1] + '}/' + target); }
    }

    return problems;

}

describe('text written for the model', () => {

    // The skills' Markdown files, without the vendored references.
    const texts = fs.readdirSync(path.join(PLUGIN, 'skills')).filter((name) => !name.startsWith('.')).flatMap((skill) => {
        const dir = path.join(PLUGIN, 'skills', skill);
        return filesBelow(dir).filter((file) => file.endsWith('.md'))
            .map((file) => ({ file: path.join(dir, file), skillDir: dir }))
            .filter(({ file }) => !file.startsWith(path.join(ROOT, VENDORED.docs) + path.sep));
    });

    for (const { file, skillDir } of texts) {
        test(path.relative(ROOT, file) + ': examples validate, types and files exist', () => {
            const problems = textProblems(fs.readFileSync(file, 'utf8'), { file, skillDir });
            assert.ok(!problems.length, problems.join('\n'));
        });
    }

    test('the data block\'s escape is written as it is: \\u003c, never lost to "<"', () => {
        const skill = path.join(PLUGIN, 'skills', 'frametrail-hypervideo');
        for (const file of ['SKILL.md', 'references/project-file.md', 'references/layout.md']) {
            const text = fs.readFileSync(path.join(skill, file), 'utf8');
            assert.ok(text.includes('`\\u003c`'), file + ' names \\u003c');
            assert.ok(!/written (as )?`<`/.test(text), file + ' says "<" is written as "<"');
        }
    });

    test('the checks find what they are meant to find', () => {
        const skillDir = path.join(PLUGIN, 'skills', 'frametrail-hypervideo'),
              file     = path.join(skillDir, 'SKILL.md'),
              item     = (type) => JSON.stringify({
                  type: 'Annotation', 'frametrail:type': 'Overlay', creator: { nickname: 'Ada', type: 'Person', id: '1' }, created: '2026-10-09T12:00:00.000Z',
                  target: { type: 'Video', selector: { type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value: 't=1,2&xywh=percent:10,10,20,20' } },
                  body: { 'frametrail:type': type, 'frametrail:attributes': {} }
              }, null, 4);
        const text = [
            'A `quiz` overlay, a `text` annotation, type `hotspot`, the `codesnippet` type: all known.',
            '```json frametrail:content-item', item('text'), '```',
            '```json frametrail:common#/$defs/keyframe', '{ "t": 2, "xywh": [0, 0, 10, 10] }', '```',
            '```json', '{ "untagged": "not checked" }', '```',
            '[TYPES.md](references/frametrail/TYPES.md#at-a-glance), ${CLAUDE_SKILL_DIR}/SKILL.md, ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json'
        ].join('\n');
        assert.deepEqual(textProblems(text, { file, skillDir }), []);
        const broken = [
            'A `slideshow` overlay and type `gif`.',
            '```json frametrail:content-item', item('triangle'), '```',
            '```json frametrail:content-item', '{ "type": ', '```',
            '```json frametrail:nothing', '{}', '```',
            '[missing](references/missing.md), ${CLAUDE_PLUGIN_ROOT}/scripts/missing.mjs',
            '1. In a list:', '', '   ```json frametrail:hypervideos-index', '   { "hypervideos": "none" }', '   ```'
        ].join('\n');
        const problems = textProblems(broken, { file, skillDir });
        assert.equal(problems.length, 8, problems.join('\n'));
        assert.match(problems.join('\n'), /does not follow hypervideos-index\.schema\.json/, 'an indented fence is checked too');
        assert.match(problems.join('\n'), /no type `slideshow`[\s\S]*no type `gif`/);
        assert.match(problems.join('\n'), /line 2: the example does not follow content-item\.schema\.json/);
        assert.match(problems.join('\n'), /: the example is no JSON/);
        assert.match(problems.join('\n'), /no schema nothing\.schema\.json/);
        assert.match(problems.join('\n'), /no file references\/missing\.md[\s\S]*no file \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/missing\.mjs/);
    });

});


/* ---------------------------------------------------------------------- */
/*  The scripts                                                           */
/* ---------------------------------------------------------------------- */

const CHECK     = path.join(PLUGIN, 'scripts', 'check.mjs');
const USER_ID   = path.join(PLUGIN, 'scripts', 'user-id.mjs');
const CREATE    = path.join(PLUGIN, 'scripts', 'create-project.mjs');
const ADD_MEDIA = path.join(PLUGIN, 'scripts', 'add-media.mjs');

// Whether FFmpeg's tools are installed (the helpers use them when they are; CI may not have them).
const HAS_FFMPEG = ['ffmpeg', 'ffprobe'].every((tool) => spawnSync(tool, ['-version'], { stdio: 'ignore' }).status === 0);

// A script run as Claude runs it through Bash: { code, stdout, stderr }.
function script(file, args, env) {
    const r = spawnSync(process.execPath, [file, ...args], { env: env || process.env, encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

// A JSON file's text changed by fn, written as FrameTrail writes it.
const editJSON = (fn) => (text) => { const value = JSON.parse(text); fn(value); return JSON.stringify(value, null, 4) + '\n'; };

/**
 * A temporary folder for copies of the vendored fixtures, with the scripts run on it as Claude Code runs the hooks: the hook's JSON on stdin, CLAUDE_PLUGIN_DATA a folder of its own.
 */
function scratch() {

    const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'frametrail-skills-')),
          env  = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: path.join(dir, 'plugin-data') });

    const self = {
        dir,
        sessions: path.join(dir, 'plugin-data', 'sessions'),
        // A copy of a fixture folder.
        folder(name, as = '_data') {
            const target = path.join(dir, as);
            fs.cpSync(path.join(ROOT, VENDORED.fixtures, name), target, { recursive: true });
            return target;
        },
        // A fixture folder as a project file.
        page(name, as = name + '.html') {
            const target = path.join(dir, as);
            fs.writeFileSync(target, HTMLFormat.writeProject(readFolder(path.join(ROOT, VENDORED.fixtures, name)), null, { library: { css: '', js: '' }, datapath: './' }));
            return target;
        },
        hook(kind, input = {}, session = 's') {
            const r = spawnSync(process.execPath, [CHECK, '--hook=' + kind], {
                input: JSON.stringify(Object.assign({ session_id: session, cwd: dir, hook_event_name: kind }, input)), env, encoding: 'utf8'
            });
            return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim(), json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
        },
        // A tool call that writes a file: pre, the change (text → text; null for a new file), post.
        change(file, fn, session = 's') {
            const input = { tool_name: 'Edit', tool_input: { file_path: file } },
                  pre   = self.hook('pre', input, session);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, fn(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null));
            return { pre, post: self.hook('post', input, session) };
        },
        stop(session = 's') { return self.hook('stop', { stop_hook_active: false }, session); },
        // The environment of a machine without ffprobe and ffmpeg: an empty PATH (the scripts run with Node's full path).
        noTools: Object.assign({}, process.env, { PATH: path.join(dir, 'no-tools') }),
        // A small video: two seconds of FFmpeg's test pattern, 160 × 120, when ffmpeg is there, else bytes with the name of one.
        video(name = 'clip.mp4') {
            const target = path.join(dir, name);
            if (!HAS_FFMPEG || spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10', '-pix_fmt', 'yuv420p', target]).status !== 0) {
                fs.writeFileSync(target, 'not really a video');
            }
            return target;
        },
        remove() { fs.rmSync(dir, { recursive: true, force: true }); }
    };

    return self;

}

// Runs a test body on a scratch folder and removes it afterwards.
const withScratch = (body) => async () => { const s = scratch(); try { return await body(s); } finally { s.remove(); } };

describe('the scripts', () => {

    test('check.mjs by hand: the fixtures have only lint findings, and a fixture as a project file has the same ones', withScratch((s) => {
        for (const name of fs.readdirSync(path.join(ROOT, VENDORED.fixtures)).filter((entry) => !entry.startsWith('.'))) {
            const folder = Check.problemsOf(Check.readState(path.join(ROOT, VENDORED.fixtures, name), 'folder')),
                  page   = Check.problemsOf(Check.readState(s.page(name), 'file'));
            assert.deepEqual(folder.filter((p) => !p.rule), [], name + ': ' + Check.formatProblems(folder.filter((p) => !p.rule)));
            assert.deepEqual(page.filter((p) => !p.rule), [], name + ' as a page: ' + Check.formatProblems(page.filter((p) => !p.rule)));
            assert.deepEqual(page.map((p) => p.key).sort(), folder.map((p) => p.key).sort(), name + ': the same lint findings');
        }
        const run = spawnSync(process.execPath, [CHECK, path.join(ROOT, VENDORED.fixtures, 'zoom-in-on-dna')], { encoding: 'utf8' });
        assert.equal(run.status, 0, 'warnings only: exit 0');
        assert.match(run.stdout, /\(_data folder\)\n[\s\S]*0 errors, 6 warnings\.$/m);
        const none = spawnSync(process.execPath, [CHECK, s.dir], { encoding: 'utf8' });
        assert.equal(none.status, 2);
        assert.match(none.stderr, /^Not FrameTrail data/);
    }));

    test('findRoot: a page with a data block, else the nearest _data folder; serverInstance: .collab or accounts', withScratch((s) => {
        const data = s.folder('all-types'), page = s.page('all-types');
        assert.deepEqual(Check.findRoot(path.join(data, 'hypervideos', '1', 'annotations', 'new.json')), { kind: 'folder', root: data });
        assert.deepEqual(Check.findRoot(data), { kind: 'folder', root: data });
        assert.deepEqual(Check.findRoot(page), { kind: 'file', root: page });
        fs.writeFileSync(path.join(s.dir, 'plain.html'), '<!DOCTYPE html><p>data-frametrail</p>');
        assert.equal(Check.findRoot(path.join(s.dir, 'plain.html')), null);
        assert.equal(Check.findRoot(path.join(s.dir, 'notes.md')), null);
        assert.equal(Check.serverInstance(data), null);
        fs.writeFileSync(path.join(data, 'users.json'), JSON.stringify({ 'user-increment': 1, user: { 1: { name: 'demo', passwd: 'x' } } }));
        assert.match(Check.serverInstance(data), /passwords/);
        fs.mkdirSync(path.join(data, '.collab'));
        assert.match(Check.serverInstance(data), /\.collab/);
    }));

    test('post, in a _data folder: the changed file\'s JSON and schema at once; nothing for valid changes and other files', withScratch((s) => {
        const data = s.folder('all-types'),
              file = path.join(data, 'hypervideos', '1', 'hypervideo.json');
        let { post } = s.change(file, editJSON((h) => { h.chapters.push({ start: '99', title: 'Late' }); }));
        assert.equal(post.code, 2);
        assert.match(post.stderr, /hypervideos\/1\/hypervideo\.json\n {2}error {2}\/chapters\/3\/start: must be number, is string/);
        ({ post } = s.change(file, (text) => text.replace('"title": "Late"', '"title": "Late",')));
        assert.equal(post.code, 2);
        const lines = fs.readFileSync(file, 'utf8').split('\n'), at = lines.findIndex((line) => line.includes('"title": "Late",'));
        assert.match(post.stderr, new RegExp('line ' + (at + 2) + ':\\d+: Is not valid JSON'));
        ({ post } = s.change(file, (text) => editJSON((h) => { h.chapters[3] = { start: 50, title: 'Late' }; })(text.replace('"title": "Late",', '"title": "Late"'))));
        assert.deepEqual([post.code, post.stdout, post.stderr], [0, '', '']);
        ({ post } = s.change(path.join(data, 'hypervideos', '1', 'subtitles', 'en.vtt'), (text) => text.replace('00:00:00.500 --> 00:00:04.000', '00:00:00,500 --> 00:00:04.000')));
        assert.equal(post.code, 2);
        assert.match(post.stderr, /line 4:1: The cue timing "00:00:00,500 --> 00:00:04\.000" is not/);
        for (const other of [path.join(s.dir, 'notes.md'), path.join(data, 'users.json'), path.join(data, 'custom.css')]) {
            ({ post } = s.change(other, () => '{ not json'));
            assert.deepEqual([post.code, post.stdout, post.stderr], [0, '', ''], other);
        }
    }));

    test('post, in a project file: the data block\'s JSON (where in the page), "<" written as FrameTrail writes it, the bundle\'s schema', withScratch((s) => {
        const page = s.page('all-types');
        let { post } = s.change(page, (html) => html.replace('"title": "Introduction"', '"title": "Introduction" oops'));
        assert.equal(post.code, 2);
        const html = fs.readFileSync(page, 'utf8'), index = html.indexOf(' oops') + 1,
              line = html.slice(0, index).split('\n').length, col = index - html.lastIndexOf('\n', index - 1);
        assert.match(post.stderr, new RegExp('line ' + line + ':' + col + ': The data block is not valid JSON'));
        assert.ok(!post.stderr.includes('</script'), 'the block ends where it should');

        ({ post } = s.change(page, (text) => text.replace('"title": "Introduction" oops', '"title": "<b>Introduction</b>"')));
        assert.equal(post.code, 0);
        assert.match(post.json.hookSpecificOutput.additionalContext, /^FrameTrail check: wrote the 2 "<" in the data block of all-types\.html as \\u003c, as FrameTrail writes them\. Read the lines again/);
        const escaped = fs.readFileSync(page, 'utf8');
        assert.ok(escaped.includes('"title": "\\u003cb>Introduction\\u003c/b>"'));
        assert.equal(HTMLFormat.firstBlockText(escaped).indexOf('<'), -1);
        assert.equal(HTMLFormat.parse(escaped)[0].bundle.hypervideos['1'].hypervideo.chapters[0].title, '<b>Introduction</b>');
        assert.equal(escaped.replace(HTMLFormat.firstBlockText(escaped), ''), html.replace(HTMLFormat.firstBlockText(html), ''), 'the rest of the page as it was');

        ({ post } = s.change(page, (text) => text.replace('"title": "\\u003cb>Introduction\\u003c/b>"', '"title": "</script><b>Intro</b>"')));
        assert.equal(post.code, 2);
        assert.match(post.stderr, /The data block is not valid JSON: .*The block may end early: a "<\/script" inside it ends it, so write that as <\\\/script\./);
        ({ post } = s.change(page, (text) => text.replace('"title": "</script><b>Intro</b>"', '"title": "Introduction"')));
        assert.equal(post.code, 0);

        // Changes made through Bash: the check by hand finds a "<", --escape rewrites it.
        fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('"title": "Introduction"', '"title": "<i>Introduction</i>"'));
        assert.match(Check.formatProblems(Check.problemsOf(Check.readState(page, 'file'))), /The data block contains "<" \(2 in all\)\. FrameTrail writes every "<" in it as \\u003c/);
        const run = spawnSync(process.execPath, [CHECK, '--escape', page], { encoding: 'utf8' });
        assert.deepEqual([run.status, run.stdout.trim()], [0, 'Wrote the 2 "<" in the data block of ' + page + ' as \\u003c.']);
        assert.equal(HTMLFormat.firstBlockText(fs.readFileSync(page, 'utf8')).indexOf('<'), -1);

        ({ post } = s.change(page, (text) => {
            const bundle = HTMLFormat.parse(text)[0].bundle;
            bundle.hypervideos['1'].hypervideo.chapters[0] = { start: 'x', title: 'Introduction' };
            return HTMLFormat.replaceBlock(text, bundle);
        }));
        assert.equal(post.code, 2);
        assert.match(post.stderr, /\/hypervideos\/1\/hypervideo\/chapters\/0\/start: must be number, is string/);
        ({ post } = s.change(page, (text) => text.replace(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/, '')));
        assert.equal(post.code, 2);
        assert.match(post.stderr, /Has no FrameTrail data block/);
    }));

    test('pre: a server\'s data folder is put to the user; the baseline is taken once, also by tool calls in parallel', withScratch(async (s) => {
        const data = s.folder('all-types'),
              file = path.join(data, 'config.json'),
              edit = { tool_name: 'Edit', tool_input: { file_path: file } };
        assert.deepEqual(s.hook('pre', edit), { code: 0, stdout: '', stderr: '', json: null });
        const [record] = fs.readdirSync(path.join(s.sessions, 's'));
        const baseline = readJSON(path.join(s.sessions, 's', record)).baseline;
        assert.equal(baseline.texts['config.json'], fs.readFileSync(file, 'utf8'));
        assert.ok(!('users.json' in baseline.texts) && !Object.keys(baseline.texts).some((rel) => rel.startsWith('resources/') && rel !== 'resources/_index.json'));
        fs.writeFileSync(file, '{}');
        s.hook('pre', edit);
        assert.equal(readJSON(path.join(s.sessions, 's', record)).baseline.texts['config.json'], baseline.texts['config.json'], 'kept from the first touch');

        const env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: path.join(s.dir, 'plugin-data') }),
              once = () => new Promise((resolve) => {
                  const child = spawn(process.execPath, [CHECK, '--hook=pre'], { env });
                  child.on('close', resolve);
                  child.stdin.end(JSON.stringify({ session_id: 'parallel', cwd: s.dir, tool_name: 'Edit', tool_input: { file_path: file } }));
              });
        assert.deepEqual(await Promise.all([once(), once(), once(), once()]), [0, 0, 0, 0]);
        assert.deepEqual(fs.readdirSync(path.join(s.sessions, 'parallel')), [record], 'one record, no lock left');

        fs.mkdirSync(path.join(data, '.collab'));
        const ask = s.hook('pre', edit);
        assert.equal(ask.json.hookSpecificOutput.hookEventName, 'PreToolUse');
        assert.equal(ask.json.hookSpecificOutput.permissionDecision, 'ask');
        assert.match(ask.json.hookSpecificOutput.permissionDecisionReason, /^_data is the data folder of a FrameTrail server \(it has a \.collab folder\)/);
    }));

    test('stop: new errors block, once; what the baseline had is left out; an annotation file needs its index entry', withScratch((s) => {
        const data  = s.folder('all-types'),
              dir   = path.join(data, 'hypervideos', '1', 'annotations'),
              id    = Serializer.guestUserID('Ada'),
              guest = path.join(dir, id + '.json');
        assert.deepEqual(s.stop(), { code: 0, stdout: '', stderr: '', json: null }, 'nothing recorded');
        s.change(guest, () => JSON.stringify(readJSON(path.join(dir, '1.json')).slice(0, 1).map((item) => Object.assign(item, { creator: { nickname: 'Ada', type: 'Person', id } })), null, 4));
        const stop = s.stop();
        assert.equal(stop.code, 0);
        assert.equal(stop.json.decision, 'block');
        assert.ok(stop.json.reason.startsWith('FrameTrail found problems in the data you changed.\n\nIn _data:\nhypervideos/1/annotations/' + id + '.json\n  error  Has no entry in annotations/_index.json; FrameTrail does not load these annotations.'), stop.json.reason);
        assert.ok(!stop.json.reason.includes('missing-license'), 'the media without a licence were there before');
        assert.deepEqual(s.stop(), { code: 0, stdout: '', stderr: '', json: null }, 'reported once');
        s.change(path.join(data, 'hypervideos', '1', 'hypervideo.json'), editJSON((h) => { h.clips[0].duration = 600; h.chapters.push({ start: 9999, title: 'Late' }); }));
        const late = s.stop();
        assert.equal(late.json.decision, 'block');
        assert.match(late.json.reason, /hypervideos\/1\/hypervideo\.json\n {2}error {2}hypervideo 1 "All Item Types", chapter "Late" at 9999 s: Is at 9999 s, outside the video \(0 s to 600 s\); the player never reaches it\. \[item-outside-video\]/);
        fs.rmSync(data, { recursive: true });
        assert.deepEqual(s.stop(), { code: 0, stdout: '', stderr: '', json: null }, 'a root that is gone');
        assert.deepEqual(fs.readdirSync(path.join(s.sessions, 's')), []);
    }));

    test('stop: new warnings alone go back as context; without a baseline everything counts', withScratch((s) => {
        const data = s.folder('all-types'),
              file = path.join(data, 'hypervideos', '1', 'hypervideo.json');
        s.change(file, editJSON((h) => { h.contents.push(Object.assign(JSON.parse(JSON.stringify(h.contents[0])), { created: '2026-10-09T12:00:00.000Z' })); }));
        const stop = s.stop();
        assert.equal(stop.json.decision, undefined);
        assert.equal(stop.json.hookSpecificOutput.hookEventName, 'Stop');
        assert.match(stop.json.hookSpecificOutput.additionalContext, /^FrameTrail warns about the data you changed\.[\s\S]*overlay "Card" \(text, created 2026-10-09T12:00:00\.000Z\): Covers the same area as overlay 2026-10-07T09:30:00\.137Z from 4 s to 12 s\. \[overlay-overlap\]/);
        const post = s.hook('post', { tool_name: 'Edit', tool_input: { file_path: file } }, 'unseen');
        assert.equal(post.code, 0);
        assert.match(s.stop('unseen').json.hookSpecificOutput.additionalContext, /missing-license/, 'no baseline: the media without a licence count');
    }));

    test('touchedHypervideos: the hypervideos whose files changed; all when an index changed', withScratch((s) => {
        const data   = s.folder('animation'),
              before = Check.readState(data, 'folder'),
              after  = (rel, fn) => { const state = Check.readState(data, 'folder'); state.texts[rel] = fn(state.texts[rel]); return state; };
        assert.deepEqual([...Check.touchedHypervideos(before, after('hypervideos/10/annotations/1.json', (text) => text + ' '))], ['10']);
        assert.equal(Check.touchedHypervideos(before, after('resources/_index.json', (text) => text + ' ')), null);
        assert.equal(Check.touchedHypervideos(null, before), null);
        assert.deepEqual([...Check.touchedHypervideos(before, after('config.json', (text) => text + ' '))], []);
    }));

    test('WebVTT the player cannot read is reported once, by FrameTrail\'s checkVTT, in a folder and in a project file', withScratch((s) => {
        const data = s.folder('all-types'), vtt = path.join(data, 'hypervideos', '1', 'subtitles', 'en.vtt');
        fs.writeFileSync(vtt, fs.readFileSync(vtt, 'utf8').replace('00:00:00.500 --> 00:00:04.000', '00:00:00,500 --> 00:00:04.000'));
        const folder = Check.problemsOf(Check.readState(data, 'folder')).filter((p) => p.file === 'hypervideos/1/subtitles/en.vtt');
        assert.deepEqual(folder.map((p) => [p.line, p.message.slice(0, 40)]), [[4, 'The cue timing "00:00:00,500 --> 00:00:0']]);
        const page = path.join(s.dir, 'page.html');
        fs.writeFileSync(page, HTMLFormat.writeProject(readFolder(data), null, { library: { css: '', js: '' }, datapath: './' }));
        const inPage = Check.problemsOf(Check.readState(page, 'file')).filter((p) => /cue timing/.test(p.message));
        assert.deepEqual(inPage.map((p) => [p.pointer, p.message.slice(0, 20)]), [['/hypervideos/1/subtitles/en', 'Line 4 of the subtit']]);
    }));

    test('user-id.mjs: a guest\'s id, as FrameTrail computes it', () => {
        const run = spawnSync(process.execPath, [USER_ID, 'Anna', 'B'], { encoding: 'utf8' });
        assert.deepEqual([run.status, run.stdout], [0, 'guest_anna-b-919e0619\n']);
        assert.equal(spawnSync(process.execPath, [USER_ID], { encoding: 'utf8' }).status, 2);
    });

    test('create-project.mjs: a _data folder and a project file as FrameTrail makes them, without problems; nothing overwritten', withScratch((s) => {
        const folder = path.join(s.dir, 'cells', '_data');
        let run = script(CREATE, ['--folder', folder, '--title', 'Cell Biology', '--language', 'de']);
        assert.equal(run.code, 0, run.stderr);
        assert.match(run.stdout, /^Created the _data folder .*\nFrameTrail check: no problems\.\nFrameTrail opens it in Chrome or Edge/);
        const files = readFolder(folder), expected = HTMLFormat.emptyProject();
        expected['config.json'] = { overviewTitle: 'Cell Biology', defaultLanguage: 'de' };
        assert.deepEqual(files, expected);
        assert.deepEqual(validator.validate('project-bundle.schema.json', Serializer.readBundle(files, 'folder')), []);
        const check = spawnSync(process.execPath, [CHECK, folder], { encoding: 'utf8' });
        assert.deepEqual([check.status, check.stdout.trim().split('\n').pop()], [0, 'No problems found.']);

        const page    = path.join(s.dir, 'trip.html'),
              release = readJSON(path.join(ROOT, VENDORED.scripts, 'package.json')).frametrailRelease,
              cdn     = HTMLFormat.cdnLibrary(release);
        run = script(CREATE, ['--file', page]);
        assert.equal(run.code, 0, run.stderr);
        let html = fs.readFileSync(page, 'utf8');
        assert.deepEqual(HTMLFormat.parse(html).map((block) => [block.kind, block.datapath]), [['project', './']]);
        assert.ok(html.includes('<link rel="stylesheet" href="' + cdn.cssURL + '">') && html.includes('<script src="' + cdn.jsURL + '"></script>'), 'FrameTrail from jsDelivr');
        if (release) { assert.ok(cdn.jsURL.includes('@' + release + '/'), 'pinned to ' + release); }
        assert.match(html, /<html>\n[\s\S]*<title>trip<\/title>/, 'titled by its file name');
        assert.deepEqual(HTMLFormat.readProject(html).files, HTMLFormat.emptyProject());
        assert.deepEqual(Check.problemsOf(Check.readState(page, 'file')), []);

        const named = path.join(s.dir, 'pages', 'named.html');
        run = script(CREATE, ['--file=' + named, '--title=Voyage', '--language=fr']);
        assert.equal(run.code, 0, run.stderr);
        html = fs.readFileSync(named, 'utf8');
        assert.match(html, /<html lang="fr">\n[\s\S]*<title>Voyage<\/title>/);
        assert.deepEqual(HTMLFormat.readProject(html).files['config.json'], { overviewTitle: 'Voyage', defaultLanguage: 'fr' });

        const empty = path.join(s.dir, 'empty.html');
        fs.writeFileSync(empty, '');
        assert.equal(script(CREATE, ['--file', empty]).code, 0, 'an empty file becomes the page, as in FrameTrail');

        const pageBefore = fs.readFileSync(page, 'utf8');
        for (const [args, message] of [
            [['--folder', folder], /is not empty; nothing was written/],
            [['--file', page], /exists; nothing was written/],
            [['--file', path.join(s.dir, 'x.html'), '--language', 'es'], /--language is the language of FrameTrail's interface, one of en, de, fr/],
            [['--file', path.join(s.dir, 'notes.txt')], /A project file is an HTML page/],
            [['--folder', folder, '--file', page], /Give either --folder or --file/],
            [[], /Give either --folder or --file/],
            [['--folder', folder, '--colour', 'red'], /Unknown option '--colour'/]
        ]) {
            run = script(CREATE, args);
            assert.equal(run.code, 2, args.join(' '));
            assert.match(run.stderr, message, args.join(' '));
        }
        assert.deepEqual(readFolder(folder), expected, 'the folder as it was');
        assert.equal(fs.readFileSync(page, 'utf8'), pageBefore, 'the page as it was');
        assert.ok(!fs.existsSync(path.join(s.dir, 'x.html')) && !fs.existsSync(path.join(s.dir, 'notes.txt')));
    }));

    test('add-media.mjs in a _data folder: the file named as FrameTrail names uploads, the entry under the next id, the clip and an item\'s body printed', withScratch((s) => {
        const data   = s.folder('all-types'),
              clip   = s.video(),
              file   = path.join(data, 'resources', '_index.json'),
              before = readJSON(file),
              next   = String(Math.max(before['resources-increment'] || 0, ...Object.keys(before.resources).map(Number)) + 1),
              user   = Serializer.guestUserID('Ada');

        const run = script(ADD_MEDIA, [data, clip, '--user', 'Ada', '--name', 'Cell division', '--license', 'cc-by-sa', '--attribution', 'Ada L.'], s.noTools);
        assert.equal(run.code, 0, run.stderr);
        const index = readJSON(file), entry = index.resources[next];
        assert.equal(index['resources-increment'], Number(next));
        assert.match(entry.src, new RegExp('^' + user + '_\\d{13}_Cell_division\\.mp4$'));
        assert.deepEqual(entry, { name: 'Cell division', type: 'video', src: entry.src, creator: 'Ada', creatorId: user, created: entry.created, licenseType: 'CC-BY-SA', licenseAttribution: 'Ada L.', attributes: {} }, 'no thumbnail without ffmpeg');
        assert.ok(Number.isInteger(entry.created) && Math.abs(entry.created - Date.now() / 1000) < 60, 'created in seconds');
        assert.deepEqual(fs.readFileSync(path.join(data, 'resources', entry.src)), fs.readFileSync(clip));
        assert.deepEqual(validator.validate('resources-index.schema.json', index), []);
        for (const id of Object.keys(before.resources)) { assert.deepEqual(index.resources[id], before.resources[id], 'resource ' + id + ' as it was'); }

        assert.ok(run.stdout.includes(JSON.stringify({ resourceId: next, src: entry.src, duration: 0, in: 0, out: 0 })), 'the clip');
        assert.ok(!run.stdout.includes('ffprobe:'));
        const body = JSON.parse(/As the body of an overlay or an annotation that shows it:\n(\{[\s\S]*?\n\})/.exec(run.stdout)[1]),
              item = readJSON(path.join(data, 'hypervideos', '1', 'hypervideo.json')).contents.find((c) => c['frametrail:type'] === 'Overlay');
        assert.deepEqual([body['frametrail:type'], body.source, body['frametrail:resourceId'], body['frametrail:licenseType']], ['video', entry.src, next, 'CC-BY-SA']);
        assert.deepEqual(validator.validate('content-item.schema.json', Object.assign({}, item, { body })), [], 'the body makes a valid overlay');
        assert.match(run.stdout, /\nFrameTrail check: no new problems\.$/);

        // A file already in resources/ is registered as it is, once.
        fs.copyFileSync(clip, path.join(data, 'resources', 'own.mp4'));
        let again = script(ADD_MEDIA, [path.join(data, 'hypervideos'), path.join(data, 'resources', 'own.mp4'), '--user', 'Ada'], s.noTools);
        assert.equal(again.code, 0, again.stderr);
        assert.match(again.stdout, /\nRegistered the file as it is: /);
        assert.deepEqual([readJSON(file).resources[String(Number(next) + 1)].src, readJSON(file).resources[String(Number(next) + 1)].name], ['own.mp4', 'own']);
        again = script(ADD_MEDIA, [data, path.join(data, 'resources', 'own.mp4'), '--user', 'Ada'], s.noTools);
        assert.match(again.stdout, new RegExp('^Already in the library as resource ' + (Number(next) + 1) + ', nothing added'));
        assert.deepEqual(fs.readdirSync(path.join(data, 'resources')).sort(), ['_index.json', entry.src, 'own.mp4'].sort());

        // A folder as FrameTrail scaffolds it: no increment yet.
        const bare = path.join(s.dir, 'bare');
        script(CREATE, ['--folder', bare]);
        fs.writeFileSync(path.join(bare, 'resources', '_index.json'), JSON.stringify({ resources: [] }));
        assert.equal(script(ADD_MEDIA, [bare, clip, '--user', 'Ada'], s.noTools).code, 0);
        assert.deepEqual(Object.keys(readJSON(path.join(bare, 'resources', '_index.json')).resources), ['1']);
    }));

    test('add-media.mjs in a project file: the file beside the page, the entry in the data block, the rest as it was; URLs as FrameTrail adds them', withScratch((s) => {
        const page   = s.page('all-types'),
              clip   = s.video(),
              html   = fs.readFileSync(page, 'utf8'),
              before = HTMLFormat.parse(html)[0].bundle,
              next   = String(Math.max(before.resources['resources-increment'] || 0, ...Object.keys(before.resources.resources).map(Number)) + 1);

        let run = script(ADD_MEDIA, [page, clip, '--user', 'Ada'], s.noTools);
        assert.equal(run.code, 0, run.stderr);
        let after  = fs.readFileSync(page, 'utf8'),
            bundle = HTMLFormat.parse(after)[0].bundle;
        const entry = bundle.resources.resources[next];
        assert.equal(entry.name, 'clip');
        assert.ok(fs.existsSync(path.join(s.dir, 'resources', entry.src)), 'in resources/ beside the page');
        assert.equal(after.replace(HTMLFormat.firstBlockText(after), ''), html.replace(HTMLFormat.firstBlockText(html), ''), 'the rest of the page as it was');
        assert.deepEqual(Object.assign({}, bundle, { resources: null }), Object.assign({}, before, { resources: null }), 'only the resources changed');
        assert.equal(HTMLFormat.firstBlockText(after).indexOf('<'), -1);
        assert.match(run.stdout, /\nIt has no licence type: lint warns/);
        assert.match(run.stdout, /\nThe page has changed: read it again before your next Edit of it\.\nFrameTrail check: no new problems\.$/);

        run = script(ADD_MEDIA, [page, 'https://www.youtube.com/watch?feature=share&v=abcdEFGh123&t=30', '--user', 'Ada', '--name', 'Talk']);
        assert.equal(run.code, 0, run.stderr);
        bundle = HTMLFormat.parse(fs.readFileSync(page, 'utf8'))[0].bundle;
        const talk = bundle.resources.resources[String(Number(next) + 1)];
        assert.deepEqual([talk.type, talk.src, talk.thumb], ['youtube', 'https://www.youtube.com/embed/abcdEFGh123?start=30', 'https://img.youtube.com/vi/abcdEFGh123/hqdefault.jpg']);
        assert.ok(run.stdout.includes('"src":"https://www.youtube.com/embed/abcdEFGh123?start=30","duration":0'), 'a YouTube video can be the clip');
        run = script(ADD_MEDIA, [page, 'https://youtu.be/abcdEFGh123?t=30', '--user', 'Ada', '--name', 'Again']);
        assert.match(run.stdout, new RegExp('^Already in the library as resource ' + (Number(next) + 1)));
        for (const [url, type, src] of [
            ['https://vimeo.com/123456789', 'vimeo', 'https://player.vimeo.com/video/123456789'],
            ['https://example.org/media/lecture.m3u8', 'video', 'https://example.org/media/lecture.m3u8'],
            ['https://example.org/media/Handout.PDF', 'pdf', 'https://example.org/media/Handout.PDF'],
            ['https://example.org/img/cell.png?w=800', 'image', 'https://example.org/img/cell.png?w=800']
        ]) {
            run = script(ADD_MEDIA, [page, url, '--user', 'Ada', '--name', 'A ' + type]);
            assert.equal(run.code, 0, url + ': ' + run.stderr);
            const added = Object.values(HTMLFormat.parse(fs.readFileSync(page, 'utf8'))[0].bundle.resources.resources).find((r) => r.name === 'A ' + type);
            assert.deepEqual([added.type, added.src], [type, src], url);
        }
        const unchanged = fs.readFileSync(page, 'utf8');
        run = script(ADD_MEDIA, [page, 'https://example.org/about', '--user', 'Ada', '--name', 'About']);
        assert.equal(run.code, 2);
        assert.match(run.stderr, /^Not a media URL add-media knows: https:\/\/example\.org\/about\n.*goes straight into an item's body/);
        assert.equal(fs.readFileSync(page, 'utf8'), unchanged);

        // A page whose media are on a server: no files, URLs yes.
        const remote = path.join(s.dir, 'remote.html'), fixture = readFolder(path.join(ROOT, VENDORED.fixtures, 'all-types'));
        fs.writeFileSync(remote, HTMLFormat.writeProject(fixture, null, { library: { css: '', js: '' }, datapath: 'https://example.org/_data/' }));
        run = script(ADD_MEDIA, [remote, clip, '--user', 'Ada']);
        assert.equal(run.code, 2);
        assert.match(run.stderr, /are on a server \(its datapath is https:\/\/example\.org\/_data\/\)/);
        assert.equal(script(ADD_MEDIA, [remote, 'https://example.org/media/a.mp4', '--user', 'Ada', '--name', 'A'], s.noTools).code, 0);

        // A page with a hypervideo bundle (an export): its resources are a plain map.
        const single = path.join(s.dir, 'single.html'),
              export1 = Serializer.readBundle(fixture, 'folder', { bundle: 'hypervideo', id: '1' });
        fs.writeFileSync(single, HTMLFormat.write(export1, { library: { css: '', js: '' }, datapath: './' }));
        run = script(ADD_MEDIA, [single, clip, '--user', 'Ada'], s.noTools);
        assert.equal(run.code, 0, run.stderr);
        const resources = HTMLFormat.parse(fs.readFileSync(single, 'utf8'))[0].bundle.resources,
              id        = String(Math.max(0, ...Object.keys(export1.resources || {}).map(Number)) + 1);
        assert.equal(resources[id].name, 'clip');
        assert.deepEqual(validator.validate('hypervideo-bundle.schema.json', HTMLFormat.parse(fs.readFileSync(single, 'utf8'))[0].bundle), []);
    }));

    test('add-media.mjs refuses what it cannot add, and then writes nothing', withScratch((s) => {
        const data   = s.folder('all-types'),
              clip   = s.video(),
              notes  = path.join(s.dir, 'notes.txt'),
              before = readFolder(data);
        fs.writeFileSync(notes, 'notes');
        for (const [args, message] of [
            [[data, clip], /^--user is missing/],
            [[data, clip, '--user', ' '], /^--user is missing/],
            [[data, path.join(s.dir, 'none.mp4'), '--user', 'Ada'], /^No such file/],
            [[data, notes, '--user', 'Ada'], /^Not a media file add-media takes: notes\.txt\nIt takes image \(jpg/],
            [[data, clip, '--user', 'Ada', '--license', 'MIT'], /^--license is one of Copyright, CC-BY, /],
            [[data, clip, '--user', 'Ada', '--user-id', '../x'], /cannot be part of a file name/],
            [[s.dir, clip, '--user', 'Ada'], /^Not FrameTrail data/],
            [[data, 'https://example.org/x.mp4', '--user', 'Ada'], /^--name is missing/],
            [[data], /^Usage: node add-media\.mjs/]
        ]) {
            const run = script(ADD_MEDIA, args, s.noTools);
            assert.equal(run.code, 2, args.join(' '));
            assert.match(run.stderr, message, args.join(' '));
        }
        fs.mkdirSync(path.join(data, '.collab'));
        const server = script(ADD_MEDIA, [data, clip, '--user', 'Ada'], s.noTools);
        assert.equal(server.code, 2);
        assert.match(server.stderr, /is the data folder of a FrameTrail server \(it has a \.collab folder\)/);
        assert.deepEqual(readFolder(data), before);
        assert.deepEqual(fs.readdirSync(path.join(data, 'resources')), ['_index.json']);
    }));

    test('add-media.mjs with ffprobe and ffmpeg: the media\'s length and size, and a video\'s thumbnail and scrub previews as FrameTrail\'s server makes them', { skip: HAS_FFMPEG ? false : 'ffmpeg and ffprobe are not installed' }, withScratch((s) => {
        const data = s.folder('all-types'),
              run  = script(ADD_MEDIA, [data, s.video('lecture.mp4'), '--user', 'Ada']);
        assert.equal(run.code, 0, run.stderr);
        const index = readJSON(path.join(data, 'resources', '_index.json')),
              id    = String(index['resources-increment']),
              entry = index.resources[id];
        assert.match(entry.thumb, new RegExp('^' + Serializer.guestUserID('Ada') + '_\\d{13}_thumb_lecture\\.png$'));
        assert.equal(entry.thumb.split('_thumb_')[0], entry.src.split('_lecture')[0], 'the same stamp');
        assert.deepEqual(fs.readFileSync(path.join(data, 'resources', entry.thumb)).subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a PNG');
        assert.match(run.stdout, /\nffprobe: length 2 s, 160 × 120 pixels\.\nThumbnail: .*\nScrub previews \(the player finds them by name\): /);
        const sprite = path.join(data, 'resources', entry.src.replace(/\.mp4$/, '_scrub.jpg'));
        assert.deepEqual(fs.readFileSync(sprite).subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]), 'a JPEG beside the video');
        assert.deepEqual([Check.probeMedia(sprite).width, Check.probeMedia(sprite).height], [1600, 900], '5 × 5 tiles of 320 × 180');
        assert.ok(run.stdout.includes(JSON.stringify({ resourceId: id, src: entry.src, duration: 0, in: 0, out: 0 }) + '\nand in its meta: "thumb": ' + JSON.stringify(entry.thumb)));
        const probed = Check.probeMedia(path.join(data, 'resources', entry.src));
        assert.deepEqual([Math.round(probed.duration), probed.width, probed.height], [2, 160, 120]);
        assert.equal(Check.probeMedia(path.join(data, 'config.json')), null, 'no media');
    }));

    test('hooks.json: check.mjs before and after Write, Edit and MultiEdit, and at the stop', () => {
        const hooks = readJSON(path.join(PLUGIN, 'hooks', 'hooks.json'));
        assert.ok(hooks.description);
        assert.deepEqual(Object.keys(hooks.hooks).sort(), ['PostToolUse', 'PreToolUse', 'Stop']);
        const expected = { PreToolUse: 'pre', PostToolUse: 'post', Stop: 'stop' };
        for (const [event, groups] of Object.entries(hooks.hooks)) {
            assert.equal(groups.length, 1, event);
            assert.equal(groups[0].matcher, (event === 'Stop') ? undefined : 'Write|Edit|MultiEdit', event);
            assert.deepEqual(groups[0].hooks.map((h) => [h.type, h.command]), [['command', 'node "${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs" --hook=' + expected[event]]], event);
        }
        assert.ok(fs.existsSync(CHECK));
    });

});


/* ---------------------------------------------------------------------- */
/*  The evaluation                                                        */
/* ---------------------------------------------------------------------- */

const EVALS      = path.join(ROOT, 'evals');
const CASES      = fs.readdirSync(EVALS).filter((name) => /^\d\d-/.test(name)).sort();
const EVAL_TAGS  = ['core', 'talk', 'chapters', 'items', 'new', 'page', 'neg'];
const EVAL_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'Skill'];
const SCAFFOLD   = 'node "$(dirname "$0")/../lib/scaffold.mjs" "$(basename "$(dirname "$0")")"\n';

// A workspace with a setup built in it (placeholder media), and the data as it was, for the checks.
function workspace(s, setup) {
    const dir = fs.mkdtempSync(path.join(s.dir, 'ws-'));
    buildSetup(setup, dir, { placeholder: true });
    return dir;
}
const before   = (setup) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frametrail-before-')); try { buildSetup(setup, dir, { placeholder: true }); return readData(dir, SETUPS[setup].root); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };
const changeJSON = (file, fn) => fs.writeFileSync(file, editJSON(fn)(fs.readFileSync(file, 'utf8')));
// The verdicts of a grading, by check name: { name: [passed, reason] }.
const verdicts = (graded) => Object.fromEntries(graded.results.map((r) => [r.check.split(' ')[0] + (r.check.includes('"title"') ? ':' + JSON.parse(r.check.slice(r.check.indexOf(' ') + 1)).title : ''), [r.passed, r.reason]]));

describe('the evaluation', () => {

    test('FrameTrail\'s data sets the workspaces are made from are valid bundles', () => {
        for (const name of fs.readdirSync(path.join(ROOT, VENDORED.bundles))) {
            const bundle = readJSON(path.join(ROOT, VENDORED.bundles, name)),
                  errors = validator.validate(bundle.bundle + '-bundle.schema.json', bundle);
            assert.ok(!errors.length, name + ':\n' + errorList(errors));
        }
    });

    test('every case folder: case.yaml (as JSON), the scaffold line, expect.json with a known setup and known checks', () => {
        assert.equal(CASES.length, 13);
        const names = new Set();
        for (const folder of CASES) {
            assert.deepEqual(fs.readdirSync(path.join(EVALS, folder)).sort(), ['case.yaml', 'expect.json', 'scaffold.sh'], folder);
            const c = readJSON(path.join(EVALS, folder, 'case.yaml')), expect = readJSON(path.join(EVALS, folder, 'expect.json'));
            assert.equal(c.schema_version, '1.0', folder);
            assert.equal(c.name, folder.replace(/^\d\d-/, ''), folder);
            assert.ok(!names.has(c.name), 'unique ' + c.name); names.add(c.name);
            assert.ok(c.description && c.tags.length && c.tags.every((t) => EVAL_TAGS.includes(t)), folder + ': tags ' + c.tags);
            assert.deepEqual(c.plugins, ['../../plugin'], folder);
            assert.deepEqual(c.context, { scaffold_script: 'scaffold.sh' }, folder);
            assert.deepEqual(c.execution.allowed_tools, EVAL_TOOLS, folder);
            assert.ok(c.execution.prompt.trim() && !/(^|\s)(\/|~\/)\S/.test(c.execution.prompt), folder + ': a prompt without absolute paths');
            assert.equal(c.runs, 2, folder);
            const skill = c.graders.find((g) => g.tool === 'Skill' && g.input_match === 'frametrail-hypervideo');
            assert.ok(skill, folder + ': the Skill indicator');
            assert.deepEqual([skill.arm, skill.max], c.tags.includes('neg') ? ['both', 0] : ['with-only', undefined], folder);
            assert.equal(fs.readFileSync(path.join(EVALS, folder, 'scaffold.sh'), 'utf8'), SCAFFOLD, folder);
            assert.ok(SETUPS[expect.setup], folder + ': setup ' + expect.setup);
            assert.ok(expect.root === undefined || typeof expect.root === 'string', folder);
            assert.deepEqual(expect.checks.map((check) => Object.keys(check)).filter((keys) => keys.length !== 1 || !CHECKS.includes(keys[0])), [], folder);
            assert.ok(!expect.root || expect.checks.some((check) => 'valid' in check || 'noChanges' in check), folder + ': data cases check valid or noChanges');
            assert.equal(expect.checks.some((check) => 'escaped' in check), /\.html$/.test(expect.root || ''), folder + ': pages, and only pages, check escaped');
        }
        for (const tag of EVAL_TAGS) { assert.ok(CASES.some((folder) => readJSON(path.join(EVALS, folder, 'case.yaml')).tags.includes(tag)), 'tag ' + tag + ' used'); }
    });

    test('the workspaces: the data as FrameTrail has it, without problems; a page loads the pinned library', withScratch((s) => {
        for (const name of Object.keys(SETUPS).filter((name) => SETUPS[name].root)) {
            const dir = workspace(s, name), root = path.join(dir, SETUPS[name].root);
            const problems = Check.problemsOf(Check.readState(root, root.endsWith('.html') ? 'file' : 'folder'));
            assert.deepEqual(problems, [], name + ':\n' + Check.formatProblems(problems));
        }
        const page = fs.readFileSync(path.join(workspace(s, 'lecture-page'), 'course.html'), 'utf8');
        assert.ok(page.includes(HTMLFormat.cdnLibrary(readJSON(path.join(ROOT, VENDORED.scripts, 'package.json')).frametrailRelease).jsURL));
        assert.ok(fs.existsSync(path.join(workspace(s, 'lecture-folder+video'), 'field-recording.mp4')));
        const run = spawnSync(process.execPath, [path.join(EVALS, 'lib', 'scaffold.mjs'), 'nothing-here'], { encoding: 'utf8' });
        assert.equal(run.status, 2);
    }));

    test('the checks, untouched and after scripted changes: chapters, items, annotations, layout, subtitles, noChanges', withScratch((s) => {
        const was  = before('lecture-folder'),
              dir  = workspace(s, 'lecture-folder'),
              file = path.join(dir, '_data', 'hypervideos', '1', 'hypervideo.json'),
              run  = (checks, message = '') => grade({ root: '_data', hypervideo: '1', checks }, { workspace: dir, message, before: was });

        let v = verdicts(run([{ valid: true }, { noChanges: true }, { chapter: { from: 510, to: 510, title: '^summary$' } }]));
        assert.deepEqual([v.valid[0], v.noChanges[0], v['chapter:^summary$'][0]], [true, true, false]);
        assert.match(v['chapter:^summary$'][1], /no chapter in \[510, 510\] titled \/\^summary\$\/; chapters: 0 Introduction \| 120 Membranes \| 300 Transport/);

        changeJSON(file, (h) => {
            h.chapters.push({ start: 510, title: 'Summary' });
            h.contents.push(Object.assign(JSON.parse(JSON.stringify(h.contents[0])), { created: '2026-10-10T08:00:00.000Z', target: Object.assign({}, h.contents[0].target, { selector: { type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value: 't=10,20&xywh=percent:5,2,90,15' } }) }));
            h.contents[h.contents.length - 1].body['frametrail:attributes'] = { text: '&lt;p&gt;Welcome to lecture 3&lt;/p&gt;' };
            const hotspot = JSON.parse(JSON.stringify(h.contents.find((c) => c.body['frametrail:type'] === 'hotspot')));
            hotspot.created = '2026-10-10T08:00:01.000Z';
            hotspot.target.selector = { type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value: 't=60,65&xywh=percent:5,5,90,90', 'frametrail:keyframes': [{ t: 60, xywh: [5, 5, 10, 10] }, { t: 65, xywh: [85, 85, 10, 10] }] };
            hotspot.body['frametrail:attributes'] = { shape: 'circle', color: '#ffd700' };
            h.contents.push(hotspot);
            h.config.layoutArea.areaBottom.push({ type: 'Transcript', name: 'Transcript', transcriptSource: 'en' });
            h.subtitles.push({ src: 'de.vtt', srclang: 'de' });
        });
        fs.writeFileSync(path.join(dir, '_data', 'hypervideos', '1', 'subtitles', 'de.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:06.000\nWillkommen zur dritten Vorlesung über Zellbiologie.\n');

        v = verdicts(run([
            { valid: true }, { noChanges: true }, { chapter: { from: 510, to: 510, title: '^summary$' } }, { chapters: { min: 4, max: 4 } }, { noChapter: { from: 600, to: 100000 } },
            { item: { kind: 'overlays', type: 'text', start: [9.5, 10.5], end: [19.5, 20.5], text: 'welcome to lecture 3', box: { top: [0, 30] } } },
            { item: { kind: 'overlays', type: 'hotspot', start: [59.5, 60.5], attributes: { shape: { matches: '^(circle|undefined)$' }, color: { hue: [40, 70] } }, keyframes: { min: 2, right: true, down: true } } },
            { layout: { area: 'bottom', includes: 'Transcript', after: 'TimedContent' } },
            { subtitles: { lang: 'de', cues: [{ start: 1, end: 6, text: 'willkommen' }] } },
            { answer: 'summary' }
        ], 'I added the chapter "Summary".'));
        for (const [name, [passed, reason]] of Object.entries(v)) { assert.equal(passed, name !== 'noChanges', name + ': ' + reason); }
        assert.match(v.noChanges[1], /^changed: hypervideos\/1\/hypervideo\.json, hypervideos\/1\/subtitles\/de\.vtt$/);

        v = verdicts(run([
            { item: { kind: 'overlays', type: 'text', start: [11, 12] } }, { item: { kind: 'overlays', type: 'hotspot', start: [59.5, 60.5], attributes: { color: { hue: [200, 260] } } } },
            { layout: { area: 'bottom', includes: 'TimedContent', after: 'Transcript' } }, { subtitles: { lang: 'de', cues: [{ start: 1, end: 7, text: 'willkommen' }] } },
            { chapters: { min: 5, max: 6 } }, { answer: 'bonus' }, { noItem: { kind: 'overlays', type: 'text', text: 'welcome' } }
        ]));
        assert.ok(Object.values(v).every(([passed]) => !passed), JSON.stringify(v));
        assert.match(v.item[1], /^no such item; closest: /);

        // An annotation by Ada (any id), in a file with its index entry; valid catches a file without one.
        const notes = path.join(dir, '_data', 'hypervideos', '1', 'annotations', '1.json');
        changeJSON(notes, (list) => { list.push(Object.assign(JSON.parse(JSON.stringify(list[0])), { created: '2026-10-10T08:00:02.000Z', target: Object.assign({}, list[0].target, { selector: Object.assign({}, list[0].target.selector, { value: 't=60,90' }) }), body: Object.assign({}, list[0].body, { 'frametrail:attributes': { text: '&lt;p&gt;Remember: diffusion needs no energy.&lt;/p&gt;' } }) })); });
        v = verdicts(run([{ item: { kind: 'annotations', by: '^ada$', start: [59.5, 60.5], end: [89.5, 90.5], text: 'diffusion needs no energy' } }, { valid: true }]));
        assert.deepEqual([v.item[0], v.valid[0]], [true, true], JSON.stringify(v));
        fs.writeFileSync(path.join(dir, '_data', 'hypervideos', '1', 'annotations', 'guest_ada-38390dbb.json'), '[]');
        assert.match(verdicts(run([{ valid: true }])).valid[1], /^1 error:\n[\s\S]*Has no entry in annotations\/_index\.json/);
    }));

    test('the checks on pages, new hypervideos and other files: a raw "<", a video in the resources, a JSON value', withScratch((s) => {
        const dir  = workspace(s, 'lecture-page'),
              page = path.join(dir, 'course.html'),
              html = fs.readFileSync(page, 'utf8'),
              b    = HTMLFormat.parse(html)[0].bundle;
        b.hypervideos['1'].hypervideo.config.layoutArea.areaRight.push({ type: 'CustomHTML', name: 'Credits', html: '<p>Made for <em>Biology 101</em>.</p>' });
        fs.writeFileSync(page, html.replace(HTMLFormat.firstBlockText(html), JSON.stringify(b, null, 4)));
        const checks = [{ layout: { area: 'right', includes: 'CustomHTML', html: '<em>biology 101</em>' } }, { valid: true }, { escaped: true }];
        let v = verdicts(grade({ root: 'course.html', hypervideo: '1', checks }, { workspace: dir }));
        assert.deepEqual([v.layout[0], v.valid[0], v.escaped[1]], [true, true, 'the data block holds 6 raw "<"'], JSON.stringify(v)); // the Credits' 4 and the subtitles' <v Ada></v>
        fs.writeFileSync(page, Check.escapeBlock(fs.readFileSync(page, 'utf8')).html);
        v = verdicts(grade({ root: 'course.html', hypervideo: '1', checks }, { workspace: dir }));
        assert.deepEqual([v.layout[0], v.valid[0], v.escaped[0]], [true, true, true], JSON.stringify(v));
        assert.equal(verdicts(grade({ root: '_data', checks: [{ escaped: true }] }, { workspace: workspace(s, 'lecture-folder') })).escaped[1], 'not a project file');

        // A new hypervideo playing a copy of the given file: through the helpers, as Claude would make it.
        const folder = workspace(s, 'lecture-folder+video');
        const added = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'add-media.mjs'), path.join(folder, '_data'), path.join(folder, 'field-recording.mp4'), '--user', 'Ada'], { encoding: 'utf8', env: s.noTools });
        assert.equal(added.status, 0, added.stderr);
        const resource = /"resourceId":"(\d+)","src":"([^"]+)"/.exec(added.stdout);
        changeJSON(path.join(folder, '_data', 'hypervideos', '_index.json'), (index) => { index['hypervideo-increment'] = 2; index.hypervideos['2'] = './2'; });
        const hv = readJSON(path.join(folder, '_data', 'hypervideos', '1', 'hypervideo.json'));
        Object.assign(hv, { meta: Object.assign({}, hv.meta, { name: 'Field recording' }), clips: [{ resourceId: resource[1], src: resource[2], duration: 0, in: 0, out: 0 }], contents: [], chapters: [], subtitles: [] });
        fs.mkdirSync(path.join(folder, '_data', 'hypervideos', '2', 'annotations'), { recursive: true });
        fs.writeFileSync(path.join(folder, '_data', 'hypervideos', '2', 'hypervideo.json'), JSON.stringify(hv, null, 4));
        fs.writeFileSync(path.join(folder, '_data', 'hypervideos', '2', 'annotations', '_index.json'), JSON.stringify({ mainAnnotation: null, annotationfiles: {} }));
        const want = { root: '_data', hypervideo: { name: '^field recording$' }, checks: [{ hypervideo: { name: '^field recording$', video: 'field-recording.mp4' } }, { valid: true }, { chapters: { min: 0, max: 0 } }] };
        v = verdicts(grade(want, { workspace: folder }));
        assert.ok(Object.values(v).every(([passed]) => passed), JSON.stringify(v));
        fs.writeFileSync(path.join(folder, 'field-recording.mp4'), 'another video');
        assert.match(verdicts(grade(want, { workspace: folder })).hypervideo[1], /is not field-recording\.mp4$/);

        // No data: the cases that make it fail all their data checks with one reason; file and answer still work.
        const none = workspace(s, 'node-app');
        v = verdicts(grade({ root: 'trip.html', checks: [{ valid: true }, { file: { path: 'package.json', pointer: '/scripts/start', matches: '^node index' } }] }, { workspace: none }));
        assert.deepEqual(v, { valid: [false, 'trip.html does not exist'], file: [true, null] });
    }));

    test('dev/eval.mjs: kept runs graded from their traces, limits counted as not run, the table, the kept folders removed', withScratch((s) => {
        assert.equal(finalMessage('{"type":"assistant","message":{"content":[{"type":"text","text":"Working."}]}}\n{"type":"result","result":"Added \\"Summary\\" at 8:30."}\n'), 'Added "Summary" at 8:30.');
        assert.equal(finalMessage('{"type":"assistant","message":{"content":[{"type":"text","text":"Last words."}]}}\nnot json\n'), 'Last words.');

        // Two kept runs as the CLI leaves them (one sealed), and one cut off by a usage limit.
        const kept = (name, edit, sealed) => {
            const root = path.join(s.dir, name), home = path.join(root, sealed ? 'sealed' : '', 'home', 'cwd');
            fs.mkdirSync(home, { recursive: true });
            buildSetup('lecture-folder', home, { placeholder: true });
            if (edit) { changeJSON(path.join(home, '_data', 'hypervideos', '1', 'hypervideo.json'), (h) => { h.chapters.push({ start: 510, title: 'Summary' }); }); }
            fs.mkdirSync(path.join(root, 'out'));
            fs.writeFileSync(path.join(root, 'out', 'trace.jsonl'), JSON.stringify({ type: 'result', result: edit ? 'Added "Summary" at 8:30; the video ends at 10:00, so there is no "Bonus".' : 'Done.' }) + '\n');
            if (sealed) { fs.chmodSync(path.join(root, 'sealed'), 0o000); }
            return path.join(root, 'out', 'trace.jsonl');
        };
        const results = path.join(s.dir, 'results');
        fs.mkdirSync(results);
        const run = (tracePath, extra) => Object.assign({ score: 1, turns: 5, costUsd: 0.1, durationSeconds: 20, error: null, tracePath, graders: [{ name: 'skill-fired', passed: true, withOnly: true, scored: false }] }, extra);
        fs.writeFileSync(path.join(results, 'aggregate-result.json'), JSON.stringify({ startedAt: '2026-10-10T08:00:00.000Z', claudeVersion: '2.1.295', suite: { modelOverride: 'opus' }, cases: [{
            name: 'chapters', dir: path.join(EVALS, '03-chapters'),
            arms: { with: [run(kept('e-with1', true, true)), run(null, { error: 'exit 1: You\'ve hit your session limit · resets 5:50am (Europe/Berlin)' })], without: [run(kept('e-without1', false, false), { graders: [] })] }
        }] }));
        assert.ok(keptRun(path.join(s.dir, 'e-with1', 'out', 'trace.jsonl')).workspace.endsWith(path.join('sealed', 'home', 'cwd')));
        fs.chmodSync(path.join(s.dir, 'e-with1', 'sealed'), 0o000);

        const summary = gradeResults(results);
        assert.deepEqual(summary.runs.map((r) => [r.case, r.arm, r.status, r.skill]), [['03-chapters', 'with', 'passed', true], ['03-chapters', 'with', 'notRun', true], ['03-chapters', 'without', 'failed', null]]);
        assert.deepEqual(readJSON(path.join(results, 'summary.json')).runs.length, 3);
        assert.ok(!fs.existsSync(path.join(s.dir, 'e-with1')) && !fs.existsSync(path.join(s.dir, 'e-without1')), 'the kept folders are removed');
        const markdown = table(summary.runs);
        assert.match(markdown, /\| 03-chapters \| 1\/1 \(\+1 not run\) \| 0\/1 \| \+100 \| 100 % \/ 40 % \| 1\/1 \|/);
        assert.match(markdown, /- \*\*03-chapters\*\*, without: chapter: no chapter in \[510, 510\]/);
    }));

});


/* ---------------------------------------------------------------------- */
/*  README                                                                */
/* ---------------------------------------------------------------------- */

describe('README.md', () => {

    const text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

    test('names the pinned FrameTrail version', { skip: DRIFT ? 'a drift run syncs a newer FrameTrail' : false }, () => {
        assert.ok(text.includes(readJSON(LOCK).frametrail.version), 'README.md does not name FrameTrail ' + readJSON(LOCK).frametrail.version);
    });

    test('names the data format the vendored FrameTrail reads and writes', () => {
        const m = /data format (\d+)/.exec(text);
        assert.ok(m, 'README.md names the data format');
        assert.equal(Number(m[1]), HTMLFormat.FORMAT_VERSION);
        assert.ok(Schemas.every((schema) => schema.$id.startsWith('https://frametrail.org/schemas/' + m[1] + '/')));
    });

});

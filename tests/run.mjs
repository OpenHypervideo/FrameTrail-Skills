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
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { VENDORED, LOCK, sha256, filesBelow, presentFiles, rewriteLinks } from '../dev/sync.mjs';
import * as Check from '../plugin/scripts/check.mjs';

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

    test('the scripts load under require(), as CommonJS whatever surrounds them', () => {
        assert.deepEqual(readJSON(path.join(ROOT, VENDORED.scripts, 'package.json')), { type: 'commonjs' });
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

const CHECK   = path.join(PLUGIN, 'scripts', 'check.mjs');
const USER_ID = path.join(PLUGIN, 'scripts', 'user-id.mjs');

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

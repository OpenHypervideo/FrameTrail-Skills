/*
 * The repository's tests. No dependencies and no FrameTrail checkout, Node 20 or later:
 *
 *     node tests/run.mjs
 *     node tests/run.mjs --drift     # after syncing a newer FrameTrail (drift.yml): the README's version is not checked
 *
 * - The vendored files: exactly those of vendor.lock.json, unchanged; the scripts load under require() and work together on the vendored fixtures.
 * - The plugin: the marketplace and plugin manifests, what plugin/ holds, each skill's frontmatter.
 * - The text written here for the model, tested against the vendored truth: JSON examples tagged with a schema validate, type names exist, the files it names exist (see CLAUDE.md, "Text").
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { VENDORED, LOCK, sha256, filesBelow, presentFiles, rewriteLinks } from '../dev/sync.mjs';

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

    for (const m of text.matchAll(/^```json[ \t]+frametrail:(\S+)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm)) {
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
            '[missing](references/missing.md), ${CLAUDE_PLUGIN_ROOT}/scripts/missing.mjs'
        ].join('\n');
        const problems = textProblems(broken, { file, skillDir });
        assert.equal(problems.length, 7, problems.join('\n'));
        assert.match(problems.join('\n'), /no type `slideshow`[\s\S]*no type `gif`/);
        assert.match(problems.join('\n'), /line 2: the example does not follow content-item\.schema\.json/);
        assert.match(problems.join('\n'), /: the example is no JSON/);
        assert.match(problems.join('\n'), /no schema nothing\.schema\.json/);
        assert.match(problems.join('\n'), /no file references\/missing\.md[\s\S]*no file \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/missing\.mjs/);
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

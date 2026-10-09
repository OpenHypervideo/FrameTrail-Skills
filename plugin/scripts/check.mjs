/*
 * FrameTrail's own checks on a _data folder or a project file (an HTML page with a FrameTrail data block): the JSON Schemas, the folder check and the lint rules of the vendored FrameTrail (../vendor/frametrail/), and what files edited by hand get wrong besides (JSON syntax, a raw "<" in a page's data block, WebVTT timings). Node 20 or later, no dependencies.
 *
 *     node check.mjs <_data folder | page.html | a file in a _data folder>    # everything; exit 1 on errors, 2 when it is no FrameTrail data
 *     node check.mjs --escape <page.html>                                      # every "<" in the page's data block written as \u003c
 *     node check.mjs --hook=pre|post|stop                                      # as a hook (hooks/hooks.json), the hook's JSON on stdin
 *
 * The hooks:
 *
 * - pre (PreToolUse Write|Edit|MultiEdit): before the session's first change of a root, the root as it is becomes the baseline (CLAUDE_PLUGIN_DATA/sessions/<session>/<root hash>.json), so that the stop hook reports only what the session changed. A change to the folder of a FrameTrail server is put to the user first (permissionDecision "ask"): its editors do not notice changes made behind them.
 * - post (PostToolUse Write|Edit|MultiEdit): the changed file alone: JSON syntax and schema; for a page its data block and its subtitles; WebVTT. Problems go back to Claude on stderr, exit 2. A page's data block is first put into the form FrameTrail writes, every "<" as \u003c, like a formatter (what Claude types as \u003c into Write and Edit tends to arrive as "<"); Claude is told.
 * - stop (Stop): every root the session changed, as a whole: its files, the folder check, the lint rules for the hypervideos whose files changed. Problems the baseline had are left out, and each problem is reported once per session. New errors block the stop with the reason; new warnings alone go back as context.
 *
 * A path outside FrameTrail data costs a few stat calls: the vendored scripts are loaded once a root is found.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SCRIPT  = fileURLToPath(import.meta.url);
const VENDOR  = path.join(path.dirname(SCRIPT), '..', 'vendor', 'frametrail');

// At most this many problems in an answer to Claude; the rest are counted.
const POST_LIMIT = 20;
const STOP_LIMIT = 30;

// Sessions older than this are removed; a hook waits this long for another hook's baseline.
const SESSION_DAYS = 7;
const LOCK_WAIT_MS = 5000;

let loaded = null;

// FrameTrail's scripts, loaded on first use.
function ft() {
    if (!loaded) {
        const Schema = require(path.join(VENDOR, 'schema', 'FrameTrailSchema.js'));
        loaded = {
            Serializer: require(path.join(VENDOR, 'serialization', 'FrameTrailSerializer.js')),
            HTMLFormat: require(path.join(VENDOR, 'serialization', 'FrameTrailHTMLFormat.js')),
            Lint:       require(path.join(VENDOR, 'serialization', 'FrameTrailLint.js')),
            validator:  Schema.create(require(path.join(VENDOR, 'schema', 'FrameTrailSchemas.js')))
        };
    }
    return loaded;
}

const isFile   = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const isDir    = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
const isURL    = (s) => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(s) || s.startsWith('/');


/* ---------------------------------------------------------------------- */
/*  Roots                                                                 */
/* ---------------------------------------------------------------------- */

const isFolderRoot = (dir) => isFile(path.join(dir, 'config.json')) && isFile(path.join(dir, 'hypervideos', '_index.json'));

/**
 * The FrameTrail data a path belongs to, { kind: 'folder' | 'file', root }, or null: a page with a FrameTrail data block (a project file) is its own root; anything else belongs to the nearest folder at or above it with config.json and hypervideos/_index.json (a _data folder). The path need not exist yet.
 */
export function findRoot(target) {
    const full = path.resolve(target);
    if (/\.html?$/i.test(full)) {
        const html = readText(full);
        return (html !== null && html.includes('data-frametrail') && ft().HTMLFormat.firstBlockText(html) !== null) ? { kind: 'file', root: full } : null;
    }
    for (let dir = isDir(full) ? full : path.dirname(full); ; dir = path.dirname(dir)) {
        if (isFolderRoot(dir)) { return { kind: 'folder', root: dir }; }
        if (path.dirname(dir) === dir) { return null; }
    }
}

/**
 * Why a folder belongs to a FrameTrail server, or null. The server keeps presence and locks in .collab/ and accounts with password hashes in users.json; its editors do not notice changes made behind them, and save over them.
 */
export function serverInstance(root) {
    if (isDir(path.join(root, '.collab'))) { return 'it has a .collab folder'; }
    try {
        const users = JSON.parse(fs.readFileSync(path.join(root, 'users.json'), 'utf8')).user;
        if (users && Object.values(users).some((user) => user && typeof user === 'object' && 'passwd' in user)) { return 'its users.json holds accounts with passwords'; }
    } catch (e) {}
    return null;
}


/* ---------------------------------------------------------------------- */
/*  What is checked                                                       */
/* ---------------------------------------------------------------------- */

/**
 * The files of a _data folder the checks read, by path relative to it, as text: the JSON files (but users.json), subtitles and CSS. Of resources/ only its index; dot-folders (.auth, .collab) never.
 */
export function folderTexts(root) {
    const texts = {},
          add   = (rel) => { const text = readText(path.join(root, rel)); if (text !== null) { texts[rel] = text; } };
    for (const name of fs.readdirSync(root).sort()) {
        if (!name.startsWith('.') && name !== 'users.json' && /\.(json|css)$/.test(name) && isFile(path.join(root, name))) { add(name); }
    }
    if (isFile(path.join(root, 'resources', '_index.json'))) { add('resources/_index.json'); }
    (function walk(rel) {
        for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
            if (name.startsWith('.')) { continue; }
            const file = rel + '/' + name;
            if (isDir(path.join(root, file))) { walk(file); } else if (/\.(json|vtt|css)$/.test(name)) { add(file); }
        }
    })('hypervideos');
    return texts;
}

// The datapath of a page's first data block (what its relative media paths resolve against), or null.
function datapathOf(html) {
    const tag = /<script\b[^>]*\bdata-frametrail\b[^>]*>/i.exec(html),
          m   = tag && /\bdata-frametrail-datapath\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag[0]);
    return m ? ((m[1] !== undefined) ? m[1] : m[2]) : null;
}

/**
 * A root as the checks see it: { kind: 'folder', root, texts }, or { kind: 'file', root, html, block, datapath } with block null for a page without a data block. null when the root is gone.
 */
export function readState(root, kind) {
    if (kind === 'folder') { return isFolderRoot(root) ? { kind, root, texts: folderTexts(root) } : null; }
    const html = readText(root);
    return (html === null) ? null : { kind, root, html, block: ft().HTMLFormat.firstBlockText(html), datapath: datapathOf(html) };
}

// What a session keeps of a root as its baseline, and the state it stands for.
function snapshotOf(state) {
    return (state.kind === 'folder') ? { texts: state.texts } : { block: state.block };
}
function baselineState(record, current) {
    if (!record.baseline) { return null; }
    return (record.kind === 'folder')
        ? { kind: 'folder', root: record.root, texts: record.baseline.texts }
        : { kind: 'file', root: record.root, html: null, block: record.baseline.block, datapath: current.datapath };
}

// A data block as a page of its own, for FrameTrailHTMLFormat.readProject.
const pageOf = (block) => '<script type="application/ld+json" data-frametrail>\n' + block + '\n</script>';

// Where a page's first data block begins.
function blockStart(html, block) {
    return html.indexOf(block, Math.max(0, html.search(/<script\b[^>]*\bdata-frametrail\b/i)));
}

/**
 * A page with every "<" in its first data block written as \u003c, as FrameTrail writes it: { html, count }. null when there is none, or when the block is no JSON (in JSON a "<" can only be in a string, where \u003c means the same; in anything else the escape could change what it means).
 */
export function escapeBlock(html) {
    const block = ft().HTMLFormat.firstBlockText(html);
    if (block === null || !block.includes('<')) { return null; }
    try { JSON.parse(block); } catch (e) { return null; }
    const start = blockStart(html, block);
    return { html: html.slice(0, start) + block.replace(/</g, '\\u003c') + html.slice(start + block.length), count: block.split('<').length - 1 };
}

// The folder map of a state (the serializer's folder format), or null when a page's block cannot be read.
function folderMapOf(state) {
    if (state.kind === 'folder') { return state.texts; }
    if (!('files' in state)) {
        try { state.files = ft().HTMLFormat.readProject(pageOf(state.block)).files; } catch (e) { state.files = null; }
    }
    return state.files;
}

// "hypervideos/<dir>/" for an entry of hypervideos/_index.json ("./9"), or null when it is no folder inside the tree.
function hypervideoDir(entry) {
    const dir = String(entry).replace(/^\.\//, '').replace(/\/+$/, '');
    return (!dir || dir.charAt(0) === '/' || dir.split('/').includes('..')) ? null : 'hypervideos/' + dir + '/';
}

// Hypervideo folder → id, by the index of a folder map.
function idsByDir(files) {
    let index = files && files['hypervideos/_index.json'];
    if (typeof index === 'string') { try { index = JSON.parse(index); } catch (e) { index = null; } }
    const entries = (index && index.hypervideos && typeof index.hypervideos === 'object') ? index.hypervideos : {},
          ids     = {};
    for (const id of Object.keys(entries)) { const dir = hypervideoDir(entries[id]); if (dir) { ids[dir] = id; } }
    return ids;
}

/**
 * The ids of the hypervideos whose files differ between two states of a root, or null for all of them: when there is no baseline, or the hypervideos index or the resources changed (lint reads both for every hypervideo).
 */
export function touchedHypervideos(before, after) {
    const a = before && folderMapOf(before),
          b = after && folderMapOf(after);
    if (!a || !b) { return null; }
    const text    = (value) => (typeof value === 'string') ? value : JSON.stringify(value),
          changed = [...new Set(Object.keys(a).concat(Object.keys(b)))].filter((rel) => text(a[rel]) !== text(b[rel]));
    if (changed.includes('hypervideos/_index.json') || changed.includes('resources/_index.json')) { return null; }
    const dirs = Object.assign(idsByDir(a), idsByDir(b)),
          ids  = new Set();
    for (const rel of changed) {
        const m = /^hypervideos\/[^/]+\//.exec(rel);
        if (m && dirs[m[0]] !== undefined) { ids.add(dirs[m[0]]); }
    }
    return ids;
}


/* ---------------------------------------------------------------------- */
/*  Problems                                                              */
/* ---------------------------------------------------------------------- */

/*
 * A problem is { severity: 'error' | 'warning', file, line?, col?, pointer?, label?, rule?, message, key }: file relative to the _data folder, or the page's name; pointer a JSON Pointer into the file (for a page: into its data block's bundle); key tells it apart from other problems without its position, so that a problem of the baseline is recognised after a change.
 */
function problem(fields) {
    const found = Object.assign({ severity: 'error' }, fields);
    if (!found.key) { found.key = JSON.stringify([found.file, (found.pointer === undefined) ? null : found.pointer, found.message]); }
    return found;
}

function lineCol(text, index) {
    const before = text.slice(0, index);
    return { line: before.split('\n').length, col: index - before.lastIndexOf('\n') };
}

// { value } or, for text that is no JSON, { error, index }: the message without where (Node 20 and 22 word it differently) and the position.
function parseJSON(text) {
    try {
        return { value: JSON.parse(text) };
    } catch (e) {
        const at = /at position (\d+)/.exec(e.message);
        return {
            error: e.message.replace(/, ".*" is not valid JSON$/s, '').replace(/ in JSON at position \d+.*$/s, ''),
            index: at ? Number(at[1]) : text.length
        };
    }
}

function schemaProblems(file, schema, value) {
    return ft().validator.validate(schema, value).map((e) => problem({ file, pointer: e.path, message: e.message }));
}

// A WebVTT time stamp as FrameTrail's parser (vtt.js) reads it: h:mm:ss.ttt or mm:ss.ttt, a dot and three digits.
function vttSeconds(stamp) {
    const m = /^(\d+):(\d{2})(?::(\d{2}))?\.(\d{3})$/.exec(stamp);
    if (!m) { return null; }
    return (m[3] !== undefined)
        ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
        : Number(m[1]) * 60 + Number(m[2]) + Number(m[4]) / 1000;
}

/**
 * What keeps FrameTrail from showing subtitles: a first line other than "WEBVTT", cue timings its parser does not read, cues that end at or before their start. [{ line, message }]
 */
export function vttProblems(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n'),
          found = [];
    if (lines[0].charCodeAt(0) === 0xFEFF) { lines[0] = lines[0].slice(1); }
    if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0])) {
        found.push({ line: 1, message: 'Does not start with the line "WEBVTT"; FrameTrail reads no subtitles from it.' });
    }
    lines.forEach((line, i) => {
        if (!line.includes('-->')) { return; }
        const m     = /^\s*(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t].*)?$/.exec(line),
              start = m && vttSeconds(m[1]),
              end   = m && vttSeconds(m[2]);
        if (start === null || end === null || !m) {
            found.push({ line: i + 1, message: 'The cue timing "' + line.trim() + '" is not mm:ss.ttt --> mm:ss.ttt or hh:mm:ss.ttt --> hh:mm:ss.ttt (a dot before exactly three digits); FrameTrail skips the cue.' });
        } else if (end <= start) {
            found.push({ line: i + 1, message: 'The cue ends at or before its start (' + m[1] + ' --> ' + m[2] + '); it is never shown.' });
        }
    });
    return found;
}

/**
 * The problems of a root's state: its files (syntax, schema, WebVTT; for a page its data block), FrameTrailLint.checkFolder, and the lint rules for the hypervideos in options.hypervideos (a Set of ids; null: all). options.duration(file) gives the length of a local media file in seconds, for clips that do not say.
 */
export function problemsOf(state, { hypervideos = null, duration = () => undefined } = {}) {
    return (state.kind === 'folder') ? folderProblems(state, hypervideos, duration) : pageProblems(state, hypervideos, duration);
}

// One file of a _data folder: JSON syntax and schema, or WebVTT. { problems, value, bad }
function folderFileProblems(rel, text) {
    if (rel.endsWith('.json')) {
        const parsed = parseJSON(text);
        if ('error' in parsed) {
            return { problems: [problem(Object.assign({ file: rel, message: 'Is not valid JSON: ' + parsed.error }, lineCol(text, parsed.index)))], bad: true };
        }
        const schema   = ft().Serializer.schemaOfFile(rel),
              problems = schema ? schemaProblems(rel, schema, parsed.value) : [];
        return { problems, value: parsed.value, bad: problems.length > 0 };
    }
    const problems = rel.endsWith('.vtt') ? vttProblems(text).map((p) => problem({ file: rel, line: p.line, col: 1, message: p.message })) : [];
    return { problems, value: text, bad: false };
}

function folderProblems(state, only, duration) {

    const { Lint } = ft(),
          problems = [],
          files    = {},
          bad      = new Set();

    for (const rel of Object.keys(state.texts).sort()) {
        const checked = folderFileProblems(rel, state.texts[rel]);
        problems.push(...checked.problems);
        files[rel] = ('value' in checked) ? checked.value : state.texts[rel];
        if (checked.bad) { bad.add(rel); }
    }

    // Invalid JSON is reported above, with its position.
    for (const p of Lint.checkFolder(files)) {
        if (!/^Is not valid JSON/.test(p.message)) { problems.push(problem({ file: p.path, message: p.message })); }
    }

    // Lint reads data that follows the schemas only: hypervideos with a bad file are left to the problems above.
    if (bad.has('hypervideos/_index.json') || bad.has('resources/_index.json')) { return problems; }
    const valid = {};
    for (const rel of Object.keys(files)) { if (!bad.has(rel)) { valid[rel] = files[rel]; } }

    const place = (finding, dir) => {
        if (finding.kind === 'annotations') {
            const file = dir + 'annotations/' + finding.creator + '.json';
            return { file: (file in files) ? file : dir + 'annotations/' };
        }
        if (finding.kind === 'subtitles') { return { file: dir + 'subtitles/' + subtitleFile(files[dir + 'hypervideo.json'], finding.ref) }; }
        return { file: dir + 'hypervideo.json' };
    };

    return problems.concat(lintProblems(state, valid, (dir) => [...bad].some((rel) => rel.startsWith(dir)), only, duration, place, 'hypervideos/_index.json'));

}

// The file name of a hypervideo's subtitles in a language, as hypervideo.json lists it.
function subtitleFile(hypervideo, lang) {
    const entry = ((hypervideo && Array.isArray(hypervideo.subtitles)) ? hypervideo.subtitles : []).find((e) => e && e.srclang === lang);
    return (entry && entry.src) || lang + '.vtt';
}

/**
 * A page's data block on its own: a raw "<" in it, JSON, the bundle's schema, the subtitles it carries. { problems, files, kind, valid }: files is its folder map (null when it cannot be read), valid whether the bundle follows its schema.
 */
function blockProblems(state) {

    const page     = path.basename(state.root),
          problems = [],
          done     = () => ({ problems, files: null, kind: null, valid: false });

    if (state.block === null) {
        problems.push(problem({ file: page, message: 'Has no FrameTrail data block (<script type="application/ld+json" data-frametrail="project">) any more; FrameTrail cannot open it.' }));
        return done();
    }

    const start = state.html ? blockStart(state.html, state.block) : -1,
          at    = (index) => (start >= 0) ? lineCol(state.html, start + index) : lineCol(state.block, index);

    const lt = state.block.indexOf('<');
    if (lt >= 0) {
        problems.push(problem(Object.assign({
            file:    page,
            message: 'The data block contains "<" (' + (state.block.split('<').length - 1) + ' in all). FrameTrail writes every "<" in it as \\u003c, so that no text in the block can end it or start an HTML comment; `node "' + SCRIPT + '" --escape <page>` rewrites them so.',
            key:     JSON.stringify([page, 'raw <'])
        }, at(lt))));
    }

    const parsed = parseJSON(state.block);
    if ('error' in parsed) {
        // A "</script" typed into a string ends the block there, in the middle of the JSON.
        const cut = !/[}\]]\s*$/.test(state.block) ? ' The block may end early: a "</script" inside it ends it, so write that as <\\/script.' : '';
        problems.push(problem(Object.assign({ file: page, message: 'The data block is not valid JSON: ' + parsed.error + '.' + cut }, at(parsed.index))));
        return done();
    }

    const kind = parsed.value && parsed.value.bundle;
    if (kind !== 'project' && kind !== 'hypervideo') {
        problems.push(problem({ file: page, pointer: '/bundle', message: 'The data block holds no bundle: "bundle" must be "project" or "hypervideo".' }));
        return done();
    }

    const invalid = schemaProblems(page, kind + '-bundle.schema.json', parsed.value);
    problems.push(...invalid);

    const files = folderMapOf(state);
    if (!files) {
        problems.push(problem({ file: page, message: 'FrameTrail cannot read the data block as a project.' }));
        return done();
    }

    const pointerOf = bundlePointers(files, kind);
    for (const rel of Object.keys(files).filter((rel) => rel.endsWith('.vtt')).sort()) {
        for (const p of vttProblems(files[rel])) {
            problems.push(problem({ file: page, pointer: pointerOf(rel), message: 'Line ' + p.line + ' of the subtitles: ' + p.message }));
        }
    }

    return { problems, files, kind, valid: !invalid.length };

}

function pageProblems(state, only, duration) {

    const { Lint } = ft(),
          page     = path.basename(state.root),
          block    = blockProblems(state),
          problems = block.problems;

    if (!block.files) { return problems; }

    const files     = block.files,
          pointerOf = bundlePointers(files, block.kind);

    for (const p of Lint.checkFolder(files)) {
        problems.push(problem({ file: page, pointer: pointerOf(p.path), message: p.path + ': ' + p.message }));
    }

    if (!block.valid) { return problems; }

    const place = (finding, dir) => {
        const base = pointerOf(dir + 'hypervideo.json').replace(/\/hypervideo$/, '');
        if (finding.kind === 'annotations') { return { file: page, pointer: base + '/annotations/files' }; }
        if (finding.kind === 'subtitles')   { return { file: page, pointer: base + '/subtitles/' + finding.ref }; }
        return { file: page, pointer: base + '/hypervideo' };
    };

    return problems.concat(lintProblems(state, files, () => false, only, duration, place, page));

}

/**
 * Paths of a page's folder map → JSON Pointers into its data block's bundle (hypervideos/9/hypervideo.json → /hypervideos/9/hypervideo in a project bundle, /hypervideo in a hypervideo bundle).
 */
function bundlePointers(files, kind) {
    const ids   = idsByDir(files),
          token = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');
    return (rel) => {
        if (rel === 'hypervideos/_index.json') { return (kind === 'project') ? '/hypervideosIndex' : ''; }
        if (rel === 'resources/_index.json')   { return '/resources'; }
        if (rel === 'config.json')             { return (kind === 'project') ? '/config' : ''; }
        if (rel === 'tagdefinitions.json')     { return '/tagdefinitions'; }
        if (rel === 'custom.css')              { return '/customCSS'; }
        const m = /^(hypervideos\/([^/]+)\/)(.*)$/.exec(rel);
        if (!m) { return ''; }
        const base = (kind === 'project') ? '/hypervideos/' + token((ids[m[1]] !== undefined) ? ids[m[1]] : m[2]) : '',
              rest = m[3];
        let n;
        if (rest === 'hypervideo.json')              { return base + '/hypervideo'; }
        if (rest === 'annotations/_index.json')      { return base + '/annotations/index'; }
        if ((n = /^annotations\/([^/]+)\.json$/.exec(rest))) { return base + '/annotations/files/' + token(n[1]); }
        if ((n = /^subtitles\/(.+)$/.exec(rest))) {
            const list  = (files[m[1] + 'hypervideo.json'] || {}).subtitles,
                  entry = (Array.isArray(list) ? list : []).find((e) => e && (e.src || e.srclang + '.vtt') === n[1]);
            return base + '/subtitles/' + token(entry ? entry.srclang : n[1].replace(/\.vtt$/, ''));
        }
        return base;
    };
}

/*
 * The lint rules on the hypervideos of a folder map (project bundle through FrameTrailHTMLFormat.projectBundle, as FrameTrail reads a project). skip(dir) leaves a hypervideo out; place(finding, dir, id) says where a finding is.
 */
function lintProblems(state, files, skip, only, duration, place, indexFile) {

    const { Lint, HTMLFormat } = ft();

    let bundle;
    try {
        bundle = HTMLFormat.projectBundle(files);
    } catch (e) {
        return [problem({ file: indexFile, message: 'FrameTrail cannot read the hypervideos: ' + e.message })];
    }

    const entries  = (bundle.hypervideosIndex && bundle.hypervideosIndex.hypervideos) || {},
          problems = [];

    for (const id of Object.keys(bundle.hypervideos)) {

        const dir = hypervideoDir(entries[id]);
        if (!dir || (only && !only.has(id)) || skip(dir)) { continue; }

        const parts  = Lint.partsOf(bundle, { hypervideoId: id, duration: duration(mediaFileOf(state, bundle, id)) }),
              result = Lint.run(parts),
              name   = ((bundle.hypervideos[id].hypervideo || {}).meta || {}).name;

        for (const finding of result.findings) {
            problems.push(problem(Object.assign(place(finding, dir, id), {
                severity: finding.severity,
                label:    'hypervideo ' + id + (name ? ' "' + name + '"' : '') + ', ' + labelOf(finding, parts),
                rule:     finding.rule,
                message:  finding.message,
                key:      JSON.stringify(['lint', id, finding.rule, finding.kind, (finding.ref === undefined) ? null : finding.ref, finding.creator || null, finding.message])
            })));
        }

    }

    return problems;

}

// What a lint finding is about, in words: "overlay "Welcome" (text, created …)", "chapter "Results" at 250 s".
function labelOf(finding, parts) {
    const quote = (s) => '"' + s + '"',
          find  = (list) => (list || []).find((item) => item.created === finding.ref && (finding.kind !== 'annotations' || (item.creator && item.creator.id === finding.creator))),
          named = (item, what, by) => {
              const body = (item && item.body) || {}, name = body['frametrail:name'];
              return what + (name ? ' ' + quote(name) : '') + (by || '') + ' (' + [body['frametrail:type'], 'created ' + finding.ref].filter(Boolean).join(', ') + ')';
          };
    switch (finding.kind) {
        case 'overlays':     return named(find(parts.overlays), 'overlay');
        case 'annotations':  return named(find(parts.annotations), 'annotation', ' by ' + finding.creator);
        case 'codeSnippets': return 'code snippet (created ' + finding.ref + ')';
        case 'chapters': {
            const chapter = (parts.chapters || []).find((c) => c.start === finding.ref);
            return 'chapter ' + ((chapter && chapter.title) ? quote(chapter.title) + ' ' : '') + 'at ' + finding.ref + ' s';
        }
        case 'subtitles':    return 'subtitles ' + quote(finding.ref);
        default:             return 'the hypervideo';
    }
}

/**
 * The local media file whose length lint needs, or null: the video of a hypervideo's first clip, when the clip says neither its out point nor its duration and the video is a file (folder: resources/<src>; page: <datapath>resources/<src> beside the page, _data/ without a datapath), not a URL.
 */
function mediaFileOf(state, bundle, id) {
    const hypervideo = bundle.hypervideos[id].hypervideo || {},
          clip       = Array.isArray(hypervideo.clips) ? hypervideo.clips[0] : null;
    if (!clip || clip.out > 0 || clip.duration > 0) { return null; }
    let src = (typeof clip.src === 'string' && clip.src.length > 3) ? clip.src : null;
    if (!src && clip.resourceId != null) {
        const resource = ((bundle.resources || {}).resources || {})[clip.resourceId];
        src = resource && resource.src;
    }
    if (typeof src !== 'string' || !src || isURL(src)) { return null; }
    if (state.kind === 'folder') { return path.join(state.root, 'resources', src); }
    if (state.datapath && isURL(state.datapath)) { return null; }
    return path.resolve(path.dirname(state.root), state.datapath || '_data/', 'resources', src);
}

/**
 * Lengths of media files by ffprobe, if it is installed: file → seconds or undefined. cache (a session's) keeps them by path, modification time and size.
 */
function mediaDurations(cache) {
    return (file) => {
        if (!file || !isFile(file)) { return undefined; }
        const stat = fs.statSync(file),
              key  = file + '|' + stat.mtimeMs + '|' + stat.size;
        if (cache && key in cache) { return (cache[key] === null) ? undefined : cache[key]; }
        let seconds = null;
        try {
            const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
            seconds = (parseFloat(out) > 0) ? parseFloat(out) : null;
        } catch (e) {}
        if (cache) { cache[key] = seconds; }
        return (seconds === null) ? undefined : seconds;
    };
}

/**
 * Problems as lines, grouped by file, errors first:
 *
 *     hypervideos/1/hypervideo.json
 *       error  /chapters/0/start: must be number, is string
 */
export function formatProblems(problems, { limit = Infinity } = {}) {
    const sorted = problems.slice().sort((a, b) => (a.severity === b.severity) ? 0 : (a.severity === 'error') ? -1 : 1),
          shown  = sorted.slice(0, limit),
          groups = new Map(),
          lines  = [];
    for (const p of shown) {
        if (!groups.has(p.file)) { groups.set(p.file, []); }
        groups.get(p.file).push(p);
    }
    for (const [file, list] of groups) {
        lines.push(file);
        for (const p of list) {
            const where = [(p.line !== undefined) ? 'line ' + p.line + ':' + p.col : '', (p.pointer !== undefined) ? (p.pointer || '(the whole document)') : '', p.label || ''].filter(Boolean).join(', ');
            lines.push('  ' + p.severity + '  ' + (where ? where + ': ' : '') + p.message + (p.rule ? ' [' + p.rule + ']' : ''));
        }
    }
    if (sorted.length > shown.length) { lines.push('… and ' + (sorted.length - shown.length) + ' more'); }
    return lines.join('\n');
}


/* ---------------------------------------------------------------------- */
/*  Sessions                                                              */
/* ---------------------------------------------------------------------- */

const sessionsDir = () => path.join(process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'frametrail-skills'), 'sessions');
const sessionDir  = (session) => path.join(sessionsDir(), String(session || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_'));
const recordFile  = (session, root) => path.join(sessionDir(session), crypto.createHash('sha1').update(root).digest('hex').slice(0, 16) + '.json');

function readRecord(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function writeRecord(file, record) {
    const temp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(record));
    fs.renameSync(temp, file);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * The session's record of a root, { root, kind, baseline, reported, durations }, made at its first touch with baseline = makeBaseline() (null: not known). Hooks of tool calls running in parallel agree on one record: the first takes a lock, the others wait for its record.
 */
function sessionRecord(session, found, makeBaseline) {

    const file = recordFile(session, found.root),
          lock = file + '.lock';

    let record = readRecord(file);
    if (record) { return { file, record }; }

    fs.mkdirSync(path.dirname(file), { recursive: true });

    for (const deadline = Date.now() + LOCK_WAIT_MS; ;) {
        try {
            fs.closeSync(fs.openSync(lock, 'wx'));
            break;
        } catch (e) {
            if (e.code !== 'EEXIST') { throw e; }
            if ((record = readRecord(file))) { return { file, record }; }
            // A hook that died holding the lock.
            if (Date.now() > deadline) { fs.rmSync(lock, { force: true }); } else { sleep(25); }
        }
    }

    try {
        record = readRecord(file);
        if (!record) {
            record = { root: found.root, kind: found.kind, baseline: makeBaseline(), reported: [], durations: {} };
            writeRecord(file, record);
            removeOldSessions();
        }
    } finally {
        fs.rmSync(lock, { force: true });
    }

    return { file, record };

}

function removeOldSessions() {
    const limit = Date.now() - SESSION_DAYS * 24 * 3600 * 1000;
    for (const name of fs.readdirSync(sessionsDir())) {
        const dir = path.join(sessionsDir(), name);
        try { if (fs.statSync(dir).mtimeMs < limit) { fs.rmSync(dir, { recursive: true, force: true }); } } catch (e) {}
    }
}


/* ---------------------------------------------------------------------- */
/*  Hooks                                                                 */
/* ---------------------------------------------------------------------- */

// The file a Write, Edit or MultiEdit call writes, absolute.
function targetOf(input) {
    const file = input && input.tool_input && input.tool_input.file_path;
    return (typeof file === 'string' && file) ? path.resolve(input.cwd || process.cwd(), file) : null;
}

// A root as Claude should read it: relative to the session's folder when inside it.
function shown(root, cwd) {
    const rel = cwd ? path.relative(cwd, root) : '';
    return (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) ? rel : root;
}

function hookPre(input) {

    const target = targetOf(input),
          found  = target && findRoot(target);
    if (!found) { return {}; }

    sessionRecord(input.session_id, found, () => {
        const state = readState(found.root, found.kind);
        return state ? snapshotOf(state) : null;
    });

    const server = (found.kind === 'folder') && serverInstance(found.root);
    if (!server) { return {}; }

    return { stdout: JSON.stringify({ hookSpecificOutput: {
        hookEventName:            'PreToolUse',
        permissionDecision:       'ask',
        permissionDecisionReason: shown(found.root, input.cwd) + ' is the data folder of a FrameTrail server (' + server + '). FrameTrail\'s editors do not notice changes made to these files behind them: an editor open on the server saves over this change, and it bypasses accounts and locks. Edit it in FrameTrail, or export a project file and work on that. Allow only when no FrameTrail editor is using this folder.'
    } }) };

}

// The problems of the one file a tool call changed.
function changedFileProblems(found, target) {
    if (found.kind === 'file') {
        const state = readState(found.root, 'file');
        // The block alone: the folder check and lint wait for the end of the turn.
        return state ? blockProblems(state).problems : [];
    }
    const rel = path.relative(found.root, target).split(path.sep).join('/'),
          text = readText(target);
    if (text === null || rel === 'users.json' || !/\.(json|vtt)$/.test(rel)) { return []; }
    return folderFileProblems(rel, text).problems;
}

function hookPost(input) {

    const target = targetOf(input);
    if (!target) { return {}; }

    let found = findRoot(target);
    if (!found) {
        // A page whose data block this change removed.
        if (!/\.html?$/i.test(target) || !readRecord(recordFile(input.session_id, target))) { return {}; }
        found = { kind: 'file', root: target };
    }

    sessionRecord(input.session_id, found, () => null);

    const name = (found.kind === 'file') ? shown(found.root, input.cwd) : path.relative(found.root, target).split(path.sep).join('/');

    // A page's data block in the form FrameTrail writes: what is typed as \u003c into Write and Edit tends to arrive as "<".
    let note = '';
    if (found.kind === 'file') {
        const html    = readText(found.root),
              escaped = (html !== null) && escapeBlock(html);
        if (escaped) {
            fs.writeFileSync(found.root, escaped.html);
            note = 'FrameTrail check: wrote the ' + escaped.count + ' "<" in the data block of ' + name + ' as \\u003c, as FrameTrail writes them. Read the lines again before your next Edit of the page. An Edit whose old_string contains \\u003c does not match (what you type as \\u003c arrives as "<"): anchor it on the text around.';
        }
    }

    const problems = changedFileProblems(found, target).filter((p) => p.severity === 'error');
    if (!problems.length) {
        return note ? { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } }) } : {};
    }

    return {
        code:   2,
        stderr: (note ? note + '\n\n' : '') +
                'FrameTrail check of ' + name + (found.kind === 'folder' ? ' in ' + shown(found.root, input.cwd) : '') + ': FrameTrail may not load it as it is.\n' +
                formatProblems(problems, { limit: POST_LIMIT }) + '\n' +
                'Fix this now.'
    };

}

function hookStop(input) {

    const dir = sessionDir(input.session_id);
    let names;
    try { names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort(); } catch (e) { return {}; }

    const sections = [];
    let errors = 0, left = STOP_LIMIT, hidden = 0;

    for (const name of names) {

        const file   = path.join(dir, name),
              record = readRecord(file);
        if (!record) { continue; }

        const current = readState(record.root, record.kind);
        if (!current) { fs.rmSync(file, { force: true }); continue; }

        const before   = baselineState(record, current),
              only     = touchedHypervideos(before, current),
              duration = mediaDurations(record.durations),
              known    = new Set(before ? problemsOf(before, { hypervideos: only, duration }).map((p) => p.key) : []),
              reported = new Set(record.reported),
              fresh    = problemsOf(current, { hypervideos: only, duration }).filter((p) => !known.has(p.key) && !reported.has(p.key));

        record.reported = [...reported, ...fresh.map((p) => p.key)];
        writeRecord(file, record);

        if (!fresh.length) { continue; }

        errors += fresh.filter((p) => p.severity === 'error').length;
        if (left > 0) {
            sections.push('In ' + shown(record.root, input.cwd) + ':\n' + formatProblems(fresh, { limit: left }));
        } else {
            hidden += fresh.length;
        }
        left -= fresh.length;

    }

    if (!sections.length) { return {}; }

    const text = sections.join('\n\n') + (hidden ? '\n… and ' + hidden + ' more' : '') + '\n\n' +
                 'Fix what your changes caused. If something is meant to be as it is, tell the user why. Problems that were there before your changes are not listed; `node "' + SCRIPT + '" <folder or page>` lists everything.';

    return errors
        ? { stdout: JSON.stringify({ decision: 'block', reason: 'FrameTrail found problems in the data you changed.\n\n' + text }) }
        : { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'FrameTrail warns about the data you changed.\n\n' + text } }) };

}


/* ---------------------------------------------------------------------- */
/*  By hand                                                               */
/* ---------------------------------------------------------------------- */

function byHand(target) {

    const found = findRoot(target);
    if (!found) {
        return { code: 2, stderr: 'Not FrameTrail data: ' + target + '\nA _data folder has config.json and hypervideos/_index.json; a project file is an HTML page with a FrameTrail data block.' };
    }

    const problems = problemsOf(readState(found.root, found.kind), { duration: mediaDurations(null) }),
          errors   = problems.filter((p) => p.severity === 'error').length,
          warnings = problems.length - errors,
          count    = (n, what) => n + ' ' + what + (n === 1 ? '' : 's');

    return {
        code:   errors ? 1 : 0,
        stdout: found.root + (found.kind === 'file' ? ' (project file)' : ' (_data folder)') + '\n' +
                (problems.length ? formatProblems(problems) + '\n' + count(errors, 'error') + ', ' + count(warnings, 'warning') + '.' : 'No problems found.')
    };

}


/* ---------------------------------------------------------------------- */

/**
 * The script's answer to its arguments, { code, stdout, stderr }. stdin() reads a hook's input.
 */
export function run(argv, stdin) {
    const hook = (argv.find((arg) => arg.startsWith('--hook=')) || '').slice('--hook='.length);
    if (hook) {
        const handler = { pre: hookPre, post: hookPost, stop: hookStop }[hook];
        if (!handler) { return { code: 1, stderr: 'check.mjs: no hook "' + hook + '"' }; }
        let input;
        try { input = JSON.parse(stdin()); } catch (e) { return { code: 1, stderr: 'check.mjs: the hook\'s input is no JSON' }; }
        return handler(input);
    }
    const target = argv.find((arg) => !arg.startsWith('--'));
    if (!target) { return { code: 2, stderr: 'Usage: node check.mjs <_data folder | project page.html>\n       node check.mjs --escape <project page.html>' }; }
    return argv.includes('--escape') ? escapeByHand(target) : byHand(target);
}

// --escape: a page's data block with every "<" written as \u003c.
function escapeByHand(target) {
    const found = findRoot(target);
    if (!found || found.kind !== 'file') { return { code: 2, stderr: 'Not a project file: ' + target }; }
    const escaped = escapeBlock(fs.readFileSync(found.root, 'utf8'));
    if (!escaped) {
        const block = ft().HTMLFormat.firstBlockText(fs.readFileSync(found.root, 'utf8'));
        return block.includes('<')
            ? { code: 1, stderr: 'The data block of ' + target + ' is not valid JSON; fix that first (node check.mjs ' + target + ').' }
            : { stdout: 'The data block of ' + target + ' has no "<".' };
    }
    fs.writeFileSync(found.root, escaped.html);
    return { stdout: 'Wrote the ' + escaped.count + ' "<" in the data block of ' + target + ' as \\u003c.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
    let result;
    try {
        result = run(process.argv.slice(2), () => fs.readFileSync(0, 'utf8'));
    } catch (e) {
        result = { code: 1, stderr: 'FrameTrail check failed: ' + ((e && e.stack) || e) };
    }
    if (result.stdout) { process.stdout.write(result.stdout + '\n'); }
    if (result.stderr) { process.stderr.write(result.stderr + '\n'); }
    process.exitCode = result.code || 0;
}

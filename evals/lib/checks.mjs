/*
 * The checks of the evaluation: what must hold in a run's workspace (and in Claude's final message) after a case, as its expect.json lists them. The vocabulary is the one of the Conversational UI add-on's evaluation (noChanges, answer, chapter, chapters, item, layout, lint errors), reimplemented over the files with the vendored FrameTrail, plus a few for what only files show.
 *
 *     { "setup": "lecture-folder", "root": "_data", "hypervideo": "1", "checks": [ { "chapter": { "from": 510, "to": 510, "title": "^summary$" } }, { "valid": true } ] }
 *
 * root is where the data is, relative to the workspace (a _data folder or a page); hypervideo the one the checks look at: an id, or { "name": "<pattern>" }. Patterns are regular expressions, matched ignoring case; ranges are [low, high], both included.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readState, problemsOf, resourcesDir, probeMedia, formatProblems } from '../../plugin/scripts/check.mjs';

const require = createRequire(import.meta.url);
const VENDOR  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin', 'vendor', 'frametrail');

const HTMLFormat = require(path.join(VENDOR, 'serialization', 'FrameTrailHTMLFormat.js'));
const Lint       = require(path.join(VENDOR, 'serialization', 'FrameTrailLint.js'));

export const CHECKS = ['valid', 'escaped', 'noChanges', 'answer', 'chapter', 'noChapter', 'chapters', 'item', 'noItem', 'layout', 'subtitles', 'hypervideo', 'file'];

const pattern = (text) => new RegExp(text, 'i');
const within  = (value, range) => typeof value === 'number' && value >= range[0] && value <= range[1];
const isFile  = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };

function pathValue(object, dotted) {
    return dotted.split('.').reduce((value, key) => (value === null || value === undefined) ? undefined : value[key], object);
}


/* ---------------------------------------------------------------------- */
/*  The data of a workspace                                               */
/* ---------------------------------------------------------------------- */

/**
 * A workspace's data as the checks read it: { root, kind, state, files, bundle } or { error }. files is the folder map (JSON parsed), bundle the project bundle FrameTrail makes of it.
 */
export function readData(workspace, rel) {
    if (!rel) { return { error: 'the case names no data' }; }
    const root = path.join(workspace, rel),
          kind = /\.html?$/i.test(rel) ? 'file' : 'folder';
    if (!fs.existsSync(root)) { return { error: rel + ' does not exist' }; }
    const state = readState(root, kind);
    if (!state) { return { error: rel + ' is no FrameTrail ' + (kind === 'file' ? 'project file' : '_data folder') }; }
    try {
        let files;
        if (kind === 'folder') {
            files = {};
            for (const [file, text] of Object.entries(state.texts)) { files[file] = file.endsWith('.json') ? JSON.parse(text) : text; }
        } else {
            files = HTMLFormat.readProject(state.html).files;
        }
        return { root, kind, state, files, bundle: HTMLFormat.projectBundle(files) };
    } catch (e) {
        return { error: 'FrameTrail cannot read ' + rel + ': ' + e.message };
    }
}

// The hypervideo a check looks at, by id or by name: { id, entry } or null.
function hypervideoOf(bundle, which) {
    const ids = Object.keys(bundle.hypervideos || {});
    if (which && typeof which === 'object') {
        const id = ids.find((id) => pattern(which.name).test(String(((bundle.hypervideos[id].hypervideo || {}).meta || {}).name || '')));
        return (id === undefined) ? null : { id, entry: bundle.hypervideos[id] };
    }
    const id = String(which || '1');
    return bundle.hypervideos[id] ? { id, entry: bundle.hypervideos[id] } : null;
}

function itemsOf(entry, kind) {
    if (kind === 'overlays') {
        return ((entry.hypervideo || {}).contents || []).filter((item) => item && item['frametrail:type'] === 'Overlay');
    }
    const files = (entry.annotations || {}).files || {};
    return Object.values(files).flatMap((list) => Array.isArray(list) ? list : []);
}

// What an item check looks at.
function described(item) {
    const body       = item.body || {},
          attributes = body['frametrail:attributes'] || {},
          selector   = (item.target || {}).selector || {},
          span       = Lint.timeSpan(selector.value) || {};
    return {
        type:       body['frametrail:type'],
        name:       body['frametrail:name'] || '',
        start:      span.start,
        end:        span.end,
        box:        Lint.box(selector.value),
        text:       [attributes.title, attributes.text, attributes.question, body.value].filter((t) => typeof t === 'string' && t).map((t) => Lint.plainText(t)).join(' '),
        attributes,
        keyframes:  Array.isArray(selector['frametrail:keyframes']) ? selector['frametrail:keyframes'] : [],
        by:         (item.creator || {}).nickname || ''
    };
}

// The hue of a CSS colour, in degrees, or null (a few names, #rgb, #rrggbb, rgb()).
const NAMED = { yellow: '#ffff00', gold: '#ffd700', orange: '#ffa500', red: '#ff0000', green: '#008000', blue: '#0000ff', white: '#ffffff', black: '#000000' };
function hueOf(colour) {
    let c = String(colour || '').trim().toLowerCase();
    if (NAMED[c]) { c = NAMED[c]; }
    let rgb = null, m;
    if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c))) { rgb = m.slice(1).map((h) => parseInt(h + h, 16)); }
    else if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(c))) { rgb = m.slice(1).map((h) => parseInt(h, 16)); }
    else if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(c))) { rgb = m.slice(1).map(Number); }
    if (!rgb) { return null; }
    const [r, g, b] = rgb.map((v) => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d < 0.15) { return null; }
    const h = (max === r) ? ((g - b) / d) % 6 : (max === g) ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
}

function itemMiss(entry, want) {
    if (want.type && entry.type !== want.type) { return 'type ' + entry.type; }
    if (want.name && !pattern(want.name).test(entry.name)) { return 'name ' + JSON.stringify(entry.name); }
    if (want.by && !pattern(want.by).test(entry.by)) { return 'by ' + JSON.stringify(entry.by); }
    if (want.start && !within(entry.start, want.start)) { return 'start ' + entry.start; }
    if (want.end && !within(entry.end, want.end)) { return 'end ' + entry.end; }
    if (want.text && !pattern(want.text).test(entry.text)) { return 'text ' + JSON.stringify(entry.text); }
    for (const [dotted, expected] of Object.entries(want.attributes || {})) {
        const value = pathValue(entry.attributes, dotted);
        let ok;
        if (expected && typeof expected === 'object' && expected.hue) { const hue = hueOf(value); ok = hue !== null && within(hue, expected.hue); }
        else if (expected && typeof expected === 'object') { ok = pattern(expected.matches).test(String(value)); }
        else { ok = String(value) === String(expected); }
        if (!ok) { return dotted + ' ' + JSON.stringify(value); }
    }
    for (const [side, range] of Object.entries(want.box || {})) {
        if (!within(entry.box ? entry.box[side] : undefined, range)) { return 'box.' + side + ' ' + (entry.box ? entry.box[side] : 'none'); }
    }
    if (want.keyframes) {
        const k = entry.keyframes, first = k[0], last = k[k.length - 1];
        if (k.length < (want.keyframes.min || 2)) { return k.length + ' keyframes'; }
        const x = (f) => f && Array.isArray(f.xywh) ? f.xywh[0] : NaN, y = (f) => f && Array.isArray(f.xywh) ? f.xywh[1] : NaN;
        if (want.keyframes.right && !(x(last) > x(first))) { return 'keyframes x ' + x(first) + ' → ' + x(last); }
        if (want.keyframes.down && !(y(last) > y(first))) { return 'keyframes y ' + y(first) + ' → ' + y(last); }
    }
    return null;
}


/* ---------------------------------------------------------------------- */
/*  The checks                                                            */
/* ---------------------------------------------------------------------- */

// check.mjs's problem for a raw "<" in a page's data block.
const RAW_LT = /^The data block contains "<"/;

// Lengths of local media, for the time rules (as check.mjs does with ffprobe).
const duration = (file) => (file && isFile(file) && (probeMedia(file) || {}).duration) || undefined;

// A folder map (or a page's) in a form two states can be compared in.
const canonical = (files) => JSON.stringify(Object.keys(files || {}).sort().map((file) => [file, files[file]]));

const RUN = {

    // FrameTrail's checks find no error: the files (JSON, schemas, a page's block), the folder check, lint. A raw "<" in a page's block is left to escaped: FrameTrail reads such a block as long as no "</script" or "<!--" is in it.
    valid(want, ctx) {
        const errors = problemsOf(ctx.data.state, { duration }).filter((p) => p.severity === 'error' && !RAW_LT.test(p.message));
        return errors.length ? errors.length + ' error' + (errors.length === 1 ? '' : 's') + ':\n' + formatProblems(errors, { limit: 5 }) : null;
    },

    // A page's data block as FrameTrail writes it (docs/HTML-FORMAT.md): every "<" as \u003c.
    escaped(want, ctx) {
        if (ctx.data.kind !== 'file') { return 'not a project file'; }
        const block = ctx.data.state.block || '', n = block.split('<').length - 1;
        return n ? 'the data block holds ' + n + ' raw "<"' : null;
    },

    // The data is as the setup made it.
    noChanges(want, ctx) {
        if (!ctx.before || ctx.before.error) { return 'the data before cannot be read: ' + (ctx.before ? ctx.before.error : 'none given'); }
        const a = ctx.before.files, b = ctx.data.files;
        if (canonical(a) === canonical(b)) { return null; }
        const changed = [...new Set(Object.keys(a).concat(Object.keys(b)))].filter((file) => JSON.stringify(a[file]) !== JSON.stringify(b[file]));
        return 'changed: ' + changed.join(', ');
    },

    answer(want, ctx) {
        return pattern(want).test(ctx.message || '') ? null : 'the answer lacks /' + want + '/';
    },

    chapter(want, ctx, negated) {
        const chapters = (ctx.hypervideo.entry.hypervideo || {}).chapters || [],
              hits     = chapters.filter((c) => within(c.start, [want.from, want.to]) && (!want.title || pattern(want.title).test(c.title || '')));
        const list = chapters.map((c) => c.start + ' ' + c.title).join(' | ');
        if (negated) { return hits.length ? 'a chapter in [' + want.from + ', ' + want.to + ']: ' + hits.map((c) => c.start + ' ' + c.title).join(' | ') : null; }
        return hits.length ? null : 'no chapter in [' + want.from + ', ' + want.to + ']' + (want.title ? ' titled /' + want.title + '/' : '') + '; chapters: ' + list;
    },

    chapters(want, ctx) {
        const n = ((ctx.hypervideo.entry.hypervideo || {}).chapters || []).length;
        return (n >= want.min && n <= want.max) ? null : n + ' chapters';
    },

    item(want, ctx, negated) {
        const entries = itemsOf(ctx.hypervideo.entry, want.kind || 'overlays').map(described),
              misses  = entries.map((entry) => itemMiss(entry, want)),
              hit     = misses.some((miss) => miss === null);
        if (negated) { return hit ? 'the item is there' : null; }
        if (hit) { return null; }
        const typed = entries.map((entry, i) => [entry, misses[i]]).filter(([entry]) => !want.type || entry.type === want.type);
        return 'no such item; ' + (typed.length ? 'closest: ' + typed.slice(-3).map(([entry, miss]) => (entry.name || entry.type) + ' (' + miss + ')').join(' / ') : 'no ' + (want.type || '') + ' ' + (want.kind || 'overlays'));
    },

    layout(want, ctx) {
        const area  = 'area' + want.area.charAt(0).toUpperCase() + want.area.slice(1),
              views = ((((ctx.hypervideo.entry.hypervideo || {}).config || {}).layoutArea || {})[area]) || [],
              types = views.map((v) => v && v.type),
              at    = types.indexOf(want.includes);
        if (at < 0) { return want.area + ': ' + (types.join(', ') || 'nothing'); }
        if (want.after !== undefined && !(types.indexOf(want.after) >= 0 && types.indexOf(want.after) < at)) { return want.area + ': ' + types.join(', ') + ' (' + want.includes + ' not after ' + want.after + ')'; }
        if (want.html && !views.some((v) => v.type === want.includes && pattern(want.html).test(String(v.html || '')))) {
            return want.includes + '.html: ' + views.filter((v) => v.type === want.includes).map((v) => JSON.stringify(v.html)).join(' / ');
        }
        return null;
    },

    // Subtitles in a language: the entry in the hypervideo and cues at the times given (± 0.05 s), with text matching.
    subtitles(want, ctx) {
        const entries = (ctx.hypervideo.entry.hypervideo || {}).subtitles || [];
        if (!entries.some((e) => e && e.srclang === want.lang)) { return 'no subtitles entry for "' + want.lang + '": ' + entries.map((e) => e.srclang).join(', '); }
        const text = (ctx.hypervideo.entry.subtitles || {})[want.lang];
        if (typeof text !== 'string') { return 'no WebVTT text for "' + want.lang + '"'; }
        const cues = Lint.cues(text) || [];
        for (const cue of want.cues || []) {
            if (!cues.some((c) => Math.abs(c.start - cue.start) <= 0.05 && Math.abs(c.end - cue.end) <= 0.05 && pattern(cue.text).test(c.text))) {
                return 'no cue ' + cue.start + ' → ' + cue.end + ' /' + cue.text + '/; cues: ' + cues.map((c) => c.start + '→' + c.end + ' ' + c.text).join(' | ');
            }
        }
        return null;
    },

    // A hypervideo whose name matches and whose video is a file in the root's resources, the same as the given file.
    hypervideo(want, ctx) {
        const found = hypervideoOf(ctx.data.bundle, { name: want.name });
        if (!found) { return 'no hypervideo named /' + want.name + '/: ' + Object.values(ctx.data.bundle.hypervideos || {}).map((h) => ((h.hypervideo || {}).meta || {}).name).join(', '); }
        if (!want.video) { return null; }
        const clip = (((found.entry.hypervideo || {}).clips) || [])[0] || {};
        let src = clip.src;
        if (!src && clip.resourceId != null) { src = ((((ctx.data.bundle.resources || {}).resources) || {})[clip.resourceId] || {}).src; }
        if (!src) { return 'its clip has no video'; }
        if (/^[a-z][a-z0-9+.-]*:|^\//i.test(src)) { return 'its video is a URL: ' + src; }
        const dir  = resourcesDir(ctx.data.state),
              file = dir && path.join(dir, src);
        if (!file || !isFile(file)) { return 'its video ' + src + ' is not in the resources folder (' + (dir || 'none') + ')'; }
        const source = path.join(ctx.workspace, want.video);
        return (isFile(source) && fs.readFileSync(file).equals(fs.readFileSync(source))) ? null : 'its video ' + src + ' is not ' + want.video;
    },

    // A JSON file of the workspace: the value at a JSON Pointer matches.
    file(want, ctx) {
        let value;
        try { value = JSON.parse(fs.readFileSync(path.join(ctx.workspace, want.path), 'utf8')); } catch (e) { return want.path + ': ' + e.message; }
        for (const token of want.pointer.split('/').slice(1)) { value = (value === null || value === undefined) ? undefined : value[token.replace(/~1/g, '/').replace(/~0/g, '~')]; }
        return pattern(want.matches).test(String(value)) ? null : want.path + want.pointer + ': ' + JSON.stringify(value);
    }

};

/**
 * Grades a workspace against a case's expect.json: { passed, results: [{ check, passed, reason }] }. message is Claude's final message; before the data as the setup made it (readData of a fresh build), for noChanges.
 */
export function grade(expect, { workspace, message = '', before = null }) {

    const data    = expect.root ? readData(workspace, expect.root) : null,
          results = [];

    for (const check of expect.checks) {
        const [name] = Object.keys(check),
              want   = check[name];
        let reason;
        try {
            if (!CHECKS.includes(name)) { throw new Error('unknown check ' + name); }
            if (name === 'answer' || name === 'file') {
                reason = RUN[name](want, { workspace, message });
            } else if (!data || data.error) {
                reason = data ? data.error : 'the case names no data';
            } else {
                const hypervideo = hypervideoOf(data.bundle, expect.hypervideo);
                const needs      = !['valid', 'escaped', 'noChanges', 'hypervideo'].includes(name);
                if (needs && !hypervideo) {
                    reason = 'no hypervideo ' + JSON.stringify(expect.hypervideo || '1');
                } else {
                    const negated = name === 'noChapter' || name === 'noItem';
                    reason = RUN[negated ? name.charAt(2).toLowerCase() + name.slice(3) : name](want, { workspace, message, data, before, hypervideo }, negated);
                }
            }
        } catch (e) {
            reason = 'the check failed: ' + e.message;
        }
        results.push({ check: name + (typeof want === 'object' && want ? ' ' + JSON.stringify(want) : (want === true ? '' : ' ' + JSON.stringify(want))), passed: !reason, reason: reason || null });
    }

    return { passed: results.every((r) => r.passed), results };

}

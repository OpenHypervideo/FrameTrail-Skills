/*
 * Adds a media file or a media URL to the library of FrameTrail data (a _data folder, or a project file), as FrameTrail's editor does when a file is uploaded or a URL added, and prints what to write where it is used. Node 20 or later, no dependencies; ffprobe and ffmpeg (FFmpeg) are used when installed.
 *
 *     node add-media.mjs <_data folder | page.html> <file | URL> --user "<name>" [--user-id <id>] [--name "<name>"] [--license <type>] [--attribution "<text>"]
 *
 * - A file is copied into the root's resources/ folder (a page's: the resources/ folder of its datapath, with "./" beside the page), named as FrameTrail names uploads in a local folder: <user id>_<milliseconds>_<name>.<extension>. A file already in that folder is registered as it is. With ffprobe its length and size are printed, and with ffmpeg a video gets what FrameTrail's server makes for it: a thumbnail (a frame at half its length, at most 600 pixels wide) and the scrub previews of the progress bar (<name>_scrub.jpg beside it).
 * - A URL is registered as it is, nothing is fetched: YouTube and Vimeo in their embed form, files by their extension. A URL the library has already is not added again.
 * - The entry goes under the next id into resources/_index.json, or into the page's data block (resources of its bundle), with the user as creator: --user is the name entered in FrameTrail, its id that of a guest of that name (user-id.mjs) unless --user-id says otherwise. --license is one of the editor's licence types.
 *
 * Prints the entry, the clip that makes it a hypervideo's video, the body of an item made from it, and the problems the check finds that were not there before. Exit 0 when added (or there already), 1 when the check finds new errors, 2 when refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, serverInstance, readState, resourcesDir, probeMedia, problemsOf, formatProblems } from './check.mjs';

const require = createRequire(import.meta.url);
const SCRIPT  = fileURLToPath(import.meta.url);
const VENDOR  = path.join(path.dirname(SCRIPT), '..', 'vendor', 'frametrail');

const Serializer = require(path.join(VENDOR, 'serialization', 'FrameTrailSerializer.js'));
const HTMLFormat = require(path.join(VENDOR, 'serialization', 'FrameTrailHTMLFormat.js'));
const Schema     = require(path.join(VENDOR, 'schema', 'FrameTrailSchema.js'));
const validator  = Schema.create(require(path.join(VENDOR, 'schema', 'FrameTrailSchemas.js')));

const USAGE = 'Usage: node add-media.mjs <_data folder | page.html> <file | URL> --user "<name>" [--user-id <id>] [--name "<name>"] [--license <type>] [--attribution "<text>"]';

// Media files by extension: what browsers play and FrameTrail's types describe.
const FILE_TYPES = {
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
    video: ['mp4', 'm4v', 'webm'],
    audio: ['mp3', 'm4a', 'ogg', 'wav'],
    pdf:   ['pdf']
};

// Media URLs by extension (HLS playlists too).
const URL_TYPES = Object.assign({}, FILE_TYPES, { video: FILE_TYPES.video.concat('m3u8') });

// The licence types FrameTrail's resource editor offers.
export const LICENSES = ['Copyright', 'CC-BY', 'CC-BY-SA', 'CC-BY-ND', 'CC-BY-NC', 'CC-BY-NC-SA', 'CC-BY-NC-ND', 'CC0'];

// What can be a hypervideo's video (its first clip).
const CLIP_TYPES = ['video', 'youtube', 'vimeo'];

const refuse = (message) => ({ code: 2, stderr: message });

const typeOfExtension = (table, file) => {
    const ext = path.extname(file).slice(1).toLowerCase();
    return Object.keys(table).find((type) => table[type].includes(ext)) || null;
};

// A name as FrameTrail puts it into a file name.
const sanitize = (name) => name.replace(/[^a-zA-Z0-9_\-]/g, '_');

/**
 * The resource a URL makes, as FrameTrail's "add URL" makes it, { type, src, thumb? }, or null for a URL that is no media this script knows.
 */
export function urlResource(url) {
    let m;
    for (const pattern of [/youtube\.com\/watch\?(?:[^#]*&)?v=([^&?\/#]+)/, /youtube\.com\/embed\/([^&?\/#]+)/, /youtube\.com\/v\/([^&?\/#]+)/, /youtu\.be\/([^&?\/#]+)/]) {
        if ((m = pattern.exec(url))) {
            const start = /[?&#]t=(\d+)/.exec(url);
            return { type: 'youtube', src: 'https://www.youtube.com/embed/' + m[1] + (start ? '?start=' + start[1] : ''), thumb: 'https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg' };
        }
    }
    if ((m = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)\/?$/.exec(url) || /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/.exec(url))) {
        return { type: 'vimeo', src: 'https://player.vimeo.com/video/' + m[1] };
    }
    let pathname;
    try { pathname = new URL(url).pathname; } catch (e) { return null; }
    const type = typeOfExtension(URL_TYPES, pathname);
    if (!type) { return null; }
    return (type === 'image') ? { type, src: url, thumb: url } : { type, src: url };
}

/**
 * The library of a root, read for a change: { entries, nextId(), save() }. entries is the map of resources by id; save() writes it back (a _data folder's resources/_index.json, a page's data block), through a temporary file. Throws an Error with a message for the user when the library cannot be read.
 */
function libraryOf(found) {

    if (found.kind === 'folder') {
        const file = path.join(found.root, 'resources', '_index.json');
        let index = { 'resources-increment': 0, 'resources': {} };
        if (fs.existsSync(file)) {
            try { index = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error('resources/_index.json is not valid JSON; fix it first (node check.mjs ' + found.root + ').'); }
        }
        if (!index || typeof index !== 'object' || Array.isArray(index)) { throw new Error('resources/_index.json holds no resources index; fix it first.'); }
        if (!index.resources || Array.isArray(index.resources)) { index.resources = {}; }
        return withIndex(index, index.resources, () => writeAtomic(file, JSON.stringify(index, null, 4)));
    }

    const html = fs.readFileSync(found.root, 'utf8');
    let bundle;
    try {
        bundle = HTMLFormat.parse(html)[0].bundle;
    } catch (e) {
        throw new Error('The data block of ' + found.root + ' cannot be read (' + e.message + '); fix it first (node check.mjs ' + found.root + ').');
    }
    const save = () => writeAtomic(found.root, HTMLFormat.replaceBlock(html, bundle));
    if (bundle && bundle.bundle === 'project') {
        if (!bundle.resources || typeof bundle.resources !== 'object') { bundle.resources = { 'resources-increment': 0, 'resources': {} }; }
        if (!bundle.resources.resources || Array.isArray(bundle.resources.resources)) { bundle.resources.resources = {}; }
        return withIndex(bundle.resources, bundle.resources.resources, save);
    }
    if (bundle && bundle.bundle === 'hypervideo') {
        // A hypervideo bundle carries the entries it uses, keyed by id, without an increment.
        if (!bundle.resources || typeof bundle.resources !== 'object' || Array.isArray(bundle.resources)) { bundle.resources = {}; }
        return withIndex(null, bundle.resources, save);
    }
    throw new Error('The data block of ' + found.root + ' holds no bundle; fix it first.');

}

function withIndex(index, entries, save) {
    return {
        entries,
        // The next id: above the increment and above every id there is (a folder FrameTrail made has no increment yet).
        nextId() {
            const ids  = Object.keys(entries).map(Number).filter(Number.isInteger),
                  next = Math.max(index ? (parseInt(index['resources-increment'], 10) || 0) : 0, ...ids, 0) + 1;
            if (index) { index['resources-increment'] = next; }
            return String(next);
        },
        save
    };
}

function writeAtomic(file, text) {
    const temp = path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.tmp');
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
}

/**
 * A video's thumbnail as FrameTrail's server makes it with ffmpeg: a frame at half its length (2 s when unknown), at most 600 pixels wide, as PNG. Whether it was made.
 */
function makeThumbnail(video, target, duration) {
    try {
        execFileSync('ffmpeg', ['-v', 'error', '-n', '-ss', String((duration > 0) ? duration / 2 : 2), '-i', video, '-frames:v', '1', '-vf', "scale='min(600,iw)':-2", target], { timeout: 60000, stdio: 'ignore' });
        return fs.existsSync(target) && fs.statSync(target).size > 0;
    } catch (e) {
        fs.rmSync(target, { force: true });
        return false;
    }
}

/**
 * A video's scrub previews as FrameTrail's server makes them with ffmpeg: 25 frames spread over its length, 320 × 180 each, tiled 5 × 5 into one JPEG beside the video, <video without extension>_scrub.jpg, where the player looks for it. The file, or null.
 */
function makeScrubSprite(video, duration) {
    const target = video.replace(/\.[^.\/]+$/, '') + '_scrub.jpg';
    if (!(duration > 0)) { return null; }
    try {
        execFileSync('ffmpeg', ['-v', 'error', '-n', '-i', video, '-vf', 'fps=' + (25 / duration).toFixed(6) + ',scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,tile=5x5', '-frames:v', '1', '-update', '1', '-q:v', '5', target], { timeout: 300000, stdio: 'ignore' });
        return (fs.existsSync(target) && fs.statSync(target).size > 0) ? target : null;
    } catch (e) {
        fs.rmSync(target, { force: true });
        return null;
    }
}

const seconds = (s) => (Math.round(s * 1000) / 1000) + ' s';

/**
 * The script's answer to its arguments, { code, stdout, stderr }.
 */
export function run(argv) {

    let values, positionals;
    try {
        ({ values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
            'user': { type: 'string' }, 'user-id': { type: 'string' }, 'name': { type: 'string' }, 'license': { type: 'string' }, 'attribution': { type: 'string' }
        } }));
    } catch (e) {
        return refuse(e.message + '\n' + USAGE);
    }
    if (positionals.length !== 2) { return refuse(USAGE); }

    const [rootArg, media] = positionals,
          found            = findRoot(rootArg);
    if (!found) {
        return refuse('Not FrameTrail data: ' + rootArg + '\nA _data folder has config.json and hypervideos/_index.json; a project file is an HTML page with a FrameTrail data block. create-project.mjs makes either.');
    }
    if (found.kind === 'folder') {
        const server = serverInstance(found.root);
        if (server) {
            return refuse(found.root + ' is the data folder of a FrameTrail server (' + server + '). Its editors do not notice files changed behind them, and uploads there go through FrameTrail: add the media in FrameTrail.');
        }
    }

    // Who adds it.
    const userName = (values.user || '').trim();
    if (!userName) { return refuse('--user is missing: the name the user enters in FrameTrail, the creator of the resource.\n' + USAGE); }
    const userId = (values['user-id'] !== undefined) ? values['user-id'].trim() : Serializer.guestUserID(userName);
    if (!userId || /[\/\\\0]/.test(userId) || userId === '.' || userId === '..') { return refuse('--user-id "' + values['user-id'] + '" cannot be part of a file name.'); }

    let license = null;
    if (values.license !== undefined) {
        license = LICENSES.find((type) => type.toLowerCase() === values.license.trim().toLowerCase().replace(/\s+/g, '-'));
        if (!license) { return refuse('--license is one of ' + LICENSES.join(', ') + ' (not "' + values.license + '").'); }
    }
    const attribution = (values.attribution || '').trim() || null;

    const state    = readState(found.root, found.kind),
          isURL    = /^https?:\/\//i.test(media),
          before   = problemsOf(state);

    let library;
    try { library = libraryOf(found); } catch (e) { return refuse(e.message); }

    const stamp = Date.now();
    let resource, source = null, dir = null;

    if (isURL) {

        resource = urlResource(media);
        if (!resource) {
            return refuse('Not a media URL add-media knows: ' + media + '\nIt takes YouTube and Vimeo videos and URLs of image, video (also HLS), audio and PDF files. A web page, a Wikipedia article or another embed goes straight into an item\'s body (see the type in TYPES.md).');
        }
        if (!values.name || !values.name.trim()) { return refuse('--name is missing: what the library calls this ' + resource.type + '.'); }
        resource.name = values.name.trim();

    } else {

        source = path.resolve(media);
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) { return refuse('No such file: ' + media); }
        const type = typeOfExtension(FILE_TYPES, source);
        if (!type) {
            return refuse('Not a media file add-media takes: ' + path.basename(source) + '\nIt takes ' + Object.keys(FILE_TYPES).map((t) => t + ' (' + FILE_TYPES[t].join(', ') + ')').join(', ') + '. Convert a video first, e.g. ffmpeg -i in.mov -c:v libx264 -c:a aac out.mp4.');
        }
        dir = resourcesDir(state);
        if (!dir) {
            return refuse('The media of ' + found.root + ' are on a server (its datapath is ' + state.datapath + '): a file cannot go there from here. Upload it there, or give its URL.');
        }
        const name = (values.name && values.name.trim()) || path.basename(source).replace(/\.[^.]+$/, '');
        // A file already in the library's folder is registered as it is.
        resource = { type, name, src: (path.dirname(source) === dir) ? path.basename(source) : (userId + '_' + stamp + '_' + sanitize(name)).substring(0, 90) + path.extname(source).toLowerCase() };

    }

    // A source the library has already.
    const known = Object.keys(library.entries).find((id) => library.entries[id] && library.entries[id].src === resource.src);
    if (known !== undefined) {
        return { code: 0, stdout: 'Already in the library as resource ' + known + ', nothing added:\n' + JSON.stringify(library.entries[known], null, 4) };
    }

    const copied = [],
          remove = () => { for (const file of copied) { fs.rmSync(file, { force: true }); } };
    let probed = null, sprite = null;

    if (source) {
        const file = path.join(dir, resource.src);
        if (file !== source) {
            fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(source, file, fs.constants.COPYFILE_EXCL);
            copied.push(file);
        }
        if (resource.type !== 'pdf') { probed = probeMedia(file); }
        if (resource.type === 'video') {
            const thumb = (userId + '_' + stamp + '_thumb_' + sanitize(resource.name)).substring(0, 90) + '.png';
            if (makeThumbnail(file, path.join(dir, thumb), probed && probed.duration)) {
                resource.thumb = thumb;
                copied.push(path.join(dir, thumb));
            }
            if ((sprite = makeScrubSprite(file, probed && probed.duration))) { copied.push(sprite); }
        }
    }

    const entry = { name: resource.name, type: resource.type, src: resource.src };
    if (resource.thumb) { entry.thumb = resource.thumb; }
    Object.assign(entry, { creator: userName, creatorId: userId, created: Math.floor(stamp / 1000) });
    if (license)     { entry.licenseType = license; }
    if (attribution) { entry.licenseAttribution = attribution; }
    entry.attributes = {};

    const invalid = validator.validate('resources-index.schema.json#/$defs/resource', entry);
    if (invalid.length) {
        remove();
        return { code: 1, stderr: 'add-media made an entry FrameTrail would not read; nothing added:\n' + invalid.map((e) => '  ' + (e.path || '(entry)') + ': ' + e.message).join('\n') };
    }

    const id = library.nextId();
    library.entries[id] = entry;
    try {
        library.save();
    } catch (e) {
        remove();
        throw e;
    }

    // What to tell.
    const where = (found.kind === 'folder') ? 'resources/_index.json' : 'the data block of ' + path.basename(found.root),
          lines = ['Added resource ' + id + ' to the library of ' + found.root + ' (' + where + '):', JSON.stringify(entry, null, 4)];

    if (source) {
        lines.push((copied.includes(path.join(dir, entry.src)) ? 'Copied ' + source + ' to ' : 'Registered the file as it is: ') + path.join(dir, entry.src));
        if (probed) {
            const facts = [(probed.duration && entry.type !== 'image') ? 'length ' + seconds(probed.duration) : '', probed.width ? probed.width + ' × ' + probed.height + ' pixels' : ''].filter(Boolean);
            if (facts.length) { lines.push('ffprobe: ' + facts.join(', ') + '.'); }
        }
        if (entry.thumb) { lines.push('Thumbnail: ' + path.join(dir, entry.thumb)); }
        if (sprite)      { lines.push('Scrub previews (the player finds them by name): ' + sprite); }
    }

    if (CLIP_TYPES.includes(entry.type)) {
        lines.push('As a hypervideo\'s video, its first clip (duration 0: FrameTrail reads it from the media):',
                   JSON.stringify({ resourceId: id, src: entry.src, duration: 0, in: 0, out: 0 }) +
                   (entry.thumb ? '\nand in its meta: "thumb": ' + JSON.stringify(entry.thumb) : ''));
    }

    const body = Serializer.serializeOverlay({
        type: entry.type, src: entry.src, name: entry.name, thumb: entry.thumb,
        licenseType: entry.licenseType, licenseAttribution: entry.licenseAttribution, resourceId: id, attributes: {}
    }).body;
    lines.push('As the body of an overlay or an annotation that shows it:', JSON.stringify(body, null, 4));
    if (!license) { lines.push('It has no licence type: lint warns about overlays made from it. When the user names one, set licenseType in the entry and frametrail:licenseType in such bodies.'); }

    if (found.kind === 'file') { lines.push('The page has changed: read it again before your next Edit of it.'); }

    const after    = problemsOf(readState(found.root, found.kind)),
          knownKey = new Set(before.map((p) => p.key)),
          fresh    = after.filter((p) => !knownKey.has(p.key));
    lines.push(fresh.length ? 'FrameTrail check, new problems:\n' + formatProblems(fresh) : 'FrameTrail check: no new problems.');

    return { code: fresh.some((p) => p.severity === 'error') ? 1 : 0, stdout: lines.join('\n') };

}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
    let result;
    try {
        result = run(process.argv.slice(2));
    } catch (e) {
        result = { code: 1, stderr: 'add-media failed: ' + ((e && e.stack) || e) };
    }
    if (result.stdout) { process.stdout.write(result.stdout + '\n'); }
    if (result.stderr) { process.stderr.write(result.stderr + '\n'); }
    process.exitCode = result.code || 0;
}

/*
 * The workspaces the evaluation's cases start from, built into a folder (the run's workspace, by scaffold.mjs; a temporary folder, by the grader, to know what was there before). Everything but the media is deterministic.
 *
 * The data is FrameTrail's lecture data set (tests/fixtures/frametrail-bundles/lecture.json, vendored from FrameTrail): a 10-minute cell biology lecture with chapters, overlays, annotations by Ada and Grace, a transcript. Its video is a real file of that length, so that its length can be found as in a real folder.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VENDOR  = path.join(ROOT, 'plugin', 'vendor', 'frametrail');

const Serializer = require(path.join(VENDOR, 'serialization', 'FrameTrailSerializer.js'));
const HTMLFormat = require(path.join(VENDOR, 'serialization', 'FrameTrailHTMLFormat.js'));
const RELEASE    = require(path.join(VENDOR, 'package.json')).frametrailRelease || null;

export const BUNDLES = path.join(ROOT, 'tests', 'fixtures', 'frametrail-bundles');
export const CACHE   = path.join(ROOT, 'evals', '.cache');

// The lecture's video, as its clip and its resource name it.
const LECTURE_VIDEO = '1_1790000000_lecture-3.mp4';

/**
 * A video of the given length in seconds: grey, 160 × 90, one frame a second, silent; made once with ffmpeg and kept in evals/.cache/. With placeholder, bytes that stand for one (for the tests, which need no ffmpeg).
 */
export function video(seconds, { placeholder = false } = {}) {
    if (placeholder) { return Buffer.from('a placeholder for a ' + seconds + ' s video'); }
    const file = path.join(CACHE, 'grey-' + seconds + 's.mp4');
    if (!fs.existsSync(file)) {
        fs.mkdirSync(CACHE, { recursive: true });
        const temp = file + '.' + process.pid + '.mp4';
        try {
            execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x808080:s=160x90:r=1:d=' + seconds, '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-an', temp], { stdio: ['ignore', 'ignore', 'pipe'] });
        } catch (e) {
            fs.rmSync(temp, { force: true });
            throw new Error('The evaluation makes its videos with ffmpeg, which failed or is not installed: ' + ((e.stderr && String(e.stderr).trim()) || e.message));
        }
        fs.renameSync(temp, file);
    }
    return fs.readFileSync(file);
}

/**
 * The lecture as the files of a _data folder (the serializer's folder format: JSON as values, subtitles as text).
 */
export function lectureFiles() {
    const bundle = JSON.parse(fs.readFileSync(path.join(BUNDLES, 'lecture.json'), 'utf8')),
          files  = Serializer.writeBundle(bundle, 'folder', { id: '1' });
    files['config.json']             = {};
    files['hypervideos/_index.json'] = { 'hypervideo-increment': 1, 'hypervideos': { '1': './1' } };
    files['tagdefinitions.json']     = {};
    return files;
}

// Files written as FrameTrail writes them: JSON with four spaces, text as it is.
function writeFiles(dir, files) {
    for (const rel of Object.keys(files).sort()) {
        const target = path.join(dir, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, (typeof files[rel] === 'string' || Buffer.isBuffer(files[rel])) ? files[rel] : JSON.stringify(files[rel], null, 4));
    }
}

/**
 * The setups, by name: (dir, options) → builds the workspace in dir. root is where the data is, relative to the workspace.
 */
export const SETUPS = {

    // A _data folder with the lecture and its video.
    'lecture-folder': {
        root: '_data',
        build(dir, options) {
            writeFiles(path.join(dir, '_data'), lectureFiles());
            writeFiles(dir, { ['_data/resources/' + LECTURE_VIDEO]: video(600, options) });
        }
    },

    // The same, and a new video beside it.
    'lecture-folder+video': {
        root: '_data',
        build(dir, options) {
            SETUPS['lecture-folder'].build(dir, options);
            writeFiles(dir, { 'field-recording.mp4': video(30, options) });
        }
    },

    // The lecture as a project file, course.html, with its video in resources/ beside it.
    'lecture-page': {
        root: 'course.html',
        build(dir, options) {
            writeFiles(dir, {
                'course.html': HTMLFormat.writeProject(lectureFiles(), null, { library: HTMLFormat.cdnLibrary(RELEASE), datapath: './', title: 'Cell Biology' }),
                ['resources/' + LECTURE_VIDEO]: video(600, options)
            });
        }
    },

    // Only a video: the project is still to be made.
    'video-only': {
        root: null,
        build(dir, options) {
            writeFiles(dir, { 'field-trip.mp4': video(10, options) });
        }
    },

    // No FrameTrail at all: a small Node program.
    'node-app': {
        root: null,
        build(dir) {
            writeFiles(dir, {
                'package.json': { name: 'greeter', version: '1.0.0', type: 'module', main: 'index.js', scripts: { start: 'node index.js' } },
                'index.js':     'export function greet(name) {\n    return \'Hello, \' + name + \'!\';\n}\n\nconsole.log(greet(\'world\'));\n'
            });
        }
    }

};

/**
 * Builds a setup into dir (which must exist).
 */
export function build(name, dir, options = {}) {
    const setup = SETUPS[name];
    if (!setup) { throw new Error('No setup "' + name + '"; there are ' + Object.keys(SETUPS).join(', ')); }
    setup.build(dir, options);
}

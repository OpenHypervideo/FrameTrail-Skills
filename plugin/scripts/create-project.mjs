/*
 * A new FrameTrail project without hypervideos, made as FrameTrail makes one: a _data folder, or a project file (one HTML page in FrameTrail's portable format). Node 20 or later, no dependencies.
 *
 *     node create-project.mjs --folder <dir> [--title "<title>"] [--language en|de|fr]
 *     node create-project.mjs --file <page.html> [--title "<title>"] [--language en|de|fr]
 *
 * The folder holds FrameTrailHTMLFormat.emptyProject() as files; FrameTrail opens it in Chrome or Edge ("Open a Project" → Select Folder). The page is what FrameTrail's "New Project File" writes: the empty project in its data block, datapath "./" (media in a resources/ folder beside the page), and FrameTrail loaded from jsDelivr at the release the vendored scripts are based on (frametrailRelease in ../vendor/frametrail/package.json).
 *
 * --title names the project (config.overviewTitle; for a page also its <title>, else the file name), --language is the language of FrameTrail's interface (config.defaultLanguage). Nothing is overwritten: the folder must be empty or new, the page empty or new. Exit 0 when made, 1 when the check finds a problem in what was made, 2 when refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readState, problemsOf, formatProblems } from './check.mjs';

const require = createRequire(import.meta.url);
const SCRIPT  = fileURLToPath(import.meta.url);
const VENDOR  = path.join(path.dirname(SCRIPT), '..', 'vendor', 'frametrail');

const HTMLFormat = require(path.join(VENDOR, 'serialization', 'FrameTrailHTMLFormat.js'));
const Schemas    = require(path.join(VENDOR, 'schema', 'FrameTrailSchemas.js'));
const RELEASE    = require(path.join(VENDOR, 'package.json')).frametrailRelease || null;

const USAGE = 'Usage: node create-project.mjs --folder <dir> [--title "<title>"] [--language <code>]\n' +
              '       node create-project.mjs --file <page.html> [--title "<title>"] [--language <code>]';

// The interface languages FrameTrail has, as its config schema lists them.
export const LANGUAGES = Schemas.find((schema) => /\/config\.schema\.json$/.test(schema.$id)).properties.defaultLanguage.enum;

const refuse = (message) => ({ code: 2, stderr: message });

// Whether a folder holds anything but dot-files (.git, .DS_Store).
const hasContent = (dir) => fs.readdirSync(dir).some((name) => !name.startsWith('.'));

/**
 * The files of a new project: FrameTrail's empty project, with the title and the interface language in config.json.
 */
export function projectFiles({ title, language } = {}) {
    const files = HTMLFormat.emptyProject();
    if (title)    { files['config.json'].overviewTitle = title; }
    if (language) { files['config.json'].defaultLanguage = language; }
    return files;
}

function createFolder(dir, files) {
    if (fs.existsSync(dir)) {
        if (!fs.statSync(dir).isDirectory()) { return refuse(dir + ' is a file, not a folder.'); }
        if (hasContent(dir)) { return refuse(dir + ' is not empty; nothing was written. A new _data folder needs an empty or new folder.'); }
    }
    for (const rel of Object.keys(files).sort()) {
        const target = path.join(dir, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(files[rel], null, 4), { flag: 'wx' });
    }
    return null;
}

function createPage(file, files, title) {
    if (!/\.html?$/i.test(file)) { return refuse('A project file is an HTML page: ' + file + ' does not end in .html.'); }
    let flag = 'wx';
    if (fs.existsSync(file)) {
        if (!fs.statSync(file).isFile()) { return refuse(file + ' is a folder, not a file.'); }
        if (fs.statSync(file).size > 0) { return refuse(file + ' exists; nothing was written. A new project file needs an empty or new file.'); }
        flag = 'w';
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, HTMLFormat.writeProject(files, null, {
        library:  HTMLFormat.cdnLibrary(RELEASE),
        datapath: './',
        title:    title || path.basename(file).replace(/\.html?$/i, '')
    }), { flag });
    return null;
}

/**
 * The script's answer to its arguments, { code, stdout, stderr }.
 */
export function run(argv) {

    let values;
    try {
        ({ values } = parseArgs({ args: argv, options: { folder: { type: 'string' }, file: { type: 'string' }, title: { type: 'string' }, language: { type: 'string' } } }));
    } catch (e) {
        return refuse(e.message + '\n' + USAGE);
    }

    if (!values.folder === !values.file) { return refuse('Give either --folder or --file.\n' + USAGE); }
    if (values.language && !LANGUAGES.includes(values.language)) {
        return refuse('--language is the language of FrameTrail\'s interface, one of ' + LANGUAGES.join(', ') + ' (not "' + values.language + '"). The language of the video goes into its subtitles.');
    }

    const files  = projectFiles({ title: values.title, language: values.language }),
          kind   = values.folder ? 'folder' : 'file',
          target = path.resolve(values.folder || values.file),
          failed = (kind === 'folder') ? createFolder(target, files) : createPage(target, files, values.title);
    if (failed) { return failed; }

    const problems = problemsOf(readState(target, kind)),
          lines    = [];

    if (kind === 'folder') {
        lines.push('Created the _data folder ' + target + ': ' + Object.keys(files).sort().join(', ') + '.');
    } else {
        lines.push('Created the project file ' + target + ', which loads FrameTrail ' + (RELEASE || '(the latest release)') + ' from jsDelivr. Media files go into ' + path.join(path.dirname(target), 'resources') + path.sep + ' (add-media.mjs puts them there).');
    }
    lines.push(problems.length ? 'FrameTrail check:\n' + formatProblems(problems) : 'FrameTrail check: no problems.');
    lines.push((kind === 'folder')
        ? 'FrameTrail opens it in Chrome or Edge: "Open a Project" → Select Folder, and choose this folder.'
        : 'It opens in any browser, also from the disk; it needs a network connection to load FrameTrail. In Chrome or Edge FrameTrail can also save into it: edit mode, then Save ("Save to this file").');

    return { code: problems.some((p) => p.severity === 'error') ? 1 : 0, stdout: lines.join('\n') };

}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
    let result;
    try {
        result = run(process.argv.slice(2));
    } catch (e) {
        result = { code: 1, stderr: 'create-project failed: ' + ((e && e.stack) || e) };
    }
    if (result.stdout) { process.stdout.write(result.stdout + '\n'); }
    if (result.stderr) { process.stderr.write(result.stderr + '\n'); }
    process.exitCode = result.code || 0;
}

/*
 * The evaluation (evals/): runs the cases with `claude plugin eval`, with the plugin and without it, then grades what each run left in its workspace against the case's expect.json (evals/lib/checks.mjs) and summarises. `claude plugin eval` has no grader that runs a program, so the runs keep their workspaces (--keep-temp) and are graded here; its own graders only tell whether the skill fired (and, in the no-fire case, that it did not).
 *
 *     node dev/eval.mjs [--tag <tag> …] [--case <glob> …] [--runs <n>] [--model opus] [-j <n>] [--no-baseline] [--keep] [--readme]
 *     node dev/eval.mjs --grade <results dir> [--readme]               # grade a run again, from the copies of its workspaces
 *     node dev/eval.mjs --table <results dir> … [--readme]            # one table from several runs (batches by tag), runs of a case pooled
 *
 * --no-baseline leaves out the runs without the plugin (half the runs): for checking the plugin after a change, when the baseline is known.
 *
 * Each run's workspace (without its large files) and trace are copied into the results (runs/<case>/<arm>-<n>/), for reading and for grading again; the CLI's kept folders are removed unless --keep.
 *
 * Every agent run uses the account Claude Code is logged in with: on a Pro or Max plan it costs no money but draws on the plan's usage limits (the CLI's costUsd is what the API would charge). A run cut off by such a limit counts as "not run", never as a failure; run it again with --case. Results: evals/results/<time>/ (the CLI's aggregate-result.json and report.html, and summary.json from here); git-ignored.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from '../evals/lib/setups.mjs';
import { grade, readData } from '../evals/lib/checks.mjs';

const ROOT    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVALS   = path.join(ROOT, 'evals');
const RESULTS = path.join(EVALS, 'results');
const README  = path.join(EVALS, 'README.md');
const MARKERS = ['<!-- results:start -->', '<!-- results:end -->'];

// Run errors that mean the run did not happen as a test of the plugin: the account's limits, the service.
const NOT_RUN = /usage limit|session limit|weekly limit|hit your [a-z ]*limit|rate.?limit|\b429\b|quota|overloaded|\b529\b|credit balance|unauthori[sz]ed|not logged in/i;


/* ---------------------------------------------------------------------- */
/*  Running                                                               */
/* ---------------------------------------------------------------------- */

/**
 * The Claude Code binary: CLAUDE_BIN, else the newest of `claude` on the PATH and the ones Cursor or VS Code extensions carry (an old global install may come first on the PATH, and `plugin eval` is recent).
 */
export function claudeBinary() {
    if (process.env.CLAUDE_BIN) { return process.env.CLAUDE_BIN; }
    const candidates = ['claude'];
    for (const base of ['.cursor', '.vscode'].map((dir) => path.join(os.homedir(), dir, 'extensions'))) {
        let found = [];
        try { found = fs.readdirSync(base).filter((d) => /^anthropic\.claude-code-/.test(d)); } catch (e) {}
        candidates.push(...found.map((dir) => path.join(base, dir, 'resources', 'native-binary', 'claude')).filter((binary) => fs.existsSync(binary)));
    }
    const versioned = candidates.map((binary) => {
        const r = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 20000 }),
              m = (r.status === 0) && /^(\d+)\.(\d+)\.(\d+)/.exec(String(r.stdout).trim());
        return m ? { binary, version: m.slice(1).map(Number) } : null;
    }).filter(Boolean).sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2]);
    if (!versioned.length) { throw new Error('No Claude Code found: set CLAUDE_BIN, or put claude on the PATH.'); }
    return versioned[0].binary;
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
}

/**
 * Runs `claude plugin eval` on the suite into a new results folder, which it returns.
 */
async function runSuite({ tag = [], caseGlob, runs, model, concurrency, baseline = true }) {
    const dir  = path.join(RESULTS, stamp() + (tag.length ? '-' + tag.join('-') : '') + (caseGlob ? '-' + caseGlob.replace(/[^a-z0-9]+/gi, '_') : '')),
          args = ['plugin', 'eval', '.', '--scaffold', '--keep-temp', '--trust-plugin', '--no-publish', '--ablation', baseline ? 'with-without' : 'none', '--threshold', '0',
                  '--model', model, '-j', String(concurrency), '--output-dir', dir,
                  ...tag.flatMap((t) => ['--tag', t]), ...(caseGlob ? ['--case', caseGlob] : []), ...(runs ? ['--runs', String(runs)] : []),
                  '--allow-tools', 'Bash', 'Edit', 'Write'];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'command.json'), JSON.stringify({ model, tag, case: caseGlob || null, runs: runs || null, concurrency, baseline, args }, null, 4));
    console.log('Running: claude ' + args.join(' '));
    const code = await new Promise((resolve) => {
        const child = spawn(claudeBinary(), args, { cwd: ROOT, stdio: 'inherit' });
        child.on('close', resolve);
    });
    if (!fs.existsSync(path.join(dir, 'aggregate-result.json'))) { throw new Error('claude plugin eval wrote no aggregate-result.json (exit ' + code + ') into ' + dir); }
    return dir;
}


/* ---------------------------------------------------------------------- */
/*  Grading                                                               */
/* ---------------------------------------------------------------------- */

/**
 * The folder a run kept and its workspace: { root, workspace } from the run's trace path (<root>/out/trace.jsonl; the workspace is <root>/sealed/home/cwd once the CLI has sealed it, which chmod 700 opens, else <root>/home/cwd). null when it is not there.
 */
export function keptRun(tracePath) {
    if (!tracePath) { return null; }
    const root = path.dirname(path.dirname(tracePath));
    if (!fs.existsSync(root)) { return null; }
    try { fs.chmodSync(root, 0o700); } catch (e) {}
    const sealed = path.join(root, 'sealed');
    if (fs.existsSync(sealed)) { try { fs.chmodSync(sealed, 0o700); } catch (e) {} }
    for (const workspace of [path.join(sealed, 'home', 'cwd'), path.join(root, 'home', 'cwd')]) {
        if (fs.existsSync(workspace)) { return { root, workspace }; }
    }
    return null;
}

/**
 * Claude's final message in a run's trace (stream-json lines): the result's text, else the last assistant text.
 */
export function finalMessage(trace) {
    let result = null, last = '';
    for (const line of String(trace || '').split('\n')) {
        if (!line.trim()) { continue; }
        let message;
        try { message = JSON.parse(line); } catch (e) { continue; }
        if (message.type === 'result' && typeof message.result === 'string') { result = message.result; }
        if (message.type === 'assistant') {
            const text = ((message.message || {}).content || []).filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim();
            if (text) { last = text; }
        }
    }
    return (result !== null && result.trim()) ? result : last;
}

// A copy of a run's workspace (without dot-files and files over 2 MB) and its trace, kept in the results for reading and grading again.
function copyRun(from, to, tracePath) {
    (function copy(src, dst) {
        fs.mkdirSync(dst, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.isSymbolicLink()) { continue; }
            const a = path.join(src, entry.name), b = path.join(dst, entry.name);
            if (entry.isDirectory()) { copy(a, b); } else if (entry.isFile() && fs.statSync(a).size <= 2 * 1024 * 1024) { fs.copyFileSync(a, b); }
        }
    })(from, path.join(to, 'workspace'));
    try { fs.copyFileSync(tracePath, path.join(to, 'trace.jsonl')); } catch (e) {}
}

// A kept run folder, removed: the CLI seals parts of it read-only.
function removeKept(root) {
    if (!/^e-|^claude-eval-/.test(path.basename(root))) { return; }
    (function open(dir) {
        try { fs.chmodSync(dir, 0o700); } catch (e) { return; }
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { open(full); } else if (!entry.isSymbolicLink()) { try { fs.chmodSync(full, 0o600); } catch (e) {} }
        }
    })(root);
    fs.rmSync(root, { recursive: true, force: true });
}

/**
 * Grades every run of a results folder: writes summary.json there and returns it. Each run: { case, arm, status: passed | failed | notRun, checks, skill, costUsd, turns, seconds, error }.
 */
export function gradeResults(dir, { keep = false } = {}) {

    const aggregate = JSON.parse(fs.readFileSync(path.join(dir, 'aggregate-result.json'), 'utf8')),
          command   = fs.existsSync(path.join(dir, 'command.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'command.json'), 'utf8')) : {},
          runs      = [],
          kept      = [];

    for (const c of aggregate.cases || []) {

        const folder = path.basename(c.dir || ''),
              file   = path.join(EVALS, folder, 'expect.json');
        if (!fs.existsSync(file)) { console.warn('No expect.json for case ' + c.name + ' (' + c.dir + '); skipped.'); continue; }
        const expect = JSON.parse(fs.readFileSync(file, 'utf8'));

        // The data as the setup makes it, for noChanges (its media are not compared, so placeholders do).
        let before = null;
        if (expect.root) {
            const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'frametrail-eval-before-'));
            try { build(expect.setup, temp, { placeholder: true }); before = readData(temp, expect.root); } finally { fs.rmSync(temp, { recursive: true, force: true }); }
        }

        for (const [arm, list] of Object.entries(c.arms || {})) {
            for (const [index, run] of (list || []).entries()) {

                const record = { case: folder, arm, status: 'failed', checks: [], skill: null, costUsd: run.costUsd || 0, turns: run.turns || 0, seconds: run.durationSeconds || 0, error: run.error || null, message: null, copy: null },
                      copy   = path.join(dir, 'runs', folder, arm + '-' + (index + 1));
                const native = run.graders || [];
                const fired  = native.find((g) => g.name === 'skill-fired');
                if (fired && arm === 'with') { record.skill = !!fired.passed; }
                // Native graders that score (the no-fire case's): part of the checks.
                for (const g of native.filter((g) => g.scored && !g.withOnly && g.name !== 'skill-fired')) {
                    record.checks.push({ check: 'native ' + g.name, passed: !!g.passed, reason: g.passed ? null : g.explanation });
                }

                if (run.error && NOT_RUN.test(String(run.error))) {
                    record.status = 'notRun';
                } else {
                    // The kept run, copied into the results; graded again later from the copy.
                    const found = keptRun(run.tracePath);
                    if (found) {
                        kept.push(found.root);
                        fs.rmSync(copy, { recursive: true, force: true });
                        copyRun(found.workspace, copy, run.tracePath);
                    }
                    if (!fs.existsSync(path.join(copy, 'workspace'))) {
                        record.checks.push({ check: 'workspace', passed: false, reason: 'the run\'s workspace is not there (' + (run.tracePath || 'no trace') + ')' + (run.error ? '; run error: ' + run.error : '') });
                    } else {
                        let trace = '';
                        try { trace = fs.readFileSync(path.join(copy, 'trace.jsonl'), 'utf8'); } catch (e) {}
                        record.message = finalMessage(trace).slice(0, 3000);
                        record.copy    = path.relative(dir, copy);
                        const graded = grade(expect, { workspace: path.join(copy, 'workspace'), message: record.message, before });
                        record.checks.push(...graded.results);
                        if (run.error) { record.checks.push({ check: 'run', passed: false, reason: 'run error: ' + run.error }); }
                    }
                    record.status = record.checks.every((r) => r.passed) ? 'passed' : 'failed';
                }
                runs.push(record);

            }
        }
    }

    const summary = { dir: path.relative(ROOT, dir), model: command.model || (aggregate.suite || {}).modelOverride || null, startedAt: aggregate.startedAt, claudeVersion: aggregate.claudeVersion, runs };
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 4));
    if (!keep) { for (const root of new Set(kept)) { removeKept(root); } }
    return summary;

}


/* ---------------------------------------------------------------------- */
/*  Summaries                                                             */
/* ---------------------------------------------------------------------- */

const percent = (n, of) => of ? Math.round(100 * n / of) + ' %' : '–';

/**
 * Per case and arm: { graded, passed, share (the mean share of checks passed), notRun, skill: [fired, of], costUsd, failures }.
 */
export function tally(runs) {
    const cases = {};
    for (const run of runs) {
        const c = cases[run.case] = cases[run.case] || {},
              a = c[run.arm] = c[run.arm] || { graded: 0, passed: 0, share: 0, notRun: 0, skill: [0, 0], costUsd: 0, failures: [] };
        a.costUsd += run.costUsd || 0;
        if (run.status === 'notRun') { a.notRun++; continue; }
        a.graded++;
        if (run.status === 'passed') { a.passed++; }
        a.share += run.checks.length ? run.checks.filter((r) => r.passed).length / run.checks.length : 0;
        if (run.skill !== null && run.skill !== undefined) { a.skill[1]++; if (run.skill) { a.skill[0]++; } }
        for (const r of run.checks.filter((r) => !r.passed)) { a.failures.push(r.check.split(' ')[0] + ': ' + String(r.reason).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' ⏎ ').slice(0, 300)); }
    }
    for (const c of Object.values(cases)) {
        for (const a of Object.values(c)) { a.share = a.graded ? a.share / a.graded : 0; }
    }
    return cases;
}

/**
 * The results as Markdown: a table per case (runs passed with and without the plugin, the difference, the share of checks passed, how often the skill fired), the totals, and the failures.
 */
export function table(runs, { title } = {}) {
    const cases = tally(runs),
          names = Object.keys(cases).sort(),
          cell  = (a) => a ? a.passed + '/' + a.graded + (a.notRun ? ' (+' + a.notRun + ' not run)' : '') : '–',
          rate  = (a) => (a && a.graded) ? a.passed / a.graded : null,
          delta = (w, o) => (rate(w) === null || rate(o) === null) ? '–' : ((rate(w) - rate(o) >= 0) ? '+' : '') + Math.round(100 * (rate(w) - rate(o))),
          lines = [];

    if (title) { lines.push(title, ''); }
    lines.push('| Case | With the plugin | Without | Δ (points) | Checks passed, with / without | Skill fired |', '|---|---|---|---|---|---|');
    const total = { with: { graded: 0, passed: 0, notRun: 0 }, without: { graded: 0, passed: 0, notRun: 0 } };
    for (const name of names) {
        const w = cases[name].with, o = cases[name].without;
        for (const [arm, a] of [['with', w], ['without', o]]) { if (a) { total[arm].graded += a.graded; total[arm].passed += a.passed; total[arm].notRun += a.notRun; } }
        lines.push('| ' + name + ' | ' + cell(w) + ' | ' + cell(o) + ' | ' + delta(w, o) + ' | ' + (w ? percent(w.share, 1) : '–') + ' / ' + (o ? percent(o.share, 1) : '–') + ' | ' + ((w && w.skill[1]) ? w.skill[0] + '/' + w.skill[1] : '–') + ' |');
    }
    lines.push('| **All** | **' + cell(total.with) + ' (' + percent(total.with.passed, total.with.graded) + ')** | **' + cell(total.without) + ' (' + percent(total.without.passed, total.without.graded) + ')** | **' + delta(total.with, total.without) + '** | | |');

    const failures = [];
    for (const name of names) {
        for (const arm of ['with', 'without']) {
            const a = cases[name][arm];
            if (!a || !a.failures.length) { continue; }
            const counted = {};
            for (const f of a.failures) { counted[f] = (counted[f] || 0) + 1; }
            failures.push('- **' + name + '**, ' + (arm === 'with' ? 'with the plugin' : 'without') + ': ' + Object.entries(counted).map(([f, n]) => (n > 1 ? n + '× ' : '') + f.replace(/\|/g, '\\|')).join('; '));
        }
    }
    if (failures.length) { lines.push('', 'What failed:', '', ...failures); }

    const cost = runs.reduce((sum, run) => sum + (run.costUsd || 0), 0);
    lines.push('', runs.length + ' runs; API-equivalent size ' + cost.toFixed(2) + ' USD (on a subscription: usage, not money).');
    return lines.join('\n');
}

function writeReadme(markdown) {
    const text = fs.readFileSync(README, 'utf8'),
          from = text.indexOf(MARKERS[0]),
          to   = text.indexOf(MARKERS[1]);
    if (from < 0 || to < from) { throw new Error('evals/README.md has no ' + MARKERS.join(' … ') + ' markers'); }
    fs.writeFileSync(README, text.slice(0, from + MARKERS[0].length) + '\n\n' + markdown + '\n\n' + text.slice(to));
    console.log('Wrote the table into evals/README.md.');
}

function titleOf(summaries) {
    const models  = [...new Set(summaries.map((s) => s.model).filter(Boolean))],
          dates   = summaries.map((s) => s.startedAt).filter(Boolean).sort(),
          version = [...new Set(summaries.map((s) => s.claudeVersion).filter(Boolean))];
    return 'Model ' + (models.join(', ') || 'default') + ', Claude Code ' + (version.join(', ') || '?') + ', ' + (dates.length ? dates[0].slice(0, 10) + (dates[dates.length - 1].slice(0, 10) !== dates[0].slice(0, 10) ? ' to ' + dates[dates.length - 1].slice(0, 10) : '') : '') + ' (' + summaries.map((s) => path.basename(s.dir)).join(', ') + ').';
}


/* ---------------------------------------------------------------------- */

async function main() {

    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
        tag: { type: 'string', multiple: true }, case: { type: 'string', multiple: true }, runs: { type: 'string' }, model: { type: 'string', default: 'opus' },
        concurrency: { type: 'string', short: 'j', default: '2' }, 'no-baseline': { type: 'boolean' }, keep: { type: 'boolean' }, readme: { type: 'boolean' },
        grade: { type: 'string' }, table: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
    } });

    if (values.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); return; }

    let summaries;
    if (values.table) {
        if (!positionals.length) { throw new Error('--table needs results folders'); }
        summaries = positionals.map((dir) => JSON.parse(fs.readFileSync(path.join(path.resolve(dir), 'summary.json'), 'utf8')));
    } else {
        // The CLI takes one --case glob: several are run one after the other.
        const dirs = [];
        if (values.grade) {
            dirs.push(path.resolve(values.grade));
        } else {
            for (const caseGlob of (values.case && values.case.length) ? values.case : [undefined]) {
                dirs.push(await runSuite({ tag: values.tag || [], caseGlob, runs: values.runs, model: values.model, concurrency: Number(values.concurrency) || 2, baseline: !values['no-baseline'] }));
            }
        }
        summaries = dirs.map((dir) => gradeResults(dir, { keep: values.keep }));
        for (const [i, dir] of dirs.entries()) { console.log('Graded ' + summaries[i].runs.length + ' runs: ' + path.relative(ROOT, path.join(dir, 'summary.json'))); }
    }

    const markdown = table(summaries.flatMap((s) => s.runs), { title: titleOf(summaries) });
    console.log('\n' + markdown);
    if (values.readme) { writeReadme(markdown); }

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}

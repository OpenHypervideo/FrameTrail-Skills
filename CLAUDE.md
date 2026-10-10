# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

FrameTrail-Skills is a Claude Code plugin (and the marketplace that lists it) for creating and editing FrameTrail hypervideos. Claude edits the data files of a local `_data` folder, or the data block of a FrameTrail project file (one HTML page), with its own tools; the plugin's skill says how, hooks run FrameTrail's validator and lint after every change and feed the errors back, and a few helper scripts do what is not JSON editing (creating a project, adding media). There is no operations CLI, no MCP server, and no editing of a server instance's files (an open editor there would overwrite them).

Work proceeds in phases: S0 (scaffold, sync, lock, tests, CI), S1 (the skill, `check.mjs` and the hooks), S2 (the helpers `create-project.mjs`, `add-media.mjs`) and S3 (the evaluation with `claude plugin eval`) are done; S4 (the release) follows. The phase plan is kept outside this repository.

## Relationship to FrameTrail

The plugin depends on FrameTrail only, at a pinned version, through copies (vendoring), never on a FrameTrail checkout at run time and never on another add-on.

- `dev/sync.mjs --frametrail=<working copy>` copies FrameTrail's pure scripts (`FrameTrailKeyframes`, `FrameTrailSerializer`, `FrameTrailHTMLFormat`, `FrameTrailLint`, `FrameTrailSchema`, `FrameTrailSchemas`) into `plugin/vendor/frametrail/` in FrameTrail's own layout (so their `require('./…')` paths hold), with FrameTrail's `LICENSE.md` and `THIRD-PARTY-NOTICES.md` and a `package.json` `{ "type": "commonjs", "frametrailRelease": "1.4.1" }` (the scripts' wrappers export under `require()` whatever `package.json` surrounds them; `frametrailRelease` is the latest tag at the commit, `git describe --tags --abbrev=0` without its `v`, left out when there is none); `docs/DATA-MODEL.md`, `HTML-FORMAT.md` and `TYPES.md` into the skill's `references/frametrail/` (links between the three kept, others pointed at FrameTrail's repository); `tests/fixtures/data/*` into `tests/fixtures/frametrail/`; `tests/fixtures/lint/data/*.json` (data sets as bundles: the lecture, a project, legacy forms) into `tests/fixtures/frametrail-bundles/`, which the evaluation's workspaces are made from. It writes `vendor.lock.json`: `{ frametrail: { version, commit }, files: { path: sha256 } }`.
- **Never edit a vendored file.** The folders belong to the sync (it removes what FrameTrail no longer has); the tests fail for any file that differs from the lock, and for a lock edited by hand. A change of FrameTrail's code, docs or schemas is made in FrameTrail, then synced.
- What the plugin needs from FrameTrail that FrameTrail lacks goes into FrameTrail as a generic feature, standing on its own: nothing in FrameTrail mentions this plugin, Claude, AI, models, agents, prompts or MCP. Type knowledge (what a type is for, how its attributes work) belongs in FrameTrail's schema descriptions, which become `TYPES.md`.
- Data format 1 (`https://frametrail.org/schemas/1/`, `formatVersion` 1). The README names the pinned version and the format; the tests check both.

## Repository Layout

```
.claude-plugin/marketplace.json   the marketplace "frametrail-skills": one plugin, source ./plugin
plugin/                           what users install (nothing else may go there; the tests check)
├── .claude-plugin/plugin.json    the plugin "frametrail"
├── skills/frametrail-hypervideo/ SKILL.md, references/ (recipes; frametrail/ = vendored docs)
├── hooks/hooks.json              check.mjs before and after Write/Edit/MultiEdit, and at Stop
├── scripts/                      check.mjs, create-project.mjs, add-media.mjs, user-id.mjs; Node ≥ 20, no dependencies
└── vendor/frametrail/            synced, never edited
dev/sync.mjs                      the sync
dev/eval.mjs                      the evaluation: runs it, grades the runs, the table
vendor.lock.json                  what the sync wrote
tests/run.mjs                     the tests (node:test)
tests/fixtures/frametrail/        FrameTrail's test data folders, synced
tests/fixtures/frametrail-bundles/ FrameTrail's data sets as bundles, synced
evals/                            the evaluation: one folder per case, lib/ (workspaces, checks), README.md (results)
.github/workflows/                test.yml, drift.yml
plans/                            git-ignored working notes
```

`CLAUDE.md` stays at the repository root: at the plugin root Claude Code would not load it, and `claude plugin validate` warns.

## The Checks

`plugin/scripts/check.mjs` is FrameTrail's validator and lint applied to a root (a `_data` folder: the nearest folder with `config.json` and `hypervideos/_index.json`; a project file: an HTML page with a FrameTrail data block), by hand (`node check.mjs <root>`, exit 1 on errors) and as the three hooks of `hooks.json` (`--hook=pre|post|stop`, the hook's JSON on stdin). It loads the vendored scripts only once a root is found, so a hook on any other file costs about 25 ms. Problems are `{ severity, file, line?, pointer?, label?, rule?, message, key }`; `key` leaves out positions, so a problem is recognised before and after a change.

- **What it checks:** each JSON file against `FrameTrailSerializer.schemaOfFile()`, with the position of syntax errors; a page's data block against `hypervideo-bundle` or `project-bundle` (pointers into the bundle, positions in the page), and a raw `<` in it; WebVTT with `FrameTrailLint.checkVTT()` (as the player reads it), per file in the post hook and reported once at Stop although `checkFolder()` reports it too; `FrameTrailLint.checkFolder()` (for a page on `readProject().files`); `FrameTrailLint.run(partsOf())` per hypervideo, through `FrameTrailHTMLFormat.projectBundle()`, skipped for hypervideos with a file that fails its schema. A clip without `out` and `duration` whose video is a local file gets its length from `ffprobe` (cached per session by path, mtime and size); without it the time rules check only the start, as in FrameTrail.
- **pre:** on the session's first Write/Edit in a root, the root as it is becomes the baseline (`${CLAUDE_PLUGIN_DATA}/sessions/<session>/<sha1(root)>.json`: `{ root, kind, baseline, reported, durations }`; the folder's JSON, VTT and CSS texts without `users.json`, or the page's block). A `wx` lock makes parallel tool calls agree on one baseline; sessions older than 7 days are removed. A server instance's folder (`.collab/`, or `users.json` with `passwd`) gets `permissionDecision: "ask"`.
- **post:** the changed file only (cross-file problems wait for Stop, since one change can span files); errors on stderr with exit 2, at most 20. A page's block is first rewritten with every `<` as `\u003c` when it is valid JSON, like a formatter, and Claude is told (`additionalContext`): what Claude types as `\u003c` into Write and Edit arrives as `<` (see Text), so it cannot write the escape itself, nor match it in an Edit's `old_string`.
- **stop:** for every recorded root: the hypervideos whose files changed (all when an index changed or there is no baseline), problems now minus problems of the baseline minus those already reported this session. New errors → `decision: "block"`; new warnings alone → `additionalContext` (which also gives Claude one more turn). Nothing new → no output. A root that is gone is dropped.
- `check.mjs --escape <page>` does the post hook's rewrite by hand, after changes made through Bash.

## The Helpers

What is not JSON editing goes through scripts that do it as FrameTrail's editor does, check what they changed and print what Claude needs next. They write through Bash: the hooks do not see them, and `/rewind` does not undo them. FFmpeg's tools are used when installed, never required.

- **`create-project.mjs --folder <dir> | --file <page.html> [--title] [--language]`:** `FrameTrailHTMLFormat.emptyProject()` as files, or the page FrameTrail's "New Project File" writes (`writeProject(files, null, { library: cdnLibrary(frametrailRelease), datapath: './', title })`, title by default the file name). `--title` → `config.overviewTitle`, `--language` → `config.defaultLanguage`, checked against the enum of the vendored config schema. Refuses a folder with anything but dot-files in it and a non-empty file. A new page loads the release the vendored scripts are based on (`frametrailRelease`), never a newer one; only a new tag changes it, so the drift run does not fire on every commit.
- **`add-media.mjs <root> <file | URL> --user <name> [--user-id] [--name] [--license] [--attribution]`:** mirrors FrameTrail's upload into a local folder (`ResourceManager.uploadSingleFileLocally`, `addResourceLocally`): stored name `<user id>_<ms>_<name with [^a-zA-Z0-9_-] as _>`, cut to 90 characters, plus the extension; `created` in seconds; the next id above the increment and every key (FrameTrail's own folder scaffold writes no increment). Unlike FrameTrail it keeps the file's real extension (its local upload names every video `.mp4`). A file already in the root's resources folder is registered as it is; a `src` the library has already is reported, not added again. Video thumbnails and scrub previews as the server makes them (`files.php`: `generateVideoThumbnail`, a frame at half the length, `scale='min(600,iw)':-2`, PNG; `generateScrubSprite`, 25 frames tiled 5 × 5 at 320 × 180 into `<video without extension>_scrub.jpg`, which the player finds by name and which is not in the index). URLs as `ResourceManager.checkResourceInput` turns them into resources (YouTube and Vimeo in their embed form, files by extension), media only: other embeds belong in an item's body. Licence types are the ones `ResourceManager.openEditDialog` offers. A page's entry goes into its block through `replaceBlock()`; the page and `resources/_index.json` are written through a temporary file and a rename. Prints the entry, the clip for video/YouTube/Vimeo, an item's body made by `serializeOverlay()`, and the problems the check finds that it did not find before. A server instance's folder is refused (a script cannot ask the user, as the pre hook does).
- **`user-id.mjs <name>`:** a guest's user id (`FrameTrailSerializer.guestUserID`).

`check.mjs` exports two things for them: `resourcesDir(state)` (where a root's media files are: a folder's `resources/`, a page's datapath plus `resources/`, relative to the page; `null` for a datapath that is a URL) and `probeMedia(file)` (ffprobe as JSON → `{ duration, width, height }`, or `null`).

## Text

The skill's Markdown (everything under `plugin/skills/` but the vendored `references/frametrail/`) is written for Claude and tested against the vendored FrameTrail (`textProblems()` in `tests/run.mjs`):

- **JSON examples** that show stored data are fenced as `json frametrail:<schema>`: a file of FrameTrail's `schemas/` without `.schema.json`, optionally with a JSON Pointer fragment (`json frametrail:content-item`, `json frametrail:annotation-file`, `json frametrail:common#/$defs/keyframe`, `json frametrail:hypervideo#/properties/chapters`). They must parse and validate; fences may be indented (in a list item). Examples that leave parts out (`…`) are fenced as `jsonc` and not checked.
- **Types** are named in backticks next to the word: a `` `quiz` `` overlay, the `` `text` `` type, type `` `hotspot` ``. Every type named that way must be one FrameTrail knows.
- **Files** are named as relative Markdown links (from the text's folder), `${CLAUDE_PLUGIN_ROOT}/…` or `${CLAUDE_SKILL_DIR}/…`, and must exist.
- `SKILL.md` has frontmatter with `name` (its folder) and a `description` of at most 1536 characters, and stays under 500 lines; details go into `references/`.

Write prose without hard line breaks: one line per paragraph.

**`\u003c` and Claude's file tools.** Text typed as `\u003c` (any `\uXXXX`) into Write or Edit arrives decoded, as `<`; that is how FrameTrail's HTML-FORMAT.md once lost it. To put the six characters into a file: in Markdown type `\u005cu003c` (the escaped backslash arrives as `\`), in JavaScript and Python source `\\u003c` (it arrives as typed), or write the file from a script. Check with `grep -n 'u003c'` afterwards; the tests check that the skill's text names `\u003c`.

## The Evaluation

`evals/` holds 13 cases (requests a user might make: questions, chapters, overlays, annotations, subtitles, the layout, new hypervideos and projects, project files, one request that is not about FrameTrail) and `dev/eval.mjs` runs them with `claude plugin eval`, each with the plugin and without it (`--ablation with-without`; `--no-baseline` leaves the second arm out), by default with Opus at 2 runs. Most of a run's tokens are the context every run loads again, so related requests share a case rather than each having its own. [evals/README.md](evals/README.md) has the cases, the checks and the latest table.

- **Why it grades afterwards:** `claude plugin eval` has graders for messages, traces and file contents (`regex`, `llm`, `file_exists`, `tool_used`, …), none that runs a program, and its runs ignore project settings (`--setting-sources user`; every plugin a case names is under test and dropped from the baseline arm). So the runs keep their workspaces (`--keep-temp`), and `dev/eval.mjs` grades them with `evals/lib/checks.mjs` (FrameTrail's own checks through `check.mjs`, and the add-on's vocabulary: chapter, item, layout, noChanges, …) and removes them. It finds a workspace from the run's `tracePath` (`<root>/out/trace.jsonl`, workspace `<root>/sealed/home/cwd`, opened with `chmod 700` as the CLI says, else `<root>/home/cwd`); a missing one fails the run.
- **Cases** live outside `plugin/` (`plugins: ["../../plugin"]` from the case folder; run from the repository root). `case.yaml` is written as JSON, so the tests read it without a YAML parser. `scaffold.sh` is one line in every case (the CLI refuses scaffold scripts that link out of the case folder, but runs them with `$0` in the case folder and the workspace as the current folder): `lib/scaffold.mjs <case>` builds the setup `expect.json` names. Scaffolded files count as there before the run for the CLI's `file_exists` and `files`.
- **The runs** need `--allow-tools Bash Edit Write` (besides each case's `allowed_tools`) and `--scaffold`; the CLI's own grader is only `skill-fired` (`tool_used` Skill, `arm: with-only`; without `arm` the CLI scores it in the baseline arm too), and in the no-fire case `max: 0, arm: both`.
- **Accounting:** runs use the logged-in account; a run whose error is a usage or rate limit counts as "not run". The CLI's `costUsd` is API-equivalent.

## Tests and CI

```bash
node tests/run.mjs                    # Node 20+, no dependencies, no FrameTrail checkout
node tests/run.mjs --drift            # the same without checking the README's version (drift.yml)
claude plugin validate --strict .     # the manifests, with Claude Code's own validator
```

`tests/run.mjs` checks the vendored files against the lock, that the scripts load under `require()` and work together on the vendored fixtures (every file against its schema, `FrameTrailLint.checkFolder`, bundles, lint results against `RESULT_SCHEMA`, the HTML format), the docs' links, the manifests and what `plugin/` holds, each skill's frontmatter, `hooks.json`, the scripts (`check.mjs` by hand and as each hook, run as Claude Code runs them on temporary copies of the fixtures with `CLAUDE_PLUGIN_DATA` of their own; the helpers run through Node as Claude runs them, also with an empty `PATH` for a machine without FFmpeg; the test that needs FFmpeg is skipped where it is missing, as on CI), the text written for Claude (above; the checks themselves on examples that must pass and fail), the evaluation without a model (the case folders, the workspaces, every check on scripted changes, the grading of kept runs as the CLI leaves them), and the README.

The vendored fixtures have lint findings of their own (`all-types`: media without licence, warnings only; `animation`: hotspots with an empty `jumpToTime` target, errors); the hook tests rely on them as findings the baseline already has. `claude -p --plugin-dir plugin --include-hook-events --output-format stream-json --verbose` runs the plugin headlessly against a copy of a fixture; it costs quota, so it is for checking the wiring, not for the test suite.

- `.github/workflows/test.yml`: the tests on every push and pull request to `main`.
- `.github/workflows/drift.yml`: weekly and by hand. It checks out FrameTrail's `develop`, compares (`dev/sync.mjs --check`), and when the vendored files would change, syncs them in the runner, prints the diff and runs the tests with `--drift`. It fails when anything would change, so a failure means: sync against a FrameTrail release or commit, review the diff, fix the text, commit.

Moving to a newer FrameTrail: `node dev/sync.mjs --frametrail=<working copy at the tag or commit>` (refused for a working copy with changes where the files come from, unless `--allow-dirty`), `node tests/run.mjs`, review `git diff`, fix what the tests name, put the new version into README.md, commit.

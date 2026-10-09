# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

FrameTrail-Skills is a Claude Code plugin (and the marketplace that lists it) for creating and editing FrameTrail hypervideos. Claude edits the data files of a local `_data` folder, or the data block of a FrameTrail project file (one HTML page), with its own tools; the plugin's skill says how, hooks run FrameTrail's validator and lint after every change and feed the errors back, and a few helper scripts do what is not JSON editing (creating a project, adding media). There is no operations CLI, no MCP server, and no editing of a server instance's files (an open editor there would overwrite them).

Work proceeds in phases: S0 (scaffold, sync, lock, tests, CI) and S1 (the skill, `check.mjs` and the hooks) are done; S2 (the helpers `create-project.mjs`, `add-media.mjs`), S3 (the evaluation with `claude plugin eval`) and S4 (the release) follow. The phase plan is kept outside this repository.

## Relationship to FrameTrail

The plugin depends on FrameTrail only, at a pinned version, through copies (vendoring), never on a FrameTrail checkout at run time and never on another add-on.

- `dev/sync.mjs --frametrail=<working copy>` copies FrameTrail's pure scripts (`FrameTrailKeyframes`, `FrameTrailSerializer`, `FrameTrailHTMLFormat`, `FrameTrailLint`, `FrameTrailSchema`, `FrameTrailSchemas`) into `plugin/vendor/frametrail/` in FrameTrail's own layout (so their `require('./…')` paths hold), with FrameTrail's `LICENSE.md` and `THIRD-PARTY-NOTICES.md` and a `package.json` `{ "type": "commonjs" }` (the scripts' wrappers export under `require()` whatever `package.json` surrounds them); `docs/DATA-MODEL.md`, `HTML-FORMAT.md` and `TYPES.md` into the skill's `references/frametrail/` (links between the three kept, others pointed at FrameTrail's repository); `tests/fixtures/data/*` into `tests/fixtures/frametrail/`. It writes `vendor.lock.json`: `{ frametrail: { version, commit }, files: { path: sha256 } }`.
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
├── scripts/                      check.mjs, user-id.mjs; create-project.mjs, add-media.mjs (S2); Node ≥ 20, no dependencies
└── vendor/frametrail/            synced, never edited
dev/sync.mjs                      the sync
vendor.lock.json                  what the sync wrote
tests/run.mjs                     the tests (node:test)
tests/fixtures/frametrail/        FrameTrail's test data folders, synced
evals/                            the evaluation (S3)
.github/workflows/                test.yml, drift.yml
plans/                            git-ignored working notes
```

`CLAUDE.md` stays at the repository root: at the plugin root Claude Code would not load it, and `claude plugin validate` warns.

## The Checks

`plugin/scripts/check.mjs` is FrameTrail's validator and lint applied to a root (a `_data` folder: the nearest folder with `config.json` and `hypervideos/_index.json`; a project file: an HTML page with a FrameTrail data block), by hand (`node check.mjs <root>`, exit 1 on errors) and as the three hooks of `hooks.json` (`--hook=pre|post|stop`, the hook's JSON on stdin). It loads the vendored scripts only once a root is found, so a hook on any other file costs about 25 ms. Problems are `{ severity, file, line?, pointer?, label?, rule?, message, key }`; `key` leaves out positions, so a problem is recognised before and after a change.

- **What it checks:** each JSON file against `FrameTrailSerializer.schemaOfFile()`, with the position of syntax errors; a page's data block against `hypervideo-bundle` or `project-bundle` (pointers into the bundle, positions in the page), and a raw `<` in it; WebVTT as FrameTrail's parser (vtt.js) reads it (the header, `(h:)mm:ss.ttt` timings, cues ending after their start); `FrameTrailLint.checkFolder()` (for a page on `readProject().files`); `FrameTrailLint.run(partsOf())` per hypervideo, through `FrameTrailHTMLFormat.projectBundle()`, skipped for hypervideos with a file that fails its schema. A clip without `out` and `duration` whose video is a local file gets its length from `ffprobe` (cached per session by path, mtime and size); without it the time rules check only the start, as in FrameTrail.
- **pre:** on the session's first Write/Edit in a root, the root as it is becomes the baseline (`${CLAUDE_PLUGIN_DATA}/sessions/<session>/<sha1(root)>.json`: `{ root, kind, baseline, reported, durations }`; the folder's JSON, VTT and CSS texts without `users.json`, or the page's block). A `wx` lock makes parallel tool calls agree on one baseline; sessions older than 7 days are removed. A server instance's folder (`.collab/`, or `users.json` with `passwd`) gets `permissionDecision: "ask"`.
- **post:** the changed file only (cross-file problems wait for Stop, since one change can span files); errors on stderr with exit 2, at most 20. A page's block is first rewritten with every `<` as `\u003c` when it is valid JSON, like a formatter, and Claude is told (`additionalContext`): what Claude types as `\u003c` into Write and Edit arrives as `<` (see Text), so it cannot write the escape itself, nor match it in an Edit's `old_string`.
- **stop:** for every recorded root: the hypervideos whose files changed (all when an index changed or there is no baseline), problems now minus problems of the baseline minus those already reported this session. New errors → `decision: "block"`; new warnings alone → `additionalContext` (which also gives Claude one more turn). Nothing new → no output. A root that is gone is dropped.
- `check.mjs --escape <page>` does the post hook's rewrite by hand, after changes made through Bash. `user-id.mjs <name>` prints a guest's user id (`FrameTrailSerializer.guestUserID`).

## Text

The skill's Markdown (everything under `plugin/skills/` but the vendored `references/frametrail/`) is written for Claude and tested against the vendored FrameTrail (`textProblems()` in `tests/run.mjs`):

- **JSON examples** that show stored data are fenced as `json frametrail:<schema>`: a file of FrameTrail's `schemas/` without `.schema.json`, optionally with a JSON Pointer fragment (`json frametrail:content-item`, `json frametrail:annotation-file`, `json frametrail:common#/$defs/keyframe`, `json frametrail:hypervideo#/properties/chapters`). They must parse and validate; fences may be indented (in a list item). Examples that leave parts out (`…`) are fenced as `jsonc` and not checked.
- **Types** are named in backticks next to the word: a `` `quiz` `` overlay, the `` `text` `` type, type `` `hotspot` ``. Every type named that way must be one FrameTrail knows.
- **Files** are named as relative Markdown links (from the text's folder), `${CLAUDE_PLUGIN_ROOT}/…` or `${CLAUDE_SKILL_DIR}/…`, and must exist.
- `SKILL.md` has frontmatter with `name` (its folder) and a `description` of at most 1536 characters, and stays under 500 lines; details go into `references/`.

Write prose without hard line breaks: one line per paragraph.

**`\u003c` and Claude's file tools.** Text typed as `\u003c` (any `\uXXXX`) into Write or Edit arrives decoded, as `<`; that is how FrameTrail's HTML-FORMAT.md once lost it. To put the six characters into a file: in Markdown type `\u005cu003c` (the escaped backslash arrives as `\`), in JavaScript and Python source `\\u003c` (it arrives as typed), or write the file from a script. Check with `grep -n 'u003c'` afterwards; the tests check that the skill's text names `\u003c`.

## Tests and CI

```bash
node tests/run.mjs                    # Node 20+, no dependencies, no FrameTrail checkout
node tests/run.mjs --drift            # the same without checking the README's version (drift.yml)
claude plugin validate --strict .     # the manifests, with Claude Code's own validator
```

`tests/run.mjs` checks the vendored files against the lock, that the scripts load under `require()` and work together on the vendored fixtures (every file against its schema, `FrameTrailLint.checkFolder`, bundles, lint results against `RESULT_SCHEMA`, the HTML format), the docs' links, the manifests and what `plugin/` holds, each skill's frontmatter, `hooks.json`, the scripts (`check.mjs` by hand and as each hook, run as Claude Code runs them on temporary copies of the fixtures with `CLAUDE_PLUGIN_DATA` of their own; `user-id.mjs`), the text written for Claude (above; the checks themselves on examples that must pass and fail), and the README.

The vendored fixtures have lint findings of their own (hotspots with `jumpToTime` and no `actionTarget`, media without licence); the hook tests rely on them as findings the baseline already has. `claude -p --plugin-dir plugin --include-hook-events --output-format stream-json --verbose` runs the plugin headlessly against a copy of a fixture; it costs quota, so it is for checking the wiring, not for the test suite.

- `.github/workflows/test.yml`: the tests on every push and pull request to `main`.
- `.github/workflows/drift.yml`: weekly and by hand. It checks out FrameTrail's `develop`, compares (`dev/sync.mjs --check`), and when the vendored files would change, syncs them in the runner, prints the diff and runs the tests with `--drift`. It fails when anything would change, so a failure means: sync against a FrameTrail release or commit, review the diff, fix the text, commit.

Moving to a newer FrameTrail: `node dev/sync.mjs --frametrail=<working copy at the tag or commit>` (refused for a working copy with changes where the files come from, unless `--allow-dirty`), `node tests/run.mjs`, review `git diff`, fix what the tests name, put the new version into README.md, commit.

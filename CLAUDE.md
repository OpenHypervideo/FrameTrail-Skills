# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

FrameTrail-Skills is a Claude Code plugin (and the marketplace that lists it) for creating and editing FrameTrail hypervideos. Claude edits the data files of a local `_data` folder, or the data block of a FrameTrail project file (one HTML page), with its own tools; the plugin's skill says how, hooks run FrameTrail's validator and lint after every change and feed the errors back, and a few helper scripts do what is not JSON editing (creating a project, adding media). There is no operations CLI, no MCP server, and no editing of a server instance's files (an open editor there would overwrite them).

Work proceeds in phases: S0 (scaffold, sync, lock, tests, CI) is done; S1 (the skill and the hooks), S2 (the helpers), S3 (the evaluation with `claude plugin eval`) and S4 (the release) follow. The phase plan is kept outside this repository.

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
├── hooks/hooks.json              (S1)
├── scripts/                      check.mjs (S1), create-project.mjs, add-media.mjs, user-id.mjs (S2); Node ≥ 20
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

## Text

The skill's Markdown (everything under `plugin/skills/` but the vendored `references/frametrail/`) is written for Claude and tested against the vendored FrameTrail (`textProblems()` in `tests/run.mjs`):

- **JSON examples** that show stored data are fenced as `json frametrail:<schema>`: a file of FrameTrail's `schemas/` without `.schema.json`, optionally with a fragment (`json frametrail:content-item`, `json frametrail:annotation-file`, `json frametrail:common#/$defs/keyframe`). They must parse and validate. Examples that leave parts out (`…`) are fenced as `jsonc` and not checked.
- **Types** are named in backticks next to the word: a `` `quiz` `` overlay, the `` `text` `` type, type `` `hotspot` ``. Every type named that way must be one FrameTrail knows.
- **Files** are named as relative Markdown links (from the text's folder), `${CLAUDE_PLUGIN_ROOT}/…` or `${CLAUDE_SKILL_DIR}/…`, and must exist.
- `SKILL.md` has frontmatter with `name` (its folder) and a `description` of at most 1536 characters, and stays under 500 lines; details go into `references/`.

Write prose without hard line breaks: one line per paragraph.

## Tests and CI

```bash
node tests/run.mjs                    # Node 20+, no dependencies, no FrameTrail checkout
node tests/run.mjs --drift            # the same without checking the README's version (drift.yml)
claude plugin validate --strict .     # the manifests, with Claude Code's own validator
```

`tests/run.mjs` checks the vendored files against the lock, that the scripts load under `require()` and work together on the vendored fixtures (every file against its schema, `FrameTrailLint.checkFolder`, bundles, lint results against `RESULT_SCHEMA`, the HTML format), the docs' links, the manifests and what `plugin/` holds, each skill's frontmatter, the text written for Claude (above; the checks themselves on examples that must pass and fail), and the README.

- `.github/workflows/test.yml`: the tests on every push and pull request to `main`.
- `.github/workflows/drift.yml`: weekly and by hand. It checks out FrameTrail's `develop`, compares (`dev/sync.mjs --check`), and when the vendored files would change, syncs them in the runner, prints the diff and runs the tests with `--drift`. It fails when anything would change, so a failure means: sync against a FrameTrail release or commit, review the diff, fix the text, commit.

Moving to a newer FrameTrail: `node dev/sync.mjs --frametrail=<working copy at the tag or commit>` (refused for a working copy with changes where the files come from, unless `--allow-dirty`), `node tests/run.mjs`, review `git diff`, fix what the tests name, put the new version into README.md, commit.

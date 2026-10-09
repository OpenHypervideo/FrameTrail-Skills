# FrameTrail-Skills

A [Claude Code](https://code.claude.com) plugin for [FrameTrail](https://github.com/OpenHypervideo/FrameTrail), the open hypervideo environment. With it, Claude creates and edits hypervideos (overlays, annotations, chapters, subtitles, the layout around the video) in a local FrameTrail `_data` folder or in a FrameTrail project file (one HTML page), and FrameTrail's own validator and lint check every change.

**Status: early development.** The skill and the checks work; helpers for creating a project and adding media files, and an evaluation, are being built. There is no release yet.

## What it does

Ask Claude about a hypervideo or for a change ("add chapters from the subtitles", "put a quiz at 2:10", "a hotspot that jumps to the results") in a folder that holds FrameTrail data, or name a project file. The plugin's skill tells Claude how FrameTrail stores hypervideos and how to change them without breaking anything: the item format, time and boxes, annotations per user, subtitles, the layout, project files. Claude reads and edits the JSON files with its own tools.

FrameTrail's own validator and lint check every change, through the plugin's hooks:

- after each file Claude writes: its JSON, its JSON Schema, a project file's data block, WebVTT subtitles; Claude sees errors at once and fixes them;
- when Claude is done: everything it changed, as a whole: files that must agree with each other, and FrameTrail's lint rules (items outside the video, overlays covering each other, items missing what their type needs, …). Only problems Claude's changes caused are reported, so Claude does not start "fixing" your existing content.

If FrameTrail has the same data open in Chrome or Edge, it notices the changes when you switch back to its tab and offers to reload; save your own edits there first.

**What it works on:** a local `_data` folder, as FrameTrail edits it in Chrome or Edge without a server, and a project file (one HTML page holding a whole project). **What it refuses:** the data folder of a FrameTrail server. The server's editors would not notice changes to its files and would save over them; the plugin asks you before any such change, and Claude suggests exporting a project file instead.

**Undo:** `/rewind` in Claude Code takes back Claude's file edits (not changes made by shell commands). For data you care about, keep a copy or use version control.

Requirements: Node.js 20 or later on your `PATH` (the checks run on it); `ffprobe` (from FFmpeg) optional, for the length of local video files.

## Install

In Claude Code:

```
/plugin marketplace add OpenHypervideo/FrameTrail-Skills
/plugin install frametrail@frametrail-skills
```

## FrameTrail version

Built against FrameTrail `v1.4.1-4-ge065b6d` (commit `e065b6d`, `develop` after 1.4.1), data format 1: the JSON Schemas at `https://frametrail.org/schemas/1/` and bundles and HTML data blocks of `formatVersion` 1. FrameTrail's readers refuse data of a newer format. `vendor.lock.json` names every file the plugin takes from FrameTrail.

## How it stays in step with FrameTrail

The plugin carries copies of FrameTrail's pure scripts (serializer, HTML format, lint, validator, schemas), of its data documentation and of its test data. `dev/sync.mjs` copies them from a FrameTrail working copy and writes `vendor.lock.json`; nobody edits the copies. The tests check the copies against the lock and the text written for Claude against the copies: JSON examples validate against FrameTrail's schemas, the types it names exist, the files it names are there. A weekly workflow compares the copies with FrameTrail's `develop` branch and fails when they differ or when the tests break with the newer files.

To move to a newer FrameTrail:

```bash
node dev/sync.mjs --frametrail=../frametrail     # a FrameTrail working copy at the new tag or commit
node tests/run.mjs
```

Then review the diff, fix the text the tests point at, update the version above, and commit.

## Development

```bash
node tests/run.mjs                                   # Node 20 or later, nothing to install
claude plugin validate --strict .                    # the marketplace and plugin manifests
claude --plugin-dir plugin                           # try the plugin without installing it
node plugin/scripts/check.mjs <_data folder | page>  # FrameTrail's checks on any data, by hand
```

[CLAUDE.md](CLAUDE.md) has the conventions.

## License

MIT, see [LICENSE](LICENSE). The files in `plugin/vendor/frametrail/` and the test data in `tests/fixtures/frametrail/` are FrameTrail's, under its MIT license, with the notices of the code it adapted: [`LICENSE.md`](plugin/vendor/frametrail/LICENSE.md), [`THIRD-PARTY-NOTICES.md`](plugin/vendor/frametrail/THIRD-PARTY-NOTICES.md).

# FrameTrail-Skills

A [Claude Code](https://code.claude.com) plugin for [FrameTrail](https://github.com/OpenHypervideo/FrameTrail), the open hypervideo environment. With it, Claude creates and edits hypervideos (overlays, annotations, chapters, subtitles, the layout around the video) in a local FrameTrail `_data` folder or in a FrameTrail project file (one HTML page), and FrameTrail's own validator and lint check every change.

**Status: early development.** The plugin installs, but so far its skill only points Claude to FrameTrail's documentation, and only when you call it. The editing workflow, the checks after every change and the helpers for new projects and media are being built.

## Install

In Claude Code:

```
/plugin marketplace add OpenHypervideo/FrameTrail-Skills
/plugin install frametrail@frametrail-skills
```

## FrameTrail version

Built against FrameTrail `v1.4.1-3-g742fe53` (commit `742fe53`, `develop` after 1.4.1), data format 1: the JSON Schemas at `https://frametrail.org/schemas/1/` and bundles and HTML data blocks of `formatVersion` 1. FrameTrail's readers refuse data of a newer format. `vendor.lock.json` names every file the plugin takes from FrameTrail.

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
node tests/run.mjs                    # Node 20 or later, nothing to install
claude plugin validate --strict .     # the marketplace and plugin manifests
claude --plugin-dir plugin            # try the plugin without installing it
```

[CLAUDE.md](CLAUDE.md) has the conventions.

## License

MIT, see [LICENSE](LICENSE). The files in `plugin/vendor/frametrail/` and the test data in `tests/fixtures/frametrail/` are FrameTrail's, under its MIT license, with the notices of the code it adapted: [`LICENSE.md`](plugin/vendor/frametrail/LICENSE.md), [`THIRD-PARTY-NOTICES.md`](plugin/vendor/frametrail/THIRD-PARTY-NOTICES.md).

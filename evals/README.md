# The Evaluation

Thirteen requests a FrameTrail user might make of Claude Code, each run with this plugin and without it, so that the difference shows what the plugin adds, and the failures show where Claude still goes wrong. The runs are made by `claude plugin eval`; what they leave behind is checked by FrameTrail's own validator and lint and by the case's expectations.

## Running it

```bash
node dev/eval.mjs --tag core                       # the five core cases, 2 runs each, with and without the plugin
node dev/eval.mjs --case chapters --runs 1         # one case, once
node dev/eval.mjs                                  # everything: 13 cases × 2 runs × 2 arms = 52 agent runs
node dev/eval.mjs --no-baseline                    # only the runs with the plugin (26), after a change to it
node dev/eval.mjs --table evals/results/A evals/results/B --readme   # one table from several batches, into this file
```

Options: `--tag` (repeatable), `--case <glob>`, `--runs <n>`, `--model <model>` (default `opus`), `-j <n>` (runs at once, default 2), `--no-baseline` (no runs without the plugin), `--keep` (leave the runs' workspaces for inspection), `--readme` (write the table below), `--grade <results dir>` (grade again, from the copies of the runs' workspaces, which are kept in the results).

Requirements: a Claude Code recent enough for `claude plugin eval` (the script takes `CLAUDE_BIN`, else the newest `claude` it finds on the PATH or in a Cursor or VS Code extension), Node 20 or later, ffmpeg (it makes the videos of the workspaces once, into `evals/.cache/`). Every run uses the account Claude Code is logged in with: on a Pro or Max plan that costs no money but draws on the plan's usage limits; the costs the CLI prints are what the API would charge. Running the suite by tag spreads it over the limits; a run cut off by a limit counts as "not run" and is repeated with `--case`.

Results go to `evals/results/<time>/` (git-ignored): the CLI's `aggregate-result.json` and `report.html`, and `summary.json` with every run's checks.

## How it works

- **Cases** are the folders `NN-<name>/`: `case.yaml` (written as JSON, which is YAML too: the request, the tools, the budget, the tags; `plugins: ["../../plugin"]` makes the plugin the one under test), `scaffold.sh` (one line, the same in every case: it builds the case's workspace with `lib/scaffold.mjs`) and `expect.json` (what must hold afterwards).
- **Both arms** get the same request, the same workspace and the same tools (Read, Glob, Grep, Edit, Write, Bash, Skill). The CLI runs every case once more without the plugin.
- **Workspaces** (`lib/setups.mjs`) are made from FrameTrail's lecture data set (vendored into `tests/fixtures/frametrail-bundles/`): a ten-minute cell biology lecture with chapters, overlays, Ada's and Grace's annotations, a Notes and a Transcript view and English subtitles, as a `_data` folder (`lecture-folder`, with a new video beside it: `lecture-folder+video`) or as a project file (`lecture-page`), with a real ten-minute video so that its length can be found. `video-only` is a folder with just a video, `node-app` a small Node program without FrameTrail.
- **Grading:** `claude plugin eval` has no grader that runs a program, so `dev/eval.mjs` runs it with `--keep-temp`, grades each run's workspace and final message with `lib/checks.mjs`, and removes the workspaces afterwards. The CLI's own grader only tells whether the skill fired (and, in the no-fire case, that it did not). A run passes when every check of its case passes.

## The cases

Thirteen cases, two runs each by default. Related requests share a case (one run then checks two things), which keeps the suite small: most of what a run costs is the context every run loads again.

| Case | Tags | Request | What must hold |
|------|------|---------|----------------|
| 01 question | core, talk | How many chapters does the lecture hypervideo have, and what are they called? | no change; the answer names all three |
| 02 idea | talk | The start of the lecture video feels a bit boring. Any ideas? | no change (propose, ask first) |
| 03 chapters | core, chapters | Two chapters: "Summary" at 8:30 and "Bonus" at 15:00. | Summary at 510 s, nothing past the end, four chapters, the answer says the video ends at 10:00; valid |
| 04 chapters-from-transcript | chapters | A chapter at each topic change in the first 5 minutes. | chapters at the transcript's topic changes, valid |
| 05 overlays | core, items | A text overlay "Welcome to lecture 3", 0:10–0:20, across the top, and a hotspot at 2:10 for 5 s that jumps to 5:00. | both overlays with their times, text, place and action; valid |
| 06 quiz | items | A quiz at 4:10 for 20 s: does osmosis need energy? | the quiz, its answers, No correct; valid |
| 07 moving-overlay | items | A yellow circle hotspot moving from top left to bottom right. | keyframes moving right and down, a yellow colour; valid |
| 08 annotation | core, items | I'm Ada. A note from 1:00 to 1:30. | an annotation by Ada, in a file with its index entry; valid |
| 09 subtitles-and-transcript | items | German subtitles from two given cues, and the transcript below the video, after the notes. | the WebVTT file, its entry and the cues; the area's views in that order; valid |
| 10 new-hypervideo | core, new | I'm Ada. A new hypervideo from ./field-recording.mp4. | a hypervideo playing a copy of that file from the resources; valid |
| 11 page-new-project | new, page | I'm Ada. A project file trip.html with a hypervideo of ./field-trip.mp4 and two chapters. | the page, the hypervideo, its video beside the page, the chapters; valid, escaped |
| 12 page-credits | page | In course.html, a "Credits" tab with given HTML. | the view with the HTML; valid, escaped |
| 13 no-fire | neg | Add a "test" script to package.json. | the script; the skill did not fire |

## expect.json

```json
{ "setup": "lecture-folder", "root": "_data", "hypervideo": "1", "checks": [ { "chapter": { "from": 510, "to": 510, "title": "^summary$" } }, { "valid": true } ] }
```

`root` is where the data is (a `_data` folder or a page, relative to the workspace), `hypervideo` the one the checks look at: an id, or `{ "name": "<pattern>" }`. Patterns are regular expressions matched ignoring case; ranges `[low, high]` include both ends; times are seconds on the video's timeline. The vocabulary is the one of the Conversational UI add-on's evaluation, checked here on files:

| Check | Holds when |
|-------|------------|
| `valid: true` | FrameTrail's checks (`plugin/scripts/check.mjs`) find no error: JSON, schemas, a page's data block, files that must agree, lint errors (a raw `<` in a page's block is left to `escaped`: FrameTrail reads it unless it ends the block) |
| `escaped: true` | a page's data block is written as FrameTrail writes it, every `<` as `\u003c` (docs/HTML-FORMAT.md) |
| `noChanges: true` | the data is as the setup made it |
| `answer: "<pattern>"` | Claude's final message matches |
| `chapter` / `noChapter: { from, to, title? }` | there is a / there is no chapter starting in the range (with the title) |
| `chapters: { min, max }` | the number of chapters |
| `item` / `noItem: { kind, type, name, by, start, end, text, attributes, box, keyframes }` | an overlay or annotation (`kind`: `overlays`, `annotations`) matching all that is given: `text` over its title, text, question and value as plain text; `attributes` by dotted path, equal as text, `{ "matches": "<pattern>" }` or `{ "hue": [low, high] }` (a CSS colour's hue in degrees); `box` sides in percent; `keyframes: { min, right, down }` |
| `layout: { area, includes, after?, html? }` | the area (`top`, `bottom`, `left`, `right`) has a view of that type (after a view of the type `after`; whose `html` matches) |
| `subtitles: { lang, cues: [{ start, end, text }] }` | the hypervideo lists subtitles in the language and they have those cues (± 0.05 s) |
| `hypervideo: { name, video? }` | a hypervideo with that name, whose video is a file in the root's resources, the same as the given file |
| `file: { path, pointer, matches }` | a JSON file of the workspace has a matching value at the JSON Pointer |

## Latest results

<!-- results:start -->

Model opus, Claude Code 2.1.295, 2026-10-10 (2026-10-10T07-23-51-753).

| Case | With the plugin | Without | Δ (points) | Checks passed, with / without | Skill fired |
|---|---|---|---|---|---|
| 01-question | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 02-idea | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 03-chapters | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 04-chapters-from-transcript | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 05-overlays | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 06-quiz | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 07-moving-overlay | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 08-annotation | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 09-subtitles-and-transcript | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 10-new-hypervideo | 2/2 | 2/2 | +0 | 100 % / 100 % | 2/2 |
| 11-page-new-project | 2/2 | 0/2 | +100 | 100 % / 0 % | 2/2 |
| 12-page-credits | 2/2 | 0/2 | +100 | 100 % / 67 % | 2/2 |
| 13-no-fire | 2/2 | 2/2 | +0 | 100 % / 100 % | – |
| **All** | **26/26 (100 %)** | **22/26 (85 %)** | **+15** | | |

What failed:

- **11-page-new-project**, without: hypervideo: FrameTrail cannot read trip.html: No FrameTrail data block found; 2× chapter: FrameTrail cannot read trip.html: No FrameTrail data block found; valid: FrameTrail cannot read trip.html: No FrameTrail data block found; escaped: FrameTrail cannot read trip.html: No FrameTrail data block found; hypervideo: trip.html does not exist; 2× chapter: trip.html does not exist; valid: trip.html does not exist; escaped: trip.html does not exist
- **12-page-credits**, without: 2× escaped: the data block holds 4 raw "<"

52 runs; API-equivalent size 10.13 USD (on a subscription: usage, not money).

<!-- results:end -->

## What the results say (2026-10-10)

- **Without the plugin, Opus already edits a rich `_data` folder well.** It reads the lecture, imitates what it finds (escaped text, the ids in use, the index entries, the upload file names) and passes most cases. It read nothing outside its workspace. Where the data offers nothing to imitate, the plugin makes the difference: a new project file (11: the baseline writes pages that call `FrameTrail.init()` with a library URL it guessed, which does not exist, and without a data block, so they neither play nor open as project files) and a page's data block written as FrameTrail writes it (12). In the earlier 16-case run, a baseline quiz also broke FrameTrail's schema (`showText: null`), which the plugin's checks prevent.
- **One fix came out of it:** in the earlier 16-case run the skill made Claude stop to ask who the user is before adding an overlay (twice in three runs of the moving hotspot), though the request was a named change. SKILL.md now gives overlays and hypervideo changes the hypervideo's creator and has Claude say so, and asks first only for annotations or when there is nobody to take. In this run every case passed with the plugin.
- **Beyond the checks:** with the plugin, Claude noticed things the baseline did not, e.g. that the lecture's code snippet pausing the video at 1:00 would freeze the moving circle, and said so.
- **Size:** most of a run's tokens are the context it loads (about 15–19K tokens written to the cache and 80–110K read from it per run, with Opus); the files of the workspace are a small part. So the suite counts runs: 52 for everything (about 10 USD at API prices), 26 with `--no-baseline`, 20 for `--tag core`. The earlier 16-case suite at 3 runs was 96 runs and reached the Pro plan's session limit together with its pilots.

---
name: frametrail-hypervideo
description: Create and edit FrameTrail hypervideos (interactive videos) by changing their data files - overlays (text, hotspots, quizzes, images, embeds, counters, charts), annotations, chapters, subtitles and transcripts, the layout around the video, new hypervideos - and answer questions about them. Use when the user mentions FrameTrail or a hypervideo, works in a FrameTrail _data folder (config.json and hypervideos/_index.json) or a FrameTrail project file (an HTML page with a data-frametrail script block), or asks to add, change or check items, chapters or subtitles of such a video. Not for the data folder of a FrameTrail server.
---

# Editing FrameTrail Hypervideos

FrameTrail keeps a library of hypervideos in JSON files. You read and change those files with your own tools. This plugin's hooks run FrameTrail's own validator and lint on every change and tell you what is wrong.

## Where This Works

- **A `_data` folder**: it has `config.json` and `hypervideos/_index.json`. FrameTrail edits it in Chrome or Edge as a local folder and notices changes made outside.
- **A project file**: one HTML page whose first `<script type="application/ld+json" data-frametrail="project">` holds the whole project as JSON. FrameTrail opens and saves it in place. Read [project-file.md](references/project-file.md) before editing one.
- **Not the data folder of a FrameTrail server** (it has a `.collab/` folder, or a `users.json` with accounts and passwords). Editors open on the server do not notice changes to its files and save over them, and such changes bypass accounts and locks. Say so, and offer instead: make the change in FrameTrail, or export the project as a project file (Save As), work on that, and import it there. The hooks ask the user before any change to such a folder.
- FrameTrail may have the same data open. When the user may have unsaved edits there, ask them to save and leave edit mode first.

## Workflow

1. **Find the data and the hypervideo.** `hypervideos/_index.json` maps ids to folders; `meta.name` in each `hypervideo.json` names them. Learn the hypervideo's time range: its first clip's `in` (where it starts) and `out`, else the clip's `duration`, else the length of the media (for a file in `resources/`, `ffprobe -v error -show_entries format=duration -of csv=p=0 <file>`). For a video given by URL, ask the user when the end matters.
2. **Read what the task needs**, no more. `hypervideo.json` holds overlays and code snippets (`contents`), chapters, subtitles entries, the layout and settings; each user's annotations are a file in `annotations/`. In large files and project pages, Grep for the part you need and Read around it.
3. **Talk before you build** (below).
4. **Change only the files that change.** Edit existing files rather than writing them anew, keep their four-space indentation and every property you do not know. One change can span several files: an annotation and its index entry, subtitles and their entry. Make all of them.
5. **Let the checks run** (below) and fix what they report.
6. **Hand over.** Say what you changed in a sentence or a short list, with times as m:ss. When FrameTrail has the data open: switch to its tab; it notices the change ("This hypervideo has changed in its folder", or "… in its project file"); reload the page to see it.

## Talk Before You Build

Before you change anything, decide what the message asks for:

- **A question** ("What happens at 2:00?", "How many overlays are there?"): answer it. Read what you need, change nothing.
- **A named change** ("Add a chapter 'Results' at 4:10", "Make the title red"): make it, then say what you did.
- **An idea or a wish without the details** ("This part is boring", "Could there be a quiz here?"): propose what you would do, in a few lines, and ask before you change anything.
- **Something large and open** (chapters for the whole video, a quiz for every part, a new layout): when the request settles the choices, do it; when choices are open that the user would care about (how many, which style, where), give your plan in a few lines and ask first.

When the user agrees to a proposal, carry it out as proposed. When a request could mean different things and it matters (which overlay, which language, which part of the video), ask one short question instead of guessing.

## Rules for the Data

Items (overlays, annotations, code snippets) are W3C Web Annotations with FrameTrail's extensions. [overlays.md](references/overlays.md) and [annotations.md](references/annotations.md) have complete examples; when the file already has an item of the same type, follow its shape.

- **The envelope:** `"type": "Annotation"`, `"frametrail:type"` (`"Overlay"` in `hypervideo.json` → `contents`, `"Annotation"` in an annotation file), `creator`, `created`, `target` with its `FragmentSelector`, and a `body` with the item's type in its `frametrail:type` and the type's settings in `frametrail:attributes`.
- **The current time** comes from the clock, never from a guess: `node -e "const d = new Date(); console.log(d.toISOString(), d.getTime())"` prints it as ISO 8601 and in milliseconds. Timestamps tell FrameTrail which version of a file is newer.
- **`created`** is what identifies an item: ISO 8601 in UTC with milliseconds (`"2026-10-09T14:03:12.481Z"`), unique among the hypervideo's overlays and among each user's annotations. Take the current time; for several new items, add a millisecond each.
- **`creator`** is the user: `{ "nickname": "<name>", "type": "Person", "id": "<user id>" }`. In a folder or project file the user id comes from the name they enter in FrameTrail: `node ${CLAUDE_PLUGIN_ROOT}/scripts/user-id.mjs "<name>"`. Ask for the name once; when the data already shows the user's id (an `owner` and `ownerId` in an annotations index, a hypervideo's `meta.creatorId`), confirm and reuse it.
- **`generator`:** on every item you add or change, `"generator": { "type": "Software", "name": "FrameTrail-Skills" }`. FrameTrail keeps it.
- **Time and place:** the selector's `value` is a Media Fragment: `t=<start>,<end>&xywh=percent:<left>,<top>,<width>,<height>` for an overlay, `t=<start>,<end>` for an annotation. Times are seconds as decimal numbers on the media's timeline: they include the clip's `in` (with `"in": 30`, five seconds into the hypervideo is `35`). The box is in percent of the video frame. `target.source` is the hypervideo's video, as in its other items.
- **Types:** the body's `frametrail:type` is one of FrameTrail's types. [TYPES.md](references/frametrail/TYPES.md) says what each is for, whether it can be an overlay or an annotation, where its source goes, and every attribute with its values and defaults. Read the section of the type you write (its heading is the type in backticks), not the whole file.
- **Text:** `attributes.text` of the `text` and `html` types is HTML stored escaped: `&lt;p&gt;Hello&lt;/p&gt;`. Titles, questions, answers and labels are plain text.
- **Motion is data:** entrances, emphasis, exits and text reveals are presets in `attributes.animation`; a box that moves has keyframes ([overlays.md](references/overlays.md#a-box-that-moves)). Never JavaScript for them.
- **Code only when asked:** `globalEvents`, code snippets, `customCSS`, `custom.css`, `frametrail:events` and a view's `onClickContentItem` run code in every viewer's browser. Write them only when the user asks for code. The one exception is FrameTrail's own default for hotspots and quizzes, a pause when they appear: `"frametrail:events": { "onStart": "FrameTrail.module('HypervideoController').pause();" }`. Leave it out when the user wants the video to go on.
- **`hypervideo.json`:** whenever you change it, set `meta.lastchanged` to the current time in milliseconds (it must be larger than before).
- **Annotations** go into the user's own file `annotations/<user id>.json`, every one with that user id as `creator.id`, and the file's entry in `annotations/_index.json` gets a new `lastchanged`. Never write other users' files. See [annotations.md](references/annotations.md).
- **Chapters** are `{ "start", "title" }` in `chapters`, sorted, each start once. **Subtitles** are a WebVTT file `subtitles/<lang>.vtt` plus its entry in `subtitles`. See [chapters-and-subtitles.md](references/chapters-and-subtitles.md).
- **Project files:** inside the data block FrameTrail writes every `<` as `\u003c`. Write `<` as usual; after each Write or Edit the check rewrites them and tells you. Never type `</script` into the block. See [project-file.md](references/project-file.md).
- **Do what was asked, nothing more.** Never remove or rewrite content the user did not ask you to touch, and do not fix problems you did not cause without asking; mention them instead.

## Checks

The plugin's hooks run FrameTrail's checks on your changes. They say nothing when they find nothing: no message means the change passed.

- **After each Write or Edit** of FrameTrail data: the file you changed. Its JSON, its JSON Schema, for a page the data block, for subtitles the WebVTT. Errors come back at once; fix them before you go on.
- **When you finish:** everything you changed, as a whole. Files that must agree (annotation files and their index, subtitles and their entries, hypervideo folders and the index), and FrameTrail's lint rules: items outside the video, overlays covering each other, items missing what their type needs, chapters out of order, and more (the rules are listed in [DATA-MODEL.md](references/frametrail/DATA-MODEL.md#checks-beyond-the-schemas)). Only problems your changes caused are reported, each once. Fix errors. For a warning, fix it or tell the user why it is right as it is.
- **Changes made through Bash** (a script, `cp`, `mv`, `sed`) are not seen by the hooks. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs <folder or page>` afterwards. It lists every problem of the data, including those that were there before you started.

## Undo

`/rewind` takes back changes made with Edit and Write, not those made through Bash. Before a large change to data that is not under version control, offer to copy the folder or page first.

## References

Read what the task needs:

- [overlays.md](references/overlays.md): boxes, a text overlay, a hotspot, a quiz, media and embeds, boxes that move, animation, changing and removing.
- [annotations.md](references/annotations.md): the user's id, annotation files and their index, where annotations show.
- [chapters-and-subtitles.md](references/chapters-and-subtitles.md): chapters, chapters from the subtitles, WebVTT.
- [layout.md](references/layout.md): the areas around the video and their content views.
- [new-hypervideo.md](references/new-hypervideo.md): a new hypervideo, its video, a new project.
- [project-file.md](references/project-file.md): the data block of a project file and how to edit it.
- FrameTrail's own documentation, at the version this plugin is built for: [DATA-MODEL.md](references/frametrail/DATA-MODEL.md) (the files, items, time and space, identity, older forms, the checks), [TYPES.md](references/frametrail/TYPES.md) (every type), [HTML-FORMAT.md](references/frametrail/HTML-FORMAT.md) (the page format).

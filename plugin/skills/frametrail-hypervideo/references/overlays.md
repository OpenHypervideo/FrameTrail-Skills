# Overlays

Overlays are the items in `hypervideo.json` → `contents` with `"frametrail:type": "Overlay"` (the others there are code snippets). Each is shown over the video from its start to its end, in a box. What each type shows and the attributes it takes: [TYPES.md](frametrail/TYPES.md), one section per type.

## The box

`xywh=percent:<left>,<top>,<width>,<height>` in the selector's `value`, in percent of the video frame, `0,0` at the top left. Fractions are fine. For orientation:

| Where | Box |
|-------|-----|
| a title across the top | `5,5,90,15` |
| a lower third | `5,72,60,20` |
| a card at the right | `66,10,30,40` |
| a hotspot on something in the picture | about its size, e.g. `40,30,12,18` |

You cannot see the video. Where something is in the picture, the user knows: ask, or take what they say ("top right", "on the left person's face") as the box. Overlays that are shown at the same time should not cover each other (lint warns: `overlay-overlap`); hotspots and cursors are meant to lie over others. Later items in `contents` are drawn above earlier ones; `zIndex` (an attribute every overlay takes) changes that.

## A text overlay

A card with a title and text, sliding in, its words revealed one by one, fading out:

```json frametrail:content-item
{
    "@context": ["http://www.w3.org/ns/anno.jsonld", "https://frametrail.org/ns/context.jsonld"],
    "type": "Annotation",
    "frametrail:type": "Overlay",
    "creator": { "nickname": "Anna B", "type": "Person", "id": "guest_anna-b-919e0619" },
    "created": "2026-10-09T14:03:12.481Z",
    "generator": { "type": "Software", "name": "FrameTrail-Skills" },
    "target": {
        "type": "Video",
        "source": "1_1783322343_lecture.mp4",
        "selector": {
            "type": "FragmentSelector",
            "conformsTo": "http://www.w3.org/TR/media-frags/",
            "value": "t=12.5,20&xywh=percent:5,72,60,20"
        }
    },
    "body": {
        "type": "TextualBody",
        "frametrail:type": "text",
        "format": "text/html",
        "value": "",
        "frametrail:name": "Key idea",
        "frametrail:attributes": {
            "title": "Key idea",
            "text": "&lt;p&gt;Cells copy their DNA before they divide.&lt;/p&gt;",
            "box": { "background": "#ffffff", "titleColor": "#14161a", "padding": 20, "radius": 12, "shadow": true },
            "animation": {
                "in": { "preset": "slideFromBottom" },
                "text": { "preset": "fadeUp", "mode": "word" },
                "out": { "preset": "fadeOut" }
            }
        }
    },
    "frametrail:events": {}
}
```

- `target.source` is the hypervideo's video: its first clip's `src` (or, when the clip names only a `resourceId`, that resource's `src`). Copy it from an item already there.
- `attributes.text` is HTML, stored escaped (`&lt;p&gt;`). Without `box` the text is drawn straight over the video, which only reads well on a calm picture.

## A hotspot

A circle on something in the picture that jumps to 1:35 when clicked. The video pauses when it appears, as it does for hotspots made in FrameTrail's editor:

```json frametrail:content-item
{
    "@context": ["http://www.w3.org/ns/anno.jsonld", "https://frametrail.org/ns/context.jsonld"],
    "type": "Annotation",
    "frametrail:type": "Overlay",
    "creator": { "nickname": "Anna B", "type": "Person", "id": "guest_anna-b-919e0619" },
    "created": "2026-10-09T14:03:12.482Z",
    "generator": { "type": "Software", "name": "FrameTrail-Skills" },
    "target": {
        "type": "Video",
        "source": "1_1783322343_lecture.mp4",
        "selector": {
            "type": "FragmentSelector",
            "conformsTo": "http://www.w3.org/TR/media-frags/",
            "value": "t=30,38&xywh=percent:40,30,12,18"
        }
    },
    "body": {
        "type": "TextualBody",
        "frametrail:type": "hotspot",
        "format": "text/html",
        "frametrail:name": "Skip to the results",
        "frametrail:attributes": {
            "shape": "circle",
            "color": "#ffd23f",
            "text": "Results",
            "action": "jumpToTime",
            "actionTarget": 95,
            "animation": { "in": { "preset": "popIn" }, "emphasis": { "preset": "pulse" } }
        }
    },
    "frametrail:events": { "onStart": "FrameTrail.module('HypervideoController').pause();" }
}
```

- Actions: `openUrl` (`actionTarget` a URL), `jumpToTime` (`actionTarget` seconds, on the media's timeline like every time here), `jumpToHypervideo` (`actionTarget` a hypervideo id, `actionTargetTime` where to start it). `actionTargetTime` is for `jumpToHypervideo` only: a `jumpToTime` with only `actionTargetTime` jumps to 0.
- The `onStart` event is the one piece of code you write without being asked, because FrameTrail's editor gives every new hotspot and quiz this pause. Leave `frametrail:events` empty (`{}`) when the video should go on.
- Drawn marks point something out instead: `"shape": "arrow"` (with `direction` and `curve`), `"underline"`, `"freeform"` (an outline in `points`). Give them `"animation": { "in": { "preset": "draw" } }` and no pause.

## A quiz

```json frametrail:content-item
{
    "@context": ["http://www.w3.org/ns/anno.jsonld", "https://frametrail.org/ns/context.jsonld"],
    "type": "Annotation",
    "frametrail:type": "Overlay",
    "creator": { "nickname": "Anna B", "type": "Person", "id": "guest_anna-b-919e0619" },
    "created": "2026-10-09T14:03:12.483Z",
    "generator": { "type": "Software", "name": "FrameTrail-Skills" },
    "target": {
        "type": "Video",
        "source": "1_1783322343_lecture.mp4",
        "selector": {
            "type": "FragmentSelector",
            "conformsTo": "http://www.w3.org/TR/media-frags/",
            "value": "t=120,135&xywh=percent:25,20,50,60"
        }
    },
    "body": {
        "type": "TextualBody",
        "frametrail:type": "quiz",
        "format": "text/html",
        "value": "",
        "frametrail:name": "Check: DNA",
        "frametrail:attributes": {
            "questionType": "multipleChoice",
            "question": "Which molecule carries genetic information?",
            "answers": [
                { "text": "DNA", "correct": true },
                { "text": "ATP", "correct": false },
                { "text": "Glucose", "correct": false }
            ],
            "onCorrectAnswer": { "showText": "Right: DNA stores the genetic code.", "resumePlayback": true, "jumpForward": false },
            "onWrongAnswer": { "showText": "Not quite. Watch this part again.", "resumePlayback": true, "jumpBackward": 30 }
        }
    },
    "frametrail:events": { "onStart": "FrameTrail.module('HypervideoController').pause();" }
}
```

A quiz needs room: half the frame or more. Its question and answers are plain text.

## Media and embeds

An image, a video, a YouTube video, a web page and the other library types show a source. When it is in the library (`resources/_index.json`), copy the resource into the body: its `src` into `body.source` or `body.value` (TYPES.md says which for each type), `name` into `frametrail:name`, `thumb` into `frametrail:thumb`, `licenseType` and `licenseAttribution` into `frametrail:licenseType` and `frametrail:licenseAttribution`, its `attributes`, and its id as `frametrail:resourceId`. The item keeps this copy; it does not look the resource up again. Lint warns when a media overlay has no licence type.

A file the user gives (an image, a video, audio, a PDF) goes into the library first: `node ${CLAUDE_PLUGIN_ROOT}/scripts/add-media.mjs <folder or page> <file> --user "<name>" [--name "<title>"] [--license <type> --attribution "<who>"]` copies and registers it and prints the body for an item made from it, as below; so does a media URL (an image, a YouTube video, …) with `--name`. Use that body as it is.

```jsonc
"body": {
    "type": "Image",
    "frametrail:type": "image",
    "format": "image/png",
    "source": "1_1790000060_dna-double-helix.png",          // a file in resources/, or a URL
    "frametrail:name": "DNA double helix",
    "frametrail:thumb": "1_1790000060_thumb_dna-double-helix.png",
    "frametrail:licenseType": "CC-BY-SA",
    "frametrail:licenseAttribution": "Example Author",
    "frametrail:resourceId": "2",
    "frametrail:attributes": {}
}
```

Embeds need the embed form of a URL (YouTube: `https://www.youtube.com/embed/<id>`, not the watch URL); TYPES.md names it for each type. A `video`, `youtube` or `vimeo` body may carry its own `selector` with `t=<from>,<to>` to play only part of the embedded media.

## A box that moves

Keyframes on the selector move, resize and rotate the box over time:

```jsonc
"selector": {
    "type": "FragmentSelector",
    "conformsTo": "http://www.w3.org/TR/media-frags/",
    "value": "t=40,46&xywh=percent:10,20,50,30",          // the union box, see below
    "frametrail:keyframes": [
        { "t": 40, "xywh": [10, 30, 20, 20] },
        { "t": 43, "xywh": [40, 20, 20, 20], "ease": "easeInOut" },
        { "t": 46, "xywh": [40, 20, 20, 30], "r": 15 }
    ]
}
```

One keyframe:

```json frametrail:common#/$defs/keyframe
{ "t": 43, "xywh": [40, 20, 20, 20], "r": 15, "ease": "easeInOut" }
```

- `t` in seconds (media timeline), sorted; `xywh` the box at that moment, in percent, and may lie outside 0–100 (to enter from off screen); `r` the rotation in degrees, clockwise; `ease` the easing of the segment to the next keyframe (`hold` keeps the box until the next one). Between keyframes the box is interpolated; before the first and after the last it holds.
- The box in `value` must be the **union** of the moving box within the overlay's span, clamped to 0–100: from the smallest left and top to the largest right (left + width) and bottom (top + height) of the keyframe boxes. With keyframes outside the span, take the boxes at the span's edges instead of those. In the example: left 10, top 20, right 60, bottom 50 → `10,20,50,30`.
- A box that does not move but is turned: `"frametrail:rotation": 15` on the selector, no keyframes.

## Animation

Entrances, emphasis, exits and text reveals are presets in `attributes.animation`, never code:

```jsonc
"animation": {
    "in":       { "preset": "fadeIn", "duration": 400, "ease": "easeOut" },   // plays before start
    "emphasis": { "preset": "pulse", "iterations": 0 },                      // loops within the span; 0 fills it
    "out":      { "preset": "fadeOut" },                                     // plays after end
    "text":     { "preset": "typewriter", "mode": "letter", "stagger": 40 }  // text overlays only
}
```

Every phase is optional. The presets of each phase and the eases are listed in [TYPES.md](frametrail/TYPES.md#animation); `duration` is in milliseconds. The entrance plays before the start and the exit after the end, so the overlay is fully there for exactly its span: an overlay that must be fully visible at 12 s starts at 12. Older overlays carry `animationIn`, `animationOut` and `animationDuration`; when you change their animation, replace those with `animation`.

## Changing and removing

Find an overlay by its `created` or `frametrail:name` (Grep in `hypervideo.json`), change only what was asked, keep everything else as it is, set `generator`, and set `meta.lastchanged`. To remove one, delete it from `contents`. Moving an overlay in time with keyframes: shift every keyframe's `t` by the same amount.

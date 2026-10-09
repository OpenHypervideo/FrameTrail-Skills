# Chapters and Subtitles

Both live with the hypervideo: chapters in `hypervideo.json`, subtitles as WebVTT files beside it. Times are seconds on the media's timeline, including the first clip's `in` point.

## Chapters

`hypervideo.json` → `chapters`, sorted by `start`; a chapter has only its start and its title, and no two start at the same time:

```json frametrail:hypervideo#/properties/chapters
[
    { "start": 0, "title": "Introduction" },
    { "start": 74.5, "title": "How DNA is copied" },
    { "start": 212, "title": "Mutations" }
]
```

- Every start lies inside the video: at or after the clip's `in`, before its end (lint: `item-outside-video`). The first chapter usually starts where the video starts.
- Keep the list sorted when you insert (lint: `chapter-order`), and change a chapter's start only when asked: the start is what identifies it.
- A `Chapters` view in the layout lists them ([layout.md](layout.md)).

## Chapters from the subtitles

What is said, and where the topic changes, only the subtitles tell. Chapters, items and titles do not.

1. Read the hypervideo's `.vtt` file in the language you want (the `subtitles` list of `hypervideo.json` names them). For a long video, read it in parts, in order: topic changes show only in the flow of the text, not in single words.
2. Decide where the topics change. A chapter starts at the cue that opens its topic; round to the second.
3. Titles: short (two to five words), in the language of the video, saying what the part is about.
4. How many: when the user did not say, about one per two to five minutes of video, and at least three for a video longer than five minutes. When the choice matters to them, propose the list (start as m:ss, title) and ask before writing it.
5. Write `chapters`, set `meta.lastchanged`.

Without subtitles, ask the user for the topics and their times, or offer to add subtitles they have as text.

## Subtitles

One WebVTT file per language in `hypervideos/<id>/subtitles/`, named `<language>.vtt`, plus its entry in `hypervideo.json` → `subtitles`:

```json frametrail:hypervideo#/properties/subtitles
[
    { "src": "en.vtt", "srclang": "en" },
    { "src": "de.vtt", "srclang": "de" }
]
```

`srclang` is a language code (`en`, `de`, `fr`, `pt-BR`). The file:

```
WEBVTT

1
00:00:00.500 --> 00:00:04.000
Today we look at how cells copy their DNA.

2
00:00:04.200 --> 00:00:09.750
Before a cell divides, both strands of the helix separate.
```

- The first line is `WEBVTT`. A cue is an optional number, a timing line `hh:mm:ss.ttt --> hh:mm:ss.ttt` (or `mm:ss.ttt`; a dot, then exactly three digits) and its text, with a blank line between cues. Cues are in order and do not overlap; each ends after it starts.
- Cue times are seconds of the media, like everything else: subtitles of a clipped video keep the times of the full video.
- From a text the user gives with times: one cue per sentence or line, at most about two lines of 40 characters each. From a text without times: ask for them; do not invent timings.
- Never change the cues of existing subtitles unless asked: they are often generated or checked against the audio.

A `Transcript` view shows the subtitles of one language as running text that follows the video ([layout.md](layout.md)); `config.captionsVisible` in `hypervideo.json` shows them as captions from the start. In a project file the subtitles are JSON strings in the bundle ([project-file.md](project-file.md)).

# Project Files

A project file is one HTML page that holds a whole FrameTrail project. Its data is the text of the first `<script type="application/ld+json" data-frametrail="project">` element: a project bundle, JSON. FrameTrail opens such a page (Chrome or Edge: "Open a Project" → **Open Project File**, or "Save to this file" on a page opened from the disk) and saves into that block; everything else in the page stays as it is. [HTML-FORMAT.md](frametrail/HTML-FORMAT.md) describes the format.

## Where things are

The bundle holds the same files as a `_data` folder, under other names:

| In a `_data` folder | In the bundle |
|---------------------|---------------|
| `hypervideos/_index.json` | `hypervideosIndex` |
| `hypervideos/<id>/hypervideo.json` | `hypervideos.<id>.hypervideo` |
| `hypervideos/<id>/annotations/_index.json` | `hypervideos.<id>.annotations.index` |
| `hypervideos/<id>/annotations/<user id>.json` | `hypervideos.<id>.annotations.files.<user id>` |
| `hypervideos/<id>/subtitles/<lang>.vtt` | `hypervideos.<id>.subtitles.<lang>`: the WebVTT text as a JSON string |
| `resources/_index.json` | `resources` |
| `tagdefinitions.json` | `tagdefinitions` |
| `config.json` | `config`: only the playback settings (`defaultTheme`, `defaultLanguage`, `videoFit`, overview settings) |
| `custom.css` | `customCSS` |

```jsonc
{
    "bundle": "project",
    "formatVersion": 1,
    "hypervideosIndex": { "hypervideo-increment": 1, "hypervideos": { "1": "./1" } },
    "hypervideos": {
        "1": {
            "bundle": "hypervideo",
            "formatVersion": 1,
            "id": "1",
            "hypervideo": { "meta": { … }, "config": { … }, "clips": [ … ], "contents": [ … ], "chapters": [ … ], "subtitles": [ { "src": "en.vtt", "srclang": "en" } ] },
            "annotations": { "index": { … }, "files": { "guest_anna-b-919e0619": [ … ] } },
            "subtitles": { "en": "WEBVTT\n\n00:00:00.500 --> 00:00:04.000\nToday we look at …" }
        }
    },
    "resources": { "resources-increment": 0, "resources": {} },
    "tagdefinitions": {},
    "config": { "defaultLanguage": "en" },
    "customCSS": ""
}
```

Everything the other references say holds inside the bundle: subtitles need both their entry in `hypervideo.subtitles` and their text in `subtitles`; annotations need both their file in `annotations.files` and its entry in `annotations.index`.

A page whose block is `data-frametrail="hypervideo"` (an export) holds one hypervideo bundle at the top: `hypervideo`, `annotations`, `subtitles`, and `resources` with the entries it uses. FrameTrail turns it into a project bundle the first time it saves the page; until then, edit it as it is.

## Editing the block

- Find the place with Grep (a `created`, a `"name"`, `"chapters"`), Read the lines around it, change them with Edit. The block is JSON, pretty-printed with four spaces.
- **`<` inside the block.** FrameTrail writes every `<` in the block as `\u003c`; JSON reads it back as `<`, and no text in the block can end it (`</script>`) or start an HTML comment. It matters for raw HTML, such as a CustomHTML view's `html` (the `text` of an `html` overlay is stored escaped and has no `<`), and any other text with a `<`. Write such text as you would anywhere (`"<p>Hello</p>"`): after each Write or Edit of the page, the check rewrites every `<` in the block as `\u003c` and tells you. Then:
  - Read the lines again before your next Edit of the page: the file has changed.
  - Text that holds `\u003c` cannot be matched by Edit, because what you type as `\u003c` arrives as `<`. Anchor the `old_string` on the text around it. To rewrite a value full of tags, use a short script that replaces that line of the page.
  - Never type `</script` inside the block. It ends the block at once, before the check can help, and the page no longer holds valid data. Write `<\/script` (JSON reads `\/` as `/`).
  - After changing the page with a script, `node ${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs --escape <page>` rewrites the `<` as FrameTrail does; then run the check.
- Leave the rest of the page alone: the start tag's attributes, the library, other scripts. `data-frametrail-config` and `data-frametrail-language` on the start tag are the page's playback settings; FrameTrail moves them into `config` when it saves.
- Media are never in the page. Clips and items refer to them by URL, or by a path relative to the start tag's `data-frametrail-datapath` plus `resources/` (with `./`, a `resources/` folder beside the page). `node ${CLAUDE_PLUGIN_ROOT}/scripts/add-media.mjs <page> <file> --user "<name>"` copies a file there and registers it in the block's `resources`; read the page again afterwards, before your next Edit of it.

The checks give a page's problems as JSON Pointers into the bundle (`/hypervideos/1/hypervideo/chapters/0/start`) or as a line and column of the page.

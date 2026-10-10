# A New Hypervideo

## In a `_data` folder

1. **The id.** In `hypervideos/_index.json`, raise `hypervideo-increment` by one; the new value is the id. Add the entry `"<id>": "./<id>"` under `hypervideos`:

   ```json frametrail:hypervideos-index
   { "hypervideo-increment": 3, "hypervideos": { "1": "./1", "2": "./2", "3": "./3" } }
   ```

   Keep the rest of the file (an `overviewMap`, for instance) as it is.

2. **`hypervideos/<id>/hypervideo.json`.** All of this is needed; `meta.creator` and `meta.creatorId` are the user's name and id (see [annotations.md](annotations.md#the-user)), `created` and `lastchanged` the current time in milliseconds, `meta.thumb` the video's thumbnail when it has one in the library (else `null`), the clip as in [The video](#the-video):

   ```json frametrail:hypervideo
   {
       "meta": {
           "name": "How Cells Divide",
           "description": "",
           "thumb": null,
           "creator": "Anna B",
           "creatorId": "guest_anna-b-919e0619",
           "created": 1791555605112,
           "lastchanged": 1791555605112
       },
       "config": {
           "slidingMode": "adjust",
           "slidingTrigger": "key",
           "theme": "",
           "autohideControls": false,
           "captionsVisible": false,
           "clipTimeVisible": false,
           "layoutArea": { "areaTop": [], "areaBottom": [], "areaLeft": [], "areaRight": [] }
       },
       "clips": [
           { "resourceId": null, "src": "https://example.org/media/cells.mp4", "duration": 0, "in": 0, "out": 0 }
       ],
       "contents": [],
       "chapters": [],
       "subtitles": [],
       "globalEvents": { "onReady": "", "onPlay": "", "onPause": "", "onEnded": "" },
       "customCSS": ""
   }
   ```

3. **`hypervideos/<id>/annotations/_index.json`**, which FrameTrail needs even without annotations:

   ```json frametrail:annotations-index
   { "mainAnnotation": null, "annotationfiles": {} }
   ```

4. Subtitles, chapters, overlays and a layout as for any hypervideo. A new hypervideo usually wants at least a layout: offer one ([layout.md](layout.md)).

## The video

Only the first clip is played. Its `src` is one of:

- **A media file** the user gives, a path on their disk. Add it to the library with `node ${CLAUDE_PLUGIN_ROOT}/scripts/add-media.mjs <folder or page> <file> --user "<name>" [--name "<title>"] [--license <type> --attribution "<who>"]`. It copies the file into `resources/` (for a project file, the `resources/` folder beside the page), names it as FrameTrail names uploads, registers it under the next id, and prints the clip to use (`{ "resourceId": "4", "src": "…", "duration": 0, "in": 0, "out": 0 }`), with ffprobe the video's length and with ffmpeg a thumbnail for `meta.thumb`. `--user` is the user's name, as for `creator` ([annotations.md](annotations.md#the-user)). `--license` is one of `Copyright`, `CC-BY`, `CC-BY-SA`, `CC-BY-ND`, `CC-BY-NC`, `CC-BY-NC-SA`, `CC-BY-NC-ND`, `CC0`; pass it and `--attribution` when the user names them. MP4 and WebM play in every browser: convert anything else first (`ffmpeg -i in.mov -c:v libx264 -c:a aac out.mp4`). The entry it writes into `resources/_index.json` (`created` in seconds):

  ```json frametrail:resources-index#/$defs/resource
  {
      "name": "Cells lecture",
      "type": "video",
      "src": "guest_anna-b-919e0619_1791555605112_Cells_lecture.mp4",
      "thumb": "guest_anna-b-919e0619_1791555605112_thumb_Cells_lecture.png",
      "creator": "Anna B",
      "creatorId": "guest_anna-b-919e0619",
      "created": 1791555605,
      "licenseType": "CC-BY",
      "licenseAttribution": "Anna B",
      "attributes": {}
  }
  ```

  FrameTrail resolves a file's `src` against `resources/`; a file anywhere else cannot be played.
- **A URL**: an MP4, WebM or HLS file, a YouTube embed URL (`https://www.youtube.com/embed/<id>`) or a Vimeo URL, straight into the clip with `"resourceId": null`. To have it in the library as well (FrameTrail's resource list, items made from it), `add-media.mjs <folder or page> <URL> --user "<name>" --name "<title>"` registers it, a YouTube or Vimeo page's URL in its embed form, and prints the clip.
- **Nothing**: an empty timeline, `"src": null` and `duration` in seconds. Overlays and annotations on a timeline without video work as on a video.

`duration` 0 means "read it from the media". `in` and `out` clip the media (`out` 0: to its end); every time in the hypervideo then stays on the media's timeline, so with `"in": 30` the hypervideo begins at 30.

## In a project file

The same, inside the data block ([project-file.md](project-file.md)): raise `hypervideosIndex["hypervideo-increment"]`, add the entry to `hypervideosIndex.hypervideos`, and add the hypervideo bundle under `hypervideos`:

```jsonc
"hypervideos": {
    "3": {
        "bundle": "hypervideo",
        "formatVersion": 1,
        "id": "3",
        "hypervideo": { … },                                  // as above
        "annotations": { "index": { "mainAnnotation": null, "annotationfiles": {} }, "files": {} }
    }
}
```

A project file holds no media files: its clips are URLs, or paths relative to the page's datapath (`./` means a `resources/` folder beside the page, where `add-media.mjs` puts a file).

## A new project

When there is no `_data` folder or project file yet, ask the user which they want, where, and what the project is called, then make it with `node ${CLAUDE_PLUGIN_ROOT}/scripts/create-project.mjs --folder <dir> | --file <page.html> [--title "<title>"] [--language en|de|fr]`. It never overwrites anything.

- **A `_data` folder** (`--folder`, an empty or new folder): FrameTrail edits it in Chrome or Edge ("Open a Project" → Select Folder), and its media files live in its `resources/`.
- **A project file** (`--file`): one HTML page that holds everything but the media, which go into a `resources/` folder beside it. It plays in any browser, also from the disk, and loads FrameTrail from the web; in Chrome or Edge FrameTrail also saves into it.

`--language` is the language of FrameTrail's interface, not the video's. Then add the hypervideo as above. Users who prefer to start in FrameTrail can make either there: in the "Open a Project" dialog, **Select Folder** with an empty folder, or **New Project File**.

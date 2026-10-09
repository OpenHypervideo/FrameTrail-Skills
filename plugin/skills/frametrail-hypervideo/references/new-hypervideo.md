# A New Hypervideo

## In a `_data` folder

1. **The id.** In `hypervideos/_index.json`, raise `hypervideo-increment` by one; the new value is the id. Add the entry `"<id>": "./<id>"` under `hypervideos`:

   ```json frametrail:hypervideos-index
   { "hypervideo-increment": 3, "hypervideos": { "1": "./1", "2": "./2", "3": "./3" } }
   ```

   Keep the rest of the file (an `overviewMap`, for instance) as it is.

2. **`hypervideos/<id>/hypervideo.json`.** All of this is needed; `meta.creator` and `meta.creatorId` are the user's name and id (see [annotations.md](annotations.md#the-user)), `created` and `lastchanged` the current time in milliseconds:

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

- **A URL**: an MP4, WebM or HLS file, a YouTube embed URL (`https://www.youtube.com/embed/<id>`) or a Vimeo URL. `resourceId` is `null`.
- **A file in the library**: copy the file into `resources/` and register it in `resources/_index.json` under the next `resources-increment` (raised by one, like the hypervideo's), then give the clip that `resourceId` and its `src`:

  ```json frametrail:resources-index#/$defs/resource
  {
      "name": "Cells lecture",
      "type": "video",
      "src": "cells-lecture.mp4",
      "creator": "Anna B",
      "creatorId": "guest_anna-b-919e0619",
      "created": 1791555605,
      "licenseType": "CC-BY",
      "licenseAttribution": "Anna B"
  }
  ```

  `created` here is in seconds. A file not in `resources/` cannot be played: FrameTrail resolves `src` against that folder.
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

A project file holds no media files: its clips are URLs, or paths relative to the page's datapath (`./` means a `resources/` folder beside the page).

## A new project

When there is no `_data` folder or project file yet, the user creates one in FrameTrail (Chrome or Edge): in the "Open a Project" dialog, **Select Folder** with an empty folder makes it a `_data` folder, **New Project File** makes a page. Then add the hypervideo here.

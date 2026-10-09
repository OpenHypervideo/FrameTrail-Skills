# The Layout Around the Video

`hypervideo.json` → `config.layoutArea` has four areas around the video: `areaTop`, `areaBottom`, `areaLeft`, `areaRight`. Each is a list of content views, shown as tabs when there are several; an empty list leaves the area out. The left and right areas are narrow columns, top and bottom wide rows: running text (annotations, a transcript) fits left or right, timelines fit top or bottom.

A content view is told apart by its `type`. Every view takes `name` (its tab label), `contentSize` (`small`, `medium`, `large`), `initClosed` (start with the area collapsed), `icon` and `cssClass`.

**Annotations in sync with the video** (`TimedContent`); `collectionFilter` limits them by tags, types, user ids or text, empty lists meaning all:

```json frametrail:hypervideo#/$defs/contentView
{
    "type": "TimedContent",
    "name": "Notes",
    "contentSize": "medium",
    "initClosed": false,
    "collectionFilter": { "tags": [], "types": [], "users": [], "text": "" }
}
```

**The transcript** of one language's subtitles, following the video (`Transcript`):

```json frametrail:hypervideo#/$defs/contentView
{ "type": "Transcript", "name": "Transcript", "contentSize": "large", "transcriptSource": "en", "showTranscriptSearch": true }
```

**The chapter list** (`Chapters`):

```json frametrail:hypervideo#/$defs/contentView
{ "type": "Chapters", "name": "Chapters", "contentSize": "small" }
```

**Timelines** of the annotations, one per user (`Timelines`):

```json frametrail:hypervideo#/$defs/contentView
{ "type": "Timelines", "name": "Timelines", "contentSize": "small", "filterAspect": "creatorId", "zoomControls": true }
```

**Your own HTML** (`CustomHTML`). The HTML is stored as it is, not escaped; elements with the class `timebased` and `data-start` / `data-end` (seconds) are highlighted while the video is between them:

```json frametrail:hypervideo#/$defs/contentView
{
    "type": "CustomHTML",
    "name": "About",
    "contentSize": "medium",
    "html": "<h3>About this video</h3><p>Part of the course <em>Molecular Biology</em>. <span class=\"timebased\" data-start=\"74.5\" data-end=\"212\">Now: how DNA is copied.</span></p>"
}
```

In a project file, every `<` of that HTML ends up written as `\u003c` inside the data block: the check rewrites them after your change ([project-file.md](project-file.md)).

When you add a view, keep the views already in the area and their order; add to the end unless the user says otherwise. A view's other settings (`onClickContentItem`, its JavaScript) are code: leave them as they are, and write them only when asked. Set `meta.lastchanged` after the change.

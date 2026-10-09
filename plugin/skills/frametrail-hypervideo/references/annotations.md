# Annotations

Annotations accompany the video beside it, not over it: notes, links, images, quizzes, shown in the content views around the video while it plays. Every user has their own: the annotations of a hypervideo are in one file per user, `hypervideos/<id>/annotations/<user id>.json`, a JSON array of items with `"frametrail:type": "Annotation"`, listed in `annotations/_index.json`. A user adds and changes only their own.

## The user

In a `_data` folder or a project file there are no accounts: FrameTrail asks for a name and derives the user id from it. Ask the user for the name they enter in FrameTrail (once per session) and compute the id:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/user-id.mjs "Anna B"     # guest_anna-b-919e0619
```

If an annotation file of that user already exists, the index has their entry (`owner` is the name, `ownerId` the id). The id names the file and is the `creator.id` of every annotation in it: FrameTrail keeps only the user's own items in their file and drops the rest the next time the user saves there.

## Adding annotations

1. Read the user's file, or start a new one as `[]`.
2. Append the items. An annotation has a time span but no box (`t=<start>,<end>`), and one of the types with a tick in the Annotation column of [TYPES.md](frametrail/TYPES.md#at-a-glance); `created` is unique among this user's annotations.
3. Set the file's entry in `annotations/_index.json`: a new entry for a new file; otherwise only a new `lastchanged`. `lastchanged` is in milliseconds and must grow: an editor that has the hypervideo open compares it before saving, and the other annotation files' entries stay as they are.

An annotation file with one annotation:

```json frametrail:annotation-file
[
    {
        "@context": ["http://www.w3.org/ns/anno.jsonld", "https://frametrail.org/ns/context.jsonld"],
        "type": "Annotation",
        "frametrail:type": "Annotation",
        "creator": { "nickname": "Anna B", "type": "Person", "id": "guest_anna-b-919e0619" },
        "created": "2026-10-09T14:20:05.112Z",
        "generator": { "type": "Software", "name": "FrameTrail-Skills" },
        "frametrail:tags": [],
        "target": {
            "type": "Video",
            "source": "1_1783322343_lecture.mp4",
            "selector": {
                "type": "FragmentSelector",
                "conformsTo": "http://www.w3.org/TR/media-frags/",
                "value": "t=62,75"
            }
        },
        "body": {
            "type": "TextualBody",
            "frametrail:type": "text",
            "format": "text/html",
            "value": "",
            "frametrail:name": "Replication",
            "frametrail:attributes": {
                "text": "&lt;p&gt;The two strands separate and each one is copied.&lt;/p&gt;"
            }
        }
    }
]
```

Its index, with this user's entry next to an existing one:

```json frametrail:annotations-index
{
    "mainAnnotation": "1",
    "annotationfiles": {
        "1": {
            "name": "demo", "description": "demo's annotations", "created": 1773150038,
            "lastchanged": 1791417588906, "hidden": false, "owner": "demo", "ownerId": 1
        },
        "guest_anna-b-919e0619": {
            "name": "Anna B", "description": "Anna B's annotations", "created": 1791555605,
            "lastchanged": 1791555605112, "hidden": false, "owner": "Anna B", "ownerId": "guest_anna-b-919e0619"
        }
    }
}
```

`created` here is in seconds, `lastchanged` in milliseconds. An index that has user entries at its top level instead of under `annotationfiles` is an older form: add the new entry under `annotationfiles` and leave the old ones.

## Where they show

Annotations appear in the hypervideo's content views: a `TimedContent` view shows them in sync with the video, a `Timelines` view as bars per user (see [layout.md](layout.md)). A hypervideo without such a view shows no annotations: say so, and offer to add one. A view's `collectionFilter` may limit it to some users, types or tags; check it includes what you add.

## Changing and removing

Only in the user's own file. Find an annotation by its `created`, change only what was asked, set `generator`, and give the index entry a new `lastchanged`. Never write other users' files.

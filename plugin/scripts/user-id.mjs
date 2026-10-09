/*
 * The user id FrameTrail gives a guest: someone editing a local _data folder or a project file under a name, without an account. It names their annotation file (annotations/<id>.json) and is the id in their items' creator. Computed by the vendored FrameTrailSerializer.guestUserID, as FrameTrail does: case and runs of white space do not matter.
 *
 *     node user-id.mjs "Anna B"     # guest_anna-b-919e0619
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { guestUserID } = require('../vendor/frametrail/serialization/FrameTrailSerializer.js');

const name = process.argv.slice(2).join(' ');

if (!name.trim()) {
    console.error('Usage: node user-id.mjs "<the name entered in FrameTrail>"');
    process.exit(2);
}

console.log(guestUserID(name));

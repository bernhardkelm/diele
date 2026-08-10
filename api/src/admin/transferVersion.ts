// Bumped when the shape changes in a way an older file cannot satisfy, so an import can
// refuse rather than half-apply. Older files still apply: a version 1 file lacks the connectors,
// a version 2 one carries them without their sealed credentials, and a version 3 one numbers its
// rows on the way in rather than carrying the ids its refs are built from.
export const VERSION = 4

// Bumped when the shape changes in a way an older file cannot satisfy, so an import can
// refuse rather than half-apply. Older files still apply: a version 1 file lacks the connectors,
// and a version 2 one carries them without their sealed credentials.
export const VERSION = 3

#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

VERSION="${1:-}"
MESSAGE="${2:-}"
NOTES="${NOTES:-}"

usage() {
  echo "Usage:   make release <x.x.x | major | minor | patch> \"release notes\""
  echo "         make release <x.x.x | major | minor | patch> NOTES=notes.md"
  echo "Example: make release 0.1.0 \"Expanded connectors\""
  echo "         make release patch \"Fix launcher focus\"   (bumps the latest tag's patch)"
}

if [ -z "$VERSION" ]; then
  echo "Error: VERSION is required."
  usage
  exit 1
fi

# Exactly one source for the notes: a literal message, or a file whose body becomes them.
if [ -n "$NOTES" ] && [ -n "$MESSAGE" ]; then
  echo "Error: pass either a message or NOTES=<file>, not both."
  usage
  exit 1
fi
if [ -z "$NOTES" ] && [ -z "$MESSAGE" ]; then
  echo "Error: a message or NOTES=<file> is required."
  usage
  exit 1
fi
if [ -n "$NOTES" ] && [ ! -f "$NOTES" ]; then
  echo "Error: notes file '$NOTES' does not exist."
  exit 1
fi

if ! command -v gh &> /dev/null; then
  echo "Error: gh (GitHub CLI) is not installed."
  exit 1
fi

# The release commits a version bump to main and tags it, so it has to start from exactly what
# main is: the right branch, nothing uncommitted, nothing unpushed or unpulled.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "Error: releases are cut from main (currently on '$BRANCH')."
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: the working tree is not clean. Commit or stash first."
  exit 1
fi
git fetch --tags --quiet origin
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Error: local main and origin/main differ. Push or pull first."
  exit 1
fi

# Resolve a bump keyword (major|minor|patch) into a concrete version off the latest x.x.x tag.
BUMP="$(printf '%s' "$VERSION" | tr 'A-Z' 'a-z')"
if [ "$BUMP" = major ] || [ "$BUMP" = minor ] || [ "$BUMP" = patch ]; then
  # --sort=-v:refname = version sort descending (so 0.10.0 > 0.9.0); keep only plain x.x.x tags.
  LATEST="$(git tag -l --sort=-v:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -n1)"
  [ -z "$LATEST" ] && LATEST="0.0.0"   # no prior release: patch->0.0.1, minor->0.1.0, major->1.0.0
  IFS='.' read -r MAJ MIN PAT <<< "$LATEST"
  case "$BUMP" in
    major) MAJ=$((MAJ + 1)); MIN=0; PAT=0 ;;
    minor) MIN=$((MIN + 1)); PAT=0 ;;
    patch) PAT=$((PAT + 1)) ;;
  esac
  VERSION="${MAJ}.${MIN}.${PAT}"
  echo "Bumping ${BUMP}: ${LATEST} -> ${VERSION}"
fi

# Validate the (possibly bumped) version is strict x.x.x — three numeric parts, no pre-release
# suffix, and no `v` prefix: the CI tag trigger matches the bare semver shape.
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: '$VERSION' is not a version (x.x.x) or a bump keyword (major|minor|patch)."
  usage
  exit 1
fi

# Refuse to clobber an existing tag (the bump-then-tag-then-release steps below are not atomic;
# bailing here avoids a confusing half-applied state).
if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null 2>&1; then
  echo "Error: tag '$VERSION' already exists."
  exit 1
fi

# Root and every workspace carry the released version, so the tag never points at a tree that
# still calls itself something older. --no-git-tag-version, because npm's own tag would be
# `v`-prefixed and invisible to the CI trigger.
echo "Bumping package versions to $VERSION ..."
npm version "$VERSION" --workspaces --include-workspace-root --no-git-tag-version >/dev/null
git add package.json package-lock.json api/package.json common/package.json web/package.json
git commit -m "Release $VERSION"

echo "Pushing main ..."
git push origin main

echo "Tagging $VERSION ..."
if [ -n "$NOTES" ]; then
  git tag -a "$VERSION" -F "$NOTES"
else
  git tag -a "$VERSION" -m "$MESSAGE"
fi

echo "Pushing tag to origin ..."
git push origin "$VERSION"

# Reuse the annotated tag's body verbatim as the GitHub release notes; the title stays the bare
# version, the repo name already says the rest.
echo "Creating GitHub release $VERSION ..."
git tag -l --format='%(contents)' "$VERSION" | gh release create "$VERSION" --title "$VERSION" --notes-file -

echo "✓ Release $VERSION created. The tag build publishes the image tags $VERSION, ${VERSION%.*} and latest."

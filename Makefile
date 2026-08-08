.PHONY: help release

# Default target
help:
	@echo "Available targets:"
	@echo "  make release                    - Bump versions, tag + push a GitHub release (make release <x.x.x|major|minor|patch> \"msg\")"

# Cut a release:  make release 0.1.0 "Expanded connectors"
# The first arg is either an explicit x.x.x version or a bump keyword (major|minor|patch) that the
# script increments off the latest tag; the message becomes the annotated-tag body, reused verbatim
# as the GitHub release notes. Pass NOTES=<file.md> instead of a message to release with written
# notes: the file body becomes the tag body and the notes alike.
#
# Positional args work because Make treats the words after `release` as goals: we collect everything
# after the first goal (release_args) and add a no-op match-anything rule so Make doesn't abort with
# "No rule to make target '0.1.0'". That rule is defined ONLY when the first goal is `release`, so a
# mistyped target (e.g. `make releas`) still errors normally instead of silently no-op'ing.
# VERSION=/MESSAGE= still work too, and are the safe form if the message contains $ or # (which Make
# would otherwise interpret).
release_args := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
RELEASE_VERSION := $(or $(word 1,$(release_args)),$(VERSION))
RELEASE_MESSAGE := $(or $(wordlist 2,$(words $(release_args)),$(release_args)),$(MESSAGE))
ifeq ($(firstword $(MAKECMDGOALS)),release)
%:
	@:
endif

release:
	@bash scripts/create-release.sh "$(RELEASE_VERSION)" "$(RELEASE_MESSAGE)"

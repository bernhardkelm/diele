// The relay's entry, kept apart from relay.js so the tests can load the logic without running it.
// Registered at document_idle in the top frame only, so it runs once per diele page load, then
// again when the tab is returned to or the worker nudges it.

const runRelay = relayTriggerOf(relayDepsOf(globalThis))

void runRelay('load')
listenForRelayTriggers(globalThis, runRelay)

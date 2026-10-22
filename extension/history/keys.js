// What history keeps in chrome.storage.local, shared by the service worker, which writes it, and
// the popup, which reads it. Never sync: the permissions behind it are this browser's alone, and
// the buffer is this browser's pages.

// The one instance visits go to, as {id, url, titles}, titles being whether page titles go too
const HISTORY_TARGET_KEY = 'dieleHistoryTarget'

// The instance a permission prompt was opened for and what it switches on, history or titles, so
// the worker can finish the switch when the prompt outlives the popup that asked
const HISTORY_PENDING_KEY = 'dieleHistoryPending'

// What the target last said about itself and the signed-in account, as the relay read it
const HISTORY_STATE_KEY = 'dieleHistoryState'

// Visits waiting to be sent, already stripped to origin and path
const HISTORY_BUFFER_KEY = 'dieleHistoryBuffer'

// The batch a relay is posting, as {id, until}, so a second diele tab loading meanwhile is handed
// nothing rather than the same visits
const HISTORY_LEASE_KEY = 'dieleHistoryLease'

// The diele tabs of the target whose relay said it is there, in chrome.storage.session, which
// outlives the worker being stopped but not the browser; their pages load again on a restart
const HISTORY_TABS_KEY = 'dieleHistoryTabs'

// The optional permissions recording needs, requested together and given back together
const HISTORY_API_PERMISSIONS = ['webNavigation', 'scripting']

// Only titles need `tabs`: a tab's incognito flag is readable without it, its title is not
const HISTORY_TITLE_PERMISSIONS = ['tabs']

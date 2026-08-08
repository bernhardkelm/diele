import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'

// index 9 maps to '0', so the tenth entry stays reachable
const DIGIT_CODES = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
]

/** Nothing highlighted: Enter submits the query to the search engine instead of opening. */
const NO_SELECTION = -1

/** Anything the launcher can filter and open: saved sites, cards and connector rows alike. */
export interface LaunchTarget {
  /** Stable identity, which is what the selection is held by rather than a position */
  readonly ref: string
  readonly name: string
  readonly url: string
  /** Extra terms that match this target, beyond its name and url */
  readonly keywords?: ReadonlyArray<string>
  /** Listed only while a term is being searched, never on the resting page */
  readonly searchOnly?: boolean
}

/**
 * Returns the digit key that launches the entry at a position in the list.
 * @param {number} index - Zero-based position in the filtered list
 * @returns {string | undefined} - Digit key, or undefined past the tenth entry
 */
export function shortcutFor(index: number): string | undefined {
  return DIGIT_CODES[index]?.replace('Digit', '')
}

/** One thing a target can open. */
interface TargetAction {
  readonly href: string
}

/**
 * Filters targets by a plain substring, which is what a launcher without a ranker falls back
 * to. Callers that want soft matching pass their own through `match`.
 * @param {ReadonlyArray<T>} targets - Targets to filter
 * @param {string} term - Trimmed search term
 * @returns {ReadonlyArray<T>} - Matching targets, in source order
 */
function substringMatch<T extends LaunchTarget>(
  targets: ReadonlyArray<T>,
  term: string,
): ReadonlyArray<T> {
  const needle = term.toLowerCase()

  return targets.filter(
    (target) =>
      target.name.toLowerCase().includes(needle) ||
      target.url.toLowerCase().includes(needle) ||
      target.keywords?.some((keyword) => keyword.toLowerCase().startsWith(needle)),
  )
}

/** The stretch of matches the tile grid renders, in match indices. */
interface TileGrid {
  readonly start: number
  /** One past the last tile */
  readonly end: number
  readonly columns: number
}

export interface LauncherOptions<T> {
  /**
   * Filters and orders the fixed targets for a term. Whatever it returns first is what Enter
   * opens, so a ranking one belongs here. Defaults to a plain substring filter.
   */
  match?: (targets: ReadonlyArray<T>, term: string) => ReadonlyArray<T>
  /** Called with the target a launch opened, before the page navigates away */
  onLaunch?: (target: T) => void
  /** Actions a target offers, default first; the left and right keys move between them */
  actionsOf?: (target: T) => ReadonlyArray<TargetAction>
  /** Targets the digit shortcuts count; everything else is reachable by arrow only */
  hasShortcut?: (target: T) => boolean
  /** Whether the launcher is the view on screen; its keys do nothing while it is not */
  enabled?: MaybeRefOrGetter<boolean>
  /**
   * Targets derived from the term itself rather than filtered out of the fixed list, such
   * as "go to this url". They lead the matches, because a term that produced one is a
   * stronger signal than anything the term merely matched.
   */
  dynamicTargets?: (term: string) => ReadonlyArray<T>
  /** Targets rendered as tiles, which the arrows walk as a grid rather than as a list */
  isTile?: (target: T) => boolean
  /** Tiles per row as the layout renders them; under two, the tiles walk as a list */
  tileColumns?: MaybeRefOrGetter<number>
}

export interface Launcher<T extends LaunchTarget> {
  /** Current filter term, also the term the search engine receives */
  query: Ref<string>
  /** Targets matching `query`, in source order; all targets when the term is empty */
  matches: ComputedRef<ReadonlyArray<T>>
  /** Position of the highlight, or NO_SELECTION while nothing is picked */
  activeIndex: ComputedRef<number>
  /** Action selected on the highlighted match, 0 being the target itself */
  activeAction: Ref<number>
  hasSelection: ComputedRef<boolean>
  /** The highlighted target, or undefined while nothing is picked */
  activeTarget: ComputedRef<T | undefined>
  /** Moves the highlight by `delta` rows, entering the list from NO_SELECTION */
  move: (delta: number) => void
  /** Moves the highlight by `delta` sideways: one tile in the grid, one action on a row */
  moveColumn: (delta: number) => void
  /** Empties the term and drops the highlight */
  clear: () => void
  launch: (target: T | undefined, newTab?: boolean) => void
  /** Opens the highlighted match; a no-op while nothing is selected */
  launchActive: (newTab?: boolean) => void
}

/**
 * Wires the global launcher shortcuts to a filtered view of the launch targets: up and down
 * move the highlight while typing, left and right switch between the highlighted entry's
 * actions, Alt with a digit opens one of the first ten cards straight away, and Escape
 * clears. Over the tiles all four arrows follow the grid instead, so down means one row
 * rather than one tile. A term with matches highlights the first of them, so Enter prefers
 * what the portal already knows over handing the term to a search engine.
 * @param {MaybeRefOrGetter<ReadonlyArray<T>>} targets - Entries the launcher can reach, reactive so async ones join later
 * @param {LauncherOptions<T>} options - Action resolution and digit shortcut eligibility
 * @returns {Launcher<T>} - Reactive launcher state and its controls
 */
export function useLauncher<T extends LaunchTarget>(
  targets: MaybeRefOrGetter<ReadonlyArray<T>>,
  options: LauncherOptions<T> = {},
): Launcher<T> {
  const actionsOf = options.actionsOf ?? ((target: T) => [{ href: target.url }])
  const query = ref('')
  // The selection is the target's ref, not its position. Connector entries and search results
  // arrive after the first paint, and an index would leave the highlight sitting on whatever
  // slid into that slot while someone was already reaching for Enter.
  const activeRef = ref<string | undefined>()
  const activeAction = ref(0)

  const matches = computed(() => {
    const all = toValue(targets)
    const term = query.value.trim()
    // the resting page is the portal itself, so search-only entries stay out of it
    if (!term) {
      return all.filter((target) => !target.searchOnly)
    }

    const found = (options.match ?? substringMatch)(all, term)

    return [...(options.dynamicTargets?.(term) ?? []), ...found]
  })

  // -1 is what findIndex returns for a target that is no longer among the matches, which is
  // also NO_SELECTION: a selection whose entry went away is exactly no selection.
  const activeIndex = computed(() =>
    activeRef.value === undefined
      ? NO_SELECTION
      : matches.value.findIndex((target) => target.ref === activeRef.value),
  )
  const activeTarget = computed(() => matches.value[activeIndex.value])
  const hasSelection = computed(() => activeIndex.value !== NO_SELECTION)

  /**
   * Moves the highlight to a position in the match list, dropping it when the position is
   * outside it.
   * @param {number} index - Position to select, or NO_SELECTION to drop the highlight
   * @returns {void}
   */
  function selectAt(index: number): void {
    activeRef.value = matches.value[index]?.ref
  }

  const activeActions = computed(() => {
    const target = activeTarget.value
    return target ? actionsOf(target) : []
  })

  // Targets the digit shortcuts count, which is a subset of the matches: the badges only
  // sit on the cards, so the digits must skip everything rendered as a row.
  const shortcutTargets = computed(() =>
    options.hasShortcut ? matches.value.filter(options.hasShortcut) : matches.value,
  )

  // The stretch of matches the grid renders. Tiles never interleave with rows, so the first
  // one and the end of its run bound the whole section.
  const tileGrid = computed<TileGrid | undefined>(() => {
    const isTile = options.isTile
    const columns = toValue(options.tileColumns ?? 1)
    if (!isTile || columns < 2) {
      return undefined
    }

    const found = matches.value
    const start = found.findIndex(isTile)
    if (start === -1) {
      return undefined
    }

    let end = start + 1
    while (end < found.length && isTile(found[end]!)) {
      end += 1
    }

    return { start, end, columns }
  })

  /**
   * Returns whether an index sits on a tile.
   * @param {number} index - Position in the match list
   * @returns {boolean} - True while the tile grid holds that index
   */
  function isTiled(index: number): boolean {
    const grid = tileGrid.value
    return grid !== undefined && index >= grid.start && index < grid.end
  }

  // Anything found here beats handing the term to a search engine, so a new term lands the
  // highlight on the best match and Enter opens it. The resting page has no term, so it starts
  // unselected and Enter stays inert.
  watch(query, (term) => {
    activeRef.value = term.trim() ? matches.value[0]?.ref : undefined
    activeAction.value = 0
  })

  // Async targets join a term that is already standing. Because the selection is a ref, the
  // list may reorder underneath it without the highlight moving; this only fills one in when
  // there is none yet, or repairs one whose entry has gone away.
  watch(matches, (current) => {
    if (!query.value.trim()) {
      return
    }

    if (activeRef.value === undefined || !current.some((t) => t.ref === activeRef.value)) {
      activeRef.value = current[0]?.ref
    }
  })

  // a different entry starts on its own default action rather than inheriting a column
  watch(activeRef, () => {
    activeAction.value = 0
  })

  /**
   * Returns where a vertical step lands, which is a whole row inside the tile grid and a
   * single entry everywhere else. A partial last row would otherwise swallow the step, so
   * overshooting either edge of the grid lands on the entry just outside it.
   * @param {number} index - Position the step starts from
   * @param {number} delta - Rows to move, negative to move up
   * @returns {number} - Position to move to, which the caller still bounds
   */
  function verticalTarget(index: number, delta: number): number {
    const grid = tileGrid.value
    if (!grid || !isTiled(index)) {
      return index + delta
    }

    const next = index + delta * grid.columns
    if (next >= grid.end) {
      return grid.end
    }
    if (next < grid.start) {
      return grid.start - 1
    }
    return next
  }

  /**
   * Moves the highlight by a number of rows. The search field is a station in the ring
   * rather than an edge: stepping past either end drops the highlight and hands Enter back
   * to the engine, and stepping again re-enters the list from that side.
   * @param {number} delta - Rows to move, negative to move up
   * @returns {void}
   */
  function move(delta: number): void {
    const count = matches.value.length
    if (count === 0) {
      return
    }

    if (activeIndex.value === NO_SELECTION) {
      selectAt(delta > 0 ? 0 : count - 1)
      return
    }

    const next = verticalTarget(activeIndex.value, delta)
    selectAt(next < 0 || next >= count ? NO_SELECTION : next)
  }

  /**
   * Moves the selection within the highlighted entry's actions, wrapping past either end.
   * @param {number} delta - Actions to move, negative to move left
   * @returns {void}
   */
  function moveAction(delta: number): void {
    const count = activeActions.value.length
    if (count <= 1) {
      return
    }
    activeAction.value = (activeAction.value + delta + count) % count
  }

  /**
   * Moves the highlight sideways: one tile within the grid, one action along a row. The
   * grid stops at its own ends, so a sideways key never leaves the tiles for a row.
   * @param {number} delta - Steps to move, negative to move left
   * @returns {void}
   */
  function moveColumn(delta: number): void {
    const grid = tileGrid.value
    if (!grid || !isTiled(activeIndex.value)) {
      moveAction(delta)
      return
    }

    const next = activeIndex.value + delta
    if (next >= grid.start && next < grid.end) {
      selectAt(next)
    }
  }

  /**
   * Empties the term and drops the highlight.
   * @returns {void}
   */
  function clear(): void {
    query.value = ''
    activeRef.value = undefined
    activeAction.value = 0
  }

  /**
   * Navigates to a url. The portal is itself a new tab page, so opening in place is the
   * default and a second tab is the deliberate exception.
   * @param {TargetAction | undefined} action - Action to open, no-op when absent
   * @param {boolean} newTab - Opens alongside instead of replacing
   * @returns {void}
   */
  function open(action: TargetAction | undefined, newTab = false): void {
    if (!action) {
      return
    }

    if (newTab) {
      window.open(action.href, '_blank', 'noopener')
    } else {
      window.location.assign(action.href)
    }
  }

  /**
   * Opens a target's default action.
   * @param {T | undefined} target - Entry to launch, no-op when absent
   * @param {boolean} newTab - Opens alongside instead of replacing
   * @returns {void}
   */
  function launch(target: T | undefined, newTab = false): void {
    if (!target) {
      return
    }

    const action = actionsOf(target)[0]
    options.onLaunch?.(target)
    open(action, newTab)
  }

  /**
   * Opens the action selected on the highlighted match.
   * @param {boolean} newTab - Opens alongside instead of replacing
   * @returns {void}
   */
  function launchActive(newTab = false): void {
    const target = activeTarget.value
    if (!target) {
      return
    }

    // resolved before the launch is reported: a listener that feeds the ranking would
    // otherwise reorder the matches under the selection and open whatever slid into its place
    const action = activeActions.value[activeAction.value]
    options.onLaunch?.(target)
    open(action, newTab)
  }

  /**
   * Routes global key presses to the launcher controls.
   * @param {KeyboardEvent} event - Key event from the window listener
   * @returns {void}
   */
  function onKeydown(event: KeyboardEvent): void {
    // The listener is on the window, so it outlives the view that owns it: every other route
    // renders instead of the launcher, and without this its arrows and shortcuts would still
    // be driving a list nobody can see.
    if (options.enabled !== undefined && !toValue(options.enabled)) {
      return
    }

    // Option on its own and nothing else: AltGr reports as ctrl with alt on Windows layouts,
    // and a chord the portal does not claim belongs to the browser or the system.
    // The physical key is read, because Alt rewrites event.key to a symbol on macOS layouts.
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      const index = DIGIT_CODES.indexOf(event.code)
      if (index !== -1) {
        event.preventDefault()
        launch(shortcutTargets.value[index])
      }
      return
    }

    if (event.metaKey || event.ctrlKey) {
      return
    }

    if (event.key === 'Escape') {
      clear()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }

    // only steal the horizontal arrows once an entry is picked, so they stay caret keys
    // for the search input the rest of the time
    if (hasSelection.value && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      moveColumn(event.key === 'ArrowRight' ? 1 : -1)
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  return {
    query,
    matches,
    activeIndex,
    activeAction,
    hasSelection,
    activeTarget,
    move,
    moveColumn,
    clear,
    launch,
    launchActive,
  }
}

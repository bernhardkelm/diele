import { computed, type ComputedRef, type Ref } from 'vue'
import { useLaunchHistory } from '@/features/portal/useLaunchHistory'
import { useLauncher } from '@/features/portal/useLauncher'
import { useVisitedUrls } from '@/features/portal/useVisitedUrls'
import { actionsFor } from '@/features/portal/launchActions'
import { isCard, isCommand, isSuggestion, partitionTargets } from '@/features/portal/launchTargets'
import { pasteTargetFor } from '@/features/portal/pasteTarget'
import { searchTargets } from '@/features/portal/searchTargets'
import { parseSlash } from '@/features/portal/slashCommands'
import { slashTargetsFor } from '@/features/portal/slashTargets'
import { subredditTargetFor } from '@/features/portal/subredditTarget'
import type { ApiCommand } from '@diele/common'
import type { CommandTarget, PortalTarget } from '@/types/portal'

export interface PortalLauncherOptions {
  /** Everything the field can match, in the order ties are broken by */
  readonly targets: ComputedRef<ReadonlyArray<PortalTarget>>
  readonly slashCommands: ComputedRef<ReadonlyArray<ApiCommand>>
  /** Whether the subreddit jump is offered, which is a portal setting */
  readonly redditEnabled: ComputedRef<boolean>
  /** Whether the admin entry appears in the slash menu */
  readonly offersAdmin: ComputedRef<boolean>
  readonly userName: ComputedRef<string | null>
  /** How wide a row of tiles currently is, so the arrows can step by it */
  readonly tileColumns: Ref<number>
  /** Whether the launcher's keys are live, which is false wherever another view is on screen */
  readonly enabled: () => boolean
  /** Turns a term into a search engine url, empty when there is nothing to search with */
  readonly urlFor: (term: string) => string | undefined
  readonly openAdmin: () => void
  readonly openSettings: () => void
  readonly signOut: () => void
}

export interface PortalLauncher {
  query: Ref<string>
  sections: ComputedRef<ReturnType<typeof partitionTargets>>
  /** Index the list marks, or undefined when nothing is selected */
  highlight: ComputedRef<number | undefined>
  /** True once the term is more than whitespace, which is what turns the page into results */
  isSearching: ComputedRef<boolean>
  /** The term after a slash keyword, which is what may mark up a command row */
  commandQuery: ComputedRef<string>
  /** What a screen reader announces for the current selection, action included */
  activeName: ComputedRef<string | undefined>
  activeIndex: Ref<number>
  /** Everything the term matched, which is what the page renders and counts */
  matches: ComputedRef<ReadonlyArray<PortalTarget>>
  hasSelection: ComputedRef<boolean>
  /** Which of the selected target's actions the arrows are on */
  activeAction: Ref<number>
  /** Records an opened target, for the lists that launch one without going through the field */
  recordLaunch: (target: PortalTarget) => void
  runCommand: (command: CommandTarget) => void
  /** Opens the selection, or searches the term when nothing is selected */
  submit: (newTab: boolean) => void
}

/**
 * Wires the launcher up for the portal page: what it matches, what it adds to the list as you
 * type, what happens when you pick something, and what the header announces.
 *
 * This is the portal's own interaction logic rather than composition, so it sits here and
 * leaves `App.vue` to assemble views.
 * @param {PortalLauncherOptions} options - Everything the page knows that the launcher needs
 * @returns {PortalLauncher} - Launcher state and the two ways to act on it
 */
export function usePortalLauncher(options: PortalLauncherOptions): PortalLauncher {
  const { boostFor, remember: rememberLaunch } = useLaunchHistory()
  const { remember: rememberVisit } = useVisitedUrls()

  /**
   * Records a target that was opened. Every launch feeds the ranking, and one that came from a
   * url typed into the field also lands in the visited list, whose hosts can later be lifted
   * into the saved sites.
   * @param {PortalTarget} target - Target that was opened
   * @returns {void}
   */
  function recordLaunch(target: PortalTarget): void {
    rememberLaunch(target.ref)
    if (isSuggestion(target) && target.adHoc) {
      rememberVisit(target.url)
    }
  }

  /**
   * Puts a term in the search field, for a command entry whose job is to lead to others.
   * @param {string} term - Term to type into the field
   * @returns {void}
   */
  function prefill(term: string): void {
    query.value = term
  }

  // only the cards carry digit badges, so the digits count cards and skip every row
  const {
    query,
    matches,
    activeIndex,
    activeAction,
    hasSelection,
    activeTarget,
    clear,
    launchActive,
  } = useLauncher(options.targets, {
    // a slash term addresses the commands alone, so the ordinary targets sit it out rather
    // than fuzzy-matching the slash itself
    match: (all, term) =>
      parseSlash(term) ? [] : searchTargets(all, term, (target) => boostFor(target.ref)),
    onLaunch: recordLaunch,
    actionsOf: actionsFor,
    hasShortcut: isCard,
    enabled: options.enabled,
    isTile: isCard,
    tileColumns: options.tileColumns,
    dynamicTargets: (term) => {
      // a slash term addresses the commands alone, so an ordinary search is untouched by them
      const slash = slashTargetsFor(term, {
        commands: options.slashCommands.value,
        openAdmin: options.openAdmin,
        openSettings: options.openSettings,
        offersAdmin: options.offersAdmin.value,
        signOut: options.signOut,
        userName: options.userName.value,
        prefill,
      })
      if (slash) {
        return slash
      }

      return [
        options.redditEnabled.value ? subredditTargetFor(term) : undefined,
        pasteTargetFor(term),
      ].filter((target) => target !== undefined)
    },
  })

  const sections = computed(() => partitionTargets(matches.value))
  const highlight = computed(() => (hasSelection.value ? activeIndex.value : undefined))
  // an empty term matches everything, which is the full page rather than a search result
  const isSearching = computed(() => query.value.trim().length > 0)
  // the keyword addresses the menu itself, so only the term after it can mark up a row
  const commandQuery = computed(() => parseSlash(query.value)?.args ?? '')

  const activeName = computed(() => {
    const target = activeTarget.value
    if (!target) {
      return undefined
    }

    const action = actionsFor(target)[activeAction.value]
    return action?.label ? `${action.title} of ${target.name}` : target.name
  })

  /**
   * Runs a command entry and hands the field back to searching, since a command leaves the
   * portal on screen rather than navigating away from it. An entry meant to be run several
   * times keeps the menu open instead.
   * @param {CommandTarget} command - Entry to run
   * @returns {void}
   */
  function runCommand(command: CommandTarget): void {
    command.run()
    if (!command.keepsQuery) {
      clear()
    }
  }

  /**
   * Opens the highlighted entry, or sends the term to the search engine when nothing is
   * highlighted. The portal is itself a new tab page, so everything replaces it in place
   * unless the modifier asks for a second tab.
   * @param {boolean} newTab - True when cmd or ctrl was held, opening alongside instead
   * @returns {void}
   */
  function submit(newTab: boolean): void {
    const target = activeTarget.value
    if (target && isCommand(target)) {
      runCommand(target)
      return
    }

    if (hasSelection.value) {
      launchActive(newTab)
      if (newTab) {
        clear()
      }
      return
    }

    if (!isSearching.value) {
      return
    }

    const url = options.urlFor(query.value)
    if (!url) {
      return
    }

    if (newTab) {
      window.open(url, '_blank', 'noopener')
    } else {
      window.location.assign(url)
    }
  }

  return {
    query,
    matches,
    hasSelection,
    activeAction,
    recordLaunch,
    sections,
    highlight,
    isSearching,
    commandQuery,
    activeName,
    activeIndex,
    runCommand,
    submit,
  }
}

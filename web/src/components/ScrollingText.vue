<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

interface ScrollingTextProps {
  text: string
  /** Whether this line's row holds focus, which is the only time it reads itself out */
  focused?: boolean
}

const props = defineProps<ScrollingTextProps>()

// What separates the end of the line from its start coming round again. Short, because every
// character of it is a step the line spends showing almost nothing.
const GAP = ' • '
// One character per tick. The rows are monospace, so a step is a whole cell and the line moves
// in the grid it is already set in rather than sliding through it.
const STEP_MS = 150
// Ticks the line rests before setting off, so it can be read from the start first.
const HOLD_TICKS = 8
// Below this there is no room for a character between the two sets of dots.
const MIN_CELLS = 4
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

const root = useTemplateRef<HTMLElement>('root')

/** What is actually on screen: the whole line at rest, a framed window of it while running */
const display = ref(props.text)
const running = ref(false)

let timer: ReturnType<typeof setInterval> | undefined

/**
 * Returns how many characters the column can hold.
 *
 * The rows are monospace, so the width of the whole line divided by its length is the width of
 * one cell, and the column holds as many of those as fit.
 * @param {HTMLElement} box - Element the line is clipped by
 * @param {string} text - Line being measured
 * @returns {number} - Characters that fit, or 0 when that cannot be worked out
 */
function capacityOf(box: HTMLElement, text: string): number {
  if (text.length === 0 || box.scrollWidth === 0) {
    return 0
  }

  const cell = box.scrollWidth / text.length

  return cell > 0 ? Math.floor(box.clientWidth / cell) : 0
}

/**
 * Cuts the window the column shows and marks the ends that run past it.
 *
 * The dots take over the outermost cell rather than being added in front of it: the window is
 * then the same width at every offset, so each step moves the line exactly one cell, including
 * the first. Adding them instead pushed the line back by the width they took, which cancelled
 * out the first step and left it looking stuck. The leading dots only appear once a character
 * has actually gone off the front, so a line still at its beginning is not marked as cut.
 * @param {string} loop - The line and its gap, written out twice so a window can straddle the turn
 * @param {number} offset - Character the window starts at
 * @param {number} width - Cells the column holds
 * @returns {string} - The line as it should read right now
 */
function frame(loop: string, offset: number, width: number): string {
  const cells = loop.slice(offset, offset + width).split('')

  if (offset > 0) {
    cells[0] = '…'
  }

  cells[cells.length - 1] = '…'

  return cells.join('')
}

/**
 * Stops the line and puts it back the way it rests.
 * @returns {void}
 */
function stop(): void {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }

  running.value = false
  display.value = props.text
}

/**
 * Starts reading the line out, if it is focused and does not already fit.
 * @returns {Promise<void>}
 */
async function start(): Promise<void> {
  stop()

  if (!props.focused || window.matchMedia?.(REDUCED_MOTION).matches) {
    return
  }

  await nextTick()

  const box = root.value
  if (!box) {
    return
  }

  const capacity = capacityOf(box, props.text)

  // a line the column already shows whole has nothing to read out
  if (capacity < MIN_CELLS || props.text.length <= capacity) {
    return
  }

  const content = props.text + GAP
  // twice, so a window that straddles the turn reads on into the line coming round again
  const loop = content + content

  running.value = true
  display.value = frame(loop, 0, capacity)

  let offset = 0
  let ticks = 0

  timer = setInterval(() => {
    ticks += 1
    if (ticks <= HOLD_TICKS) {
      return
    }

    offset = (offset + 1) % content.length
    display.value = frame(loop, offset, capacity)
  }, STEP_MS)
}

watch(
  () => [props.focused, props.text],
  () => void start(),
  { immediate: true },
)

onBeforeUnmount(stop)
</script>

<template>
  <span ref="root" class="scroll truncate" :class="{ 'scroll--running': running }">{{
    display
  }}</span>
</template>

<style scoped>
.scroll {
  display: block;
}

/* the window is cut to fit and carries its own dots, so the native ellipsis would only ever
   be a second one drawn on top of the first */
.scroll--running {
  text-overflow: clip;
}
</style>

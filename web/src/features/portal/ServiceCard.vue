<script setup lang="ts">
import { useTemplateRef } from 'vue'
import HighlightedText from '@/components/HighlightedText.vue'
import StatusDot from '@/components/StatusDot.vue'
import { useRevealOnActive } from '@/composables/useRevealOnActive'
import type { CardTarget } from '@/types/portal'
import type { ApiHealthReading } from '@diele/common'

interface ServiceCardProps {
  service: CardTarget
  /** Digit key that launches this card, 1-9 then 0; omitted past the tenth card */
  shortcut?: string
  /** How it last answered; omitted for an unbound card and whenever its source is unreachable */
  status?: ApiHealthReading
  /** Whether the launcher highlight currently sits on this card */
  active?: boolean
  /** Current search term, marked up in the card's name */
  query?: string
}

const props = defineProps<ServiceCardProps>()
const emit = defineEmits<{ launch: [] }>()

useRevealOnActive(useTemplateRef<HTMLElement>('root'), () => props.active)
</script>

<template>
  <a
    ref="root"
    class="card"
    :class="{ 'card--active': active }"
    :href="service.url"
    :style="{ '--service-color': service.color }"
    rel="noopener"
    @click="emit('launch')"
  >
    <StatusDot v-if="status" :status="status" :name="service.name" />
    <span v-if="shortcut" class="card__shortcut" aria-hidden="true">{{ shortcut }}</span>
    <!-- Markup from /api/config, sanitised server-side on the way into the database
         (api/src/icons/sanitize.ts) and never on the way out. This is the only place that
         trust is spent, so it holds for the admin preview too. -->
    <span class="card__icon" v-html="service.icon" />
    <span class="card__name"><HighlightedText :text="service.name" :query="query" /></span>
  </a>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  scroll-margin-block: var(--diele-reveal-gap);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--diele-space-3);
  padding: var(--diele-space-6) var(--diele-space-4);
  background: var(--diele-surface);
  border: 1px solid var(--diele-border);
  border-radius: var(--diele-radius);
  box-shadow: var(--diele-shadow);
  color: var(--diele-fg-muted);
  transition:
    transform var(--diele-transition),
    box-shadow var(--diele-transition),
    border-color var(--diele-transition),
    color var(--diele-transition);
}

.card:hover,
.card:focus-visible,
.card--active {
  transform: translateY(-4px);
  box-shadow: var(--diele-shadow-hover);
  border-color: var(--service-color);
  color: var(--service-color);
  outline: none;
}

/* the dot draws itself but does not place itself, so the card pins it to its corner */
.card :deep(.status) {
  position: absolute;
  top: var(--diele-space-3);
  left: var(--diele-space-3);
}

.card__shortcut {
  position: absolute;
  top: var(--diele-space-2);
  right: var(--diele-space-3);
  font-size: var(--diele-text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--diele-fg-muted);
  opacity: 0.45;
  transition: opacity var(--diele-transition);
}

.card:hover .card__shortcut,
.card:focus-visible .card__shortcut,
.card--active .card__shortcut {
  opacity: 1;
}

.card__icon {
  width: 48px;
  height: 48px;
}

.card__icon :deep(svg) {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.card__name {
  font-size: var(--diele-text-xl);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--diele-fg);
}
</style>

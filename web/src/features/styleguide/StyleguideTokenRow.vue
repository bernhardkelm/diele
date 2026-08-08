<script setup lang="ts">
import { computed } from 'vue'
import type { TokenSpec } from '@/features/styleguide/styleguideTokens'

interface StyleguideTokenRowProps {
  token: TokenSpec
  /** The declaration as written, which is where to go to change it */
  value: string
  /** What the current theme actually paints, for a colour */
  computedValue?: string
}

const props = defineProps<StyleguideTokenRowProps>()

const reference = computed(() => `var(--${props.token.name})`)
</script>

<template>
  <li class="token">
    <span class="token__preview" aria-hidden="true">
      <span
        v-if="token.kind === 'color'"
        class="token__swatch"
        :style="{ background: reference }"
      />

      <span
        v-else-if="token.kind === 'shadow'"
        class="token__shadow"
        :style="{ boxShadow: reference }"
      />

      <span
        v-else-if="token.kind === 'radius'"
        class="token__radius"
        :style="{ borderRadius: reference }"
      />

      <span v-else-if="token.kind === 'space'" class="token__space" :style="{ width: reference }" />

      <span
        v-else-if="token.kind === 'font'"
        class="token__font"
        :style="{ fontFamily: reference }"
      >
        Ag 123
      </span>

      <!-- `raw` has no preview: its value column already shows it, and a second copy only
           overflowed this track into the name beside it. -->
      <span v-else-if="token.kind === 'motion'" class="token__motion">
        <span class="token__dot" :style="{ transition: `transform ${value}` }" />
      </span>
    </span>

    <code class="token__name">--{{ token.name }}</code>

    <span class="token__value truncate">
      {{ value || 'not set' }}
      <em v-if="computedValue" class="token__resolved">→ {{ computedValue }}</em>
    </span>

    <span class="token__note truncate">{{ token.note ?? '' }}</span>
  </li>
</template>

<style scoped>
.token {
  display: grid;
  grid-template-columns: 4.5rem minmax(15rem, auto) minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: var(--diele-space-4);
  padding: var(--diele-space-2) 0;
  font-family: var(--diele-font-mono);
  font-size: var(--diele-text-sm);
}

.token + .token {
  border-top: 1px solid var(--diele-rule);
}

.token__preview {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  height: 2rem;
}

.token__swatch {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--diele-border);
  border-radius: var(--diele-radius-sm);
}

.token__shadow,
.token__radius {
  width: 2rem;
  height: 2rem;
  background: var(--diele-surface);
  border: 1px solid var(--diele-border);
}

.token__shadow {
  border-radius: var(--diele-radius-sm);
}

.token__space {
  height: 0.5rem;
  background: var(--diele-accent);
  border-radius: 2px;
}

.token__font {
  font-size: var(--diele-text-xl);
  color: var(--diele-fg);
  white-space: nowrap;
}

/* the dot rides its own token, so hovering the row is the demonstration */
.token__motion {
  display: flex;
  align-items: center;
  width: 100%;
  height: 2rem;
}

.token__dot {
  width: 0.6rem;
  height: 0.6rem;
  background: var(--diele-accent);
  border-radius: 50%;
}

.token:hover .token__dot {
  transform: translateX(2.5rem);
}

.token__name {
  color: var(--diele-fg);
}

.token__value,
.token__note {
  color: var(--diele-fg-muted);
}

.token__resolved {
  font-style: normal;
  opacity: 0.7;
}

@media (max-width: 860px) {
  .token {
    grid-template-columns: 3.5rem minmax(0, 1fr);
  }

  .token__value,
  .token__note {
    grid-column: 2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .token__dot {
    transition: none;
  }
}
</style>

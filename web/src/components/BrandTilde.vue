<script setup lang="ts">
// The diele brand mark. Its geometry and colour are fixed: never recolour, rotate or stretch
// it. It sizes itself against the inherited font-size, so a consumer sets only its position.
</script>

<template>
  <svg class="tilde" viewBox="0 0 40 24" aria-hidden="true" focusable="false">
    <path
      d="M4,13 Q11,3 19,13 Q27,23 35,13"
      stroke="var(--diele-accent)"
      stroke-width="6"
      fill="none"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.tilde {
  display: block;
  /* the lockup proportion: the mark is always 0.7 of the type it sits beside */
  width: 0.7em;
  height: auto;
  overflow: visible;
}
</style>

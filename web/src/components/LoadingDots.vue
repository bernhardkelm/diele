<template>
  <span class="dots" aria-hidden="true"
    ><span class="dots__dot">.</span><span class="dots__dot">.</span
    ><span class="dots__dot">.</span></span
  >
</template>

<style scoped>
/* the dots keep their box while transparent, so the line never reflows */
.dots__dot {
  animation: loading-dot 1.4s ease-in-out infinite;
  opacity: 0;
}

.dots__dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dots__dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes loading-dot {
  0%,
  100% {
    opacity: 0;
  }

  50% {
    opacity: 1;
  }
}

/* base.css collapses every animation to 0.01ms, which would strand the dots on their
   transparent keyframe; showing all three is the honest still frame of this animation */
@media (prefers-reduced-motion: reduce) {
  .dots__dot {
    animation: none;
    opacity: 1;
  }
}
</style>

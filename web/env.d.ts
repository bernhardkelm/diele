/// <reference types="vite/client" />

interface Window {
  /**
   * Installed by the inline script in `index.html`, which collects keystrokes until the app
   * mounts. Reached through `@/helpers/earlyKeys` rather than directly, because ending the
   * capture and taking what it holds are the same step.
   */
  __dieleEarlyKeys?: {
    /** Detaches the listener and hands over what it collected, leaving nothing behind */
    end: () => string
  }
}

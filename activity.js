// Records the last real user interaction on the page so the background
// worker can tell "tab open in foreground" apart from "actually being used".
// Also counts scrolled distance in pixels for the doomscroll meter.
//
// Handlers are deliberately cheap and throttled: they run on every page,
// so any per-event work multiplies across all open tabs.
let lastActivity = Date.now();
let scrollPx = 0;
let lastScrollY = window.scrollY;
let lastBump = 0;
let scrollScheduled = false;

function bump() {
  const now = Date.now();
  // 250 ms granularity is plenty against a 60 s activity timeout.
  if (now - lastBump > 250) {
    lastBump = now;
    lastActivity = now;
  }
}

for (const event of ["mousemove", "mousedown", "keydown", "wheel", "touchstart"]) {
  window.addEventListener(event, bump, { passive: true, capture: true });
}

window.addEventListener(
  "scroll",
  () => {
    bump();
    if (scrollScheduled) return;
    scrollScheduled = true;
    // Batch scrollY reads to one per frame - scroll events fire far faster.
    requestAnimationFrame(() => {
      scrollScheduled = false;
      const y = window.scrollY;
      scrollPx += Math.abs(y - lastScrollY);
      lastScrollY = y;
    });
  },
  { passive: true, capture: true }
);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg === "activity?") {
    // Hand over the scroll distance accumulated since the last ask.
    sendResponse({ idleMs: Date.now() - lastActivity, scrollPx });
    scrollPx = 0;
  }
});

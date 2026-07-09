// Records the last real user interaction on the page so the background
// worker can tell "tab open in foreground" apart from "actually being used".
// Also counts scrolled distance in pixels for the doomscroll meter.
let lastActivity = Date.now();
let scrollPx = 0;
let lastScrollY = window.scrollY;

function bump() {
  lastActivity = Date.now();
}

for (const event of ["mousemove", "mousedown", "keydown", "wheel", "touchstart"]) {
  window.addEventListener(event, bump, { passive: true, capture: true });
}

window.addEventListener(
  "scroll",
  () => {
    bump();
    const y = window.scrollY;
    scrollPx += Math.abs(y - lastScrollY);
    lastScrollY = y;
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

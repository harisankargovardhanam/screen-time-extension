// Records the last real user interaction on the page so the background
// worker can tell "tab open in foreground" apart from "actually being used".
let lastActivity = Date.now();

function bump() {
  lastActivity = Date.now();
}

for (const event of ["mousemove", "mousedown", "keydown", "scroll", "wheel", "touchstart"]) {
  window.addEventListener(event, bump, { passive: true, capture: true });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg === "activity?") {
    sendResponse({ idleMs: Date.now() - lastActivity });
  }
});

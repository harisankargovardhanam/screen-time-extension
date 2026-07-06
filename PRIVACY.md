# Privacy Policy — Screen Time

_Last updated: July 6, 2026_

**Short version: this extension collects nothing, sends nothing, and has no servers.**

## What the extension stores

Screen Time keeps the following data in Chrome's local extension storage
(`chrome.storage.local`) on your device only:

- Time spent per website (domain names and seconds, per day, kept for 30 days)
- The daily limits, focus sessions and settings you configure
- Snooze and notification bookkeeping

## What the extension does NOT do

- No data ever leaves your device. There are no analytics, no telemetry,
  no accounts, no external servers and no third-party services.
- Full page URLs are never stored — only the site's domain (e.g. `youtube.com`).
- Page content is never read. The content script only listens for generic
  interaction events (mouse, keyboard, scroll) to know whether the page is
  actively in use; it does not read what you type or view.

## Permissions explained

| Permission | Why it is needed |
|---|---|
| `tabs` | To know which site is open in the active tab so its time can be counted |
| `storage` | To save your stats and settings locally |
| `alarms` | Minute-by-minute bookkeeping and daily/weekly schedules |
| `notifications` | Limit alerts, break reminders and the weekly summary |
| `idle` | To stop counting when you step away from the computer |
| `favicon` | To show site icons in the popup and dashboard |
| Content script | Detects whether the page is actively being used (activity vs. idle) |

## Data removal

Uninstalling the extension permanently deletes all stored data. You can also
export or inspect your data at any time from the Insights page.

## Contact

Questions: [Harisankar](https://www.linkedin.com/in/harisankarrpm/)

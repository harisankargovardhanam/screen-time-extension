# Chrome Web Store — Listing Kit

Everything to paste into the Developer Dashboard when publishing.

## Name (45 chars max)
```
Screen Time: Website Tracker, Limits & Focus
```

## Summary (132 chars max)
```
See where your time goes. Live site timers, daily limits with blocking, focus sessions & insights. 100% private, fully local.
```

## Description
```
Take back your time — without giving away your data.

Screen Time tracks how long you spend on every website and turns it into
clear, beautiful insights. Set daily limits, block distracting sites, run
focus sessions, and watch your habits improve. Everything is stored on your
device: no accounts, no servers, no tracking. Ever.

⏱ LIVE TRACKING
• Per-site timers with second precision, visible right in the toolbar badge
• Smart activity detection: only counts when you actually use a page
• Background music and videos keep counting — idle tabs don't

🚦 DAILY LIMITS
• Set a minute budget per site (e.g. YouTube: 30 min/day)
• Notification when you cross the line
• Optional hard block with a "Time's up" page — plus an honest snooze button
  that counts how many times you cave

🎯 FOCUS SESSIONS
• One click blocks all limited sites for 25 or 50 minutes
• Countdown on the badge, celebration when you finish

📊 INSIGHTS DASHBOARD
• 7-day stacked charts, top sites, hour-by-hour heatmap
• Categories (Video, Social, Work, News) with a daily productivity score
• Streak tracking for days under your limits
• Export everything to CSV or JSON — it's your data

🔔 HEALTHY DEFAULTS
• Break reminder after continuous browsing
• Weekly summary every Sunday with trend vs. last week
• Daily auto-reset at midnight, 30 days of history

🔒 PRIVACY BY DESIGN
• 100% local storage — nothing ever leaves your device
• Only domains are stored (youtube.com), never full URLs
• No page content is read, no analytics, no third parties

Light and dark theme. Built lean: no frameworks, no bloat.
```

## Category
`Productivity` → best fit; alternative `Workflow & Planning`.

## Permission justifications (asked during review)

| Permission | Justification text |
|---|---|
| tabs | Reads the domain of the active tab to attribute browsing time. Full URLs are never stored. |
| storage | Stores time statistics and user settings locally on the device. |
| alarms | Periodic bookkeeping (1/min), focus session end, weekly summary schedule. |
| notifications | Limit alerts, break reminders, weekly summary. |
| idle | Pauses tracking when the user is away from the computer. |
| favicon | Displays site icons in the popup and dashboard UI. |
| Host access (content script) | Detects whether the page is actively used (generic mouse/keyboard/scroll events only). No page content is read or modified. |

## Assets checklist

- [ ] Screenshots 1280×800 (take 4–5): popup with data, insights dashboard,
      focus session running, block page, dark mode
- [ ] Small promo tile 440×280
- [ ] Marquee promo 1400×560 (needed for Featured consideration)
- [ ] Privacy policy URL — host PRIVACY.md (GitHub repo works)
- [ ] Single purpose statement: "Tracks and limits time spent on websites."

## Featured badge path

1. Publish, comply with all policies, fill privacy fields honestly
2. In dashboard: verify contact email + 2FA on account
3. Featured is granted by CWS editorial review — quality UI, MV3, minimal
   permissions, accurate listing. This build follows all published criteria.
4. Nominate via the "Recommend an extension" feedback form and iterate on
   user reviews — ratings weigh heavily.

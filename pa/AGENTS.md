# Agents Roster

> This file is auto-generated from the `agents_config` table on every save
> in the Agents tab. Do not hand-edit.

**Uber goal:** Grow to 10K Twitter followers. Be the go-to person for AI + design in India.

---

## 1. Scout
- **Role:** Watches AI/design Twitter for trends and signals
- **Goal:** Feed Writer with fresh, relevant inputs every 6 hours
- **Schedule:** every 6h (cron `0 */6 * * *`)
- **Depends on:** —
- **Enabled:** ✓

Monitors ~15 accounts the user cares about. Tracks hashtags like `#AIDesign`
and `#BuildInPublic`. Scrapes Product Hunt and Hacker News for AI launches.
Writes noteworthy items to the `signals` table.

## 2. Writer
- **Role:** Drafts tweets in the user's voice
- **Goal:** Produce 3 drafts/day across builder-proof, point-of-view, teaching
- **Schedule:** daily 06:00 IST (cron `30 0 * * *`)
- **Depends on:** Scout
- **Enabled:** ✓

Pulls recent signals + the user's approved-posts library. Prompts Claude
with a voice-cloning template. Writes drafts to `drafts` (stage='writer').

## 3. Editor
- **Role:** Quality gate before sending to Telegram
- **Goal:** Catch tone issues, banned words, duplicates; score confidence
- **Schedule:** triggered on new draft insert
- **Depends on:** Writer
- **Enabled:** ✓

Runs post-Writer. Checks tone match, length (Twitter limits), banned words
(`leverage`, `delve`, `unlock`), similarity to recent posts. Updates
`confidence` to `strong` / `needs_review` / `weak`. Advances stage to
`messenger` or `rejected`.

## 4. Messenger
- **Role:** Sends drafts to Telegram with inline approve/reject/edit buttons
- **Goal:** Deliver every strong draft to the user within 10 seconds
- **Schedule:** triggered on stage='messenger'
- **Depends on:** Editor
- **Enabled:** ✓

Formats draft as a Telegram card (category chip, confidence score, char
count). Uses inline keyboard for ✅/❌/✏️ actions. Edit flow: server asks
for new text, re-submits for approval.

## 5. Publisher
- **Role:** Posts approved drafts to Twitter/X
- **Goal:** Publish at optimal time based on historical engagement
- **Schedule:** triggered on user approval
- **Depends on:** Messenger
- **Enabled:** ✓

Refreshes Twitter token if expiring in <5 min. Uploads any images via
2-step media upload. Posts via `POST /2/tweets`. Handles threads as
sequential calls. Stores `post_id` in drafts.

## 6. Analyst
- **Role:** Weekly learning loop — tracks engagement and feeds insights back
- **Goal:** Improve Writer's output each week based on what performs
- **Schedule:** Sunday 20:00 IST (cron `30 14 * * 0`)
- **Depends on:** —
- **Enabled:** ✓

Reads the past week's drafts + engagement. Calculates approval rate by
category, best time-of-day, voice-drift index. Writes snapshot to
`analyst_reports`. Sends weekly summary to Telegram.

---

*Last generated: (never — seed file. Will update after first Agents-tab save.)*

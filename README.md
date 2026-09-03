# SnapTask

[![CI](https://github.com/SAISHYAMR2002/snaptask/actions/workflows/ci.yml/badge.svg)](https://github.com/SAISHYAMR2002/snaptask/actions/workflows/ci.yml)

A collaborative task management app — team workspaces with a task board, chat,
role-based access, notifications and admin analytics.

Built with React + Vite + Tailwind on the front end, Express + Prisma +
PostgreSQL on the back, Redis for rate limiting, and Resend for email.

---

## Running it locally

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) and
Node 18+.

```bash
# 1. database + redis
docker compose up -d

# 2. backend  (terminal 1)
cd backend
cp .env.example .env          # then edit JWT_SECRET
npm install
npx prisma migrate deploy
npm run seed                  # demo data + test logins
npm run dev                   # http://localhost:3000

# 3. frontend (terminal 2)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

### Test accounts

`npm run seed` creates a populated workspace. **Password for all of them:
`password123`**

| Email | Role | What they can do |
|---|---|---|
| `owner@snaptask.test` | **owner** | everything, including promoting and demoting admins |
| `admin@snaptask.test` | **admin** | sees Team Analytics, can invite and remove members |
| `member@snaptask.test` | **member** | board and chat only — no Team Analytics |
| `stranger@snaptask.test` | — | belongs to a different workspace, can see none of the above |

To see role-based access working: log in as `member@`, note there is no **Team
Analytics** in the sidebar. Then as `owner@` go to **Members**, switch Mia to
`admin`, and refresh her window — it appears.

Re-run `npm run seed` any time to reset to a clean, populated state. It wipes
every row first, and refuses to run against a non-local database.

---

## Features

- **Workspaces** with three roles — owner, admin, member — enforced server-side
- **Task board** — per-workspace columns you define yourself, priorities, due
  dates, assignees, labels, estimates, filters, and bulk actions with undo
- **Task detail** panel — inline editing, labels, a checklist of subtasks,
  comments, and an activity feed with derived timings (cycle time, lead time,
  how often the deadline moved)
- **Search** — Postgres full-text across task titles, descriptions, chat
  messages and comments, reachable from anywhere with `Ctrl/Cmd + K`
- **Chat** — channels, `@mention` autocomplete, emoji picker, reactions, inline
  polls, typing indicators and read receipts; tasks linkable into a message
- **Assistant** — ask questions about the workspace in plain English ("when will
  Adam finish?", "who is behind?") and get answers with charts, computed from
  real rows
- **Notifications** — in-app inbox plus email, driven by per-user preferences
- **Team Analytics** (admins only) — throughput, on-time rate, workload balance,
  cycle time, a member leaderboard, a burndown chart and a completion forecast,
  over any date range or sprint, exportable as CSV
- **Estimated vs actually taken** — put an estimate on a task, log the hours it
  really took, and see whether the team plans realistically. Reported as a
  median (one 10x outlier should not redefine a team's habits) and always
  alongside its coverage, so a thin sample is visible rather than disguised
- **Individual performance** — a page per person: output, deadline record and
  cycle time each shown *next to the team median*, what is stuck in progress,
  what took longest, how well they estimate, and a plain-English "what stands
  out". Anyone can open their own; only admins can open someone else's
- **Private notes** — notes about the people you work with, visible to nobody
  but you: not the subject, not other admins, not the workspace owner. Attach a
  date and it becomes a reminder only you receive
- **Auth** — JWT, bcrypt, email verification, password reset, Redis-backed rate
  limiting
- **Dark mode** and a layout that works down to a 390px phone. Every text
  colour is measured, not eyeballed: 1,894 text elements across 11 screens and
  both themes all clear the WCAG AA contrast threshold for their size

The forecast is a transparent heuristic, not machine learning: each person's
completion rate over the last 14 days is projected across their open tasks in
due-date order.

## Testing

```bash
cd backend
npm run dev     # server must be running
npm test        # 263 checks
```

The suite creates five real users and walks the full permission matrix
(owner / admin / member / removed member / non-member) across every endpoint,
plus validation, email verification, password reset, rate limiting, realtime
socket authorisation, full-text search isolation and latency budgets.

Every push runs it in GitHub Actions against a real Postgres and a real Redis —
not mocks. The search is Postgres-specific and the rate limiter is Redis-backed,
so mocking either would only test the mock. CI also builds the frontend and
replays every migration against an empty database.

## Layout

```
backend/
  lib/          prisma client, access guards, notifications, mail, rate limiting
  routes/       auth, workspaces, tasks, channels, notifications, analytics, settings
  prisma/       schema, migrations, seed
  test/         end-to-end API suite
frontend/
  src/pages/       one file per screen
  src/components/  layout, task card, detail panel, command palette, shared UI
  src/lib/         api client and helpers
.github/workflows/ CI
docs/            how to inspect the database and Redis
design/          UI mockups
```

## Notes

- **Realtime** runs over a WebSocket at `/ws`, sharing the API's port. Chat,
  the board, typing indicators and the inbox badge all update live. Rooms are
  per-workspace and membership is checked on subscribe, so asking for a room
  you are not in returns nothing.
  The socket is an *optimisation, not a dependency*: if it cannot connect —
  a proxy that strips upgrades, a blocked port — the app falls back to the
  3-second polling it used before and nothing breaks. The dot beside the page
  title is green on a socket, amber on the fallback.
  Measured: an idle client makes **0** requests over 7 seconds when connected,
  versus one poll every 3 seconds per client before.
- **Error reporting** (Sentry) is opt-in. With no DSN set, nothing initialises
  and the frontend SDK is not even in the bundle.
- **Chart colours** are their own tokens, separate from the UI palette: a chart
  mark has to clear 3:1 against the plot surface and sit inside a lightness
  band so no series disappears. The steps were picked with a palette validator
  against this app's real surfaces, in both themes.
- **Status colours** (`danger`/`warn`/`success`/`info`) are tokens too, each a
  set of four that flip together. Tailwind's built-in `bg-red-50` etc. are
  static, so pairing one with a text colour that *does* invert produced a
  1.02:1 panel in dark mode — invisible text.
- Without `RESEND_API_KEY` set, emails are written to the server console and
  verification links are returned in the API response so the flows stay testable.
  With a key configured, links only ever appear in the email.

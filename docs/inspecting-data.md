# Inspecting the database and Redis

Both run as Docker containers defined in `docker-compose.yml`. They must be up first:

```powershell
cd c:\Project\snaptask
docker compose up -d
docker compose ps          # both should say "Up"
```

---

## 1. PostgreSQL — the easy way (Prisma Studio)

A browser GUI where you can read **and edit** rows. Best for day-to-day checking.

```powershell
cd c:\Project\snaptask\backend
npx prisma studio
```

Opens <http://localhost:5555>. Pick a table on the left. `Ctrl+C` in the terminal to stop it.

---

## 2. PostgreSQL — the real way (psql)

This is the skill worth having: a SQL shell inside the running container.

```powershell
docker exec -it snaptask-db psql -U snaptask_user -d snaptask_dev
```

You get a `snaptask_dev=#` prompt. Useful commands:

| Command | What it does |
|---|---|
| `\dt` | list all tables |
| `\d "Task"` | describe the Task table (columns, indexes, foreign keys) |
| `\x` | toggle expanded output — makes wide rows readable |
| `\q` | quit |

Note the **double quotes** around table names — Prisma creates them with capital
letters, and unquoted names in Postgres are folded to lowercase.

Useful queries:

```sql
-- who exists (never select the password column in a screenshot)
SELECT id, name, email, "createdAt" FROM "User";

-- roles: this is where admin access actually lives
SELECT u.name, w.name AS workspace, m.role
FROM "WorkspaceMember" m
JOIN "User" u ON u.id = m."userId"
JOIN "Workspace" w ON w.id = m."workspaceId"
ORDER BY w.name, m.role;

-- tasks with their assignee
SELECT t.title, t.status, t.priority, t."dueDate", u.name AS assignee
FROM "Task" t LEFT JOIN "User" u ON u.id = t."assignedToId"
ORDER BY t."createdAt" DESC;

-- unread notifications per person
SELECT u.name, count(*) FROM "Notification" n
JOIN "User" u ON u.id = n."userId"
WHERE n.read = false GROUP BY u.name;

-- a quick count of everything
SELECT
  (SELECT count(*) FROM "User")            AS users,
  (SELECT count(*) FROM "Workspace")       AS workspaces,
  (SELECT count(*) FROM "WorkspaceMember") AS memberships,
  (SELECT count(*) FROM "Task")            AS tasks,
  (SELECT count(*) FROM "Message")         AS messages,
  (SELECT count(*) FROM "Notification")    AS notifications;
```

### One-liners (without entering the shell)

```powershell
docker exec snaptask-db psql -U snaptask_user -d snaptask_dev -c "\dt"
docker exec snaptask-db psql -U snaptask_user -d snaptask_dev -c 'SELECT name,email FROM "User";'
```

### Check migrations

```powershell
cd c:\Project\snaptask\backend
npx prisma migrate status
```

---

## 3. Redis

```powershell
docker exec -it snaptask-redis redis-cli
```

At the `127.0.0.1:6379>` prompt:

| Command | What it does |
|---|---|
| `PING` | should reply `PONG` |
| `DBSIZE` | how many keys are stored |
| `KEYS *` | list every key (fine in dev, **never** on a big production instance) |
| `GET <key>` | read a string value |
| `TTL <key>` | seconds until a key expires (`-1` = never) |
| `MONITOR` | live-stream every command hitting Redis (`Ctrl+C` to stop) |
| `FLUSHALL` | delete everything (dev only) |
| `exit` | quit |

> **Heads-up: SnapTask does not use Redis yet.**
> The container runs and `REDIS_URL` is in `.env`, but no application code touches
> it — so `DBSIZE` will be `0` and `KEYS *` will be empty. That is expected, not a
> bug. It's reserved for a later caching / rate-limiting / session step.

---

## 4. Resetting dev data

Delete rows but keep the schema (respects foreign-key order):

```powershell
docker exec snaptask-db psql -U snaptask_user -d snaptask_dev -c 'DELETE FROM "Notification"; DELETE FROM "Message"; DELETE FROM "Comment"; DELETE FROM "Task"; DELETE FROM "Channel"; DELETE FROM "WorkspaceMember"; DELETE FROM "Workspace"; DELETE FROM "NotificationPrefs"; DELETE FROM "User";'
```

Nuke the containers **and their data volumes**, then rebuild from scratch:

```powershell
cd c:\Project\snaptask
docker compose down -v
docker compose up -d
cd backend
npx prisma migrate deploy
```

---

## 5. Watching the backend

The server logs every request error, plus reminder sweeps and emails
(`[email:dev] -> you@example.com | ...` when no mail key is set).

```powershell
cd c:\Project\snaptask\backend
npm run dev
```

Container logs, if a container itself misbehaves:

```powershell
docker compose logs -f postgres
docker compose logs -f redis
```

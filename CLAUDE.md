# CLAUDE.md

Guidance for Claude Code in this repo.

@AGENTS.md

## Commands
- `npm run dev` / `build` / `lint` / `typecheck` / `format`. Never run `build` while `dev` is running.
- `npm run db:migrate`, `npm run db:studio`, `npx prisma db seed`, then `npx prisma generate` (migrate no longer generates).
- `npm run test` (Vitest unit + UI), `npm run test:db` (`followup_test`), `npm run test:e2e` (Playwright; build first, stop `dev`).
- `npm run worker` (background jobs), `npm run worker:test` (queue a test job).
- Local DB: WAMP MySQL 8.3 on `localhost:3306`, database `followup` (view in phpMyAdmin).

## Requirements (local `docs/`, gitignored; ignore `docs/unused/`)
Store walk-in → follow-up → sale PWA. Scope = modules M01–M25 in one project. Read only what the task needs:
- `docs/master-context.md`: roles, screen rules, data model, BR-01…BR-22, out of scope. Read once per session.
- `docs/module-prompts.md`: the current module's section only — find it with Grep `^## M07`. Never read it whole.
- `docs/decisions.md`: model fixes, pending client decisions, doc conflicts, NFR targets. Check before the schema, M10, M12, M16, M19.
- `docs/store-followup-prototype.html`: exact UI copy and layout. Grep the screen's text; never read it whole.
- The SOW `.docx` is summarised in `decisions.md`. Open it only if asked.

Build order: M01 → M17 → M18 → M02 → M03 → M04 → M05 → M06 → M07 → M10 → M08 → M09 → M11 → M14 → M15 → M12 → M13 → M16 → M24 → M19 → M20 → M21 → M22 → M23 → M25. Finish each module's "Done when" list before the next.

## Repo differs from docs
- Paths: `src/app`, `src/lib`, `src/components`; `@/*` maps to `src/*`.
- Next 16: middleware is **`proxy.ts`**. Tailwind v4: tokens in `@theme` in `globals.css`; there is no `tailwind.config`.
- Prisma 7: datasource URL and seed in `prisma.config.ts`; generator `prisma-client` outputs to `src/generated/prisma` (gitignored) — import from `@/generated/prisma/client`; MySQL 8 via the `@prisma/adapter-mariadb` adapter; tables `@@map`'d to snake_case.
- The one Prisma client is `db` in `src/lib/db.ts`. Never create another.
- Background jobs: MySQL job table + cron worker, not pg-boss (see `docs/decisions.md`).

## Always
- `requireUser({ roles, branchId })` in every action and route; filter every query to the user's allowed branches.
- No hard-coded UI text; use next-intl (`en`, `hi`, `gu`).
- No hard deletes: status field plus an audit log entry.
- Multi-step saves go in `prisma.$transaction`.
- IST (`Asia/Kolkata`). Indian mobiles normalised to 10 digits starting with 6–9.
- AI never writes data. AI questions use only read-only tools.

## Git
- `.claude/`, `.agents/`, `.windsurf/` and `skills-lock.json` stay local (gitignored).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands
- `npm run dev` / `npm run build` / `npm run lint`
- `npm run db:migrate` (runs `prisma migrate dev`), `npm run db:studio`, `npx prisma generate` (also runs on postinstall)
- `npm run test` (Vitest), `npm run typecheck`, `npm run format`. Local DB = WAMP MySQL 8.3 on `localhost:3306`, database `followup` (view in phpMyAdmin). Playwright comes with full M01.

## Requirements (local `docs/`, gitignored; ignore `docs/unused/`)
This is a store walk-in → follow-up → sale tracking PWA. The whole scope is modules M01–M25 in one project.

To save tokens, read only what the task needs:
- `docs/module-prompts.md`: the master context (lines ~19–136: stack, folders, data model, BR-01…BR-22, design tokens, out of scope), then **only the current module's section**. Find it with Grep `^## M07`. Don't read the whole file.
- `docs/decisions.md`: model fixes, pending client decisions, doc conflicts and NFR targets. Check it before the schema, M10, M12, M16 or M19.
- `docs/store-followup-prototype.html`: exact UI copy and layout. Grep for the screen's text; don't read it whole.
- The SOW `.docx` is already summarised in `decisions.md`. Open it only if asked.

Build order: M01 → M17 → M18 → M02 → M03 → M04 → M05 → M06 → M07 → M10 → M08 → M09 → M11 → M14 → M15 → M12 → M13 → M16 → M24 → M19 → M20 → M21 → M22 → M23 → M25. Finish each module's "Done when" list before starting the next.

## Repo differs from docs
- Paths: use `src/app`, `src/lib` and `src/components`, not `/app` or `/lib`. `@/*` maps to `src/*`.
- Next 16: "middleware" is now **`proxy.ts`**.
- Prisma 7:
  - The datasource URL and seed go in `prisma.config.ts`, not `schema.prisma`.
  - The generator is `prisma-client`, which outputs to `src/generated/prisma` (gitignored). Import from `@/generated/prisma/client`.
  - MySQL via the `@prisma/adapter-mariadb` adapter (required). Tables are `@@map`'d to snake_case.
- Database is MySQL 8, not PostgreSQL; background jobs use a MySQL job table + cron worker, not pg-boss (see `docs/decisions.md`).
- The single Prisma client is `db` in `src/lib/db.ts`. Never create another `PrismaClient`.
- Tailwind v4: tokens go in `@theme` in `globals.css`. There is no `tailwind.config`.

## Always
- Check permissions on the server with `requireUser({ roles, branchId })` in every action and route, and filter every query to the user's allowed branches.
- No hard-coded UI text; use next-intl (`en`, `hi`, `gu`).
- No hard deletes: use a status field plus an audit log entry.
- Multi-step saves go in `prisma.$transaction`.
- Time zone is IST (`Asia/Kolkata`). Indian mobile numbers are normalised to 10 digits starting with 6–9.
- AI never writes data. AI questions use only read-only tools.

## Git
- `.claude/`, `.agents/`, `.windsurf/` and `skills-lock.json` stay local (gitignored).
- No `Co-Authored-By` or other AI attribution lines in commits.

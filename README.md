# Headache diary

A private, phone-local headache diary for one person. The application is designed as an installable iPhone PWA hosted as static files; diary records will live in IndexedDB on the device, with no account, cloud database, telemetry, or reminder service.

## Development

Use Node `24.19.0` and pnpm `11.19.0` (the versions are pinned in `.node-version` and `package.json`). The bundled development environment used for this workspace provides those runtimes even when `node` is not on the shell `PATH`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Checks used by the project:

```sh
pnpm run typecheck
pnpm run lint
pnpm run test -- --run
pnpm run build
pnpm run test:e2e
```

The first scaffold contains no diary seed data. Backup and restore will use readable JSON health data; the finished app will explain that users must choose and verify their own storage destination.

## GitHub Pages platform spike

The temporary synthetic platform check is available at `/?spike=1`. For the configured project site, use [`https://feklistoff.github.io/migraine-tracker/?spike=1`](https://feklistoff.github.io/migraine-tracker/?spike=1). Follow the local platform-spike checklist on the target iPhone before recording real diary data. Planning documents are intentionally excluded from this repository.

## Current implementation stage

Task 01 establishes the reproducible app shell and checks. The domain model, IndexedDB persistence, diary flows, backup/restore, offline installation, and GitHub Pages deployment are implemented in later plan tasks. Product-visible time, overlap, follow-up, and post-end rules remain in the local planning workspace and must be resolved before dependent domain work.

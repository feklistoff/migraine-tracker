# Headache diary

A private, phone-local headache diary for one person. The application is designed as an installable iPhone PWA hosted as static files; diary records will live in IndexedDB on the device, with no account, cloud database, telemetry, or reminder service.

## Development

Use Node `24.19.0` and pnpm `11.19.0` (the versions are pinned in `.node-version` and `package.json`). The bundled development environment used for this workspace provides those runtimes even when `node` is not on the shell `PATH`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Checks run before deployment:

```sh
pnpm run typecheck
pnpm run test -- --run
pnpm run build
```

`pnpm run build` also checks `dist/index.html` for the restrictive CSP, its placement before scripts, absence of inline scripts, and privacy metadata. The ordinary browser e2e tests use the development server. `pnpm run test:pwa` builds two production versions under the GitHub Pages base path, serves them on `PLAYWRIGHT_PORT` (default `4176`), and checks offline cold reopen and a waiting A→B update with existing records and settings.

One GitHub Actions workflow runs TypeScript checks, unit tests, and the build on pushes to `main`, then deploys to GitHub Pages. Manual workflow runs validate without deploying. Pull requests do not trigger this workflow.

Run `pnpm run lint` and `pnpm run test:e2e` locally when relevant to a change. Dependency updates are manual; there are no scheduled Dependabot version-update PRs. Run `pnpm audit --prod` when reviewing dependencies; the audit is not a deployment gate.

## Installation, offline use and recovery

Open the [published app](https://feklistoff.github.io/migraine-tracker/) in Safari on the iPhone, tap Share, and choose Add to Home Screen. Open it online once so the app files and local fonts can be cached. After that, the installed app can reopen offline. The diary itself is stored in IndexedDB on this device; there is no account or automatic sync. Safari and the installed app may use separate storage. If records were already entered in Safari, make a backup there and restore it in the installed app once backup/restore is available.

Backups are plain-text JSON containing health data. The share sheet may offer local or cloud destinations; choose where to save them carefully. Make a current backup before deleting or reinstalling the app. Device-specific deletion behaviour still needs physical-iPhone acceptance testing.

When an update is ready, the app asks before applying it. An open entry form, Settings editor, active diary write or backup restore keeps the update waiting. Finish or discard drafts, then choose **Update now**. If another app tab is still busy or suspended, close it and try again. A blocked database upgrade asks you to close other diary tabs and retry. If an older app reports that the diary was created by a newer schema, update the app forward; do not reset the database or deploy an older incompatible build. A failed migration leaves existing data in place, and the safe recovery is a corrected forward release plus a backup of any accessible data.

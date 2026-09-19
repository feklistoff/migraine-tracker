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

`pnpm run build` also checks `dist/index.html` for the restrictive CSP, its placement before scripts, absence of inline scripts, and privacy metadata. The browser e2e tests use the development server.

One GitHub Actions workflow runs TypeScript checks, unit tests, and the build on pushes to `main`, then deploys to GitHub Pages. Manual workflow runs validate without deploying. Pull requests do not trigger this workflow.

Run `pnpm run lint` and `pnpm run test:e2e` locally when relevant to a change. Dependency updates are manual; there are no scheduled Dependabot version-update PRs. Run `pnpm audit --prod` when reviewing dependencies; the audit is not a deployment gate.

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

`pnpm run build` also checks `dist/index.html` for the restrictive CSP, its placement before scripts, absence of inline scripts, and privacy metadata. The browser e2e tests use the development server.

CI runs source checks, a production dependency audit, and the build on pull requests to `main` and pushes to `main`. Only pushes to `main` deploy; manual workflow runs validate without deploying. Dependabot version updates wait seven days after release.

The required **Audit production dependencies** step fails if npm's audit service is unavailable as well as when it finds high/critical vulnerabilities. For a service error such as HTTP 503, rerun the workflow after the service recovers; do not bypass the audit.

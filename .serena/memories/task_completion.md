Before considering a coding task done, from `app/`:
1. `npm run lint` — must pass (warnings on `no-unused-vars` are tolerated only for pre-existing code, don't introduce new ones except via the `_` prefix convention).
2. `npm run build` — must succeed (this is what CI's `lint-and-build` job runs; it's the only enforced check, there is no separate typecheck-only or test script).
3. If you touched logic covered by an existing `*.selfcheck.ts` (or logic tricky enough to warrant a new one per `mem:conventions`), run it: `npx tsx src/server/lib/<name>.selfcheck.ts` and confirm no assertion errors.

CI (`.github/workflows/ci.yml`) also does a Docker build test after lint+build passes; no need to run Docker locally unless the change touches `Dockerfile`/`docker-entrypoint.sh`.
All app commands run from `app/` (root has no package.json).

- Install: `npm ci` (or `npm install`)
- Dev server (backend + watches, runs `predev` first): `npm run dev`
- Lint: `npm run lint` (eslint on `src`)
- Build: `npm run build` (client via vite, server via tsc, then copies templates/policies/changelog into `dist/`)
- Run built app: `npm start`
- Run one self-check file: `npx tsx src/server/lib/<name>.selfcheck.ts`

Windows notes (dev machine is Windows):
- Bash tool (git-bash) works fine for `npm`/`node`/`git`; prefer it over PowerShell for these repeated commands.
- Path separators in Serena tool output are backslashes (`app\src\server\...`); when writing paths in shell commands use forward slashes as usual.
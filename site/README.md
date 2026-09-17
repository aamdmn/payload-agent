# @payload-agent/site

Landing page for payload-agent (https://agent.aamdmn.com), built with Astro +
React + Tailwind v4. Design system: `DESIGN.md`.

## Commands

| Command          | Action                                        |
| :--------------- | :-------------------------------------------- |
| `pnpm install`   | Installs dependencies (run at the repo root)  |
| `pnpm dev`       | Local dev server at `localhost:4321`          |
| `pnpm build`     | Production build to `./dist/`                 |
| `pnpm preview`   | Preview the production build                  |
| `pnpm astro ...` | CLI commands like `astro add`, `astro check`  |

Run these from `site/`, except `pnpm install`, which runs at the workspace root.

`scripts/generate-og.mjs` regenerates `public/og.png` (requires a running
Playwright Chromium install).
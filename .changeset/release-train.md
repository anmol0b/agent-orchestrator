---
"@aoagents/ao-core": minor
"@aoagents/ao-cli": minor
"@aoagents/ao": minor
"@aoagents/ao-web": minor
---

feat(release): weekly release train — channels, onboarding, dashboard banner, cron

Ships the full release pipeline described in `release-process.html`:

- **Cron-driven nightly canary.** `.github/workflows/canary.yml` triggers via
  `schedule: '30 17 * * 5,6,0,1,2'` (23:00 IST Fri–Tue) plus `workflow_dispatch`.
  Bake window (Wed–Thu) pauses scheduled nightlies; the captain re-cuts via
  workflow_dispatch when a fix lands. Stable `release.yml` publishes via
  `changesets/action`. `.changeset/config.json` adds the snapshot template
  (`{tag}-{commit}`) and moves the private `@aoagents/ao-web` to `ignore`.

- **Update channels.** New `updateChannel` field in the global config schema
  (`stable | nightly | manual`, default `manual` so existing users see no
  surprise installs). `update-check.ts` reads `dist-tags[channel]` from the
  npm registry, compares prerelease versions segment-by-segment so SHA-suffixed
  nightlies sort correctly, and skips notices entirely on `manual`.

- **Soft auto-install + active-session guard.** On stable/nightly, `ao update`
  skips the confirm prompt and just installs. Before installing it lists
  sessions and refuses with `N session(s) active. Run \`ao stop\` first.` if
  any are in `working`/`idle`/`needs_input`/`stuck`. Same guard duplicated
  in `POST /api/update` so the dashboard returns a structured 409.

- **Onboarding question.** `ao start` prompts once for the channel if unset;
  dismissal persists `manual`. `ao config set updateChannel <value>` (and
  `installMethod`) lets users change it later.

- **Dashboard banner.** `GET /api/version` reads the same cache file as the
  CLI. `UpdateBanner` (Tailwind only, `var(--color-*)` tokens) appears at the
  top of the dashboard when `isOutdated`. Click POSTs to `/api/update`;
  dismissal persists per-version in `localStorage`.

- **Bun + Homebrew detection.** New install-method classifiers for
  `~/.bun/install/global/` (auto-installs `bun add -g @aoagents/ao@<channel>`)
  and `/Cellar/ao/` (notice only — `brew upgrade ao` to avoid clobbering
  brew's symlinks). `installMethod` config field overrides path detection.

Supersedes #1525 (incorporates the canary + release infrastructure with the
cron / no-stale-SHA-guard / no-merged-PR-comment modifications called out in
the design doc).

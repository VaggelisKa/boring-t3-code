# Upstream sync

This fork takes changes from [upstream T3 Code](https://github.com/pingdotgg/t3code) by
cherry-picking them, one upstream commit at a time. A weekly scheduled agent run does this and
opens one PR per run. Merging upstream `main` wholesale is not possible: it would bring back
everything the fork removed.

## Last reviewed upstream commit

<!-- upstream-sync:last-reviewed -->

`fa4e4677c0ecc437aece2dcea39f76ef31414152` (the fork point, 2026-10-30)
<!-- /upstream-sync:last-reviewed -->

Every upstream commit up to and including this one has been either ported or deliberately
skipped. Each sync PR moves this line to the newest upstream commit it reviewed, ported or not.

## What may be ported

Work data goes to the model providers and to the user's own git host, nowhere else. A commit is
ported only when it clearly keeps that true. **When in doubt, skip it.** A wrongly skipped fix can
be ported later by hand; a wrongly ported leak cannot be taken back.

Skip a commit when it:

- Adds or changes a network call, URL, host, WebSocket, webhook, or DNS lookup that is not a model
  provider API or the user's own git host. That includes fetching from GitHub raw, npm registry
  metadata, `t3.codes` or any `pingdotgg` address, CDNs, font or theme registries, and pricing or
  model lists.
- Touches telemetry, analytics, crash reporting, PostHog, Sentry, or usage or resource reporting
  that leaves the machine.
- Touches T3 Connect, cloud, relay, tunnel, hosted app, guest or share links, pairing across
  machines, phone or remote access, or LAN or non-loopback binding.
- Touches a provider other than Antigravity and GitHub Copilot (ACP registry), such as Codex,
  Claude, Cursor, OpenCode, Pi, Gemini or Amp, or adds a new provider.
- Touches the mobile app (`apps/mobile`, Expo, React Native).
- Adds auto-update or self-update: the desktop updater, `t3 update`, release or download checks.
  The provider CLI updater the fork keeps is the exception, and only for changes that do not add
  new hosts.
- Changes CI, release, publishing or signing workflows, bots, or GitHub Apps. The fork's CI stays
  the plain checks in `.github/workflows/ci.yml`.
- Adds a dependency, unless it is a small, well-known library that runs fully locally and the
  commit needs it for an otherwise allowed change. A new SDK for any online service is a skip.
- Re-adds a file, feature, setting or flag that this fork removed, or turns a fork kill switch
  back on. Check `git log` on the fork for the removal before porting anything that touches it.
- Is too large, too entangled or too unclear to judge confidently from its diff.

Usually safe: UI and rendering fixes, performance work, terminal, git and diff features that stay
local, server orchestration fixes, Antigravity and ACP fixes, shared and contracts changes for
allowed features, and tests for any of these.

A commit that touches both allowed code and paths the fork deleted may be ported without the
deleted paths (keep them deleted when cherry-pick reports "deleted by us"). If the allowed part
depends on the deleted part, skip the commit.

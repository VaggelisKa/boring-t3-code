# Install T3 Code

Boring T3 Code runs coding agents on your computer and lets you control them from
your browser or its desktop app. It has no published installers: build it from
source as the [README](../../README.md#build-and-run) describes.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch T3 Code and configure providers afterwards.

## The `t3` command

After a build, the server lives at `apps/server/dist/bin.mjs`. Run it with
`node apps/server/dist/bin.mjs`, or link it onto your `PATH` as `t3`.

| Task                                  | Command     |
| ------------------------------------- | ----------- |
| Start the server and open the web app | `t3`        |
| Start the server without a browser    | `t3 serve`  |
| Reclaim database space                | `t3 doctor` |

`t3 doctor` inspects the data directory and reclaims space. Stop the server before running it
with `--fix`; `--dry-run` only reports. To keep the server running in the background, use your own
process manager such as systemd or launchd and run `t3 serve`.

Run `t3 help` or `t3 --help` for the full reference. To start in a new working
directory, use an explicit path such as `t3 ./my-project`. A bare directory name
is accepted only if it already exists.

If `t3` or `t3 start` reports an already running server, connect to that server
instead. Stop it before starting a replacement, or use a different `--base-dir`
for an independent server.

## Desktop app

Build and start the desktop app from the checkout with `vp run build:desktop`
and `vp run start:desktop`, or package an installer with one of the
`vp run dist:desktop:*` scripts. The desktop app does not update itself. To
update, pull, rebuild, and install the new build the same way.

### The `t3` command from the desktop app

The desktop app includes the `t3` command-line tool. To run it from any
terminal, open **Settings → About** and choose **Install** next to
**t3 command**. On macOS and Linux it adds a `t3` link to a folder on your
`PATH`; on Windows it adds the app's command folder to your `PATH`. Open a new
terminal afterwards. **Remove** takes it off again.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Sharing & access** to run agents and projects
there. Install the provider CLIs inside that distro. T3 Code installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
t3 app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `t3 app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server is not enough. If the command cannot reach
the app, start or rebuild the desktop app and try again.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want.

| Provider       | Install and authenticate                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- |
| Antigravity    | Install and sign in with Google from T3 Code's provider settings.                         |
| GitHub Copilot | Add it from the [ACP Registry](./providers-acp.md) in Settings → Providers, then sign in. |

Provider CLIs must be on the server's `PATH`. If T3 Code cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Antigravity can use its managed runtime without a `PATH` entry.

T3 Code warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when T3 Code cannot tell. Update a CLI installed with
mise through mise. Antigravity updates with T3 Code. Homebrew installs
compare against the version Homebrew offers, which can trail the npm release by
a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T3 Code does not display
their original values.

For provider-specific setup, see [Antigravity](./providers-antigravity.md) and
[ACP providers](./providers-acp.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.

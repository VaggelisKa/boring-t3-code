# Boring T3 Code

A local-only fork of [T3 Code](https://github.com/pingdotgg/t3code), the GUI for coding agents.
It runs a server on your computer and gives you a chat UI for your agents, in your browser or in
an Electron desktop app.

What makes it boring:

- Your code and prompts go only to the model provider you choose, and git operations go only to
  your own git host. There is no telemetry, no T3 cloud relay or tunnel, no hosted web app and no
  mobile app.
- The server listens on `localhost` only.
- Two providers: **Antigravity** and **GitHub Copilot** (through ACP).
- Nothing updates itself. You update by pulling and rebuilding.

## Requirements

- [Node.js](https://nodejs.org) 26.12.1, the version in `package.json` `engines`.
- [pnpm](https://pnpm.io) 12.14.0. With Node's Corepack, `corepack enable` picks it up from
  `packageManager`.
- Git.
- An Antigravity account or a GitHub Copilot subscription. You can set either up from the app
  after it starts.

The repository uses [Vite+](https://viteplus.dev). Its `vp` command comes with the dependencies,
so `pnpm exec vp …` always works. To type plain `vp`, install it globally:

```bash
# macOS and Linux
curl -fsSL https://vite.plus | bash
```

```powershell
# Windows
irm https://vite.plus/ps1 | iex
```

## Build and run

```bash
git clone https://github.com/VaggelisKa/boring-t3-code
cd boring-t3-code
vp i
vp run build
vp run start
```

`vp run start` starts the server and opens the web UI in your browser, at
`http://localhost:3773` unless that port is taken. To start it in a project directory, run the
server binary with a path:

```bash
node apps/server/dist/bin.mjs ~/code/my-project
```

`node apps/server/dist/bin.mjs --help` lists the other commands, such as `serve` to start without
opening a browser. There is no background service; keep the server running with your own
process manager if you need one.

App data lives in `~/.t3` by default. Pass `--base-dir <path>` to keep a separate copy.

### Desktop app

Build and run the Electron app from the checkout:

```bash
vp run build:desktop
vp run start:desktop
```

To make an installer for your machine, run one of these. Builds are unsigned and land in
`release/`:

```bash
vp run dist:desktop:dmg     # macOS
vp run dist:desktop:linux   # Linux AppImage
vp run dist:desktop:win     # Windows
```

Linux and Windows builds need extra tools. See
[Desktop artifacts](./docs/operations/development.md#desktop-artifacts).

### Update

```bash
git pull
vp i
vp run build
```

Then restart the server or the desktop app.

## Set up a provider

Open **Settings → Providers**.

- **Antigravity:** enable it, then use **Install Antigravity** and **Sign in with Google**. No
  CLI is needed. [More](./docs/user/providers-antigravity.md)
- **GitHub Copilot:** add it from the ACP registry list, then sign in.
  [More](./docs/user/providers-acp.md)

## Develop

```bash
vp run dev
```

This starts the server and the web dev server with hot reload, using a separate data directory
under the checkout's `.t3`. Read [AGENTS.md](./AGENTS.md) and
[docs/operations/development.md](./docs/operations/development.md) before changing code.

Before you push, run `vp run typecheck` in each package you changed and `vp test run` on the
files you changed. CI runs format, lint, knip, typecheck and the tests.

## Documentation

- [FAQ](./docs/user/faq.md)
- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Source control](./docs/user/source-control.md)
- [Architecture](./docs/internals/overview.md)

## License

MIT, like upstream. See [LICENSE](./LICENSE).

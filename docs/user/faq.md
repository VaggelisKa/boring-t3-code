# FAQ

## What is Boring T3 Code?

A local-only fork of [T3 Code](https://github.com/pingdotgg/t3code). It runs a server on your
computer and gives you a GUI for coding agents in your browser or in the desktop app. It works
with Antigravity and GitHub Copilot. [Provider setup](./install.md#providers)

## Does my code go to T3 servers?

No. Your code and prompts go from your machine to your provider, and git operations go to your
own git host. There is no telemetry, no cloud relay, no hosted web app, and no mobile app.
[Product usage data](./telemetry.md)

## Can I use it from another device?

No. The server listens on `localhost` only and has no option to bind another interface, so open
it on the computer it runs on.

## Can I use an API key instead of a subscription?

Add another provider instance in Settings and give it its own environment variables. Your
existing setup stays untouched. [Provider instances](./install.md#providers)

## Worktrees are eating my disk. How do I clean them up?

Open **Settings > Storage** and turn on automatic worktree cleanup. You can also run it now from
there. [Storage cleanup](./project-settings.md#storage-cleanup)

## Does it work on Windows, Mac, and Linux?

Yes. Build it from source on each, as the [README](../../README.md) describes. Windows users can
also run agents inside WSL.

## Why is my provider not showing up?

The provider is not installed, not signed in, or not on the `PATH` of the machine that runs the
server. Open **Settings > Providers** and use the provider's setup actions, or point
**Binary path** at it.

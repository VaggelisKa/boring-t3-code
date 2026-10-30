# Welcome wizard

T3 Code shows a setup flow when you open a new installation. Existing
workspaces skip this flow.

Close setup to go straight to the app. You can set up agents later from
Settings, or open `/welcome` to run setup again. Direct links, such as
Settings, open normally before setup is done.

## Choose your environments

Select one or more environments on this computer to set up. The environment
you opened T3 Code from is already connected and selected. Continue when your
selected environments are connected.

A computer marked **Client not supported** runs a T3 Code version that cannot
talk to this app. The message under its name says which side to update.

If T3 Code cannot confirm the workspace during startup, the setup flow shows
**Still connecting** instead of opening the app. Select **Reload** to try again.

If T3 Code cannot read your saved settings, it shows **Could not read settings**.
Select **Retry** after storage becomes available. Setup does not replace
unreadable settings with defaults.

## Check your agents

T3 Code checks each selected environment for Antigravity and shows whether it
is ready. If it is not installed or signed in, finish setup in
**Settings → Providers**. GitHub Copilot can be added there too.

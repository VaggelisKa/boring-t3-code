# Usage and limits

Open **Usage** from the sidebar or the command palette, or press `mod+u` on web and
desktop when the terminal is not focused. Customize `usage.open` in
**Settings → Keybindings**.

## Understand your usage

**Usage** shows Antigravity history from your connected environments: token use, cache savings,
model breakdowns, and estimated API-equivalent cost, split by token type and by speed. These
estimates are not your subscription bill. Cost that cannot be split, such as a provider-reported
cost for a model without public rates, shows as **Other**. Select a model under **Breakdown** to
see its trend, cache hit rate, and cost per million tokens.

Antigravity reads local conversation databases, including T3-managed profiles. Set
`ANTIGRAVITY_DATA_DIR` on the server to read a different data directory; comma-separated paths
read multiple directories. Models without known prices still contribute tokens and appear as
unpriced; set custom prices to estimate their cost.

The server saves its first hostname in `<T3 home>/usage-host-id`, so a recreated container keeps
its usage identity when T3 home is persisted. Set `T3CODE_HOST_ID` to choose the identity
explicitly.

When your app and server support different providers, usage totals may cover only the providers
your app understands. Update the app to include newly supported providers.

On web and desktop, use the environment dropdown to filter costs, tokens, and limits. All
environments are selected by default. The dropdown shows which environments are still scanning;
results appear as each one responds, and figures still updating are dimmed.

If recent work is missing, refresh to rescan session history.

Model prices are never downloaded. Models you use show as unpriced until you set a custom
price (below) or place a LiteLLM `model_prices_and_context_window.json` at
`<T3 home>/userdata/usage-model-rates.json` on the server; refresh afterwards to reload it.

## Set custom model prices

On web or desktop, open the environment dropdown on **Usage**, then choose **Model prices** to add,
edit, or reset a model's estimated price. **Apply to** starts with your current Usage filter;
choose all environments or select individual destinations. Enter the exact model ID and USD
rates per million input and output tokens. You can enter any model ID, including models
without public pricing. When a model on **Usage** has no known price, select it under
**Breakdown** and choose **Set price** to open this table with that model added.

Cache read and cache write rates are optional and use the input rate when blank. Enter `0` for
tokens that are free. Saved prices replace automatic pricing for all of that environment's
history and are shared with clients connected to it. When environments have different prices,
cells show **Mixed**. Edit rates directly in the table, then choose **Save changes** to apply all
edited rows. Untouched cells keep each environment's rate. Select one environment to inspect its
prices. **Reset to automatic** marks a model's override for removal when you save; you can undo
it before saving.

To count one model as another, such as a preview model under its released name, enter the target
model ID under **Map to**. The mapped model no longer appears on **Usage**: its tokens and cost
move to the target model and use the target's price. Clear **Map to** or reset the row to show
the model on its own again.

Each destination reports whether the change saved. Offline or unavailable environments are
marked **Not saved**. Reconnect them and choose **Retry failed saves** to finish the same change
without writing again to environments that already saved. Changes are not queued after you close
the dialog.

## Track subscription limits

**Usage → Limits** pools every subscription account it can see per provider, so with several
accounts across your enabled environments you read one number per window rather than a list. Each
window card shows how much of the pool is left and a bar with one segment per account, kept in the
same column across windows. A gap means the account does not report that window. When the provider
reports reset times, the card also says when the next reset lands and how much it hands back. Tap
a segment or account row for the account's plan, where it is signed in, and its reset time. On
web, you can hover too.

Antigravity reports the remaining Gemini allowance and the shared allowance for its Claude and
GPT models. The same account signed in on more than one environment counts once. Filter with the
environment dropdown to see what a single machine has.

Opening Limits checks the selected connected environments automatically. Each client waits at
least five minutes between automatic checks of an environment, including after a failed check.
If a window still looks stale, refresh Limits to re-check every provider.

Pick `/usage-limits` from the composer's command menu, or send it as a message, to check the
current model's limits without leaving the conversation. The result opens above the composer and
closes when you dismiss it or send your next message. It uses the same snapshot as **Usage → Limits**, so it does not run the agent or refresh
anything. The command is offered only for providers that appear under **Usage → Limits**.

To keep them in view on web and desktop, turn on **Usage** in **Settings → Appearance → Thread details**, or right-click the thread details card.
The bottom of the thread details card then shows how much is left in each limit window of the
current provider account and in the thread's context window. Some windows count only one model
family. Hover a row to see when it resets, your pace, or
the token count.

## Keyboard shortcuts

On web and desktop, open Usage from the command palette. While on Usage,
press `C`, `T`, or `L` for Cost, Tokens, or Limits while not typing in a field.
Use `Ctrl+Shift+1/2/3/4` (`Cmd+Shift+1/2/3/4` on macOS) for the past
24 hours, 7 days, 30 days, or 90 days. Period shortcuts do nothing on Limits.
Press `Escape` to return to the previous page. Customize these shortcuts in
**Settings → Keybindings**.

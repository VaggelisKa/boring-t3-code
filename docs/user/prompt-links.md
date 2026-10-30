# Prompt links

A prompt link opens T3 Code with a prompt ready to send. Use one to keep a prompt you reuse, or
to put a one-click fix in a pull request comment for people who run T3 Code on the same address.

A link never runs anything. It opens a draft. You read the prompt, then press Send. A link cannot
change your permission mode, branch, or worktree. Your own defaults apply.

## Make a link

Open the command palette and choose **Copy prompt link**. It copies the draft in the composer.
When the project is on GitHub, **Copy prompt link with repo and model** also adds the repository
and the model you picked. Sent messages have a **Copy prompt link** button too.

You can also write a link by hand:

```
http://localhost:3773/new?prompt=Rate%20my%20swearing
http://localhost:3773/new?prompt=Fix%20the%20build&repo=owner/name&provider=antigravity
http://localhost:3773/new?pr=owner/name/123&prompt=Fix%20the%20failing%20check
```

| Parameter  | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `prompt`   | The prompt. Required, except on pull request links. At most 8,000 characters. |
| `repo`     | A GitHub repository, as `owner/name` or its URL.                              |
| `provider` | A provider such as `antigravity`.                                             |
| `model`    | A model of that provider, by its id or name.                                  |
| `pr`       | A GitHub pull request, as `owner/name/123` or its URL.                        |

Encode the prompt for a URL. In JavaScript, use `encodeURIComponent`.

## Open a link

Links copied in the browser point at the server you copied them from. Links copied in the desktop
app are `t3code://` links, which open the desktop app on macOS.

- **No `repo`**: the draft opens without a project, on the machine you used last.
- **`repo`**: the draft opens in your most recently used project for that repository. A fork
  counts only for its own owner. When you do not have the repository, choose **Clone** or **Use
  without project**.
- **`provider` and `model`**: used when you have that provider set up. Otherwise your default
  model is used, and T3 Code tells you.
- **`pr`**: opens the thread linked to that pull request on any connected machine, with the prompt
  in its composer. When no thread is linked, the draft goes on the pull request branch in a new
  worktree. T3 Code checks the code out only after you confirm, because the checkout runs your
  setup script on it.

A thread link with a prompt, such as `http://localhost:3773/<environment>/<thread>?prompt=…`,
puts the prompt in that thread's composer. If you already typed a draft there, T3 Code asks
before it replaces it.

T3 Code removes characters you cannot see, such as zero-width and hidden tag characters, because
they can hide instructions for the agent. When a prompt had them, T3 Code warns you that it may be
malicious.

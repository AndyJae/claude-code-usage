# Claude Code Usage Monitor

See how much Claude Code usage you have left — directly in your VSCode status bar.

```
🟢 5h ████░░░░ 42%  |  🟡 7d ██████░░ 68%
```

Lightweight extension that shows your **5-hour** and **7-day** rolling usage windows in real time.

---

## Why this matters

Claude Code usage limits are not visible during real work. This extension gives you a clear, always-on status so you can:

- Avoid hitting limits mid-session
- Plan longer coding tasks
- Understand your real usage patterns
- Use Pro / Max plans more efficiently

---

## What it does

Reads your locally stored Claude Code OAuth token and calls the Anthropic usage API every 5 minutes (configurable) to fetch your current utilisation for both quota windows. The result is shown as a progress bar in the VSCode status bar at the bottom right.

- **5-hour window** — short-term rolling limit (resets 5 h after your first message)
- **7-day window** — weekly rolling limit (resets 7 days after your first message)

---

## Interface

### Colour coding

| Colour | Utilisation |
|--------|-------------|
| 🟢 Green | < 50 % |
| 🟡 Yellow | 50 – 79 % |
| 🔴 Red | ≥ 80 % |

### Interaction

**Click** the status bar item → pick display mode (`5h only`, `7d only`, `both`)  
**Hover** → detailed tooltip with exact percentages and reset countdown

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **Claude subscription** | Pro or Max — API-key-only accounts have no quota windows to display |
| **Claude Code CLI** | Must be installed and authenticated (`claude auth login`) — this creates the credentials file the extension reads |
| **VSCode** | Version 1.85 or newer |
| **Node.js** | Version 20 or newer (only needed to build from source) |

### Where credentials are stored

| Platform | Path |
|----------|------|
| Windows | `%USERPROFILE%\.claude\.credentials.json` |
| macOS | macOS Keychain (`Claude Code-credentials`), falls back to `~/.claude/.credentials.json` |
| Linux | `~/.claude/.credentials.json` |

---

## Installation

### Option A — VSCode Marketplace (easiest)

Search for **ClaudeProUsage** in the Extensions view (`Ctrl+Shift+X`), or install directly via the [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=AndJae.claudecode-usage).

### Option B — from a `.vsix` file

If you already have a built `.vsix` file:

```bash
code --install-extension claude-usage-monitor-1.0.3.vsix
```

Or via the VSCode UI: **Extensions → ··· → Install from VSIX…**

### Option C — build from source (requires Node.js ≥ 20)

```bash
git clone https://github.com/AndJae/claude-usage-monitor
cd claude-usage
npm install
npm run compile
npx @vscode/vsce package --no-yarn
code --install-extension claude-usage-monitor-1.0.3.vsix
```

### Option D — manual folder install (no vsce)

1. Install dependencies and compile:
   ```bash
   npm install
   npm run compile
   ```
2. Copy the extension folder into VSCode's extensions directory:
   ```bash
   # Windows (PowerShell)
   Copy-Item -Recurse . "$env:USERPROFILE\.vscode\extensions\local.claude-usage-monitor-1.0.3"

   # macOS / Linux
   cp -r . ~/.vscode/extensions/local.claude-usage-monitor-1.0.3
   ```
3. Restart VSCode completely (close all windows, then reopen).

---

## Configuration

Open **Settings** (`Ctrl+,`) and search for `claudeUsage`.

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeUsage.refreshIntervalSeconds` | `300` | How often to poll the API in seconds (minimum: 60) |
| `claudeUsage.defaultMode` | `"both"` | What to show: `"5h"`, `"7d"`, or `"both"` |
| `claudeUsage.credentialsPath` | `""` | Override the credentials file path (leave empty for auto-detect) |

---

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type:

| Command | Description |
|---------|-------------|
| `Claude Usage: Refresh Now` | Force an immediate API refresh |
| `Claude Usage: Toggle View (5h / 7d / Both)` | Change the status bar display mode |

---

## Privacy

- Your OAuth token is read from a local file (or macOS Keychain) — it never leaves your machine directly
- Usage data is fetched from `api.anthropic.com` using that token — this is the same API your Claude Code CLI uses
- No analytics, no telemetry, no third-party services

---

## Troubleshooting

**Status bar shows "No token — run `claude auth login`"**  
→ Claude Code CLI is not authenticated. Run `claude auth login` in a terminal.

**Status bar shows "Auth error — re-login to Claude Code"**  
→ The stored token has expired. Run `claude auth login` again.

**Status bar shows "Rate limited — retrying in Xm"**  
→ The Anthropic usage API has a rate limit. The extension backs off automatically (5 min → 10 min → 20 min → max 60 min) and retries on its own. No action needed.

**Status bar shows "Fetch failed"**  
→ Network error or temporary API issue. The extension will retry on the next interval.

**Extension does not appear after install**  
→ Make sure VSCode was fully restarted (all windows closed). Check **Help → Toggle Developer Tools → Console** for any loading errors.

---

## Limitations

- Requires an active Claude Pro or Max subscription
- Accuracy depends on what the Anthropic usage API reports
- Not an official Claude / Anthropic integration

---

## License

MIT

# Changelog

## 1.0.0

**Claude Code Usage Monitor** displays your Claude Pro/Max quota usage directly in the VSCode status bar.

- Shows 5-hour and 7-day rolling usage windows as progress bars
- Colour-coded indicators: 🟢 < 50 % · 🟡 50–79 % · 🔴 ≥ 80 %
- Hover tooltip with exact percentages and time until quota resets
- Click the status bar item to switch between `5h`, `7d`, or `both` views
- Polls the Anthropic API every 5 minutes (configurable)
- Automatic exponential backoff when rate-limited
- Reads credentials from the local Claude Code CLI token store — no separate login required

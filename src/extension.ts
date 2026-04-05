import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import * as https from "https";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsageWindow {
  utilization: number;   // 0–100
  resets_at: string;     // ISO 8601
}

interface UsageData {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  fetchedAt: Date;
}

interface Credentials {
  claudeAiOauth?: {
    accessToken: string;
    expiresAt: number;
  };
}

type DisplayMode = "5h" | "7d" | "both";

// ─── Credentials ─────────────────────────────────────────────────────────────

function getCredentialsPath(): string {
  const cfg = vscode.workspace
    .getConfiguration("claudeUsage")
    .get<string>("credentialsPath");
  if (cfg && cfg.trim() !== "") {
    return cfg.trim();
  }
  // All platforms: ~/.claude/.credentials.json
  // macOS uses Keychain (handled separately), but the file may also exist.
  return path.join(os.homedir(), ".claude", ".credentials.json");
}

function readTokenFromFile(): string | null {
  try {
    const raw = fs.readFileSync(getCredentialsPath(), "utf-8");
    const creds: Credentials = JSON.parse(raw);
    const token = creds?.claudeAiOauth?.accessToken;
    if (!token) {
      return null;
    }
    // Check expiry (expiresAt is in milliseconds)
    const expiresAt = creds?.claudeAiOauth?.expiresAt ?? 0;
    if (expiresAt > 0 && Date.now() > expiresAt) {
      return null; // expired
    }
    return token;
  } catch {
    return null;
  }
}

function readTokenFromMacKeychain(): string | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();
    const creds: Credentials = JSON.parse(raw);
    return creds?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

function getAccessToken(): string | null {
  if (process.platform === "darwin") {
    // macOS: prefer Keychain, fall back to file
    return readTokenFromMacKeychain() ?? readTokenFromFile();
  }
  // Linux + Windows: file only
  return readTokenFromFile();
}

// ─── API call ─────────────────────────────────────────────────────────────────

function fetchUsage(token: string): Promise<UsageData> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: "api.anthropic.com",
      path: "/api/oauth/usage",
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.90",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          return;
        }
        try {
          const json = JSON.parse(body);
          resolve({
            five_hour: json.five_hour ?? null,
            seven_day: json.seven_day ?? null,
            fetchedAt: new Date(),
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(10_000, () => {
      req.destroy(new Error("Request timed out"));
    });
    req.end();
  });
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function bar(pct: number, width = 8): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function colorIcon(pct: number): string {
  if (pct < 50) return "🟢";
  if (pct < 80) return "🟡";
  return "🔴";
}

function timeUntil(isoString: string): string {
  const ms = new Date(isoString).getTime() - Date.now();
  if (ms <= 0) return "resetting…";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
}

function formatWindow(label: string, w: UsageWindow): string {
  const pct = Math.round(w.utilization);
  return `${colorIcon(pct)} ${label} ${bar(pct)} ${pct}%`;
}

function buildStatusText(data: UsageData, mode: DisplayMode): string {
  const parts: string[] = [];

  if ((mode === "5h" || mode === "both") && data.five_hour) {
    parts.push(formatWindow("5h", data.five_hour));
  }
  if ((mode === "7d" || mode === "both") && data.seven_day) {
    parts.push(formatWindow("7d", data.seven_day));
  }

  if (parts.length === 0) {
    return "$(sync~spin) Claude: no data";
  }
  return parts.join("  |  ");
}

function buildTooltip(data: UsageData): string {
  const lines: string[] = ["Claude Code Usage", ""];

  if (data.five_hour) {
    const pct = Math.round(data.five_hour.utilization);
    lines.push(
      `5-hour window:  ${pct}%  (resets in ${timeUntil(data.five_hour.resets_at)})`
    );
    lines.push(`  ${bar(pct, 20)} `);
  } else {
    lines.push("5-hour window:  n/a");
  }

  lines.push("");

  if (data.seven_day) {
    const pct = Math.round(data.seven_day.utilization);
    lines.push(
      `7-day window:   ${pct}%  (resets in ${timeUntil(data.seven_day.resets_at)})`
    );
    lines.push(`  ${bar(pct, 20)} `);
  } else {
    lines.push("7-day window:   n/a");
  }

  lines.push("");
  lines.push(`Last updated: ${data.fetchedAt.toLocaleTimeString()}`);
  lines.push("");
  lines.push("Click to toggle view mode  |  Right-click for commands");
  return lines.join("\n");
}

// ─── Extension entry point ────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const config = () => vscode.workspace.getConfiguration("claudeUsage");

  // Status bar item — place it right of the usual items
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    90
  );
  item.command = "claudeUsage.toggleMode";
  item.show();
  context.subscriptions.push(item);

  // Current state
  let mode: DisplayMode = config().get<DisplayMode>("defaultMode") ?? "both";
  let lastData: UsageData | null = null;
  let lastError: string | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  // ── Render ──────────────────────────────────────────────────────────────────
  function render() {
    if (lastError) {
      item.text = `$(warning) Claude: ${lastError}`;
      item.tooltip = lastError;
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      return;
    }
    if (!lastData) {
      item.text = "$(sync~spin) Claude…";
      item.tooltip = "Fetching usage data…";
      item.backgroundColor = undefined;
      return;
    }
    item.text = buildStatusText(lastData, mode);
    item.tooltip = new vscode.MarkdownString(
      "```\n" + buildTooltip(lastData) + "\n```"
    );
    item.backgroundColor = undefined;
  }

  // ── Fetch & update ──────────────────────────────────────────────────────────
  async function refresh() {
    item.text = "$(sync~spin) Claude…";
    const token = getAccessToken();
    if (!token) {
      lastError = "No token — run `claude auth login`";
      lastData = null;
      render();
      return;
    }
    try {
      lastData = await fetchUsage(token);
      lastError = null;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg.startsWith("HTTP 401")
        ? "Auth error — re-login to Claude Code"
        : msg.startsWith("HTTP 429")
        ? "Rate limited — retrying soon"
        : "Fetch failed";
    }
    render();
  }

  // ── Polling ─────────────────────────────────────────────────────────────────
  function startPolling() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    const intervalMs =
      (config().get<number>("refreshIntervalSeconds") ?? 60) * 1000;
    refreshTimer = setInterval(refresh, intervalMs);
    context.subscriptions.push({ dispose: () => clearInterval(refreshTimer!) });
  }

  // ── Commands ─────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeUsage.refresh", refresh),

    vscode.commands.registerCommand("claudeUsage.toggleMode", async () => {
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: "$(clock) 5-hour window",
            description: "Show 5h rolling limit only",
            value: "5h" as DisplayMode,
          },
          {
            label: "$(calendar) 7-day window",
            description: "Show 7-day rolling limit only",
            value: "7d" as DisplayMode,
          },
          {
            label: "$(list-unordered) Both",
            description: "Show 5h and 7d side by side",
            value: "both" as DisplayMode,
          },
        ],
        {
          placeHolder: `Current: ${mode} — select view mode`,
          matchOnDescription: true,
        }
      );
      if (picked) {
        mode = picked.value;
        render();
      }
    }),

    // React to config changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("claudeUsage")) {
        mode = config().get<DisplayMode>("defaultMode") ?? "both";
        startPolling();
        refresh();
      }
    })
  );

  // ── Boot ─────────────────────────────────────────────────────────────────────
  refresh();
  startPolling();
}

export function deactivate() {}

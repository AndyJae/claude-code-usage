"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const https = __importStar(require("https"));
// ─── Credentials ─────────────────────────────────────────────────────────────
function getCredentialsPath() {
    const cfg = vscode.workspace
        .getConfiguration("claudeUsage")
        .get("credentialsPath");
    if (cfg && cfg.trim() !== "") {
        return cfg.trim();
    }
    // All platforms: ~/.claude/.credentials.json
    // macOS uses Keychain (handled separately), but the file may also exist.
    return path.join(os.homedir(), ".claude", ".credentials.json");
}
function readTokenFromFile() {
    try {
        const raw = fs.readFileSync(getCredentialsPath(), "utf-8");
        const creds = JSON.parse(raw);
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
    }
    catch {
        return null;
    }
}
function readTokenFromMacKeychain() {
    try {
        const raw = (0, child_process_1.execSync)('security find-generic-password -s "Claude Code-credentials" -w', { timeout: 5000, stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
        const creds = JSON.parse(raw);
        return creds?.claudeAiOauth?.accessToken ?? null;
    }
    catch {
        return null;
    }
}
function getAccessToken() {
    if (process.platform === "darwin") {
        // macOS: prefer Keychain, fall back to file
        return readTokenFromMacKeychain() ?? readTokenFromFile();
    }
    // Linux + Windows: file only
    return readTokenFromFile();
}
// ─── API call ─────────────────────────────────────────────────────────────────
function fetchUsage(token) {
    return new Promise((resolve, reject) => {
        const options = {
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
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => {
            req.destroy(new Error("Request timed out"));
        });
        req.end();
    });
}
// ─── Formatting ───────────────────────────────────────────────────────────────
function bar(pct, width = 8) {
    const filled = Math.round((pct / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}
function colorIcon(pct) {
    if (pct < 50)
        return "🟢";
    if (pct < 80)
        return "🟡";
    return "🔴";
}
function timeUntil(isoString) {
    const ms = new Date(isoString).getTime() - Date.now();
    if (ms <= 0)
        return "resetting…";
    const totalMin = Math.floor(ms / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    if (d > 0)
        return `${d}d${h.toString().padStart(2, "0")}h${m.toString().padStart(2, "0")}m`;
    return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
}
function formatWindow(label, w) {
    const pct = Math.round(w.utilization);
    return `${colorIcon(pct)} ${label} ${bar(pct)} ${pct}%`;
}
function buildStatusText(data, mode) {
    const parts = [];
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
function buildTooltip(data) {
    const lines = ["Claude Code Usage", ""];
    if (data.five_hour) {
        const pct = Math.round(data.five_hour.utilization);
        lines.push(`5-hour window:  ${pct}%  (resets in ${timeUntil(data.five_hour.resets_at)})`);
        lines.push(`  ${bar(pct, 20)} `);
    }
    else {
        lines.push("5-hour window:  n/a");
    }
    lines.push("");
    if (data.seven_day) {
        const pct = Math.round(data.seven_day.utilization);
        lines.push(`7-day window:   ${pct}%  (resets in ${timeUntil(data.seven_day.resets_at)})`);
        lines.push(`  ${bar(pct, 20)} `);
    }
    else {
        lines.push("7-day window:   n/a");
    }
    lines.push("");
    lines.push(`Last updated: ${data.fetchedAt.toLocaleTimeString()}`);
    lines.push("");
    lines.push("Click to toggle view mode  |  Right-click for commands");
    return lines.join("\n");
}
// ─── Extension entry point ────────────────────────────────────────────────────
function activate(context) {
    const config = () => vscode.workspace.getConfiguration("claudeUsage");
    // Status bar item — place it right of the usual items
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    item.command = "claudeUsage.toggleMode";
    item.show();
    context.subscriptions.push(item);
    // Current state
    let mode = config().get("defaultMode") ?? "both";
    let lastData = null;
    let lastError = null;
    let refreshTimer = null;
    let backoffTimer = null;
    let backoffMs = 0;
    // ── Render ──────────────────────────────────────────────────────────────────
    function render() {
        if (lastError) {
            item.text = `$(warning) Claude: ${lastError}`;
            item.tooltip = lastError;
            item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
            return;
        }
        if (!lastData) {
            item.text = "$(sync~spin) Claude…";
            item.tooltip = "Fetching usage data…";
            item.backgroundColor = undefined;
            return;
        }
        item.text = buildStatusText(lastData, mode);
        item.tooltip = new vscode.MarkdownString("```\n" + buildTooltip(lastData) + "\n```");
        item.backgroundColor = undefined;
    }
    // ── Fetch & update ──────────────────────────────────────────────────────────
    async function refresh() {
        if (backoffTimer)
            return;
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
            backoffMs = 0;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.startsWith("HTTP 429")) {
                backoffMs = backoffMs === 0 ? 5 * 60000 : Math.min(backoffMs * 2, 60 * 60000);
                lastError = `Rate limited — retrying in ${Math.round(backoffMs / 60000)}m`;
                backoffTimer = setTimeout(() => {
                    backoffTimer = null;
                    refresh();
                }, backoffMs);
            }
            else {
                lastError = msg.startsWith("HTTP 401")
                    ? "Auth error — re-login to Claude Code"
                    : "Fetch failed";
            }
        }
        render();
    }
    // ── Polling ─────────────────────────────────────────────────────────────────
    function startPolling() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }
        const intervalMs = (config().get("refreshIntervalSeconds") ?? 300) * 1000;
        refreshTimer = setInterval(refresh, intervalMs);
        context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
    }
    // ── Commands ─────────────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand("claudeUsage.refresh", refresh), vscode.commands.registerCommand("claudeUsage.toggleMode", async () => {
        const picked = await vscode.window.showQuickPick([
            {
                label: "$(clock) 5-hour window",
                description: "Show 5h rolling limit only",
                value: "5h",
            },
            {
                label: "$(calendar) 7-day window",
                description: "Show 7-day rolling limit only",
                value: "7d",
            },
            {
                label: "$(list-unordered) Both",
                description: "Show 5h and 7d side by side",
                value: "both",
            },
        ], {
            placeHolder: `Current: ${mode} — select view mode`,
            matchOnDescription: true,
        });
        if (picked) {
            mode = picked.value;
            render();
        }
    }), 
    // React to config changes
    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("claudeUsage")) {
            mode = config().get("defaultMode") ?? "both";
            startPolling();
            refresh();
        }
    }));
    // ── Boot ─────────────────────────────────────────────────────────────────────
    refresh();
    startPolling();
}
function deactivate() { }

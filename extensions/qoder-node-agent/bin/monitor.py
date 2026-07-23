#!/usr/bin/env python3
"""monitor.py — Qoder 节点监控看板（单文件 HTTP 服务）

功能：
  1. 启动 HTTP 服务（Python 标准库，零依赖）
  2. /          → 返回监控看板 HTML 页面
  3. /api/status → 返回本机所有工作区的实时状态 JSON
  4. /api/nodes → 返回远程节点状态（从 status-dir 读取其他机器的 status.json）

用法：
  python3 monitor.py                          # 默认 8080 端口
  python3 monitor.py --port 3000              # 指定端口
  python3 monitor.py --status-dir /path/to/dir # 指定远程状态目录
"""

import json
import os
import sys
import time
import glob
import subprocess
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone
from urllib.parse import urlparse

# ── 路径解析 ──────────────────────────────────────────────

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_SCRIPT_DIR, "..", ".."))

# collect-status.py 路径
_COLLECT_STATUS = os.path.join(_SCRIPT_DIR, "collect-status.py")

# 远程节点状态目录（默认为本机的 status.json 所在目录）
_DEFAULT_STATUS_DIR = os.path.expanduser("~/.qoder-node-agent")


# ── 数据采集 ──────────────────────────────────────────────

def get_local_status():
    """采集本机状态（调 collect-status.py）"""
    try:
        result = subprocess.run(
            ["python3", _COLLECT_STATUS],
            capture_output=True, text=True, timeout=15,
            cwd=_PROJECT_ROOT,
        )
        if result.returncode == 0:
            # collect-status.py 输出到 stdout 的最后一行是状态写入信息
            # 但 status.json 已写入文件，直接读文件
            status_file = os.path.join(_DEFAULT_STATUS_DIR, "status.json")
            if os.path.exists(status_file):
                with open(status_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        return {"error": f"collect-status.py 失败: {result.stderr[:200]}"}
    except Exception as e:
        return {"error": str(e)}


def get_remote_nodes(status_dir):
    """读取远程节点的 status.json 文件"""
    nodes = []
    if not os.path.isdir(status_dir):
        return nodes

    # 查找 status_dir 下的所有 status.json
    for f in glob.glob(os.path.join(status_dir, "nodes", "*", "status.json")):
        try:
            with open(f, "r", encoding="utf-8") as fh:
                data = json.load(fh)
                nodes.append(data)
        except Exception:
            pass

    # 也读取 status_dir 自身的 status.json（本机）
    local_status = os.path.join(status_dir, "status.json")
    if os.path.exists(local_status):
        try:
            with open(local_status, "r", encoding="utf-8") as fh:
                data = json.load(fh)
                if data not in nodes:
                    nodes.insert(0, data)
        except Exception:
            pass

    return nodes


# ── HTTP 处理器 ──────────────────────────────────────────

class MonitorHandler(BaseHTTPRequestHandler):
    
    def log_message(self, format, *args):
        # 静默日志（或输出到 stderr）
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            self._serve_html()
        elif path == "/api/status":
            self._serve_local_status()
        elif path == "/api/nodes":
            self._serve_nodes()
        else:
            self._json_response(404, {"error": "not found"})

    def _serve_html(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(DASHBOARD_HTML.encode("utf-8"))

    def _serve_local_status(self):
        status = get_local_status()
        self._json_response(200, status)

    def _serve_nodes(self):
        nodes = get_remote_nodes(self.server.status_dir)
        # 同时附带本机实时状态
        local = get_local_status()
        self._json_response(200, {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "local_node": local,
            "remote_nodes": nodes,
        })

    def _json_response(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))


# ── 前端看板 HTML ────────────────────────────────────────

DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Qoder 节点监控</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    padding: 20px;
    min-height: 100vh;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #21262d;
  }
  .header h1 { font-size: 20px; color: #58a6ff; }
  .header .refresh-info { font-size: 13px; color: #8b949e; }
  .header .refresh-info .dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    background: #3fb950;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .summary {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .summary-card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 8px;
    padding: 12px 20px;
    min-width: 100px;
  }
  .summary-card .num { font-size: 28px; font-weight: 700; }
  .summary-card .label { font-size: 12px; color: #8b949e; margin-top: 4px; }
  .node-section {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 8px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .node-header {
    padding: 12px 20px;
    border-bottom: 1px solid #21262d;
    font-weight: 600;
    font-size: 15px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .workspace-list { padding: 8px 0; }
  .workspace-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    border-bottom: 1px solid #21262d;
    font-size: 14px;
  }
  .workspace-item:last-child { border-bottom: none; }
  .ws-left { display: flex; align-items: center; gap: 10px; }
  .ws-icon { font-size: 18px; }
  .ws-name { font-weight: 500; }
  .ws-detail { color: #8b949e; font-size: 13px; }
  .ws-right { display: flex; align-items: center; gap: 16px; font-size: 13px; color: #8b949e; }
  .ws-badge {
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }
  .badge-running { background: rgba(63,185,80,0.15); color: #3fb950; }
  .badge-likely_running { background: rgba(255,149,0,0.15); color: #ff9500; }
  .badge-waiting, .badge-waiting_stale { background: rgba(0,122,255,0.15); color: #007aff; }
  .badge-zombie, .badge-likely_zombie { background: rgba(255,159,10,0.15); color: #ff9f0a; }
  .badge-idle { background: rgba(139,148,158,0.15); color: #8b949e; }
  .badge-terminal { background: rgba(72,72,74,0.3); color: #6e6e6e; }
  .badge-error { background: rgba(255,69,58,0.15); color: #ff453a; }
  .time-ago { font-size: 12px; color: #6e7681; }
  .error-msg { color: #ff453a; font-size: 13px; padding: 12px 20px; }
  .loading { text-align: center; padding: 40px; color: #8b949e; }
</style>
</head>
<body>
  <div class="header">
    <h1>Qoder 节点监控</h1>
    <div class="refresh-info">
      <span class="dot"></span>
      <span id="last-update">加载中...</span>
    </div>
  </div>
  <div id="summary" class="summary"></div>
  <div id="content">
    <div class="loading">正在采集状态...</div>
  </div>

<script>
const ICONS = {
  running: "🔴", likely_running: "🟠",
  waiting: "🟦", waiting_stale: "🔷",
  zombie: "🟡", likely_zombie: "🟡",
  idle: "⚪", terminal: "⚫", error: "❗"
};
const LABELS = {
  running: "真正在跑", likely_running: "可能在跑",
  waiting: "等待确认", waiting_stale: "等待(遗忘)",
  zombie: "僵尸", likely_zombie: "可能僵尸",
  idle: "空闲", terminal: "已终止", error: "出错"
};

function timeAgo(seconds) {
  if (seconds < 60) return Math.round(seconds) + "秒前";
  if (seconds < 3600) return Math.round(seconds/60) + "分钟前";
  if (seconds < 86400) return Math.round(seconds/3600) + "小时前";
  return Math.round(seconds/86400) + "天前";
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function renderWorkspace(w) {
  const rs = w.real_status || "idle";
  const icon = ICONS[rs] || "❓";
  const label = LABELS[rs] || rs;
  const wsName = escapeHtml(w.workspace);
  const doneCount = w.completed_count || 0;

  let detail = "";
  if (rs === "running" || rs === "likely_running") {
    const roles = (w.executing || []).map(e => escapeHtml(e.role)).join(", ");
    detail = roles ? `正在执行: ${roles}` : "";
  } else if (rs === "waiting" || rs === "waiting_stale") {
    const roles = (w.awaiting_confirmation || []).map(a => escapeHtml(a.role)).join(", ");
    detail = roles ? `等待确认: ${roles}` : "";
  } else if (rs === "zombie" || rs === "likely_zombie") {
    const roles = (w.executing || []).map(e => escapeHtml(e.role)).join(", ");
    detail = roles ? `原执行: ${roles}` : "";
  } else if (rs === "error") {
    detail = escapeHtml(w.engine_error || "未知错误");
  }

  const secs = w.seconds_since_update;
  const timeInfo = secs != null ? `<span class="time-ago">${timeAgo(secs)}</span>` : "";
  const appInfo = w.index_app ? escapeHtml(w.index_app.split("/").pop()) : "";

  return `
    <div class="workspace-item">
      <div class="ws-left">
        <span class="ws-icon">${icon}</span>
        <div>
          <div class="ws-name">${wsName}</div>
          <div class="ws-detail">${detail}${appInfo ? " · " + appInfo : ""} · ${doneCount}步完成</div>
        </div>
      </div>
      <div class="ws-right">
        ${timeInfo}
        <span class="ws-badge badge-${rs}">${label}</span>
      </div>
    </div>`;
}

function renderSummary(s) {
  const cards = [
    {num: s.running || 0, label: "真正在跑", color: "#3fb950"},
    {num: s.likely_running || 0, label: "可能在跑", color: "#ff9500"},
    {num: s.waiting || 0, label: "等待确认", color: "#007aff"},
    {num: s.zombie || 0, label: "僵尸", color: "#ff9f0a"},
    {num: s.idle || 0, label: "空闲", color: "#8b949e"},
  ];
  return cards.map(c =>
    `<div class="summary-card"><div class="num" style="color:${c.color}">${c.num}</div><div class="label">${c.label}</div></div>`
  ).join("");
}

async function refresh() {
  try {
    const resp = await fetch("/api/status");
    const data = await resp.json();

    const now = new Date();
    document.getElementById("last-update").textContent =
      "最后更新: " + now.toLocaleTimeString("zh-CN");

    if (data.error) {
      document.getElementById("content").innerHTML =
        `<div class="error-msg">采集失败: ${escapeHtml(data.error)}</div>`;
      return;
    }

    const summary = data.summary || {};
    document.getElementById("summary").innerHTML = renderSummary(summary);

    const node = data.node || "本机";
    const workspaces = data.workspaces || [];
    const procInfo = data.process_detection || {};

    let html = `
      <div class="node-section">
        <div class="node-header">
          <span style="font-size:18px">🖥️</span>
          <span>${escapeHtml(node)}</span>
          <span style="color:#8b949e;font-weight:400;font-size:13px">
            · ${procInfo.active_process_count || 0} 个活跃进程
            ${procInfo.ide_open ? " · IDE 开着" : ""}
          </span>
        </div>
        <div class="workspace-list">
          ${workspaces.length > 0
            ? workspaces.map(renderWorkspace).join("")
            : '<div class="workspace-item"><div class="ws-detail">没有工作区</div></div>'}
        </div>
      </div>`;

    document.getElementById("content").innerHTML = html;
  } catch (e) {
    document.getElementById("content").innerHTML =
      `<div class="error-msg">请求失败: ${escapeHtml(e.message)}</div>`;
  }
}

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>
"""


# ── 主入口 ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Qoder 节点监控看板")
    parser.add_argument("--port", type=int, default=8080, help="HTTP 端口（默认 8080）")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    parser.add_argument("--status-dir", default=_DEFAULT_STATUS_DIR,
                        help="远程节点状态目录")
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), MonitorHandler)
    server.status_dir = args.status_dir

    print(f"🖥️  Qoder 节点监控看板")
    print(f"   地址: http://localhost:{args.port}")
    print(f"   状态目录: {args.status_dir}")
    print(f"   按 Ctrl+C 停止")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止服务")
        server.server_close()


if __name__ == "__main__":
    main()

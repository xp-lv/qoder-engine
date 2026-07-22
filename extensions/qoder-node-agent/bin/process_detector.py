#!/usr/bin/env python3
"""process_detector.py — 进程级活动检测器

职责：检测本机上是否有 Qoder CLI / 引擎进程在活动。
不做状态推断，只报告"我看到了哪些进程"。

检测目标：
  - qodercli 进程（Headless 模式的 Qoder CLI）
  - python3 engine/scripts/ 进程（引擎脚本直接执行）
  - node.*qoder 进程（Qoder IDE 的 Agent 运行时）

被谁调用：
  - collect-status.py（每次采集时调用）
  - 未来可被守护进程定时调用
"""

import subprocess
import os
import re
from datetime import datetime, timezone


# ── 进程匹配模式 ──────────────────────────────────────────

PROCESS_PATTERNS = [
    {
        "name": "qodercli",
        "pattern": r"qodercli",
        "description": "Qoder CLI 进程（Headless 或 TUI）",
    },
    {
        "name": "engine_script",
        "pattern": r"python3?.*(?:step|orchestrator|gate|fix)\.py",
        "description": "引擎脚本直接执行",
    },
    {
        "name": "qoder_node",
        "pattern": r"node.*qoder|Qoder Helper",
        "description": "Qoder IDE 的 Node 运行时",
    },
]


# ── 进程扫描 ──────────────────────────────────────────────

def scan_processes():
    """扫描本机所有进程，返回匹配到的 Qoder 相关进程。

    Returns:
        list of dict: [
            {
                "pid": 12345,
                "pattern_name": "qodercli",
                "command": "qodercli -p 启动xxx",
                "cpu": 0.5,
                "mem": 1.2,
                "elapsed": "00:05:30",
            },
            ...
        ]
    """
    try:
        result = subprocess.run(
            ["ps", "aux"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        return {"error": "ps aux 超时", "processes": []}
    except Exception as e:
        return {"error": str(e), "processes": []}

    lines = result.stdout.strip().split("\n")
    if len(lines) < 2:
        return {"error": "ps 输出为空", "processes": []}

    # ps aux 的列：USER PID %CPU %MEM VSZ RSS TT STAT STARTED TIME COMMAND
    header = lines[0]
    processes = []

    for line in lines[1:]:
        parts = line.split(None, 10)  # 最多分 11 段，最后一段是完整命令
        if len(parts) < 11:
            continue

        pid_str, cpu_str, mem_str = parts[1], parts[2], parts[3]
        elapsed = parts[9]  # TIME 列（累计 CPU 时间）
        command = parts[10]

        # 跳过自己（本脚本）
        if "process_detector" in command:
            continue
        # 跳过 grep 自己
        if "grep" in command and any(p["pattern"].split("|")[0] in command for p in PROCESS_PATTERNS):
            continue

        for pat in PROCESS_PATTERNS:
            if re.search(pat["pattern"], command, re.IGNORECASE):
                try:
                    pid = int(pid_str)
                except ValueError:
                    pid = -1

                processes.append({
                    "pid": pid,
                    "pattern_name": pat["name"],
                    "pattern_desc": pat["description"],
                    "command": command.strip(),
                    "cpu_percent": _safe_float(cpu_str),
                    "mem_percent": _safe_float(mem_str),
                    "elapsed_cpu": elapsed,
                })
                break  # 一个进程只匹配一个 pattern

    return {"processes": processes, "error": None}


def _safe_float(s):
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


# ── 活动判定 ──────────────────────────────────────────────

# UI/基础设施进程的排除模式（这些只说明 IDE 开着，不代表在跑任务）
_UI_PROCESS_MARKERS = [
    "--type=renderer",
    "--type=gpu-process",
    "--type=utility --utility-sub-type=network",
    "--type=crashpad_handler",
    "--max-old-space-size",  # Node.js 内存管理进程
    "UtilityProcess",       # Electron Utility 进程
]

# CPU 活跃阈值：超过这个值认为进程在真正干活
_CPU_ACTIVE_THRESHOLD = 1.0  # %


def _is_ui_infra_process(command):
    """判断是否为 IDE 的 UI/基础设施进程（不是 Agent 执行）。

    Qoder IDE（基于 Electron）会启动很多子进程：
    - Renderer：渲染 UI
    - GPU-process：硬件加速
    - Utility：各种后台服务
    这些进程的存在只说明 IDE 开着，不代表有 Agent 任务在执行。
    """
    cmd_lower = command.lower()
    for marker in _UI_PROCESS_MARKERS:
        if marker.lower() in cmd_lower:
            return True
    return False


def is_machine_active():
    """这台机器上有没有 Qoder 在执行 Agent 任务？

    三层过滤：
    1. 匹配 Qoder 相关进程（qodercli / engine_script / qoder_node）
    2. 排除 UI 基础设施进程（Renderer/GPU/Utility）
    3. 区分 CPU 活跃和空闲进程

    Returns:
        dict: {
            "active": True/False,          # 是否有任务级活动
            "ide_open": True/False,        # IDE 是否开着
            "active_processes": [...],     # 真正在干活的进程
            "idle_processes": [...],       # IDE 常驻但没干活的进程
        }
    """
    scan = scan_processes()
    procs = scan.get("processes", [])

    active_procs = []   # 真正在干活的
    idle_procs = []     # IDE 常驻但 CPU 为 0

    for p in procs:
        if p["pid"] <= 0:
            continue

        # 排除 UI 基础设施进程
        if _is_ui_infra_process(p["command"]):
            # 但如果 CPU 高，仍认为在干活（比如 Renderer 在渲染 Agent 输出）
            if p["cpu_percent"] >= _CPU_ACTIVE_THRESHOLD:
                active_procs.append(p)
            else:
                idle_procs.append(p)
        else:
            # 非 UI 进程（qodercli / engine_script）
            # 只要存在就认为是活动信号
            active_procs.append(p)

    return {
        "active": len(active_procs) > 0,
        "ide_open": len(active_procs) + len(idle_procs) > 0,
        "active_count": len(active_procs),
        "idle_count": len(idle_procs),
        "active_processes": [
            {
                "pid": p["pid"],
                "type": p["pattern_name"],
                "cpu": p["cpu_percent"],
                "cmd_preview": p["command"][:120],
            }
            for p in active_procs
        ],
        "idle_processes": [
            {"pid": p["pid"], "type": p["pattern_name"]}
            for p in idle_procs
        ],
        "error": scan.get("error"),
        "scanned_at": datetime.now(timezone.utc).isoformat(),
    }


def get_active_pids():
    """获取当前活跃的 Qoder 进程 PID 列表（便捷方法）"""
    result = is_machine_active()
    return [p["pid"] for p in result["active_processes"]]


# ── CLI 入口 ──────────────────────────────────────────────

if __name__ == "__main__":
    import json

    print("=== 进程级活动检测 ===")
    print()

    result = is_machine_active()

    if result["error"]:
        print(f"⚠ 检测出错: {result['error']}")
    else:
        active_label = '🟢 有任务在跑' if result['active'] else '⚫ 无任务活动'
        ide_label = '（IDE 开着）' if result['ide_open'] else '（IDE 未运行）'
        print(f"机器活跃状态: {active_label} {ide_label}")
        print(f"活跃进程数:   {result['active_count']}")
        print(f"空闲进程数:   {result['idle_count']}（IDE 常驻）")
        print(f"扫描时间:     {result['scanned_at']}")
        print()

        if result["active_processes"]:
            print("活跃进程（真正在干活的）:")
            for p in result["active_processes"]:
                print(f"  PID {p['pid']:>7}  CPU {p['cpu']:>5.1f}%  [{p['type']}]")
                print(f"           {p['cmd_preview']}")
        else:
            print("未检测到活跃的 Agent 进程")

    print()
    print("=== 完整 JSON ===")
    print(json.dumps(result, ensure_ascii=False, indent=2))

#!/usr/bin/env python3
"""collect-status.py — Qoder 节点状态采集器（MVP）

职责：扫描本地所有引擎工作区的 STATE.json，汇总成 status.json。
不做 Git 同步、不做指令执行、不做远程通信。
就是一个脚本：读本地状态 → 写 JSON 文件。

用法：
    python3 collect-status.py                  # 用默认引擎路径
    ENGINE_ROOT=/path/to/engine python3 collect-status.py  # 指定引擎路径
"""

import json
import os
import glob
import sys
import time
from datetime import datetime, timezone

# 导入进程检测器（同目录）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import process_detector

# ── 活跃度阈值（秒）
_FRESH_THRESHOLD = 60       # 60 秒内更新过 → 非常活跃
#RECENT_THRESHOLD = 300     # 5 分钟内更新过 → 近期活跃（目前未用）
_STALE_THRESHOLD = 600      # 10 分钟未更新 → 很可能不在跑了


# ── 路径解析 ──────────────────────────────────────────────

def get_engine_root():
    """引擎根目录。优先环境变量，其次向上查找。"""
    env_root = os.environ.get("ENGINE_ROOT")
    if env_root and os.path.isdir(env_root):
        return env_root
    
    # 从脚本位置向上找：extensions/qoder-node-agent/bin/ → 上三级
    here = os.path.dirname(os.path.abspath(__file__))
    for parent in [here, os.path.dirname(here), os.path.dirname(os.path.dirname(here))]:
        candidate = os.path.dirname(parent)  # 逐级向上
        if os.path.isdir(os.path.join(candidate, "engine", "scripts")):
            return candidate
        if os.path.isdir(os.path.join(candidate, "runtime", "workspaces")):
            return candidate
    
    # 兜底：用当前工作目录
    return os.getcwd()


def get_output_path():
    """status.json 的输出路径。默认 ~/.qoder-node-agent/status.json"""
    env_out = os.environ.get("STATUS_OUTPUT")
    if env_out:
        return env_out
    return os.path.expanduser("~/.qoder-node-agent/status.json")


# ── 状态采集 ──────────────────────────────────────────────

def scan_workspace(state_path):
    """解析单个工作区的 STATE.json"""
    try:
        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
    except json.JSONDecodeError as e:
        return {
            "workspace": os.path.basename(os.path.dirname(state_path)),
            "state_path": state_path,
            "error": f"JSON 解析失败: {e}",
        }
    except Exception as e:
        return {
            "workspace": os.path.basename(os.path.dirname(state_path)),
            "state_path": state_path,
            "error": str(e),
        }

    step_status = state.get("step_status", {})
    executing = [
        {
            "role": role_name,
            "status": info.get("status"),
            "dispatch_id": info.get("dispatch_id"),
            "started_at": info.get("started_at"),
        }
        for role_name, info in step_status.items()
        if info.get("status") == "executing"
    ]

    # 识别等待用户确认的节点（manual 确认点）
    awaiting = [
        {
            "role": role_name,
            "verdict": info.get("verdict"),
            "dispatch_id": info.get("dispatch_id"),
        }
        for role_name, info in step_status.items()
        if info.get("status") == "awaiting_confirmation"
    ]

    completed = state.get("completed", {})
    completed_roles = [
        {"role": name, "verdict": info.get("verdict")}
        for name, info in completed.items()
    ]

    terminal = state.get("terminal_state")
    active_dispatches = state.get("active_dispatches", {})
    engine_error = state.get("engine_error")  # 引擎错误信号

    # 工作区级心跳：STATE.json 的文件修改时间
    state_mtime = os.path.getmtime(state_path)
    now = time.time()
    seconds_since_update = now - state_mtime

    # 综合活动状态
    has_executing = len(executing) > 0 and terminal is None
    has_awaiting = len(awaiting) > 0 and terminal is None

    return {
        "workspace": state.get("project_id", os.path.basename(os.path.dirname(state_path))),
        "state_path": state_path,
        "executing": executing,
        "executing_count": len(executing),
        "awaiting_confirmation": awaiting,
        "awaiting_count": len(awaiting),
        "completed_count": len(completed),
        "completed_roles": completed_roles,
        "terminal_state": terminal,
        "engine_error": engine_error,
        "active_dispatches_count": len(active_dispatches) if active_dispatches else 0,
        "state_says_running": has_executing,
        "state_says_waiting": has_awaiting,
        "last_activity": state.get("metadata", {}).get("last_advance_at"),
        "user_request": state.get("metadata", {}).get("user_request"),
        # 工作区级心跳信号
        "state_mtime": datetime.fromtimestamp(state_mtime, tz=timezone.utc).isoformat(),
        "seconds_since_update": round(seconds_since_update, 1),
        "file_freshness": _freshness_label(seconds_since_update),
    }


def _freshness_label(seconds):
    """根据距上次更新的秒数，返回活跃度标签。"""
    if seconds < _FRESH_THRESHOLD:
        return "fresh"       # 刚刚有活动
    elif seconds < _STALE_THRESHOLD:
        return "recent"      # 近期有活动
    else:
        return "stale"       # 很久没动了


def load_index(engine_root):
    """读取工作区注册表 index.json"""
    index_path = os.path.join(engine_root, "runtime", "workspaces", "index.json")
    if not os.path.exists(index_path):
        return {"workspaces": {}, "active_workspace": None}
    try:
        with open(index_path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"workspaces": {}, "active_workspace": None}


def scan_all_workspaces(engine_root, index_data):
    """扫描引擎根目录下所有工作区，融合注册表信息"""
    workspaces_dir = os.path.join(engine_root, "runtime", "workspaces")
    if not os.path.isdir(workspaces_dir):
        return [], f"工作区目录不存在: {workspaces_dir}"

    state_files = glob.glob(os.path.join(workspaces_dir, "*/STATE.json"))
    if not state_files:
        return [], "没有找到任何 STATE.json"

    index_ws = index_data.get("workspaces", {})
    active_ws = index_data.get("active_workspace")

    results = []
    for sp in sorted(state_files):
        ws = scan_workspace(sp)
        ws_id = ws.get("workspace", "")

        # 融合注册表信息
        reg = index_ws.get(ws_id, {})
        ws["index_status"] = reg.get("status")         # active/stale/terminal
        ws["index_last_active"] = reg.get("last_active_at")
        ws["index_app"] = reg.get("app")
        ws["is_active_workspace"] = (ws_id == active_ws)

        results.append(ws)

    return results, None


# ── 主流程 ──────────────────────────────────────────────

def determine_real_status(state_running, machine_active, index_status=None,
                           terminal_state=None, seconds_since_update=None,
                           engine_error=None, state_waiting=False):
    """七层判定：综合账本、注册表、文件心跳、进程信号、错误信号，确定真实状态。

    Returns:
        str: error / running / waiting / likely_running / zombie / idle / terminal
    """
    # 第 0 层：引擎出错（最高优先级）
    if engine_error:
        return "error"

    # 第 0.5 层：终态
    if terminal_state:
        return "terminal"

    # 第 0.7 层：等待用户确认（manual 节点）
    if state_waiting:
        # 文件近期更新过 → 确实刚到达等待点
        if seconds_since_update is not None and seconds_since_update < _STALE_THRESHOLD:
            return "waiting"
        # 文件很久没更新了 → 可能是遗忘的确认点
        return "waiting_stale"

    # 第 1 层：账本说没在跑
    if not state_running:
        return "idle"

    # 账本说在跑。用文件心跳做工作区级判定
    # 第 2 层：文件心跳（工作区级独立信号）
    if seconds_since_update is not None:
        if seconds_since_update < _FRESH_THRESHOLD:
            # STATE.json 刚刚被更新过（60秒内）→ 引擎确实在操作这个工作区
            return "running"
        elif seconds_since_update < _STALE_THRESHOLD:
            # 5-10 分钟内更新过 → 可能在跑，但不确定
            # 结合进程检测辅助判断
            if machine_active:
                return "likely_running"
            else:
                return "likely_zombie"
        else:
            # 超过 10 分钟没更新 → 很可能已经停了
            return "zombie"

    # 无 mtime 数据时 fallback 到旧逻辑
    if index_status == "active" and machine_active:
        return "running"
    if machine_active:
        return "likely_running"
    return "zombie"


def main():
    engine_root = get_engine_root()
    output_path = get_output_path()

    print(f"引擎根目录: {engine_root}")
    print(f"输出路径:   {output_path}")
    print()

    # ── 第零层：注册表（index.json）
    index_data = load_index(engine_root)
    print(f"注册表:     {len(index_data.get('workspaces', {}))} 个工作区已注册")

    # ── 第一层：账本级（STATE.json）+ 融合注册表
    workspaces, error = scan_all_workspaces(engine_root, index_data)

    # ── 第二层：进程级（ps 检测）
    print("检测本机进程...")
    proc_result = process_detector.is_machine_active()
    machine_active = proc_result.get("active", False)
    proc_count = proc_result.get("active_count", 0)
    print(f"  活跃进程: {proc_count} 个")
    print()

    # ── 第三层：七层综合判定（含文件心跳 + 错误 + 等待）
    for w in workspaces:
        w["real_status"] = determine_real_status(
            w.get("state_says_running", False),
            machine_active,
            w.get("index_status"),
            w.get("terminal_state"),
            w.get("seconds_since_update"),
            w.get("engine_error"),
            w.get("state_says_waiting", False),
        )

    result = {
        "node": os.environ.get("NODE_NAME", os.uname().nodename),
        "engine_root": engine_root,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "process_detection": {
            "machine_active": machine_active,
            "ide_open": proc_result.get("ide_open", False),
            "active_process_count": proc_count,
            "scanned_at": proc_result.get("scanned_at"),
        },
        "summary": {
            "total_workspaces": len(workspaces),
            "error": sum(1 for w in workspaces if w.get("real_status") == "error"),
            "running": sum(1 for w in workspaces if w.get("real_status") == "running"),
            "waiting": sum(1 for w in workspaces if w.get("real_status") in ("waiting", "waiting_stale")),
            "likely_running": sum(1 for w in workspaces if w.get("real_status") == "likely_running"),
            "zombie": sum(1 for w in workspaces if w.get("real_status") in ("zombie", "likely_zombie")),
            "idle": sum(1 for w in workspaces if w.get("real_status") == "idle"),
            "terminal": sum(1 for w in workspaces if w.get("real_status") == "terminal"),
            "total_completed_steps": sum(w.get("completed_count", 0) for w in workspaces),
        },
        "workspaces": workspaces,
    }

    if error:
        result["error"] = error
        print(f"⚠ {error}")
        print()

    # 打印摘要
    s = result["summary"]
    print(f"工作区总数:     {s['total_workspaces']}")
    if s['error']:
        print(f"❗出错:         {s['error']}")
    print(f"真正在跑:       {s['running']}")
    if s['waiting']:
        print(f"等待确认:       {s['waiting']}")
    print(f"可能在跑:       {s['likely_running']}")
    print(f"僵尸状态:       {s['zombie']}")
    print(f"空闲:           {s['idle']}")
    print(f"已终止:         {s['terminal']}")
    print(f"已完成的步骤:   {s['total_completed_steps']}")
    print()

    status_icons = {
        "error": "❗",
        "running": "🔴",
        "waiting": "🟦",
        "waiting_stale": "🔷",
        "likely_running": "🟠",
        "zombie": "🟡",
        "likely_zombie": "🟡",
        "idle": "⚪",
        "terminal": "⚫",
    }
    status_labels = {
        "error": "出错",
        "running": "真正在跑",
        "waiting": "等待确认",
        "waiting_stale": "等待确认（疑似遗忘）",
        "likely_running": "可能在跑",
        "zombie": "僵尸",
        "likely_zombie": "可能僵尸",
        "idle": "空闲",
        "terminal": "已终止",
    }

    for w in workspaces:
        rs = w.get("real_status", "idle")
        icon = status_icons.get(rs, "?")
        label = status_labels.get(rs, "未知")
        ws_name = w.get("workspace", "?")
        done_count = w.get("completed_count", 0)
        secs = w.get("seconds_since_update")
        freshness = w.get("file_freshness", "?")

        if w.get("error") and rs != "error":
            # 解析错误但不是引擎错误状态
            print(f"  {icon} {ws_name}  ❌ {w['error']}")
            continue

        # 构造显示行
        time_info = f"  ({secs:.0f}s 前更新)" if secs is not None else ""

        if rs == "error":
            err = w.get("engine_error", "未知错误")
            print(f"  {icon} {ws_name}  {label}: {err}{time_info}  ({done_count}步完成)")
        elif rs in ("waiting", "waiting_stale"):
            wait_roles = ", ".join(a["role"] for a in w.get("awaiting_confirmation", []))
            verdicts = ", ".join(a.get("verdict", "?") for a in w.get("awaiting_confirmation", []))
            print(f"  {icon} {ws_name}  {label}: {wait_roles} (verdict={verdicts}){time_info}  ({done_count}步完成)")
        elif rs in ("running", "likely_running"):
            exec_roles = ", ".join(e["role"] for e in w.get("executing", []))
            print(f"  {icon} {ws_name}  {label}: {exec_roles}{time_info}  ({done_count}步完成)")
        elif rs in ("zombie", "likely_zombie"):
            exec_roles = ", ".join(e["role"] for e in w.get("executing", []))
            print(f"  {icon} {ws_name}  {label}{time_info}  原执行: {exec_roles}  ({done_count}步完成)")
        elif rs == "terminal":
            terminal = w.get("terminal_state")
            print(f"  {icon} {ws_name}  {label}: {terminal}  (共 {done_count} 步)")
        else:
            print(f"  {icon} {ws_name}  {label}{time_info}  ({done_count}步完成)")

    # 写入文件
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print()
    print(f"✓ 状态已写入 {output_path}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""fix.py — 扰动修复脚本（v4.2: rework 路径已删除，僵尸 executing 由 state_health_check.py Z1 接管）。
支持的操作：
  reset: 全量重置 STATE（清空所有进度，回到初始状态）
  jump:  跳转至指定步骤（标记前置步骤完成，清除目标及下游步骤）

Usage: python3 scripts/fix.py --type <reset|jump> [--step <STEP_N>] [--state-path <path>]
"""
import argparse, json, os, sys, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session_path import resolve_ws_state, resolve_app_path
from state_io import load_state, save_state

def output(data):
    print(json.dumps(data, ensure_ascii=False))
    sys.exit(0 if data.get("status") == "success" else 1)


def main():
    parser = argparse.ArgumentParser(description="扰动修复（v4.2: rework 已移除）")
    parser.add_argument("--type", required=True, choices=["reset", "jump"])
    parser.add_argument("--step", default=None, help="目标 STEP（jump 必填）")
    parser.add_argument("--state-path", default=None)
    parser.add_argument("--workspace-id", default=None, help="Session ID")
    args = parser.parse_args()
    # workspace-centric：state_path 从 ws_id 推导
    if not args.state_path:
        args.state_path = resolve_ws_state(args.workspace_id)
    app_path = resolve_app_path(args.workspace_id)

    # ── jump 特殊处理：标记前置步骤完成 + 缓存目标步骤 dispatch ──
    if args.type == "jump":
        if not args.step:
            output({"status": "failure", "error_code": "OIC-E104", "message": "jump 需要 --step 参数", "new_state_snapshot": None})
        state = _do_jump(args.state_path, app_path, args.workspace_id, args.step)
        output({"status": "success", "error_code": None, "new_state_snapshot": state, "message": f"jumped to {args.step}"})

    # ── reset：全量重置 ──
    cmd = ["python3", "engine/scripts/set_state.py", "--action", "reset", "--step", "ALL", "--state-path", args.state_path]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            output({"status": data.get("status", "failure"), "error_code": data.get("error_code"), "new_state_snapshot": data.get("new_state")})
        else:
            output({"status": "failure", "error_code": "OIC-E103", "message": f"set_state.py 退出码 {result.returncode}: {result.stderr}", "new_state_snapshot": None})
    except Exception as e:
        output({"status": "failure", "error_code": "OIC-E103", "message": f"set_state.py 调用异常: {e}", "new_state_snapshot": None})


def _do_jump(state_path, app_path, workspace_id, target_step):
    """jump 核心逻辑：
    1. 清理当前执行中的步骤
    2. 将目标步骤之前的所有步骤标记为已完成（finished）
    """
    import uuid
    from datetime import datetime, timezone

    def now_iso():
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # 读取 STATE.json
    if not os.path.exists(state_path):
        output({"status": "failure", "error_code": "OIC-E102", "message": "STATE.json 不存在", "new_state_snapshot": None})
    with open(state_path, "r", encoding="utf-8") as f:
        state = json.load(f)

    # 读取 ROUTER.json
    router_path = os.path.join(app_path, "ROUTER.json")
    registry_path = os.path.join(app_path, "registry.json")
    if not os.path.exists(router_path):
        output({"status": "failure", "error_code": "OIC-E104", "message": f"ROUTER.json 不存在: {router_path}", "new_state_snapshot": None})
    with open(router_path, "r", encoding="utf-8") as f:
        router_data = json.load(f)
    router_steps = router_data.get("steps", [])

    all_step_ids = [s["step"] for s in router_steps]
    if target_step not in all_step_ids:
        output({"status": "failure", "error_code": "OIC-E104", "message": f"--step {target_step} 不在路由表中，可用: {all_step_ids}", "new_state_snapshot": None})
    target_idx = all_step_ids.index(target_step)
    predecessor_steps = all_step_ids[:target_idx]

    # 1. 清理当前执行中的步骤
    ss = state.get("step_status", {})
    if ss:
        for k in list(ss.keys()):
            del ss[k]

    # 2. 前置步骤标记为已完成（v4.1: 写入 completed + pending_routes）
    completed = state.setdefault("completed", {})
    pending_routes = state.setdefault("pending_routes", {})
    for i, sid in enumerate(predecessor_steps):
        if sid not in completed:
            entry = {
                "id": f"ckpt_jump_{sid}_{uuid.uuid4().hex[:8]}",
                "created_at": now_iso(),
                "role": router_steps[i].get("role", ""),
                "jumped_over": True
            }
            completed[sid] = entry
            pending_routes[sid] = entry

    # 3. 清除目标步骤及其所有下游步骤的 completed + pending_routes（jump 回退语义）
    downstream_steps = all_step_ids[target_idx:]
    for sid in downstream_steps:
        completed.pop(sid, None)
        pending_routes.pop(sid, None)

    # 4. 清理 pending_dispatches（让 --next 走正常 router 路径）
    state["pending_dispatches"] = None

    # 5. 通过 state_io 统一写入
    save_state(state_path, state)

    print(f"[fix] jump to {target_step}: 跳过 {len(predecessor_steps)} 个前置步骤", file=sys.stderr)
    return state


if __name__ == "__main__":
    main()

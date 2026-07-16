#!/usr/bin/env python3
"""state_io.py — STATE.json 唯一读写入口（v5.2: state_txn 原子事务）。

所有对 STATE.json 的读写操作必须通过本模块完成。
禁止任何脚本自行实现 json.dump/os.replace/filelock 逻辑。

v5.2 新增：state_txn 上下文管理器 — STATE.json 写入的唯一规范机制。
  with state_txn(path) as st:          # 获取锁 + 读取
      st["key"] = value                # 修改
  # 退出时自动：写入 + 校验 + 释放锁

  机制保证：
  1. 锁的生命周期绑定到 with 块，无法遗漏释放
  2. 读和写在同一锁内，RMW 竞态在语法层面不可能发生
  3. with 块内异常 = 自动回滚（不写入，磁盘状态不变）
  4. 禁止在 with 块内调用引擎脚本（会死锁）

  历史 API 兼容：
  - load_state: 只读，不加锁
  - save_state: 仅写入（已加锁），向后兼容
  - modify_state_locked: 回调式 RMW（state_txn 的函数版）
"""
import json, os, tempfile, sys
from contextlib import contextmanager
from filelock import acquire_lock, release_lock

# v5.0: 不变量校验日志路径（与 state_health_check 共用引擎脚本目录）
_INV_LOG_ENABLED = True


def load_state(state_path):
    """安全读取 STATE.json，返回 dict。文件不存在或解析失败返回 None。"""
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_unlocked(state_path, state):
    """写入 STATE.json（tempfile + os.replace），不获取锁。

    调用者必须已持有 lock_path 文件锁。
    """
    d = os.path.dirname(state_path)
    if d:
        os.makedirs(d, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(suffix=".tmp", dir=d or ".")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, state_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _atomic_write(state_path, state):
    """原子写入（tempfile + os.replace）+ 文件锁保护。向后兼容封装。"""
    lock_path = state_path + ".lock"
    d = os.path.dirname(state_path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(lock_path, "w") as lock_file:
        if not acquire_lock(lock_file):
            raise RuntimeError("获取 STATE.json 文件锁失败")
        try:
            _write_unlocked(state_path, state)
        finally:
            release_lock(lock_file)


def _post_write_check_inplace(state_path, state):
    """v5.0: 写入后立即执行基础不变量校验 + 安全自动修复。
    v5.1: 使用 _write_unlocked（假设调用者已持有锁），消除二次锁获取竞态。

    策略：
    1. 运行 check_basic（INV-2, INV-3, INV-4, INV-9）
    2. auto_fixable 的违反 → 立即修正 → 重写 STATE.json
    3. 非 auto_fixable 的违反 → 记录日志（供 health_check 后续追踪）
    4. 校验本身崩溃 → 静默忽略（不阻塞主流程）
    """
    if not _INV_LOG_ENABLED:
        return

    try:
        from state_invariants import check_basic
        violations = check_basic(state)
        if not violations:
            return

        # 分离可修复和不可修复
        fixable = [v for v in violations if v.auto_fixable]
        unfixable = [v for v in violations if not v.auto_fixable]

        # 记录日志
        _log_violations(state_path, violations)

        # 安全自动修复
        if fixable:
            fixed_state = _apply_basic_fixes(state, fixable)
            if fixed_state is not None:
                _write_unlocked(state_path, fixed_state)
                _log_violations(state_path, [
                    type("V", (), {
                        "inv_id": "POST_FIX", "severity": "info",
                        "step": "", "message": f"自动修复 {len(fixable)} 条违反后重写 STATE.json",
                        "to_dict": lambda self: {}
                    })()
                ])

    except Exception:
        # 校验逻辑崩溃不影响主流程
        pass


def _apply_basic_fixes(state, violations):
    """对 auto_fixable 的基础违反执行修复。返回修复后的 state（深拷贝）。"""
    import copy
    s = copy.deepcopy(state)
    changed = False

    for v in violations:
        if v.fix_type == "clear_step_status_on_terminal":
            steps = v.fix_data.get("steps", [])
            ss = s.get("step_status", {})
            for step in steps:
                ss.pop(step, None)
            changed = True

        elif v.fix_type == "clear_dispatches_on_terminal":
            s["pending_dispatches"] = None
            changed = True

        elif v.fix_type == "clear_pending_routes_on_terminal":
            steps = v.fix_data.get("steps", [])
            pr = s.get("pending_routes", {})
            for step in steps:
                pr.pop(step, None)
            changed = True

        elif v.fix_type == "remove_stale_pending_route":
            step = v.fix_data.get("step", v.step)
            pr = s.get("pending_routes", {})
            pr.pop(step, None)
            changed = True

        elif v.fix_type == "clear_cached_branch_results":
            s["cached_branch_results"] = []
            changed = True

        elif v.fix_type == "remove_illegal_dispatch":
            idx = v.fix_data.get("index", -1)
            disp_list = s.get("pending_dispatches") or []
            if 0 <= idx < len(disp_list):
                disp_list.pop(idx)
                s["pending_dispatches"] = disp_list if disp_list else None
                changed = True

    return s if changed else None


def _log_violations(state_path, violations):
    """写入不变量校验日志。"""
    try:
        from datetime import datetime
        log_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "..", "runtime", "_invariant_check.log"
        )
        log_dir = os.path.dirname(log_path)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)

        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(log_path, "a", encoding="utf-8") as f:
            for v in violations:
                f.write(f"[{ts}] {state_path} [{v.inv_id}] {v.severity}: {v.message}\n")
    except Exception:
        pass


def save_state(state_path, state, validate=True):
    """★ STATE.json 唯一写入函数 ★ (v5.1: 持锁贯穿 写入→校验→修复)

    v5.1: 在单一文件锁内完成 写入→校验→修复，消除两次锁获取之间的竞态窗口。
    v5.0: 写入后立即执行 check_basic，自动修复安全违规，记录日志。

    Args:
        state_path: STATE.json 路径
        state: 要写入的 state dict
        validate: 是否执行写入后校验（init.py 创建初始空 STATE 时可传 False）
    """
    d = os.path.dirname(state_path)
    if d:
        os.makedirs(d, exist_ok=True)
    lock_path = state_path + ".lock"
    with open(lock_path, "w") as lock_file:
        if not acquire_lock(lock_file):
            raise RuntimeError("获取 STATE.json 文件锁失败")
        try:
            _write_unlocked(state_path, state)
            if validate and _INV_LOG_ENABLED:
                _post_write_check_inplace(state_path, state)
        finally:
            release_lock(lock_file)


@contextmanager
def state_txn(state_path, timeout=60):
    """★ STATE.json 原子事务 ★ (v5.2: RMW 竞态的机制级根治)

    在单一文件锁内完成 读取 → 修改 → 写入 → 校验。
    锁的生命周期绑定到 with 块，异常自动回滚（不写入）。

    用法：
        with state_txn(path) as st:       # 获取锁 + 读取最新 state
            st["key"] = value             # 直接修改 st
        # 正常退出 → 写入 + 校验
        # 异常退出 → 不写入（磁盘状态不变），释放锁

    约束：with 块内禁止调用引擎脚本（subprocess 会死锁等待同一把锁）。

    Args:
        state_path: STATE.json 路径
        timeout: 获取锁超时秒数

    Yields:
        state dict（可安全修改）
    """
    d = os.path.dirname(state_path)
    if d:
        os.makedirs(d, exist_ok=True)
    lock_path = state_path + ".lock"
    with open(lock_path, "w") as lock_file:
        if not acquire_lock(lock_file, timeout):
            raise RuntimeError("获取 STATE.json 文件锁失败")
        try:
            st = load_state(state_path)
            if st is None:
                st = {}
            yield st
            # 正常退出 with 块 → 原子写入 + 校验
            _write_unlocked(state_path, st)
            if _INV_LOG_ENABLED:
                _post_write_check_inplace(state_path, st)
        finally:
            # 异常路径：跳过 _write_unlocked，磁盘状态保持不变
            release_lock(lock_file)


def modify_state_locked(state_path, modifier_fn, timeout=60):
    """回调式原子 RMW（state_txn 的函数变体，用于不便用 with 的场景）。

    等价于：
        with state_txn(state_path, timeout) as st:
            modifier_fn(st)

    Args:
        state_path: STATE.json 路径
        modifier_fn: 接收当前 state dict，直接原地修改（无需返回值）
        timeout: 获取锁超时秒数

    Returns:
        修改后的 state dict
    """
    with state_txn(state_path, timeout) as st:
        modified = modifier_fn(st)
        if modified is not None and modified is not st:
            # 兼容旧约定：modifier_fn 返回新 dict（非原地修改）时替换
            st.clear()
            st.update(modified)
        return st

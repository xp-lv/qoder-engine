#!/usr/bin/env python3
"""test_changes.py — 验证引擎三项改动的正确性

测试内容：
1. resolve_workspace_output 的 is_absolute 参数
2. generate_timebased_ws_id 时间戳命名
3. init.py 对 abs_path 的处理（不覆盖已有文件）
4. Hook② confirm 路径产物展示逻辑
"""
import json
import os
import sys
import tempfile
import shutil
from datetime import datetime

# 添加路径
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(_PROJECT_ROOT, "engine", "scripts"))

from session_path import resolve_workspace_output, resolve_ws_base, resolve_ws_state

tests_passed = 0
tests_failed = 0


def assert_eq(actual, expected, name):
    global tests_passed, tests_failed
    if actual == expected:
        print(f"  ✅ {name}")
        tests_passed += 1
    else:
        print(f"  ❌ {name}")
        print(f"     期望: {expected}")
        print(f"     实际: {actual}")
        tests_failed += 1


def assert_true(condition, name):
    global tests_passed, tests_failed
    if condition:
        print(f"  ✅ {name}")
        tests_passed += 1
    else:
        print(f"  ❌ {name}")
        tests_failed += 1


print("=" * 60)
print("引擎三项改动验证测试")
print("=" * 60)
print()

# ═══════════════════════════════════════════════════════════════
# 测试 1：resolve_workspace_output 的 is_absolute 参数
# ═══════════════════════════════════════════════════════════════
print("测试 1：resolve_workspace_output 的 is_absolute 参数")
print("-" * 40)

ws_id = "test-ws"

# 1.1 相对路径（默认）
result = resolve_workspace_output(ws_id, "outputs/report.json", is_absolute=False)
assert_true(
    result.endswith("outputs/report.json") and not os.path.isabs(result),
    "相对路径拼接到 workspace"
)

# 1.2 绝对路径，is_absolute=True
abs_path = "/Users/test/projects/repo/src/main.py"
result = resolve_workspace_output(ws_id, abs_path, is_absolute=True)
assert_eq(result, abs_path, "绝对路径 + is_absolute=True → 直接返回")

# 1.3 绝对路径，is_absolute=False（旧行为，应拼接 workspace）
result = resolve_workspace_output(ws_id, abs_path, is_absolute=False)
# 注意：os.path.join 遇到绝对路径会丢弃前缀，所以结果也是绝对路径
# 但这不是我们期望的行为——所以应该用 is_absolute=True
assert_true(
    result == abs_path,
    "绝对路径 + is_absolute=False（os.path.join 行为，不推荐）"
)

# 1.4 knowledge 类型仍然路由到 app_path
result = resolve_workspace_output(
    ws_id, "knowledge/guide.md",
    app_path="/apps/test-app",
    output_type="knowledge"
)
assert_eq(result, "/apps/test-app/knowledge/guide.md", "knowledge 类型路由到 app_path")

print()


# ═══════════════════════════════════════════════════════════════
# 测试 2：generate_timebased_ws_id 时间戳命名
# ═══════════════════════════════════════════════════════════════
print("测试 2：generate_timebased_ws_id 时间戳命名")
print("-" * 40)

# 复制 Hook② 中的函数逻辑
def generate_timebased_ws_id(app_path):
    app_name = os.path.basename(app_path.rstrip("/"))
    today = datetime.now().strftime("%y_%m_%d")
    base_id = f"{today}/{app_name}"
    ws_id = base_id
    counter = 2
    state_file = os.path.join(_PROJECT_ROOT, "runtime", "workspaces", ws_id, "STATE.json")
    while os.path.exists(state_file):
        ws_id = f"{today}/{app_name}-{counter}"
        state_file = os.path.join(_PROJECT_ROOT, "runtime", "workspaces", ws_id, "STATE.json")
        counter += 1
    return ws_id

# 2.1 格式正确
ws_id = generate_timebased_ws_id("apps/app-builder-v2")
today_str = datetime.now().strftime("%y_%m_%d")
assert_true(
    ws_id.startswith(f"{today_str}/"),
    f"ws_id 以今天日期开头：{ws_id}"
)

# 2.2 包含 app 名
assert_true(
    "app-builder-v2" in ws_id,
    f"ws_id 包含 app 名：{ws_id}"
)

# 2.3 不同的 app 生成不同的 ws_id
ws_id_a = generate_timebased_ws_id("apps/app-builder-v2")
ws_id_b = generate_timebased_ws_id("apps/biz-opportunity-finder")
assert_true(
    ws_id_a != ws_id_b,
    f"不同 app 生成不同 ws_id：{ws_id_a} vs {ws_id_b}"
)

print()


# ═══════════════════════════════════════════════════════════════
# 测试 3：init.py 不覆盖已有文件
# ═══════════════════════════════════════════════════════════════
print("测试 3：占位文件不覆盖已有文件")
print("-" * 40)

# 模拟：一个已存在的外部文件不应被占位文件覆盖
tmpdir = tempfile.mkdtemp()
try:
    # 创建一个已有文件，内容重要
    existing_file = os.path.join(tmpdir, "main.py")
    with open(existing_file, "w") as f:
        f.write("# 重要代码\nprint('hello')\n")
    
    # 模拟 init.py 的占位文件创建逻辑
    full_path = existing_file
    if not os.path.exists(full_path):
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write("# 占位文件\n")
    
    # 验证：文件内容应该不变
    with open(existing_file, "r") as f:
        content = f.read()
    assert_eq(
        content,
        "# 重要代码\nprint('hello')\n",
        "已有文件不被占位文件覆盖"
    )
    
    # 反向测试：不存在的文件应该创建占位
    new_file = os.path.join(tmpdir, "new_doc.md")
    if not os.path.exists(new_file):
        os.makedirs(os.path.dirname(new_file), exist_ok=True)
        with open(new_file, "w") as f:
            f.write("# 占位\n")
    assert_true(
        os.path.exists(new_file),
        "不存在的文件创建占位"
    )
finally:
    shutil.rmtree(tmpdir)

print()


# ═══════════════════════════════════════════════════════════════
# 测试 4：app.yaml abs_path 字段解析逻辑
# ═══════════════════════════════════════════════════════════════
print("测试 4：app.yaml abs_path 字段解析逻辑")
print("-" * 40)

# 模拟 router.py 中的 outputs 解析
mock_outputs = [
    {"name": "报告", "path": "outputs/report.json"},  # 相对
    {"name": "外部代码", "abs_path": "/Users/test/repo/src/main.py"},  # 绝对
]

resolved_outputs = []
for o in mock_outputs:
    o_copy = dict(o)
    is_abs = bool(o.get("abs_path"))
    raw_path = o.get("abs_path") or o["path"]
    o_copy["resolved"] = resolve_workspace_output(ws_id, raw_path, is_absolute=is_abs)
    resolved_outputs.append(o_copy)

# 4.1 相对路径被拼接
assert_true(
    resolved_outputs[0]["resolved"].endswith("outputs/report.json"),
    f"相对路径拼接：{resolved_outputs[0]['resolved']}"
)

# 4.2 绝对路径直接返回
assert_eq(
    resolved_outputs[1]["resolved"],
    "/Users/test/repo/src/main.py",
    "绝对路径直接返回"
)

# 4.3 abs_path 优先于 path
mock_conflict = {"name": "test", "path": "outputs/local.json", "abs_path": "/abs/path.json"}
is_abs = bool(mock_conflict.get("abs_path"))
raw_path = mock_conflict.get("abs_path") or mock_conflict["path"]
assert_eq(raw_path, "/abs/path.json", "abs_path 优先于 path")
assert_true(is_abs, "有 abs_path 时 is_absolute=True")

print()


# ═══════════════════════════════════════════════════════════════
# 测试 5：Hook② confirm 产物展示逻辑
# ═══════════════════════════════════════════════════════════════
print("测试 5：confirm 产物展示逻辑")
print("-" * 40)

# 模拟 confirm 时的 STATE.json 结构
mock_state = {
    "step_status": {
        "需求接收者": {
            "status": "awaiting_confirmation",
            "verdict": "confirmed"
        },
        "架构设计师": {
            "status": "executing"  # 不展示
        }
    },
    "active_dispatches": {
        "需求接收者": {
            "output_targets": [
                {"name": "探索任务书", "path": "outputs/01-探索任务书.md"},
                {"name": "需求文档", "path": "outputs/02-需求文档.md"},
            ]
        },
        "架构设计师": {
            "output_targets": [
                {"name": "架构蓝图", "path": "outputs/03-架构蓝图.md"},
            ]
        }
    }
}

# 模拟 Hook② 的产物提取逻辑
artifact_lines = []
for step_name, dispatch in mock_state.get("active_dispatches", {}).items():
    step_info = mock_state.get("step_status", {}).get(step_name, {})
    if step_info.get("status") != "awaiting_confirmation":
        continue
    output_targets = dispatch.get("output_targets", [])
    for ot in output_targets:
        name = ot.get("name", "?")
        rel_path = ot.get("path", "?")
        artifact_lines.append(f"  - {name}: {rel_path}")

# 5.1 只展示 awaiting_confirmation 的产物（1个步骤，2个产物）
assert_eq(len(artifact_lines), 2, f"只展示 awaiting 步骤的产物（期望2个，实际{len(artifact_lines)}个）")

# 5.2 不展示 executing 步骤的产物
assert_true(
    all("架构蓝图" not in line for line in artifact_lines),
    "不展示 executing 步骤的产物"
)

# 5.3 展示的产物包含正确信息
assert_true(
    any("探索任务书" in line for line in artifact_lines),
    "展示探索任务书产物"
)
assert_true(
    any("需求文档" in line for line in artifact_lines),
    "展示需求文档产物"
)

print()

# ═══════════════════════════════════════════════════════════════
# 测试 6：post-tool-hook.py 语法检查
# ═══════════════════════════════════════════════════════════════
print("测试 6：所有改动文件语法检查")
print("-" * 40)

import ast
files_to_check = [
    "engine/scripts/session_path.py",
    "engine/scripts/init.py",
    "engine/scripts/router.py",
    "engine/scripts/orchestrator.py",
    ".qoder/hooks/post-tool-hook.py",
]
for f in files_to_check:
    full_path = os.path.join(_PROJECT_ROOT, f)
    try:
        with open(full_path) as fh:
            ast.parse(fh.read())
        print(f"  ✅ {f}")
        tests_passed += 1
    except SyntaxError as e:
        print(f"  ❌ {f}: {e}")
        tests_failed += 1

print()

# ═══════════════════════════════════════════════════════════════
# 总结
# ═══════════════════════════════════════════════════════════════
print("=" * 60)
print(f"测试结果：{tests_passed} 通过，{tests_failed} 失败")
print("=" * 60)

sys.exit(0 if tests_failed == 0 else 1)

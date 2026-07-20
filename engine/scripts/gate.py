#!/usr/bin/env python3
"""Gate — 产出物格式异常隔离层。

唯一职责：检查产出物是否存在、是否有内容、是否符合格式契约。
不关心产出物的语义内容（verdict 值由 orchestrator 自己读）。

所有产出物走三层逻辑：
1. 物理检查（统一，不区分产物类型）
2. 二进制文件短路（扩展名匹配 → 仅物理检查即 PASS）
3. 文本解析（JSON 直接校验，非 JSON 包装为 {"_raw_text": ...} 后校验）

Usage: python3 engine/scripts/gate.py --step <STEP> --output-path <path> --app-path <path> [--workspace-id <id>]
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session_path import resolve_ws_state, resolve_app_path


def output(data):
    print(json.dumps(data, ensure_ascii=False))
    sys.exit(0)


def fail(message):
    output({"verdict": "FAIL", "errors": [message]})


def get_nested(data, path):
    """按点分隔路径读取嵌套字段。"""
    val = data
    for k in path.split("."):
        if isinstance(val, dict):
            val = val.get(k)
        else:
            return None
    return val


def validate_schema(data, schema):
    """统一的 Schema 校验（v8.0：简化为二件套 required + enum）。
    返回 errors 列表（空 = 通过）。

    v8.0 变更：删除 minLength / items / additionalProperties 校验。
    原因：这三个字段从未被 compiler.py 自动生成，属于文档定义但无代码消费的“僵尸约束”。
    保留 required（必填字段）+ enum（枚举值校验）两件真有消费者的约束。
    """
    errors = []

    # required 字段
    for field in schema.get("required", []):
        if field not in data:
            errors.append(f"缺少必填字段: {field}")

    # properties 类型校验
    for prop, rules in schema.get("properties", {}).items():
        val = get_nested(data, prop)
        if val is None:
            continue

        expected_type = rules.get("type")
        type_map = {
            "string": lambda v: isinstance(v, str),
            "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
            "boolean": lambda v: isinstance(v, bool),
            "float": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
            "array": lambda v: isinstance(v, list),
            "object": lambda v: isinstance(v, dict),
        }
        if expected_type and expected_type in type_map:
            if not type_map[expected_type](val):
                errors.append(f"字段 {prop} 应为 {expected_type}")

    # enum 校验（与类型校验分离，独立循环以支持嵌套路径如 result.verdict）
    for prop, rules in schema.get("properties", {}).items():
        val = get_nested(data, prop)
        if val is not None and "enum" in rules:
            if val not in rules["enum"]:
                errors.append(f"字段 {prop} 值 '{val}' 不在允许范围 {rules['enum']} 中")

    # 禁止模式
    for pattern in schema.get("_forbidden_patterns", []):
        content = json.dumps(data, ensure_ascii=False)
        if pattern in content:
            errors.append(f"包含禁止内容: {pattern}")

    return errors


def validate_deliverable_contract(file_path, raw_content, contract):
    """P1 (v8.2): 对 deliverable 产出物做深度校验。

    contract 是 schema.json._required_files[].contract 中的手写声明，支持：
      - min_lines: 文件行数 ≥ N
      - required_headings: 每个 heading 必须在文档中出现（grep 语义）
      - req_coverage: 每个 REQ-ID 必须在文档中出现
      - forbidden_patterns: 文档不得包含的字符串

    返回 errors 列表（空 = 通过）。
    """
    errors = []

    # min_lines: 行数校验
    min_lines = contract.get("min_lines")
    if min_lines and isinstance(min_lines, int):
        line_count = raw_content.count("\n") + 1
        if line_count < min_lines:
            errors.append(f"行数不足: {line_count} < min_lines={min_lines}")

    # required_headings: 标题/关键字必须出现
    for heading in contract.get("required_headings", []):
        if heading not in raw_content:
            errors.append(f"缺少必需标题/关键字: {heading}")

    # req_coverage: REQ-ID 覆盖校验
    missing_reqs = [req for req in contract.get("req_coverage", []) if req not in raw_content]
    if missing_reqs:
        errors.append(f"REQ-ID 未覆盖: {missing_reqs}")

    # forbidden_patterns: 禁止内容
    for pattern in contract.get("forbidden_patterns", []):
        if pattern in raw_content:
            errors.append(f"包含禁止内容: {pattern}")

    return errors


def main():
    parser = argparse.ArgumentParser(description="Gate 产出物校验")
    parser.add_argument("--step", required=True)
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--state-path", default=None)
    parser.add_argument("--app-path", default=None)
    parser.add_argument("--workspace-id", default=None)
    args = parser.parse_args()

    app_path = args.app_path or resolve_app_path(args.workspace_id)
    state_path = args.state_path or resolve_ws_state(args.workspace_id)

    # ── 1. 物理检查（统一，不区分产物类型）──
    if not os.path.exists(args.output_path):
        fail(f"产出物文件不存在: {args.output_path}")

    # 目录类型产出物（producer 代码目录等）：检查存在且非空即 PASS
    if os.path.isdir(args.output_path):
        dir_contents = os.listdir(args.output_path)
        if not dir_contents:
            fail(f"产出物目录为空: {args.output_path}")
        output({"verdict": "PASS", "errors": []})

    if os.path.getsize(args.output_path) == 0:
        fail(f"产出物文件为空: {args.output_path}")

    # ── 2. 二进制文件短路：物理检查通过即 PASS ──
    # 二进制产出物（截图、图标、字体等）无法以 UTF-8 文本解析，
    # 也不需要 schema 校验。物理检查（存在+非空）已足够。
    BINARY_EXTENSIONS = {
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
        '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip', '.tar', '.gz',
    }
    _, ext = os.path.splitext(args.output_path)
    if ext.lower() in BINARY_EXTENSIONS:
        output({"verdict": "PASS", "errors": []})

    # ── 3. 统一解析：JSON 直接用，非 JSON 包装 ──
    # 对文本文件先以二进制读取，再解码为 UTF-8，避免解码异常导致脚本崩溃
    with open(args.output_path, "rb") as bf:
        raw_bytes = bf.read()
    try:
        raw = raw_bytes.decode("utf-8")
    except (UnicodeDecodeError, ValueError):
        # 无法解码为 UTF-8 的非二进制扩展名文件 → 物理检查通过即 PASS
        output({"verdict": "PASS", "errors": []})
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        data = {"_raw_text": raw}

    # ── 4. 查找角色的 schema ──
    router_path = os.path.join(app_path, "ROUTER.json")
    reg_path = os.path.join(app_path, "registry.json")
    if not os.path.exists(router_path) or not os.path.exists(reg_path):
        # 无配置文件 → 只做物理检查（已有内容即 PASS）
        output({"verdict": "PASS", "errors": []})

    with open(router_path, "r", encoding="utf-8") as f:
        router = json.load(f)
    with open(reg_path, "r", encoding="utf-8") as f:
        registry = json.load(f)

    step_entry = next((s for s in router.get("steps", []) if s["step"] == args.step), None)
    if not step_entry:
        fail(f"STEP {args.step} 不在 ROUTER.json 中")

    role_name = step_entry["role"]
    role_record = next((r for r in registry if r.get("role_name") == role_name), None)
    if not role_record:
        fail(f"角色 {role_name} 不在 registry.json 中")

    # ── 5. Schema 校验（从 roles 目录加载）──
    role_dir_name = step_entry.get("role", "")
    # slugify 角色名查找 schema
    import re
    schema_dir = re.sub(r'[^\w\u4e00-\u9fff]', '_', role_dir_name)
    schema_file = os.path.join(app_path, "roles", schema_dir, "schema.json")

    errors = []

    # P1 (v8.2): 先加载 schema 并查找当前 output_path 的 type + contract
    # 这样 markdown/JSON 都能走到 contract 校验（避免 is_non_json 分支跳过 contract）
    output_type = "deliverable"
    rf_contract = None
    schema = None
    if os.path.exists(schema_file):
        try:
            with open(schema_file, "r", encoding="utf-8") as f:
                schema = json.load(f)
            norm_output = args.output_path.replace("\\", "/").rstrip("/")
            for rf in schema.get("_required_files", []):
                rf_path = rf.get("path", "").replace("\\", "/").rstrip("/")
                if rf_path and (norm_output.endswith(rf_path) or rf_path.endswith(norm_output)):
                    output_type = rf.get("type", "deliverable")
                    rf_contract = rf.get("contract")
                    break
        except Exception as e:
            errors.append(f"schema 加载失败: {e}")

    # 非 JSON 产出物：物理检查 + contract 校验（跳过 result schema）
    is_non_json = ("_raw_text" in data)

    if is_non_json:
        # 非 JSON：跳过 result schema，但若有 contract 则做深度校验
        if rf_contract:
            errors.extend(validate_deliverable_contract(args.output_path, raw, rf_contract))
    elif schema is not None:
        # JSON：做 schema 校验
        try:
            # 按 type 分发：process 跳过 result schema，deliverable 完整校验
            if output_type == "process":
                # process 类型：最小校验（物理检查已通过 + JSON 可解析已成功），跳过 result schema
                # result 契约是角色整体响应包契约，由 Hook② 在协议层校验，Gate 不重复
                pass
            else:
                # deliverable 类型：走完整的 schema 校验
                # 上下文感知 verdict enum 替换：
                # 若 ROUTER.json 中该 step 有 verdict_context 且 STATE.json 中记录了 from_steps，
                # 则用过滤后的 enum 替换 schema 中的全量 enum
                step_verdict_context = step_entry.get("verdict_context")
                if step_verdict_context:
                    try:
                        with open(state_path, "r", encoding="utf-8") as sf:
                            state_data = json.load(sf)
                        step_ss = state_data.get("step_status", {}).get(args.step, {})
                        dispatch_from = step_ss.get("from_steps", [])
                        for fs in dispatch_from:
                            if fs in step_verdict_context:
                                filtered = step_verdict_context[fs]
                                try:
                                    schema["properties"]["result"]["properties"]["verdict"]["enum"] = filtered
                                except (KeyError, TypeError):
                                    pass
                                break
                    except (json.JSONDecodeError, ValueError, IOError):
                        pass

                errors = validate_schema(data, schema)

                # P1: 若有手写 contract，补加 deliverable 深度校验
                if rf_contract:
                    errors.extend(validate_deliverable_contract(args.output_path, raw, rf_contract))
        except Exception as e:
            errors.append(f"schema 处理异常: {e}")
    else:
        # JSON 但无 schema → 物理检查通过即 PASS
        pass

    # ── 6. 返回 ──
    if errors:
        result = {"verdict": "FAIL", "errors": errors}
    else:
        result = {"verdict": "PASS", "errors": []}

    # 写 gate-result.json 到 workspace
    ws_base = None
    if args.workspace_id:
        from session_path import resolve_ws_base
        ws_base = resolve_ws_base(args.workspace_id)
    elif state_path:
        ws_base = os.path.dirname(state_path)
    if ws_base:
        ws_root = ws_base
        wr_file = os.path.join(ws_base, "WORKSPACE_ROOT")
        if os.path.exists(wr_file):
            with open(wr_file, "r") as f:
                ws_root = f.read().strip()
        result_file = os.path.join(ws_root, "outputs", f"{args.step}-gate-result.json")
        os.makedirs(os.path.dirname(result_file), exist_ok=True)
        with open(result_file, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

    output(result)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""compiler.py — 声明式编排编译器 v2.0

两种模式：
  1. 编译模式（默认）：读 app.yaml → 生成 ROUTER.json + registry.json + manifest.json + 骨架
  2. 检查模式（--check）：读已生成的 ROUTER.json → 静态分析

用法：
  python3 engine/scripts/compiler.py --app-path apps/xxx          # 编译
  python3 engine/scripts/compiler.py --app-path apps/xxx --check  # 检查
"""
import argparse, json, os, sys, re
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine_common import load_json_safe

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def slugify(name):
    return re.sub(r'[^\w\u4e00-\u9fff]', '_', name)

def parse_edges_line(line):
    """解析 edges 段的一行。
    支持格式：
      A → B                          无条件边
      A → [B, C]                     无条件并行（扇出）
      [A, B, C] → D                  同步汇入（扇入，需全完成）
      A → B when: result.verdict == "pass"    when 条件表达式
      A → [B, C] when: result.verdict == "fail"  条件并行
      [A, B, C] → D when: result.verdict == "xxx"  条件同步汇入
      A → B when: result.verdict == "fail" max_executions: 5  带执行上限
    """
    line = line.strip()
    if not line or line.startswith('#'):
        return None
    # 去除 YAML 列表标记 -
    if line.startswith('- '):
        line = line[2:].strip()

    # 提取 max_executions（如果有）
    max_exec = None
    mx_match = re.search(r'\s+max_executions:\s*(\d+)', line)
    if mx_match:
        max_exec = int(mx_match.group(1))
        line = line[:mx_match.start()].strip()

    # 提取 when 条件（如果有）
    when_expr = None
    when_match = re.search(r'\s+when:\s*(.+)$', line)
    if when_match:
        when_expr = when_match.group(1).strip()
        line = line[:when_match.start()].strip()

    # 匹配 from[.verdict] → to
    m = re.match(r'^(.+?)(?:\.(\w+))?\s*→\s*(.+)$', line)
    if not m:
        return None
    src_str = m.group(1).strip()
    verdict = m.group(2)  # 旧格式点语法
    tgt_str = m.group(3).strip()

    # 解析源：单个角色 或 [A, B, C] 同步汇入
    sync_join = False
    if src_str.startswith('['):
        sources = [s.strip().strip('"\'') for s in src_str.strip('[]').split(',')]
        sync_join = True
    else:
        sources = [src_str.strip('"\'')]

    # 解析目标
    if tgt_str.startswith('['):
        targets = [t.strip().strip('"\'') for t in tgt_str.strip('[]').split(',')]
    else:
        targets = [tgt_str.strip('"\'')]

    # 如果有 when 表达式，从中提取 verdict 值
    if when_expr:
        # 解析 when: field == "value"
        wv = re.match(r'([\w.]+)\s*==\s*["\']([\w]+)["\']', when_expr)
        if wv:
            verdict = wv.group(2)  # 提取 verdict 值作为 transition key

    return {"src": sources, "verdict": verdict, "targets": targets, "when": when_expr, "sync_join": sync_join, "max_executions": max_exec}

def _check_role_names(roles, errors):
    FORBIDDEN_CHARS = set('→,:/[]')
    for name in set(roles.keys()):
        bad = [c for c in FORBIDDEN_CHARS if c in name]
        if bad:
            errors.append(f"角色名 '{name}' 包含非法字符: {' '.join(bad)}（不允许 →,:/[] 等）")


def _check_role_fields(roles, warnings):
    VALID_ROLE_FIELDS = {'confirm', 'inputs', 'outputs', 'fail_max_executions'}
    for name, data in roles.items():
        if isinstance(data, dict):
            for field in data:
                if field.startswith('_'):
                    continue
                if field not in VALID_ROLE_FIELDS:
                    warnings.append(f"角色 '{name}': 未知字段 '{field}'（合法字段: {sorted(VALID_ROLE_FIELDS)}）")


def _check_paths(roles, errors):
    for name, data in roles.items():
        if not isinstance(data, dict):
            continue
        for key in ('inputs', 'outputs'):
            for item in data.get(key, []):
                path = item.get('path', '')
                abs_path = item.get('abs_path', '')
                item_name = item.get('name', '')
                if key == 'outputs' and not path and not abs_path:
                    errors.append(f"角色 '{name}': outputs 项 '{item_name}' 路径为空（需提供 path 或 abs_path）")
                check_path = abs_path or path
                if '..' in check_path:
                    errors.append(f"角色 '{name}': {key} 项 '{item_name}' 路径含 '..'（不允许路径穿越）")


def _check_edge_refs(edges, role_names, errors):
    for e in edges:
        srcs = e["src"] if isinstance(e["src"], list) else [e["src"]]
        for src in srcs:
            if src not in role_names:
                errors.append(f"edges: 角色 '{src}' 不存在（可用角色: {sorted(role_names)}）")
        for t in e["targets"]:
            if t != "完成" and t not in role_names:
                errors.append(f"edges: {srcs} → 目标 '{t}' 不存在")


def _check_out_edges(role_names, edges, errors):
    for r in role_names:
        has_outgoing = any(r in (e["src"] if isinstance(e["src"], list) else [e["src"]]) for e in edges)
        if not has_outgoing and len(role_names) > 1:
            errors.append(f"角色 '{r}' 没有任何出去的边")


def _check_complete_edges(edges, errors):
    has_complete = any("完成" in e["targets"] for e in edges)
    if not has_complete:
        errors.append("没有任何边指向'完成'——工作流永远无法结束")


def _check_verdict_keywords(edges, warnings):
    for e in edges:
        verdict = e.get("verdict")
        if verdict and verdict == "fail":
            warnings.append(f"edges: verdict='fail' 是系统保留词，编译器不会将其写入角色 schema enum。来源: {e['src']} → {e['targets']}")


def _check_max_executions(roles, edges, errors):
    for e in edges:
        mx = e.get("max_executions")
        if mx is not None and (not isinstance(mx, int) or mx <= 0):
            errors.append(f"edges: max_executions={mx} 不是正整数。来源: {e['src']} → {e['targets']}")
    for name, data in roles.items():
        if isinstance(data, dict) and 'fail_max_executions' in data:
            fmx = data['fail_max_executions']
            if not isinstance(fmx, int) or fmx <= 0:
                errors.append(f"角色 '{name}': fail_max_executions={fmx} 不是正整数")


def validate_app_yaml(roles, edges):
    """编译期校验 app.yaml 的语法和完整性。返回错误列表（空=通过）。"""
    errors = []
    warnings = []
    role_names = set(roles.keys())

    _check_role_names(roles, errors)
    _check_role_fields(roles, warnings)
    _check_paths(roles, errors)
    _check_edge_refs(edges, role_names, errors)
    _check_out_edges(role_names, edges, errors)
    _check_complete_edges(edges, errors)
    _check_verdict_keywords(edges, warnings)
    _check_max_executions(roles, edges, errors)

    for w in warnings:
        print(f"  ⚠️  {w}")

    return errors


def _calc_input_groups(edges_lines):
    """计算 input_groups（目标视角：每个 role 的前置依赖组）。"""
    role_input_groups = {}
    for e in edges_lines:
        if not e.get("targets"):
            continue
        for tgt in e["targets"]:
            if tgt == "完成":
                continue
            if e.get("sync_join") and isinstance(e["src"], list) and len(e["src"]) > 1:
                role_input_groups.setdefault(tgt, []).append(list(e["src"]))
            else:
                srcs = e["src"] if isinstance(e["src"], list) else [e["src"]]
                for src in srcs:
                    role_input_groups.setdefault(tgt, []).append([src])
    return role_input_groups


def _expand_sync_joins(edges_lines):
    """同步汇入展开：[A,B,C] → D 展开为多条独立边。"""
    expanded_edges = []
    for e in edges_lines:
        if e.get("sync_join") and len(e["src"]) > 1:
            for src in e["src"]:
                expanded = dict(e)
                expanded["src"] = src
                expanded["sync_join"] = False
                expanded_edges.append(expanded)
        else:
            expanded = dict(e)
            if isinstance(e["src"], list):
                expanded["src"] = e["src"][0]
            expanded["sync_join"] = False
            expanded_edges.append(expanded)
    return expanded_edges


def _topo_sort(role_names, edges_lines):
    """拓扑排序：按 DAG 依赖顺序排列角色。"""
    incoming = {r: 0 for r in role_names}
    adj = {r: [] for r in role_names}
    for e in edges_lines:
        src = e["src"]
        if src in role_names:
            for t in e["targets"]:
                if t != "完成" and t in incoming:
                    adj[src].append(t)
                    incoming[t] += 1
    queue = deque([r for r in role_names if incoming[r] == 0])
    role_order = []
    visited = set()
    while queue:
        r = queue.popleft()
        if r in visited:
            continue
        visited.add(r)
        role_order.append(r)
        for nxt in adj.get(r, []):
            incoming[nxt] -= 1
            if incoming[nxt] <= 0:
                queue.append(nxt)
    for r in role_names:
        if r not in visited:
            role_order.append(r)
    return role_order


def _aggregate_verdict_context(router_steps):
    """从边级 restrict_verdict 聚合出 per-step 的 verdict_context + 闭环校验。"""
    incoming_restrict = {}
    for s in router_steps:
        for vkey, tval in s.get("transitions", {}).items():
            if not isinstance(tval, dict):
                continue
            rv = tval.get("restrict_verdict")
            if rv:
                for t in tval.get("targets", []):
                    existing = incoming_restrict.setdefault(t, {}).setdefault(s["step"], [])
                    for v in rv:
                        if v not in existing:
                            existing.append(v)
    steps_map_for_vc = {s["step"]: s for s in router_steps}
    for s in router_steps:
        step_id = s["step"]
        restrictions = incoming_restrict.get(step_id)
        if not restrictions:
            continue
        outgoing_verdicts = set(s.get("transitions", {}).keys()) - {"fail"}
        for src, verdicts in restrictions.items():
            for v in verdicts:
                if v not in outgoing_verdicts:
                    print(f"\n❌ 编译失败：边 {src}→{step_id} 的 restrict_verdict '{v}' 不在 {step_id} 的出边中")
                    print(f"   {step_id} 的合法出边 verdict: {sorted(outgoing_verdicts)}")
                    sys.exit(1)
                out_edge = s["transitions"].get(v, {})
                if isinstance(out_edge, dict):
                    out_targets = out_edge.get("targets", [])
                    for ot in out_targets:
                        if ot not in steps_map_for_vc:
                            print(f"\n❌ 编译失败：{step_id} 的 verdict '{v}' 出边 target '{ot}' 不在 ROUTER steps 中（死链）")
                            sys.exit(1)
        all_context_verdicts = set()
        for verdicts in restrictions.values():
            all_context_verdicts.update(verdicts)
        uncovered = outgoing_verdicts - all_context_verdicts
        if uncovered:
            print(f"[compiler] WARNING: '{step_id}' 出边 verdict {sorted(uncovered)} 未被任何入边的 restrict_verdict 覆盖")
        s["verdict_context"] = restrictions
    for s in router_steps:
        for vkey in list(s.get("transitions", {}).keys()):
            if isinstance(s["transitions"][vkey], dict):
                s["transitions"][vkey].pop("restrict_verdict", None)


def _generate_role_skeletons(app_path, role_order, roles, app_knowledge):
    """生成角色骨架文件（skill.md、schema.json）和 knowledge 骨架。"""
    for r in role_order:
        role_data = roles[r]
        role_dir = slugify(r)
        role_full = os.path.join(app_path, "roles", role_dir)
        os.makedirs(role_full, exist_ok=True)
        skill_f = os.path.join(role_full, "skill.md")
        if not os.path.exists(skill_f):
            with open(skill_f, "w", encoding="utf-8") as f:
                f.write(f"# {r} 执行指令\n\n## 执行步骤\n1. （待填充）\n\n## 产出物\n（待填充）\n")
        schema_f = os.path.join(role_full, "schema.json")
        schema = {"$schema": "http://json-schema.org/draft-07/schema#", "type": "object", "properties": {}, "required": []}
        outputs = role_data.get("outputs", [])
        if outputs:
            existing_rf_map = {}
            if os.path.exists(schema_f):
                try:
                    with open(schema_f, "r", encoding="utf-8") as ef:
                        existing_schema = json.load(ef)
                    for erf in existing_schema.get("_required_files", []):
                        ename = erf.get("name", "")
                        if ename:
                            existing_rf_map[ename] = erf
                except (json.JSONDecodeError, IOError):
                    pass
            schema["_required_files"] = []
            for o in outputs:
                name = o.get("name", "")
                rf_entry = {"name": name, "path": o.get("path", "")}
                existing = existing_rf_map.get(name, {})
                if "contract" in existing:
                    rf_entry["contract"] = existing["contract"]
                schema["_required_files"].append(rf_entry)
        with open(schema_f, "w", encoding="utf-8") as f:
            json.dump(schema, f, ensure_ascii=False, indent=2)
    print(f"[compiler] 骨架文件已生成（{len(role_order)} 个角色）")
    if app_knowledge:
        for kp in app_knowledge:
            kp_path = os.path.join(app_path, kp["path"])
            if not os.path.exists(kp_path):
                os.makedirs(os.path.dirname(kp_path), exist_ok=True)
                with open(kp_path, "w", encoding="utf-8") as f:
                    f.write(f"# {kp['name']}\n\n（待填充）\n")
        print(f"[compiler] knowledge 骨架: {len(app_knowledge)} 个文件")


def _parse_app_yaml(content, app_path):
    """解析 app.yaml 内容，返回 (app_name, roles, edges_lines, app_knowledge)。

    遇到废弃字段或语法错误时打印错误并 sys.exit。
    """
    # 简易 YAML 解析（不依赖 PyYAML）
    app_name = os.path.basename(app_path)
    roles = {}
    edges_lines = []
    app_knowledge = []  # app 级公共知识文档 [{name, path, type}]
    section = None
    current_role = None
    current_list_key = None
    deprecated_errors = []
    errors = []

    DEPRECATED_FIELDS = {
        'verdicts': '条件路由值只写在边的 when: 表达式中',
        'loop': '循环上限只写在边的 max_executions 中',
        'gate': 'Gate 只有 PASS/FAIL 二元结果，无需声明',
    }

    for line in content.split('\n'):
        stripped = line.strip()
        if stripped.startswith('#') or not stripped:
            continue

        # 顶级 key
        if not line.startswith(' ') and ':' in stripped:
            key = stripped.split(':')[0].strip()
            if key == 'app_name':
                app_name = stripped.split(':', 1)[1].strip()
                section = None
            elif key == 'knowledge':
                section = 'knowledge'
            elif key == 'roles':
                section = 'roles'
            elif key == 'edges':
                section = 'edges'
            continue

        if section == 'knowledge':
            # app 级公共知识：- 名称: 路径（与 inputs 同构，文件存于 app 公共区域）
            if stripped.startswith('- '):
                item_str = stripped[2:].strip()
                if ':' in item_str:
                    nm = item_str.split(':', 1)[0].strip().strip("\"'")
                    pt = item_str.split(':', 1)[1].strip().strip("\"'")
                    app_knowledge.append({"name": nm, "path": pt, "type": "knowledge", "inject_to": None})
            elif stripped.startswith('inject_to:'):
                # 支持 inject_to: [角色A, 角色B] 选择性注入
                val = stripped.split(':', 1)[1].strip()
                if val.startswith('['):
                    roles_list = [t.strip().strip("\"'") for t in val.strip('[]').split(',') if t.strip()]
                    if app_knowledge:
                        app_knowledge[-1]["inject_to"] = roles_list
            continue

        if section == 'edges':
            # 检测 restrict_verdict 子行（缩进在边定义下方）
            rv_match = re.match(r'restrict_verdict:\s*\[([^\]]*)\]', stripped)
            if rv_match and edges_lines:
                rv_list = [v.strip().strip("\"'") for v in rv_match.group(1).split(',') if v.strip()]
                edges_lines[-1]['restrict_verdict'] = rv_list
                continue
            # 检测 carries 子行（v8.4：边级显式物料声明，与 restrict_verdict 同模式）
            # 支持单行数组：carries: [a.json, b.json]
            # 多行列表写法暂不支持（与 restrict_verdict 保持一致）
            cv_match = re.match(r'carries:\s*\[([^\]]*)\]', stripped)
            if cv_match and edges_lines:
                cv_list = [v.strip().strip("\"'") for v in cv_match.group(1).split(',') if v.strip()]
                edges_lines[-1]['carries'] = cv_list
                continue
            # 检测 max_executions 子行（v8.0 修复 P0-4：YAML 格式中 max_executions 可单独成行）
            # 例：
            #   - A → B when: result.verdict == "xxx"
            #     max_executions: 2
            mx_sub_match = re.match(r'max_executions:\s*(\d+)', stripped)
            if mx_sub_match and edges_lines:
                edges_lines[-1]['max_executions'] = int(mx_sub_match.group(1))
                continue
            parsed = parse_edges_line(stripped)
            if parsed:
                edges_lines.append(parsed)
            continue

        if section == 'roles':
            # 角色名（缩进 2 空格，以 : 结尾）
            if line.startswith('  ') and not line.startswith('    ') and stripped.endswith(':'):
                current_role = stripped[:-1].strip()
                roles[current_role] = {}
                current_list_key = None
            elif current_role and line.startswith('    '):
                # 判断是 key: value 还是 key: （后跟列表项）
                if ':' in stripped and not stripped.startswith('- '):
                    k = stripped.split(':', 1)[0].strip()
                    v = stripped.split(':', 1)[1].strip()
                    # 多行 dict 格式子属性: name/path/abs_path 续写
                    if current_list_key and k in ('name', 'path', 'abs_path') and roles[current_role].get(current_list_key):
                        roles[current_role][current_list_key][-1][k] = v.strip().strip("\"'")
                        continue
                    if k == 'type':
                        # 向后兼容：静默忽略原 type 字段（producer/standard 已删除）
                        current_list_key = None
                    elif k == 'confirm':
                        roles[current_role][k] = v
                        current_list_key = None
                    elif k == 'fail_max_executions':
                        # P2: Gate FAIL 边重试上限（角色级覆盖全局默认 3）
                        try:
                            roles[current_role][k] = int(v)
                        except ValueError:
                            errors.append(f"角色 '{current_role}': fail_max_executions='{v}' 不是整数")
                        current_list_key = None
                    elif k in ('outputs', 'inputs'):
                        roles[current_role].setdefault(k, [])
                        current_list_key = k
                    elif k in DEPRECATED_FIELDS:
                        deprecated_errors.append(f"角色 '{current_role}': 字段 '{k}' 已废弃——{DEPRECATED_FIELDS[k]}，请从角色定义中删除")
                elif stripped.startswith('- '):
                    # 列表项: - 名称: 路径 或 - name: 名称\n  path: 路径\n  type: process
                    item_str = stripped[2:].strip()
                    if current_list_key and ':' in item_str:
                        nm = item_str.split(':', 1)[0].strip().strip("\"'")
                        rest = item_str.split(':', 1)[1].strip().strip("\'")
                        # 多行 dict 格式: - name: xxx（后续行提供 path/abs_path）
                        if nm == 'name':
                            roles[current_role][current_list_key].append({"name": rest.strip().strip("\"'")})
                        # 简单格式: - 名称: 路径
                        elif ',' in rest:
                            pt = rest.split(',', 1)[0].strip().strip("\'")
                            roles[current_role][current_list_key].append({"name": nm, "path": pt})
                        else:
                            roles[current_role][current_list_key].append({"name": nm, "path": rest})
                    elif current_list_key:
                        roles[current_role][current_list_key].append({"name": item_str.strip("\'"), "path": item_str.strip("\'")})

    if not roles:
        print("错误：app.yaml 中没有角色定义")
        sys.exit(1)

    # ── 废弃字段检查（方案 B：拒绝编译）──
    if deprecated_errors:
        print(f"\n❌ 编译失败：{len(deprecated_errors)} 个废弃字段")
        for e in deprecated_errors:
            print(f"  ❌ {e}")
        sys.exit(1)

    # ── 编译期语法校验 ──
    errors.extend(validate_app_yaml(roles, edges_lines))
    if errors:
        print(f"\n❌ 编译失败：{len(errors)} 个错误")
        for e in errors:
            print(f"  ❌ {e}")
        sys.exit(1)

    return app_name, roles, edges_lines, app_knowledge


def _build_router_steps(roles, edges_lines, role_order, step_map):
    """构建 ROUTER.json 的 steps，返回 (router_steps, router, schema_version)。"""
    # ── ROUTER.json ──
    # transitions 格式：{"targets": [...], "type": "forward|backward", ...元数据}
    # 编译器全权编码边语义，运行时零知识执行（只读元数据）
    router_steps = []
    for r in role_order:
        step_id = step_map[r]
        role_data = roles[r]
        transitions = {}

        for e in edges_lines:
            if e["src"] != r:
                continue
            verdict = e["verdict"]
            targets = e["targets"]

            if verdict is None:
                # 无条件边 → confirmed 路由
                step_targets = [step_map[t] for t in targets if t != "完成" and t in step_map and step_map[t]]
                if step_targets:
                    # 合并同 verdict 多目标边（修复并行扇出覆盖缺陷）
                    if "confirmed" in transitions:
                        existing = transitions["confirmed"]
                        existing_targets = existing.get("targets", []) if isinstance(existing, dict) else existing
                        merged = list(dict.fromkeys(existing_targets + step_targets))  # 保序去重
                        if isinstance(existing, dict):
                            existing["targets"] = merged
                        else:
                            transitions["confirmed"] = {"targets": merged, "type": "normal"}
                    else:
                        edge_val = {"targets": step_targets, "type": "normal"}
                        if e.get("carries"):
                            edge_val["carries"] = [{"path": p} for p in e["carries"]]
                        transitions["confirmed"] = edge_val
                elif all(t == "完成" for t in targets):
                    edge_val = {"targets": [], "type": "normal"}
                    if e.get("carries"):
                        edge_val["carries"] = [{"path": p} for p in e["carries"]]
                    transitions["confirmed"] = edge_val
            else:
                step_targets = []
                for t in targets:
                    if t == "完成":
                        continue
                    st = step_map.get(t)
                    if st:
                        step_targets.append(st)
                # 判定边类型：fail/fail_* 为回退，其他（条件路由）为前进
                is_backward = (verdict == "fail" or verdict.startswith("fail_"))
                edge_type = "backward" if is_backward else "normal"
                edge_val = {"targets": step_targets, "type": edge_type}
                if is_backward:
                    edge_val["max_executions"] = e.get("max_executions") or 3
                else:
                    # normal 边也支持 max_executions（用于循环边上限）
                    if e.get("max_executions"):
                        edge_val["max_executions"] = e["max_executions"]
                # 传递 restrict_verdict（边级元数据，编译期聚合后写入 step.verdict_context）
                if e.get("restrict_verdict"):
                    edge_val["restrict_verdict"] = e["restrict_verdict"]
                # 传递 carries（v8.4：边级显式物料声明，字符串列表→[{path}] 格式）
                # 不写 carries 的边不注入该字段，下游零物料
                if e.get("carries"):
                    edge_val["carries"] = [{"path": p} for p in e["carries"]]
                if step_targets or all(t == "完成" for t in targets):
                    # 合并同 verdict 多目标边（修复并行扇出覆盖缺陷）
                    if verdict in transitions:
                        existing = transitions[verdict]
                        existing_targets = existing.get("targets", []) if isinstance(existing, dict) else existing
                        merged = list(dict.fromkeys(existing_targets + step_targets))  # 保序去重
                        if isinstance(existing, dict):
                            existing["targets"] = merged
                        else:
                            transitions[verdict] = {"targets": merged, "type": edge_type}
                    else:
                        transitions[verdict] = edge_val

        # 检查角色是否有前进边——没有则报错（不猜测拓扑）
        has_forward = any(
            (v.get("type") == "normal") if isinstance(v, dict) else False
            for v in transitions.values()
        )
        if "confirmed" not in transitions and not has_forward:
            print(f"\n❌ 编译失败：角色 '{r}' 没有任何前进边（在 edges 中未声明任何出边）")
            sys.exit(1)

        # P2: Gate FAIL 边默认上限 3 次（v8.2）
        # 原 v8.1 设计认为"格式错误只需重做即可修复"，但实际 LLM 可能反复产出同样的错误格式
        # （如 R1~R4 响应记录被误判），导致 backward 自循环死锁。
        # 现改为默认 3 次，超过则 orchestrator 升级为 BLOCKING 等用户介入。
        # 角色可在 app.yaml 中用 fail_max_executions 覆盖。
        fail_max = role_data.get("fail_max_executions", 3)
        # 开发者写的 normal 边必须显式声明 carries（见 transition 构造段）
        fail_carries = []
        seen_paths = set()
        # 1. 当前角色的 outputs（fail 边源 = target = 自己，合并为一类）
        for o in role_data.get("outputs", []):
            p = o.get("path", "")
            if p and p not in seen_paths:
                fail_carries.append({"path": p})
                seen_paths.add(p)
        # 2. Gate 结果
        gate_p = f"outputs/{step_id}-gate-result.json"
        if gate_p not in seen_paths:
            fail_carries.append({"path": gate_p})
            seen_paths.add(gate_p)
        # 3. 用户反馈（仅 manual 角色）
        if role_data.get("confirm", "manual") == "manual":
            fb_p = f"outputs/{step_id}-feedback.json"
            if fb_p not in seen_paths:
                fail_carries.append({"path": fb_p})
                seen_paths.add(fb_p)
        transitions.setdefault("fail", {"targets": [step_id], "type": "backward", "max_executions": fail_max, "carries": fail_carries})

        step_entry = {"step": step_id, "role": r, "transitions": transitions}
        router_steps.append(step_entry)

    # 写入 SDK schema_version 到编译产物
    _sdk_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sdk")
    sys.path.insert(0, _sdk_dir)
    try:
        from sdk import SDK_VERSION
        _schema_version = SDK_VERSION
    except ImportError:
        _schema_version = "2.0"  # fallback

    router = {"schema_version": _schema_version, "entry": step_map[role_order[0]], "steps": router_steps}

    return router_steps, router, _schema_version


def _build_registry(roles, role_order, app_knowledge, edges_lines, router_steps, role_input_groups):
    """构建 registry.json，返回 registry。"""
    # ── registry.json ──
    registry = []
    for r in role_order:
        role_data = roles[r]
        role_dir = slugify(r)
        confirm = role_data.get("confirm", "manual")

        outputs = role_data.get("outputs", [{"name": slugify(r), "path": f"outputs/{slugify(r)}/{slugify(r)}.json", "type": "deliverable"}])

        # gate：统一二元校验（文件存在 + 非空），v8.0 删除 min_size 长度校验
        gate_rules = {"phase1_cross_validation": {"enabled": True}, "phase2_schema_comparison": {"enabled": False}, "phase3_anomaly_detection": {"enabled": False}}

        # app 级公共知识按 inject_to 选择性注入到角色 inputs
        # 缺省 inject_to = None → 不注入（方案 B）
        role_inputs = list(role_data.get("inputs", []))
        if app_knowledge:
            for kp in app_knowledge:
                inject_targets = kp.get("inject_to")
                if inject_targets and r in inject_targets:
                    # 检测双重声明并给出警告
                    existing_paths = {i.get("path") for i in role_inputs}
                    if kp["path"] in existing_paths:
                        print(f"  ⚠️ [警告] 知识文件 '{kp['path']}' 在顶层 knowledge(inject_to) 和角色 '{r}' 的 inputs 中双重声明")
                    inject_copy = {k: v for k, v in kp.items() if k != "inject_to"}
                    role_inputs.append(inject_copy)

        entry = {
            "role_name": r,
            "skill_path": f"roles/{role_dir}/skill.md",
            "blocking_mode": confirm,
            "outputs": outputs,
            "gate_rules": gate_rules,
        }
        if role_inputs:
            entry["inputs"] = role_inputs
        registry.append(entry)

    # ── 从 edges 提取 verdict 值，同步到 registry + schema（唯一权威源）──
    # 同时注入 input_groups 到 registry
    # 注意：fail 为系统保留词（Gate 专属），不写入角色的 schema enum
    role_edge_verdicts = {}  # {role_name: set(verdict_values)}
    for e in edges_lines:
        src = e["src"]
        verdict = e.get("verdict")
        if verdict and verdict != "fail":
            role_edge_verdicts.setdefault(src, set()).add(verdict)
        elif not verdict:
            # 无条件出边（A → B 无 when）默认为 confirmed
            role_edge_verdicts.setdefault(src, set()).add("confirmed")

    # 注入 input_groups 到 registry（目标视角）
    # 补充 fail 边：fail 边在 router_steps 中自动生成，不在 edges_lines 中
    step_to_role_map = {s["step"]: s["role"] for s in router_steps}
    role_to_step_map = {s["role"]: s["step"] for s in router_steps}
    for s in router_steps:
        fail_edge = s.get("transitions", {}).get("fail")
        if fail_edge and isinstance(fail_edge, dict):
            src_role = s["role"]
            for fail_target_step in fail_edge.get("targets", []):
                fail_target_role = step_to_role_map.get(fail_target_step, fail_target_step)
                if fail_target_role != "完成":
                    role_input_groups.setdefault(fail_target_role, []).append([src_role])

    # 转换 role name → step id，统一与 STATE.json 的 finished keys 对齐
    reg_by_name_ig = {r["role_name"]: r for r in registry}
    for role_name, groups in role_input_groups.items():
        entry = reg_by_name_ig.get(role_name)
        if entry and groups:
            step_groups = []
            seen_tuples = set()  # 去重：同一 step_group 只保留一份
            for group in groups:
                step_group = [role_to_step_map.get(r, r) for r in group]
                group_tuple = tuple(step_group)
                if group_tuple in seen_tuples:
                    continue
                seen_tuples.add(group_tuple)
                step_groups.append(step_group)
            entry["input_groups"] = step_groups

    reg_by_name = {r["role_name"]: r for r in registry}
    step_to_role = {s["step"]: s["role"] for s in router_steps}
    for role_name, edge_verdicts in role_edge_verdicts.items():
        entry = reg_by_name.get(role_name)
        if not entry:
            continue
        # verdicts 只从 edges 提取，写入 registry
        entry["verdicts"] = sorted(edge_verdicts)

    return registry


def _build_manifest(registry, app_knowledge, app_name, schema_version):
    """构建 manifest.json，返回 manifest。"""
    # ── manifest.json ──
    auto_dirs = set()
    for entry in registry:
        for o in entry.get("outputs", []):
            # abs_path 指向工作区外部，不纳入工作区目录创建
            p = o.get("path", "")
            if p:
                d = os.path.dirname(p)
                if d:
                    auto_dirs.add(d)
        for i in entry.get("inputs", []):
            p = i.get("path", "")
            if p:
                d = os.path.dirname(p)
                if d:
                    auto_dirs.add(d)

    manifest = {"schema_version": schema_version, "app_name": app_name, "paths": {"router": "ROUTER.json", "registry": "registry.json"}, "workspace_template": {"dirs": sorted(auto_dirs), "init_files": {}}}
    # app 级公共知识文件注册到 knowledge_sources（init 时从 app 包拷贝到 workspace）
    if app_knowledge:
        manifest["workspace_template"]["knowledge_sources"] = [
            {"from": kp["path"], "to": kp["path"]}
            for kp in app_knowledge
        ]
        print(f"[compiler] knowledge_sources: {len(app_knowledge)} 个公共知识文档")

    return manifest


def _write_outputs(app_path, router, registry, manifest, role_order, roles, app_knowledge):
    """写入编译产物文件 + 生成骨架。"""
    # ── 写入 ──
    save_json(os.path.join(app_path, "ROUTER.json"), router)
    save_json(os.path.join(app_path, "registry.json"), registry)
    save_json(os.path.join(app_path, "manifest.json"), manifest)

    print(f"[compiler] ROUTER.json: {len(router['steps'])} steps")
    print(f"[compiler] registry.json: {len(registry)} roles")
    print(f"[compiler] manifest.json: {len(manifest['workspace_template']['dirs'])} dirs")

    _generate_role_skeletons(app_path, role_order, roles, app_knowledge)

    print(f"[compiler] ✅ 编译完成: {app_path}")


def compile_app(app_path, force=False):
    """从 app.yaml 编译生成引擎配置。"""
    app_path = app_path.rstrip('/')

    # ── 读 app.yaml ──
    yaml_path = os.path.join(app_path, "app.yaml")
    if not os.path.exists(yaml_path):
        print(f"错误：{yaml_path} 不存在")
        sys.exit(1)

    with open(yaml_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Stage 1: 解析 app.yaml
    app_name, roles, edges_lines, app_knowledge = _parse_app_yaml(content, app_path)

    # Stage 2: 图计算
    role_names = list(roles.keys())
    role_input_groups = _calc_input_groups(edges_lines)
    edges_lines = _expand_sync_joins(edges_lines)
    role_order = _topo_sort(role_names, edges_lines)
    step_map = {r: slugify(r) for r in role_order}
    step_map["完成"] = None

    # Stage 3: 构建 ROUTER.json
    router_steps, router, schema_version = _build_router_steps(roles, edges_lines, role_order, step_map)

    # Stage 4: 构建 registry.json
    registry = _build_registry(roles, role_order, app_knowledge, edges_lines, router_steps, role_input_groups)

    # Stage 5: verdict_context 聚合
    _aggregate_verdict_context(router_steps)

    # Stage 6: 构建 manifest.json
    manifest = _build_manifest(registry, app_knowledge, app_name, schema_version)

    # Stage 7: 写入产物
    _write_outputs(app_path, router, registry, manifest, role_order, roles, app_knowledge)



# ─── 静态分析 ───

FORWARD_BUILTIN = {"confirmed"}


def _unpack_transitions(transitions_dict):
    """将 transitions 字典解包为 [(key, targets_list, type_str)] 列表。"""
    result = []
    for key, val in transitions_dict.items():
        if isinstance(val, dict):
            targets = val.get("targets", [])
            type_str = val.get("type", "normal")
        else:
            targets = val if isinstance(val, list) else []
            type_str = "normal"
        result.append((key, targets, type_str))
    return result


def _compute_reach(start, adj, block=None):
    """BFS 计算从 start 出发经 adj 邻接表可达的所有节点集合。

    Args:
        start: 起始节点
        adj: 邻接表 dict[str, list[str]]
        block: 屏障节点集合，这些节点不会被遍历（作为屏障阻止传播）

    Returns:
        可达节点集合 set[str]
    """
    reach = set()
    queue = [start]
    while queue:
        cur = queue.pop()
        if cur in reach:
            continue
        reach.add(cur)
        for nxt in adj.get(cur, []):
            if nxt not in reach and (block is None or nxt not in block):
                queue.append(nxt)
    return reach


def _check_conditional_router_verdict(steps, role_to_schemas, errors, warnings):
    """E7: 条件路由无 verdict。"""
    for s in steps:
        sid = s["step"]
        role = s["role"]
        has_cond_route = any(ks not in FORWARD_BUILTIN and ts == "normal" for ks, _, ts in _unpack_transitions(s.get("transitions", {})))
        if has_cond_route:
            schema = role_to_schemas.get(role)
            if schema is None:
                warnings.append({"code": "ROUTE_NO_VERDICT", "step": sid,
                               "message": f"{sid}({role}) 有条件路由但无 schema，无法验证 result.verdict"})
                continue
            result_props = schema.get("properties", {}).get("result", {}).get("properties", {})
            verdict_prop = result_props.get("verdict", {})
            if not verdict_prop:
                errors.append({"code": "ROUTE_NO_VERDICT", "step": sid,
                               "message": f"{sid}({role}) 有条件路由但 schema 中无 result.verdict"})


def _warn_only_backward(steps, warnings):
    """W2: 仅含回退边。"""
    for s in steps:
        sid = s["step"]
        unpacked = _unpack_transitions(s.get("transitions", {}))
        forward_keys = {k for k, _, ts in unpacked if ts == "normal"}
        backward_keys = {k for k, _, ts in unpacked if ts == "backward"}
        if backward_keys and not forward_keys:
            warnings.append({"code": "BACKWARD_ONLY", "step": sid,
                             "message": f"{sid} 仅有回退边，无前进边"})


def _warn_verdict_mismatch(steps, role_to_schemas, warnings):
    """W3: verdict 不匹配（schema enum vs transitions）。"""
    for s in steps:
        sid = s["step"]
        role = s["role"]
        schema = role_to_schemas.get(role, {})
        result_props = schema.get("properties", {}).get("result", {}).get("properties", {})
        verdict_prop = result_props.get("verdict", {})
        if verdict_prop:
            schema_enum = set(verdict_prop.get("enum", []))
            unpacked = _unpack_transitions(s.get("transitions", {}))
            trans_keys = {k for k, _, _ in unpacked}
            builtin_keys = FORWARD_BUILTIN | {"fail", "loop"}
            non_std_trans = {k for k, _, ts in unpacked if k not in builtin_keys and ts == "normal"}
            extra_schema = schema_enum - non_std_trans - builtin_keys
            extra_trans = non_std_trans - schema_enum
            if extra_schema or extra_trans:
                detail = []
                if extra_schema:
                    detail.append(f"schema 有 {extra_schema} 但 transitions 无")
                if extra_trans:
                    detail.append(f"transitions 有 {extra_trans} 但 schema 无")
                warnings.append({"code": "VERDICT_MISMATCH", "step": sid,
                                 "message": f"{sid} verdict 不匹配：{'; '.join(detail)}"})


def _warn_skill_verdict_undescribed(steps, role_to_schemas, registry, app_path, warnings):
    """W6: Skill 未描述条件路由 verdict。"""
    for s in steps:
        sid = s["step"]
        role = s["role"]
        schema = role_to_schemas.get(role)
        if not schema:
            continue
        result_props = schema.get("properties", {}).get("result", {}).get("properties", {})
        verdict_prop = result_props.get("verdict", {})
        verdict_enum = verdict_prop.get("enum", [])
        if not verdict_enum:
            continue
        role_entry = next((r for r in registry if r.get("role_name") == role), None)
        if not role_entry:
            continue
        skill_path = role_entry.get("skill_path", "")
        if not skill_path:
            continue
        skill_full = os.path.join(app_path, skill_path)
        if not os.path.exists(skill_full):
            continue
        with open(skill_full, "r", encoding="utf-8") as f:
            skill_content = f.read()
        undocumented = [v for v in verdict_enum if v not in skill_content]
        if undocumented:
            warnings.append({"code": "ROUTE_SKILL_UNDOCUMENTED", "step": sid,
                             "message": f"{sid}({role}) 的 skill 未描述 verdict: {undocumented}"})


def _warn_fork_no_join(fork_points, forward_adj_unbounded, warnings):
    """W1: Fork 后无公共 join 点。"""
    for fork_step, fork_targets in fork_points:
        if len(fork_targets) < 2:
            continue
        branch_reach = {}
        for bt in fork_targets:
            branch_reach[bt] = _compute_reach(bt, forward_adj_unbounded)
        common = set(branch_reach[fork_targets[0]])
        for ft in fork_targets[1:]:
            common &= branch_reach[ft]
        if not common:
            warnings.append({"code": "FORK_NO_JOIN", "step": fork_step,
                             "message": f"{fork_step} fork 后无公共 join 点"})


def _build_check_graph(steps, step_ids, errors):
    """构建图邻接表 + E1: 死链检测。"""
    forward_adj = {s["step"]: [] for s in steps}
    forward_adj_unbounded = {s["step"]: [] for s in steps}
    backward_adj = {s["step"]: [] for s in steps}
    bounded_edges = set()
    all_targets = {s["step"]: {} for s in steps}
    all_sources = {s["step"]: {} for s in steps}

    for s in steps:
        sid = s["step"]
        trans = s.get("transitions", {})
        for key, val in trans.items():
            if isinstance(val, dict):
                targets = val.get("targets", [])
                type_str = val.get("type", "normal")
                max_exec = val.get("max_executions")
            else:
                targets = val if isinstance(val, list) else []
                type_str = "normal"
                max_exec = None
            all_targets[sid][key] = targets
            is_bw = (type_str == "backward")
            for t in targets:
                if t and t not in step_ids:
                    errors.append({"code": "DEAD_LINK", "step": sid,
                                   "message": f"{sid}.transitions.{key} → {t} 不存在"})
                    continue
                if t:
                    all_sources.setdefault(t, {}).setdefault(key, []).append(sid)
                    if is_bw:
                        backward_adj[sid].append(t)
                    else:
                        forward_adj[sid].append(t)
                        if max_exec:
                            bounded_edges.add((sid, t))
                        else:
                            forward_adj_unbounded[sid].append(t)
    return forward_adj, forward_adj_unbounded, backward_adj, bounded_edges


def _check_unreachable(steps, entry, forward_adj, step_ids, errors):
    """E2: 不可达节点检测。返回 (backward_targets, reachable)。"""
    backward_targets = set()
    for s in steps:
        sid = s["step"]
        for key, targets, type_str in _unpack_transitions(s.get("transitions", {})):
            if type_str == "backward":
                for t in targets:
                    if t != sid:
                        backward_targets.add(t)
    reachable = set()
    if entry in step_ids:
        queue = [entry]
        while queue:
            cur = queue.pop()
            if cur in reachable:
                continue
            reachable.add(cur)
            for nxt in forward_adj.get(cur, []):
                if nxt not in reachable:
                    queue.append(nxt)
    for s in steps:
        if s["step"] not in reachable and s["step"] not in backward_targets:
            errors.append({"code": "UNREACHABLE", "step": s["step"],
                           "message": f"{s['step']} 从 entry 不可达"})
    return backward_targets, reachable


def _check_terminal_reachable(steps, forward_adj, reachable, errors):
    """终态检测 + E3: 终态不可达。返回 (terminal_steps, can_reach_terminal)。"""
    terminal_steps = set()
    for s in steps:
        sid = s["step"]
        unpacked = _unpack_transitions(s.get("transitions", {}))
        forward_trans = [(ks, t_list) for ks, t_list, ts in unpacked if ts == "normal"]
        if not forward_trans:
            continue
        if any(len(t_list) == 0 for _, t_list in forward_trans):
            terminal_steps.add(sid)

    forward_edges = set()
    for sid, targets in forward_adj.items():
        for t in targets:
            if sid != t:
                forward_edges.add((sid, t))

    can_reach_terminal = set()
    for ts in terminal_steps:
        can_reach_terminal.add(ts)
    changed = True
    while changed:
        changed = False
        for s in steps:
            sid = s["step"]
            if sid in can_reach_terminal:
                continue
            for nxt in forward_adj.get(sid, []):
                if nxt in can_reach_terminal and sid != nxt:
                    can_reach_terminal.add(sid)
                    changed = True
                    break
    for s in steps:
        sid = s["step"]
        if sid in reachable and sid not in can_reach_terminal:
            errors.append({"code": "NO_TERMINAL_PATH", "step": sid,
                           "message": f"{sid} 无法到达任何终态"})
    return terminal_steps, can_reach_terminal


def _check_dead_loops(steps, forward_adj, can_reach_terminal, bounded_edges, reachable, errors):
    """E4: 死循环检测（自环 + 多节点环）。"""
    for s in steps:
        sid = s["step"]
        for key, targets, type_str in _unpack_transitions(s.get("transitions", {})):
            if type_str == "normal" and sid in targets:
                if sid not in can_reach_terminal:
                    err = {"code": "DEAD_LOOP", "step": sid,
                           "message": f"死循环（自环）：{sid} → {sid}（{key}）"}
                    if err not in errors:
                        errors.append(err)

    visited_cycle = set()
    for s in steps:
        sid = s["step"]
        if sid in visited_cycle or sid not in reachable:
            continue
        path_stack = []
        in_stack = set()
        def dfs_cycle(node):
            if node in in_stack:
                cycle_start = path_stack.index(node)
                cycle = path_stack[cycle_start:] + [node]
                cycle_can_exit = False
                for cn in cycle[:-1]:
                    if cn in can_reach_terminal:
                        cycle_can_exit = True
                        break
                if not cycle_can_exit:
                    for i in range(len(cycle) - 1):
                        if (cycle[i], cycle[i + 1]) in bounded_edges:
                            cycle_can_exit = True
                            break
                if not cycle_can_exit:
                    for cn in cycle[:-1]:
                        visited_cycle.add(cn)
                        err = {"code": "DEAD_LOOP", "step": cn,
                               "message": f"死循环：{' → '.join(cycle)}"}
                        if err not in errors:
                            errors.append(err)
                return
            if node in visited_cycle:
                return
            in_stack.add(node)
            path_stack.append(node)
            for nxt in forward_adj.get(node, []):
                if nxt != node:
                    dfs_cycle(nxt)
            path_stack.pop()
            in_stack.discard(node)
            visited_cycle.add(node)
        dfs_cycle(sid)


def _compute_branch_reach(fork_targets, forward_adj_unbounded):
    """计算每个分支的可达集。返回 {bt: reach_set}。"""
    branch_reach = {}
    for bt in fork_targets:
        branch_reach[bt] = _compute_reach(bt, forward_adj_unbounded)
    return branch_reach


def _check_join_validity(s_id, step_branches, role_input_groups, fork_target_set):
    """检查 s_id 是否为合法 JOIN（完整或部分）。返回 True 表示合法。"""
    role = step_branches.get("_role_map", {}).get(s_id, "")
    groups = role_input_groups.get(role, [])
    for g in groups:
        group_branches = set()
        for member in g:
            if member in fork_target_set:
                group_branches.add(member)
            elif member in step_branches:
                group_branches |= step_branches[member]
        if len(group_branches) >= 2:
            return True
    return False


def _check_cross_branch_leak(forward_adj_unbounded, step_to_role, role_input_groups, fork_points, errors):
    """E5: 跨分支泄漏检测。"""
    for fork_step, fork_targets in fork_points:
        if len(fork_targets) < 2:
            continue
        branch_reach = _compute_branch_reach(fork_targets, forward_adj_unbounded)

        step_branches = {}
        for bt, reach in branch_reach.items():
            for s_id in reach:
                step_branches.setdefault(s_id, set()).add(bt)

        fork_target_set = set(fork_targets)
        common_join = set(branch_reach[fork_targets[0]])
        for ft in fork_targets[1:]:
            common_join &= branch_reach[ft]
        common_join -= fork_target_set

        legit_partial_joins = set()
        for s_id in step_branches:
            if len(step_branches[s_id]) < 2:
                continue
            role = step_to_role.get(s_id, "")
            groups = role_input_groups.get(role, [])
            for g in groups:
                group_branches = set()
                for member in g:
                    if member in fork_target_set:
                        group_branches.add(member)
                    elif member in step_branches:
                        group_branches |= step_branches[member]
                if len(group_branches) >= 2:
                    legit_partial_joins.add(s_id)
                    break

        all_legit_joins = common_join | legit_partial_joins
        barrier_reach = {}
        for bt in fork_targets:
            barrier_reach[bt] = _compute_reach(bt, forward_adj_unbounded, block=all_legit_joins)

        barrier_step_branches = {}
        for bt, reach in barrier_reach.items():
            for s_id in reach:
                barrier_step_branches.setdefault(s_id, set()).add(bt)

        for lk, branches in barrier_step_branches.items():
            if len(branches) < 2:
                continue
            if lk == fork_step:
                continue
            if lk in fork_targets:
                err = {"code": "CROSS_BRANCH_LEAK", "step": str(lk),
                       "message": f"分支泄漏：{fork_step} fork 后，分支 {branches} 可达另一分支根 {lk}"}
                if err not in errors:
                    errors.append(err)
                continue
            err = {"code": "CROSS_BRANCH_LEAK", "step": str(lk),
                   "message": f"分支泄漏：{fork_step} fork 后，{lk} 被多个分支可达且无合法 JOIN 声明"}
            if err not in errors:
                errors.append(err)


def _compute_check_topo_index(steps):
    """计算 check 图的拓扑排序索引。返回 {step: index}。"""
    in_degree = {s["step"]: 0 for s in steps}
    topo_adj = {s["step"]: [] for s in steps}
    for s in steps:
        sid = s["step"]
        for key, targets, type_str in _unpack_transitions(s.get("transitions", {})):
            if type_str == "normal":
                for t in targets:
                    if t and t != sid and t in in_degree:
                        topo_adj[sid].append(t)
                        in_degree[t] = in_degree.get(t, 0) + 1
    topo_queue = deque([s["step"] for s in steps if in_degree.get(s["step"], 0) == 0])
    topo_order = []
    visited_topo = set()
    while topo_queue:
        cur = topo_queue.popleft()
        if cur in visited_topo:
            continue
        visited_topo.add(cur)
        topo_order.append(cur)
        for nxt in topo_adj.get(cur, []):
            in_degree[nxt] -= 1
            if in_degree[nxt] <= 0:
                topo_queue.append(nxt)
    return {s: i for i, s in enumerate(topo_order)}


def _check_sub_join_order(cn_def, fork_step, forward_adj_unbounded, topo_index, outer_join, errors):
    """检测子 join 是否晚于外层 join。"""
    for key, targets, type_str in _unpack_transitions(cn_def.get("transitions", {})):
        if type_str == "normal" and len(targets) > 1:
            sub_branch_reach = {}
            for sbt in targets:
                sub_branch_reach[sbt] = _compute_reach(sbt, forward_adj_unbounded)
            sub_common = set(sub_branch_reach[targets[0]])
            for sbt in targets[1:]:
                sub_common &= sub_branch_reach[sbt]
            if sub_common:
                sub_join = min(sub_common, key=lambda x: topo_index.get(x, 999))
                if topo_index.get(sub_join, 0) > topo_index.get(outer_join, 0):
                    bypass = False
                    for sbt in targets:
                        if outer_join in sub_branch_reach.get(sbt, set()):
                            bypass = True
                            break
                    if bypass:
                        err = {"code": "INNER_JOIN_AFTER_OUTER", "step": sub_join,
                               "message": f"内层 join {sub_join} 拓扑序晚于外层 join {outer_join}（fork {fork_step} / 子 fork {cn_def['step']}）"}
                        if err not in errors:
                            errors.append(err)


def _check_inner_join_order(steps, fork_points, forward_adj_unbounded, errors):
    """E6: 内层 join 晚于外层 join。"""
    topo_index = _compute_check_topo_index(steps)

    for fork_step, fork_targets in fork_points:
        if len(fork_targets) < 2:
            continue
        branch_join_steps = {}
        for bt in fork_targets:
            branch_join_steps[bt] = _compute_reach(bt, forward_adj_unbounded)
        common_joins = set(branch_join_steps[fork_targets[0]])
        for ft in fork_targets[1:]:
            common_joins &= branch_join_steps[ft]
        if not common_joins:
            continue
        sorted_joins = sorted(common_joins, key=lambda x: topo_index.get(x, 999))
        outer_join = sorted_joins[0]
        for bt in fork_targets:
            bt_reach = branch_join_steps[bt]
            for cn in bt_reach:
                cn_def = next((x for x in steps if x["step"] == cn), None)
                if not cn_def:
                    continue
                _check_sub_join_order(cn_def, fork_step, forward_adj_unbounded, topo_index, outer_join, errors)


def _warn_join_ambiguity(fork_points, forward_adj_unbounded, warnings):
    """W4: Join 歧义。"""
    for fork_step, fork_targets in fork_points:
        if len(fork_targets) < 2:
            continue
        branch_reach = {}
        for bt in fork_targets:
            branch_reach[bt] = _compute_reach(bt, forward_adj_unbounded)
        common_all = set(branch_reach[fork_targets[0]])
        for ft in fork_targets[1:]:
            common_all &= branch_reach[ft]
        join_candidates = [c for c in common_all if c not in fork_targets and c != fork_step]
        if len(join_candidates) > 1:
            cand_reach = {}
            for jc in join_candidates:
                cand_reach[jc] = _compute_reach(jc, forward_adj_unbounded)
            ambiguous = []
            for jc in join_candidates:
                is_ambiguous = False
                for oc in join_candidates:
                    if oc == jc:
                        continue
                    if oc not in cand_reach[jc] and jc not in cand_reach[oc]:
                        is_ambiguous = True
                        break
                if is_ambiguous:
                    ambiguous.append(jc)
            if len(ambiguous) >= 2:
                warnings.append({"code": "JOIN_AMBIGUITY", "step": fork_step,
                                 "message": f"{fork_step} 有多个互不可达的公共汇聚：{ambiguous}"})


def _warn_nesting_asymmetry(steps, fork_points, forward_adj_unbounded, warnings):
    """W5: 嵌套不对称。"""
    for fork_step, fork_targets in fork_points:
        if len(fork_targets) < 2:
            continue
        has_sub_fork = {}
        for bt in fork_targets:
            reach = _compute_reach(bt, forward_adj_unbounded)
            sub_forks = False
            for rn in reach:
                rn_def = next((x for x in steps if x["step"] == rn), None)
                if rn_def:
                    for key, targets, type_str in _unpack_transitions(rn_def.get("transitions", {})):
                        if type_str == "normal" and len(targets) > 1:
                            sub_forks = True
                            break
                if sub_forks:
                    break
            has_sub_fork[bt] = sub_forks
        if len(set(has_sub_fork.values())) > 1:
            warnings.append({"code": "ASYMMETRIC_NESTING", "step": fork_step,
                             "message": f"{fork_step} 的分支 fork 结构不对称：{has_sub_fork}"})


def _run_all_checks(steps, step_ids, entry, role_to_schemas, role_input_groups, step_to_role, registry, app_path, errors, warnings):
    """执行全部检查函数序列，返回 (terminal_steps, fork_points)。"""
    forward_adj, forward_adj_unbounded, backward_adj, bounded_edges = _build_check_graph(steps, step_ids, errors)

    fork_points = []
    for s in steps:
        sid = s["step"]
        for key, targets, type_str in _unpack_transitions(s.get("transitions", {})):
            if type_str == "normal" and len(targets) > 1:
                fork_points.append((sid, targets))

    backward_targets, reachable = _check_unreachable(steps, entry, forward_adj, step_ids, errors)

    terminal_steps, can_reach_terminal = _check_terminal_reachable(steps, forward_adj, reachable, errors)

    _check_dead_loops(steps, forward_adj, can_reach_terminal, bounded_edges, reachable, errors)

    _check_cross_branch_leak(forward_adj_unbounded, step_to_role, role_input_groups, fork_points, errors)

    _check_inner_join_order(steps, fork_points, forward_adj_unbounded, errors)

    _check_conditional_router_verdict(steps, role_to_schemas, errors, warnings)

    _warn_fork_no_join(fork_points, forward_adj_unbounded, warnings)

    _warn_only_backward(steps, warnings)

    _warn_verdict_mismatch(steps, role_to_schemas, warnings)

    _warn_join_ambiguity(fork_points, forward_adj_unbounded, warnings)

    _warn_nesting_asymmetry(steps, fork_points, forward_adj_unbounded, warnings)

    _warn_skill_verdict_undescribed(steps, role_to_schemas, registry, app_path, warnings)

    return terminal_steps, fork_points


def check_app(app_path, strict=False):
    """对已生成的 ROUTER.json 做静态分析。返回 report dict。"""
    router_path = os.path.join(app_path, "ROUTER.json")
    if not os.path.exists(router_path):
        return {"status": "fail", "errors": [{"code": "NO_ROUTER", "message": "ROUTER.json 不存在"}], "warnings": []}
    router = load_json_safe(router_path) or {}
    steps = router.get("steps", [])
    step_ids = {s["step"] for s in steps}
    entry = router.get("entry", "")

    errors = []
    warnings = []

    # 加载 registry 和 schemas
    registry = []
    reg_path = os.path.join(app_path, "registry.json")
    if os.path.exists(reg_path):
        registry = load_json_safe(reg_path, default=[])
    role_to_schemas = {}  # {role_name: schema_dict}
    for r in registry:
        role_dir = slugify(r.get("role_name", ""))
        sf = os.path.join(app_path, "roles", role_dir, "schema.json")
        if os.path.exists(sf):
            try:
                role_to_schemas[r["role_name"]] = load_json_safe(sf)
            except Exception:
                pass
    role_input_groups = {r["role_name"]: r.get("input_groups", []) for r in registry} if registry else {}
    step_to_role = {s["step"]: s["role"] for s in steps}

    # 执行全部检查
    terminal_steps, fork_points = _run_all_checks(
        steps, step_ids, entry, role_to_schemas, role_input_groups, step_to_role, registry, app_path, errors, warnings)

    # ── 构建 report ──
    if strict:
        errors.extend(warnings)
        warnings = []

    status = "pass" if len(errors) == 0 else "fail"
    report = {
        "status": status,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "step_count": len(steps),
            "terminal_steps": sorted(terminal_steps),
            "fork_count": len(fork_points),
        }
    }
    return report


def main():
    parser = argparse.ArgumentParser(description="声明式编排编译器 v2.0")
    parser.add_argument("--app-path", required=True, help="应用包路径")
    parser.add_argument("--force", action="store_true", help="强制覆盖骨架文件")
    parser.add_argument("--check", action="store_true", help="仅检查已编译的 ROUTER.json")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式的检查报告")
    parser.add_argument("--strict", action="store_true", help="严格模式：警告升级为错误")
    args = parser.parse_args()

    if args.check or args.json or args.strict:
        report = check_app(args.app_path, strict=args.strict)
        if args.json:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            status_icon = "✅" if report["status"] == "pass" else "❌"
            print(f"\n{status_icon} 检查结果: {report['error_count']} 错误, {report['warning_count']} 警告")
            for e in report["errors"]:
                print(f"  ❌ [{e['code']}] {e['message']}")
            for w in report["warnings"]:
                print(f"  ⚠️  [{w['code']}] {w['message']}")
        sys.exit(0 if report["status"] == "pass" else 1)
    else:
        compile_app(args.app_path, args.force)


if __name__ == "__main__":
    main()

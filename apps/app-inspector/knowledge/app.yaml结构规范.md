# app.yaml 结构规范

## 1. 顶层结构

一个合法的 app.yaml 必须包含以下顶层键：

| 键 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app_name` | string | 是 | 应用名称，唯一标识 |
| `knowledge` | list | 否 | 知识资产声明 |
| `roles` | dict | 是 | 角色定义 |
| `edges` | list | 是 | 边（路由规则） |

## 2. knowledge 段

每个 knowledge 条目格式：
```yaml
- 知识名称: knowledge/文件路径.md
  inject_to: [角色A, 角色B]
```

- `inject_to` 声明该知识文件注入到哪些角色
- 路径以 `knowledge/` 开头

## 3. roles 段

每个角色定义：
```yaml
角色名:
  confirm: manual | auto     # 确认类型
  inputs:                     # 输入文件列表
    - 文件别名: 文件路径
  outputs:                    # 输出文件列表
    - 文件别名: 文件路径
```

### confirm 类型
- `manual`: 需要用户确认后才继续
- `auto`: 自动确认

### 文件路径分类
| 前缀 | 类别 | 说明 |
|---|---|---|
| `knowledge/` | knowledge | 知识资产，由 inject_to 注入 |
| `outputs/` | workspace | 工作区产物（持久化） |
| `process/outputs/` | workspace | 过程产物（临时） |
| `roles/` | workspace | 角色定义文件 |
| 其他 | external | 外部文件（如 00-需求描述.md） |

## 4. edges 段

### 边语法
```yaml
- 源角色 → 目标角色 when: result.verdict == "verdict值"
```

### 特殊语法
- **JOIN**: `[角色A, 角色B, 角色C] → 目标角色`（所有源角色完成后才触发）
- **FORK**: `源角色 → [角色A, 角色B]`（同时分发到多个目标）
- **无条件边**: 省略 `when` 子句

### 边属性
| 属性 | 说明 |
|---|---|
| `carries` | 携带的文件路径列表 |
| `max_executions` | 最大执行次数 |
| `restrict_verdict` | 限制可选 verdict |

### verdict 语义
- `confirmed`: 正常通过
- `loop`: 返回上一角色修正
- `passed`/`terminated`: 终态
- 自定义 verdict: 按角色语义定义

## 5. 合规检查要点

1. **入口角色**: roles 段第一个声明的角色
2. **终态角色**: 有出边指向 `完成` 的角色
3. **死链**: 声明了 input 但没有任何角色 output 该文件（且非 knowledge/external）
4. **孤儿物料**: 声明了 output 但没有任何角色 input 该文件
5. **断路**: 角色有入边但无出边（非终态），或有出边但无入边（非入口）

> 死链、孤儿、断路的完整定义、严重度分级和例外规则详见《死链与孤儿检测规则》，此处仅为摘要。

## 6. 正反例

### 正例（合法 app.yaml 片段）
```yaml
roles:
  角色A:
    inputs:
      - 需求: 00-需求.md        # external 文件，允许无 producer
    outputs:
      - 结果: outputs/结果.md     # 有消费者
edges:
  - 角色A → 角色B when: confirmed
```
**为什么合法**：角色A的 input 是 external 文件（不需要 producer），output 被角色B消费。

### 反例（含死链的 app.yaml 片段）
```yaml
roles:
  角色B:
    inputs:
      - 上游产物: outputs/上游.md  # 无任何角色 output 此文件
    outputs:
      - 结果: outputs/结果.md
```
**为什么违法**：`outputs/上游.md` 不是 knowledge/ 也不是 external，但没有任何角色的 outputs 包含它 → **死链**。

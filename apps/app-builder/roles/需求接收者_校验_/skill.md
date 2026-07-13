# 需求接收者 校验执行指令

## 执行步骤
1. Read 上游产出物（输入文件）
2. 逐项检查原则文档中的校验清单
3. 输出校验报告

## 输出格式
返回 JSON，包含 result.verdict（confirmed/fail）

## verdict 判定规则
- `confirmed`：需求文档七大要素齐全，无内部矛盾
- `loop`：需求文档存在可修复的缺陷，回退需求接收者修订

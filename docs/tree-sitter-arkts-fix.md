# tree-sitter-arkts Parser 修复记录

> 本文档记录 `node_modules/tree-sitter-arkts` 的 grammar.js 修改，确保另一台电脑的 AI 能完整理解改动背景、内容和验证结果。

## 背景

GitNexus 使用 `tree-sitter-arkts`（v0.1.9，来自 `million-mo/arkts_language_server`）解析 ArkTS/HarmonyOS 源码。

**原始问题**：上游 grammar.js 不支持 ArkTS 常见的语法模式，导致解析率仅 93.6%（arkts-test-project 子集 219/234）。更严重的是，之前的 grammar 修改因 `tree-sitter generate` 静默失败而从未生效——`parser.c` 从未更新。

## 改动清单（4 项 grammar 修改 + 8 条 conflict 声明）

### 1. ASI（自动分号插入）— 3 条规则

ArkTS 允许多种语句末尾省略分号（ASI）。

| 规则 | 改动 |
|------|------|
| `return_statement` | `;` → `optional(';')` |
| `throw_statement` | `;` → `optional(';')` |
| `variable_declaration` | `;` → `optional(';')` |

### 2. class body 允许空语句

ArkTS 允许方法体后跟 `;`（如 `async speak() {...};`）。

```
class_body: repeat(choice(
  $.property_declaration,
  $.method_declaration,
  $.constructor_declaration,
  ';'  // ← 新增：允许空语句
))
```

### 3. 参数列表 trailing comma

`parameter_list` 从 `commaSep` 改为 `commaSepTrailing`，支持 `(a: string,)` 这种写法。

### 4. new 表达式参数必填（解决 GLR 歧义）

`new_expression` 的参数列表从 `optional(seq(...))` 改为 `seq(...)`（必填）。

**原因**：`variable_declaration` 的 `optional(';')` 和 `new_expression` 的 `optional(args)` 产生 GLR 冲突。解析器会把 `new X()` 错误拆分为 `new X`（无分号的变量声明）+ `()`（孤立错误节点）。让 new 的参数必填消除了这个歧义。

### 5. 新增 conflict 声明（8 条）

```javascript
[$.property_declaration, $.method_declaration],
[$.expression_statement],
[$.return_statement],
[$.throw_statement],
[$.variable_declaration, $.enum_declaration],
[$.variable_declaration],
[$.property_declaration]
```

这些 conflict 是上述 optional 分号改动引入的 GLR 歧义，必须在 `conflicts` 数组中声明否则 `tree-sitter generate` 会失败。

## 构建步骤（每次改 grammar 后必须执行）

```bash
cd node_modules/tree-sitter-arkts

# 1. 生成 parser.c（必须检查退出码！退出码 1 = 静默失败，parser.c 不会更新）
npx tree-sitter generate
echo $?  # 必须是 0

# 2. 确认 parser.c 已更新
ls -la src/parser.c

# 3. 编译 native addon
npx node-gyp rebuild
```

**踩坑**：`tree-sitter generate` 遇到未声明的 conflict 时退出码为 1 但**不修改 parser.c**。如果忘记检查退出码，grammar 改了但 parser 没变，测试结果具有欺骗性。

## 验证结果

```bash
# 全量测试（排除 node_modules）
cd ~/Dev/AIDev/GitNexus/gitnexus
find . -path "*/node_modules" -prune -o -type f \( -name "*.ets" -o -name "*.ts" \) -print \
  | while read f; do
      tree-sitter parse "$f" 2>&1 | grep -q ERROR && echo "FAIL: $f"
    done
# 结果：0 个失败，792/792 = 100%
```

| 阶段 | 范围 | 结果 |
|------|------|------|
| 修复前 | arkts-test-project 234 文件 | 93.6%（219/234） |
| 修复后 | GitNexus 全量 792 文件 | **100%（792/792）** |

## 文件位置

| 文件 | 路径 |
|------|------|
| grammar.js | `node_modules/tree-sitter-arkts/grammar.js` |
| 生成的 parser | `node_modules/tree-sitter-arkts/src/parser.c` |
| 测试脚本 | `node_modules/tree-sitter-arkts/test_runner.sh` |
| 测试项目 | `~/Dev/AIDev/arkts-test-project/HMOSWorld`（234 文件，调试用） |

## 注意事项

1. **改动在 node_modules 中**，`npm install` 会覆盖。需要 fork 上游或用 patch 维护。
2. **上游仓库**：`https://github.com/million-mo/arkts_language_server`（npm: tree-sitter-arkts v0.1.9）
3. **后续迭代**：如需继续改 grammar，重复"构建步骤"并全量验证。

## 后续 TODO

- [ ] Fork `million-mo/arkts_language_server` 到 `pxinc/`，推送改动
- [ ] GitNexus package.json 改为引用 fork
- [ ] 考虑向上游提 PR

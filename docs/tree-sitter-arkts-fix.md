# tree-sitter-arkts Parser 修复记录

> 本文档记录 tree-sitter-arkts 的 grammar 修改，确保另一台电脑能完整理解改动背景、内容和验证结果。

## 背景

GitNexus 使用 `tree-sitter-arkts`（v0.1.9，来自 `million-mo/arkts_language_server`）解析 ArkTS/HarmonyOS 源码。

**原始问题**：上游 grammar.js 不支持 ArkTS 常见的语法模式，导致解析率仅 93.6%（arkts-test-project 子集 219/234）。更严重的是，之前的 grammar 修改因 `tree-sitter generate` 静默失败而从未生效。

## 文件结构

```
gitnexus/
├── vendor/tree-sitter-arkts/    # 改动在这里（进 git）
│   ├── grammar.js               # 修改后的语法规则
│   ├── src/parser.c             # 对应的 parser（可被 regenerate 覆盖）
│   ├── binding.gyp              # 编译配置
│   └── package.json             # 包信息
├── scripts/
│   └── patch-tree-sitter-arkts.sh  # postinstall 脚本
└── node_modules/tree-sitter-arkts/ # 不进 git，postinstall 自动 patch
```

## 工作原理

1. `npm install` 安装原版 tree-sitter-arkts
2. `postinstall` 脚本自动将 vendor 里的 grammar.js + parser.c 覆盖到 node_modules
3. 用 `tree-sitter generate` 重新生成 parser.c（确保与当前 tree-sitter 版本兼容）
4. 用 `node-gyp rebuild` 编译 native addon

**另一台电脑只需要 clone + npm install，一切自动完成。**

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
  ';'  // ← 新增
))
```

### 3. 参数列表 trailing comma

`parameter_list` 从 `commaSep` 改为 `commaSepTrailing`。

### 4. new 表达式参数必填（解决 GLR 歧义）

`new_expression` 的参数列表从 `optional(seq(...))` 改为 `seq(...)`（必填）。

**原因**：`variable_declaration` 的 `optional(';')` 和 `new_expression` 的 `optional(args)` 产生 GLR 冲突。解析器会把 `new X()` 错误拆分为 `new X`（无分号的变量声明）+ `()`（孤立错误节点）。

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

## 验证结果

```bash
cd gitnexus
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

## 手动构建（如 postinstall 失败）

```bash
cd gitnexus/node_modules/tree-sitter-arkts
cp ../../vendor/tree-sitter-arkts/grammar.js .
cp ../../vendor/tree-sitter-arkts/src/parser.c src/
npx tree-sitter generate
npx node-gyp rebuild
```

## 注意事项

1. `tree-sitter generate` 可能输出 "unnecessary conflicts" 警告，可忽略
2. 如果 parser.c 和 tree-sitter 头文件版本不兼容，`node-gyp rebuild` 会报 `.version` 字段错误 → 重新 `tree-sitter generate` 即可
3. **上游仓库**：`https://github.com/million-mo/arkts_language_server`
4. 后续迭代：直接改 `vendor/tree-sitter-arkts/grammar.js`，重新 generate + rebuild + 验证

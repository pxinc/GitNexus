# tree-sitter-arkts 定制方案

> 本文档面向**另一台电脑的 AI 助手**，帮助你快速理解我们做了什么、为什么做、怎么用。

## 一句话总结

我们修改了 `tree-sitter-arkts` 的 grammar.js，让 ArkTS 解析率从 93.6% 提升到 100%（792/792 文件全通过），改动通过 `vendor/` 目录 + postinstall 脚本集成到项目中。

---

## 问题背景

GitNexus 使用 `tree-sitter-arkts`（npm 包，上游：`million-mo/arkts_language_server`）解析 HarmonyOS 的 ArkTS 代码。

上游 grammar 不支持以下 ArkTS 常见语法：
- 语句末尾省略分号（ASI）
- 方法体后跟 `};`
- 参数列表末尾 trailing comma
- 导致 6.4% 的真实项目文件解析失败

## 我们改了什么

### 4 项 grammar 修改

| # | 修改 | 原始 | 改后 | 影响 |
|---|------|------|------|------|
| 1 | ASI 分号可选 | `;` | `optional(';')` | `return_statement`、`throw_statement`、`variable_declaration` |
| 2 | class body 空语句 | 3 种成员 | 加 `';'` | 方法后 `};` 不再报错 |
| 3 | 参数 trailing comma | `commaSep` | `commaSepTrailing` | `(a: string,)` 合法 |
| 4 | new 表达式参数必填 | `optional(seq(...))` | `seq(...)` | 消除与 optional 分号的 GLR 歧义 |

### 8 条 conflict 声明

上述修改引入的 GLR 冲突，在 `conflicts` 数组中声明：

```javascript
[$.property_declaration, $.method_declaration],
[$.expression_statement],
[$.return_statement],
[$.throw_statement],
[$.variable_declaration, $.enum_declaration],
[$.variable_declaration],
[$.property_declaration]
```

### 关键技术细节

**为什么 new 表达式参数要改成必填？**

`variable_declaration` 的 `optional(';')` 和 `new_expression` 的 `optional(args)` 产生 GLR 冲突。解析器会把 `let x = new Foo()` 错误拆分为：
- `let x = new Foo`（无分号的变量声明）
- `()`（孤立的错误节点）

让 new 的参数必填消除了这个歧义。这在 ArkTS 中是安全的，因为 ArkTS 的 `new` 调用总是带参数列表（即使是空的 `new Foo()`）。

---

## 项目结构

```
gitnexus/
├── vendor/tree-sitter-arkts/          # ← 改动在这里（进 git）
│   ├── grammar.js                      # 修改后的语法规则（核心）
│   ├── src/parser.c                    # 生成的 parser（可被 regenerate）
│   ├── binding.gyp                     # node-gyp 编译配置
│   ├── package.json                    # 包信息
│   └── src/tree_sitter/*.h             # tree-sitter 头文件
├── scripts/
│   └── patch-tree-sitter-arkts.sh      # postinstall 自动 patch 脚本
└── node_modules/tree-sitter-arkts/     # 不进 git，npm install 后自动 patch
```

## 自动化机制

`package.json` 的 `postinstall` 脚本会在 `npm install` 后自动执行：

```bash
bash scripts/patch-tree-sitter-arkts.sh
```

脚本做了三件事：
1. 把 `vendor/tree-sitter-arkts/grammar.js` 和 `src/parser.c` 复制到 `node_modules/tree-sitter-arkts/`
2. 运行 `tree-sitter generate` 重新生成 parser.c（确保与当前 tree-sitter 版本兼容）
3. 运行 `node-gyp rebuild` 编译 native addon

---

## 跨设备使用指南

### 新电脑首次使用

```bash
# 1. Clone
git clone git@github.com:pxinc/GitNexus.git
cd GitNexus

# 2. 切到可用分支
git checkout stable/tree-sitter-arkts

# 3. 安装依赖（postinstall 会自动 patch parser）
cd gitnexus
npm install --legacy-peer-deps

# 4. 验证（可选）
bash scripts/verify-parser.sh   # 见下方
```

### 如果 postinstall 失败（手动恢复）

```bash
cd gitnexus/node_modules/tree-sitter-arkts

# 复制改好的文件
cp ../../vendor/tree-sitter-arkts/grammar.js .
cp ../../vendor/tree-sitter-arkts/src/parser.c src/

# 重新生成（确保版本兼容）
npx tree-sitter generate

# 编译
npx node-gyp rebuild
```

### 验证解析器是否正常工作

```bash
cd gitnexus

# 快速验证（单文件）
echo 'let x: number = 1' > /tmp/test.ts
cd node_modules/tree-sitter-arkts && tree-sitter parse /tmp/test.ts

# 全量验证（792 个文件）
find . -path "*/node_modules" -prune -o -type f \( -name "*.ets" -o -name "*.ts" \) -print \
  | while read f; do tree-sitter parse "$f" 2>&1 | grep -q ERROR && echo "FAIL: $f"; done
# 期望输出：无任何 FAIL
```

### 启动 GitNexus

```bash
cd gitnexus
npm run build
npm start
# 或开发模式
npm run dev
```

---

## 后续迭代

如需继续修改 grammar：

1. 编辑 `vendor/tree-sitter-arkts/grammar.js`
2. 本地测试：
   ```bash
   cp vendor/tree-sitter-arkts/grammar.js node_modules/tree-sitter-arkts/
   cd node_modules/tree-sitter-arkts
   npx tree-sitter generate
   npx node-gyp rebuild
   cd ../..
   # 跑全量验证
   ```
3. 验证通过后，更新 vendor 里的 parser.c：
   ```bash
   cp node_modules/tree-sitter-arkts/src/parser.c vendor/tree-sitter-arkts/src/
   ```
4. 提交并推送

## 踩坑记录

| 坑 | 症状 | 解决 |
|----|------|------|
| `tree-sitter generate` 静默失败 | 退出码 1 但 parser.c 不更新，grammar 改了白改 | **必须检查退出码**，确认 parser.c 时间戳更新 |
| parser.c 版本不兼容 | `node-gyp rebuild` 报 `.version` 字段错误 | 重新 `tree-sitter generate` |
| unnecessary conflicts 警告 | generate 输出大量 warning | 可忽略，不影响解析 |
| 子集≠全量 | 用 234 文件子集测试就宣布完成，实际 792 个 | **必须全量验证** |

## 分支说明

| 分支 | 用途 |
|------|------|
| `stable/tree-sitter-arkts` | 可用版，推荐使用 |
| `fix/arkts-type-assertion` | 开发分支，包含所有提交历史 |

## 相关文档

- `docs/tree-sitter-arkts-fix.md` — 详细修复记录（旧版，保留作参考）
- `memory/tasks/tree-sitter-arkts.json` — 任务声明（Obsidian 记忆系统）

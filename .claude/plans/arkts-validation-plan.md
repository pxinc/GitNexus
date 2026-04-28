# GitNexus tree-sitter-arkts 验证与修复计划

## 现状总结

### 已完成的工作
- `vendor/tree-sitter-arkts/` 目录包含修改后的 grammar.js + parser.c（进 git）
- `scripts/patch-tree-sitter-arkts.sh` postinstall 脚本自动覆盖到 node_modules
- `package.json` 配置了 `postinstall` 钩子
- ArkTS 语言 provider 实现完整（UI 组件识别、decorator、class 提取）
- 9 个 ArkTS 测试全部通过
- vendor grammar 包含 ASI 修复、trailing comma、object_type 等改动

### 发现的关键问题

#### P0: ARKTS_QUERIES 与 tree-sitter-arkts 节点类型不匹配

**问题描述**: `ARKTS_QUERIES`（tree-sitter-queries.ts:1182-1313）是为 tree-sitter-typescript 节点类型编写的，但 parser-loader 在 tree-sitter-arkts 可用时加载 tree-sitter-arkts。两者节点类型完全不同。

**实际验证结果**（通过 `node -e` 解析测试代码确认）：

| ARKTS_QUERIES 期望 | tree-sitter-arkts 实际产生 | 影响 |
|---|---|---|
| `class_declaration > type_identifier` | `class_declaration > identifier` | 类名提取失败 |
| `interface_declaration > type_identifier` | `interface_declaration > identifier` | 接口名提取失败 |
| `method_definition > property_identifier` | `method_declaration > identifier` | 方法提取失败 |
| `import_statement > string` | `import_declaration > string_literal` | import 提取失败 |
| `lexical_declaration > variable_declarator` | `variable_declaration > variable_declarator` | 变量声明箭头函数提取失败 |
| `public_field_definition > property_identifier` | `property_declaration > identifier` | 属性提取失败 |
| `class_heritage > extends_clause` | `extends` 关键字 + `identifier`（无 wrapper） | 继承关系提取失败 |
| `function_declaration` | `function_expression`（顶层函数声明也如此） | 函数提取失败 |
| `arguments` | `argument_list` | 调用参数匹配失败 |
| `string > string_fragment` | `string_literal` | 字符串匹配失败 |

**影响范围**: GitNexus 索引 ArkTS 文件时，几乎所有 query 匹配都会失败——类名、函数名、方法名、import、继承关系、调用关系都无法提取。**知识图谱基本为空**。

**现有测试为何通过**: 9 个 ArkTS 测试只验证了解析不崩溃和 decorator 存在，没有测试 query 匹配是否能提取定义。

#### P1: vendor grammar 未包含全部补丁

vendor/tree-sitter-arkts/grammar.js 缺少 `grammar-fixes.patch` 中的部分改动：
- `type_assertion` 规则（`<Type>value` 语法）— 0 匹配
- `private_field_identifier` 规则（`#x` 私有字段）— 0 匹配

这些在 `patches/tree-sitter-arkts-grammar-fixes.patch` 中有定义但未合入 vendor。

#### P2: 旧 patch 文件已过时

`gitnexus/patches/tree-sitter-arkts-grammar-fixes.patch` 使用非标准 diff 格式（无文件头），且行号与当前 grammar.js 不匹配。在 vendor 方案下此文件已不再需要。

---

## 修复方案

采用 **Option A: 为 tree-sitter-arkts 编写专用 queries**，因为：
1. tree-sitter-arkts 原生支持 ArkTS 语法（struct、decorator、component_declaration）
2. 解析率 100%（792/792）
3. 保留 tree-sitter-arkts 的价值，而不是回退到 TypeScript parser

---

## 任务拆解

### Phase 1: 验证基线（只读）

- [ ] **Task 1.1**: 运行全量测试 `npm test`，记录通过率
- [ ] **Task 1.2**: 运行 typecheck `npx tsc --noEmit`
- [ ] **Task 1.3**: 验证 vendor grammar patch 状态（对比 grammar-fixes.patch 中缺失的改动）
- [ ] **Task 1.4**: 确认 node_modules 是否已被 postinstall 正确 patch

### Phase 2: 修复 vendor grammar（合入缺失补丁）

- [ ] **Task 2.1**: 将 `type_assertion` 相关改动合入 `vendor/tree-sitter-arkts/grammar.js`
- [ ] **Task 2.2**: 将 `private_field_identifier` 相关改动合入 vendor grammar
- [ ] **Task 2.3**: 运行 `tree-sitter generate` + `node-gyp rebuild` 更新 vendor/parser.c
- [ ] **Task 2.4**: 清理或标注过时的 `patches/` 目录

### Phase 3: 编写 tree-sitter-arkts 专用 queries（核心工作）

- [ ] **Task 3.1**: 建立 tree-sitter-arkts 节点类型映射表（基于 node-types.json 和实际解析结果）
- [ ] **Task 3.2**: 编写 `ARKTS_NATIVE_QUERIES`，覆盖以下 query 类别：
  - 类定义 (`class_declaration > identifier`)
  - 接口定义 (`interface_declaration > identifier`)
  - 函数定义 (`function_expression`，注意顶层函数声明也产生此类型)
  - 方法定义 (`method_declaration > identifier`)
  - 属性定义 (`property_declaration > identifier`)
  - import (`import_declaration > string_literal`)
  - export
  - 调用关系 (`call_expression > identifier`, `member_expression`)
  - 继承关系 (`extends`, `implements_clause`)
  - 装饰器 (`decorator`)
  - 变量声明中的箭头函数 (`variable_declaration > variable_declarator > arrow_function`)
  - struct/component (`component_declaration`)
- [ ] **Task 3.3**: 更新 `arkts.ts` provider 使用新 queries
- [ ] **Task 3.4**: 更新 `parser-loader.ts` 注释（移除 "TypeScript parser" 的说法）

### Phase 4: 更新测试覆盖

- [ ] **Task 4.1**: 创建 `test/fixtures/sample-code/simple.ets`（覆盖 class/interface/function/decorator/component）
- [ ] **Task 4.2**: 增强 `arkts.test.ts`——添加 query 匹配测试（验证类名、方法名、import 能被正确提取）
- [ ] **Task 4.3**: 将 ArkTS 加入 `tree-sitter-languages.test.ts` 的 cross-language assertions
- [ ] **Task 4.4**: 添加 struct/component 声明提取测试

### Phase 5: 端到端验证

- [ ] **Task 5.1**: 运行全量测试 `npm test`
- [ ] **Task 5.2**: 运行 typecheck `npx tsc --noEmit`
- [ ] **Task 5.3**: 用真实 ArkTS 项目验证解析率（如有 arkts-test-project）
- [ ] **Task 5.4**: 验证 GitNexus 索引 .ets 文件能正确生成知识图谱

---

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| tree-sitter-arkts 节点类型文档不全 | 中 | 通过实际解析收集完整节点类型（已完成） |
| function_expression vs function_declaration 歧义 | 中 | 通过上下文（是否在 expression_statement 内）区分 |
| struct 语法节点未被 query 覆盖 | 低 | component_declaration 已在 arkts provider 中处理 |
| 修改影响其他语言 | 低 | ArkTS queries 独立，不影响其他语言的 queries |

## 关键文件清单

| 文件 | 作用 |
|------|------|
| `gitnexus/src/core/ingestion/tree-sitter-queries.ts` | **核心修改** — 编写 ARKTS_NATIVE_QUERIES |
| `gitnexus/src/core/ingestion/languages/arkts.ts` | 更新 queries 引用 |
| `gitnexus/src/core/tree-sitter/parser-loader.ts` | 更新注释 |
| `gitnexus/vendor/tree-sitter-arkts/grammar.js` | 合入缺失补丁 |
| `gitnexus/test/integration/languages/arkts.test.ts` | 增强测试 |
| `gitnexus/test/integration/tree-sitter-languages.test.ts` | 加入 ArkTS |
| `gitnexus/test/fixtures/sample-code/simple.ets` | 新建测试 fixture |

## 预计工作量

- Phase 1: ~10 分钟（验证命令）
- Phase 2: ~30 分钟（grammar 合入 + regenerate）
- Phase 3: ~1-2 小时（query 编写 + 验证，核心工作）
- Phase 4: ~30 分钟（测试编写）
- Phase 5: ~15 分钟（端到端验证）

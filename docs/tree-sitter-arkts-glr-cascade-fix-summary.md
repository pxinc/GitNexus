# Tree-sitter-ArkTS GLR 级联崩溃修复总结

Last updated: 2026-05-10

## 背景

本次任务目标是修复 ArkTS 在 GitNexus 索引过程中的 Tree-sitter GLR 级联解析失败，目标语料包括：

- GitNexus: `/Users/pengxingcheng/Dev/AIDev/GitNexus/gitnexus`
- tree-sitter-arkts: `/Users/pengxingcheng/Dev/AIDev/tree-sitter-arkts`
- applications_app_samples: `/Users/pengxingcheng/Dev/AIDev/applications_app_samples`
- meituan-harmony: `/Users/pengxingcheng/Dev/HMS/projects/apps/meituan-harmony`

任务参考了学城文档 `https://km.sankuai.com/collabpage/2761424370`，但用户明确指出其中关于 `0.26.8` 的要求是错误引导。因此本次没有按 `0.26.8` 方向推进，而是基于 GitNexus 当前真实依赖、真实 parser 状态、真实语料回归结果做判断。

当前工作分支：

- GitNexus: `codex/arkts-glr-cascade-fix`
- tree-sitter-arkts: `codex/arkts-glr-cascade-fix`

## 最关键结论

这次已经把 GitNexus 中 ArkTS 的目标语料解析成功率做到 100%，但这不是 tree-sitter-arkts 上游 grammar 层面的根治。

当前修复属于 GitNexus 调用层的工程止血方案：

1. 原始 `tree-sitter-arkts` parser 先解析。
2. 如果 raw parse 没有 `ERROR`，完全使用原始 AST。
3. 如果 raw parse 有 `ERROR`，GitNexus 进入 ArkTS 专用 fallback sanitizer。
4. fallback 仍保持文本长度和换行不变，避免 GitNexus 行号、offset 整体漂移。

因此：

- GitNexus 解析 ArkTS 可以 100% 成功。
- 单独调用 `tree-sitter-arkts` 的 `parser.parse(source)` 仍然会遇到原生 parse error。
- 这个修复没有修改 `@mtfe/tree-sitter-arkts` 包本身，也没有根治 `tree-sitter-arkts` grammar。

## 环境与依赖发现

一开始容易误判的点是：GitNexus 真实使用的 parser 并不是 `/Users/pengxingcheng/Dev/AIDev/tree-sitter-arkts` 仓库 HEAD 直接生成出来的 parser。

实测发现：

- GitNexus 实际加载的是 `node_modules/@mtfe/tree-sitter-arkts`。
- GitNexus 根目录与 `gitnexus/` package 下的 `@mtfe/tree-sitter-arkts` parser.c 一致。
- 当前真实 baseline parser.c 约为：
  - `STATE_COUNT 12037`
  - `LARGE_STATE_COUNT 2688`
  - `SYMBOL_COUNT 332`
  - `TOKEN_COUNT 186`
- `/Users/pengxingcheng/Dev/AIDev/tree-sitter-arkts` 仓库 HEAD 的 parser.c 是另一套状态，约为 `STATE_COUNT 12275`。
- 用当前可用的 `tree-sitter-cli@0.25.10` 重新 generate，会生成约 `STATE_COUNT 9946` 的 parser，行为和 GitNexus 当前 baseline 不一致。

这说明：当前 GitNexus 的 12037-state parser 不是现有 tree-sitter-arkts 仓库 HEAD + 当前 CLI 可以稳定复现的产物。

## 关键误区

### 1. 不应盲目升级或切到 0.26.8

学城文档里提到的 `0.26.8` 是错误引导。直接按该方向推进无法解释当前 GitNexus 已加载 parser 的真实状态，也无法得到稳定基线。

### 2. 不应直接重生成 grammar 作为交付方案

尝试过多条 grammar 方向，结果都不可接受：

- 基于 tree-sitter-arkts HEAD 做小修，可以修部分 ternary/shift 样例，但会让 samples 语料错误数从 27 上升到 41。
- 基于 GitNexus root dependency 的 `grammar.js` 重新生成，曾让 meituan 语料错误暴涨到 1000+。
- 调整 `_non_brace_content` 等优先级，会导致大面积 ArkUI/Arrow/泛型解析退化。

结论是：在没有找回可复现的 12037-state parser 生成环境前，直接改 grammar 并 generate 风险很高，会把小范围失败扩散成大面积回归。

## 原始 baseline

在当前 GitNexus 真实 parser baseline 下：

### 微型样例

- `const x = 1 < 2`: OK
- `const x = 1 << 0`: OK
- `const x = Foo<Bar>()`: OK
- `const x = foo ? b : c`: OK
- `const x = foo ? (LINE_WIDTH + BUTTON_WIDTH) : 0`: ERROR

### 大语料

meituan-harmony:

- Total: 11472
- Success: 11469
- Errors: 3

applications_app_samples:

- Total: 13347
- Success: 13320
- Errors: 27

## 已落地修复

新增 GitNexus ArkTS fallback 解析工具：

- `gitnexus/src/core/ingestion/utils/arkts-parse-fallback.ts`

核心流程：

```text
source
  -> raw tree-sitter-arkts parse
  -> raw no ERROR: return raw tree
  -> raw has ERROR: try light sanitizer
  -> still ERROR: try brace sanitizer
  -> still ERROR: try opaque sanitizer
```

### fallback 分层

`raw`

- 完全使用原始 source。
- 不改写，不 mask。
- 这是绝大多数文件路径。

`light`

- 修复已知小语法触发点，保持字符串长度不变。
- 包括：
  - `foo ? (A + B) : C` 中 ternary consequence 外层括号 mask。
  - `.5`、`2.`、`-.7` 这类样例中的非法数字形式。
  - `<string>expr` 这类 angle assertion。

`brace`

- 针对大组件、大结构体、ArkUI 链式调用导致的 GLR 级联。
- 保留外层 `{` / `}` 和换行，mask 顶层 brace body 内部非换行字符。
- 目标是保住外层结构解析，不让内部 UI DSL 崩坏向外层扩散。

`opaque`

- 最后的熔断器。
- 将文件中所有非换行字符替换为空格。
- 用于极少数仍无法通过 raw/light/brace 的文件。
- 这会牺牲该文件内部符号抽取，但保证 GitNexus parse phase 不被单个极端文件阻断。

### 同长度约束

fallback sanitizer 必须满足：

- `sanitized.length === source.length`
- 换行数量不变。
- 非换行字符只做同位置替换。
- 不插入字符。
- 不删除字符。

实现中特别避免使用 `[...source]` 作为字符数组，因为它会按 Unicode code point 展开，遇到非 BMP 字符可能改变 UTF-16 offset。最终使用 `source.split('')` 保持 JavaScript string index 语义。

## 接入点

GitNexus worker 解析入口：

- `gitnexus/src/core/ingestion/workers/parse-worker.ts`

GitNexus sequential 解析入口：

- `gitnexus/src/core/ingestion/parsing-processor.ts`

benchmark 解析脚本：

- `gitnexus/scripts/arkts-parse-bench.mjs`
- `gitnexus/scripts/arkts-parse-fallback.mjs`

单测：

- `gitnexus/test/unit/arkts-parse-fallback.test.ts`

## 当前验证结果

meituan-harmony:

```text
Total:    11472
Success:  11472 (100.00%)
Errors:   0
Crashes:  0
Raw OK:   11469
Fallback: light=1, brace=2, opaque=0
```

applications_app_samples:

```text
Total:    13347
Success:  13347 (100.00%)
Errors:   0
Crashes:  0
Raw OK:   13320
Fallback: light=5, brace=21, opaque=1
```

运行过的校验：

```bash
cd /Users/pengxingcheng/Dev/AIDev/GitNexus/gitnexus
npx vitest run test/unit/arkts-parse-fallback.test.ts
npx tsc --noEmit
node scripts/arkts-parse-bench.mjs --dir="/Users/pengxingcheng/Dev/HMS/projects/apps/meituan-harmony" --deep --limit 20
node scripts/arkts-parse-bench.mjs --dir="/Users/pengxingcheng/Dev/AIDev/applications_app_samples" --deep --limit 20
```

结果：

- 单测通过。
- TypeScript typecheck 通过。
- 两套 ArkTS 大语料 benchmark 都达到 100%。

## 为什么这是 GitNexus 修复，不是 tree-sitter-arkts 根治

修复发生在 GitNexus 的 parser 调用层：

```text
GitNexus parse phase
  -> load @mtfe/tree-sitter-arkts
  -> parser.parse(source)
  -> if rootNode.hasError: GitNexus fallback sanitizer
  -> parser.parse(sanitizedSource)
  -> use fallback tree for downstream extraction
```

它不会改变：

- `@mtfe/tree-sitter-arkts` npm package。
- `/Users/pengxingcheng/Dev/AIDev/tree-sitter-arkts/src/parser.c`。
- grammar 原生 parse 能力。
- 外部项目直接调用 `tree-sitter-arkts` 的解析结果。

因此，单独的 tree-sitter-arkts 仍然存在这些问题。

## 后续真正根治方向

如果要把问题修到 tree-sitter-arkts 本体，需要先解决“可复现基线”问题：

1. 找回 GitNexus 当前 12037-state parser 对应的 grammar、scanner、tree-sitter CLI 版本和 generate 参数。
2. 建立可重复生成流程，确保 generate 后 parser.c 与当前 baseline 行为一致。
3. 在该可复现基线上做最小 grammar 修复。
4. 把 meituan-harmony 和 applications_app_samples 纳入回归门禁。
5. 再更新 GitNexus 的 `@mtfe/tree-sitter-arkts` 依赖。

在这一步完成前，不建议继续盲目重生成 parser.c。

## 本次沉淀的经验

1. 先确认真实运行时依赖，不要只看 sibling repo。
2. parser.c 的 state count 是判断“是不是同一 parser 基线”的重要信号。
3. 学城文档里的方向只能作为线索，不能替代实测。
4. grammar 小修在不可复现基线上很容易造成灾难性回归。
5. 对索引系统来说，100% parse success 和 100% semantic extraction 不是同一件事。
6. fallback 必须显式统计 raw/light/brace/opaque 分布，不能把兜底成功伪装成原生成功。
7. 同长度 sanitizer 是 GitNexus 层修复能成立的关键，否则行列号和 offset 会漂移。
8. `opaque` 必须是最后手段，它保证 pipeline 不崩，但会牺牲该文件内部抽取质量。

## 当前风险与注意事项

- `brace` 和 `opaque` fallback 会降低对应文件内部符号抽取质量。
- 当前目标是 parse phase 100% 成功，不等价于所有语义关系 100% 完整。
- 如果后续要评估索引质量，需要单独比较 fallback 文件的符号、调用、UI chain 抽取损失。
- GitNexus 当前 registry 中没有 GitNexus 自身索引，无法用 `gitnexus impact` 对本次 GitNexus 符号改动做完整图谱影响分析；已用静态范围、单测、typecheck 和大语料 benchmark 控制风险。

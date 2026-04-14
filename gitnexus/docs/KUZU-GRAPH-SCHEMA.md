# GitNexus Graph Schema — Kuzu (LadybugDB) Reference

> For use with `gitnexus cypher` queries. All relationships use a single `CodeRelation` table with `r.type` discriminator.

## MCP Tools Quick Reference

### `gitnexus_dependencies` — Module-level dependency analysis

The recommended way to find who imports/depends on a module or symbol. No Cypher needed.

```bash
# Who imports @meituan/mrouter?
gitnexus dependencies "@meituan/mrouter" -r meituan-harmony

# What does EntryAbility depend on?
gitnexus dependencies "EntryAbility" --direction downstream -r meituan-harmony

# Only EXTENDS/IMPLEMENTS relationships
# (via MCP: relationTypes parameter)
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target` | string | required | Module path (`@meituan/mrouter`), symbol name (`MRouter`), or file path substring |
| `direction` | `upstream`/`downstream` | `upstream` | upstream = who depends on this; downstream = what this depends on |
| `relationTypes` | string[] | `['IMPORTS','EXTENDS','IMPLEMENTS']` | Filter by relationship types |
| `minConfidence` | number | 0.5 | Minimum confidence threshold |
| `includeTests` | boolean | false | Include test files |

**Returns:** `{ target, direction, total, summary, modules, dependencies }`

### Other MCP Tools

| Tool | When to use |
|------|-------------|
| `dependencies` | Module/file-level dependency relationships |
| `query` | Search execution flows by concept |
| `context` | 360-degree view of a symbol |
| `impact` | Symbol-level blast radius analysis |
| `cypher` | Raw graph queries (see schema below) |

## Cypher Quick Reference

```cypher
-- Find who imports a module
MATCH (a:File)-[r:CodeRelation]->(b:File)
WHERE r.type = 'IMPORTS' AND b.filePath CONTAINS 'mrouter'
RETURN a.filePath, b.filePath

-- Find callers of a function
MATCH (a:Function)-[r:CodeRelation]->(b:Function)
WHERE r.type = 'CALLS' AND b.name = 'navigate'
RETURN a.name, a.filePath, b.name, b.filePath

-- Find class hierarchy
MATCH (a:Class)-[r:CodeRelation]->(b:Class)
WHERE r.type = 'EXTENDS' AND a.name = 'MRouter'
RETURN a.name, b.name
```

## Node Types

### File System

| Label | Key Properties | Description |
|-------|---------------|-------------|
| `File` | `filePath`, `name`, `content` | Source file |
| `Folder` | `filePath`, `name` | Directory |
| `Section` | `filePath`, `startLine`, `endLine`, `level`, `content` | Markdown heading |

### Code Symbols

All code symbols share these common properties: `id`, `name`, `filePath`, `startLine`, `endLine`, `isExported`, `content`, `description`

| Label | Extra Properties | Languages |
|-------|-----------------|-----------|
| `Function` | — | All |
| `Class` | — | All |
| `Interface` | — | TS, Java, C#, Go, PHP |
| `Method` | `parameterCount`, `returnType` | All |
| `Property` | `declaredType` | All |
| `Constructor` | — | All |
| `Enum` | — | All |
| `Struct` | — | C, C++, Go, Rust, **ArkTS** |
| `CodeElement` | — | Generic fallback |

### Language-Specific

| Label | Languages |
|-------|-----------|
| `Trait` | Rust, PHP |
| `Impl` | Rust |
| `Template` | C++, Rust |
| `Typedef` | C, C++ |
| `Union` | C, C++ |
| `Namespace` | C#, C++, PHP |
| `TypeAlias` | TypeScript |
| `Const` | All |
| `Static` | All |
| `Record` | C# |
| `Delegate` | C# |
| `Annotation` | Java, C# |
| `Macro` | C, C++, Rust |
| `Module` | Ruby, Python |

### Analysis

| Label | Key Properties | Description |
|-------|---------------|-------------|
| `Community` | `label`, `heuristicLabel`, `keywords`, `cohesion`, `symbolCount` | Functional area (Leiden algorithm) |
| `Process` | `label`, `processType`, `stepCount`, `communities` | Execution flow trace |
| `Route` | `name`, `responseKeys`, `errorKeys`, `middleware` | API endpoint |
| `Tool` | `name`, `description` | MCP tool definition |

## Relationship Types

All edges are stored as `CodeRelation` with these properties:
- `r.type` (STRING) — relationship type
- `r.confidence` (DOUBLE) — resolution quality (0.0–1.0)
- `r.reason` (STRING) — why this relationship was created
- `r.step` (INT32) — position in execution flow (STEP_IN_PROCESS only)

### Structural

| r.type | From → To | Meaning |
|--------|-----------|---------|
| `CONTAINS` | Folder → Folder/File | File system hierarchy |
| `DEFINES` | File → Symbol | File defines this symbol |
| `MEMBER_OF` | Symbol → Community | Community membership |

### Code Flow

| r.type | From → To | Meaning |
|--------|-----------|---------|
| `IMPORTS` | File → File | Import/require statement |
| `CALLS` | Function → Function/Method | Function call |
| `EXTENDS` | Class → Class | Inheritance |
| `IMPLEMENTS` | Class → Interface | Interface implementation |
| `HAS_METHOD` | Class → Method | Class method |
| `HAS_PROPERTY` | Class → Property | Class property |
| `ACCESSES` | Function → Property | Field read/write |

### Method Resolution

| r.type | From → To | Meaning |
|--------|-----------|---------|
| `METHOD_OVERRIDES` | Class → Method | Override resolution |
| `METHOD_IMPLEMENTS` | Class → Method | Interface method impl |

### Execution Flow

| r.type | From → To | Meaning |
|--------|-----------|---------|
| `STEP_IN_PROCESS` | Symbol → Process | Execution flow step (ordered by `r.step`) |
| `ENTRY_POINT_OF` | Route/Tool → Process | Entry point linkage |

### API / Web Framework

| r.type | From → To | Meaning |
|--------|-----------|---------|
| `HANDLES_ROUTE` | File → Route | Route handler registration |
| `FETCHES` | File → Route | HTTP fetch call |
| `QUERIES` | File → Model | ORM dataflow (Prisma, Supabase) |
| `HANDLES_TOOL` | File → Tool | MCP tool definition |

## Kuzu Syntax Notes

- No `type(r)` function — use `r.type` property
- No `properties(r)` — access properties directly (`r.type`, `r.confidence`)
- File node uses `filePath` not `path`
- `RETURN DISTINCT a.x AS alias` may fail — use `RETURN DISTINCT a.x` without alias, or just `RETURN a.x`
- `CONTAINS` is for string matching in WHERE clauses: `b.filePath CONTAINS 'keyword'`
- Use `CALL show_tables() RETURN *` to list all tables
- Use `MATCH (n:Label) RETURN n.* LIMIT 2` to discover node properties

## Common Queries

```cypher
-- What does this file import?
MATCH (a:File)-[r:CodeRelation]->(b:File)
WHERE r.type = 'IMPORTS' AND a.filePath CONTAINS 'EntryAbility'
RETURN a.filePath, b.filePath

-- What calls this function?
MATCH (a)-[r:CodeRelation]->(b:Function)
WHERE r.type = 'CALLS' AND b.name = 'MRouter'
RETURN a.name, a.filePath

-- Class inheritance tree
MATCH (a:Class)-[r:CodeRelation]->(b:Class)
WHERE r.type = 'EXTENDS'
RETURN a.name, b.name

-- Symbols in a community
MATCH (s)-[r:CodeRelation]->(c:Community)
WHERE r.type = 'MEMBER_OF' AND c.label CONTAINS 'router'
RETURN s.name, s.filePath, c.label

-- Execution flow steps
MATCH (s)-[r:CodeRelation]->(p:Process)
WHERE r.type = 'STEP_IN_PROCESS' AND p.label CONTAINS 'navigation'
RETURN s.name, r.step, p.label
ORDER BY r.step

-- All routes in the project
MATCH (f:File)-[r:CodeRelation]->(route:Route)
WHERE r.type = 'HANDLES_ROUTE'
RETURN f.filePath, route.name

-- Files that fetch a specific API
MATCH (f:File)-[r:CodeRelation]->(route:Route)
WHERE r.type = 'FETCHES'
RETURN f.filePath, route.name, r.reason
```

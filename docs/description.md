# Description

What `socialcalc-mcp` is, how it is put together, and how its tools behave.

## What it is

`socialcalc-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server for **SocialCalc workbooks**. It exposes spreadsheet operations (inspect, edit, style, import, export) as MCP tools, so an AI assistant can work on a spreadsheet file the way a person would, without writing parsing code.

SocialCalc is the spreadsheet engine originally written by Dan Bricklin. The sister project [`socialcalc-ai`](https://github.com/aspiringsdgs/socialcalc-ai) is a modernised build of that engine with React/Ionic UI components. This server edits the same workbook files that engine loads, so a workbook an assistant produces here can be opened in an app built on `socialcalc-ai`.

| Item | Value |
| :--- | :--- |
| npm package | [`socialcalc-mcp`](https://www.npmjs.com/package/socialcalc-mcp) |
| GitHub Packages | `@aspiringsdgs/socialcalc-mcp` |
| License | MIT |
| Language | TypeScript, compiled to ES modules |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Transports | stdio (MCP) and an optional local HTTP bridge |

## How it works

```
 MCP client ──stdio──▶  src/index.ts ──▶  src/server.ts ──▶ services ──▶ adapters ──▶ .json / .msc / .csv
 (Claude, Cursor…)            │              (tool registry)   (sheet,      (parse,
                              │                                 styles,      serialise)
 Browser test UI ──HTTP──▶ :5002 bridge                         formulas)
```

1. **`src/index.ts`** starts the MCP server on stdio and, only when enabled with `--http`, an HTTP server (default `127.0.0.1:5002`) that exposes the same tools to browsers.
2. **`src/server.ts`** holds the tool definitions (name, description, JSON schema), `listTools()`, and the handler that dispatches a call to the right operation. Every tool call loads the workbook from disk, applies the change, and writes it back when the tool modifies data.
3. **`src/services/`** implements the operations: `workbook` (load, save, create), `sheet` (rows, columns, ranges), `styles` (fonts, borders, colours, formats) and `formulas` (the formula catalogue behind `get_formulas`).
4. **`src/adapters/`** converts between files and the in-memory model. The SocialCalc adapter reads and writes the JSON workbook format, and the CSV adapter converts a single sheet.
5. **`src/models/`** defines `Workbook`, `Sheet`, `Cell` and `Table`.

## Workbook files

| Format | Supported by | Notes |
| :--- | :--- | :--- |
| `.json` | All core tools | SocialCalc multi-sheet workbook as JSON |
| `.msc` | All core tools | MultiSheet Calc, the same workbook structure |
| `.csv` | `import_from_csv`, `export_to_csv` | One sheet at a time |
| `.xlsx` | `import_from_xlsx`, `export_to_xlsx` | **Not implemented yet.** The tools are registered but return an error |

State lives entirely in the files. The server keeps no session, so each call names the workbook it works on with `workbookPath`.

## Tool groups

The server registers 39 tools in five groups. Full parameters are in the [README](../README.md#tool-reference).

| Group | Tools | Typical use |
| :--- | :--- | :--- |
| Inspection | `list_workbooks`, `list_sheets`, `read_sheet`, `read_range`, `get_sheet_dimensions`, `describe_sheet`, `summarize_workbook`, `summarize_sheet` | Let the assistant see what is in a workbook before it edits |
| Structure | `new_workbook`, `new_sheet`, `rename_sheet`, `insert_row`, `insert_col`, `delete_row`, `delete_col`, `set_col_width` | Build or reshape a workbook |
| Editing and styling | `write_range`, `delete_text`, `set_cell_to_default`, `format_cells`, `set_font_*`, `set_cell_bg`, `set_border`, `set_padding`, `set_alignment`, `set_format`, `merge_cells`, `unmerge_cells` | Fill cells and make them look right |
| Reference | `get_formulas`, `describe_formula`, `list_tool`, `describe_tool` | Let the assistant look up formulas and tool usage itself |
| Import and export | `import_from_csv`, `export_to_csv`, `import_from_xlsx`, `export_to_xlsx` | Move data in and out |

### Conventions that apply to every tool

- **Paths**: `workbookPath`, `csvPath`, `xlsxPath` and `directoryPath` are resolved against the allowed directory (`SOCIALCALC_FILES_DIR`, default the working directory) and rejected if they leave it, including through `..` and symlinks. This check runs for every tool in one place (`executeTool`, using `src/utils/paths.ts`).
- **Sheet selection**: pass `sheetName` or a 1-based `sheetNumber`. `sheetNumber` wins if both are given. If neither is given, the active sheet is used.
- **Ranges**: A1 notation. A single cell (`B2`) or a rectangle (`A1:C10`).
- **Reads** return Markdown tables, which are cheap for a model to read.
- **Errors** come back as an MCP result with `isError: true` and a message beginning `Error:`, rather than crashing the server.

## HTTP bridge

The bridge lets a web page drive the same tools without an MCP client. It is a development aid, not a production API, and it is **off unless started with `--http`** (or `SOCIALCALC_HTTP=1`).

| Endpoint | Purpose |
| :--- | :--- |
| `GET /tools` | List tools |
| `POST /call` | Run a tool: `{ "name": "...", "arguments": { ... } }` |
| `POST /sync` | Write browser-side workbook data to a file: `{ "workbookPath", "mscData" }` |
| `GET /read-file?path=...` | Read a workbook file back |

Defaults are restrictive: it binds to `127.0.0.1`, every request needs a bearer token (generated at startup if `SOCIALCALC_HTTP_TOKEN` is not set), `POST` bodies must be `application/json`, and no CORS headers are sent unless the caller's origin is listed in `SOCIALCALC_CORS_ORIGINS`. `/sync` and `/read-file` accept only `.json` and `.msc` files inside the allowed directory. See the [README](../README.md#http-bridge) for all settings.

## Known limitations

- XLSX import and export are placeholders and always return an error.
- The only automated tests cover path confinement and the HTTP bridge defaults (`test/security.test.mjs`). There are no tests for the individual spreadsheet tools yet.
- Confinement relies on the allowed directory. With the default (the working directory), a client that starts the server in `/` allows the whole filesystem, so set `SOCIALCALC_FILES_DIR` for GUI clients.

## Related projects

| Project | Role |
| :--- | :--- |
| [`socialcalc-ai`](https://github.com/aspiringsdgs/socialcalc-ai) | The spreadsheet engine and React/Ionic UI suite that consumes these workbooks |

# SocialCalc MCP Server

[![npm version](https://img.shields.io/npm/v/socialcalc-mcp.svg?color=cb3837&style=flat-square)](https://www.npmjs.com/package/socialcalc-mcp)
[![npm downloads](https://img.shields.io/npm/dm/socialcalc-mcp.svg?style=flat-square)](https://www.npmjs.com/package/socialcalc-mcp)
[![License: MIT](https://img.shields.io/github/license/aspiringsdgs/socialcalc-mcp.svg?style=flat-square)](LICENSE)
[![Issues](https://img.shields.io/github/issues/aspiringsdgs/socialcalc-mcp.svg?style=flat-square)](https://github.com/aspiringsdgs/socialcalc-mcp/issues)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets AI assistants **read, edit, style and analyse SocialCalc spreadsheet workbooks**. It works with any MCP client, including **Claude Desktop**, **Claude Code**, **Cursor**, **VS Code** and **Windsurf**.

The server speaks MCP over **stdio**. It also starts a small optional **HTTP bridge** on port `5002`, which browser-based test UIs can use.

| | |
| :--- | :--- |
| **npm** | [`socialcalc-mcp`](https://www.npmjs.com/package/socialcalc-mcp) |
| **GitHub Packages** | [`@aspiringsdgs/socialcalc-mcp`](https://github.com/aspiringsdgs/socialcalc-mcp/pkgs/npm/socialcalc-mcp) |
| **Source** | [aspiringsdgs/socialcalc-mcp](https://github.com/aspiringsdgs/socialcalc-mcp) |
| **Related** | [`socialcalc-ai`](https://github.com/aspiringsdgs/socialcalc-ai), the spreadsheet engine and React/Ionic UI suite this server edits workbooks for |

---

## Contents

- [Quick start](#quick-start)
- [Connect an AI client](#connect-an-ai-client)
- [How workbooks are addressed](#how-workbooks-are-addressed)
- [Tool reference](#tool-reference)
- [HTTP bridge](#http-bridge)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

---

## Quick start

No install is needed. Run the server straight from npm:

```bash
npx -y socialcalc-mcp
```

The process waits for an MCP client on stdin/stdout, so you normally configure a client to launch it instead of running it by hand (see below).

Requirements: **Node.js 18 or newer**.

## Connect an AI client

### Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "socialcalc-mcp": {
      "command": "npx",
      "args": ["-y", "socialcalc-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add socialcalc-mcp -- npx -y socialcalc-mcp
```

### Cursor / Windsurf

Add the same `mcpServers` block as above to `~/.cursor/mcp.json` (Cursor) or `~/.codeium/windsurf/mcp_config.json` (Windsurf).

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "socialcalc-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "socialcalc-mcp"]
    }
  }
}
```

Restart the client after changing its configuration. Ask it to "list the tools on the socialcalc-mcp server" to confirm the connection.

## How workbooks are addressed

Every tool that touches a workbook takes a `workbookPath`.

- Only SocialCalc JSON workbooks (`.json`, `.msc`) can be edited directly. Use [`import_from_csv`](#5-csv--xlsx-import--export) to bring a CSV in and `export_to_csv` to get a sheet back out. XLSX is [not implemented yet](#5-csv--xlsx-import--export).
- Relative paths resolve against the **working directory of the server process**, and `list_workbooks` defaults to `./data`. GUI clients such as Claude Desktop do not start the server in your project folder, so pass **absolute paths** there.
- Sheet-level tools accept a `sheetName` or a 1-based `sheetNumber`. If both are given, `sheetNumber` wins. If neither is given, the workbook's active sheet is used.
- Ranges use A1 notation, for example `B2`, `A1:C10`.

## Tool reference

> [!IMPORTANT]
> Core editing, styling and inspection tools only accept `.json` and `.msc` SocialCalc workbooks. Use the CSV tools for other formats.

The server registers **39 tools**. `req` means required, `opt` means optional.

### 1. Workbook inspection & navigation

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `list_workbooks` | `directoryPath` (opt) | Lists workbook files in a directory (defaults to `./data`). |
| `list_sheets` | `workbookPath` (req) | Lists sheet names and metadata in a workbook. |
| `read_sheet` | `workbookPath` (req), `sheetName`/`sheetNumber` (opt) | Reads a whole sheet as a Markdown table plus raw cell details. |
| `read_range` | `workbookPath` (req), `range` (req), `sheetName`/`sheetNumber` (opt) | Reads a range such as `A1:C10` as a Markdown table. |
| `get_sheet_dimensions` | `workbookPath` (req), `sheetName`/`sheetNumber` (opt) | Returns row and column counts. |
| `describe_sheet` | `workbookPath` (req), `sheetName`/`sheetNumber` (opt) | Returns sheet details, column headers and size. |
| `summarize_workbook` | `workbookPath` (req) | Summarizes all sheets: dimensions, hidden status, cell counts. |
| `summarize_sheet` | `workbookPath` (req), `sheetName`/`sheetNumber` (opt) | Returns a numeric and textual summary of populated cells. |

### 2. Structure & workbook modification

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `new_workbook` | `workbookPath` (req), `sheetName` (opt) | Creates a new workbook file with an initial sheet. |
| `new_sheet` | `workbookPath` (req), `sheetName` (req) | Adds an empty worksheet. |
| `rename_sheet` | `workbookPath` (req), `oldName` (req), `newName` (req) | Renames a worksheet. |
| `insert_row` | `workbookPath` (req), `row` (req), `count` (opt), `position` (opt) | Inserts row(s) before or after a row index. |
| `insert_col` | `workbookPath` (req), `column` (req), `count` (opt), `position` (opt) | Inserts column(s) before or after a column letter. |
| `delete_row` | `workbookPath` (req), `row` (req), `count` (opt) | Deletes rows starting at an index. |
| `delete_col` | `workbookPath` (req), `column` (req), `count` (opt) | Deletes columns starting at a letter. |
| `set_col_width` | `workbookPath` (req), `column` (req), `width` (req) | Sets a column width in pixels. |

### 3. Editing & styling

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `write_range` | `workbookPath` (req), `range` (req), `value`/`data` (opt) | Writes a value or a 2D array starting at a cell. Formulas are supported. |
| `delete_text` | `workbookPath` (req), `range` (req) | Clears values and formulas, keeping styling. |
| `set_cell_to_default` | `workbookPath` (req), `range` (req) | Resets content, formula and layout to defaults. |
| `format_cells` | `workbookPath` (req), `range` (req), `bold`, `textColor`, `bgColor`, `align` (opt) | Applies bold, text colour, background colour and alignment in one call. |
| `set_font_color` | `workbookPath` (req), `range` (req), `color` (req) | Sets text colour (`rgb(255,0,0)`, `#ff0000`). |
| `set_cell_bg` | `workbookPath` (req), `range` (req), `color` (req) | Sets background colour. |
| `set_border` | `workbookPath` (req), `range` (req), `border`/`top`/`right`/`bottom`/`left` (opt) | Applies a border shorthand or per-side overrides (`1px solid rgb(0,0,0)`). |
| `set_padding` | `workbookPath` (req), `range` (req), `padding`/`top`/`right`/`bottom`/`left` (opt) | Applies padding (`5px 10px`). |
| `set_alignment` | `workbookPath` (req), `range` (req), `align`/`verticalAlign` (opt) | Sets horizontal and vertical alignment. |
| `set_font_size` | `workbookPath` (req), `range` (req), `size` (req) | Sets font size (`12pt`, `14px`). |
| `set_font_family` | `workbookPath` (req), `range` (req), `family` (req) | Sets font family (`Arial`, `Courier New`). |
| `set_font_style` | `workbookPath` (req), `range` (req), `style`/`bold` (opt) | Sets italic/normal and bold/normal. |
| `set_format` | `workbookPath` (req), `range` (req), `format` (req) | Applies a number or text format (`HTML`, `0.00%`, `$#,##0.00`). |
| `merge_cells` | `workbookPath` (req), `range` (req) | Merges a range. |
| `unmerge_cells` | `workbookPath` (req), `range` (req) | Splits merged cells. |

### 4. Formula reference & server help

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `get_formulas` | `category` (opt) | Lists available SocialCalc formulas, optionally by category. |
| `describe_formula` | `name` (req) | Explains one formula with an example. |
| `list_tool` | none | Lists every tool registered on the server. |
| `describe_tool` | `toolName` (req) | Describes a tool's parameters. |

### 5. CSV & XLSX import / export

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `export_to_csv` | `workbookPath` (req), `csvPath` (req), `sheetName`/`sheetNumber` (opt) | Exports one sheet to a CSV file. |
| `import_from_csv` | `csvPath` (req), `workbookPath` (req), `sheetName` (opt) | Imports a CSV file into a sheet. |
| `export_to_xlsx` | `workbookPath` (req), `xlsxPath` (req) | **Not implemented yet.** Registered, but always returns an error. |
| `import_from_xlsx` | `xlsxPath` (req), `workbookPath` (req) | **Not implemented yet.** Registered, but always returns an error. |

> [!NOTE]
> The two XLSX tools are placeholders: the adapter in `src/adapters/xlsx/index.ts` throws until an Excel library such as `exceljs` is added. Use the CSV tools for now.

## HTTP bridge

Besides stdio, the process starts an HTTP server for browser-based clients.

| Setting | Value |
| :--- | :--- |
| Default port | `5002` |
| Override | `SOCIALCALC_PORT=5010 npx -y socialcalc-mcp` |
| If the port is taken | A warning is logged and the stdio transport keeps working. |

| Endpoint | Purpose |
| :--- | :--- |
| `GET /tools` | Lists registered tools. |
| `POST /call` | Runs a tool. Body: `{ "name": "read_sheet", "arguments": { ... } }`. |
| `POST /sync` | Writes browser-side workbook data to disk. Body: `{ "workbookPath", "mscData" }`. |
| `GET /read-file?path=...` | Reads a workbook file back. |

> [!WARNING]
> The bridge is meant for **local development**. It sends `Access-Control-Allow-Origin: *`, has no authentication, and listens on all network interfaces. `/sync` and `/read-file` only accept `.json`/`.msc` files and only paths inside the directory two levels above the installed `dist/` folder, but you should still avoid running the server on an untrusted network.

## Development

```bash
git clone https://github.com/aspiringsdgs/socialcalc-mcp.git
cd socialcalc-mcp
npm install
npm run build      # compile TypeScript to dist/
npm start          # run the compiled server
npm run dev        # run from source with tsx
```

Project layout:

| Path | Contents |
| :--- | :--- |
| `src/index.ts` | Entry point: stdio transport and HTTP bridge. |
| `src/server.ts` | Tool definitions and request handlers. |
| `src/services/` | Workbook, sheet, style and formula operations. |
| `src/adapters/` | SocialCalc and CSV readers and writers. The XLSX adapter is a stub. |
| `src/models/`, `src/utils/` | Data models, validation and helpers. |
| `data/` | Sample workbooks used by `list_workbooks`. |

## Documentation

Longer guides live in [`docs/`](docs/):

- [Setup](docs/setup.md): install, configure clients, run from source, troubleshoot.
- [Description](docs/description.md): what the server is, how it is built, and how the tools work.
- [Publish](docs/publish.md): how to cut a new release to npm and GitHub Packages.

## License

[MIT](LICENSE) © Anirudh Sharma

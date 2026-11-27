# AI Studio Cockpit

Turn **Google AI Studio** into a **Local DevOps & Office AI Assistant** with a reversible **PII Vault** — Chrome Extension (MV3) + lightweight Go Native Bridge (`127.0.0.1:8765`) + Go Office CLI (`office_agent.exe`).

## Key Capabilities

- **Reversible PII Vault (`🛡️ Сейф реквизитов`)** — Masks company names, INN, OGRN, bank accounts, cards, phones, emails, and full names into `[КОМПАНИЯ_1]`, `[ИНН_1]`, `[ФИО_1]` before sending prompts or files to the cloud, and automatically restores real values locally when writing Word/Excel files.
- **Token-Saving Office Agent (`XLSX_*` / `DOCX_*`)** — Reads/writes Excel spreadsheets (with formulas, borders, number formatting, and auto-fit columns) and generates/populates Word `.docx` contracts and templates via compact JSON commands instead of verbose scripts.
- **Go File-Agent & Auto-Linter** — Surgical codebase navigation and editing (`TREE`, `GREP`, `OUTLINE`, `READ_LINES`, `REPLACE_LINES`, `PATCH_FILE`, `CHECK_FILE`) with automatic syntax verification for Go, JS, Python, PowerShell, JSON, and YAML.
- **Agent Loop (Auto-Fix)** — Executes commands/tools with real-time WebSocket streaming (`/ws/exec`), compresses & scrubs error logs on failure, asks AI for a fix, checks dangerous commands, and retries up to N steps.
- **Per-Tab Workspace & Git Integration** — Remembers working directory per AI Studio tab, shows live Git branch/status, `Git Diff → AI`, `Rollback`, and `Code → Chat` bundler.
- **Live PTY Terminal & Snippets Vault** — Interactive local `cmd` and remote SSH terminal inside the side dock + reusable templates with `{{var=default}}` prompts.

## Quick Setup (Windows)

1. Run `powershell -ExecutionPolicy Bypass -File .\install.ps1` (builds `bridge.exe` and `modules\office_agent.exe`, sets `COCKPIT_HOME`, registers `cockpit://`, and starts the bridge).
2. Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select this folder.
3. Open [Google AI Studio](https://aistudio.google.com/) (`Alt + C` toggles the dock).

## Security

- Local HTTP/WS bridge (`127.0.0.1:8765`) restricts `Origin` to `https://aistudio.google.com` and extension pages, and requires the `X-Cockpit-Client` header on mutating endpoints.
- `.env`, private keys (`*.pem`, `*.key`, `id_rsa*`), and paths outside the active working directory are blocked.
# Changelog

All notable changes to this project will be documented in this file.

## [1.0.3] - 2026-06-24

### Fixed
- Fixed a critical `ENOENT` path resolution bug in `ZenithCompiler` where framework static assets (client runtime and dashboard files) were searched for in the developer's project directory instead of the installed framework package directory.

## [1.0.2] - 2026-06-24

### Added
- Implemented a generic OpenAI-compatible completions adapter in Rezon server runtime to allow any standard LLM provider (like OpenRouter, DashScope, Ollama, OpenAI) to run alongside Gemini.
- Added SFC compiler support to extract custom agent configurations (`agent.provider`, `agent.model`, and `agent.baseUrl`) from the Zenith script block.
- Implemented client-side passing of `llmConfig` in chat POST requests to allow dynamic model and key switching.
- Created **Nirikshak** (Hindi/Sanskrit for "Inspector"), a state-of-the-art codebase refactorer, explorer, and DevOps agent workspace under the `/nirikshak` folder.

## [1.0.1] - 2026-06-24

### Added
- Added `.env` and `.env.local` support to Rezon CLI to load environment variables (like `GEMINI_API_KEY`) without needing to manually run terminal configuration commands.
- Updated `rezon init` scaffolding to automatically create `.env` and `.env.example` templates.
- Added `.env` and `.env.local` to the default scaffolding `.gitignore` file to prevent accidental secret leaks.

### Changed
- Updated the root `README.md` and CLI startup/help messages to recommend configuration via `.env` files.
- Improved the project starter setup instructions on initialization.

---

## [1.0.0] - 2026-06-24

### Added
- Initial public release of `rezon`.
- Compiler-based reactive framework support for Single File Components.
- Native integration with Gemini tool-calling capabilities.
- Live development server with hot reloading.

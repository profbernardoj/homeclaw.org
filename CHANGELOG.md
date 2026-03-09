# EverClaw Changelog

All notable changes to EverClaw are documented here.

## [2026.3.8] - 2026-03-08

### Changed
- **PromptGuard upgraded to v3.3.0**
  - Full sync from `seojoonkim/prompt-guard` with our external content detection PR
  - New package structure (`prompt_guard/` module with scripts/ backward compatibility)
  - SHIELD.md standard compliance (11 threat categories)
  - **External Content Detection** — identifies injection from GitHub issues, PRs, emails, Slack, Discord, social media
  - **Multi-language urgency patterns** — EN/KO/JA/ZH urgency + command detection
  - **Context-aware severity elevation** — external source + instruction = CRITICAL
  - ~130 new patterns for external content injection attacks
  - Upstream PR: https://github.com/seojoonkim/prompt-guard/pull/18

---

## [2026.3.6] - 2026-03-05

### Added
- **Guided Installer** (`scripts/install-with-deps.sh`)
  - One-line install: `curl -fsSL https://get.everclaw.xyz | bash`
  - Automatic dependency detection (curl, git, Node.js, npm, Homebrew, OpenClaw)
  - Platform-specific install commands (macOS, Ubuntu, Fedora, Arch)
  - `--check-only` flag to verify environment
  - `--auto-install` flag for unattended setup
  - `--skip-openclaw` flag for existing installations
  - Bootstrap key integration (free GLM-5 starter key)

- **Bootstrap Key System** (`scripts/bootstrap-everclaw.mjs`)
  - Device fingerprint generation (hostname + MAC + platform)
  - Key request from `keys.everclaw.xyz`
  - Key storage in `~/.openclaw/.bootstrap-key`
  - GLM-5 configuration via mor-gateway provider
  - Commands: `--setup`, `--status`, `--test`, `--revoke`
  - Graduation flow: remove bootstrap key when user provides own key

- **GitHub Actions CI**
  - Automated testing on Ubuntu and macOS
  - Dependency check tests
  - Bootstrap script tests
  - Shell syntax validation

- **CloudFlare Redirect**
  - `get.everclaw.xyz` points to installer script

### Changed
- **SKILL.md**: Added Prerequisites section with dependency table
- **README.md**: Added one-line install, prerequisites table, installer options
- **bootstrap-gateway.mjs**: Removes `.bootstrap-key` when user sets own key

### Fixed
- Gateway PR #10: Auto-detect OpenClaw launchd service label (gateway vs node)

---

## [2026.2.26] - 2026-02-26

### Added
- PII Guard v2 with enhanced scanning
- ClawHub dependencies wired across 19 primary flavors
- Docker clean integration
- Three-Shifts v2 cyclic execution engine

### Changed
- Date-based versioning (YYYY.M.D format)

### Fixed
- PII purge across workspace + 34 repos + git history

---

## [2026.2.23] - 2026-02-23

### Added
- Multi-key auth rotation v2
- Gateway Guardian v5 with direct curl inference probes
- Smart session archiver

---

For earlier versions, see git history.
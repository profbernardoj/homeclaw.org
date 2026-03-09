#!/usr/bin/env python3
"""
DEPRECATED: Use 'prompt_guard' instead of 'scripts.detect'.

This module exists for backward compatibility only and will be removed in v4.0.

The prompt_guard package includes all SHIELD.md standard compliance features:
- 11 threat categories (prompt, tool, mcp, memory, supply_chain, vulnerability, fraud, policy_bypass, anomaly, skill, other)
- Confidence scoring (0-1 range, 0.85 threshold)
- ShieldDecision dataclass with Decision block output format
- ShieldAction enum (block, require_approval, log)
- External Content Detection (v3.3.0): GitHub issues, PRs, emails, Slack, Discord, social media
"""

import warnings
warnings.warn(
    "Import from 'prompt_guard' instead of 'scripts.detect'. "
    "The 'scripts.detect' module is deprecated and will be removed in v4.0.",
    DeprecationWarning,
    stacklevel=2,
)

# Re-export everything from the new package
from prompt_guard import *  # noqa: F401,F403
from prompt_guard.engine import PromptGuard  # noqa: F401
from prompt_guard.models import Severity, Action, DetectionResult, SanitizeResult  # noqa: F401
from prompt_guard.cli import main  # noqa: F401

# Re-export SHIELD.md related classes
try:
    from prompt_guard.models import ThreatCategory, ShieldAction, ShieldDecision  # noqa: F401
except ImportError:
    pass  # SHIELD.md classes may not exist in older versions

# Re-export all pattern constants for code that accesses them directly
from prompt_guard.patterns import *  # noqa: F401,F403
from prompt_guard.normalizer import HOMOGLYPHS  # noqa: F401


def analyze(text: str, context: dict = None):
    """Standalone detection function for backward compatibility."""
    pg = PromptGuard()
    return pg.analyze(text, context)


if __name__ == "__main__":
    main()
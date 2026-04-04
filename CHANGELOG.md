# Changelog

## [1.1.0] - 2026-04-04
### Added
- **Unified Node Detail Modal**: Full-bleed, debate-style page takeover for single-node inspection with live markdown editing. Click-to-edit, blur-to-save.
- **Smooth Trackpad Pinch-to-Zoom**: Proportional zoom using gesture magnitude (`Math.exp`) for natural macOS trackpad support. Zoom centers on cursor position.
- **Cycling "Thinking..." Animation**: AI status now shows `Thinking.` → `Thinking..` → `Thinking...` while streaming.
- **Search Grounding by Default**: Gemini API calls now include Google Search grounding out of the box.
- **Modular Architecture**: Extracted `ai.js`, `debate.js`, `event-bus.js`, `markdown.js`, and `node-detail-modal.js` into standalone modules with full test coverage (92 tests).

### Fixed
- **Critical: App Crash on Startup** — `NodeDetailModal._bindEvents` referenced a removed `.node-detail-backdrop` element, crashing the entire `ReflectApp` constructor and preventing nodes from rendering on the canvas.
- **Empty Canvas After Thought Capture** — `_updateEmptyState()` was not called after node creation, leaving the `[ EMPTY ]` overlay visible on top of the canvas.
- **Right Panel Auto-Expand** — Single-node selection no longer forces the legacy right-panel inspector open; the unified modal handles inspection.

### Changed
- **Silent Thought Capture** — Removed `[THOUGHT CAPTURED]`, `[STREAMING...]`, and `[THOUGHT EXPANDED]` green status toasts. The expansion modal provides sufficient feedback.
- **Thought Bar Highlight Removed** — Input field no longer changes border color/glow based on selected node type.
- **Auto-Expand Streams to Modal** — AI thought expansion streams content into the debate-style overlay with live markdown rendering.

### Removed
- `.node-detail-backdrop` element and associated CSS (replaced by overlay click-to-close).

## [1.0.0] - 2026-04-03
### Added
- **Multi-Model Orchestration**: Full engine support for pitting disparate AI models against each other.
- **Judge Opener**: The engine automatically queries the chosen Judge model to parse and open the floor for the debate, yielding specific analytical constraints before Round 1.
- **Mid-Round Recaps**: The Judge now intercepts the ledger between rounds to generate epistemic recaps and synthesize active arguments.
- **Dedicated Branching UI**: Separated structural branching into "Write" and "Debate" modes via an explicit right-click context menu.
- **Branch Config Modal**: Detaches main setup configuration parameters to seamlessly setup nested debate loops.
- **Lights Out Mode**: Removed ambient visual noise and implemented a deep pitch-black core aesthetic.

### Changed
- **Node Spawning Calculus**: Overhauled random node clustering algorithm globally for rigorous linear structural cascades instead.
- **Physics**: Defaulted physics simulation to `false` (WIP) to preserve debate structure mapping.
- **Layout Overflow Protection**: Added automatic label truncation when reading paragraphs directly from nodes.

### Removed
- Extraneous visual post-processing shaders yielding chromatic and bloom aberrations.
- Implied generic fallback nodes.

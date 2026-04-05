# Changelog

## [2.0.0] - 2026-04-04
### Added — Exocortex Engine Complete
- **Cognitive Compression Engine** (`cortex.js`): BCI-ready output layer with three compression modes:
  - **Belief Deltas**: Track what changed between sessions (strengthened, weakened, new, removed nodes)
  - **Attention Queue**: Prioritized feed combining EIG, vulnerability, contradictions, and redundancies
  - **Summarization Hierarchy**: Full graph → themed clusters with confidence stats and health score
- **`digest()`**: Single function producing a complete cognitive update package with headline, deltas, attention items, summary, calibration, and source leaderboard
- **State Persistence**: Epistemics state and Cortex snapshots now persist across sessions via localStorage
- **175 tests passing** across 9 test suites (17 new cortex tests)

## [1.3.0] - 2026-04-04
### Added
- **Formal Logic Layer** (`logic.js`): Propositional logic per node. Graph-wide contradiction detection via adjacency-aware consistency checking. Auto-suggest propositions from node labels.
- **Source Reliability Tracking**: Bayesian-smoothed reliability scores per AI model. `weightBySource()` dampens unreliable sources toward neutral. Full serialization.
- **Semantic Similarity Engine** (`semantics.js`): TF-IDF vectorization with cosine similarity. Redundancy detection, single-linkage clustering, pairwise similarity matrix.
- **158 tests passing** (31 new across logic, semantics, and source reliability)

## [1.2.0] - 2026-04-04
### Added
- **Epistemic Loss Function**: Live `L: x.xxx` score in the status bar. Computed as `L = λ₁·consistency + λ₂·grounding + λ₃·entropy + λ₄·staleness` across the full graph. Color-coded green/yellow/red.
- **Belief History Versioning**: Every node tracks a temporal log of confidence changes. Detects three pathologies: oscillation (flip-flopping confidence), staleness (no updates in 24h+), and anchoring bias (confidence never moves).
- **Calibration Tracking**: Brier Score computation with 10-bin calibration curves. Records resolved beliefs against prior confidence for accuracy tracking.
- **Confidence Management**: `setConfidence()` auto-derives epistemic status from value. `nudgeConfidence()` uses sigmoid damping (harder to move beliefs near extremes).
- **Bayesian Belief Propagation**: Confidence changes cascade through connected nodes via damped message passing. BFS with decaying influence, respects edge weights, stops at established/falsified nodes.
- **Expected Information Gain (EIG)**: Ranks every unresolved node by how much resolving it would reduce total graph entropy. `getHighestEIG(model, n)` returns the top-N highest-leverage questions.
- **Vulnerability Scanner**: Scores nodes by overconfidence × load-bearing × under-testing × oscillation. Identifies the best targets for adversarial challenge.
- **Red Team Pipeline**: Right-click → `🔴 RED TEAM WEAKEST` auto-identifies the most vulnerable node and launches a debate. `🔴 RED TEAM THIS NODE` targets a specific node. `⚡ SCAN VULNERABILITIES` shows vulnerabilities without debating.
- **Resume Debate Button**: Floating pill to re-open closed debate/expansion overlays.
- **Smooth Trackpad Pinch-to-Zoom**: Proportional, cursor-centered zoom.
- **127 tests passing** (35 new epistemics tests covering propagation, EIG, and vulnerability scanning).

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

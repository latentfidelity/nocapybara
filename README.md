# NoCapybara

**NoCapybara** is an epistemic exocortex engine and spatial logic visualizer. It orchestrates multi-model AI debates on an infinite 2D canvas, then layers Bayesian belief propagation, formal logic, semantic analysis, and cognitive compression on top — producing BCI-ready digests of what you know, what changed, and where to look next.

Built as a zero-dependency Electron app with a pitch-black glassmorphic UI.

---

## Features

### Spatial Epistemic Board
Map out your thoughts on an infinite physics-enabled canvas. Every node is typed — Claim, Evidence, Axiom, Argument, Question, or Synthesis — and carries its own confidence, logic propositions, and belief history.

### Multi-Model Debate Orchestration
Pit disparate AI models against each other (e.g. Llama vs Qwen vs Gemini) in structured, multi-round debates. A separate impartial Judge generates mid-round recaps and a final synthesized resolution, completely isolated from debater biases.

### Epistemic Engine
- **Belief Propagation** — Confidence changes cascade through connected nodes via damped Bayesian message passing.
- **Expected Information Gain (EIG)** — Ranks every unresolved node by how much resolving it would reduce total graph entropy.
- **Vulnerability Scanner** — Scores nodes by overconfidence × load-bearing × under-testing × oscillation.
- **Epistemic Loss Function** — Live `L = λ₁·consistency + λ₂·grounding + λ₃·entropy + λ₄·staleness` score, color-coded green/yellow/red.
- **Belief History** — Temporal log per node. Detects oscillation, staleness, and anchoring bias.
- **Calibration Tracking** — Brier Score with 10-bin calibration curves against resolved beliefs.
- **Red Team Pipeline** — One-click adversarial challenge of the weakest node in the graph.

### Formal Logic Layer
Propositional logic per node with graph-wide contradiction detection via adjacency-aware consistency checking. Auto-suggests propositions from node labels.

### Semantic Similarity Engine
TF-IDF vectorization with cosine similarity. Redundancy detection, single-linkage clustering, and pairwise similarity matrix.

### Source Reliability Tracking
Bayesian-smoothed reliability scores per AI model. Dampens unreliable sources toward neutral confidence.

### Cognitive Compression (Cortex)
BCI-ready output layer producing cognitive digests:
- **Belief Deltas** — What strengthened, weakened, appeared, or disappeared between sessions.
- **Attention Queue** — Prioritized feed combining EIG, vulnerability, contradictions, and redundancies.
- **Summarization Hierarchy** — Full graph → themed clusters with confidence stats and health score.
- **`digest()`** — Single call producing headline, deltas, attention items, summary, calibration, and source leaderboard.

### Additional
- **Dialectical Branching** — Branch any node to launch a focused sub-debate for fractal stress-testing of assumptions.
- **Auto-Expand with Grounding** — Captured thoughts are expanded by AI with Google Search grounding, streaming into a live modal overlay.
- **State Persistence** — Epistemics state and Cortex snapshots persist across sessions via localStorage.
- **Smooth Trackpad Navigation** — Two-finger pan, pinch-to-zoom with cursor-centered scaling.
- **"Lights Out" Aesthetics** — Glassmorphic UI, pitch-black backgrounds, native Markdown formatting.

---

## Installation

Requires [Node.js](https://nodejs.org/) (v18+).

```bash
git clone https://github.com/latentfidelity/nocapybara.git
cd nocapybara
npm install
```

## Setup API Keys

Create a `config.local.json` file in the project root (this file is `.gitignored`):

```json
{
  "gemini_api_key": "your-gemini-key",
  "openrouter_api_key": "your-openrouter-key"
}
```

## Running

```bash
npm start
```

Dev mode (with DevTools):

```bash
npm run dev
```

---

## Shortcuts

| Shortcut | Action |
|---|---|
| `Space + Drag` | Pan canvas |
| `Scroll` / `Two-Finger Swipe` | Pan canvas |
| `Pinch` / `Cmd + Scroll` | Zoom in/out (cursor-centered) |
| `Double Click` | Add node |
| `Alt + Drag` | Connect nodes |
| `Shift + Click` | Multi-select |
| `Right Click` | Context menu / launch debates |
| `Cmd/Ctrl + S` | Save map |
| `Cmd/Ctrl + E` | Export JSON |
| `Escape` | Close modal / deselect |

---

## Architecture

Zero-framework Electron app. 12 modules, no runtime dependencies.

| Module | Purpose |
|---|---|
| `app.js` | Main application controller |
| `renderer.js` | HTML5 Canvas 2D rendering engine |
| `model.js` | Data model and node/edge management |
| `ai.js` | AI prompt construction and API integration |
| `debate.js` | Multi-model debate orchestration |
| `epistemics.js` | Belief propagation, EIG, vulnerability scanner, calibration |
| `logic.js` | Propositional logic and contradiction detection |
| `semantics.js` | TF-IDF similarity, clustering, redundancy detection |
| `cortex.js` | Cognitive compression and digest generation |
| `node-detail-modal.js` | Unified node inspection modal |
| `markdown.js` | Lightweight Markdown-to-HTML renderer |
| `event-bus.js` | Pub/sub event system |

---

## Testing

```bash
npm test
```

175 tests across 9 suites covering model operations, AI prompts, debate logic, markdown rendering, event bus, epistemics (propagation, EIG, vulnerability), formal logic, semantic similarity, and cognitive compression.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE.md) — © 2026 Latent Fidelity

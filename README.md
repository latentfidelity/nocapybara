# NoCapybara
**NoCapybara** is an advanced epistemic engine and spatial logic visualizer designed to orchestrate multi-model AI debates. Built with a pristine dark-mode canvas and native integration with the Gemini API (and OpenRouter), it allows researchers to stress-test complex ideas by pitting disparate AI models against each other in structured, multi-round debates.

## Features
- **Spatial Epistemic Board**: Map out your thoughts using an infinite 2D physics-enabled canvas. Differentiate concepts using standard taxonomy (Claims, Evidence, Axioms, Arguments, Questions, Synthesis).
- **Multi-Model Orchestration**: Automatically trigger debates between different models (e.g., Llama vs Qwen vs Gemini) directly on the board.
- **Independent Judging**: A separate impartial model generates mid-round recaps and a final synthesized resolution, completely isolated from debater biases.
- **Dialectical Branching**: Branch out any existing node to launch a focused sub-debate, allowing fractal stress-testing of underlying assumptions.
- **Unified Node Detail Modal**: Full-bleed, debate-style page takeover for inspecting and editing nodes with live markdown rendering. Click to edit, blur to save.
- **Auto-Expand with Grounding**: Captured thoughts are automatically expanded by AI with Google Search grounding, streaming results into a live modal overlay.
- **Smooth Trackpad Navigation**: Two-finger scroll to pan, pinch to zoom with proportional cursor-centered scaling.
- **\"Lights Out\" Aesthetics**: Crisp glassmorphic UI, pitch-black deep-focus backgrounds, and native Markdown formatting.

## Installation
Ensure you have [Node.js](https://nodejs.org/) installed.

```bash
git clone https://github.com/latentfidelity/nocapybara.git nocapybara
cd nocapybara
npm install
```

## Setup API Keys
Before running, you must define your API keys using a `config.local.json` file in the root directory. This file is `.gitignored` and never committed.

Create `config.local.json`:
```json
{
  "gemini_api_key": "your-gemini-key",
  "openrouter_api_key": "your-openrouter-key"
}
```

## Running the Engine
```bash
npm start
```

## Shortcuts
| Shortcut | Action |
|---|---|
| `Space + Drag` | Pan Canvas |
| `Scroll` / `Two-Finger Swipe` | Pan Canvas |
| `Pinch` / `Cmd + Scroll` | Zoom In/Out (cursor-centered) |
| `Double Click` | Add Node |
| `Alt + Drag` | Connect Nodes |
| `Shift + Click` | Multi-Select |
| `Right Click` | Context Menu / Launch Debates |
| `Cmd/Ctrl + S` | Save Map |
| `Cmd/Ctrl + E` | Export JSON |
| `Escape` | Close Modal / Deselect |

## Architecture
NoCapybara is a modular Electron app with no framework dependencies:

| Module | Purpose |
|---|---|
| `app.js` | Main application controller |
| `renderer.js` | HTML5 Canvas 2D rendering engine |
| `model.js` | Data model and node/edge management |
| `ai.js` | AI prompt construction and formatting |
| `debate.js` | Multi-model debate orchestration |
| `node-detail-modal.js` | Unified node inspection modal |
| `markdown.js` | Lightweight markdown-to-HTML renderer |
| `event-bus.js` | Pub/sub event system |

## Testing
```bash
npm test
```
92 tests across 5 suites covering model operations, AI prompt construction, debate logic, markdown rendering, and the event bus.

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License
MIT

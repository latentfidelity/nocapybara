# NoCapybara
**NoCapybara** is an advanced epistemic engine and spatial logic visualizer designed to orchestrate multi-model AI debates. Built with a pristine dark-mode canvas and native integration with the Gemini API (and OpenRouter), it allows researchers to stress-test complex ideas by pitting disparate AI models against each other in structured, multi-round debates.

## Features
- **Spatial Epistemic Board**: Map out your thoughts using an infinite 2D physics-enabled canvas. Differentiate concepts using standard taxonomy (Claims, Evidence, Axioms, Arguments, Questions, Synthesis).
- **Multi-Model Orchestration**: Automatically trigger debates between different models (e.g., Llama vs Qwen vs Gemini) directly on the board.
- **Independent Judging**: A separate impartial model generates mid-round recaps and a final synthesized resolution, completely isolated from debater biases.
- **Dialectical Branching**: Branch out any existing node to launch a focused sub-debate, allowing fractal stress-testing of underlying assumptions.
- **"Lights Out" Aesthetics**: Crisp glassmorphic UI, pitch-black deep-focus backgrounds, and native Markdown formatting.

## Installation
Ensure you have [Node.js](https://nodejs.org/) installed.

```bash
git clone https://github.com/latentfidelity/reflect.git nocapybara
cd nocapybara
npm install
```

## Setup API Keys
Before running, you must define your API keys natively using a `config.local.json` file in the root directory.

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
- `Space + Drag`: Pan Canvas
- `Scroll`: Zoom In/Out
- `Double Click`: Add Note
- `Right Click`: Access Node Menu / Launch Debates
- `Cmd/Ctrl + S`: Save Map
- `Cmd/Ctrl + E`: Export JSON

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License
MIT

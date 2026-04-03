# Changelog

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

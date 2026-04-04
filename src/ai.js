// ============================================
// NOCAPYBARA — AI Integration Layer
// ============================================
// Handles streaming thought expansion, AI refresh,
// and prompt construction for single-node AI ops.

class AIEngine {
    constructor(model, renderer, bus) {
        this.model = model;
        this.renderer = renderer;
        this.bus = bus;
        this.selectedModel = 'gemini-2.5-flash';
    }

    setModel(model) {
        this.selectedModel = model;
    }

    get available() {
        return !!(window.electronAPI && window.electronAPI.geminiStream);
    }

    /**
     * Build the structured expansion prompt.
     */
    _buildExpandPrompt(text) {
        return `You are a rigorous epistemic assistant running inside NoCapybara. Given a raw thought or claim, formalize it into a structured knowledge node.

Return your response in EXACTLY this format (every field required):
TITLE: <concise 3-6 word title>
TYPE: <one of: claim, evidence, argument, axiom, question, synthesis>
DESCRIPTION: <1-2 sentence logical summary>
PROPERTIES: <key=value pairs, comma separated, e.g. domain=logic, falsifiable=true, related_to=quantum mechanics>
---
<expanded content: rigorously structured page. Outline the premises, empirical grounding, and logical implications. 3-8 paragraphs, plain text, no markdown headers. Be specific and factual.>

Type definitions:
- claim: an assertion to be examined
- evidence: empirical data, direct observation, indisputable fact
- argument: a structured logical chain mapping claims to evidence
- axiom: a foundational, self-evident assumption
- question: an open inquiry or contradiction requiring resolution
- synthesis: a convergence of multiple branches

Thought: "${text.replace(/"/g, '\\"')}"`;
    }

    /**
     * Stream-expand a thought into a structured node.
     * @param {object} node - NexusNode to expand
     * @param {string} text - raw thought text
     * @param {function} onChunk - (fullResponse, parsed) => void — called on each chunk
     * @param {function} onDone - () => void
     * @param {function} onError - (err) => void
     */
    expandThought(node, text, onChunk, onDone, onError) {
        if (!this.available) {
            onError('No AI API available');
            return;
        }

        const prompt = this._buildExpandPrompt(text);
        node._loading = true;
        node.source = { type: 'ai-expanded', model: this.selectedModel, timestamp: Date.now() };
        this.renderer.markDirty();
        this.bus.emit('ai:expanding', { node });

        let fullResponse = '';
        let headerParsed = false;
        let contentStartIdx = -1;

        window.electronAPI.removeStreamListeners();

        window.electronAPI.onStreamChunk((chunk) => {
            fullResponse += chunk;

            const parsed = { title: null, type: null, description: null, properties: null, content: null };

            if (!headerParsed) {
                const titleMatch = fullResponse.match(/^TITLE:\s*(.+)/m);
                if (titleMatch) {
                    const title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
                    if (title && title.length < 80) parsed.title = title;
                }

                const typeMatch = fullResponse.match(/^TYPE:\s*(.+)/m);
                if (typeMatch) {
                    const type = typeMatch[1].trim().toLowerCase();
                    const validTypes = ['claim', 'evidence', 'argument', 'axiom', 'question', 'synthesis'];
                    if (validTypes.includes(type)) parsed.type = type;
                }

                const descMatch = fullResponse.match(/^DESCRIPTION:\s*(.+)/m);
                if (descMatch) parsed.description = descMatch[1].trim();

                const propsMatch = fullResponse.match(/^PROPERTIES:\s*(.+)/m);
                if (propsMatch) {
                    parsed.properties = {};
                    const pairs = propsMatch[1].split(',').map(p => p.trim()).filter(Boolean);
                    for (const pair of pairs) {
                        const [key, ...valParts] = pair.split('=');
                        const val = valParts.join('=').trim();
                        if (key && val) parsed.properties[key.trim()] = val;
                    }
                }

                const sepIdx = fullResponse.indexOf('---');
                if (sepIdx !== -1) {
                    headerParsed = true;
                    contentStartIdx = sepIdx + 3;
                }
            }

            if (headerParsed) {
                parsed.content = fullResponse.slice(contentStartIdx).trimStart();
            }

            onChunk(fullResponse, parsed);
        });

        window.electronAPI.onStreamDone(() => {
            node._loading = false;
            this.renderer.markDirty();
            window.electronAPI.removeStreamListeners();
            this.bus.emit('ai:expanded', { node });
            onDone();
        });

        window.electronAPI.onStreamError((err) => {
            node._loading = false;
            this.renderer.markDirty();
            window.electronAPI.removeStreamListeners();
            this.bus.emit('ai:error', { node, error: err });
            onError(err);
        });

        window.electronAPI.geminiStream(prompt, true, this.selectedModel);
    }

    /**
     * AI Refresh — stream new research content into an existing node.
     * @param {object} node
     * @param {function} onChunk - (streamedSoFar) => void
     * @param {function} onDone
     * @param {function} onError
     */
    refreshContent(node, onChunk, onDone, onError) {
        if (!this.available) {
            onError('No AI API available');
            return;
        }

        const existingContent = node.content || '';
        const prompt = `You are a research assistant. The user has a concept node titled "${node.label}" with type "${node.type}".
${node.description ? `Description: "${node.description}"` : ''}
${existingContent ? `Current content:\n${existingContent.slice(0, 2000)}` : 'No content yet.'}

Research and provide the NEWEST, most relevant and up-to-date information about this concept. Include:
- Key definitions or clarifications
- Recent developments or current state of knowledge
- Important connections to related concepts
- Practical implications or applications
- Open questions worth exploring

Write concise, substantive paragraphs. Plain text only, no markdown headers. Be specific and factual.`;

        const prefix = existingContent ? existingContent + '\n\n— REFRESHED —\n\n' : '';
        let streamed = '';

        window.electronAPI.removeStreamListeners();

        window.electronAPI.onStreamChunk((text) => {
            streamed += text;
            node.content = prefix + streamed;
            this.renderer.markDirty();
            onChunk(streamed);
        });

        window.electronAPI.onStreamDone(() => {
            window.electronAPI.removeStreamListeners();
            this.bus.emit('ai:refreshed', { node });
            onDone();
        });

        window.electronAPI.onStreamError((err) => {
            window.electronAPI.removeStreamListeners();
            onError(err);
        });

        window.electronAPI.geminiStream(prompt, true, this.selectedModel);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AIEngine };
} else {
    window.NocapAI = { AIEngine };
}

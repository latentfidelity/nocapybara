// ============================================
// NOCAPYBARA — Debate Engine
// ============================================
// Manages multi-model debate orchestration,
// prompt construction, and graph node creation.

class DebateEngine {
    constructor(model, renderer, bus) {
        this.model = model;
        this.renderer = renderer;
        this.bus = bus;

        this.running = false;

        // Debater config
        this.debaters = [
            { model: 'gemini-2.5-pro', letter: 'A', color: '#E0866E', emoji: '\uD83D\uDD34' },
            { model: 'gemini-3-pro-preview', letter: 'B', color: '#7EAAE2', emoji: '\uD83D\uDD35' },
        ];
        this.judgeModel = null; // defaults to 'gemini-2.5-flash' at runtime

        this.colors = ['#E0866E', '#7EAAE2', '#6EBF8B', '#C4A6E0', '#E8C96E'];
        this.letters = ['A', 'B', 'C', 'D', 'E'];
        this.emojis = ['\uD83D\uDD34', '\uD83D\uDD35', '\uD83D\uDFE2', '\uD83D\uDFE3', '\uD83D\uDFE1'];
    }

    get isRunning() { return this.running; }

    addDebater() {
        if (this.debaters.length >= 5) return false;
        const idx = this.debaters.length;
        this.debaters.push({
            model: 'gemini-2.5-flash',
            letter: this.letters[idx],
            color: this.colors[idx],
            emoji: this.emojis[idx]
        });
        return true;
    }

    removeDebater() {
        if (this.debaters.length <= 2) return false;
        this.debaters.pop();
        return true;
    }

    setDebaterModel(index, model) {
        if (this.debaters[index]) this.debaters[index].model = model;
    }

    setJudgeModel(model) {
        this.judgeModel = model;
    }

    getJudgeModel() {
        return this.judgeModel || 'gemini-2.5-flash';
    }

    // ── Prompt Builders ──

    buildDebatePrompt(topic, history, side, round, totalRounds, mode = 'standard', numDebaters = 2) {
        const syntaxRef = `
FORMATTING GUIDE — You are writing inside the NoCapybara Epistemic Engine. Use these mechanisms:
- **Markdown**: Use # headings, **bold**, *italic*, > blockquotes, - bullet lists, 1. numbered lists
- **Wiki Links**: Reference core concepts via [[Double Brackets]] — e.g. [[Consciousness]], [[Emergence]]. Use them ruthlessly for all semantic nodes.
- **Tags**: Use #hashtags for categorization — e.g. #axiom #fallacy #open-question #empirical-data
`;

        const modeInstructions = {
            standard: `\n\n**STANDARD MODE**: Debate rigorously. Do NOT be polite or sycophantic. Attack weak arguments without hesitation. If an opponent is right, concede the specific point but attack the surrounding framework if flawed.\n`,
            steelman: `\n\n**STEEL MAN MODE**: Before presenting your counter-argument, you MUST construct the STRONGEST possible version of the other debaters' positions — stronger than they stated it. Repair their logical gaps for them. Only once you have a bulletproof Steel Man, dismantle it. Label this section "## Steel Man".\n`,
            redteam: `\n\n**RED TEAM MODE**: You are an epistemic assassin. Your sole purpose is adversarial analysis. Find the weakest logical link, hidden assumption, or unstated dependency in the other arguments and attack it. Identify specific logical fallacies by name. Be ruthlessly analytical. Label weaknesses clearly.\n`,
            socratic: `\n\n**SOCRATIC MODE**: If you are opening, establish strict definitional axioms. If you are responding, do NOT make declarative claims. Instead, ask penetrating, orthogonal questions that force other models to examine their implicit assumptions, confront edge cases, and resolve contradictions. Ask 3-5 precise questions.\n`
        };

        let context = `You are MODEL ${side} in a maximally truth-seeking ${numDebaters}-way debate engine. The topic is:\n\n"${topic}"\n\n`;
        context += syntaxRef + '\n';
        context += `**EPISTEMIC DIRECTIVE**: You are not here to compromise or seek artificial consensus. You are here to isolate objective truth. Demand falsifiability. Reject hallucinations. Point out formal logical fallacies. Base your arguments on empirical reality, formal logic, or explicit axioms.\n`;
        context += modeInstructions[mode] || modeInstructions.standard;

        if (history.length > 0) {
            context += `\nPrevious arguments in the ledger:\n\n`;
            history.forEach(h => {
                context += `--- MODEL ${h.role} (Round ${h.round}) ---\n${h.content}\n\n`;
            });
        }

        if (round === 1) {
            context += `This is Round 1 of ${totalRounds}. Present your opening thesis. Define your axioms strictly. Be substantive, cite grounding logic, and stake out a clear, distinct position from other potential models. Use [[wiki links]] for every key concept. 3-5 paragraphs.`;
        } else if (round === totalRounds) {
            context += `This is the FINAL round (${round}/${totalRounds}). Drop everything but the hard truth. Discard your initial position if it was falsified. State the exact vector of convergence or the exact irreducible contradiction. Use [[wiki links]] heavily. 3-5 paragraphs.`;
        } else {
            context += `This is Round ${round} of ${totalRounds}. Dissect the latest arguments from the ledger. Acknowledge valid axioms, shatter logical inconsistencies, refine your topology. Use [[wiki links]]. Be rigorous, objective, and unflinching. 3-5 paragraphs.`;
        }

        return context;
    }

    buildRecapPrompt(topic, history, round, numDebaters) {
        let context = `You are NoCapybara's Impartial Judge in a ${numDebaters}-way debate engine. The topic is:\n\n"${topic}"\n\n`;
        context += `We have just concluded Round ${round}. Here is the complete ledger of the debate so far:\n\n`;
        history.forEach(h => {
            if (h.role !== 'JUDGE') {
                context += `--- MODEL ${h.role} (Round ${h.round}) ---\n${h.content}\n\n`;
            }
        });
        context += `**JUDGE DIRECTIVE**: Recap the state of the board at the end of Round ${round}. \n1. Summarize the strongest surviving argument.\n2. Summarize the most devastating logical critique.\n3. State explicitly what the debaters MUST focus on answering or resolving in the next round.\n\nKeep it concise, objective, and unflinchingly analytical. Use [[wiki links]] for concepts. Max 2 paragraphs.`;
        return context;
    }

    buildResolutionPrompt(topic, history, numDebaters = 2) {
        let prompt = `You are NoCapybara's apex synthesizer, an AI designed for pure epistemic convergence. ${numDebaters} AI models have debated the following topic:\n\n"${topic}"\n\nHere is the complete debate ledger:\n\n`;

        history.forEach(h => {
            prompt += `=== MODEL ${h.role} — ROUND ${h.round} ===\n${h.content}\n\n`;
        });

        prompt += `Now synthesize a FUNDAMENTAL TRUTH DOCUMENT. Strip away rhetoric, redundancy, and courtesy. Isolate the reality of the topic.

IMPORTANT: Your VERY FIRST LINE must be exactly a five-word phrase summarizing the final conclusion, formatted strictly as: "TITLE: [Your five word conclusion here]"

# Axiomatic Truths
What is undeniably true based on the exchange? (What survived all Red Teaming?)

# Falsified Claims
What specific assertions were destroyed, and by what mechanism/fallacy?

# The Synthesis
The highest-order understanding of the topic that transcends the initial boundaries.

# Irreducible Unknowns
What remains unprovable or requires external empirical validation?

FORMATTING REQUIREMENTS:
- Use # markdown headings for each section
- Use **bold** for emphasis and *italic* for nuance
- Use [[Double Bracket Links]] for EVERY key concept — e.g. [[Consciousness]], [[Emergence]]
- Use #tags for structural labeling — e.g. #axiom #falsified #synthesis
- Do NOT hedge or use weak language ("It is important to consider...", "Both sides made valid points..."). State reality as it is.`;

        return prompt;
    }

    buildOpenerPrompt(topic) {
        return `You are the JUDGE of an epistemic debate. A new topic has just been introduced by the user:

"${topic}"

Analyze this topic and "open the floor" for the debaters.
1. Identify the core epistemic conflicts embedded in this topic.
2. Outline the specific rules of engagement or critical failure modes the debaters must avoid.
3. Formally invite the debaters to present their opening models.
Keep it strictly under 2 paragraphs. Use [[wiki links]] for key concepts. Format as Markdown.`;
    }

    /**
     * Run the full debate.
     * @param {string} topic
     * @param {object|null} parentNode - graph node to branch from
     * @param {object} uiCallbacks - { onTranscriptAdd, onStatusUpdate, onRoundUpdate }
     * @returns {Promise<{topicNode, resolutionNode}>}
     */
    async run(topic, parentNode, uiCallbacks) {
        if (this.running) throw new Error('Debate already running');
        if (!window.electronAPI || !window.electronAPI.geminiRequest) throw new Error('No AI available');
        if (this.debaters.length < 2) throw new Error('Need at least 2 debaters');

        this.running = true;
        this.bus.emit('debate:started', { topic });

        const wp = this.renderer.screenToWorld(this.renderer.viewW / 2, this.renderer.viewH / 2);
        if (parentNode) {
            wp.x = parentNode.x;
            wp.y = parentNode.y + 200;
        }

        const rounds = parseInt(document.getElementById('debate-rounds')?.value || 3);
        const mode = document.getElementById('debate-mode')?.value || 'standard';
        const numDebaters = this.debaters.length;
        const judgeModel = this.getJudgeModel();
        const modelList = this.debaters.map(d => d.model);

        const { onTranscriptAdd, onStatusUpdate, onRoundUpdate } = uiCallbacks;

        // Create topic node
        const truncatedTopic = topic.length > 50 ? topic.slice(0, 50) + '...' : topic;
        const topicNode = this.model.addNode('claim', wp.x, wp.y - 120, truncatedTopic);
        topicNode.content = topic;
        if (parentNode) this.model.addEdge(parentNode.id, topicNode.id, 'branch debate');
        topicNode.description = 'Debate topic';
        topicNode.properties = {
            mode: 'debate',
            debaters: numDebaters.toString(),
            models: modelList.join(', '),
            rounds: rounds.toString()
        };
        topicNode._loading = true;
        this.renderer.markDirty();

        this.bus.emit('debate:topic-created', { node: topicNode });

        const history = [];

        try {
            // Judge opening statement
            onStatusUpdate('⚖️ Judge mapping debate vector');
            const openerPrompt = this.buildOpenerPrompt(topic);
            const openerResult = await window.electronAPI.geminiRequest(openerPrompt, false, judgeModel);
            const openerText = openerResult?.text || openerResult?.error || String(openerResult || '');

            onTranscriptAdd('JUDGE', 'OPEN', judgeModel, openerText, '&#x2696;&#xFE0F;');

            const openerNode = this.model.addNode('synthesis', wp.x, wp.y - 40, 'Opening Statement');
            openerNode.description = `⚖️ JUDGE: ${judgeModel} — Opening Statement`;
            openerNode.content = openerText;
            openerNode.properties = { side: 'JUDGE', round: 'OPEN', model: judgeModel, _debaterColor: '#8ED1D1' };
            openerNode._debaterColor = '#8ED1D1';
            openerNode.source = { type: 'debate-recap', model: judgeModel, timestamp: Date.now() };
            this.model.addEdge(topicNode.id, openerNode.id, 'evaluates');
            this.renderer.markDirty();

            const lastNodes = this.debaters.map(() => openerNode);
            history.push({ role: 'JUDGE', content: openerText });

            // Rounds
            for (let round = 1; round <= rounds; round++) {
                onRoundUpdate(`ROUND ${round}/${rounds}`);

                for (let di = 0; di < numDebaters; di++) {
                    const debater = this.debaters[di];
                    onStatusUpdate(`Model ${debater.letter} thinking`);

                    const prompt = this.buildDebatePrompt(topic, history, debater.letter, round, rounds, mode, numDebaters);
                    const result = await window.electronAPI.geminiRequest(prompt, false, debater.model);
                    const response = result?.text || result?.error || String(result || '');

                    onTranscriptAdd(debater.letter, round, debater.model, response, debater.emoji);

                    // Position
                    const spacing = 220;
                    const startX = wp.x - ((numDebaters - 1) * spacing) / 2;
                    const nx = startX + di * spacing;
                    const ny = wp.y + round * 140;

                    // Derive label
                    let derivedLabel = `R${round} ${debater.letter}`;
                    const headingMatch = response.match(/^#+\s+(.+)/m);
                    if (headingMatch) {
                        derivedLabel = headingMatch[1].slice(0, 40);
                    } else {
                        const firstSentence = response.split(/[.!?\n]/)[0]?.trim();
                        if (firstSentence) derivedLabel = firstSentence.slice(0, 40);
                    }
                    if (derivedLabel.length >= 40) derivedLabel += '\u2026';

                    const node = this.model.addNode('argument', nx, ny, derivedLabel);
                    node.description = `${debater.emoji} ${debater.letter}: ${debater.model} \u2014 Round ${round}`;
                    node.content = response;
                    node.properties = { side: debater.letter, round: round.toString(), model: debater.model };
                    node._debaterColor = debater.color;
                    node.source = { type: 'debate-round', model: debater.model, timestamp: Date.now() };
                    node.epistemicStatus = 'hypothesis';

                    this.model.addEdge(lastNodes[di].id, node.id, round === 1 ? 'opens' : 'responds');
                    if (di > 0) {
                        const prevNode = lastNodes[di - 1];
                        if (prevNode !== topicNode) {
                            this.model.addEdge(prevNode.id, node.id, 'counters');
                        }
                    }
                    lastNodes[di] = node;
                    history.push({ role: debater.letter, round, content: response });
                    this.renderer.markDirty();
                }

                // Mid-round recap
                if (round < rounds) {
                    onStatusUpdate(`JUDGE recapping Round ${round}`);
                    const recapPrompt = this.buildRecapPrompt(topic, history, round, numDebaters);
                    const recapResult = await window.electronAPI.geminiRequest(recapPrompt, false, judgeModel);
                    const recapText = recapResult?.text || recapResult?.error || '';

                    onTranscriptAdd('JUDGE', round, judgeModel, recapText, '&#x2696;&#xFE0F;');

                    const recapY = wp.y + round * 140 + 70;
                    const recapNode = this.model.addNode('synthesis', wp.x, recapY, `R${round} Recap`);
                    recapNode.description = `⚖️ JUDGE: ${judgeModel} — Round ${round} Recap`;
                    recapNode.content = recapText;
                    recapNode.properties = { side: 'JUDGE', round: round.toString(), model: judgeModel, _debaterColor: '#8ED1D1' };
                    recapNode._debaterColor = '#8ED1D1';
                    recapNode.source = { type: 'debate-recap', model: judgeModel, timestamp: Date.now() };
                    lastNodes.forEach(n => this.model.addEdge(n.id, recapNode.id, 'reviewed by'));
                    history.push({ role: 'JUDGE', round, content: recapText });
                    this.renderer.markDirty();
                }
            }

            // Resolution
            onStatusUpdate('Synthesizing resolution');
            onRoundUpdate('RESOLUTION');

            const resolutionPrompt = this.buildResolutionPrompt(topic, history, numDebaters);
            const resultRes = await window.electronAPI.geminiRequest(resolutionPrompt, false, judgeModel);
            let rawResolution = resultRes?.text || resultRes?.error || String(resultRes || '');

            let resolutionTitle = `Resolution: ${topic.slice(0, 30)}`;
            const titleMatch = rawResolution.match(/\*?\*?TITLE:\*?\*?\s*(.*)/im);
            if (titleMatch) {
                resolutionTitle = titleMatch[1].replace(/["']/g, '').trim();
                rawResolution = rawResolution.replace(/\*?\*?TITLE:\*?\*?\s*(.*)\n*/im, '').trim();
            }

            onTranscriptAdd('RESOLUTION', 'FINAL', judgeModel, rawResolution, '◆');

            const resNode = this.model.addNode('synthesis', wp.x, wp.y + (rounds + 1) * 140 + 70, resolutionTitle);
            resNode.description = `⚖️ JUDGE: ${judgeModel} \u2014 ${numDebaters} debaters, ${rounds} rounds`;
            resNode.content = rawResolution;
            resNode.properties = {
                type: 'resolution',
                models: modelList.join(', '),
                judge: judgeModel,
                rounds: rounds.toString(),
                topic: topic
            };
            resNode._debaterColor = '#8ED1D1';
            resNode.source = { type: 'debate-resolution', model: judgeModel, timestamp: Date.now() };
            resNode.epistemicStatus = 'supported';
            resNode.confidence = 0.7;

            lastNodes.forEach(n => this.model.addEdge(n.id, resNode.id, 'synthesizes'));
            this.model.addEdge(topicNode.id, resNode.id, 'resolves');

            topicNode._loading = false;
            topicNode.content = `# Debate: ${topic}\n\nDebaters: ${this.debaters.map(d => `${d.emoji} ${d.letter}: ${d.model}`).join(', ')}\nRounds: ${rounds}\n\nSee [[${resolutionTitle}]] for the final truth document.`;
            this.renderer.markDirty();

            this.running = false;
            this.bus.emit('debate:resolved', { topicNode, resNode });
            return { topicNode, resNode };

        } catch (err) {
            topicNode._loading = false;
            this.running = false;
            this.bus.emit('debate:error', { error: err });
            throw err;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DebateEngine };
} else {
    window.NocapDebate = { DebateEngine };
}

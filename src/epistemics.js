// ============================================
// NOCAPYBARA — Epistemic Engine (Phase 1)
// ============================================
// Quantitative belief tracking: confidence scoring,
// belief history versioning, and graph-wide loss functions.

const Epistemics = (() => {

    // ======================== BELIEF HISTORY ========================
    // Each node gets a temporal log of confidence changes.

    const _histories = new Map(); // nodeId → Array<HistoryEntry>

    /**
     * @typedef {Object} HistoryEntry
     * @property {number} t         - Timestamp (ms)
     * @property {number} confidence - Confidence at this point [0, 1]
     * @property {string} status    - Epistemic status label
     * @property {string} trigger   - What caused the change
     * @property {string} [source]  - Model/user that triggered it
     */

    function initHistory(node) {
        if (_histories.has(node.id)) return;
        _histories.set(node.id, [{
            t: Date.now(),
            confidence: node.confidence,
            status: node.epistemicStatus,
            trigger: 'created',
            source: node.source?.type || 'user'
        }]);
    }

    function recordChange(node, trigger, source = 'user') {
        if (!_histories.has(node.id)) initHistory(node);
        const history = _histories.get(node.id);
        const last = history[history.length - 1];
        // Only record if something actually changed
        if (last && last.confidence === node.confidence && last.status === node.epistemicStatus) return;
        history.push({
            t: Date.now(),
            confidence: node.confidence,
            status: node.epistemicStatus,
            trigger,
            source
        });
    }

    function getHistory(nodeId) {
        return _histories.get(nodeId) || [];
    }

    function clearHistory(nodeId) {
        _histories.delete(nodeId);
    }

    function clearAllHistory() {
        _histories.clear();
        _resolutions.length = 0;
        _sourceReliability.clear();
    }

    // ======================== BELIEF PATHOLOGIES ========================

    /**
     * Detect belief pathologies from history.
     * @param {string} nodeId
     * @returns {Array<{type: string, severity: number, description: string}>}
     */
    function detectPathologies(nodeId) {
        const history = _histories.get(nodeId);
        if (!history || history.length < 2) return [];
        const pathologies = [];

        // Oscillation: confidence changes direction more than 3 times
        let directionChanges = 0;
        for (let i = 2; i < history.length; i++) {
            const prevDelta = history[i - 1].confidence - history[i - 2].confidence;
            const currDelta = history[i].confidence - history[i - 1].confidence;
            if (prevDelta * currDelta < 0) directionChanges++;
        }
        if (directionChanges >= 3) {
            pathologies.push({
                type: 'oscillation',
                severity: Math.min(directionChanges / 5, 1),
                description: `Confidence oscillated ${directionChanges} times — evidence is inconclusive on both sides.`
            });
        }

        // Staleness: no update in the last 24 hours for a non-established node
        const last = history[history.length - 1];
        const hoursSinceUpdate = (Date.now() - last.t) / (1000 * 60 * 60);
        if (hoursSinceUpdate > 24 && last.status !== 'established' && last.status !== 'falsified') {
            pathologies.push({
                type: 'stale',
                severity: Math.min(hoursSinceUpdate / 168, 1), // caps at 1 week
                description: `No updates in ${Math.round(hoursSinceUpdate)}h — belief may be drifting without challenge.`
            });
        }

        // Anchoring: confidence never moved more than 0.05 despite multiple updates
        if (history.length >= 4) {
            const range = Math.max(...history.map(h => h.confidence)) - Math.min(...history.map(h => h.confidence));
            if (range < 0.05) {
                pathologies.push({
                    type: 'anchoring',
                    severity: 0.6,
                    description: `Confidence barely moved (range: ${(range * 100).toFixed(1)}%) despite ${history.length} updates — possible anchoring bias.`
                });
            }
        }

        return pathologies;
    }

    // ======================== EPISTEMIC LOSS FUNCTION ========================

    /**
     * Compute the epistemic loss over the entire graph.
     * Lower is better. 0 = perfectly grounded, consistent, calibrated graph.
     *
     * L = λ₁·L_consistency + λ₂·L_grounding + λ₃·L_entropy + λ₄·L_staleness
     *
     * @param {WorldModel} model
     * @param {Object} [weights] - Lambda weights for each term
     * @returns {{total: number, consistency: number, grounding: number, entropy: number, staleness: number, details: Object}}
     */
    function computeLoss(model, weights = {}) {
        const λ = {
            consistency: weights.consistency ?? 1.0,
            grounding: weights.grounding ?? 0.8,
            entropy: weights.entropy ?? 0.5,
            staleness: weights.staleness ?? 0.3
        };

        const nodes = [...model.nodes.values()];
        if (nodes.length === 0) return { total: 0, consistency: 0, grounding: 0, entropy: 0, staleness: 0, details: {} };

        // --- L_consistency: penalize contradictions ---
        // Connected nodes of certain types should agree in direction.
        // claim → evidence (supports) should pull confidence up if evidence is strong.
        // Two claims connected that have opposite confidence = potential contradiction.
        let consistencyLoss = 0;
        let consistencyCount = 0;
        model.edges.forEach(edge => {
            const from = model.nodes.get(edge.from);
            const to = model.nodes.get(edge.to);
            if (!from || !to) return;

            // Check for opposing confidence on connected claims
            if (from.type === 'claim' && to.type === 'claim') {
                // If label contains negation signals, opposing confidence is expected — skip
                // Otherwise, large confidence disagreement on connected claims is suspicious
                const delta = Math.abs(from.confidence - to.confidence);
                if (delta > 0.5) {
                    consistencyLoss += (delta - 0.5) * 2; // only penalize above 0.5 disagreement
                    consistencyCount++;
                }
            }

            // Evidence should support its parent claim
            if (to.type === 'evidence' && from.type === 'claim') {
                if (to.confidence > 0.7 && from.confidence < 0.4) {
                    consistencyLoss += (to.confidence - from.confidence) * 0.5;
                    consistencyCount++;
                }
            }
        });
        const L_consistency = consistencyCount > 0 ? consistencyLoss / consistencyCount : 0;

        // --- L_grounding: penalize ungrounded claims ---
        // Claims with high confidence but no evidence children
        let groundingLoss = 0;
        const claimNodes = nodes.filter(n => n.type === 'claim' || n.type === 'argument');
        claimNodes.forEach(node => {
            const children = [];
            model.edges.forEach(e => {
                if (e.from === node.id) {
                    const child = model.nodes.get(e.to);
                    if (child && child.type === 'evidence') children.push(child);
                }
            });
            if (children.length === 0 && node.confidence > 0.5) {
                // High confidence claim with no evidence = ungrounded
                groundingLoss += (node.confidence - 0.5) * 2;
            }
        });
        const L_grounding = claimNodes.length > 0 ? groundingLoss / claimNodes.length : 0;

        // --- L_entropy: penalize high-uncertainty nodes ---
        // Nodes near 0.5 confidence carry maximum entropy
        let entropyLoss = 0;
        nodes.forEach(node => {
            // Binary entropy: H(p) = -p*log(p) - (1-p)*log(1-p)
            const p = Math.max(0.001, Math.min(0.999, node.confidence));
            const h = -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
            entropyLoss += h;
        });
        const L_entropy = entropyLoss / nodes.length; // normalized [0, 1]

        // --- L_staleness: penalize old, unresolved nodes ---
        let stalenessLoss = 0;
        const now = Date.now();
        nodes.forEach(node => {
            if (node.epistemicStatus === 'established' || node.epistemicStatus === 'falsified') return;
            const history = _histories.get(node.id);
            if (!history) return;
            const lastUpdate = history[history.length - 1].t;
            const hoursSince = (now - lastUpdate) / (1000 * 60 * 60);
            if (hoursSince > 1) {
                stalenessLoss += Math.min(Math.log2(hoursSince) / 10, 1); // log scale, caps at 1
            }
        });
        const L_staleness = nodes.length > 0 ? stalenessLoss / nodes.length : 0;

        // --- Total ---
        const total = λ.consistency * L_consistency
                    + λ.grounding * L_grounding
                    + λ.entropy * L_entropy
                    + λ.staleness * L_staleness;

        return {
            total: Math.round(total * 1000) / 1000,
            consistency: Math.round(L_consistency * 1000) / 1000,
            grounding: Math.round(L_grounding * 1000) / 1000,
            entropy: Math.round(L_entropy * 1000) / 1000,
            staleness: Math.round(L_staleness * 1000) / 1000,
            details: { nodeCount: nodes.length, claimCount: claimNodes.length }
        };
    }

    // ======================== CONFIDENCE HELPERS ========================

    /**
     * Update a node's confidence and record the change.
     * Clamps to [0, 1].
     */
    function setConfidence(node, value, trigger, source = 'user') {
        node.confidence = Math.max(0, Math.min(1, value));

        // Auto-derive epistemic status from confidence
        if (node.confidence >= 0.9) node.epistemicStatus = 'established';
        else if (node.confidence >= 0.7) node.epistemicStatus = 'supported';
        else if (node.confidence >= 0.4) node.epistemicStatus = 'hypothesis';
        else if (node.confidence >= 0.2) node.epistemicStatus = 'contested';
        else node.epistemicStatus = 'conjecture';

        recordChange(node, trigger, source);
    }

    /**
     * Nudge confidence up or down based on evidence.
     * Uses a sigmoid-shaped update to prevent overshooting.
     * @param {NexusNode} node
     * @param {number} delta - Positive = strengthening, negative = weakening
     * @param {string} trigger
     * @param {string} source
     */
    function nudgeConfidence(node, delta, trigger, source = 'system') {
        // Sigmoid damping: harder to move confidence near extremes
        const damping = node.confidence * (1 - node.confidence) * 4; // peaks at 0.5, drops at 0/1
        const adjustedDelta = delta * damping;
        setConfidence(node, node.confidence + adjustedDelta, trigger, source);
    }

    // ======================== CALIBRATION ========================

    const _resolutions = []; // Array<{predicted: number, outcome: 0|1}>

    /**
     * Record a resolved belief for calibration tracking.
     * @param {number} predicted - The confidence the system had before resolution [0, 1]
     * @param {number} outcome - 1 if the belief was correct, 0 if falsified
     */
    function recordResolution(predicted, outcome) {
        _resolutions.push({ predicted, outcome, t: Date.now() });
    }

    /**
     * Compute the Brier Score over all resolutions.
     * BS = mean((predicted - outcome)²)
     * Perfect score = 0, worst = 1.
     * @returns {{brierScore: number, count: number, bins: Array}}
     */
    function getCalibration() {
        if (_resolutions.length === 0) return { brierScore: null, count: 0, bins: [] };

        let totalBS = 0;
        _resolutions.forEach(r => {
            totalBS += (r.predicted - r.outcome) ** 2;
        });

        // Build calibration bins (10 bins of 0.1 width)
        const bins = Array.from({ length: 10 }, (_, i) => ({
            range: `${(i * 10)}–${(i + 1) * 10}%`,
            predicted: 0,
            actual: 0,
            count: 0
        }));

        _resolutions.forEach(r => {
            const binIdx = Math.min(Math.floor(r.predicted * 10), 9);
            bins[binIdx].predicted += r.predicted;
            bins[binIdx].actual += r.outcome;
            bins[binIdx].count++;
        });

        bins.forEach(b => {
            if (b.count > 0) {
                b.predicted = Math.round((b.predicted / b.count) * 100) / 100;
                b.actual = Math.round((b.actual / b.count) * 100) / 100;
            }
        });

        return {
            brierScore: Math.round((totalBS / _resolutions.length) * 1000) / 1000,
            count: _resolutions.length,
            bins: bins.filter(b => b.count > 0)
        };
    }

    // ======================== SERIALIZATION ========================

    function toJSON() {
        const historyData = {};
        _histories.forEach((entries, nodeId) => {
            historyData[nodeId] = entries;
        });
        const sourceData = {};
        _sourceReliability.forEach((stats, source) => {
            sourceData[source] = { ...stats };
        });
        return {
            histories: historyData,
            resolutions: _resolutions.map(r => ({ ...r })),
            sourceReliability: sourceData
        };
    }

    function fromJSON(data) {
        _histories.clear();
        _resolutions.length = 0;
        if (data?.histories) {
            Object.entries(data.histories).forEach(([nodeId, entries]) => {
                _histories.set(nodeId, entries);
            });
        }
        if (data?.resolutions) {
            _resolutions.push(...data.resolutions);
        }
        if (data?.sourceReliability) {
            Object.entries(data.sourceReliability).forEach(([source, stats]) => {
                _sourceReliability.set(source, stats);
            });
        }
    }

    // ======================== SOURCE RELIABILITY ========================
    // Track the reliability of each AI model/source based on track record.

    const _sourceReliability = new Map(); // source → {established: n, falsified: n, total: n}

    /**
     * Record an outcome for a source. Called when a node is resolved.
     * @param {string} source - Model name or source identifier
     * @param {'established'|'falsified'|'contested'} outcome
     */
    function recordSourceOutcome(source, outcome) {
        if (!source) return;
        if (!_sourceReliability.has(source)) {
            _sourceReliability.set(source, { established: 0, falsified: 0, total: 0 });
        }
        const stats = _sourceReliability.get(source);
        stats.total++;
        if (outcome === 'established') stats.established++;
        else if (outcome === 'falsified') stats.falsified++;
    }

    /**
     * Get the reliability score for a source [0, 1].
     * 1 = all claims established, 0 = all claims falsified.
     * Returns 0.5 (neutral) for unknown sources.
     * @param {string} source
     * @returns {number}
     */
    function getSourceReliability(source) {
        const stats = _sourceReliability.get(source);
        if (!stats || stats.total === 0) return 0.5;
        // Bayesian smoothing: add 1 pseudo-count for each outcome
        return (stats.established + 1) / (stats.total + 2);
    }

    /**
     * Get all source reliability scores, sorted by reliability.
     * @returns {Array<{source: string, reliability: number, established: number, falsified: number, total: number}>}
     */
    function getAllSourceReliability() {
        const results = [];
        _sourceReliability.forEach((stats, source) => {
            results.push({
                source,
                reliability: Math.round(getSourceReliability(source) * 1000) / 1000,
                ...stats
            });
        });
        return results.sort((a, b) => b.reliability - a.reliability);
    }

    /**
     * Weight a confidence value by source reliability.
     * High-reliability sources have less dampening; low-reliability sources get pulled toward 0.5.
     * @param {number} confidence - Raw confidence [0, 1]
     * @param {string} source - Source identifier
     * @returns {number} - Weighted confidence [0, 1]
     */
    function weightBySource(confidence, source) {
        const reliability = getSourceReliability(source);
        // Interpolate between 0.5 (no trust) and raw confidence (full trust)
        return 0.5 + (confidence - 0.5) * reliability;
    }

    // ======================== BELIEF PROPAGATION ========================
    // When a node's confidence changes, cascade probabilistic updates
    // through connected nodes via message passing.

    /**
     * Propagate a confidence change from a source node through the graph.
     * Uses damped message passing — each hop reduces the update magnitude.
     *
     * @param {WorldModel} model
     * @param {string} sourceNodeId - The node whose confidence just changed
     * @param {Object} [opts]
     * @param {number} [opts.damping=0.3] - How much the signal decays per hop (0-1)
     * @param {number} [opts.maxDepth=3] - Maximum propagation depth
     * @param {string} [opts.trigger='propagation'] - Trigger label for history
     * @returns {Array<{nodeId: string, oldConfidence: number, newConfidence: number}>} - List of updated nodes
     */
    function propagate(model, sourceNodeId, opts = {}) {
        const damping = opts.damping ?? 0.3;
        const maxDepth = opts.maxDepth ?? 3;
        const trigger = opts.trigger ?? 'propagation';
        const updates = [];

        const sourceNode = model.nodes.get(sourceNodeId);
        if (!sourceNode) return updates;

        // BFS with decaying influence
        const visited = new Set([sourceNodeId]);
        let frontier = [{ nodeId: sourceNodeId, depth: 0, signal: sourceNode.confidence }];

        while (frontier.length > 0) {
            const nextFrontier = [];

            for (const { nodeId, depth, signal } of frontier) {
                if (depth >= maxDepth) continue;

                // Find all neighbors
                model.edges.forEach(edge => {
                    let neighborId = null;
                    let edgeWeight = edge.weight || 1;

                    if (edge.from === nodeId) neighborId = edge.to;
                    else if (edge.to === nodeId) neighborId = edge.from;
                    if (!neighborId || visited.has(neighborId)) return;

                    const neighbor = model.nodes.get(neighborId);
                    if (!neighbor) return;
                    // Don't propagate into established/falsified nodes
                    if (neighbor.epistemicStatus === 'established' || neighbor.epistemicStatus === 'falsified') return;

                    visited.add(neighborId);

                    // Compute influence: how much the source's confidence should pull this neighbor
                    const influence = damping * edgeWeight;
                    const delta = (signal - neighbor.confidence) * influence;

                    if (Math.abs(delta) < 0.01) return; // below threshold

                    const oldConfidence = neighbor.confidence;
                    nudgeConfidence(neighbor, delta, trigger, 'propagation');
                    updates.push({ nodeId: neighborId, oldConfidence, newConfidence: neighbor.confidence });

                    nextFrontier.push({
                        nodeId: neighborId,
                        depth: depth + 1,
                        signal: neighbor.confidence
                    });
                });
            }

            frontier = nextFrontier;
        }

        return updates;
    }

    // ======================== EXPECTED INFORMATION GAIN ========================
    // Rank nodes by how much resolving them would reduce total graph entropy.

    /**
     * Compute the Expected Information Gain for each node.
     * EIG(node) = H(graph) - E[H(graph | node resolved)]
     *
     * Nodes with high EIG are the highest-leverage questions to investigate.
     *
     * @param {WorldModel} model
     * @returns {Array<{nodeId: string, label: string, eig: number, confidence: number, dependents: number}>}
     */
    function computeEIG(model) {
        const nodes = [...model.nodes.values()];
        if (nodes.length === 0) return [];

        // Current total graph entropy
        const H_current = _graphEntropy(nodes);

        const results = [];

        for (const node of nodes) {
            // Skip already-resolved nodes
            if (node.epistemicStatus === 'established' || node.epistemicStatus === 'falsified') continue;

            // Count dependents (nodes that this node's edges connect to)
            let dependents = 0;
            model.edges.forEach(e => {
                if (e.from === node.id || e.to === node.id) dependents++;
            });

            // Simulate: what if this node were resolved to confidence=1?
            const savedConfidence = node.confidence;

            node.confidence = 0.95; // simulate "established"
            const H_if_true = _graphEntropy(nodes);

            node.confidence = 0.05; // simulate "falsified"
            const H_if_false = _graphEntropy(nodes);

            node.confidence = savedConfidence; // restore

            // Expected entropy = weighted average of both outcomes
            // Weight by current confidence (prior)
            const p = savedConfidence;
            const H_expected = p * H_if_true + (1 - p) * H_if_false;

            const eig = H_current - H_expected;

            results.push({
                nodeId: node.id,
                label: node.label,
                eig: Math.round(eig * 1000) / 1000,
                confidence: savedConfidence,
                dependents
            });
        }

        // Sort by EIG descending
        results.sort((a, b) => b.eig - a.eig);
        return results;
    }

    /**
     * Get the top-N highest EIG nodes (the most valuable to investigate).
     * @param {WorldModel} model
     * @param {number} [n=5]
     * @returns {Array}
     */
    function getHighestEIG(model, n = 5) {
        return computeEIG(model).slice(0, n);
    }

    /** Compute total Shannon entropy across all node confidences. */
    function _graphEntropy(nodes) {
        let total = 0;
        for (const node of nodes) {
            const p = Math.max(0.001, Math.min(0.999, node.confidence));
            total += -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
        }
        return total;
    }

    // ======================== VULNERABILITY SCANNER ========================
    // Identify the weakest nodes for adversarial red-teaming.

    /**
     * Score every node by vulnerability — how likely it is to be wrong
     * and how much damage it would cause if it were.
     *
     * Vulnerability = overconfidence × load-bearing × under-testing
     *
     * @param {WorldModel} model
     * @returns {Array<{nodeId: string, label: string, vulnerability: number, reasons: string[]}>}
     */
    function scanVulnerabilities(model) {
        const nodes = [...model.nodes.values()];
        if (nodes.length === 0) return [];

        const results = [];

        for (const node of nodes) {
            if (node.epistemicStatus === 'falsified') continue;

            const reasons = [];
            let score = 0;

            // 1. Overconfidence: high confidence + no evidence
            let evidenceCount = 0;
            model.edges.forEach(e => {
                if (e.from === node.id) {
                    const child = model.nodes.get(e.to);
                    if (child && child.type === 'evidence') evidenceCount++;
                }
            });

            if (node.confidence > 0.7 && evidenceCount === 0 && node.type !== 'axiom') {
                const oc = (node.confidence - 0.5) * 2; // 0-1 scale
                score += oc * 0.4;
                reasons.push(`Overconfident (${(node.confidence * 100).toFixed(0)}%) with no evidence`);
            }

            // 2. Load-bearing: many downstream dependents
            let downstreamCount = 0;
            const countDownstream = (nid, visited = new Set()) => {
                model.edges.forEach(e => {
                    if (e.from === nid && !visited.has(e.to)) {
                        visited.add(e.to);
                        downstreamCount++;
                        countDownstream(e.to, visited);
                    }
                });
            };
            countDownstream(node.id);

            if (downstreamCount >= 3) {
                score += Math.min(downstreamCount / 10, 1) * 0.3;
                reasons.push(`Load-bearing: ${downstreamCount} downstream nodes depend on this`);
            }

            // 3. Under-tested: few history entries relative to importance
            const history = _histories.get(node.id) || [];
            if (history.length <= 1 && node.confidence > 0.5) {
                score += 0.2;
                reasons.push(`Under-tested: only ${history.length} historical state(s)`);
            }

            // 4. Oscillation risk
            const pathologies = detectPathologies(node.id);
            if (pathologies.some(p => p.type === 'oscillation')) {
                score += 0.3;
                reasons.push('Oscillating confidence — inconclusive evidence');
            }

            if (score > 0.05) {
                results.push({
                    nodeId: node.id,
                    label: node.label,
                    vulnerability: Math.round(Math.min(score, 1) * 1000) / 1000,
                    reasons
                });
            }
        }

        results.sort((a, b) => b.vulnerability - a.vulnerability);
        return results;
    }

    /**
     * Get the single most vulnerable node — the best target for red-teaming.
     * @param {WorldModel} model
     * @returns {{nodeId: string, label: string, vulnerability: number, reasons: string[]}|null}
     */
    function getMostVulnerable(model) {
        const vulns = scanVulnerabilities(model);
        return vulns.length > 0 ? vulns[0] : null;
    }

    // ======================== PUBLIC API ========================

    return {
        // History
        initHistory,
        recordChange,
        getHistory,
        clearHistory,
        clearAllHistory,
        detectPathologies,

        // Loss
        computeLoss,

        // Confidence
        setConfidence,
        nudgeConfidence,

        // Calibration
        recordResolution,
        getCalibration,

        // Belief Propagation
        propagate,

        // Information Gain
        computeEIG,
        getHighestEIG,

        // Vulnerability / Red-Team
        scanVulnerabilities,
        getMostVulnerable,

        // Source Reliability
        recordSourceOutcome,
        getSourceReliability,
        getAllSourceReliability,
        weightBySource,

        // Serialization
        toJSON,
        fromJSON
    };

})();

// Export for both module and script contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Epistemics };
} else {
    window.Epistemics = Epistemics;
}

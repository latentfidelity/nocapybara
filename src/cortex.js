// ============================================
// NOCAPYBARA — Cognitive Compression Engine
// ============================================
// Compresses the full epistemic graph state into
// minimal cognitive updates suitable for BCI output.
// Three layers: Summarization, Attention, Belief Deltas.

const Cortex = (() => {

    // ======================== SNAPSHOTS ========================
    // Store graph state snapshots for computing deltas between sessions.

    let _lastSnapshot = null;

    /**
     * Capture the current graph state as a snapshot.
     * @param {WorldModel} model
     * @returns {Object} snapshot
     */
    function captureSnapshot(model) {
        const snapshot = {
            t: Date.now(),
            nodes: {}
        };
        model.nodes.forEach(node => {
            snapshot.nodes[node.id] = {
                label: node.label,
                confidence: node.confidence,
                epistemicStatus: node.epistemicStatus,
                type: node.type
            };
        });
        return snapshot;
    }

    /**
     * Save a snapshot as the "last known state" for delta computation.
     * @param {Object} snapshot
     */
    function saveSnapshot(snapshot) {
        _lastSnapshot = snapshot;
    }

    /**
     * Get the last saved snapshot.
     * @returns {Object|null}
     */
    function getLastSnapshot() {
        return _lastSnapshot;
    }

    // ======================== BELIEF DELTAS ========================
    // Compute what changed between two snapshots.

    /**
     * @typedef {Object} BeliefDelta
     * @property {Array<{nodeId, label, from, to, direction}>} confidenceChanges
     * @property {Array<{nodeId, label, from, to}>} statusChanges
     * @property {Array<{nodeId, label, confidence}>} newNodes
     * @property {Array<{nodeId, label}>} removedNodes
     * @property {number} totalChanges
     */

    /**
     * Compute the delta between two graph snapshots.
     * @param {Object} before - Previous snapshot
     * @param {Object} after - Current snapshot
     * @returns {BeliefDelta}
     */
    function computeDelta(before, after) {
        if (!before || !after) return _emptyDelta();

        const delta = {
            confidenceChanges: [],
            statusChanges: [],
            newNodes: [],
            removedNodes: [],
            totalChanges: 0
        };

        // Find changes and new nodes
        for (const [id, afterState] of Object.entries(after.nodes)) {
            const beforeState = before.nodes[id];

            if (!beforeState) {
                delta.newNodes.push({
                    nodeId: id,
                    label: afterState.label,
                    confidence: afterState.confidence
                });
                delta.totalChanges++;
                continue;
            }

            // Confidence change (threshold: 0.05)
            const confDelta = afterState.confidence - beforeState.confidence;
            if (Math.abs(confDelta) >= 0.05) {
                delta.confidenceChanges.push({
                    nodeId: id,
                    label: afterState.label,
                    from: Math.round(beforeState.confidence * 100) / 100,
                    to: Math.round(afterState.confidence * 100) / 100,
                    direction: confDelta > 0 ? 'strengthened' : 'weakened'
                });
                delta.totalChanges++;
            }

            // Status change
            if (afterState.epistemicStatus !== beforeState.epistemicStatus) {
                delta.statusChanges.push({
                    nodeId: id,
                    label: afterState.label,
                    from: beforeState.epistemicStatus,
                    to: afterState.epistemicStatus
                });
                delta.totalChanges++;
            }
        }

        // Find removed nodes
        for (const [id, beforeState] of Object.entries(before.nodes)) {
            if (!after.nodes[id]) {
                delta.removedNodes.push({ nodeId: id, label: beforeState.label });
                delta.totalChanges++;
            }
        }

        // Sort confidence changes by magnitude
        delta.confidenceChanges.sort((a, b) =>
            Math.abs(b.to - b.from) - Math.abs(a.to - a.from)
        );

        return delta;
    }

    /**
     * Compute delta from the last saved snapshot to the current model.
     * @param {WorldModel} model
     * @returns {BeliefDelta}
     */
    function computeDeltaFromLast(model) {
        const current = captureSnapshot(model);
        return computeDelta(_lastSnapshot, current);
    }

    function _emptyDelta() {
        return { confidenceChanges: [], statusChanges: [], newNodes: [], removedNodes: [], totalChanges: 0 };
    }

    // ======================== ATTENTION QUEUE ========================
    // Combine EIG, vulnerability, recency, and contradictions into a
    // single prioritized attention feed.

    /**
     * @typedef {Object} AttentionItem
     * @property {string} nodeId
     * @property {string} label
     * @property {number} priority - Combined priority score [0, 1]
     * @property {string} reason - Why this needs attention
     * @property {string} action - Suggested action
     */

    /**
     * Generate an attention queue — the top items that need the user's focus.
     * @param {WorldModel} model
     * @param {Object} [opts]
     * @param {number} [opts.maxItems=5]
     * @returns {Array<AttentionItem>}
     */
    function getAttentionQueue(model, opts = {}) {
        const maxItems = opts.maxItems ?? 5;
        const items = [];
        const seen = new Set();

        // 1. High-EIG nodes (most valuable to investigate)
        if (typeof Epistemics !== 'undefined') {
            const eigs = Epistemics.getHighestEIG(model, 3);
            eigs.forEach(e => {
                if (seen.has(e.nodeId)) return;
                seen.add(e.nodeId);
                items.push({
                    nodeId: e.nodeId,
                    label: e.label,
                    priority: Math.min(e.eig, 1),
                    reason: `High information gain (EIG: ${e.eig})`,
                    action: 'investigate'
                });
            });
        }

        // 2. Vulnerable nodes (most at risk of being wrong)
        if (typeof Epistemics !== 'undefined') {
            const vulns = Epistemics.scanVulnerabilities(model).slice(0, 3);
            vulns.forEach(v => {
                if (seen.has(v.nodeId)) return;
                seen.add(v.nodeId);
                items.push({
                    nodeId: v.nodeId,
                    label: v.label,
                    priority: v.vulnerability * 0.9,
                    reason: v.reasons[0] || 'Vulnerable',
                    action: 'red-team'
                });
            });
        }

        // 3. Logic contradictions
        if (typeof Logic !== 'undefined') {
            const contradictions = Logic.checkConsistency(model).slice(0, 2);
            contradictions.forEach(c => {
                const id = c.nodeA;
                if (seen.has(id)) return;
                seen.add(id);
                items.push({
                    nodeId: id,
                    label: c.labelA,
                    priority: c.connected ? 0.95 : 0.7,
                    reason: `Contradicts "${c.labelB}"`,
                    action: 'resolve-contradiction'
                });
            });
        }

        // 4. Redundant nodes
        if (typeof Semantics !== 'undefined') {
            const redundancies = Semantics.findRedundancies(model, 0.8).slice(0, 2);
            redundancies.forEach(r => {
                const id = r.nodeA;
                if (seen.has(id)) return;
                seen.add(id);
                items.push({
                    nodeId: id,
                    label: r.labelA,
                    priority: r.similarity * 0.5,
                    reason: `Possibly redundant with "${r.labelB}" (${(r.similarity * 100).toFixed(0)}% similar)`,
                    action: 'merge-or-differentiate'
                });
            });
        }

        // Sort by priority descending, take top N
        items.sort((a, b) => b.priority - a.priority);
        return items.slice(0, maxItems);
    }

    // ======================== SUMMARIZATION HIERARCHY ========================
    // Collapse the graph into a 3-level summary tree.

    /**
     * Generate a hierarchical summary of the graph state.
     * Level 1: High-level themes (semantic clusters)
     * Level 2: Key claims per theme
     * Level 3: Supporting evidence count + confidence
     *
     * @param {WorldModel} model
     * @returns {Object} summary
     */
    function summarize(model) {
        const nodes = [...model.nodes.values()];
        if (nodes.length === 0) {
            return { themes: [], totalNodes: 0, totalEdges: 0, avgConfidence: 0, healthScore: 0 };
        }

        // Compute global stats
        const totalNodes = nodes.length;
        const totalEdges = model.edges.size;
        const avgConfidence = nodes.reduce((sum, n) => sum + n.confidence, 0) / totalNodes;

        // Get loss for health score
        let healthScore = 1;
        if (typeof Epistemics !== 'undefined') {
            const loss = Epistemics.computeLoss(model);
            healthScore = Math.round(Math.max(0, 1 - loss.total) * 1000) / 1000;
        }

        // Build themes from semantic clusters
        const themes = [];
        if (typeof Semantics !== 'undefined') {
            const clusters = Semantics.clusterNodes(model, 0.3);
            clusters.forEach((cluster, i) => {
                const clusterNodes = cluster.map(c => model.nodes.get(c.nodeId)).filter(Boolean);
                const claims = clusterNodes.filter(n => n.type === 'claim' || n.type === 'argument');
                const evidence = clusterNodes.filter(n => n.type === 'evidence');
                const avgConf = clusterNodes.reduce((s, n) => s + n.confidence, 0) / clusterNodes.length;

                // Theme label = most common words across cluster labels
                const label = _deriveThemeLabel(clusterNodes) || `Theme ${i + 1}`;

                themes.push({
                    label,
                    nodeCount: clusterNodes.length,
                    claims: claims.map(c => ({ label: c.label, confidence: Math.round(c.confidence * 100) / 100 })),
                    evidenceCount: evidence.length,
                    avgConfidence: Math.round(avgConf * 100) / 100
                });
            });
        }

        // Add unclustered nodes as a "Miscellaneous" theme
        const clusteredIds = new Set();
        themes.forEach(t => t.claims.forEach(c => {
            // find node by label
            model.nodes.forEach(n => { if (n.label === c.label) clusteredIds.add(n.id); });
        }));

        const unclustered = nodes.filter(n => !clusteredIds.has(n.id));
        if (unclustered.length > 0 && themes.length > 0) {
            themes.push({
                label: 'Uncategorized',
                nodeCount: unclustered.length,
                claims: unclustered
                    .filter(n => n.type === 'claim' || n.type === 'argument')
                    .slice(0, 5)
                    .map(c => ({ label: c.label, confidence: Math.round(c.confidence * 100) / 100 })),
                evidenceCount: unclustered.filter(n => n.type === 'evidence').length,
                avgConfidence: Math.round(unclustered.reduce((s, n) => s + n.confidence, 0) / unclustered.length * 100) / 100
            });
        }

        return {
            themes,
            totalNodes,
            totalEdges,
            avgConfidence: Math.round(avgConfidence * 100) / 100,
            healthScore
        };
    }

    /**
     * Derive a theme label from the most common meaningful words in cluster node labels.
     * @param {Array<NexusNode>} nodes
     * @returns {string}
     */
    function _deriveThemeLabel(nodes) {
        const wordCounts = new Map();
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'to', 'for', 'and', 'or', 'not', 'that', 'this']);

        nodes.forEach(n => {
            const words = n.label.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
            const seen = new Set();
            words.forEach(w => {
                if (!seen.has(w)) { seen.add(w); wordCounts.set(w, (wordCounts.get(w) || 0) + 1); }
            });
        });

        // Top 2-3 words that appear in multiple nodes
        const topWords = [...wordCounts.entries()]
            .filter(([, count]) => count > 1)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));

        return topWords.length > 0 ? topWords.join(' & ') : '';
    }

    // ======================== COGNITIVE DIGEST ========================
    // The single output function that produces a BCI-ready cognitive update.

    /**
     * Generate a complete cognitive digest — the minimal information
     * needed to update a human's mental model of the graph.
     *
     * This is the primary BCI output function.
     *
     * @param {WorldModel} model
     * @param {Object} [opts]
     * @param {number} [opts.attentionItems=5]
     * @returns {Object} digest
     */
    function digest(model, opts = {}) {
        const attentionItems = opts.attentionItems ?? 5;

        // 1. Belief delta from last session
        const delta = computeDeltaFromLast(model);

        // 2. Attention queue
        const attention = getAttentionQueue(model, { maxItems: attentionItems });

        // 3. Summary
        const summary = summarize(model);

        // 4. Calibration
        let calibration = { brierScore: null, count: 0 };
        if (typeof Epistemics !== 'undefined') {
            calibration = Epistemics.getCalibration();
        }

        // 5. Source leaderboard
        let sources = [];
        if (typeof Epistemics !== 'undefined') {
            sources = Epistemics.getAllSourceReliability();
        }

        return {
            timestamp: Date.now(),
            delta,
            attention,
            summary,
            calibration,
            sources,
            // BCI-formatted one-liner
            headline: _generateHeadline(delta, attention, summary)
        };
    }

    /**
     * Generate a single-sentence headline summarizing the digest.
     * This is what gets pushed to a BCI display.
     */
    function _generateHeadline(delta, attention, summary) {
        const parts = [];

        if (delta.totalChanges > 0) {
            const strengthened = delta.confidenceChanges.filter(c => c.direction === 'strengthened').length;
            const weakened = delta.confidenceChanges.filter(c => c.direction === 'weakened').length;
            if (strengthened > 0) parts.push(`${strengthened} belief${strengthened > 1 ? 's' : ''} strengthened`);
            if (weakened > 0) parts.push(`${weakened} weakened`);
            if (delta.newNodes.length > 0) parts.push(`${delta.newNodes.length} new`);
        }

        if (attention.length > 0) {
            parts.push(`${attention.length} item${attention.length > 1 ? 's' : ''} need attention`);
        }

        if (summary.healthScore < 0.5) {
            parts.push(`health: ${(summary.healthScore * 100).toFixed(0)}%`);
        }

        return parts.length > 0 ? parts.join(' · ') : 'Graph stable — no updates needed.';
    }

    // ======================== SERIALIZATION ========================

    function toJSON() {
        return {
            lastSnapshot: _lastSnapshot
        };
    }

    function fromJSON(data) {
        _lastSnapshot = data?.lastSnapshot || null;
    }

    // ======================== PUBLIC API ========================

    return {
        // Snapshots
        captureSnapshot,
        saveSnapshot,
        getLastSnapshot,

        // Deltas
        computeDelta,
        computeDeltaFromLast,

        // Attention
        getAttentionQueue,

        // Summarization
        summarize,

        // Digest (primary BCI output)
        digest,

        // Serialization
        toJSON,
        fromJSON
    };

})();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Cortex };
} else {
    window.Cortex = Cortex;
}

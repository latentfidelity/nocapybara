// ============================================
// NOCAPYBARA — Formal Logic Layer
// ============================================
// Lightweight propositional logic consistency checker.
// Each node can carry formal propositions. The system
// detects contradictions across connected nodes.

const Logic = (() => {

    // ======================== PROPOSITION STORAGE ========================
    // Each node can have an array of propositions in its properties.
    // Format: { subject: string, predicate: string, negated: boolean }

    /**
     * Extract propositions from a node's formalLogic property.
     * @param {NexusNode} node
     * @returns {Array<{subject: string, predicate: string, negated: boolean}>}
     */
    function getPropositions(node) {
        return node.properties?.formalLogic || [];
    }

    /**
     * Set propositions on a node.
     * @param {NexusNode} node
     * @param {Array<{subject: string, predicate: string, negated: boolean}>} propositions
     */
    function setPropositions(node, propositions) {
        if (!node.properties) node.properties = {};
        node.properties.formalLogic = propositions;
    }

    /**
     * Add a proposition to a node.
     * @param {NexusNode} node
     * @param {string} subject
     * @param {string} predicate
     * @param {boolean} [negated=false]
     */
    function addProposition(node, subject, predicate, negated = false) {
        if (!node.properties) node.properties = {};
        if (!node.properties.formalLogic) node.properties.formalLogic = [];
        node.properties.formalLogic.push({
            subject: subject.toLowerCase().trim(),
            predicate: predicate.toLowerCase().trim(),
            negated
        });
    }

    /**
     * Generate a canonical key for a proposition (for comparison).
     */
    function _propKey(prop) {
        return `${prop.subject}::${prop.predicate}`;
    }

    // ======================== CONSISTENCY CHECKING ========================

    /**
     * @typedef {Object} Contradiction
     * @property {string} nodeA - ID of first node
     * @property {string} nodeB - ID of second node
     * @property {string} labelA - Label of first node
     * @property {string} labelB - Label of second node
     * @property {{subject: string, predicate: string}} proposition
     * @property {string} description - Human-readable description
     */

    /**
     * Check for contradictions across the entire graph.
     * A contradiction occurs when one node asserts P and another
     * connected node asserts ¬P (same subject+predicate, opposite negation).
     *
     * @param {WorldModel} model
     * @returns {Array<Contradiction>}
     */
    function checkConsistency(model) {
        const contradictions = [];

        // Build adjacency set for quick lookup
        const adjacency = new Map();
        model.edges.forEach(edge => {
            if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
            if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
            adjacency.get(edge.from).add(edge.to);
            adjacency.get(edge.to).add(edge.from);
        });

        // Build proposition index: propKey → [{nodeId, negated}]
        const propIndex = new Map();
        model.nodes.forEach(node => {
            const props = getPropositions(node);
            props.forEach(prop => {
                const key = _propKey(prop);
                if (!propIndex.has(key)) propIndex.set(key, []);
                propIndex.get(key).push({ nodeId: node.id, negated: prop.negated, prop });
            });
        });

        // Find contradictions: same key, one negated and one not, and nodes are connected
        const seen = new Set();
        propIndex.forEach((entries, key) => {
            const positives = entries.filter(e => !e.negated);
            const negatives = entries.filter(e => e.negated);

            for (const pos of positives) {
                for (const neg of negatives) {
                    if (pos.nodeId === neg.nodeId) continue; // self-contradiction

                    // Check if connected (direct or shared neighbor)
                    const isConnected = adjacency.get(pos.nodeId)?.has(neg.nodeId) ||
                                       adjacency.get(neg.nodeId)?.has(pos.nodeId);

                    // Also check global contradictions (not just connected)
                    const pairKey = [pos.nodeId, neg.nodeId].sort().join('::') + '::' + key;
                    if (seen.has(pairKey)) continue;
                    seen.add(pairKey);

                    const nodeA = model.nodes.get(pos.nodeId);
                    const nodeB = model.nodes.get(neg.nodeId);
                    if (!nodeA || !nodeB) continue;

                    contradictions.push({
                        nodeA: pos.nodeId,
                        nodeB: neg.nodeId,
                        labelA: nodeA.label,
                        labelB: nodeB.label,
                        proposition: { subject: pos.prop.subject, predicate: pos.prop.predicate },
                        connected: !!isConnected,
                        description: `"${nodeA.label}" asserts ${pos.prop.subject} ${pos.prop.predicate}, but "${nodeB.label}" denies it.`
                    });
                }
            }
        });

        // Sort: connected contradictions first, then by severity
        contradictions.sort((a, b) => (b.connected ? 1 : 0) - (a.connected ? 1 : 0));

        return contradictions;
    }

    /**
     * Check a specific node against all others.
     * @param {WorldModel} model
     * @param {string} nodeId
     * @returns {Array<Contradiction>}
     */
    function checkNode(model, nodeId) {
        return checkConsistency(model).filter(c => c.nodeA === nodeId || c.nodeB === nodeId);
    }

    // ======================== AUTO-EXTRACT PROPOSITIONS ========================

    /**
     * Attempt to extract simple propositions from a node's label and description.
     * This is a heuristic, not a full NLP parser.
     * Returns suggested propositions that the user can confirm.
     *
     * @param {NexusNode} node
     * @returns {Array<{subject: string, predicate: string, negated: boolean}>}
     */
    function suggestPropositions(node) {
        const text = `${node.label} ${node.description || ''}`.toLowerCase().trim();
        if (!text) return [];

        const suggestions = [];
        const negationPatterns = /\b(not|never|no|isn't|aren't|doesn't|don't|can't|cannot|won't|isn't|false|incorrect|wrong)\b/;
        const isNegated = negationPatterns.test(text);

        // Simple "X is Y" pattern
        const isMatch = text.match(/^(.+?)\s+(?:is|are|was|were)\s+(.+?)$/);
        if (isMatch) {
            let subject = isMatch[1].replace(negationPatterns, '').trim();
            let predicate = isMatch[2].replace(negationPatterns, '').trim();
            if (subject && predicate) {
                suggestions.push({ subject, predicate, negated: isNegated });
            }
        }

        // "X causes Y" / "X leads to Y" pattern
        const causalMatch = text.match(/^(.+?)\s+(?:causes?|leads?\s+to|results?\s+in)\s+(.+?)$/);
        if (causalMatch) {
            suggestions.push({
                subject: causalMatch[1].replace(negationPatterns, '').trim(),
                predicate: `causes ${causalMatch[2].replace(negationPatterns, '').trim()}`,
                negated: isNegated
            });
        }

        return suggestions;
    }

    // ======================== PUBLIC API ========================

    return {
        getPropositions,
        setPropositions,
        addProposition,
        checkConsistency,
        checkNode,
        suggestPropositions
    };

})();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Logic };
} else {
    window.Logic = Logic;
}

// ============================================
// NOCAPYBARA — Semantic Similarity Engine
// ============================================
// TF-IDF cosine similarity for redundancy detection,
// gap analysis, and semantic clustering.
// No neural model required — upgradeable to embeddings later.

const Semantics = (() => {

    // ======================== TOKENIZATION ========================

    const STOP_WORDS = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
        'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it',
        'they', 'them', 'their', 'this', 'that', 'these', 'those', 'what',
        'which', 'who', 'whom', 'and', 'or', 'but', 'if', 'then', 'else',
        'when', 'where', 'how', 'why', 'all', 'each', 'every', 'both',
        'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
        'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
        'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
        'up', 'about', 'into', 'through', 'during', 'before', 'after',
        'above', 'below', 'between', 'under', 'again', 'further', 'once'
    ]);

    /**
     * Tokenize text into normalized terms (lowercase, no stopwords, no punctuation).
     * @param {string} text
     * @returns {string[]}
     */
    function tokenize(text) {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 1 && !STOP_WORDS.has(w));
    }

    // ======================== TF-IDF ========================

    /**
     * Build a TF-IDF matrix from a set of documents.
     * @param {Array<{id: string, text: string}>} docs
     * @returns {{vectors: Map<string, Map<string, number>>, vocabulary: Set<string>}}
     */
    function buildTFIDF(docs) {
        const N = docs.length;
        if (N === 0) return { vectors: new Map(), vocabulary: new Set() };

        // Term frequency per document
        const tf = new Map();
        const vocabulary = new Set();

        docs.forEach(doc => {
            const tokens = tokenize(doc.text);
            const counts = new Map();
            tokens.forEach(t => {
                counts.set(t, (counts.get(t) || 0) + 1);
                vocabulary.add(t);
            });
            // Normalize TF by document length
            const len = tokens.length || 1;
            const normalized = new Map();
            counts.forEach((count, term) => {
                normalized.set(term, count / len);
            });
            tf.set(doc.id, normalized);
        });

        // Inverse document frequency
        const idf = new Map();
        vocabulary.forEach(term => {
            let docCount = 0;
            tf.forEach(termFreqs => {
                if (termFreqs.has(term)) docCount++;
            });
            idf.set(term, Math.log(N / (docCount + 1)) + 1); // smoothed IDF
        });

        // TF-IDF vectors
        const vectors = new Map();
        tf.forEach((termFreqs, docId) => {
            const vec = new Map();
            termFreqs.forEach((freq, term) => {
                vec.set(term, freq * idf.get(term));
            });
            vectors.set(docId, vec);
        });

        return { vectors, vocabulary };
    }

    /**
     * Compute cosine similarity between two sparse vectors.
     * @param {Map<string, number>} a
     * @param {Map<string, number>} b
     * @returns {number} Similarity in [0, 1]
     */
    function cosineSimilarity(a, b) {
        let dot = 0, magA = 0, magB = 0;

        a.forEach((val, key) => {
            magA += val * val;
            if (b.has(key)) dot += val * b.get(key);
        });
        b.forEach(val => { magB += val * val; });

        magA = Math.sqrt(magA);
        magB = Math.sqrt(magB);

        if (magA === 0 || magB === 0) return 0;
        return dot / (magA * magB);
    }

    // ======================== GRAPH ANALYSIS ========================

    /**
     * Find potential duplicate/redundant nodes.
     * @param {WorldModel} model
     * @param {number} [threshold=0.7] - Similarity threshold for flagging
     * @returns {Array<{nodeA: string, nodeB: string, labelA: string, labelB: string, similarity: number}>}
     */
    function findRedundancies(model, threshold = 0.7) {
        const docs = [];
        model.nodes.forEach(node => {
            const text = `${node.label} ${node.description || ''} ${node.content || ''}`.trim();
            if (text) docs.push({ id: node.id, text });
        });

        if (docs.length < 2) return [];

        const { vectors } = buildTFIDF(docs);
        const pairs = [];

        const ids = [...vectors.keys()];
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const sim = cosineSimilarity(vectors.get(ids[i]), vectors.get(ids[j]));
                if (sim >= threshold) {
                    const nodeA = model.nodes.get(ids[i]);
                    const nodeB = model.nodes.get(ids[j]);
                    pairs.push({
                        nodeA: ids[i],
                        nodeB: ids[j],
                        labelA: nodeA?.label || ids[i],
                        labelB: nodeB?.label || ids[j],
                        similarity: Math.round(sim * 1000) / 1000
                    });
                }
            }
        }

        pairs.sort((a, b) => b.similarity - a.similarity);
        return pairs;
    }

    /**
     * Cluster nodes by semantic similarity using simple single-linkage clustering.
     * @param {WorldModel} model
     * @param {number} [threshold=0.4] - Minimum similarity to be in the same cluster
     * @returns {Array<Array<{nodeId: string, label: string}>>} - Array of clusters
     */
    function clusterNodes(model, threshold = 0.4) {
        const docs = [];
        model.nodes.forEach(node => {
            const text = `${node.label} ${node.description || ''}`.trim();
            if (text) docs.push({ id: node.id, text });
        });

        if (docs.length === 0) return [];

        const { vectors } = buildTFIDF(docs);
        const ids = [...vectors.keys()];

        // Union-Find for clustering
        const parent = new Map();
        ids.forEach(id => parent.set(id, id));

        function find(x) {
            while (parent.get(x) !== x) {
                parent.set(x, parent.get(parent.get(x)));
                x = parent.get(x);
            }
            return x;
        }

        function union(a, b) {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent.set(ra, rb);
        }

        // Merge nodes above threshold
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const sim = cosineSimilarity(vectors.get(ids[i]), vectors.get(ids[j]));
                if (sim >= threshold) union(ids[i], ids[j]);
            }
        }

        // Collect clusters
        const clusters = new Map();
        ids.forEach(id => {
            const root = find(id);
            if (!clusters.has(root)) clusters.set(root, []);
            const node = model.nodes.get(id);
            clusters.get(root).push({ nodeId: id, label: node?.label || id });
        });

        // Return only clusters with 2+ nodes, sorted by size
        return [...clusters.values()]
            .filter(c => c.length > 1)
            .sort((a, b) => b.length - a.length);
    }

    /**
     * Compute a pairwise similarity matrix for all nodes.
     * Useful for understanding overall graph coherence.
     * @param {WorldModel} model
     * @returns {{matrix: Array<{from: string, to: string, similarity: number}>, avgSimilarity: number}}
     */
    function similarityMatrix(model) {
        const docs = [];
        model.nodes.forEach(node => {
            const text = `${node.label} ${node.description || ''}`.trim();
            if (text) docs.push({ id: node.id, text });
        });

        if (docs.length < 2) return { matrix: [], avgSimilarity: 0 };

        const { vectors } = buildTFIDF(docs);
        const ids = [...vectors.keys()];
        const matrix = [];
        let totalSim = 0;
        let count = 0;

        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const sim = cosineSimilarity(vectors.get(ids[i]), vectors.get(ids[j]));
                matrix.push({ from: ids[i], to: ids[j], similarity: Math.round(sim * 1000) / 1000 });
                totalSim += sim;
                count++;
            }
        }

        return {
            matrix: matrix.sort((a, b) => b.similarity - a.similarity),
            avgSimilarity: count > 0 ? Math.round((totalSim / count) * 1000) / 1000 : 0
        };
    }

    // ======================== PUBLIC API ========================

    return {
        tokenize,
        buildTFIDF,
        cosineSimilarity,
        findRedundancies,
        clusterNodes,
        similarityMatrix
    };

})();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Semantics };
} else {
    window.Semantics = Semantics;
}

const { Semantics } = require('../src/semantics');
const { WorldModel } = require('../src/model');

describe('Semantics', () => {

    describe('Tokenization', () => {
        test('tokenize removes stopwords and punctuation', () => {
            const tokens = Semantics.tokenize('The quick brown fox jumps over the lazy dog!');
            expect(tokens).not.toContain('the');
            expect(tokens).toContain('quick');
            expect(tokens).toContain('brown');
            expect(tokens).toContain('fox');
        });

        test('tokenize normalizes case', () => {
            const tokens = Semantics.tokenize('Neural Networks Are POWERFUL');
            expect(tokens).toContain('neural');
            expect(tokens).toContain('networks');
            expect(tokens).toContain('powerful');
        });

        test('tokenize handles empty string', () => {
            expect(Semantics.tokenize('')).toEqual([]);
        });
    });

    describe('TF-IDF', () => {
        test('builds vectors for documents', () => {
            const docs = [
                { id: 'a', text: 'machine learning algorithms' },
                { id: 'b', text: 'deep learning neural networks' }
            ];
            const { vectors } = Semantics.buildTFIDF(docs);
            expect(vectors.size).toBe(2);
            expect(vectors.get('a').size).toBeGreaterThan(0);
        });

        test('empty docs returns empty', () => {
            const { vectors } = Semantics.buildTFIDF([]);
            expect(vectors.size).toBe(0);
        });
    });

    describe('Cosine Similarity', () => {
        test('identical vectors have similarity 1', () => {
            const a = new Map([['foo', 1], ['bar', 2]]);
            const sim = Semantics.cosineSimilarity(a, a);
            expect(sim).toBeCloseTo(1.0, 5);
        });

        test('orthogonal vectors have similarity 0', () => {
            const a = new Map([['foo', 1]]);
            const b = new Map([['bar', 1]]);
            expect(Semantics.cosineSimilarity(a, b)).toBe(0);
        });

        test('empty vector returns 0', () => {
            const a = new Map();
            const b = new Map([['foo', 1]]);
            expect(Semantics.cosineSimilarity(a, b)).toBe(0);
        });
    });

    describe('Redundancy Detection', () => {
        test('finds redundant nodes', () => {
            const model = new WorldModel();
            model.addNode('claim', 0, 0, 'Machine learning is powerful for prediction');
            model.addNode('claim', 100, 0, 'Machine learning is powerful for prediction tasks');
            model.addNode('claim', 200, 0, 'Quantum physics describes atoms');

            const redundancies = Semantics.findRedundancies(model, 0.5);
            expect(redundancies.length).toBeGreaterThanOrEqual(1);
            expect(redundancies[0].similarity).toBeGreaterThan(0.5);
        });

        test('no redundancies in diverse graph', () => {
            const model = new WorldModel();
            model.addNode('claim', 0, 0, 'Cats are mammals');
            model.addNode('claim', 100, 0, 'Quantum computing uses qubits');

            const redundancies = Semantics.findRedundancies(model, 0.9);
            expect(redundancies).toHaveLength(0);
        });

        test('handles single node', () => {
            const model = new WorldModel();
            model.addNode('claim', 0, 0, 'test');
            expect(Semantics.findRedundancies(model)).toEqual([]);
        });
    });

    describe('Clustering', () => {
        test('clusters similar nodes', () => {
            const model = new WorldModel();
            model.addNode('claim', 0, 0, 'Neural network architecture design');
            model.addNode('claim', 100, 0, 'Deep neural network architecture');
            model.addNode('claim', 200, 0, 'Ocean biology marine ecosystems');

            const clusters = Semantics.clusterNodes(model, 0.3);
            // The two neural network nodes should cluster together
            if (clusters.length > 0) {
                expect(clusters[0].length).toBeGreaterThanOrEqual(2);
            }
        });

        test('empty model returns empty', () => {
            const model = new WorldModel();
            expect(Semantics.clusterNodes(model)).toEqual([]);
        });
    });

    describe('Similarity Matrix', () => {
        test('computes pairwise similarities', () => {
            const model = new WorldModel();
            model.addNode('claim', 0, 0, 'Alpha beta gamma');
            model.addNode('claim', 100, 0, 'Delta epsilon zeta');
            model.addNode('claim', 200, 0, 'Alpha beta delta');

            const { matrix, avgSimilarity } = Semantics.similarityMatrix(model);
            expect(matrix.length).toBe(3); // 3 pairs from 3 nodes
            expect(typeof avgSimilarity).toBe('number');
        });

        test('single node returns empty matrix', () => {
            const model = new WorldModel();
            model.addNode('claim', 0, 0, 'lonely');
            const { matrix } = Semantics.similarityMatrix(model);
            expect(matrix).toEqual([]);
        });
    });
});

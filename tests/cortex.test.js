const { Cortex } = require('../src/cortex');
const { WorldModel } = require('../src/model');

// Mock global dependencies that Cortex checks for
global.Epistemics = undefined;
global.Logic = undefined;
global.Semantics = undefined;

describe('Cortex', () => {

    beforeEach(() => {
        Cortex.fromJSON({});
    });

    // ======================== SNAPSHOTS ========================

    describe('Snapshots', () => {
        test('captureSnapshot captures node state', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'Test');
            a.confidence = 0.7;
            a.epistemicStatus = 'supported';

            const snap = Cortex.captureSnapshot(model);
            expect(snap.t).toBeDefined();
            expect(snap.nodes[a.id]).toBeDefined();
            expect(snap.nodes[a.id].confidence).toBe(0.7);
            expect(snap.nodes[a.id].label).toBe('Test');
        });

        test('saveSnapshot / getLastSnapshot', () => {
            expect(Cortex.getLastSnapshot()).toBeNull();
            const snap = { t: Date.now(), nodes: {} };
            Cortex.saveSnapshot(snap);
            expect(Cortex.getLastSnapshot()).toBe(snap);
        });
    });

    // ======================== BELIEF DELTAS ========================

    describe('Belief Deltas', () => {
        test('detects confidence changes', () => {
            const before = {
                t: Date.now() - 1000,
                nodes: { n1: { label: 'Claim', confidence: 0.5, epistemicStatus: 'conjecture', type: 'claim' } }
            };
            const after = {
                t: Date.now(),
                nodes: { n1: { label: 'Claim', confidence: 0.8, epistemicStatus: 'supported', type: 'claim' } }
            };

            const delta = Cortex.computeDelta(before, after);
            expect(delta.confidenceChanges).toHaveLength(1);
            expect(delta.confidenceChanges[0].direction).toBe('strengthened');
            expect(delta.confidenceChanges[0].from).toBe(0.5);
            expect(delta.confidenceChanges[0].to).toBe(0.8);
        });

        test('detects status changes', () => {
            const before = {
                t: Date.now() - 1000,
                nodes: { n1: { label: 'X', confidence: 0.5, epistemicStatus: 'conjecture', type: 'claim' } }
            };
            const after = {
                t: Date.now(),
                nodes: { n1: { label: 'X', confidence: 0.5, epistemicStatus: 'established', type: 'claim' } }
            };

            const delta = Cortex.computeDelta(before, after);
            expect(delta.statusChanges).toHaveLength(1);
            expect(delta.statusChanges[0].from).toBe('conjecture');
            expect(delta.statusChanges[0].to).toBe('established');
        });

        test('detects new nodes', () => {
            const before = { t: Date.now() - 1000, nodes: {} };
            const after = {
                t: Date.now(),
                nodes: { n1: { label: 'New', confidence: 0.5, epistemicStatus: 'conjecture', type: 'claim' } }
            };

            const delta = Cortex.computeDelta(before, after);
            expect(delta.newNodes).toHaveLength(1);
            expect(delta.newNodes[0].label).toBe('New');
        });

        test('detects removed nodes', () => {
            const before = {
                t: Date.now() - 1000,
                nodes: { n1: { label: 'Gone', confidence: 0.5, epistemicStatus: 'conjecture', type: 'claim' } }
            };
            const after = { t: Date.now(), nodes: {} };

            const delta = Cortex.computeDelta(before, after);
            expect(delta.removedNodes).toHaveLength(1);
            expect(delta.removedNodes[0].label).toBe('Gone');
        });

        test('ignores small confidence changes', () => {
            const before = {
                t: Date.now() - 1000,
                nodes: { n1: { label: 'X', confidence: 0.50, epistemicStatus: 'conjecture', type: 'claim' } }
            };
            const after = {
                t: Date.now(),
                nodes: { n1: { label: 'X', confidence: 0.52, epistemicStatus: 'conjecture', type: 'claim' } }
            };

            const delta = Cortex.computeDelta(before, after);
            expect(delta.confidenceChanges).toHaveLength(0);
            expect(delta.totalChanges).toBe(0);
        });

        test('computeDeltaFromLast uses saved snapshot', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'Test');
            a.confidence = 0.5;

            // Save snapshot, then change
            Cortex.saveSnapshot(Cortex.captureSnapshot(model));
            a.confidence = 0.9;

            const delta = Cortex.computeDeltaFromLast(model);
            expect(delta.confidenceChanges).toHaveLength(1);
        });

        test('handles null snapshots gracefully', () => {
            const delta = Cortex.computeDelta(null, null);
            expect(delta.totalChanges).toBe(0);
        });
    });

    // ======================== ATTENTION QUEUE ========================

    describe('Attention Queue', () => {
        test('returns empty for empty model', () => {
            const model = new WorldModel();
            const queue = Cortex.getAttentionQueue(model);
            expect(queue).toEqual([]);
        });

        test('respects maxItems', () => {
            const model = new WorldModel();
            // Add several nodes to potentially generate attention items
            for (let i = 0; i < 10; i++) {
                const n = model.addNode('claim', i * 100, 0, `Claim ${i}`);
                n.confidence = 0.5;
            }
            const queue = Cortex.getAttentionQueue(model, { maxItems: 3 });
            expect(queue.length).toBeLessThanOrEqual(3);
        });
    });

    // ======================== SUMMARIZATION ========================

    describe('Summarization', () => {
        test('empty model returns zero summary', () => {
            const model = new WorldModel();
            const summary = Cortex.summarize(model);
            expect(summary.totalNodes).toBe(0);
            expect(summary.themes).toEqual([]);
        });

        test('computes basic stats', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'Claim A');
            a.confidence = 0.8;
            const b = model.addNode('evidence', 100, 0, 'Evidence B');
            b.confidence = 0.6;
            model.addEdge(a.id, b.id);

            const summary = Cortex.summarize(model);
            expect(summary.totalNodes).toBe(2);
            expect(summary.totalEdges).toBe(1);
            expect(summary.avgConfidence).toBe(0.7);
        });
    });

    // ======================== COGNITIVE DIGEST ========================

    describe('Digest', () => {
        test('generates complete digest', () => {
            const model = new WorldModel();
            model.addNode('claim', 0, 0, 'Test claim');

            const d = Cortex.digest(model);
            expect(d.timestamp).toBeDefined();
            expect(d.delta).toBeDefined();
            expect(d.attention).toBeDefined();
            expect(d.summary).toBeDefined();
            expect(d.headline).toBeDefined();
        });

        test('headline is stable for empty graph', () => {
            const model = new WorldModel();
            const d = Cortex.digest(model);
            expect(typeof d.headline).toBe('string');
            expect(d.headline.length).toBeGreaterThan(0);
        });

        test('headline reflects changes', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'Evolving');
            a.confidence = 0.5;
            Cortex.saveSnapshot(Cortex.captureSnapshot(model));

            a.confidence = 0.9;
            const d = Cortex.digest(model);
            expect(d.delta.confidenceChanges.length).toBeGreaterThan(0);
        });
    });

    // ======================== SERIALIZATION ========================

    describe('Serialization', () => {
        test('round-trips snapshot', () => {
            const snap = { t: 12345, nodes: { n1: { label: 'X', confidence: 0.5 } } };
            Cortex.saveSnapshot(snap);

            const json = Cortex.toJSON();
            Cortex.fromJSON({});
            expect(Cortex.getLastSnapshot()).toBeNull();

            Cortex.fromJSON(json);
            expect(Cortex.getLastSnapshot()).toEqual(snap);
        });
    });
});

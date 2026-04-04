const { Epistemics } = require('../src/epistemics');
const { WorldModel } = require('../src/model');

describe('Epistemics', () => {

    beforeEach(() => {
        Epistemics.clearAllHistory();
    });

    // ======================== BELIEF HISTORY ========================

    describe('Belief History', () => {
        test('initHistory creates initial entry', () => {
            const node = { id: 'n1', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            const h = Epistemics.getHistory('n1');
            expect(h).toHaveLength(1);
            expect(h[0].confidence).toBe(0.5);
            expect(h[0].trigger).toBe('created');
        });

        test('recordChange adds entries on change', () => {
            const node = { id: 'n2', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            node.confidence = 0.8;
            node.epistemicStatus = 'supported';
            Epistemics.recordChange(node, 'debate_round_1', 'gemini');
            const h = Epistemics.getHistory('n2');
            expect(h).toHaveLength(2);
            expect(h[1].confidence).toBe(0.8);
            expect(h[1].trigger).toBe('debate_round_1');
            expect(h[1].source).toBe('gemini');
        });

        test('recordChange skips duplicate state', () => {
            const node = { id: 'n3', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            Epistemics.recordChange(node, 'noop');
            expect(Epistemics.getHistory('n3')).toHaveLength(1);
        });

        test('clearHistory removes specific node', () => {
            const node = { id: 'n4', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            Epistemics.clearHistory('n4');
            expect(Epistemics.getHistory('n4')).toEqual([]);
        });
    });

    // ======================== PATHOLOGIES ========================

    describe('Pathology Detection', () => {
        test('detects oscillation', () => {
            const node = { id: 'osc', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            // Simulate oscillating confidence
            const values = [0.5, 0.7, 0.4, 0.8, 0.3, 0.9];
            values.forEach((v, i) => {
                node.confidence = v;
                Epistemics.recordChange(node, `step_${i}`);
            });
            const pathologies = Epistemics.detectPathologies('osc');
            expect(pathologies.some(p => p.type === 'oscillation')).toBe(true);
        });

        test('detects anchoring', () => {
            const node = { id: 'anc', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            // Tiny changes that don't really move the needle
            [0.51, 0.52, 0.50, 0.51].forEach((v, i) => {
                node.confidence = v;
                Epistemics.recordChange(node, `nudge_${i}`);
            });
            const pathologies = Epistemics.detectPathologies('anc');
            expect(pathologies.some(p => p.type === 'anchoring')).toBe(true);
        });

        test('returns empty for healthy node', () => {
            const node = { id: 'ok', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            node.confidence = 0.8;
            Epistemics.recordChange(node, 'evidence');
            expect(Epistemics.detectPathologies('ok')).toEqual([]);
        });
    });

    // ======================== LOSS FUNCTION ========================

    describe('Loss Function', () => {
        test('empty model returns zero loss', () => {
            const model = new WorldModel();
            const loss = Epistemics.computeLoss(model);
            expect(loss.total).toBe(0);
        });

        test('single uncertain node has entropy loss', () => {
            const model = new WorldModel();
            model.addNode('claim', 0, 0, 'Uncertain claim'); // confidence 0.5 = max entropy
            const loss = Epistemics.computeLoss(model);
            expect(loss.entropy).toBeGreaterThan(0.9); // near 1.0 (max binary entropy)
        });

        test('confident claim without evidence has grounding loss', () => {
            const model = new WorldModel();
            const node = model.addNode('claim', 0, 0, 'Bold claim');
            node.confidence = 0.9;
            const loss = Epistemics.computeLoss(model);
            expect(loss.grounding).toBeGreaterThan(0);
        });

        test('grounded claim has low grounding loss', () => {
            const model = new WorldModel();
            const claim = model.addNode('claim', 0, 0, 'Grounded claim');
            claim.confidence = 0.9;
            const evidence = model.addNode('evidence', 0, 50, 'Supporting data');
            evidence.confidence = 0.9;
            model.addEdge(claim.id, evidence.id, 'supports');
            const loss = Epistemics.computeLoss(model);
            expect(loss.grounding).toBe(0);
        });

        test('contradictory connected claims have consistency loss', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'Claim A');
            a.confidence = 0.9;
            const b = model.addNode('claim', 100, 0, 'Claim B');
            b.confidence = 0.1;
            model.addEdge(a.id, b.id, 'related');
            const loss = Epistemics.computeLoss(model);
            expect(loss.consistency).toBeGreaterThan(0);
        });
    });

    // ======================== CONFIDENCE HELPERS ========================

    describe('Confidence Management', () => {
        test('setConfidence clamps to [0, 1]', () => {
            const node = { id: 'c1', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            Epistemics.setConfidence(node, 1.5, 'test');
            expect(node.confidence).toBe(1);
            Epistemics.setConfidence(node, -0.5, 'test');
            expect(node.confidence).toBe(0);
        });

        test('setConfidence auto-derives epistemic status', () => {
            const node = { id: 'c2', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            Epistemics.setConfidence(node, 0.95, 'grounded');
            expect(node.epistemicStatus).toBe('established');
            Epistemics.setConfidence(node, 0.75, 'challenged');
            expect(node.epistemicStatus).toBe('supported');
            Epistemics.setConfidence(node, 0.15, 'refuted');
            expect(node.epistemicStatus).toBe('conjecture');
        });

        test('nudgeConfidence uses sigmoid damping', () => {
            const node = { id: 'c3', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            // At 0.5, damping is maximal (4 * 0.5 * 0.5 = 1.0), so delta passes through fully
            Epistemics.nudgeConfidence(node, 0.2, 'evidence');
            expect(node.confidence).toBeCloseTo(0.7, 1);
        });

        test('nudgeConfidence is dampened near extremes', () => {
            const node = { id: 'c4', confidence: 0.9, epistemicStatus: 'established', source: { type: 'user' } };
            Epistemics.initHistory(node);
            // At 0.9, damping = 4 * 0.9 * 0.1 = 0.36, so delta * 0.36
            Epistemics.nudgeConfidence(node, 0.2, 'evidence');
            expect(node.confidence).toBeLessThan(0.98);
            expect(node.confidence).toBeGreaterThan(0.9);
        });
    });

    // ======================== CALIBRATION ========================

    describe('Calibration', () => {
        test('empty calibration returns null', () => {
            const cal = Epistemics.getCalibration();
            expect(cal.brierScore).toBeNull();
            expect(cal.count).toBe(0);
        });

        test('perfect calibration has Brier score near 0', () => {
            Epistemics.recordResolution(1.0, 1); // predicted 100%, was correct
            Epistemics.recordResolution(0.0, 0); // predicted 0%, was wrong
            const cal = Epistemics.getCalibration();
            expect(cal.brierScore).toBe(0);
            expect(cal.count).toBe(2);
        });

        test('poor calibration has high Brier score', () => {
            Epistemics.recordResolution(0.9, 0); // predicted 90%, was wrong
            Epistemics.recordResolution(0.1, 1); // predicted 10%, was right
            const cal = Epistemics.getCalibration();
            expect(cal.brierScore).toBeGreaterThan(0.3);
        });

        test('calibration bins are populated', () => {
            Epistemics.recordResolution(0.85, 1);
            Epistemics.recordResolution(0.82, 1);
            Epistemics.recordResolution(0.25, 0);
            const cal = Epistemics.getCalibration();
            expect(cal.bins.length).toBeGreaterThan(0);
        });
    });

    // ======================== SERIALIZATION ========================

    describe('Serialization', () => {
        test('round-trips history and resolutions', () => {
            const node = { id: 'ser1', confidence: 0.5, epistemicStatus: 'conjecture', source: { type: 'user' } };
            Epistemics.initHistory(node);
            node.confidence = 0.8;
            Epistemics.recordChange(node, 'debate');
            Epistemics.recordResolution(0.8, 1);

            const json = Epistemics.toJSON();
            Epistemics.clearAllHistory();
            expect(Epistemics.getHistory('ser1')).toEqual([]);

            Epistemics.fromJSON(json);
            expect(Epistemics.getHistory('ser1')).toHaveLength(2);
            const cal = Epistemics.getCalibration();
            expect(cal.count).toBe(1);
        });
    });

    // ======================== BELIEF PROPAGATION ========================

    describe('Belief Propagation', () => {
        test('propagates confidence changes to neighbors', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'Source claim');
            const b = model.addNode('claim', 100, 0, 'Neighbor');
            Epistemics.initHistory(a);
            Epistemics.initHistory(b);
            model.addEdge(a.id, b.id, 'supports');

            // Set source to high confidence
            a.confidence = 0.9;
            const updates = Epistemics.propagate(model, a.id, { damping: 0.5 });

            expect(updates.length).toBeGreaterThan(0);
            expect(b.confidence).toBeGreaterThan(0.5); // should have been pulled up
        });

        test('does not propagate into established nodes', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'Source');
            const b = model.addNode('claim', 100, 0, 'Established');
            b.epistemicStatus = 'established';
            b.confidence = 0.95;
            Epistemics.initHistory(a);
            Epistemics.initHistory(b);
            model.addEdge(a.id, b.id);

            a.confidence = 0.1;
            const updates = Epistemics.propagate(model, a.id);
            const bUpdate = updates.find(u => u.nodeId === b.id);
            expect(bUpdate).toBeUndefined();
            expect(b.confidence).toBe(0.95);
        });

        test('propagation decays with depth', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'Source');
            const b = model.addNode('claim', 100, 0, 'Hop 1');
            const c = model.addNode('claim', 200, 0, 'Hop 2');
            [a, b, c].forEach(n => Epistemics.initHistory(n));
            model.addEdge(a.id, b.id);
            model.addEdge(b.id, c.id);

            a.confidence = 0.9;
            Epistemics.propagate(model, a.id, { damping: 0.5 });

            // Hop 1 should be affected more than Hop 2
            const bDelta = Math.abs(b.confidence - 0.5);
            const cDelta = Math.abs(c.confidence - 0.5);
            expect(bDelta).toBeGreaterThan(cDelta);
        });

        test('returns empty for non-existent node', () => {
            const model = new WorldModel();
            expect(Epistemics.propagate(model, 'fake')).toEqual([]);
        });
    });

    // ======================== EXPECTED INFORMATION GAIN ========================

    describe('Expected Information Gain', () => {
        test('empty model returns empty', () => {
            const model = new WorldModel();
            expect(Epistemics.computeEIG(model)).toEqual([]);
        });

        test('uncertain nodes have higher EIG than confident ones', () => {
            const model = new WorldModel();
            const uncertain = model.addNode('claim', 0, 0, 'Maybe');
            uncertain.confidence = 0.5;
            const confident = model.addNode('claim', 100, 0, 'Probably');
            confident.confidence = 0.9;

            const eigs = Epistemics.computeEIG(model);
            const uncertainEIG = eigs.find(e => e.nodeId === uncertain.id);
            const confidentEIG = eigs.find(e => e.nodeId === confident.id);

            expect(uncertainEIG.eig).toBeGreaterThan(confidentEIG.eig);
        });

        test('skips established nodes', () => {
            const model = new WorldModel();
            const est = model.addNode('claim', 0, 0, 'Proven');
            est.epistemicStatus = 'established';
            est.confidence = 0.95;

            const eigs = Epistemics.computeEIG(model);
            expect(eigs.find(e => e.nodeId === est.id)).toBeUndefined();
        });

        test('getHighestEIG returns top N', () => {
            const model = new WorldModel();
            for (let i = 0; i < 10; i++) {
                const n = model.addNode('claim', i * 100, 0, `Claim ${i}`);
                n.confidence = 0.1 + (i * 0.08); // varying confidence
            }
            const top3 = Epistemics.getHighestEIG(model, 3);
            expect(top3).toHaveLength(3);
            // Should be sorted by EIG descending
            expect(top3[0].eig).toBeGreaterThanOrEqual(top3[1].eig);
            expect(top3[1].eig).toBeGreaterThanOrEqual(top3[2].eig);
        });
    });

    // ======================== VULNERABILITY SCANNER ========================

    describe('Vulnerability Scanner', () => {
        test('empty model returns empty', () => {
            const model = new WorldModel();
            expect(Epistemics.scanVulnerabilities(model)).toEqual([]);
        });

        test('overconfident ungrounded claim is vulnerable', () => {
            const model = new WorldModel();
            const bold = model.addNode('claim', 0, 0, 'Bold ungrounded claim');
            bold.confidence = 0.85;
            Epistemics.initHistory(bold);

            const vulns = Epistemics.scanVulnerabilities(model);
            expect(vulns.length).toBeGreaterThan(0);
            expect(vulns[0].reasons.some(r => r.includes('Overconfident'))).toBe(true);
        });

        test('under-tested node is flagged', () => {
            const model = new WorldModel();
            const n = model.addNode('claim', 0, 0, 'Untested');
            n.confidence = 0.7;
            Epistemics.initHistory(n);

            const vulns = Epistemics.scanVulnerabilities(model);
            expect(vulns.some(v => v.reasons.some(r => r.includes('Under-tested')))).toBe(true);
        });

        test('load-bearing node gets higher vulnerability', () => {
            const model = new WorldModel();
            const root = model.addNode('claim', 0, 0, 'Root');
            root.confidence = 0.8;
            Epistemics.initHistory(root);
            // Add 5 downstream children
            for (let i = 0; i < 5; i++) {
                const child = model.addNode('argument', 0, (i + 1) * 50, `Child ${i}`);
                model.addEdge(root.id, child.id);
            }

            const vulns = Epistemics.scanVulnerabilities(model);
            const rootVuln = vulns.find(v => v.nodeId === root.id);
            expect(rootVuln).toBeDefined();
            expect(rootVuln.reasons.some(r => r.includes('Load-bearing'))).toBe(true);
        });

        test('getMostVulnerable returns the top target', () => {
            const model = new WorldModel();
            const safe = model.addNode('claim', 0, 0, 'Safe');
            safe.confidence = 0.5;
            const dangerous = model.addNode('claim', 100, 0, 'Dangerous');
            dangerous.confidence = 0.85;
            Epistemics.initHistory(safe);
            Epistemics.initHistory(dangerous);

            const target = Epistemics.getMostVulnerable(model);
            expect(target).not.toBeNull();
            expect(target.nodeId).toBe(dangerous.id);
        });

        test('falsified nodes are excluded', () => {
            const model = new WorldModel();
            const n = model.addNode('claim', 0, 0, 'Dead');
            n.epistemicStatus = 'falsified';
            n.confidence = 0.9;

            const vulns = Epistemics.scanVulnerabilities(model);
            expect(vulns.find(v => v.nodeId === n.id)).toBeUndefined();
        });
    });
});

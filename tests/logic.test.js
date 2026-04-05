const { Logic } = require('../src/logic');
const { WorldModel } = require('../src/model');

describe('Logic', () => {

    describe('Proposition Management', () => {
        test('addProposition stores on node', () => {
            const node = { id: 'n1', properties: {} };
            Logic.addProposition(node, 'AI', 'is safe', false);
            const props = Logic.getPropositions(node);
            expect(props).toHaveLength(1);
            expect(props[0]).toEqual({ subject: 'ai', predicate: 'is safe', negated: false });
        });

        test('setPropositions replaces all', () => {
            const node = { id: 'n1', properties: {} };
            Logic.addProposition(node, 'AI', 'is safe');
            Logic.setPropositions(node, [{ subject: 'cats', predicate: 'are cute', negated: false }]);
            expect(Logic.getPropositions(node)).toHaveLength(1);
            expect(Logic.getPropositions(node)[0].subject).toBe('cats');
        });

        test('getPropositions returns empty for bare node', () => {
            expect(Logic.getPropositions({ id: 'n2' })).toEqual([]);
            expect(Logic.getPropositions({ id: 'n3', properties: {} })).toEqual([]);
        });
    });

    describe('Consistency Checking', () => {
        test('no contradiction in consistent graph', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'Claim A');
            const b = model.addNode('claim', 100, 0, 'Claim B');
            Logic.addProposition(a, 'AI', 'is safe', false);
            Logic.addProposition(b, 'AI', 'is useful', false);
            model.addEdge(a.id, b.id);
            expect(Logic.checkConsistency(model)).toEqual([]);
        });

        test('detects contradiction on connected nodes', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'AI is safe');
            const b = model.addNode('claim', 100, 0, 'AI is not safe');
            Logic.addProposition(a, 'AI', 'is safe', false);
            Logic.addProposition(b, 'AI', 'is safe', true);
            model.addEdge(a.id, b.id);

            const contradictions = Logic.checkConsistency(model);
            expect(contradictions).toHaveLength(1);
            expect(contradictions[0].connected).toBe(true);
            expect(contradictions[0].proposition.subject).toBe('ai');
        });

        test('detects contradiction on unconnected nodes', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'X');
            const b = model.addNode('claim', 100, 0, 'Y');
            Logic.addProposition(a, 'earth', 'is flat', false);
            Logic.addProposition(b, 'earth', 'is flat', true);

            const contradictions = Logic.checkConsistency(model);
            expect(contradictions).toHaveLength(1);
            expect(contradictions[0].connected).toBe(false);
        });

        test('checkNode filters to specific node', () => {
            const model = new WorldModel();
            const a = model.addNode('claim', 0, 0, 'A');
            const b = model.addNode('claim', 100, 0, 'B');
            const c = model.addNode('claim', 200, 0, 'C');
            Logic.addProposition(a, 'x', 'y', false);
            Logic.addProposition(b, 'x', 'y', true);
            Logic.addProposition(c, 'z', 'w', false);
            model.addEdge(a.id, b.id);

            const aContradictions = Logic.checkNode(model, a.id);
            expect(aContradictions).toHaveLength(1);
            const cContradictions = Logic.checkNode(model, c.id);
            expect(cContradictions).toHaveLength(0);
        });

        test('empty model returns no contradictions', () => {
            const model = new WorldModel();
            expect(Logic.checkConsistency(model)).toEqual([]);
        });
    });

    describe('Proposition Suggestion', () => {
        test('suggests from "X is Y" pattern', () => {
            const node = { id: 'n1', label: 'AI is dangerous', description: '' };
            const suggestions = Logic.suggestPropositions(node);
            expect(suggestions.length).toBeGreaterThan(0);
        });

        test('detects negation', () => {
            const node = { id: 'n1', label: 'AI is not safe', description: '' };
            const suggestions = Logic.suggestPropositions(node);
            if (suggestions.length > 0) {
                expect(suggestions[0].negated).toBe(true);
            }
        });

        test('returns empty for empty node', () => {
            expect(Logic.suggestPropositions({ id: 'x', label: '', description: '' })).toEqual([]);
        });
    });
});

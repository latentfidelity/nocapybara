const { DebateEngine } = require('../src/debate');

// Minimal stubs for model/renderer/bus
const makeStubs = () => {
    const nodes = new Map();
    const edges = new Map();
    let idCounter = 0;
    const model = {
        nodes,
        edges,
        addNode: (type, x, y, label) => {
            const id = `n${idCounter++}`;
            const node = { id, type, x, y, label: label || type, content: '', description: '', properties: {}, source: null, epistemicStatus: 'conjecture', confidence: 0.5 };
            nodes.set(id, node);
            return node;
        },
        addEdge: (from, to, label) => {
            const id = `e${idCounter++}`;
            const edge = { id, from, to, label: label || '' };
            edges.set(id, edge);
            return edge;
        }
    };
    const renderer = {
        markDirty: jest.fn(),
        screenToWorld: () => ({ x: 0, y: 0 }),
        viewW: 800,
        viewH: 600
    };
    const bus = { emit: jest.fn() };
    return { model, renderer, bus };
};

describe('DebateEngine', () => {
    test('constructor defaults', () => {
        const { model, renderer, bus } = makeStubs();
        const de = new DebateEngine(model, renderer, bus);
        expect(de.debaters).toHaveLength(2);
        expect(de.isRunning).toBe(false);
    });

    test('addDebater', () => {
        const { model, renderer, bus } = makeStubs();
        const de = new DebateEngine(model, renderer, bus);
        expect(de.addDebater()).toBe(true);
        expect(de.debaters).toHaveLength(3);
        expect(de.debaters[2].letter).toBe('C');
    });

    test('addDebater max 5', () => {
        const { model, renderer, bus } = makeStubs();
        const de = new DebateEngine(model, renderer, bus);
        de.addDebater(); de.addDebater(); de.addDebater();
        expect(de.debaters).toHaveLength(5);
        expect(de.addDebater()).toBe(false);
        expect(de.debaters).toHaveLength(5);
    });

    test('removeDebater', () => {
        const { model, renderer, bus } = makeStubs();
        const de = new DebateEngine(model, renderer, bus);
        de.addDebater();
        expect(de.removeDebater()).toBe(true);
        expect(de.debaters).toHaveLength(2);
    });

    test('removeDebater min 2', () => {
        const { model, renderer, bus } = makeStubs();
        const de = new DebateEngine(model, renderer, bus);
        expect(de.removeDebater()).toBe(false);
        expect(de.debaters).toHaveLength(2);
    });

    test('setDebaterModel', () => {
        const { model, renderer, bus } = makeStubs();
        const de = new DebateEngine(model, renderer, bus);
        de.setDebaterModel(0, 'gpt-4');
        expect(de.debaters[0].model).toBe('gpt-4');
    });

    test('setJudgeModel', () => {
        const { model, renderer, bus } = makeStubs();
        const de = new DebateEngine(model, renderer, bus);
        de.setJudgeModel('claude-3');
        expect(de.getJudgeModel()).toBe('claude-3');
    });

    test('default judge model', () => {
        const { model, renderer, bus } = makeStubs();
        const de = new DebateEngine(model, renderer, bus);
        expect(de.getJudgeModel()).toBe('gemini-2.5-flash');
    });
});

describe('Prompt builders', () => {
    let de;
    beforeEach(() => {
        const { model, renderer, bus } = makeStubs();
        de = new DebateEngine(model, renderer, bus);
    });

    test('buildDebatePrompt round 1', () => {
        const p = de.buildDebatePrompt('AI safety', [], 'A', 1, 3, 'standard', 2);
        expect(p).toContain('MODEL A');
        expect(p).toContain('AI safety');
        expect(p).toContain('Round 1');
        expect(p).toContain('opening thesis');
    });

    test('buildDebatePrompt final round', () => {
        const p = de.buildDebatePrompt('AI safety', [], 'B', 3, 3, 'standard', 2);
        expect(p).toContain('FINAL round');
    });

    test('buildDebatePrompt steelman mode', () => {
        const p = de.buildDebatePrompt('topic', [], 'A', 1, 3, 'steelman', 2);
        expect(p).toContain('STEEL MAN MODE');
    });

    test('buildDebatePrompt redteam mode', () => {
        const p = de.buildDebatePrompt('topic', [], 'A', 1, 3, 'redteam', 2);
        expect(p).toContain('RED TEAM MODE');
    });

    test('buildDebatePrompt socratic mode', () => {
        const p = de.buildDebatePrompt('topic', [], 'A', 1, 3, 'socratic', 2);
        expect(p).toContain('SOCRATIC MODE');
    });

    test('buildDebatePrompt includes history', () => {
        const history = [{ role: 'A', round: 1, content: 'My argument' }];
        const p = de.buildDebatePrompt('topic', history, 'B', 2, 3, 'standard', 2);
        expect(p).toContain('My argument');
        expect(p).toContain('MODEL A');
    });

    test('buildRecapPrompt filters judge entries', () => {
        const history = [
            { role: 'A', round: 1, content: 'arg A' },
            { role: 'JUDGE', round: 1, content: 'judge recap' },
            { role: 'B', round: 1, content: 'arg B' }
        ];
        const p = de.buildRecapPrompt('topic', history, 1, 2);
        expect(p).toContain('arg A');
        expect(p).toContain('arg B');
        expect(p).not.toContain('judge recap');
    });

    test('buildResolutionPrompt includes all history', () => {
        const history = [
            { role: 'A', round: 1, content: 'first' },
            { role: 'JUDGE', round: 1, content: 'recap' }
        ];
        const p = de.buildResolutionPrompt('topic', history, 2);
        expect(p).toContain('first');
        expect(p).toContain('recap');
        expect(p).toContain('TITLE:');
    });

    test('buildOpenerPrompt', () => {
        const p = de.buildOpenerPrompt('AI ethics');
        expect(p).toContain('AI ethics');
        expect(p).toContain('JUDGE');
    });
});

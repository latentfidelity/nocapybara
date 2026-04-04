/**
 * @jest-environment jsdom
 */
const { AIEngine } = require('../src/ai');

// Minimal stubs
const makeStubs = () => {
    const model = { nodes: new Map() };
    const renderer = { markDirty: jest.fn() };
    const bus = { emit: jest.fn() };
    return { model, renderer, bus };
};

describe('AIEngine', () => {
    test('constructor defaults', () => {
        const { model, renderer, bus } = makeStubs();
        const ai = new AIEngine(model, renderer, bus);
        expect(ai.selectedModel).toBe('gemini-2.5-flash');
    });

    test('setModel', () => {
        const { model, renderer, bus } = makeStubs();
        const ai = new AIEngine(model, renderer, bus);
        ai.setModel('gemini-2.5-pro');
        expect(ai.selectedModel).toBe('gemini-2.5-pro');
    });

    test('available false without electronAPI', () => {
        const { model, renderer, bus } = makeStubs();
        const ai = new AIEngine(model, renderer, bus);
        // window.electronAPI not defined in test env
        expect(ai.available).toBe(false);
    });

    test('expandThought calls onError without API', () => {
        const { model, renderer, bus } = makeStubs();
        const ai = new AIEngine(model, renderer, bus);
        const node = { id: 'n1', label: 'Test', _loading: false, source: null };
        const errors = [];
        ai.expandThought(node, 'test thought', () => {}, () => {}, (err) => errors.push(err));
        expect(errors).toEqual(['No AI API available']);
    });

    test('refreshContent calls onError without API', () => {
        const { model, renderer, bus } = makeStubs();
        const ai = new AIEngine(model, renderer, bus);
        const node = { id: 'n1', label: 'Test', type: 'claim', content: '' };
        const errors = [];
        ai.refreshContent(node, () => {}, () => {}, (err) => errors.push(err));
        expect(errors).toEqual(['No AI API available']);
    });

    test('_buildExpandPrompt includes text', () => {
        const { model, renderer, bus } = makeStubs();
        const ai = new AIEngine(model, renderer, bus);
        const prompt = ai._buildExpandPrompt('quantum entanglement');
        expect(prompt).toContain('quantum entanglement');
        expect(prompt).toContain('TITLE:');
        expect(prompt).toContain('TYPE:');
        expect(prompt).toContain('DESCRIPTION:');
        expect(prompt).toContain('PROPERTIES:');
    });

    test('_buildExpandPrompt escapes quotes', () => {
        const { model, renderer, bus } = makeStubs();
        const ai = new AIEngine(model, renderer, bus);
        const prompt = ai._buildExpandPrompt('He said "hello"');
        expect(prompt).toContain('\\"hello\\"');
    });
});

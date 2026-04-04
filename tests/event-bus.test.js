const { EventBus, bus } = require('../src/event-bus');

describe('EventBus', () => {
    let eb;
    beforeEach(() => { eb = new EventBus(); });

    test('on/emit fires handler', () => {
        const calls = [];
        eb.on('test', d => calls.push(d));
        eb.emit('test', 42);
        expect(calls).toEqual([42]);
    });

    test('multiple handlers', () => {
        const a = [], b = [];
        eb.on('x', d => a.push(d));
        eb.on('x', d => b.push(d));
        eb.emit('x', 'hi');
        expect(a).toEqual(['hi']);
        expect(b).toEqual(['hi']);
    });

    test('off removes handler', () => {
        const calls = [];
        const fn = d => calls.push(d);
        eb.on('e', fn);
        eb.emit('e', 1);
        eb.off('e', fn);
        eb.emit('e', 2);
        expect(calls).toEqual([1]);
    });

    test('on returns unsubscribe fn', () => {
        const calls = [];
        const unsub = eb.on('e', d => calls.push(d));
        eb.emit('e', 1);
        unsub();
        eb.emit('e', 2);
        expect(calls).toEqual([1]);
    });

    test('once fires only once', () => {
        const calls = [];
        eb.once('o', d => calls.push(d));
        eb.emit('o', 'a');
        eb.emit('o', 'b');
        expect(calls).toEqual(['a']);
    });

    test('emit with no listeners does not throw', () => {
        expect(() => eb.emit('nope', 123)).not.toThrow();
    });

    test('off on non-existent event does not throw', () => {
        expect(() => eb.off('nope', () => {})).not.toThrow();
    });
});

describe('Singleton bus', () => {
    test('exists and is an EventBus', () => {
        expect(bus).toBeInstanceOf(EventBus);
    });
});

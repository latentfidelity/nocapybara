// ============================================
// NOCAPYBARA — Lightweight Event Bus
// ============================================
// Decouples UI updates from business logic.
// Any module can emit/listen without direct coupling.

class EventBus {
    constructor() {
        this._handlers = {};
    }

    on(event, fn) {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(fn);
        return () => this.off(event, fn); // return unsubscribe fn
    }

    off(event, fn) {
        const h = this._handlers[event];
        if (h) this._handlers[event] = h.filter(f => f !== fn);
    }

    emit(event, data) {
        const h = this._handlers[event];
        if (h) h.forEach(fn => fn(data));
    }

    once(event, fn) {
        const wrapper = (data) => {
            fn(data);
            this.off(event, wrapper);
        };
        this.on(event, wrapper);
    }
}

// Singleton
const bus = new EventBus();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EventBus, bus };
} else {
    window.NocapEventBus = { EventBus, bus };
}

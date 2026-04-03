// ============================================
// NEXUS — World Model Data Layer
// ============================================

const NODE_TYPES = {
    idea:     { label: 'Idea',    color: '#b0b0b0', glow: 'rgba(176,176,176,0.15)',  shape: 'circle' },
    topic:    { label: 'Topic',   color: '#d4d4d4', glow: 'rgba(212,212,212,0.15)',  shape: 'roundRect' },
    note:     { label: 'Note',    color: '#c8c8c8', glow: 'rgba(200,200,200,0.15)',  shape: 'hexagon' },
    rule:     { label: 'Rule',    color: '#8a8a8a', glow: 'rgba(138,138,138,0.15)',  shape: 'diamond' },
    event:    { label: 'Event',   color: '#707070', glow: 'rgba(112,112,112,0.15)',  shape: 'triangle' },
    detail:   { label: 'Detail',  color: '#9e9e9e', glow: 'rgba(158,158,158,0.15)',  shape: 'rect' },
};

let _idCounter = 0;
function genId(prefix = 'n') {
    return `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

class NexusNode {
    constructor(type, x, y, label = '') {
        this.id = genId('n');
        this.type = type;
        this.x = x;
        this.y = y;
        this.label = label || NODE_TYPES[type].label;
        this.description = '';
        this.content = ''; // Rich text content for page-type nodes (concepts)
        this.notes = '';
        this.layer = 'default';
        this.properties = {}; // key-value custom props
        this.width = 140;
        this.height = 50;
        this.selected = false;
        this.hovered = false;
        this.pinned = false;
    }
}

class NexusEdge {
    constructor(fromId, toId, label = '') {
        this.id = genId('e');
        this.from = fromId;
        this.to = toId;
        this.label = label;
        this.style = 'solid'; // solid | dashed | dotted
        this.weight = 1;
        this.selected = false;
        this.hovered = false;
    }
}

class WorldModel {
    constructor() {
        this.nodes = new Map();
        this.edges = new Map();
        this.layers = [{ id: 'default', name: 'Default', visible: true }];
        this.metadata = { name: 'Untitled Model', created: Date.now(), modified: Date.now() };
        this._listeners = [];
    }

    onChange(fn) { this._listeners.push(fn); }
    _emit(type, data) { this._listeners.forEach(fn => fn(type, data)); }

    addNode(type, x, y, label) {
        const node = new NexusNode(type, x, y, label);
        this.nodes.set(node.id, node);
        this.metadata.modified = Date.now();
        this._emit('node-added', node);
        return node;
    }

    removeNode(id) {
        // Remove connected edges
        const toRemove = [];
        this.edges.forEach((e, eid) => {
            if (e.from === id || e.to === id) toRemove.push(eid);
        });
        toRemove.forEach(eid => this.edges.delete(eid));
        this.nodes.delete(id);
        this.metadata.modified = Date.now();
        this._emit('node-removed', { id, removedEdges: toRemove });
    }

    addEdge(fromId, toId, label = '') {
        // Prevent duplicates
        for (const e of this.edges.values()) {
            if (e.from === fromId && e.to === toId) return e;
        }
        const edge = new NexusEdge(fromId, toId, label);
        this.edges.set(edge.id, edge);
        this.metadata.modified = Date.now();
        this._emit('edge-added', edge);
        return edge;
    }

    removeEdge(id) {
        this.edges.delete(id);
        this.metadata.modified = Date.now();
        this._emit('edge-removed', { id });
    }

    reverseEdge(id) {
        const e = this.edges.get(id);
        if (e) { [e.from, e.to] = [e.to, e.from]; this._emit('edge-updated', e); }
    }

    getNodeEdges(nodeId) {
        const result = [];
        this.edges.forEach(e => {
            if (e.from === nodeId || e.to === nodeId) result.push(e);
        });
        return result;
    }

    getConnectedNodes(nodeId) {
        const ids = new Set();
        this.edges.forEach(e => {
            if (e.from === nodeId) ids.add(e.to);
            if (e.to === nodeId) ids.add(e.from);
        });
        return [...ids].map(id => this.nodes.get(id)).filter(Boolean);
    }

    addLayer(name) {
        const layer = { id: genId('l'), name, visible: true };
        this.layers.push(layer);
        this._emit('layer-added', layer);
        return layer;
    }

    clear() {
        this.nodes.clear();
        this.edges.clear();
        this.layers = [{ id: 'default', name: 'Default', visible: true }];
        this.metadata = { name: 'Untitled Model', created: Date.now(), modified: Date.now() };
        this._emit('cleared', null);
    }

    toJSON() {
        return {
            version: 1,
            metadata: this.metadata,
            layers: this.layers,
            nodes: [...this.nodes.values()].map(n => ({
                id: n.id, type: n.type, x: n.x, y: n.y,
                label: n.label, description: n.description, content: n.content,
                notes: n.notes, layer: n.layer, properties: n.properties
            })),
            edges: [...this.edges.values()].map(e => ({
                id: e.id, from: e.from, to: e.to,
                label: e.label, style: e.style, weight: e.weight
            }))
        };
    }

    fromJSON(data) {
        this.clear();
        if (data.metadata) this.metadata = data.metadata;
        if (data.layers) this.layers = data.layers;
        (data.nodes || []).forEach(nd => {
            const node = new NexusNode(nd.type, nd.x, nd.y, nd.label);
            node.id = nd.id;
            node.description = nd.description || '';
            node.content = nd.content || '';
            node.notes = nd.notes || '';
            node.layer = nd.layer || 'default';
            node.properties = nd.properties || {};
            this.nodes.set(node.id, node);
        });
        (data.edges || []).forEach(ed => {
            const edge = new NexusEdge(ed.from, ed.to, ed.label);
            edge.id = ed.id;
            edge.style = ed.style || 'solid';
            edge.weight = ed.weight || 1;
            this.edges.set(edge.id, edge);
        });
        // Update id counter
        _idCounter = Math.max(_idCounter, this.nodes.size + this.edges.size + 100);
        this._emit('loaded', null);
    }

    search(query) {
        const q = query.toLowerCase();
        const results = [];
        this.nodes.forEach(n => {
            const score =
                (n.label.toLowerCase().includes(q) ? 3 : 0) +
                (n.description.toLowerCase().includes(q) ? 2 : 0) +
                (n.content.toLowerCase().includes(q) ? 2 : 0) +
                (n.notes.toLowerCase().includes(q) ? 1 : 0) +
                (Object.values(n.properties).some(v => String(v).toLowerCase().includes(q)) ? 1 : 0);
            if (score > 0) results.push({ node: n, score });
        });
        return results.sort((a, b) => b.score - a.score).map(r => r.node);
    }
}

// Export for both module and script contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NODE_TYPES, NexusNode, NexusEdge, WorldModel, genId };
} else {
    window.NexusModel = { NODE_TYPES, NexusNode, NexusEdge, WorldModel, genId };
}

// ============================================
// NEXUS — World Model Data Layer
// ============================================

const NODE_TYPES = {
    claim:     { label: 'Claim',     color: '#7EAAE2', glow: 'rgba(126,170,226,0.15)', shape: 'circle' },
    evidence:  { label: 'Evidence',  color: '#6EBF8B', glow: 'rgba(110,191,139,0.15)', shape: 'hexagon' },
    argument:  { label: 'Argument',  color: '#C4A6E0', glow: 'rgba(196,166,224,0.15)', shape: 'roundRect' },
    axiom:     { label: 'Axiom',     color: '#E8C96E', glow: 'rgba(232,201,110,0.15)', shape: 'diamond' },
    question:  { label: 'Question',  color: '#E0866E', glow: 'rgba(224,134,110,0.15)', shape: 'triangle' },
    synthesis: { label: 'Synthesis', color: '#8ED1D1', glow: 'rgba(142,209,209,0.15)', shape: 'rect' },
};

const EPISTEMIC_STATUSES = {
    conjecture:  { label: 'Conjecture',  color: '#666666', ring: 'rgba(102,102,102,0.6)' },
    hypothesis:  { label: 'Hypothesis',  color: '#8888aa', ring: 'rgba(136,136,170,0.6)' },
    supported:   { label: 'Supported',   color: '#44aa66', ring: 'rgba(68,170,102,0.6)' },
    contested:   { label: 'Contested',   color: '#cc8833', ring: 'rgba(204,136,51,0.7)' },
    established: { label: 'Established', color: '#33bb55', ring: 'rgba(51,187,85,0.8)' },
    falsified:   { label: 'Falsified',   color: '#cc3333', ring: 'rgba(204,51,51,0.7)' },
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
        // Epistemics
        this.epistemicStatus = 'conjecture';
        this.confidence = 0.5;
        this.source = { type: 'user', timestamp: Date.now() };
        this.falsificationCondition = '';
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
                notes: n.notes, layer: n.layer, properties: n.properties,
                epistemicStatus: n.epistemicStatus, confidence: n.confidence,
                source: n.source, falsificationCondition: n.falsificationCondition,
                _debaterColor: n._debaterColor
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
            node.epistemicStatus = nd.epistemicStatus || 'conjecture';
            node.confidence = typeof nd.confidence === 'number' ? nd.confidence : 0.5;
            node.source = nd.source || { type: 'user', timestamp: Date.now() };
            node.falsificationCondition = nd.falsificationCondition || '';
            if (nd._debaterColor) node._debaterColor = nd._debaterColor;
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
    module.exports = { NODE_TYPES, EPISTEMIC_STATUSES, NexusNode, NexusEdge, WorldModel, genId };
} else {
    window.NexusModel = { NODE_TYPES, EPISTEMIC_STATUSES, NexusNode, NexusEdge, WorldModel, genId };
}

// ============================================
// NOCAPYBARA — Interaction & UI Controller
// ============================================

// Delegate to NocapMarkdown module
function renderMarkdown(text) {
    return NocapMarkdown.renderInline(text);
}

class ReflectApp {
    constructor() {
        this.model = new NexusModel.WorldModel();
        this.canvas = document.getElementById('graph-canvas');
        this.renderer = new NexusRenderer.GraphRenderer(this.canvas, this.model);

        // Modules
        this.bus = window.NocapEventBus.bus;
        this.ai = new window.NocapAI.AIEngine(this.model, this.renderer, this.bus);
        this.debate = new window.NocapDebate.DebateEngine(this.model, this.renderer, this.bus);

        // State
        this.selectedNodes = new Set();
        this.selectedEdge = null;
        this.connectFromNode = null;
        this.dragState = null;
        this.dragStart = { x: 0, y: 0 };
        this.lastMouse = { x: 0, y: 0 };
        this._splitPaneMode = false;

        // Mode: 'note' or 'debate'
        this.captureMode = 'note';
        this.debaters = [
            { model: 'gemini-2.5-pro', letter: 'A', color: '#E0866E', emoji: '\uD83D\uDD34' },
            { model: 'gemini-3-pro-preview', letter: 'B', color: '#7EAAE2', emoji: '\uD83D\uDD35' },
        ];
        this._debateRunning = false;

        // Content state tree: nodeId -> { states: [string], index: number }
        this.contentHistory = new Map();

        // Starred node IDs
        this.starredNodes = new Set(JSON.parse(localStorage.getItem('nocapybara-starred') || '[]'));

        // Graph type filter
        this.typeFilter = new Set(['claim', 'evidence', 'argument', 'axiom', 'question', 'synthesis']);
        this.renderer.typeFilter = this.typeFilter;

        // Options (persisted)
        const savedOpts = JSON.parse(localStorage.getItem('nocapybara-options') || '{}');
        this.options = {
            grid: savedOpts.grid === true,
            labels: savedOpts.labels !== false,
            edges: savedOpts.edges !== false,
            edgeLabels: savedOpts.edgeLabels !== false,
            autoExpand: savedOpts.autoExpand !== false,
            grounding: savedOpts.grounding !== false,
            backlinks: savedOpts.backlinks !== false,
            outline: savedOpts.outline !== false,
            wordCount: savedOpts.wordCount !== false,
            hoverPreview: savedOpts.hoverPreview !== false,
            autoSave: savedOpts.autoSave !== false,
            statusBar: savedOpts.statusBar !== false,
            emptyState: savedOpts.emptyState !== false,
        };
        this.renderer.options = this.options;

        this._bindCanvas();
        this._bindUI();
        this._bindKeyboard();

        // Initialize the unified node detail modal
        if (window.NodeDetailModal) {
            NodeDetailModal.init(this);
        }

        // Auto-load
        this._loadFromStorage();

        // Auto-save every 5s
        setInterval(() => this._saveToStorage(), 5000);

        // Start render loop
        this.renderer.start();

        // Model change listener
        this.model.onChange((type, data) => {
            this.renderer.markDirty();
            this._updateStats();
            this._updateEmptyState();
            this._renderPagesTree();
            this._renderStarredList();
            this._updateHealthIndicator();
            // Track belief history for new nodes
            if (type === 'node-added' && window.Epistemics && data) {
                Epistemics.initHistory(data);
            }
            // Init history for all nodes on load
            if (type === 'loaded' && window.Epistemics) {
                this.model.nodes.forEach(n => Epistemics.initHistory(n));
            }
        });

        this._updateStats();
        this._updateEmptyState();
        this._renderPagesTree();
        this._renderStarredList();
        this._updateHealthIndicator();
    }

    // ======================== CANVAS EVENTS ========================

    _bindCanvas() {
        const c = this.canvas;
        c.addEventListener('mousedown', e => this._onMouseDown(e));
        window.addEventListener('mousemove', e => this._onMouseMove(e));
        window.addEventListener('mouseup', e => this._onMouseUp(e));
        c.addEventListener('dblclick', e => this._onDoubleClick(e));
        c.addEventListener('wheel', e => this._onWheel(e), { passive: false });
        c.addEventListener('contextmenu', e => this._onContextMenu(e));

        // Drag and drop from palette
        c.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        c.addEventListener('drop', e => this._onCanvasDrop(e));

        // Click outside to deselect
        document.addEventListener('mousedown', e => {
            if (e.button !== 2 && !e.target.closest('.context-menu')) this._hideAllContextMenus();
        });
    }

    _getCanvasPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _onMouseDown(e) {
        this.renderer.selectionBox = null;
        if (e.target !== this.canvas) return; // Ignore down events outside canvas
        if (e.button === 0) e.preventDefault(); // Prevent browser native drag on left-click
        const pos = this._getCanvasPos(e);
        this.lastMouse = pos;
        if (e.button !== 2) this._hideAllContextMenus();

        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            this.dragState = 'pan';
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        if (e.button !== 0) return;

        const node = this.renderer.nodeAtScreen(pos.x, pos.y);

        // Alt+drag from node → connect
        if (e.altKey && node) {
            this.dragState = 'connect';
            this.connectFromNode = node;
            this.renderer.pendingConnection = { fromX: node.x, fromY: node.y, toX: node.x, toY: node.y };
            return;
        }

        if (node) {
            if (e.shiftKey) {
                // Shift+click: toggle node in selection
                if (node.selected) {
                    this.selectedNodes.delete(node.id);
                    node.selected = false;
                } else {
                    this._selectNode(node, true);
                }
                this.renderer.markDirty();
                this._updateInspector();
            } else if (!e.ctrlKey && !e.metaKey && !node.selected) {
                this._clearSelection();
                this._selectNode(node, true);
            } else {
                this._selectNode(node, true);
            }
            this.dragState = 'move';
            this.dragStart = { x: pos.x, y: pos.y };
            this.canvas.style.cursor = 'move';
            this.renderer._draggedNode = node;
            return;
        }

        const edge = this.renderer.edgeAtScreen(pos.x, pos.y);
        if (edge) {
            this._clearSelection();
            this._selectEdge(edge);
            return;
        }

        if (e.shiftKey) {
            // Shift+drag on empty → selection box
            if (!e.ctrlKey && !e.metaKey) this._clearSelection();
            this.dragState = 'select';
            this.dragStart = { x: pos.x, y: pos.y };
            this.canvas.style.cursor = 'crosshair';
        } else {
            if (!e.ctrlKey && !e.metaKey) this._clearSelection();
            this.dragState = 'pan';
            this.canvas.style.cursor = 'grabbing';
            this.dragStart = { x: pos.x, y: pos.y };
        }
    }

    _onMouseMove(e) {
        const pos = this._getCanvasPos(e);

        // Failsafe: if button was released but mouseup was missed
        if (this.dragState && e.buttons === 0) {
            this._onMouseUp(e);
            return;
        }

        const dx = pos.x - this.lastMouse.x;
        const dy = pos.y - this.lastMouse.y;

        if (this.dragState === 'pan') {
            this.renderer.pan(-dx / this.renderer.cam.zoom, -dy / this.renderer.cam.zoom);
        } else if (this.dragState === 'move') {
            const worldDx = dx / this.renderer.cam.zoom;
            const worldDy = dy / this.renderer.cam.zoom;
            this.selectedNodes.forEach(id => {
                const n = this.model.nodes.get(id);
                if (n) { n.x += worldDx; n.y += worldDy; }
            });
            this.renderer.markDirty();
        } else if (this.dragState === 'connect') {
            const wp = this.renderer.screenToWorld(pos.x, pos.y);
            this.renderer.pendingConnection.toX = wp.x;
            this.renderer.pendingConnection.toY = wp.y;
            this.renderer.markDirty();
            const targetNode = this.renderer.nodeAtScreen(pos.x, pos.y);
            this.model.nodes.forEach(n => { n.hovered = false; });
            if (targetNode && targetNode !== this.connectFromNode) targetNode.hovered = true;
        } else if (this.dragState === 'select') {
            const sx = Math.min(this.dragStart.x, pos.x);
            const sy = Math.min(this.dragStart.y, pos.y);
            const sw = Math.abs(pos.x - this.dragStart.x);
            const sh = Math.abs(pos.y - this.dragStart.y);
            this.renderer.selectionBox = { x: sx, y: sy, w: sw, h: sh };
            this.renderer.markDirty();
        } else {
            const node = this.renderer.nodeAtScreen(pos.x, pos.y);
            const edge = node ? null : this.renderer.edgeAtScreen(pos.x, pos.y);
            let changed = false;
            this.model.nodes.forEach(n => {
                const h = n === node;
                if (n.hovered !== h) { n.hovered = h; changed = true; }
            });
            this.model.edges.forEach(ed => {
                const h = ed === edge;
                if (ed.hovered !== h) { ed.hovered = h; changed = true; }
            });
            this.canvas.style.cursor = node ? 'pointer' : (edge ? 'pointer' : 'default');
            if (changed) this.renderer.markDirty();
        }

        this.lastMouse = pos;
    }

    _onMouseUp(e) {
        if (!this.dragState) return;
        try {
            const pos = this._getCanvasPos(e);

            if (this.dragState === 'connect') {
                const target = this.renderer.nodeAtScreen(pos.x, pos.y);
                if (target && target !== this.connectFromNode) {
                    this._showEdgeLabelModal(this.connectFromNode.id, target.id);
                }
                this.renderer.pendingConnection = null;
                this.connectFromNode = null;
                this.model.nodes.forEach(n => { n.hovered = false; });
                this.renderer.markDirty();
            }

            if (this.dragState === 'select' && this.renderer.selectionBox) {
                const sb = this.renderer.selectionBox;
                const topLeft = this.renderer.screenToWorld(sb.x, sb.y);
                const bottomRight = this.renderer.screenToWorld(sb.x + sb.w, sb.y + sb.h);
                let count = 0;
                this.model.nodes.forEach(n => {
                    if (n.x >= topLeft.x && n.x <= bottomRight.x && n.y >= topLeft.y && n.y <= bottomRight.y) {
                        this._selectNode(n, true);
                        count++;
                    }
                });
                if (count > 0) this._status(`[${count} SELECTED]`);
            }
        } catch (err) {
            console.warn('[mouseUp error]', err);
        } finally {
            this.renderer.selectionBox = null;
            this.dragState = null;
            this.canvas.style.cursor = 'default';
            this.renderer._draggedNode = null;
            this.renderer.markDirty();
        }
    }

    _onDoubleClick(e) {
        const pos = this._getCanvasPos(e);
        const node = this.renderer.nodeAtScreen(pos.x, pos.y);
        if (node) {
            this._openInspector(node);
            const labelInput = document.getElementById('node-label');
            if (labelInput) { labelInput.focus(); labelInput.select(); }
            return;
        }
        const wp = this.renderer.screenToWorld(pos.x, pos.y);
        const newNode = this.model.addNode('claim', wp.x, wp.y, '');
        this._clearSelection();
        this._selectNode(newNode, true);
        this._openInspector(newNode);
        setTimeout(() => {
            const labelInput = document.getElementById('node-label');
            if (labelInput) { labelInput.focus(); labelInput.select(); }
        }, 50);
    }

    _onWheel(e) {
        e.preventDefault();
        // Two-finger pan (trackpad) vs pinch/cmd zoom
        if (e.ctrlKey || e.metaKey) {
            // Pinch zoom — use deltaY magnitude for smooth, proportional feel
            const zoomIntensity = 0.01;
            const zoomFactor = Math.exp(-e.deltaY * zoomIntensity);
            const pos = this._getCanvasPos(e);
            const before = this.renderer.screenToWorld(pos.x, pos.y);
            this.renderer.setZoom(this.renderer.targetCam.zoom * zoomFactor, true);
            const after = this.renderer.screenToWorld(pos.x, pos.y);
            // Adjust camera so zoom centers on cursor
            this.renderer.cam.x -= (after.x - before.x);
            this.renderer.cam.y -= (after.y - before.y);
            this.renderer.targetCam.x = this.renderer.cam.x;
            this.renderer.targetCam.y = this.renderer.cam.y;
        } else {
            // Two-finger scroll = pan
            this.renderer.pan(-e.deltaX / this.renderer.cam.zoom, -e.deltaY / this.renderer.cam.zoom);
        }
        this.renderer.markDirty();
        document.getElementById('zoom-level').textContent = Math.round(this.renderer.cam.zoom * 100) + '%';
    }

    _onContextMenu(e) {
        e.preventDefault();
        const pos = this._getCanvasPos(e);
        const node = this.renderer.nodeAtScreen(pos.x, pos.y);
        const edge = node ? null : this.renderer.edgeAtScreen(pos.x, pos.y);

        if (node) {
            this._clearSelection();
            this._selectNode(node, true);
            this._showContextMenu('node-context-menu', e.clientX, e.clientY, node);
        } else if (edge) {
            this._clearSelection();
            this._selectEdge(edge);
            this._showContextMenu('edge-context-menu', e.clientX, e.clientY, edge);
        } else {
            this._ctxWorldPos = this.renderer.screenToWorld(pos.x, pos.y);
            this._showContextMenu('context-menu', e.clientX, e.clientY);
        }
    }

    _onCanvasDrop(e) {
        e.preventDefault();
        const type = e.dataTransfer.getData('text/plain');
        if (!NexusModel.NODE_TYPES[type]) return;
        const pos = this._getCanvasPos(e);
        const wp = this.renderer.screenToWorld(pos.x, pos.y);
        const node = this.model.addNode(type, wp.x, wp.y);
        this._clearSelection();
        this._selectNode(node, true);
        this._openInspector(node);
    }

    // ======================== SELECTION ========================

    _clearSelection() {
        this.selectedNodes.forEach(id => {
            const n = this.model.nodes.get(id);
            if (n) n.selected = false;
        });
        this.selectedNodes.clear();
        if (this.selectedEdge) {
            this.selectedEdge.selected = false;
            this.selectedEdge = null;
        }
        this.renderer.markDirty();
        this._updateInspector();
        this._syncThoughtBarColor();
    }

    _syncThoughtBarColor() {
        // No-op: highlight effect removed
    }

    _selectNode(node, addToSelection = false) {
        if (!addToSelection) this._clearSelection();
        node.selected = true;
        this.selectedNodes.add(node.id);
        if (this.selectedEdge) { this.selectedEdge.selected = false; this.selectedEdge = null; }
        this.renderer.markDirty();
        this._updateInspector();
        // Don't auto-expand right panel for single nodes — unified modal handles that
        if (!window.NodeDetailModal || this.selectedNodes.size > 1) {
            this._openRightPanel();
        }
        this._syncThoughtBarColor();
    }

    _selectEdge(edge) {
        this._clearSelection();
        edge.selected = true;
        this.selectedEdge = edge;
        this.renderer.markDirty();
        this._updateInspector();
    }

    // ======================== INSPECTOR ========================

    _updateInspector() {
        const nodePanel = document.getElementById('inspector-node');
        const edgePanel = document.getElementById('inspector-edge');
        const multiPanel = document.getElementById('inspector-multi');
        const emptyPanel = document.getElementById('inspector-empty');

        nodePanel.classList.add('hidden');
        edgePanel.classList.add('hidden');
        multiPanel.classList.add('hidden');
        emptyPanel.classList.add('hidden');

        if (this.selectedNodes.size === 1) {
            const nodeId = [...this.selectedNodes][0];
            const node = this.model.nodes.get(nodeId);
            // Populate inspector silently but don't expand panel —
            // the unified modal is the primary single-node view
            if (node) this._showNodeInspector(node);
        } else if (this.selectedNodes.size > 1) {
            multiPanel.classList.remove('hidden');
            document.getElementById('multi-count').textContent = this.selectedNodes.size;
            this._openRightPanel();
        } else if (this.selectedEdge) {
            this._showEdgeInspector(this.selectedEdge);
            this._openRightPanel();
        } else {
            emptyPanel.classList.remove('hidden');
        }
    }

    _showNodeInspector(node) {
        const panel = document.getElementById('inspector-node');
        panel.classList.remove('hidden');
        document.getElementById('inspector-title').textContent = node.type === 'claim' ? 'CLAIM EDITOR' : 'NODE INSPECTOR';

        const labelInput = document.getElementById('node-label');
        const typeSelect = document.getElementById('node-type-select');
        const descInput = document.getElementById('node-description');
        const contentInput = document.getElementById('node-content');
        const contentField = document.getElementById('content-field');
        const notesInput = document.getElementById('node-notes');
        const layerSelect = document.getElementById('node-layer-select');

        labelInput.value = node.label;
        typeSelect.value = node.type;
        descInput.value = node.description;
        contentInput.value = node.content || '';
        notesInput.value = node.notes;

        contentField.style.display = '';

        // Layers
        layerSelect.innerHTML = '';
        this.model.layers.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = l.name;
            if (l.id === node.layer) opt.selected = true;
            layerSelect.appendChild(opt);
        });

        this._renderCustomProperties(node);
        this._renderConnections(node);
        this._renderBacklinks(node);
        this._renderEpistemics(node);

        // Star state
        document.getElementById('btn-star-node').textContent =
            this.starredNodes.has(node.id) ? '★' : '☆';

        // Word count
        this._updateWordCount(node.content || '');

        const update = () => {
            node.label = labelInput.value;
            node.type = typeSelect.value;
            node.description = descInput.value;
            node.content = contentInput.value;
            node.notes = notesInput.value;
            node.layer = layerSelect.value;
            this.renderer.markDirty();
            this._renderPagesTree();
        };
        labelInput.oninput = update;
        typeSelect.onchange = update;
        descInput.oninput = update;
        notesInput.oninput = update;
        layerSelect.onchange = update;

        // Content history
        this._initContentHistory(node);
        this._updateHistoryUI(node);

        let contentDebounce = null;
        contentInput.oninput = () => {
            node.content = contentInput.value;
            clearTimeout(contentDebounce);
            contentDebounce = setTimeout(() => {
                this._pushContentState(node, contentInput.value);
            }, 1000);
        };

        // Undo / Redo / Refresh buttons
        document.getElementById('btn-undo-content').onclick = () => {
            const text = this._undoContent(node);
            if (text !== null) {
                node.content = text;
                contentInput.value = text;
                this.renderer.markDirty();
            }
        };
        document.getElementById('btn-redo-content').onclick = () => {
            const text = this._redoContent(node);
            if (text !== null) {
                node.content = text;
                contentInput.value = text;
                this.renderer.markDirty();
            }
        };
        document.getElementById('btn-refresh-content').onclick = () => {
            this._aiRefreshContent(node);
        };
    }

    _renderCustomProperties(node) {
        const container = document.getElementById('custom-properties-list');
        container.innerHTML = '';
        Object.entries(node.properties).forEach(([key, val]) => {
            const row = document.createElement('div');
            row.className = 'custom-prop-row';
            row.innerHTML = `
                <input type="text" value="${this._esc(key)}" placeholder="Key" class="prop-key">
                <input type="text" value="${this._esc(String(val))}" placeholder="Value" class="prop-val">
                <button class="prop-delete" title="Remove">×</button>
            `;
            const keyIn = row.querySelector('.prop-key');
            const valIn = row.querySelector('.prop-val');
            const delBtn = row.querySelector('.prop-delete');

            const updateProp = () => {
                delete node.properties[key];
                key = keyIn.value;
                node.properties[key] = valIn.value;
            };
            keyIn.onchange = updateProp;
            valIn.oninput = () => { node.properties[key] = valIn.value; };
            delBtn.onclick = () => { delete node.properties[key]; this._renderCustomProperties(node); };

            container.appendChild(row);
        });
    }

    _renderConnections(node) {
        const container = document.getElementById('node-connections-list');
        container.innerHTML = '';
        const edges = this.model.getNodeEdges(node.id);
        if (edges.length === 0) {
            container.innerHTML = '<div style="font-family:\'Space Mono\',monospace;font-size:10px;color:#666;padding:4px;letter-spacing:0.04em">[ NONE ]</div>';
            return;
        }
        edges.forEach(e => {
            const otherId = e.from === node.id ? e.to : e.from;
            const other = this.model.nodes.get(otherId);
            if (!other) return;
            const typeDef = NexusModel.NODE_TYPES[other.type];
            const dir = e.from === node.id ? '→' : '←';
            const item = document.createElement('div');
            item.className = 'connection-item';
            item.innerHTML = `
                <span class="connection-dot" style="background:${typeDef.color}"></span>
                <span class="connection-arrow">${dir}</span>
                <span>${this._esc(e.label || other.label)}</span>
            `;
            item.onclick = () => {
                this._clearSelection();
                this._selectNode(other);
                this.renderer.panTo(other.x, other.y);
            };
            container.appendChild(item);
        });
    }

    _showEdgeInspector(edge) {
        const panel = document.getElementById('inspector-edge');
        panel.classList.remove('hidden');
        document.getElementById('inspector-title').textContent = 'EDGE INSPECTOR';

        const labelInput = document.getElementById('edge-label');
        const fromDiv = document.getElementById('edge-from');
        const toDiv = document.getElementById('edge-to');
        const styleSelect = document.getElementById('edge-style-select');
        const weightInput = document.getElementById('edge-weight');

        labelInput.value = edge.label;
        styleSelect.value = edge.style;
        weightInput.value = edge.weight;

        const fromNode = this.model.nodes.get(edge.from);
        const toNode = this.model.nodes.get(edge.to);
        fromDiv.textContent = fromNode ? fromNode.label : '(deleted)';
        toDiv.textContent = toNode ? toNode.label : '(deleted)';

        labelInput.oninput = () => { edge.label = labelInput.value; this.renderer.markDirty(); };
        styleSelect.onchange = () => { edge.style = styleSelect.value; this.renderer.markDirty(); };
        weightInput.oninput = () => { edge.weight = parseInt(weightInput.value); this.renderer.markDirty(); };
    }

    _openInspector(node) {
        // Use unified modal for single-node inspection
        if (node && window.NodeDetailModal) {
            NodeDetailModal.open(node);
            return;
        }
        // Fallback to right panel for edge/multi-select
        this._openRightPanel();
        if (node) this._showNodeInspector(node);
    }

    _openRightPanel() {
        const sb = document.getElementById('panel-right');
        sb.setAttribute('data-state', 'expanded');
    }

    // ======================== UI BINDINGS ========================

    _bindUI() {
        // Palette drag
        document.querySelectorAll('.type-item[draggable]').forEach(item => {
            item.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', item.dataset.type);
                e.dataTransfer.effectAllowed = 'copy';
            });
            item.addEventListener('click', () => {
                const wp = this.renderer.screenToWorld(this.renderer.viewW / 2, this.renderer.viewH / 2);
                wp.x += (Math.random() - 0.5) * 100;
                wp.y += (Math.random() - 0.5) * 100;
                const node = this.model.addNode(item.dataset.type, wp.x, wp.y);
                this._clearSelection();
                this._selectNode(node);
            });
        });

        // Panel close
        document.getElementById('toggle-right-panel').addEventListener('click', () => {
            const sb = document.getElementById('panel-right');
            const state = sb.getAttribute('data-state');
            sb.setAttribute('data-state', state === 'collapsed' ? 'expanded' : 'collapsed');
        });

        // Zoom
        document.getElementById('btn-zoom-in').addEventListener('click', () => {
            this.renderer.setZoom(this.renderer.targetCam.zoom * 1.2);
            document.getElementById('zoom-level').textContent = Math.round(this.renderer.targetCam.zoom * 100) + '%';
        });
        document.getElementById('btn-zoom-out').addEventListener('click', () => {
            this.renderer.setZoom(this.renderer.targetCam.zoom * 0.8);
            document.getElementById('zoom-level').textContent = Math.round(this.renderer.targetCam.zoom * 100) + '%';
        });
        document.getElementById('btn-zoom-fit').addEventListener('click', () => {
            this.renderer.fitView();
            setTimeout(() => {
                document.getElementById('zoom-level').textContent = Math.round(this.renderer.cam.zoom * 100) + '%';
            }, 400);
        });

        // Top bar
        document.getElementById('btn-new').addEventListener('click', () => {
            if (this.model.nodes.size > 0 && !confirm('Create a new model? Unsaved changes will be lost.')) return;
            this.model.clear();
            this._clearSelection();
            this._status('[NEW MODEL CREATED]');
        });

        document.getElementById('btn-save').addEventListener('click', () => {
            this._saveToStorage();
            this._status('[SAVED]', 'success');
        });

        document.getElementById('btn-export').addEventListener('click', () => {
            const data = JSON.stringify(this.model.toJSON(), null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = (this.model.metadata.name || 'nocapybara-model') + '.json';
            a.click();
            URL.revokeObjectURL(a.href);
            this._status('[EXPORTED]', 'success');
        });

        document.getElementById('btn-import').addEventListener('click', () => {
            document.getElementById('import-file').click();
        });

        document.getElementById('import-file').addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                try {
                    const data = JSON.parse(ev.target.result);
                    this.model.fromJSON(data);
                    this._clearSelection();
                    this.renderer.fitView();
                    this._status('[IMPORTED]', 'success');
                } catch (err) {
                    this._status('[ERROR: ' + err.message + ']', 'error');
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });

        // Search
        const searchInput = document.getElementById('search-input');
        searchInput.addEventListener('input', () => {
            this._doSearch(searchInput.value.trim());
        });

        // Add custom property
        document.getElementById('btn-add-property').addEventListener('click', () => {
            if (this.selectedNodes.size !== 1) return;
            const node = this.model.nodes.get([...this.selectedNodes][0]);
            if (!node) return;
            let key = 'key';
            let i = 1;
            while (node.properties[key]) key = 'key' + (i++);
            node.properties[key] = '';
            this._renderCustomProperties(node);
        });

        // Delete buttons
        document.getElementById('btn-delete-selected').addEventListener('click', () => this._deleteSelected());
        document.getElementById('btn-delete-multi').addEventListener('click', () => this._deleteSelected());
        document.getElementById('btn-delete-edge').addEventListener('click', () => {
            if (this.selectedEdge) {
                this.model.removeEdge(this.selectedEdge.id);
                this.selectedEdge = null;
                this._updateInspector();
            }
        });
        document.getElementById('btn-reverse-edge').addEventListener('click', () => {
            if (this.selectedEdge) {
                this.model.reverseEdge(this.selectedEdge.id);
                this._showEdgeInspector(this.selectedEdge);
            }
        });

        // Sidebar tabs
        document.querySelectorAll('.panel-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.panel-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = document.getElementById('tab-' + tab.dataset.tab);
                if (target) target.classList.add('active');
            });
        });

        // New page
        document.getElementById('btn-new-page').addEventListener('click', () => {
            const wp = this.renderer.screenToWorld(this.renderer.viewW / 2, this.renderer.viewH / 2);
            wp.x += (Math.random() - 0.5) * 100;
            wp.y += (Math.random() - 0.5) * 100;
            const node = this.model.addNode('claim', wp.x, wp.y, 'Untitled Page');
            this._clearSelection();
            this._selectNode(node);
            this._openInspector(node);
            setTimeout(() => {
                const labelInput = document.getElementById('node-label');
                if (labelInput) { labelInput.focus(); labelInput.select(); }
            }, 50);
        });

        // Thought capture
        const thoughtInput = document.getElementById('thought-input');
        const thoughtSubmit = document.getElementById('thought-submit');

        thoughtInput.addEventListener('input', () => {
            thoughtInput.style.height = 'auto';
            thoughtInput.style.height = Math.min(thoughtInput.scrollHeight, 120) + 'px';
        });

        thoughtInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._captureThought();
            }
        });

        thoughtSubmit.addEventListener('click', () => this._captureThought());

        // Model selector popup
        this.selectedModel = 'gemini-2.5-flash';
        const modelMenu = document.getElementById('model-menu');
        const modelLabel = document.getElementById('model-label');

        // Mode toggle
        const writeHints = [
            'What do you want to be true?',
            'State a claim to investigate...',
            'What assumption needs testing?',
            'Describe what you observe...',
            'What follows from this?',
            'Where does the evidence point?',
            'What would falsify this belief?',
            'Connect two ideas...',
        ];
        const debateHints = [
            'Consciousness is fundamental, not emergent',
            'Free will is compatible with determinism',
            'Mathematics is discovered, not invented',
            'AI can never truly understand meaning',
            'Morality requires a metaphysical foundation',
            'The hard problem of consciousness is unsolvable',
            'Emergence is explanatorily sufficient',
            'Knowledge requires justified true belief',
        ];

        this._placeholderHints = { note: writeHints, debate: debateHints };
        this._placeholderIndex = 0;
        this._placeholderTimer = null;

        this._startPlaceholderCycle = () => {
            if (this._placeholderTimer) clearTimeout(this._placeholderTimer);
            const input = document.getElementById('thought-input');
            if (input.value.length > 0) return; // Don't animate if user is typing

            const hints = this._placeholderHints[this.captureMode] || writeHints;
            const hint = hints[this._placeholderIndex % hints.length];
            let charIndex = 0;
            let deleting = false;

            const tick = () => {
                if (input.value.length > 0) return; // User started typing

                if (!deleting) {
                    input.placeholder = hint.slice(0, charIndex);
                    charIndex++;
                    if (charIndex > hint.length) {
                        deleting = true;
                        this._placeholderTimer = setTimeout(tick, 2000); // Pause before delete
                        return;
                    }
                    this._placeholderTimer = setTimeout(tick, 40 + Math.random() * 30);
                } else {
                    charIndex--;
                    input.placeholder = hint.slice(0, charIndex);
                    if (charIndex === 0) {
                        this._placeholderIndex++;
                        this._placeholderTimer = setTimeout(() => this._startPlaceholderCycle(), 300);
                        return;
                    }
                    this._placeholderTimer = setTimeout(tick, 20);
                }
            };
            tick();
        };

        // Start the cycle
        this._startPlaceholderCycle();

        // Restart when input is emptied
        document.getElementById('thought-input').addEventListener('input', () => {
            if (document.getElementById('thought-input').value.length === 0) {
                setTimeout(() => this._startPlaceholderCycle(), 500);
            }
        });

        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.captureMode = btn.dataset.mode;
                document.getElementById('note-controls').classList.toggle('hidden', btn.dataset.mode !== 'note');
                document.getElementById('debate-controls').classList.toggle('hidden', btn.dataset.mode !== 'debate');
                // Reset placeholder cycle for new mode
                this._placeholderIndex = 0;
                this._startPlaceholderCycle();
            });
        });

        // Shared model menu target
        this._modelMenuTarget = 'note'; // 'note' or slot index
        this._debaterColors = ['#E0866E', '#7EAAE2', '#6EBF8B', '#C4A6E0', '#E8C96E'];
        this._debaterLetters = ['A', 'B', 'C', 'D', 'E'];
        this._debaterEmojis = ['\uD83D\uDD34', '\uD83D\uDD35', '\uD83D\uDFE2', '\uD83D\uDFE3', '\uD83D\uDFE1'];

        document.getElementById('model-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this._modelMenuTarget = 'note';
            modelMenu.classList.toggle('hidden');
        });

        // Wire debater slot clicks
        this._wireDebaterSlots();

        // Add debater button
        document.getElementById('add-debater-btn').addEventListener('click', () => {
            if (this.debaters.length >= 5) { this._status('[MAX 5 DEBATERS]'); return; }
            const idx = this.debaters.length;
            this.debaters.push({
                model: 'gemini-2.5-flash',
                letter: this._debaterLetters[idx],
                color: this._debaterColors[idx],
                emoji: this._debaterEmojis[idx]
            });
            this._rebuildDebaterSlots();
        });

        const judgeBtn = document.getElementById('debate-judge-btn');
        if (judgeBtn) {
            judgeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._modelMenuTarget = 'judge';
                const modelMenu = document.getElementById('model-menu');
                modelMenu.classList.toggle('hidden');
            });
        }

        document.querySelectorAll('.thought-popup-item').forEach(item => {
            item.addEventListener('click', () => {
                const model = item.dataset.model;
                const label = item.textContent;

                if (this._modelMenuTarget === 'note') {
                    this.selectedModel = model;
                    modelLabel.textContent = label;
                } else if (this._modelMenuTarget === 'judge') {
                    this.debateJudgeModel = model;
                    const cleanLabel = label.replace(/[◆⚡◇○◈]\s*/, '');
                    const el = document.getElementById('debate-judge-label');
                    if (el) el.innerHTML = `&#x2696;&#xFE0F; JUDGE: ${cleanLabel}`;
                } else if (typeof this._modelMenuTarget === 'number') {
                    const slotIdx = this._modelMenuTarget;
                    if (this.debaters[slotIdx]) {
                        this.debaters[slotIdx].model = model;
                        const cleanLabel = label.replace(/[◆⚡◇○◈]\s*/, '');
                        const el = document.getElementById(`debater-label-${slotIdx}`);
                        if (el) el.textContent = `${this.debaters[slotIdx].emoji} ${this.debaters[slotIdx].letter}: ${cleanLabel}`;
                    }
                }

                document.querySelectorAll('.thought-popup-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                modelMenu.classList.add('hidden');
            });
        });

        // Set initial active
        document.querySelector('.thought-popup-item[data-model="gemini-2.5-flash"]').classList.add('active');

        // Close popup on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#thought-bar')) {
                modelMenu.classList.add('hidden');
            }
        });

        // Context menu actions
        document.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => this._handleContextAction(item.dataset.action));
        });

        // Help
        document.getElementById('btn-help').addEventListener('click', () => {
            document.getElementById('help-overlay').classList.toggle('hidden');
        });
        document.getElementById('help-close').addEventListener('click', () => {
            document.getElementById('help-overlay').classList.add('hidden');
        });

        // View Page
        document.getElementById('btn-view-page').addEventListener('click', () => {
            this._openPageView();
        });
        document.getElementById('page-view-close').addEventListener('click', () => {
            document.getElementById('page-view-overlay').classList.add('hidden');
        });
        document.getElementById('btn-split-pane').addEventListener('click', () => {
            this._openSplitPane();
        });
        document.getElementById('split-pane-close').addEventListener('click', () => {
            document.getElementById('split-pane').classList.add('hidden');
        });
        document.getElementById('page-view-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.add('hidden');
            }
        });

        // Modal
        document.getElementById('modal-cancel').addEventListener('click', () => this._hideModal());
        document.getElementById('modal-confirm').addEventListener('click', () => this._confirmModal());
        document.getElementById('modal-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') this._confirmModal();
            if (e.key === 'Escape') this._hideModal();
        });

        // Star / Bookmark
        document.getElementById('btn-star-node').addEventListener('click', () => {
            const nodeId = [...this.selectedNodes][0];
            if (!nodeId) return;
            if (this.starredNodes.has(nodeId)) {
                this.starredNodes.delete(nodeId);
                document.getElementById('btn-star-node').textContent = '☆';
            } else {
                this.starredNodes.add(nodeId);
                document.getElementById('btn-star-node').textContent = '★';
            }
            localStorage.setItem('nocapybara-starred', JSON.stringify([...this.starredNodes]));
            this._renderStarredList();
        });

        // Export Markdown
        document.getElementById('btn-export-md').addEventListener('click', () => {
            this._exportMarkdown();
        });

        // Graph filters
        document.querySelectorAll('.graph-filters input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const type = cb.dataset.filter;
                if (cb.checked) {
                    this.typeFilter.add(type);
                } else {
                    this.typeFilter.delete(type);
                }
                this.renderer.markDirty();
            });
        });

        // Wiki autocomplete on content textarea
        const contentTA = document.getElementById('node-content');
        contentTA.addEventListener('input', () => {
            this._handleWikiAutocomplete(contentTA);
            this._updateWordCount(contentTA.value);
        });
        contentTA.addEventListener('keydown', (e) => {
            this._handleWikiKeydown(e, contentTA);
        });

        // Settings panel
        document.getElementById('btn-settings').addEventListener('click', () => {
            this._openOptions();
        });
        document.getElementById('options-close').addEventListener('click', () => {
            document.getElementById('options-overlay').classList.add('hidden');
        });
        document.getElementById('options-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
        });

        // Option toggles
        const optMap = {
            'opt-grid': 'grid', 'opt-labels': 'labels', 'opt-edges': 'edges',
            'opt-edge-labels': 'edgeLabels', 'opt-auto-expand': 'autoExpand',
            'opt-grounding': 'grounding', 'opt-backlinks': 'backlinks',
            'opt-outline': 'outline', 'opt-word-count': 'wordCount',
            'opt-hover-preview': 'hoverPreview', 'opt-auto-save': 'autoSave',
            'opt-status-bar': 'statusBar', 'opt-empty-state': 'emptyState',
        };
        Object.entries(optMap).forEach(([elId, key]) => {
            const el = document.getElementById(elId);
            if (el) {
                el.addEventListener('change', () => {
                    this.options[key] = el.checked;
                    localStorage.setItem('nocapybara-options', JSON.stringify(this.options));
                    this.renderer.markDirty();
                    this._updateEmptyState();
                });
            }
        });

        // Physics toggle
        const physicsEl = document.getElementById('opt-physics');
        if (physicsEl) {
            physicsEl.checked = this.renderer.physicsEnabled;
            physicsEl.addEventListener('change', () => {
                this.renderer.physicsEnabled = physicsEl.checked;
                this._status(physicsEl.checked ? '[PHYSICS ON]' : '[PHYSICS OFF]');
            });
        }


        // Obsidian Vault Import
        const vaultInput = document.getElementById('import-vault-input');
        if (vaultInput) {
            vaultInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files).filter(f => f.name.endsWith('.md'));
                if (files.length === 0) return;

                if (!confirm(`Import ${files.length} markdown files from vault? This will add them to your current graph.`)) return;

                this._status(`[IMPORTING ${files.length} FILES...]`);
                await this._importObsidianVault(files);
                vaultInput.value = ''; // Reset
            });
        }

        // Export all
        document.getElementById('opt-export-all').addEventListener('click', () => {
            this._exportAllMarkdown();
        });

        // Clear data
        document.getElementById('opt-clear-data').addEventListener('click', () => {
            if (confirm('This will delete ALL nodes, edges, and layers. Are you sure?')) {
                localStorage.removeItem('nocapybara-state');
                localStorage.removeItem('nocapybara-starred');
                location.reload();
            }
        });
    }

    _bindKeyboard() {
        document.addEventListener('keydown', e => {
            // Cmd+P — Quick Switcher (always intercept)
            if ((e.key === 'p' || e.key === 'P') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this._toggleQuickSwitcher();
                return;
            }

            // Escape from quick switcher
            if (e.key === 'Escape' && !document.getElementById('quick-switcher').classList.contains('hidden')) {
                this._closeQuickSwitcher();
                return;
            }

            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                if (e.key === 'Escape') e.target.blur();
                return;
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                this._deleteSelected();
                e.preventDefault();
            }
            if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
                document.getElementById('search-input').focus();
                e.preventDefault();
            }
            if (e.key === 'Escape') {
                this._clearSelection();
                this._hideAllContextMenus();
                this._hideModal();
                document.getElementById('search-input').value = '';
                this._clearSearch();
            }
            if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.model.nodes.forEach(n => this._selectNode(n, true));
            }
            if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this._saveToStorage();
                this._status('[SAVED]', 'success');
            }
            if ((e.key === '=' || e.key === '+') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.renderer.setZoom(this.renderer.targetCam.zoom * 1.2);
                document.getElementById('zoom-level').textContent = Math.round(this.renderer.targetCam.zoom * 100) + '%';
            }
            if (e.key === '-' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.renderer.setZoom(this.renderer.targetCam.zoom * 0.8);
                document.getElementById('zoom-level').textContent = Math.round(this.renderer.targetCam.zoom * 100) + '%';
            }
            if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.renderer.fitView();
            }
            if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this._createDailyNote();
            }
        });
    }

    // ======================== CONTEXT MENUS ========================

    _showContextMenu(id, x, y, target = null) {
        this._hideAllContextMenus();
        const menu = document.getElementById(id);
        menu.classList.remove('hidden');
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        this._ctxTarget = target;
    }

    _hideAllContextMenus() {
        document.querySelectorAll('.context-menu').forEach(m => m.classList.add('hidden'));
    }

    _handleContextAction(action) {
        this._hideAllContextMenus();
        const addType = action.replace('add-', '');
        if (NexusModel.NODE_TYPES[addType] && this._ctxWorldPos) {
            const node = this.model.addNode(addType, this._ctxWorldPos.x, this._ctxWorldPos.y);
            this._clearSelection();
            this._selectNode(node);
            return;
        }
        switch (action) {
            case 'edit-node':
                if (this._ctxTarget) this._openInspector(this._ctxTarget);
                break;
            case 'duplicate-node':
                if (this._ctxTarget) {
                    const n = this._ctxTarget;
                    const dup = this.model.addNode(n.type, n.x + 30, n.y + 30, n.label + ' (copy)');
                    dup.description = n.description;
                    dup.content = n.content;
                    dup.notes = n.notes;
                    dup.properties = { ...n.properties };
                    this._clearSelection();
                    this._selectNode(dup);
                }
                break;
            case 'connect-from':
                if (this._ctxTarget) {
                    this.connectFromNode = this._ctxTarget;
                    this._status('[CLICK TARGET NODE TO CONNECT]');
                    this.canvas.addEventListener('click', this._connectToHandler = (e) => {
                        const pos = this._getCanvasPos(e);
                        const target = this.renderer.nodeAtScreen(pos.x, pos.y);
                        if (target && target !== this.connectFromNode) {
                            this._showEdgeLabelModal(this.connectFromNode.id, target.id);
                        }
                        this.canvas.removeEventListener('click', this._connectToHandler);
                        this.connectFromNode = null;
                    }, { once: true });
                }
                break;
            case 'delete-node':
                if (this._ctxTarget) {
                    this.model.removeNode(this._ctxTarget.id);
                    this.selectedNodes.delete(this._ctxTarget.id);
                    this._updateInspector();
                }
                break;
            case 'edit-edge':
                if (this._ctxTarget) this._openRightPanel();
                break;
            case 'reverse-edge':
                if (this._ctxTarget) this.model.reverseEdge(this._ctxTarget.id);
                break;
            case 'delete-edge':
                if (this._ctxTarget) {
                    this.model.removeEdge(this._ctxTarget.id);
                    if (this.selectedEdge === this._ctxTarget) this.selectedEdge = null;
                    this._updateInspector();
                }
                break;
            case 'select-all':
                this.model.nodes.forEach(n => this._selectNode(n, true));
                break;
            case 'fit-view':
                this.renderer.fitView();
                break;
            case 'view-page':
                if (this._ctxTarget) {
                    this._clearSelection();
                    this._selectNode(this._ctxTarget);
                    this._openPageView();
                }
                break;
            case 'branch-node-write':
                if (this._ctxTarget) {
                    this._clearSelection();
                    this._selectNode(this._ctxTarget);
                    this._showBranchInput(this._ctxTarget, 'write');
                }
                break;
            case 'branch-node-debate':
                if (this._ctxTarget) {
                    this._clearSelection();
                    this._selectNode(this._ctxTarget);
                    const topic = this._ctxTarget.content || this._ctxTarget.label;
                    this._openBranchConfigModal(topic, this._ctxTarget);
                }
                break;
            case 'template-concept':
                if (this._ctxTarget) this._applyTemplate(this._ctxTarget, 'concept');
                break;
            case 'template-project':
                if (this._ctxTarget) this._applyTemplate(this._ctxTarget, 'project');
                break;
            case 'template-meeting':
                if (this._ctxTarget) this._applyTemplate(this._ctxTarget, 'meeting');
                break;
            case 'template-research':
                if (this._ctxTarget) this._applyTemplate(this._ctxTarget, 'research');
                break;
            case 'toggle-physics':
                this.renderer.physicsEnabled = !this.renderer.physicsEnabled;
                this._status(this.renderer.physicsEnabled ? '[PHYSICS ON]' : '[PHYSICS OFF]');
                break;
            case 'scan-vulnerabilities':
                if (window.Epistemics) {
                    const vulns = Epistemics.scanVulnerabilities(this.model);
                    if (vulns.length === 0) {
                        this._status('[NO VULNERABILITIES DETECTED]', 'success');
                    } else {
                        const top = vulns[0];
                        this._status(`[${vulns.length} VULNERABLE] Top: "${top.label}" (${(top.vulnerability * 100).toFixed(0)}%)`);
                        // Pan to the most vulnerable node
                        const node = this.model.nodes.get(top.nodeId);
                        if (node) { this._clearSelection(); this._selectNode(node); this.renderer.panTo(node.x, node.y); }
                    }
                }
                break;
            case 'red-team-auto':
                if (window.Epistemics) {
                    const target = Epistemics.getMostVulnerable(this.model);
                    if (!target) {
                        this._status('[NO VULNERABLE TARGETS FOUND]');
                    } else {
                        const node = this.model.nodes.get(target.nodeId);
                        if (node) {
                            this._status(`[RED TEAM] Targeting: "${target.label}" — ${target.reasons[0]}`);
                            this._startDebate(node.label, node);
                        }
                    }
                }
                break;
            case 'red-team-node':
                if (this._ctxTarget) {
                    this._status(`[RED TEAM] Targeting: "${this._ctxTarget.label}"`);
                    this._startDebate(this._ctxTarget.label, this._ctxTarget);
                }
                break;
        }
    }

    // ======================== MODAL ========================

    _showEdgeLabelModal(fromId, toId) {
        this._modalData = { fromId, toId };
        document.getElementById('modal-title').textContent = 'NEW CONNECTION';
        document.getElementById('modal-input').value = '';
        document.getElementById('modal-overlay').classList.remove('hidden');
        setTimeout(() => document.getElementById('modal-input').focus(), 50);
    }

    _confirmModal() {
        if (this._modalData) {
            const label = document.getElementById('modal-input').value.trim();
            this.model.addEdge(this._modalData.fromId, this._modalData.toId, label);
            this._modalData = null;
        }
        this._hideModal();
    }

    _hideModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
        this._modalData = null;
    }

    // ======================== DEBATER SLOTS ========================

    _wireDebaterSlots() {
        const modelMenu = document.getElementById('model-menu');
        document.querySelectorAll('.debater-slot').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._modelMenuTarget = parseInt(btn.dataset.slot);
                modelMenu.classList.toggle('hidden');
            });
        });
    }

    _rebuildDebaterSlots() {
        const container = document.getElementById('debater-slots');
        container.innerHTML = '';
        this.debaters.forEach((d, i) => {
            if (i > 0) {
                const vs = document.createElement('span');
                vs.className = 'debate-vs';
                vs.textContent = 'VS';
                container.appendChild(vs);
            }
            const btn = document.createElement('button');
            btn.className = 'thought-tool debate-model-btn debater-slot';
            btn.dataset.slot = i;
            btn.title = `Debater ${i + 1}`;
            const shortModel = d.model.replace(/^or:.*\//, '').replace(/^gemini-/, '').slice(0, 12).toUpperCase();
            btn.innerHTML = `<span class="debater-label" id="debater-label-${i}">${d.emoji} ${d.letter}: ${shortModel}</span>`;
            container.appendChild(btn);
        });
        // Add remove button if > 2
        if (this.debaters.length > 2) {
            const rmBtn = document.createElement('button');
            rmBtn.className = 'thought-tool';
            rmBtn.textContent = '[-] REMOVE';
            rmBtn.title = 'Remove last debater';
            rmBtn.addEventListener('click', () => {
                this.debaters.pop();
                this._rebuildDebaterSlots();
            });
            container.appendChild(rmBtn);
        }
        this._wireDebaterSlots();
    }

    // ======================== THOUGHT CAPTURE ========================

    async _captureThought() {
        const input = document.getElementById('thought-input');
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        input.style.height = 'auto';
        setTimeout(() => this._startPlaceholderCycle(), 500);

        if (this.captureMode === 'debate') {
            this._startDebate(text);
            return;
        }

        const wp = this.renderer.screenToWorld(this.renderer.viewW / 2, this.renderer.viewH / 2);
        wp.x += (Math.random() - 0.5) * 200;
        wp.y += (Math.random() - 0.5) * 200;

        const tempLabel = text.split('\n')[0].slice(0, 40) + (text.length > 40 ? '\u2026' : '');
        const node = this.model.addNode('claim', wp.x, wp.y, tempLabel);
        node.content = text;

        // Close any open overlays so the new node is visible
        if (window.NodeDetailModal && NodeDetailModal.isOpen()) NodeDetailModal.close();

        this._clearSelection();
        this._selectNode(node);
        this._renderPagesTree();
        this._updateStats();
        this._updateEmptyState();
        this.renderer.panTo(node.x, node.y);

        if (this.options.autoExpand && window.electronAPI && window.electronAPI.geminiRequest) {
            this._aiGenerateTitle(node, text);
        }
    }

    _showBranchInput(parentNode) {
        if (this._branchInputActive) {
            this._dismissBranchInput();
        }
        this._branchInputActive = true;

        const typeDef = NexusModel.NODE_TYPES[parentNode.type] || NexusModel.NODE_TYPES.claim;
        const screenPos = this.renderer.worldToScreen(parentNode.x, parentNode.y);

        // Create overlay input
        const wrapper = document.createElement('div');
        wrapper.id = 'branch-input-wrapper';
        wrapper.style.cssText = `
            position: absolute;
            left: ${screenPos.x - 100}px;
            top: ${screenPos.y + 30}px;
            z-index: 1000;
            display: flex;
            align-items: center;
            gap: 6px;
        `;

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Branch from this node...';
        input.style.cssText = `
            width: 220px;
            padding: 6px 12px;
            background: rgba(17,17,17,0.95);
            border: 2px solid ${typeDef.color};
            border-radius: 14px;
            color: #fff;
            font-family: 'Space Grotesk', sans-serif;
            font-size: 12px;
            outline: none;
            box-shadow: 0 0 16px ${typeDef.glow}, 0 4px 24px rgba(0,0,0,0.5);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
        `;

        wrapper.appendChild(input);
        this.canvas.parentElement.appendChild(wrapper);

        input.focus();

        const submit = () => {
            const text = input.value.trim();
            if (!text) { this._dismissBranchInput(); return; }

            const angle = Math.random() * Math.PI * 2;
            const dist = 180 + Math.random() * 60;
            const nx = parentNode.x + Math.cos(angle) * dist;
            const ny = parentNode.y + Math.sin(angle) * dist;

            const label = text.slice(0, 40) + (text.length > 40 ? '\u2026' : '');
            const child = this.model.addNode('claim', nx, ny, label);
            child.content = text;
            this.model.addEdge(parentNode.id, child.id);

            this._dismissBranchInput();
            this._clearSelection();
            this._selectNode(child);
            this._status('[BRANCHED]');

            if (this.options.autoExpand && window.electronAPI && window.electronAPI.geminiRequest) {
                this._aiGenerateTitle(child, text);
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { this._dismissBranchInput(); }
            e.stopPropagation(); // Don't trigger canvas shortcuts
        });

        input.addEventListener('blur', () => {
            setTimeout(() => this._dismissBranchInput(), 150);
        });

        this._branchInputActive = true;
    }

    _dismissBranchInput() {
        const existing = document.getElementById('branch-input-wrapper');
        if (existing) existing.remove();
        this._branchInputActive = false;
    }

    async _aiGenerateTitle(node, text) {
        if (!window.electronAPI || !window.electronAPI.geminiStream) return;

        const prompt = `You are a rigorous epistemic assistant running inside NoCapybara. Given a raw thought or claim, formalize it into a structured knowledge node.

Return your response in EXACTLY this format (every field required):
TITLE: <concise 3-6 word title>
TYPE: <one of: claim, evidence, argument, axiom, question, synthesis>
DESCRIPTION: <1-2 sentence logical summary>
PROPERTIES: <key=value pairs, comma separated, e.g. domain=logic, falsifiable=true, related_to=quantum mechanics>
---
<expanded content: rigorously structured page. Outline the premises, empirical grounding, and logical implications. 3-8 paragraphs, plain text, no markdown headers. Be specific and factual.>

Type definitions:
- claim: an assertion to be examined
- evidence: empirical data, direct observation, indisputable fact
- argument: a structured logical chain mapping claims to evidence
- axiom: a foundational, self-evident assumption
- question: an open inquiry or contradiction requiring resolution
- synthesis: a convergence of multiple branches

Thought: "${text.replace(/"/g, '\\"')}"`;

        node._loading = true;
        node.source = { type: 'ai-expanded', model: this.selectedModel, timestamp: Date.now() };
        this.renderer.markDirty();
        let fullResponse = '';
        let headerParsed = false;
        let contentStartIdx = -1;

        // Show expansion in debate overlay
        const overlay = document.getElementById('debate-overlay');
        const transcript = document.getElementById('debate-transcript');
        const statusEl = document.getElementById('debate-status');
        const titleEl = document.getElementById('debate-modal-title');
        const roundIndicator = document.getElementById('debate-round-indicator');

        overlay.classList.remove('hidden');
        transcript.innerHTML = '';
        titleEl.textContent = 'EXPANDING THOUGHT';
        roundIndicator.textContent = 'AWAITING RESPONSE';
        let _dotCount = 0;
        const _thinkInterval = setInterval(() => {
            _dotCount = (_dotCount % 3) + 1;
            statusEl.textContent = 'Thinking' + '.'.repeat(_dotCount);
        }, 400);
        statusEl.textContent = 'Thinking.';

        const reopenBtn = document.getElementById('debate-reopen');
        reopenBtn.classList.add('hidden');

        document.getElementById('debate-modal-close').onclick = () => {
            overlay.classList.add('hidden');
            if (transcript.children.length > 0) reopenBtn.classList.remove('hidden');
        };

        reopenBtn.onclick = () => {
            overlay.classList.remove('hidden');
            reopenBtn.classList.add('hidden');
            transcript.scrollTop = transcript.scrollHeight;
        };

        const msg = document.createElement('div');
        msg.className = 'debate-msg side-a';
        msg.innerHTML = `
            <div class="debate-msg-header">\u2726 ${this.selectedModel}</div>
            <div class="debate-msg-body" id="write-modal-body"></div>
        `;
        transcript.appendChild(msg);

        const writeBody = document.getElementById('write-modal-body');
        window.electronAPI.removeStreamListeners();

        window.electronAPI.onStreamChunk((chunk) => {
            fullResponse += chunk;

            // Try to parse header fields as they arrive
            if (!headerParsed) {
                const titleMatch = fullResponse.match(/^TITLE:\s*(.+)/m);
                if (titleMatch) {
                    const title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
                    if (title && title.length < 80 && node.label !== title) {
                        node.label = title;
                        this.renderer.markDirty();
                        this._renderPagesTree();
                        if (this.selectedNodes.has(node.id)) {
                            const el = document.getElementById('node-label');
                            if (el) el.value = title;
                        }
                    }
                }

                const typeMatch = fullResponse.match(/^TYPE:\s*(.+)/m);
                if (typeMatch) {
                    const type = typeMatch[1].trim().toLowerCase();
                    const validTypes = ['claim', 'evidence', 'argument', 'axiom', 'question', 'synthesis'];
                    if (validTypes.includes(type) && node.type !== type) {
                        node.type = type;
                        this.renderer.markDirty();
                        if (this.selectedNodes.has(node.id)) {
                            const el = document.getElementById('node-type-select');
                            if (el) el.value = type;
                        }
                    }
                }

                const descMatch = fullResponse.match(/^DESCRIPTION:\s*(.+)/m);
                if (descMatch) {
                    const desc = descMatch[1].trim();
                    if (desc && node.description !== desc) {
                        node.description = desc;
                        if (this.selectedNodes.has(node.id)) {
                            const el = document.getElementById('node-description');
                            if (el) el.value = desc;
                        }
                    }
                }

                const propsMatch = fullResponse.match(/^PROPERTIES:\s*(.+)/m);
                if (propsMatch) {
                    const pairs = propsMatch[1].split(',').map(p => p.trim()).filter(Boolean);
                    for (const pair of pairs) {
                        const [key, ...valParts] = pair.split('=');
                        const val = valParts.join('=').trim();
                        if (key && val) node.properties[key.trim()] = val;
                    }
                    if (this.selectedNodes.has(node.id)) {
                        this._renderCustomProperties(node);
                    }
                }

                // Check for separator — everything after is content
                const sepIdx = fullResponse.indexOf('---');
                if (sepIdx !== -1) {
                    headerParsed = true;
                    contentStartIdx = sepIdx + 3;
                }
            }

            // Stream content into node and modal
            const contentSoFar = headerParsed
                ? fullResponse.slice(contentStartIdx).trimStart()
                : fullResponse;
            if (contentSoFar) {
                node.content = text ? text + '\n\n\u2014 \u2014 \u2014\n\n' + contentSoFar : contentSoFar;
                if (this.selectedNodes.has(node.id)) {
                    const el = document.getElementById('node-content');
                    if (el) {
                        el.value = node.content;
                        el.scrollTop = el.scrollHeight;
                    }
                }
                if (writeBody) {
                    writeBody.innerHTML = renderMarkdown(contentSoFar);
                    writeBody.scrollTop = writeBody.scrollHeight;
                }
            }
        });

        window.electronAPI.onStreamDone(() => {
            node._loading = false;
            this._pushContentState(node, node.content);
            this.renderer.markDirty();
            this._renderPagesTree();
            window.electronAPI.removeStreamListeners();
            clearInterval(_thinkInterval);
            statusEl.textContent = 'COMPLETE \u2014 Click \u2715 to close';
        });

        window.electronAPI.onStreamError((err) => {
            node._loading = false;
            this.renderer.markDirty();
            this._status('[AI ERROR: ' + err + ']', 'error');
            window.electronAPI.removeStreamListeners();
            clearInterval(_thinkInterval);
            statusEl.textContent = 'ERROR \u2014 ' + err;
        });

        window.electronAPI.geminiStream(prompt, true, this.selectedModel);
    }

    // ======================== CONTENT STATE TREE ========================

    _initContentHistory(node) {
        if (!this.contentHistory.has(node.id)) {
            this.contentHistory.set(node.id, {
                states: [node.content || ''],
                index: 0
            });
        }
    }

    _pushContentState(node, content) {
        const h = this.contentHistory.get(node.id);
        if (!h) return;
        // Don't push duplicate
        if (h.states[h.index] === content) return;
        // Truncate any redo states
        h.states = h.states.slice(0, h.index + 1);
        h.states.push(content);
        h.index = h.states.length - 1;
        // Cap at 50 states
        if (h.states.length > 50) {
            h.states.shift();
            h.index--;
        }
        this._updateHistoryUI(node);
    }

    _undoContent(node) {
        const h = this.contentHistory.get(node.id);
        if (!h || h.index <= 0) return null;
        h.index--;
        this._updateHistoryUI(node);
        return h.states[h.index];
    }

    _redoContent(node) {
        const h = this.contentHistory.get(node.id);
        if (!h || h.index >= h.states.length - 1) return null;
        h.index++;
        this._updateHistoryUI(node);
        return h.states[h.index];
    }

    _updateHistoryUI(node) {
        const h = this.contentHistory.get(node.id);
        const label = document.getElementById('content-history-label');
        if (h && label) {
            label.textContent = `STATE ${h.index + 1}/${h.states.length}`;
        }
        const undoBtn = document.getElementById('btn-undo-content');
        const redoBtn = document.getElementById('btn-redo-content');
        if (undoBtn) undoBtn.style.opacity = (h && h.index > 0) ? '1' : '0.3';
        if (redoBtn) redoBtn.style.opacity = (h && h.index < h.states.length - 1) ? '1' : '0.3';
    }

    // ======================== AI REFRESH ========================

    async _aiRefreshContent(node) {
        if (!window.electronAPI || !window.electronAPI.geminiStream) {
            this._status('[ERROR: NO API KEY]', 'error');
            return;
        }

        const statusEl = document.getElementById('content-status');
        const contentInput = document.getElementById('node-content');
        let _refreshDots = 0;
        const _refreshInterval = setInterval(() => {
            _refreshDots = (_refreshDots % 3) + 1;
            statusEl.textContent = 'Thinking' + '.'.repeat(_refreshDots);
        }, 400);
        statusEl.textContent = 'Thinking.';
        statusEl.className = 'content-status loading';

        const existingContent = node.content || '';
        const prompt = `You are a research assistant. The user has a concept node titled "${node.label}" with type "${node.type}".
${node.description ? `Description: "${node.description}"` : ''}
${existingContent ? `Current content:\n${existingContent.slice(0, 2000)}` : 'No content yet.'}

Research and provide the NEWEST, most relevant and up-to-date information about this concept. Include:
- Key definitions or clarifications
- Recent developments or current state of knowledge
- Important connections to related concepts
- Practical implications or applications
- Open questions worth exploring

Write concise, substantive paragraphs. Plain text only, no markdown headers. Be specific and factual.`;

        const prefix = existingContent ? existingContent + '\n\n— REFRESHED —\n\n' : '';
        let streamed = '';

        // Set up initial content
        if (contentInput && this.selectedNodes.has(node.id)) {
            contentInput.value = prefix;
        }

        window.electronAPI.removeStreamListeners();

        window.electronAPI.onStreamChunk((text) => {
            streamed += text;
            node.content = prefix + streamed;
            if (contentInput && this.selectedNodes.has(node.id)) {
                contentInput.value = node.content;
                contentInput.scrollTop = contentInput.scrollHeight;
            }
            this.renderer.markDirty();
        });

        window.electronAPI.onStreamDone(() => {
            clearInterval(_refreshInterval);
            this._pushContentState(node, node.content);
            statusEl.textContent = '[REFRESHED]';
            statusEl.className = 'content-status';
            setTimeout(() => { statusEl.textContent = ''; }, 2000);
            this._status('[CONTENT REFRESHED]', 'success');
            window.electronAPI.removeStreamListeners();
        });

        window.electronAPI.onStreamError((err) => {
            clearInterval(_refreshInterval);
            statusEl.textContent = '[ERROR: ' + err + ']';
            statusEl.className = 'content-status';
            window.electronAPI.removeStreamListeners();
        });

        window.electronAPI.geminiStream(prompt, true, this.selectedModel);
    }

    // ======================== QUICK SWITCHER ========================

    _toggleQuickSwitcher() {
        const qs = document.getElementById('quick-switcher');
        if (qs.classList.contains('hidden')) {
            qs.classList.remove('hidden');
            const input = document.getElementById('qs-input');
            input.value = '';
            input.focus();
            this._qsIndex = 0;
            this._qsResults = [];
            this._renderQSResults('');

            // Bind input events
            input.oninput = () => this._renderQSResults(input.value);
            input.onkeydown = (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this._qsIndex = Math.min(this._qsIndex + 1, this._qsResults.length - 1);
                    this._highlightQSResult();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this._qsIndex = Math.max(this._qsIndex - 1, 0);
                    this._highlightQSResult();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (this._qsResults[this._qsIndex]) {
                        if (this._splitPaneMode) {
                            this._openSplitPaneWith(this._qsResults[this._qsIndex]);
                            this._splitPaneMode = false;
                        } else {
                            this._jumpToNode(this._qsResults[this._qsIndex]);
                        }
                        this._closeQuickSwitcher();
                    }
                }
            };
        } else {
            this._closeQuickSwitcher();
        }
    }

    _closeQuickSwitcher() {
        document.getElementById('quick-switcher').classList.add('hidden');
        document.getElementById('qs-input').oninput = null;
        document.getElementById('qs-input').onkeydown = null;
    }

    _renderQSResults(query) {
        const container = document.getElementById('qs-results');
        const q = query.toLowerCase().trim();
        let nodes = [...this.model.nodes.values()];

        if (q) {
            nodes = nodes
                .map(n => ({
                    node: n,
                    score: (n.label.toLowerCase().includes(q) ? 3 : 0) +
                           ((n.description || '').toLowerCase().includes(q) ? 1 : 0) +
                           (n.type.includes(q) ? 1 : 0)
                }))
                .filter(r => r.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(r => r.node);
        } else {
            // Show most recently modified
            nodes = nodes.slice().sort((a, b) => (b._modified || 0) - (a._modified || 0));
        }

        this._qsResults = nodes.slice(0, 12);
        this._qsIndex = 0;

        if (this._qsResults.length === 0) {
            container.innerHTML = '<div class="qs-empty">[ NO MATCHES ]</div>';
            return;
        }

        container.innerHTML = this._qsResults.map((n, i) => {
            const typeDef = NexusModel.NODE_TYPES[n.type] || NexusModel.NODE_TYPES.idea;
            return `<div class="qs-result${i === 0 ? ' active' : ''}" data-idx="${i}">
                <span class="qs-result-label">${this._esc(n.label)}</span>
                <span class="qs-result-type">${typeDef.label}</span>
            </div>`;
        }).join('');

        container.querySelectorAll('.qs-result').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.idx);
                this._jumpToNode(this._qsResults[idx]);
                this._closeQuickSwitcher();
            });
        });
    }

    _highlightQSResult() {
        document.querySelectorAll('.qs-result').forEach((el, i) => {
            el.classList.toggle('active', i === this._qsIndex);
            if (i === this._qsIndex) el.scrollIntoView({ block: 'nearest' });
        });
    }

    _jumpToNode(node) {
        this._clearSelection();
        this._selectNode(node);
        this.renderer.panTo(node.x, node.y);
        this._openInspector(node);
    }

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ======================== BACKLINKS ========================

    _renderBacklinks(node) {
        const container = document.getElementById('node-backlinks-list');
        if (!container) return;

        const backlinks = [];
        const label = node.label.toLowerCase();

        this.model.nodes.forEach(other => {
            if (other.id === node.id) return;

            // Check for [[wiki link]] references
            const wikiPattern = `[[${node.label}]]`;
            const contentLower = String(other.content || '').toLowerCase();
            const notesLower = String(other.notes || '').toLowerCase();

            const hasWikiLink = contentLower.includes(wikiPattern.toLowerCase()) ||
                                notesLower.includes(wikiPattern.toLowerCase());

            // Check for plain text mention
            const hasMention = contentLower.includes(label) || notesLower.includes(label);

            if (hasWikiLink || hasMention) {
                // Extract context snippet
                const text = other.content || other.notes || '';
                const idx = text.toLowerCase().indexOf(label);
                let context = '';
                if (idx !== -1) {
                    const start = Math.max(0, idx - 30);
                    const end = Math.min(text.length, idx + label.length + 30);
                    context = (start > 0 ? '...' : '') +
                              text.slice(start, end).replace(/\n/g, ' ') +
                              (end < text.length ? '...' : '');
                }

                backlinks.push({ node: other, context, isWiki: hasWikiLink });
            }
        });

        if (backlinks.length === 0) {
            container.innerHTML = '<div class="backlinks-empty">[ NONE ]</div>';
            return;
        }

        container.innerHTML = backlinks.map(bl => `
            <div class="backlink-item" data-id="${bl.node.id}">
                <div>
                    <div class="backlink-label">${bl.isWiki ? '⟦ ' : ''}${this._esc(bl.node.label)}${bl.isWiki ? ' ⟧' : ''}</div>
                    ${bl.context ? `<div class="backlink-context">${this._esc(bl.context)}</div>` : ''}
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.backlink-item').forEach(el => {
            el.addEventListener('click', () => {
                const target = this.model.nodes.get(el.dataset.id);
                if (target) this._jumpToNode(target);
            });
        });
    }

    _renderEpistemics(node) {
        const container = document.getElementById('epistemic-controls');
        if (!container) return;

        const statuses = NexusModel.EPISTEMIC_STATUSES;
        const currentEpi = statuses[node.epistemicStatus] || statuses.conjecture;
        const sourceLabels = {
            'user': '👤 User',
            'ai-expanded': '🤖 AI Expanded',
            'debate-round': '⚔ Debate Round',
            'debate-resolution': '◆ Resolution',
            'import': '📥 Imported',
            'grounded': '🔍 Grounded',
        };
        const sourceLabel = sourceLabels[node.source?.type] || '👤 User';

        container.innerHTML = `
            <div class="epistemic-row">
                <label class="epistemic-label">EPISTEMIC STATUS</label>
                <select id="epistemic-status-select" class="inspector-select">
                    ${Object.entries(statuses).map(([key, val]) =>
                        `<option value="${key}" ${key === node.epistemicStatus ? 'selected' : ''}>${val.label}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="epistemic-row">
                <label class="epistemic-label">CONFIDENCE <span id="confidence-val">${Math.round(node.confidence * 100)}%</span></label>
                <input type="range" id="confidence-slider" min="0" max="100" value="${Math.round(node.confidence * 100)}" class="confidence-slider">
            </div>
            <div class="epistemic-row">
                <label class="epistemic-label">SOURCE</label>
                <span class="source-badge" style="color:${currentEpi.color}">${sourceLabel}</span>
            </div>
            <div class="epistemic-row">
                <label class="epistemic-label">FALSIFICATION CONDITION</label>
                <textarea id="falsification-input" class="inspector-textarea" rows="2" placeholder="This claim would be falsified if...">${this._esc(node.falsificationCondition || '')}</textarea>
            </div>
        `;

        document.getElementById('epistemic-status-select').onchange = (e) => {
            node.epistemicStatus = e.target.value;
            this.renderer.markDirty();
            this._renderEpistemics(node);
        };

        document.getElementById('confidence-slider').oninput = (e) => {
            node.confidence = parseInt(e.target.value) / 100;
            document.getElementById('confidence-val').textContent = e.target.value + '%';
        };

        document.getElementById('falsification-input').oninput = (e) => {
            node.falsificationCondition = e.target.value;
        };
    }

    // ======================== PAGE VIEW ========================

    _openPageView() {
        const nodeId = [...this.selectedNodes][0];
        if (!nodeId) return;
        const node = this.model.nodes.get(nodeId);
        if (!node) return;

        const typeDef = NexusModel.NODE_TYPES[node.type] || NexusModel.NODE_TYPES.idea;
        document.getElementById('page-view-title').textContent = node.label;
        document.getElementById('page-view-type').textContent = typeDef.label;
        document.getElementById('page-view-desc').textContent = node.description || '';
        const contentEl = document.getElementById('page-view-content');
        contentEl.innerHTML = this._renderMarkdown(node.content || '[ No content ]');

        // Bind wiki link clicks in page view
        contentEl.querySelectorAll('.wiki-link').forEach(link => {
            link.addEventListener('click', () => {
                const target = this._findNodeByLabel(link.dataset.target);
                if (target) {
                    document.getElementById('page-view-overlay').classList.add('hidden');
                    this._jumpToNode(target);
                }
            });
        });

        // Bind tag clicks in page view
        contentEl.querySelectorAll('.tag-link').forEach(tag => {
            tag.addEventListener('click', () => {
                document.getElementById('page-view-overlay').classList.add('hidden');
                document.getElementById('search-input').value = tag.dataset.tag;
                this._doSearch(tag.dataset.tag);
            });
        });
        // Bind hover preview on wiki links
        contentEl.querySelectorAll('.wiki-link').forEach(link => {
            link.addEventListener('mouseenter', (e) => this._showHoverPreview(e, link.dataset.target));
            link.addEventListener('mouseleave', () => this._hideHoverPreview());
        });

        // Build outline
        this._buildOutline(node.content || '');

        // Reset split pane
        document.getElementById('split-pane').classList.add('hidden');

        document.getElementById('page-view-overlay').classList.remove('hidden');
    }

    _buildOutline(content) {
        const headings = NocapMarkdown.extractHeadings(content);

        const outlineEl = document.getElementById('outline-items');
        if (headings.length === 0) {
            outlineEl.innerHTML = '<div class="outline-item" style="color:var(--text-disabled)">No headings</div>';
            return;
        }

        outlineEl.innerHTML = headings.map(h =>
            `<div class="outline-item" data-level="${h.level}" data-line="${h.line}">${this._esc(h.text)}</div>`
        ).join('');

        outlineEl.querySelectorAll('.outline-item').forEach(el => {
            el.addEventListener('click', () => {
                // Scroll to the heading in the content
                const contentEl = document.getElementById('page-view-content');
                const hLevel = `h${el.dataset.level}`;
                const headingEls = contentEl.querySelectorAll(hLevel);
                const targetText = el.textContent;
                for (const h of headingEls) {
                    if (h.textContent.trim() === targetText.trim()) {
                        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        break;
                    }
                }
            });
        });
    }

    _showHoverPreview(e, targetName) {
        const node = this._findNodeByLabel(targetName);
        if (!node) return;

        const preview = document.getElementById('hover-preview');
        document.getElementById('hover-preview-title').textContent = node.label;
        document.getElementById('hover-preview-desc').textContent = node.description || '';
        document.getElementById('hover-preview-snippet').textContent =
            (node.content || '').slice(0, 200) + (node.content && node.content.length > 200 ? '...' : '');

        preview.style.left = (e.clientX + 12) + 'px';
        preview.style.top = (e.clientY + 12) + 'px';
        preview.classList.remove('hidden');
    }

    _hideHoverPreview() {
        document.getElementById('hover-preview').classList.add('hidden');
    }

    _openSplitPane() {
        // Open quick switcher to pick second page
        this._splitPaneMode = true;
        this._toggleQuickSwitcher();
    }

    _openSplitPaneWith(node) {
        const pane = document.getElementById('split-pane');
        document.getElementById('split-pane-title').textContent = node.label;
        const contentEl = document.getElementById('split-pane-content');
        contentEl.innerHTML = this._renderMarkdown(node.content || '[ No content ]');

        // Bind wiki links in split pane
        contentEl.querySelectorAll('.wiki-link').forEach(link => {
            link.addEventListener('click', () => {
                const target = this._findNodeByLabel(link.dataset.target);
                if (target) this._openSplitPaneWith(target);
            });
        });

        pane.classList.remove('hidden');
    }

    _renderMarkdown(text, depth = 0) {
        const findNode = (label) => this._findNodeByLabel(label);
        const renderContent = (node, d) => this._renderMarkdown(node.content, d);
        return NocapMarkdown.renderPage(text, findNode, renderContent, depth);
    }

    _findNodeByLabel(label) {
        const lower = label.toLowerCase();
        for (const node of this.model.nodes.values()) {
            if (node.label.toLowerCase() === lower) return node;
        }
        return null;
    }

    _openBranchConfigModal(topic, parentNode) {
        const overlay = document.getElementById('branch-config-overlay');
        const preview = document.getElementById('branch-config-topic-preview');
        const container = document.getElementById('branch-config-controls-container');
        const startBtn = document.getElementById('branch-config-start-btn');
        const closeBtn = document.getElementById('branch-config-close');

        // Move #debate-controls DOM into the modal
        const controls = document.getElementById('debate-controls');
        const originalParent = controls.parentElement;
        
        // Unhide controls if they were hidden by Note mode
        const wasHidden = controls.classList.contains('hidden');
        controls.classList.remove('hidden');
        container.appendChild(controls);

        preview.textContent = `"${topic.slice(0, 150)}${topic.length > 150 ? '...' : ''}"`;
        overlay.classList.remove('hidden');

        const closeLogic = () => {
            overlay.classList.add('hidden');
            // Move controls back to original position
            originalParent.appendChild(controls);
            if (wasHidden) controls.classList.add('hidden');
        };

        closeBtn.onclick = () => closeLogic();
        
        startBtn.onclick = () => {
            closeLogic();
            this._startDebate(topic, parentNode);
        };
    }

    // ======================== DEBATE ENGINE (delegated) ========================

    async _startDebate(topic, parentNode = null) {
        if (this.debate.isRunning) {
            this._status('[DEBATE ALREADY RUNNING]');
            return;
        }

        // Sync debater config from UI
        this.debate.debaters = this.debaters;
        this.debate.judgeModel = this.debateJudgeModel;

        // Open the debate modal
        const overlay = document.getElementById('debate-overlay');
        const transcript = document.getElementById('debate-transcript');
        const statusEl = document.getElementById('debate-status');
        const roundIndicator = document.getElementById('debate-round-indicator');
        overlay.classList.remove('hidden');
        transcript.innerHTML = '';

        const numDebaters = this.debaters.length;
        const rounds = parseInt(document.getElementById('debate-rounds')?.value || 3);
        const mode = document.getElementById('debate-mode')?.value || 'standard';
        const modeLabels = { standard: '\u2694 STANDARD', steelman: '\uD83D\uDEE1 STEEL MAN', redteam: '\uD83D\uDD34 RED TEAM', socratic: '\uD83D\u0018DB SOCRATIC' };
        document.getElementById('debate-modal-title').textContent = `${modeLabels[mode] || 'DEBATE'}: ${topic.slice(0, 50)}`;
        roundIndicator.textContent = `${numDebaters} DEBATERS \u00B7 ${rounds} ROUNDS`;
        statusEl.textContent = 'Initializing...';

        const reopenBtn = document.getElementById('debate-reopen');
        reopenBtn.classList.add('hidden');

        document.getElementById('debate-modal-close').onclick = () => {
            overlay.classList.add('hidden');
            // Show resume button if there's transcript content
            if (transcript.children.length > 0) reopenBtn.classList.remove('hidden');
        };

        reopenBtn.onclick = () => {
            overlay.classList.remove('hidden');
            reopenBtn.classList.add('hidden');
            transcript.scrollTop = transcript.scrollHeight;
        };

        const uiCallbacks = {
            onTranscriptAdd: (letter, round, model, content, emoji) => {
                const msg = document.createElement('div');
                msg.className = `debate-msg side-${letter.toLowerCase()}`;
                msg.innerHTML = `
                    <div class="debate-msg-header">${emoji} MODEL ${letter} \u2014 ROUND ${round} \u00B7 ${model}</div>
                    <div class="debate-msg-body">${renderMarkdown(String(content || ''))}</div>
                `;
                transcript.appendChild(msg);
                transcript.scrollTop = transcript.scrollHeight;
            },
            onStatusUpdate: (text) => {
                statusEl.innerHTML = `<span class="thinking-dots">${text}</span>`;
            },
            onRoundUpdate: (text) => {
                roundIndicator.textContent = text;
            }
        };

        try {
            this._clearSelection();
            const { topicNode, resNode } = await this.debate.run(topic, parentNode, uiCallbacks);
            this._selectNode(topicNode);
            statusEl.textContent = '\u2713 DEBATE RESOLVED \u2014 Click any node to inspect';
            this._status('[DEBATE RESOLVED]', 'success');
            this._jumpToNode(resNode);
        } catch (err) {
            statusEl.textContent = `\u2717 ERROR: ${err.message}`;
            this._status('[DEBATE ERROR: ' + err.message + ']');
            console.error('Debate error:', err);
        }
    }
    // ======================== DAILY NOTES ========================

    _createDailyNote() {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
        const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
        const label = `${dateStr}`;

        // Check if today's note already exists
        const existing = this._findNodeByLabel(label);
        if (existing) {
            this._jumpToNode(existing);
            this._status('[DAILY NOTE EXISTS]');
            return;
        }

        const wp = this.renderer.screenToWorld(this.renderer.viewW / 2, this.renderer.viewH / 2);
        const node = this.model.addNode('question', wp.x, wp.y, label);
        node.description = `Daily note for ${dayName}, ${dateStr}`;
        node.content = `# ${dayName}\n\n## Tasks\n- \n\n## Notes\n\n\n## Reflections\n\n`;
        node.properties = { date: dateStr, type: 'daily-note' };

        this._clearSelection();
        this._selectNode(node);
        this._jumpToNode(node);
        this._status('[DAILY NOTE CREATED]', 'success');
    }

    // ======================== TAG SEARCH ========================

    _doSearch(query) {
        const q = query.toLowerCase().trim();
        if (!q) { this._clearSearch(); return; }

        // Tag search
        if (q.startsWith('#')) {
            const tag = q;
            const results = [];
            this.model.nodes.forEach(n => {
                const content = `${n.content} ${n.notes} ${n.description}`.toLowerCase();
                if (content.includes(tag)) results.push(n);
            });
            this._clearSelection();
            results.forEach(n => this._selectNode(n, true));
            if (results.length > 0) {
                this.renderer.panTo(results[0].x, results[0].y);
            }
            this._status(`[${results.length} TAGGED]`);
            return;
        }

        // Regular search
        const results = this.model.search(q);
        this._clearSelection();
        results.forEach(n => this._selectNode(n, true));
        if (results.length > 0) {
            this.renderer.panTo(results[0].x, results[0].y);
        }
        this._status(`[${results.length} FOUND]`);
    }

    // ======================== TEMPLATES ========================

    _applyTemplate(node, templateName) {
        const templates = {
            'concept': {
                content: `# ${node.label}\n\n## Definition\n\n\n## Key Principles\n- \n\n## Related Concepts\n- \n\n## Applications\n\n`,
                properties: { status: 'draft' }
            },
            'entity': {
                content: `# ${node.label}\n\n## Overview\n\n\n## Properties\n- \n\n## Relationships\n- \n\n## History\n\n`,
                properties: { status: 'draft' }
            },
            'project': {
                content: `# ${node.label}\n\n## Objective\n\n\n## Tasks\n- [ ] \n\n## Resources\n- \n\n## Timeline\n\n## Notes\n\n`,
                properties: { status: 'active', priority: 'medium' }
            },
            'meeting': {
                content: `# ${node.label}\n\n## Date\n${new Date().toISOString().split('T')[0]}\n\n## Attendees\n- \n\n## Agenda\n- \n\n## Decisions\n- \n\n## Action Items\n- [ ] \n`,
                properties: { date: new Date().toISOString().split('T')[0] }
            },
            'research': {
                content: `# ${node.label}\n\n## Question\n\n\n## Hypothesis\n\n\n## Findings\n- \n\n## Sources\n- \n\n## Conclusions\n\n`,
                properties: { status: 'draft', domain: '' }
            }
        };

        const tmpl = templates[templateName];
        if (!tmpl) return;

        node.content = tmpl.content;
        Object.assign(node.properties, tmpl.properties);

        if (this.selectedNodes.has(node.id)) {
            const contentEl = document.getElementById('node-content');
            if (contentEl) contentEl.value = node.content;
            this._renderCustomProperties(node);
        }

        this._status(`[TEMPLATE: ${templateName.toUpperCase()}]`, 'success');
    }

    // ======================== WIKI AUTOCOMPLETE ========================

    _handleWikiAutocomplete(textarea) {
        const pos = textarea.selectionStart;
        const text = textarea.value.slice(0, pos);
        const match = text.match(/\[\[([^\]]*)$/);

        if (!match) {
            document.getElementById('wiki-autocomplete').classList.add('hidden');
            this._wikiAcItems = [];
            return;
        }

        const query = match[1].toLowerCase();
        const nodes = [...this.model.nodes.values()]
            .filter(n => n.label.toLowerCase().includes(query))
            .slice(0, 8);

        this._wikiAcItems = nodes;
        this._wikiAcIndex = 0;

        const container = document.getElementById('wiki-autocomplete');
        if (nodes.length === 0) {
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');
        container.innerHTML = nodes.map((n, i) =>
            `<div class="wiki-ac-item${i === 0 ? ' active' : ''}" data-idx="${i}">${this._esc(n.label)}</div>`
        ).join('');

        container.querySelectorAll('.wiki-ac-item').forEach(el => {
            el.addEventListener('click', () => {
                this._insertWikiLink(textarea, nodes[parseInt(el.dataset.idx)].label);
            });
        });
    }

    _handleWikiKeydown(e, textarea) {
        const container = document.getElementById('wiki-autocomplete');
        if (container.classList.contains('hidden') || !this._wikiAcItems || this._wikiAcItems.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._wikiAcIndex = Math.min(this._wikiAcIndex + 1, this._wikiAcItems.length - 1);
            container.querySelectorAll('.wiki-ac-item').forEach((el, i) =>
                el.classList.toggle('active', i === this._wikiAcIndex));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._wikiAcIndex = Math.max(this._wikiAcIndex - 1, 0);
            container.querySelectorAll('.wiki-ac-item').forEach((el, i) =>
                el.classList.toggle('active', i === this._wikiAcIndex));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            this._insertWikiLink(textarea, this._wikiAcItems[this._wikiAcIndex].label);
        } else if (e.key === 'Escape') {
            container.classList.add('hidden');
        }
    }

    _insertWikiLink(textarea, label) {
        const pos = textarea.selectionStart;
        const text = textarea.value;
        const beforeMatch = text.slice(0, pos).lastIndexOf('[[');
        if (beforeMatch === -1) return;

        const before = text.slice(0, beforeMatch);
        const after = text.slice(pos);
        const newText = before + '[[' + label + ']]' + after;
        textarea.value = newText;
        const newPos = beforeMatch + label.length + 4;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();

        document.getElementById('wiki-autocomplete').classList.add('hidden');

        // Trigger update on the node
        const nodeId = [...this.selectedNodes][0];
        if (nodeId) {
            const node = this.model.nodes.get(nodeId);
            if (node) node.content = textarea.value;
        }
    }

    // ======================== STARRED ========================

    _renderStarredList() {
        const container = document.getElementById('starred-list');
        if (!container) return;

        const starred = [...this.starredNodes]
            .map(id => this.model.nodes.get(id))
            .filter(Boolean);

        if (starred.length === 0) {
            container.innerHTML = '<div class="backlinks-empty" style="padding:12px">[ NO STARRED PAGES ]</div>';
            return;
        }

        container.innerHTML = starred.map(n => {
            const typeDef = NexusModel.NODE_TYPES[n.type] || NexusModel.NODE_TYPES.idea;
            return `<div class="page-item" data-id="${n.id}">
                <span class="page-dot" style="background:${typeDef.color}"></span>
                <span class="page-label">★ ${this._esc(n.label)}</span>
            </div>`;
        }).join('');

        container.querySelectorAll('.page-item').forEach(el => {
            el.addEventListener('click', () => {
                const node = this.model.nodes.get(el.dataset.id);
                if (node) this._jumpToNode(node);
            });
        });
    }

    // ======================== EXPORT ========================

    _exportMarkdown() {
        const nodeId = [...this.selectedNodes][0];
        if (!nodeId) return;
        const node = this.model.nodes.get(nodeId);
        if (!node) return;

        const typeDef = NexusModel.NODE_TYPES[node.type] || NexusModel.NODE_TYPES.idea;
        let md = `# ${node.label}\n\n`;
        md += `> Type: ${typeDef.label}\n\n`;
        if (node.description) md += `*${node.description}*\n\n`;

        // Properties
        const propKeys = Object.keys(node.properties || {});
        if (propKeys.length > 0) {
            md += `## Properties\n\n`;
            propKeys.forEach(k => { md += `- **${k}**: ${node.properties[k]}\n`; });
            md += '\n';
        }

        if (node.content) md += `---\n\n${node.content}\n\n`;
        if (node.notes) md += `## Notes\n\n${node.notes}\n`;

        // Download
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${node.label.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}.md`;
        a.click();
        URL.revokeObjectURL(url);
        this._status('[EXPORTED]', 'success');
    }

    // ======================== OPTIONS ========================

    _openOptions() {
        // Sync checkbox state
        const optMap = {
            'opt-grid': 'grid', 'opt-labels': 'labels', 'opt-edges': 'edges',
            'opt-edge-labels': 'edgeLabels', 'opt-auto-expand': 'autoExpand',
            'opt-grounding': 'grounding', 'opt-backlinks': 'backlinks',
            'opt-outline': 'outline', 'opt-word-count': 'wordCount',
            'opt-hover-preview': 'hoverPreview', 'opt-auto-save': 'autoSave',
            'opt-status-bar': 'statusBar', 'opt-empty-state': 'emptyState',
        };
        Object.entries(optMap).forEach(([elId, key]) => {
            const el = document.getElementById(elId);
            if (el) el.checked = this.options[key];
        });
        document.getElementById('options-overlay').classList.remove('hidden');
    }

    async _importObsidianVault(files) {
        const fileData = [];
        // 1. Read all files
        for (const file of files) {
            const text = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.readAsText(file);
            });
            fileData.push({ name: file.name.replace(/\.md$/i, ''), content: text });
        }

        // 2. Parse frontmatter & create nodes
        const nodeMap = new Map(); // label -> node
        const newNodes = [];
        const wp = this.renderer.screenToWorld(this.renderer.viewW / 2, this.renderer.viewH / 2);

        // Calculate a grid layout
        const cols = Math.ceil(Math.sqrt(fileData.length));
        const spacing = 300;
        let startX = wp.x - (cols * spacing) / 2;
        let startY = wp.y - (cols * spacing) / 2;

        fileData.forEach((fd, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const nx = startX + col * spacing + (Math.random() * 50 - 25);
            const ny = startY + row * spacing + (Math.random() * 50 - 25);

            let type = 'claim';
            let cleanContent = fd.content;
            let description = '';

            // Extract YAML Frontmatter
            const fmMatch = fd.content.match(/^---\n([\s\S]*?)\n---/);
            if (fmMatch) {
                cleanContent = fd.content.slice(fmMatch[0].length).trim();
                const fm = fmMatch[1];
                if (fm.match(/type:\s*evidence/i)) type = 'evidence';
                else if (fm.match(/type:\s*argument/i)) type = 'argument';
                else if (fm.match(/type:\s*axiom/i)) type = 'axiom';
                else if (fm.match(/type:\s*question/i)) type = 'question';
                else if (fm.match(/type:\s*synthesis/i)) type = 'synthesis';
                
                const descMatch = fm.match(/description:\s*(.+)/i);
                if (descMatch) description = descMatch[1].trim();
            }

            const node = this.model.addNode(type, nx, ny, fd.name);
            node.content = cleanContent;
            node.description = description || 'Imported from Obsidian';
            node.source = { type: 'import', timestamp: Date.now() };

            // Extract tags
            const tags = cleanContent.match(/#[a-zA-Z0-9_\-]+/g);
            if (tags) {
                if (!node.notes) node.notes = '';
                node.notes += '\nTags: ' + tags.join(', ');
            }

            nodeMap.set(fd.name.toLowerCase(), node);
            newNodes.push({ node, cleanContent });
        });

        // 3. Resolve WikiLinks to edges
        // Regex for [[Link]] or [[Link|Alias]]
        const wikiRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
        let edgesCreated = 0;

        newNodes.forEach((data) => {
            let match;
            const seenLinks = new Set();
            while ((match = wikiRegex.exec(data.cleanContent)) !== null) {
                const linkTarget = match[1].trim().toLowerCase();
                if (seenLinks.has(linkTarget)) continue;
                seenLinks.add(linkTarget);

                // Find target in new imports, or existing graph
                let targetId = null;
                if (nodeMap.has(linkTarget)) {
                    targetId = nodeMap.get(linkTarget).id;
                } else {
                    const existingNode = this._findNodeByLabel(linkTarget);
                    if (existingNode) targetId = existingNode.id;
                }

                if (targetId && targetId !== data.node.id) {
                    this.model.addEdge(data.node.id, targetId, 'references');
                    edgesCreated++;
                }
            }
        });

        this.renderer.markDirty();
        this._status(`[IMPORT COMPLETE: ${fileData.length} files, ${edgesCreated} links]`, 'success');

        // Optional: Run physics to organically layout the new structure
        if (this.renderer.physicsEnabled) {
            // physics will auto trigger dirtiness
        } else {
            this.renderer.fitView();
        }
    }

    _exportAllMarkdown() {
        const nodes = [...this.model.nodes.values()];
        if (nodes.length === 0) {
            this._status('[NO NODES TO EXPORT]');
            return;
        }

        let allMd = '';
        nodes.forEach(node => {
            const typeDef = NexusModel.NODE_TYPES[node.type] || NexusModel.NODE_TYPES.idea;
            allMd += `# ${node.label}\n\n`;
            allMd += `> Type: ${typeDef.label}\n\n`;
            if (node.description) allMd += `*${node.description}*\n\n`;
            const propKeys = Object.keys(node.properties || {});
            if (propKeys.length > 0) {
                allMd += `## Properties\n\n`;
                propKeys.forEach(k => { allMd += `- **${k}**: ${node.properties[k]}\n`; });
                allMd += '\n';
            }
            if (node.content) allMd += `---\n\n${node.content}\n\n`;
            allMd += '\n---\n\n';
        });

        const blob = new Blob([allMd], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nocapybara-vault-${new Date().toISOString().split('T')[0]}.md`;
        a.click();
        URL.revokeObjectURL(url);
        this._status(`[EXPORTED ${nodes.length} NODES]`, 'success');
    }

    // ======================== WORD COUNT ========================

    _updateWordCount(text) {
        const str = String(text || '');
        const words = str.trim() ? str.trim().split(/\s+/).length : 0;
        const el = document.getElementById('word-count');
        if (el) el.textContent = `${words} WORDS`;
    }

    // ======================== HELPERS ========================

    _deleteSelected() {
        this.selectedNodes.forEach(id => this.model.removeNode(id));
        this.selectedNodes.clear();
        if (this.selectedEdge) {
            this.model.removeEdge(this.selectedEdge.id);
            this.selectedEdge = null;
        }
        this._updateInspector();
    }

    _clearSearch() {
        this.model.nodes.forEach(n => { n.hovered = false; });
        this.renderer.markDirty();
    }

    _updateStats() {
        document.getElementById('node-count').textContent = this.model.nodes.size + ' NODE' + (this.model.nodes.size !== 1 ? 'S' : '');
        document.getElementById('edge-count').textContent = this.model.edges.size + ' EDGE' + (this.model.edges.size !== 1 ? 'S' : '');

        // Epistemic loss
        if (window.Epistemics && this.model.nodes.size > 0) {
            const loss = Epistemics.computeLoss(this.model);
            const lossEl = document.getElementById('epistemic-loss');
            if (lossEl) {
                lossEl.textContent = `L: ${loss.total.toFixed(3)}`;
                // Color code: green < 0.3, yellow < 0.6, red >= 0.6
                lossEl.style.color = loss.total < 0.3 ? '#6EBF8B' : loss.total < 0.6 ? '#E8C96E' : '#E0866E';
            }
        }
    }

    _updateEmptyState() {
        const el = document.getElementById('empty-state');
        if (this.model.nodes.size > 0 || !this.options.emptyState) el.classList.add('hidden');
        else el.classList.remove('hidden');
    }

    // ======================== PAGES TREE ========================

    _renderPagesTree() {
        const container = document.getElementById('pages-tree');
        if (!container) return;
        container.innerHTML = '';

        const allNodes = [...this.model.nodes.values()];
        if (allNodes.length === 0) {
            container.innerHTML = '<div class="pages-empty">[ NO PAGES ]<br>Double-click the canvas or use + NEW PAGE</div>';
            return;
        }

        // Identify debate topics: nodes with properties.mode === 'debate'
        const debateTopics = allNodes.filter(n => n.properties && n.properties.mode === 'debate');
        const debateChildIds = new Set();

        const debateGroups = debateTopics.map(topic => {
            const children = [];
            const collectChildren = (parentId) => {
                this.model.edges.forEach(e => {
                    if (e.from === parentId) {
                        const child = this.model.nodes.get(e.to);
                        if (child && !debateChildIds.has(child.id)) {
                            children.push(child);
                            debateChildIds.add(child.id);
                            collectChildren(child.id);
                        }
                    }
                });
            };
            debateChildIds.add(topic.id);
            collectChildren(topic.id);
            return { topic, children };
        });

        const standaloneNodes = allNodes.filter(n => !debateChildIds.has(n.id));

        // === Render Debates ===
        if (debateGroups.length > 0) {
            const section = document.createElement('div');
            section.className = 'pages-type-group';

            const hdr = document.createElement('div');
            hdr.className = 'pages-type-header';
            hdr.innerHTML = `<span class="pages-type-chevron">\u25BC</span><span class="pages-type-dot" style="background:#D71921"></span><span class="pages-type-label">DEBATES</span><span class="pages-type-count">${debateGroups.length}</span>`;
            hdr.addEventListener('click', () => hdr.classList.toggle('collapsed'));

            const list = document.createElement('div');
            list.className = 'pages-type-items';

            debateGroups.forEach(({ topic, children }) => {
                const ti = document.createElement('div');
                ti.className = 'page-item' + (this.selectedNodes.has(topic.id) ? ' active' : '');
                ti.innerHTML = `<span class="page-item-toggle">\u25B6</span><span class="page-item-label">${this._esc(topic.label)}</span>`;
                ti.addEventListener('click', (e) => {
                    if (e.target.classList.contains('page-item-toggle')) return;
                    this._clearSelection(); this._selectNode(topic);
                    this.renderer.panTo(topic.x, topic.y); this._openInspector(topic);
                });
                list.appendChild(ti);

                const sub = document.createElement('div');
                sub.className = 'page-sub-items collapsed';

                children.sort((a, b) => {
                    const rA = parseInt(a.properties?.round || '99');
                    const rB = parseInt(b.properties?.round || '99');
                    if (rA !== rB) return rA - rB;
                    if (a.properties?.type === 'resolution') return 1;
                    if (b.properties?.type === 'resolution') return -1;
                    return (a.properties?.side || '').localeCompare(b.properties?.side || '');
                }).forEach(child => {
                    const isRes = child.properties?.type === 'resolution';
                    const side = child.properties?.side;
                    const round = child.properties?.round;
                    const label = isRes ? 'Resolution' : `R${round} \u00B7 ${side}`;
                    const ind = isRes ? '\u25C6' : (side === 'A' ? '<span style="color:#E0866E">A</span>' : '<span style="color:#7EAAE2">B</span>');

                    const si = document.createElement('div');
                    si.className = 'page-item page-sub-item' + (this.selectedNodes.has(child.id) ? ' active' : '');
                    si.innerHTML = `<span class="page-sub-indicator">${ind}</span><span class="page-item-label">${label}</span>`;
                    si.addEventListener('click', () => {
                        this._clearSelection(); this._selectNode(child);
                        this.renderer.panTo(child.x, child.y); this._openInspector(child);
                    });
                    sub.appendChild(si);
                });

                list.appendChild(sub);

                const tog = ti.querySelector('.page-item-toggle');
                if (tog) {
                    tog.addEventListener('click', (e) => {
                        e.stopPropagation();
                        sub.classList.toggle('collapsed');
                        tog.textContent = sub.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
                    });
                }
            });

            section.appendChild(hdr);
            section.appendChild(list);
            container.appendChild(section);
        }

        // === Render Standalone by Type ===
        const groups = {};
        for (const [type, typeDef] of Object.entries(NexusModel.NODE_TYPES)) {
            groups[type] = { typeDef, nodes: [] };
        }
        standaloneNodes.forEach(n => { if (groups[n.type]) groups[n.type].nodes.push(n); });

        for (const [type, group] of Object.entries(groups)) {
            if (group.nodes.length === 0) continue;

            const groupEl = document.createElement('div');
            groupEl.className = 'pages-type-group';

            const header = document.createElement('div');
            header.className = 'pages-type-header';
            header.innerHTML = `<span class="pages-type-chevron">\u25BC</span><span class="pages-type-dot" style="background:${group.typeDef.color}"></span><span class="pages-type-label">${group.typeDef.label.toUpperCase()}</span><span class="pages-type-count">${group.nodes.length}</span>`;
            header.addEventListener('click', () => header.classList.toggle('collapsed'));

            const items = document.createElement('div');
            items.className = 'pages-type-items';

            group.nodes.sort((a, b) => a.label.localeCompare(b.label)).forEach(n => {
                const item = document.createElement('div');
                item.className = 'page-item' + (this.selectedNodes.has(n.id) ? ' active' : '');
                item.innerHTML = `<span class="page-item-label">${this._esc(n.label)}</span>`;
                item.dataset.id = n.id;
                item.addEventListener('click', () => {
                    this._clearSelection(); this._selectNode(n);
                    this.renderer.panTo(n.x, n.y); this._openInspector(n);
                });
                items.appendChild(item);
            });

            groupEl.appendChild(header);
            groupEl.appendChild(items);
            container.appendChild(groupEl);
        }
    }

    // ======================== GRAPH HEALTH ========================

    _computeGraphHealth() {
        const nodes = [...this.model.nodes.values()];
        const edges = [...this.model.edges.values()];
        if (nodes.length === 0) return null;

        let score = 100;
        const issues = [];

        // Orphan nodes (no edges)
        const connectedIds = new Set();
        edges.forEach(e => { connectedIds.add(e.from); connectedIds.add(e.to); });
        const orphans = nodes.filter(n => !connectedIds.has(n.id));
        const orphanRatio = orphans.length / nodes.length;
        if (orphanRatio > 0.3) {
            score -= Math.round(orphanRatio * 20);
            issues.push(`${orphans.length} orphan nodes`);
        }

        // Unresolved conjectures
        const conjectures = nodes.filter(n => n.epistemicStatus === 'conjecture' && n.content.length > 0);
        const conjRatio = conjectures.length / Math.max(1, nodes.filter(n => n.content.length > 0).length);
        if (conjRatio > 0.5) {
            score -= Math.round(conjRatio * 15);
            issues.push(`${conjectures.length} unresolved conjectures`);
        }

        // Falsified but not flagged
        const falsified = nodes.filter(n => n.epistemicStatus === 'falsified');
        // Check if falsified nodes' dependents are updated
        falsified.forEach(fn => {
            edges.forEach(e => {
                if (e.from === fn.id && e.label === 'depends-on') {
                    const dep = this.model.nodes.get(e.to);
                    if (dep && dep.epistemicStatus !== 'contested' && dep.epistemicStatus !== 'falsified') {
                        score -= 5;
                        issues.push(`${dep.label} depends on falsified claim`);
                    }
                }
            });
        });

        // Empty content ratio
        const emptyContent = nodes.filter(n => !n.content || n.content.trim().length === 0);
        const emptyRatio = emptyContent.length / nodes.length;
        if (emptyRatio > 0.5) {
            score -= Math.round(emptyRatio * 10);
        }

        // Falsification coverage
        const substantive = nodes.filter(n => n.content.length > 50);
        const withFalsification = substantive.filter(n => n.falsificationCondition && n.falsificationCondition.length > 0);
        const falsifyCoverage = substantive.length > 0 ? withFalsification.length / substantive.length : 1;
        if (falsifyCoverage < 0.2 && substantive.length > 3) {
            score -= 10;
            issues.push('Low falsification coverage');
        }

        score = Math.max(0, Math.min(100, score));

        return { score, issues, stats: {
            total: nodes.length,
            edges: edges.length,
            orphans: orphans.length,
            conjectures: conjectures.length,
            established: nodes.filter(n => n.epistemicStatus === 'established').length,
            falsified: falsified.length,
        }};
    }

    _updateHealthIndicator() {
        const indicator = document.getElementById('graph-health');
        if (!indicator) return;

        const health = this._computeGraphHealth();
        if (!health) {
            indicator.textContent = '';
            return;
        }

        const color = health.score >= 80 ? '#33bb55' : health.score >= 50 ? '#cc8833' : '#cc3333';
        indicator.innerHTML = `<span style="color:${color}">◉ ${health.score}</span> <span class="health-stats">${health.stats.total}N · ${health.stats.edges}E · ${health.stats.established}✓ · ${health.stats.falsified}✗</span>`;
        indicator.title = health.issues.length > 0 ? 'Issues: ' + health.issues.join(', ') : 'Graph is healthy';
    }

    _status(msg, type = '') {
        const container = document.getElementById('status-bar');
        const el = document.createElement('div');
        el.className = 'status-msg' + (type ? ' ' + type : '');
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => el.remove(), 2500);
    }


    // ======================== PERSISTENCE ========================

    _saveToStorage() {
        try {
            localStorage.setItem('nocapybara-model', JSON.stringify(this.model.toJSON()));
        } catch (e) { /* quota exceeded */ }
    }

    _loadFromStorage() {
        try {
            const data = localStorage.getItem('nocapybara-model') || localStorage.getItem('mindmirror-model') || localStorage.getItem('nexus-model');
            if (data) {
                this.model.fromJSON(JSON.parse(data));
                this.renderer.fitView();
            }
        } catch (e) { /* corrupted */ }
    }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
    window.nexus = new ReflectApp();

    // Electron menu integration
    if (window.electronAPI) {
        window.electronAPI.onMenuAction((action, data) => {
            const app = window.nexus;
            switch (action) {
                case 'new':
                    document.getElementById('btn-new').click();
                    break;
                case 'save':
                    app._saveToStorage();
                    app._status('[SAVED]', 'success');
                    break;
                case 'export':
                    document.getElementById('btn-export').click();
                    break;
                case 'import':
                    document.getElementById('btn-import').click();
                    break;
                case 'fit-view':
                    app.renderer.fitView();
                    break;
                case 'zoom-in':
                    app.renderer.setZoom(app.renderer.targetCam.zoom * 1.2);
                    break;
                case 'zoom-out':
                    app.renderer.setZoom(app.renderer.targetCam.zoom * 0.8);
                    break;
                case 'save-to-file':
                    const json = JSON.stringify(app.model.toJSON(), null, 2);
                    window.electronAPI.saveFile(data, json).then(r => {
                        app._status(r.success ? '[SAVED TO FILE]' : '[ERROR: ' + r.error + ']', r.success ? 'success' : 'error');
                    });
                    break;
                case 'open-file':
                    try {
                        app.model.fromJSON(JSON.parse(data));
                        app._clearSelection();
                        app.renderer.fitView();
                        app._status('[FILE OPENED]', 'success');
                    } catch (err) {
                        app._status('[ERROR: ' + err.message + ']', 'error');
                    }
                    break;
            }
        });
    }
});

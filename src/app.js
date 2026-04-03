// ============================================
// REFLECT — Interaction & UI Controller
// ============================================

class ReflectApp {
    constructor() {
        this.model = new NexusModel.WorldModel();
        this.canvas = document.getElementById('graph-canvas');
        this.renderer = new NexusRenderer.GraphRenderer(this.canvas, this.model);

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
        this.debateModelA = 'gemini-2.5-pro';
        this.debateModelB = 'gemini-3-pro-preview';
        this._debateRunning = false;

        // Content state tree: nodeId -> { states: [string], index: number }
        this.contentHistory = new Map();

        // Starred node IDs
        this.starredNodes = new Set(JSON.parse(localStorage.getItem('reflect-starred') || '[]'));

        // Graph type filter
        this.typeFilter = new Set(['idea', 'topic', 'note', 'rule', 'event', 'detail']);
        this.renderer.typeFilter = this.typeFilter;

        this._bindCanvas();
        this._bindUI();
        this._bindKeyboard();

        // Auto-load
        this._loadFromStorage();

        // Auto-save every 5s
        setInterval(() => this._saveToStorage(), 5000);

        // Start render loop
        this.renderer.start();

        // Model change listener
        this.model.onChange(() => {
            this.renderer.markDirty();
            this._updateStats();
            this._updateEmptyState();
            this._renderPagesTree();
            this._renderStarredList();
        });

        this._updateStats();
        this._updateEmptyState();
        this._renderPagesTree();
        this._renderStarredList();
    }

    // ======================== CANVAS EVENTS ========================

    _bindCanvas() {
        const c = this.canvas;
        c.addEventListener('mousedown', e => this._onMouseDown(e));
        c.addEventListener('mousemove', e => this._onMouseMove(e));
        c.addEventListener('mouseup', e => this._onMouseUp(e));
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

        if (e.shiftKey && node) {
            this.dragState = 'connect';
            this.connectFromNode = node;
            this.renderer.pendingConnection = { fromX: node.x, fromY: node.y, toX: node.x, toY: node.y };
            return;
        }

        if (node) {
            if (!e.ctrlKey && !e.metaKey && !node.selected) {
                this._clearSelection();
            }
            this._selectNode(node, true);
            this.dragState = 'move';
            this.dragStart = { x: pos.x, y: pos.y };
            this.canvas.style.cursor = 'move';
            return;
        }

        const edge = this.renderer.edgeAtScreen(pos.x, pos.y);
        if (edge) {
            this._clearSelection();
            this._selectEdge(edge);
            return;
        }

        if (!e.ctrlKey && !e.metaKey) this._clearSelection();
        this.dragState = 'pan';
        this.canvas.style.cursor = 'grabbing';
        this.dragStart = { x: pos.x, y: pos.y };
    }

    _onMouseMove(e) {
        const pos = this._getCanvasPos(e);
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
            this.model.nodes.forEach(n => {
                if (n.x >= topLeft.x && n.x <= bottomRight.x && n.y >= topLeft.y && n.y <= bottomRight.y) {
                    this._selectNode(n, true);
                }
            });
            this.renderer.selectionBox = null;
            this.renderer.markDirty();
        }

        this.dragState = null;
        this.canvas.style.cursor = 'default';
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
        const newNode = this.model.addNode('idea', wp.x, wp.y, '');
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
            // Pinch zoom
            const zoomFactor = e.deltaY > 0 ? 0.97 : 1.03;
            const pos = this._getCanvasPos(e);
            const before = this.renderer.screenToWorld(pos.x, pos.y);
            this.renderer.setZoom(this.renderer.targetCam.zoom * zoomFactor, true);
            const after = this.renderer.screenToWorld(pos.x, pos.y);
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
    }

    _selectNode(node, addToSelection = false) {
        if (!addToSelection) this._clearSelection();
        node.selected = true;
        this.selectedNodes.add(node.id);
        if (this.selectedEdge) { this.selectedEdge.selected = false; this.selectedEdge = null; }
        this.renderer.markDirty();
        this._updateInspector();
        this._openRightPanel();
    }

    _selectEdge(edge) {
        this._clearSelection();
        edge.selected = true;
        this.selectedEdge = edge;
        this.renderer.markDirty();
        this._updateInspector();
        this._openRightPanel();
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
            if (node) this._showNodeInspector(node);
        } else if (this.selectedNodes.size > 1) {
            multiPanel.classList.remove('hidden');
            document.getElementById('multi-count').textContent = this.selectedNodes.size;
        } else if (this.selectedEdge) {
            this._showEdgeInspector(this.selectedEdge);
        } else {
            emptyPanel.classList.remove('hidden');
        }
    }

    _showNodeInspector(node) {
        const panel = document.getElementById('inspector-node');
        panel.classList.remove('hidden');
        document.getElementById('inspector-title').textContent = node.type === 'idea' ? 'PAGE EDITOR' : 'NODE INSPECTOR';

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
            a.download = (this.model.metadata.name || 'reflect-model') + '.json';
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
            const node = this.model.addNode('idea', wp.x, wp.y, 'Untitled Page');
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
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.captureMode = btn.dataset.mode;
                document.getElementById('note-controls').classList.toggle('hidden', btn.dataset.mode !== 'note');
                document.getElementById('debate-controls').classList.toggle('hidden', btn.dataset.mode !== 'debate');
                document.getElementById('thought-input').placeholder =
                    btn.dataset.mode === 'debate' ? 'Enter a debate topic...' : 'Stream of consciousness...';
            });
        });

        // Shared model menu target
        this._modelMenuTarget = 'note'; // 'note', 'a', or 'b'

        document.getElementById('model-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this._modelMenuTarget = 'note';
            modelMenu.classList.toggle('hidden');
        });

        document.getElementById('model-a-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this._modelMenuTarget = 'a';
            modelMenu.classList.toggle('hidden');
        });

        document.getElementById('model-b-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this._modelMenuTarget = 'b';
            modelMenu.classList.toggle('hidden');
        });

        document.querySelectorAll('.thought-popup-item').forEach(item => {
            item.addEventListener('click', () => {
                const model = item.dataset.model;
                const label = item.textContent;

                if (this._modelMenuTarget === 'note') {
                    this.selectedModel = model;
                    modelLabel.textContent = label;
                } else if (this._modelMenuTarget === 'a') {
                    this.debateModelA = model;
                    document.getElementById('model-a-label').textContent = '🔴 A: ' + label.replace(/[◆⚡◇○◈]\s*/, '');
                } else if (this._modelMenuTarget === 'b') {
                    this.debateModelB = model;
                    document.getElementById('model-b-label').textContent = '🔵 B: ' + label.replace(/[◆⚡◇○◈]\s*/, '');
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
            localStorage.setItem('reflect-starred', JSON.stringify([...this.starredNodes]));
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

    // ======================== THOUGHT CAPTURE ========================

    async _captureThought() {
        const input = document.getElementById('thought-input');
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        input.style.height = 'auto';

        if (this.captureMode === 'debate') {
            this._startDebate(text);
            return;
        }

        const wp = this.renderer.screenToWorld(this.renderer.viewW / 2, this.renderer.viewH / 2);
        wp.x += (Math.random() - 0.5) * 200;
        wp.y += (Math.random() - 0.5) * 200;

        const tempLabel = text.split('\n')[0].slice(0, 40) + (text.length > 40 ? '…' : '');
        const node = this.model.addNode('idea', wp.x, wp.y, tempLabel);
        node.content = text;

        this._clearSelection();
        this._selectNode(node);
        this._status('[THOUGHT CAPTURED]');

        if (window.electronAPI && window.electronAPI.geminiRequest) {
            this._aiGenerateTitle(node, text);
        }
    }

    async _aiGenerateTitle(node, text) {
        if (!window.electronAPI || !window.electronAPI.geminiStream) return;

        const prompt = `You are a knowledge structuring assistant. Given a stream-of-consciousness thought, populate ALL fields for a knowledge node.

Return your response in EXACTLY this format (every field required):
TITLE: <concise 3-6 word title>
TYPE: <one of: idea, topic, note, rule, event, detail>
DESCRIPTION: <1-2 sentence summary>
PROPERTIES: <key=value pairs, comma separated, e.g. domain=physics, complexity=high, related_to=quantum mechanics>
---
<expanded content: well-structured page with key points, implications, connections to explore. 3-8 paragraphs, plain text, no markdown headers. Be specific and factual.>

Type definitions:
- idea: abstract thoughts, theories, principles, concepts
- topic: concrete things, people, places, systems, subjects
- note: general observations, status updates, reflections
- rule: laws, constraints, guidelines, if-then relationships
- event: occurrences, actions, triggers, things that happen
- detail: specific facts, measurements, data points, attributes

Thought: "${text.replace(/"/g, '\\"')}"`;

        this._status('[STREAMING...]');
        node._loading = true;
        this.renderer.markDirty();
        let fullResponse = '';
        let headerParsed = false;
        let contentStartIdx = -1;

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
                    const validTypes = ['idea', 'topic', 'note', 'rule', 'event', 'detail'];
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

            // Stream content into textarea
            if (headerParsed) {
                const contentSoFar = fullResponse.slice(contentStartIdx).trimStart();
                node.content = text + '\n\n— — —\n\n' + contentSoFar;
                if (this.selectedNodes.has(node.id)) {
                    const el = document.getElementById('node-content');
                    if (el) {
                        el.value = node.content;
                        el.scrollTop = el.scrollHeight;
                    }
                }
            }
        });

        window.electronAPI.onStreamDone(() => {
            node._loading = false;
            this._pushContentState(node, node.content);
            this.renderer.markDirty();
            this._renderPagesTree();
            this._status('[THOUGHT EXPANDED]', 'success');
            window.electronAPI.removeStreamListeners();
        });

        window.electronAPI.onStreamError((err) => {
            node._loading = false;
            this.renderer.markDirty();
            this._status('[AI ERROR: ' + err + ']', 'error');
            window.electronAPI.removeStreamListeners();
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
        statusEl.textContent = '[STREAMING...]';
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
            this._pushContentState(node, node.content);
            statusEl.textContent = '[REFRESHED]';
            statusEl.className = 'content-status';
            setTimeout(() => { statusEl.textContent = ''; }, 2000);
            this._status('[CONTENT REFRESHED]', 'success');
            window.electronAPI.removeStreamListeners();
        });

        window.electronAPI.onStreamError((err) => {
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
            const contentLower = (other.content || '').toLowerCase();
            const notesLower = (other.notes || '').toLowerCase();

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
        const headings = [];
        content.split('\n').forEach((line, i) => {
            const m3 = line.match(/^### (.+)/);
            const m2 = line.match(/^## (.+)/);
            const m1 = line.match(/^# (.+)/);
            if (m1) headings.push({ level: 1, text: m1[1], line: i });
            else if (m2) headings.push({ level: 2, text: m2[1], line: i });
            else if (m3) headings.push({ level: 3, text: m3[1], line: i });
        });

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
        // Escape HTML
        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Embeds ![[Node Name]] — only if not too deep (prevent infinite recursion)
        if (depth < 2) {
            html = html.replace(/!\[\[([^\]]+)\]\]/g, (_, name) => {
                const target = this._findNodeByLabel(name);
                if (target && target.content) {
                    const innerHtml = this._renderMarkdown(target.content, depth + 1);
                    return `<div class="embed-block"><div class="embed-title">⊞ ${this._esc(name)}</div><div class="embed-content">${innerHtml}</div></div>`;
                }
                return `<div class="embed-block"><div class="embed-title">⊞ ${this._esc(name)} (not found)</div></div>`;
            });
        }

        // Wiki links [[Node Name]]
        html = html.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
            const exists = this._findNodeByLabel(name);
            return `<span class="wiki-link${exists ? '' : ' wiki-link-missing'}" data-target="${name}">[[${name}]]</span>`;
        });

        // Tags #tag
        html = html.replace(/(^|\s)#([a-zA-Z0-9_-]+)/g, (_, pre, tag) => {
            return `${pre}<span class="tag-link" data-tag="#${tag}">#${tag}</span>`;
        });

        // Headings
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Bold and italic
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Horizontal rule
        html = html.replace(/^---$/gm, '<hr>');

        // Checkboxes
        html = html.replace(/^- \[x\] (.+)$/gm, '<li class="checkbox checked">☑ $1</li>');
        html = html.replace(/^- \[ \] (.+)$/gm, '<li class="checkbox">☐ $1</li>');

        // Unordered lists
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Line breaks (preserve double newlines as paragraphs)
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');
        html = '<p>' + html + '</p>';

        // Clean up empty paragraphs
        html = html.replace(/<p><\/p>/g, '');
        html = html.replace(/<p>(<h[1-3]>)/g, '$1');
        html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)<\/p>/g, '$1');
        html = html.replace(/<p>(<hr>)<\/p>/g, '$1');

        return html;
    }

    _findNodeByLabel(label) {
        const lower = label.toLowerCase();
        for (const node of this.model.nodes.values()) {
            if (node.label.toLowerCase() === lower) return node;
        }
        return null;
    }

    // ======================== DEBATE ENGINE ========================

    async _startDebate(topic) {
        if (this._debateRunning) {
            this._status('[DEBATE ALREADY RUNNING]');
            return;
        }
        if (!window.electronAPI || !window.electronAPI.geminiRequest) {
            this._status('[NO AI AVAILABLE]');
            return;
        }

        this._debateRunning = true;
        const rounds = parseInt(document.getElementById('debate-rounds').value) || 5;

        // Create the topic node at center
        const wp = this.renderer.screenToWorld(this.renderer.viewW / 2, this.renderer.viewH / 2);
        const topicNode = this.model.addNode('topic', wp.x, wp.y - 120, topic);
        topicNode.description = 'Debate topic';
        topicNode.properties = {
            mode: 'debate',
            model_a: this.debateModelA,
            model_b: this.debateModelB,
            rounds: rounds.toString()
        };
        topicNode._loading = true;
        this.renderer.markDirty();

        this._clearSelection();
        this._selectNode(topicNode);
        this._status(`[DEBATE: ${rounds} ROUNDS]`);

        const history = [];
        let lastNodeA = topicNode;
        let lastNodeB = topicNode;

        try {
            for (let round = 1; round <= rounds; round++) {
                this._status(`[ROUND ${round}/${rounds} — MODEL A]`);

                // Model A argues
                const promptA = this._buildDebatePrompt(topic, history, 'A', round, rounds);
                const responseA = await window.electronAPI.geminiRequest(promptA, this.debateModelA);

                const nodeA = this.model.addNode('idea', wp.x - 160, wp.y + round * 120, `R${round} — A`);
                nodeA.label = `Round ${round}: Model A`;
                nodeA.description = `${this.debateModelA} — Round ${round}`;
                nodeA.content = responseA;
                nodeA.properties = { side: 'A', round: round.toString(), model: this.debateModelA };

                // Edge from previous to this
                this.model.addEdge(lastNodeA.id, nodeA.id, round === 1 ? 'opens' : 'responds');
                lastNodeA = nodeA;

                history.push({ role: 'A', round, content: responseA });
                this.renderer.markDirty();

                // Model B argues
                this._status(`[ROUND ${round}/${rounds} — MODEL B]`);
                const promptB = this._buildDebatePrompt(topic, history, 'B', round, rounds);
                const responseB = await window.electronAPI.geminiRequest(promptB, this.debateModelB);

                const nodeB = this.model.addNode('idea', wp.x + 160, wp.y + round * 120, `R${round} — B`);
                nodeB.label = `Round ${round}: Model B`;
                nodeB.description = `${this.debateModelB} — Round ${round}`;
                nodeB.content = responseB;
                nodeB.properties = { side: 'B', round: round.toString(), model: this.debateModelB };

                // Edge from previous B to this B, and cross-edge from A to B
                this.model.addEdge(lastNodeB.id, nodeB.id, round === 1 ? 'opens' : 'responds');
                this.model.addEdge(nodeA.id, nodeB.id, `counters`);
                lastNodeB = nodeB;

                history.push({ role: 'B', round, content: responseB });
                this.renderer.markDirty();
            }

            // RESOLUTION: Both models have argued. Now synthesize.
            this._status('[SYNTHESIZING RESOLUTION...]');

            const resolutionPrompt = this._buildResolutionPrompt(topic, history);
            const resolution = await window.electronAPI.geminiRequest(resolutionPrompt, this.debateModelA);

            const resNode = this.model.addNode('rule', wp.x, wp.y + (rounds + 1) * 120, 'Resolution');
            resNode.label = `Resolution: ${topic.slice(0, 30)}`;
            resNode.description = `Fundamental truth document — ${rounds} rounds of debate`;
            resNode.content = resolution;
            resNode.properties = {
                type: 'resolution',
                model_a: this.debateModelA,
                model_b: this.debateModelB,
                rounds: rounds.toString(),
                topic: topic
            };

            // Connect last A and B to resolution
            this.model.addEdge(lastNodeA.id, resNode.id, 'synthesizes');
            this.model.addEdge(lastNodeB.id, resNode.id, 'synthesizes');
            this.model.addEdge(topicNode.id, resNode.id, 'resolves');

            topicNode._loading = false;
            topicNode.content = `# Debate: ${topic}\n\nModels: ${this.debateModelA} vs ${this.debateModelB}\nRounds: ${rounds}\n\nSee [[Resolution: ${topic.slice(0, 30)}]] for the final truth document.`;
            this.renderer.markDirty();

            this._clearSelection();
            this._selectNode(resNode);
            this._openInspector(resNode);
            this.renderer.panTo(resNode.x, resNode.y);
            this._status('[DEBATE RESOLVED]', 'success');

        } catch (err) {
            topicNode._loading = false;
            this._status('[DEBATE ERROR: ' + err.message + ']');
            console.error('Debate error:', err);
        }

        this._debateRunning = false;
    }

    _buildDebatePrompt(topic, history, side, round, totalRounds) {
        const opponent = side === 'A' ? 'B' : 'A';
        let context = `You are Debater ${side} in an intellectual debate. The topic is:\n\n"${topic}"\n\n`;

        if (history.length > 0) {
            context += `Previous arguments:\n\n`;
            history.forEach(h => {
                context += `--- ${h.role === side ? 'YOUR' : 'OPPONENT'} (Round ${h.round}) ---\n${h.content}\n\n`;
            });
        }

        if (round === 1) {
            context += `This is Round 1 of ${totalRounds}. Present your opening argument. Be substantive, cite reasoning, and stake out a clear position. 3-5 paragraphs.`;
        } else if (round === totalRounds) {
            context += `This is the FINAL round (${round}/${totalRounds}). You must now identify areas of genuine agreement with your opponent while maintaining intellectual honesty about remaining disagreements. Focus on convergence toward truth. 3-5 paragraphs.`;
        } else {
            context += `This is Round ${round} of ${totalRounds}. Directly respond to your opponent's latest argument. Acknowledge valid points, challenge weak ones, refine your position. Be rigorous but fair. 3-5 paragraphs.`;
        }

        return context;
    }

    _buildResolutionPrompt(topic, history) {
        let prompt = `You are a neutral synthesizer. Two AI models have debated the following topic:\n\n"${topic}"\n\nHere is the complete debate transcript:\n\n`;

        history.forEach(h => {
            prompt += `=== DEBATER ${h.role} — ROUND ${h.round} ===\n${h.content}\n\n`;
        });

        prompt += `Now synthesize a FUNDAMENTAL TRUTH DOCUMENT — a resolution that captures:

1. **Core Truth**: What both sides ultimately agree on
2. **Key Insights**: The strongest arguments from each side
3. **Resolved Tensions**: Where seeming disagreements are actually compatible
4. **Remaining Questions**: Genuine open questions that merit further investigation
5. **Conclusion**: A clear, actionable statement of the established truth

Write this as a structured document with clear headings. Be precise, honest, and intellectually rigorous. This document should stand alone as a definitive analysis of the topic. Do NOT hedge unnecessarily — state what is true.`;

        return prompt;
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
        const node = this.model.addNode('event', wp.x, wp.y, label);
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

    // ======================== WORD COUNT ========================

    _updateWordCount(text) {
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
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
    }

    _updateEmptyState() {
        const el = document.getElementById('empty-state');
        if (this.model.nodes.size > 0) el.classList.add('hidden');
        else el.classList.remove('hidden');
    }

    // ======================== PAGES TREE ========================

    _renderPagesTree() {
        const container = document.getElementById('pages-tree');
        if (!container) return;
        container.innerHTML = '';

        const groups = {};
        for (const [type, typeDef] of Object.entries(NexusModel.NODE_TYPES)) {
            groups[type] = { typeDef, nodes: [] };
        }
        this.model.nodes.forEach(n => {
            if (groups[n.type]) groups[n.type].nodes.push(n);
        });

        let anyNodes = false;
        for (const [type, group] of Object.entries(groups)) {
            if (group.nodes.length === 0) continue;
            anyNodes = true;

            const groupEl = document.createElement('div');
            groupEl.className = 'pages-type-group';

            const header = document.createElement('div');
            header.className = 'pages-type-header';
            header.innerHTML = `
                <span class="pages-type-chevron">▼</span>
                <span class="pages-type-dot" style="background:${group.typeDef.color}"></span>
                <span class="pages-type-label">${group.typeDef.label.toUpperCase()}</span>
                <span class="pages-type-count">${group.nodes.length}</span>
            `;
            header.addEventListener('click', () => header.classList.toggle('collapsed'));

            const items = document.createElement('div');
            items.className = 'pages-type-items';

            group.nodes.sort((a, b) => a.label.localeCompare(b.label)).forEach(n => {
                const item = document.createElement('div');
                item.className = 'page-item' + (this.selectedNodes.has(n.id) ? ' active' : '');
                item.innerHTML = `<span class="page-item-label">${this._esc(n.label)}</span>`;
                item.dataset.id = n.id;
                item.draggable = true;

                item.addEventListener('click', () => {
                    this._clearSelection();
                    this._selectNode(n);
                    this.renderer.panTo(n.x, n.y);
                    this._openInspector(n);
                });

                // Drag reorder
                item.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', n.id);
                    item.classList.add('dragging');
                });
                item.addEventListener('dragend', () => {
                    item.classList.remove('dragging');
                    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                });
                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    item.classList.add('drag-over');
                });
                item.addEventListener('dragleave', () => {
                    item.classList.remove('drag-over');
                });
                item.addEventListener('drop', (e) => {
                    e.preventDefault();
                    item.classList.remove('drag-over');
                    const fromId = e.dataTransfer.getData('text/plain');
                    const fromNode = this.model.nodes.get(fromId);
                    if (fromNode && fromNode.id !== n.id) {
                        // Swap positions on canvas
                        const tx = fromNode.x, ty = fromNode.y;
                        fromNode.x = n.x; fromNode.y = n.y;
                        n.x = tx; n.y = ty;
                        this.renderer.markDirty();
                        this._renderPagesTree();
                    }
                });

                items.appendChild(item);
            });

            groupEl.appendChild(header);
            groupEl.appendChild(items);
            container.appendChild(groupEl);
        }

        if (!anyNodes) {
            container.innerHTML = '<div class="pages-empty">[ NO PAGES ]<br>Double-click the canvas or use + NEW PAGE</div>';
        }
    }

    _status(msg, type = '') {
        const container = document.getElementById('status-bar');
        const el = document.createElement('div');
        el.className = 'status-msg' + (type ? ' ' + type : '');
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => el.remove(), 2500);
    }

    _esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ======================== PERSISTENCE ========================

    _saveToStorage() {
        try {
            localStorage.setItem('reflect-model', JSON.stringify(this.model.toJSON()));
        } catch (e) { /* quota exceeded */ }
    }

    _loadFromStorage() {
        try {
            const data = localStorage.getItem('reflect-model') || localStorage.getItem('mindmirror-model') || localStorage.getItem('nexus-model');
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

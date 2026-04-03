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
        });

        this._updateStats();
        this._updateEmptyState();
        this._renderPagesTree();
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
            if (!e.target.closest('.context-menu')) this._hideAllContextMenus();
        });
    }

    _getCanvasPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _onMouseDown(e) {
        const pos = this._getCanvasPos(e);
        this.lastMouse = pos;
        this._hideAllContextMenus();

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
        const newNode = this.model.addNode('concept', wp.x, wp.y, '');
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
        // Two-finger pan (trackpad) vs pinch zoom
        if (e.ctrlKey) {
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
            this.renderer.pan(e.deltaX / this.renderer.cam.zoom, e.deltaY / this.renderer.cam.zoom);
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
        document.getElementById('inspector-title').textContent = node.type === 'concept' ? 'PAGE EDITOR' : 'NODE INSPECTOR';

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
        contentInput.oninput = () => { node.content = contentInput.value; };
        notesInput.oninput = update;
        layerSelect.onchange = update;
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
            const q = searchInput.value.trim();
            if (!q) { this._clearSearch(); return; }
            const results = this.model.search(q);
            this._clearSelection();
            results.forEach(n => this._selectNode(n, true));
            if (results.length === 1) this.renderer.panTo(results[0].x, results[0].y);
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
            const node = this.model.addNode('concept', wp.x, wp.y, 'Untitled Page');
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

        // Modal
        document.getElementById('modal-cancel').addEventListener('click', () => this._hideModal());
        document.getElementById('modal-confirm').addEventListener('click', () => this._confirmModal());
        document.getElementById('modal-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') this._confirmModal();
            if (e.key === 'Escape') this._hideModal();
        });
    }

    _bindKeyboard() {
        document.addEventListener('keydown', e => {
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

        const wp = this.renderer.screenToWorld(this.renderer.viewW / 2, this.renderer.viewH / 2);
        wp.x += (Math.random() - 0.5) * 200;
        wp.y += (Math.random() - 0.5) * 200;

        const tempLabel = text.split('\n')[0].slice(0, 40) + (text.length > 40 ? '…' : '');
        const node = this.model.addNode('concept', wp.x, wp.y, tempLabel);
        node.content = text;

        this._clearSelection();
        this._selectNode(node);
        this._status('[THOUGHT CAPTURED]');

        if (window.electronAPI && window.electronAPI.geminiRequest) {
            this._aiGenerateTitle(node, text);
        }
    }

    async _aiGenerateTitle(node, text) {
        try {
            const prompt = `Given this stream-of-consciousness thought, generate a concise 3-6 word title that captures its core idea. Return ONLY the title, nothing else.\n\nThought: "${text}"`;
            const result = await window.electronAPI.geminiRequest(prompt);
            if (result.text && !result.error) {
                const title = result.text.trim().replace(/^["']|["']$/g, '');
                if (title && title.length < 80) {
                    node.label = title;
                    this.renderer.markDirty();
                    this._renderPagesTree();
                    if (this.selectedNodes.has(node.id)) {
                        const labelInput = document.getElementById('node-label');
                        if (labelInput) labelInput.value = title;
                    }
                }
            }
        } catch (e) { /* silent fail */ }
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
                item.addEventListener('click', () => {
                    this._clearSelection();
                    this._selectNode(n);
                    this.renderer.panTo(n.x, n.y);
                    this._openInspector(n);
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

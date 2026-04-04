// ============================================
// NOCAPYBARA — Unified Node Detail Modal
// ============================================
// Linear-style modal that merges inspector + page view.
// Delegates to the main app for data operations.

const NodeDetailModal = (() => {

    let _app = null; // reference to ReflectApp
    let _currentNodeId = null;

    function init(app) {
        _app = app;
        _bindEvents();
    }

    function _el(id) { return document.getElementById(id); }

    function _bindEvents() {
        // Close
        _el('ndm-close').onclick = close;
        // Close when clicking the overlay background (outside the modal panel)
        const overlay = _el('node-detail-overlay');
        if (overlay) overlay.onclick = (e) => { if (e.target === overlay) close(); };

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !_el('node-detail-overlay').classList.contains('hidden')) {
                close();
                e.stopPropagation();
            }
        });

        // Click rendered view to switch to edit mode
        _el('ndm-content-rendered').onclick = () => _switchToEditMode();

        // Title
        _el('ndm-title').oninput = (e) => {
            const node = _getNode();
            if (!node) return;
            node.label = e.target.value;
            _app.renderer.markDirty();
            _app._renderPagesTree();
        };

        // Type
        _el('ndm-type-select').onchange = (e) => {
            const node = _getNode();
            if (!node) return;
            node.type = e.target.value;
            _app.renderer.markDirty();
            _app._renderPagesTree();
            _syncTypeBadgeColor();
        };

        // Description
        _el('ndm-description').oninput = (e) => {
            const node = _getNode();
            if (node) node.description = e.target.value;
        };

        // Content
        const contentEl = _el('ndm-content');
        contentEl.oninput = (e) => {
            const node = _getNode();
            if (!node) return;
            node.content = e.target.value;
            _updateWordCount(e.target.value);
            _app._handleWikiAutocomplete && _app._handleWikiAutocomplete(contentEl);
        };
        contentEl.onkeydown = (e) => {
            if (_app._handleWikiKeydown) _app._handleWikiKeydown(e, contentEl);
        };
        contentEl.onblur = () => {
            const node = _getNode();
            if (node) {
                _app._pushContentState(node, node.content);
                _switchToRenderedView();
            }
        };

        // Notes
        _el('ndm-notes').oninput = (e) => {
            const node = _getNode();
            if (node) node.notes = e.target.value;
        };

        // Undo/Redo
        _el('ndm-undo').onclick = () => {
            const node = _getNode();
            if (!node) return;
            const content = _app._undoContent(node);
            if (content !== null) {
                node.content = content;
                _el('ndm-content').value = content;
                _updateWordCount(content);
                _updateHistoryUI(node);
            }
        };
        _el('ndm-redo').onclick = () => {
            const node = _getNode();
            if (!node) return;
            const content = _app._redoContent(node);
            if (content !== null) {
                node.content = content;
                _el('ndm-content').value = content;
                _updateWordCount(content);
                _updateHistoryUI(node);
            }
        };

        // AI Refresh
        _el('ndm-refresh').onclick = () => {
            const node = _getNode();
            if (!node) return;
            _el('ndm-content-status').textContent = '[STREAMING...]';
            _app.ai.refreshContent(node,
                (streamed) => {
                    if (_currentNodeId === node.id) {
                        _el('ndm-content').value = node.content;
                        _el('ndm-content').scrollTop = _el('ndm-content').scrollHeight;
                    }
                },
                () => {
                    _app._pushContentState(node, node.content);
                    _el('ndm-content-status').textContent = '[REFRESHED]';
                    _updateWordCount(node.content);
                    _updateHistoryUI(node);
                    setTimeout(() => { _el('ndm-content-status').textContent = ''; }, 2000);
                },
                (err) => {
                    _el('ndm-content-status').textContent = '[ERROR: ' + err + ']';
                }
            );
        };

        // Star
        _el('ndm-star').onclick = () => {
            const node = _getNode();
            if (!node) return;
            if (_app.starredNodes.has(node.id)) {
                _app.starredNodes.delete(node.id);
                _el('ndm-star').textContent = '☆';
            } else {
                _app.starredNodes.add(node.id);
                _el('ndm-star').textContent = '★';
            }
            _app._renderStarredList();
        };

        // Export MD
        _el('ndm-export').onclick = () => {
            _app._exportMarkdown();
        };

        // Delete
        _el('ndm-delete').onclick = () => {
            const node = _getNode();
            if (!node) return;
            _app.model.removeNode(node.id);
            _app.selectedNodes.delete(node.id);
            _app.renderer.markDirty();
            _app._renderPagesTree();
            _app._updateStats();
            close();
        };

        // Add property
        _el('ndm-add-prop').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const node = _getNode();
            if (!node) return;
            node.properties['key'] = 'value';
            _renderProperties(node);
        };

        // Layer
        _el('ndm-layer-select').onchange = (e) => {
            const node = _getNode();
            if (node) {
                node.layer = e.target.value;
                _app.renderer.markDirty();
            }
        };
    }

    function _getNode() {
        if (!_currentNodeId) return null;
        return _app.model.nodes.get(_currentNodeId);
    }

    function open(node) {
        _currentNodeId = node.id;

        // Populate fields
        _el('ndm-title').value = node.label;
        _el('ndm-type-select').value = node.type;
        _el('ndm-description').value = node.description || '';
        _el('ndm-content').value = node.content || '';
        _el('ndm-notes').value = node.notes || '';
        _el('ndm-star').textContent = _app.starredNodes.has(node.id) ? '★' : '☆';

        _syncTypeBadgeColor();
        _updateWordCount(node.content);

        // Init content history
        _app._initContentHistory(node);
        _updateHistoryUI(node);

        // Show rendered markdown view by default
        _switchToRenderedView();

        // Render sub-sections
        _renderProperties(node);
        _renderConnections(node);
        _renderBacklinks(node);
        _renderEpistemics(node);
        _populateLayers(node);

        // Clear status
        _el('ndm-content-status').textContent = '';
        _el('ndm-status').textContent = '';

        // Show
        _el('node-detail-overlay').classList.remove('hidden');
    }

    function close() {
        _el('node-detail-overlay').classList.add('hidden');
        _currentNodeId = null;
    }

    function isOpen() {
        return !_el('node-detail-overlay').classList.contains('hidden');
    }

    function getCurrentNodeId() { return _currentNodeId; }

    // — Sync helpers —

    function _syncTypeBadgeColor() {
        const node = _getNode();
        if (!node) return;
        const typeDef = NexusModel.NODE_TYPES[node.type];
        if (typeDef) {
            _el('ndm-type-select').style.borderColor = typeDef.color;
            _el('ndm-type-select').style.color = typeDef.color;
        }
    }

    function _updateWordCount(text) {
        const str = String(text || '');
        const words = str.trim() ? str.trim().split(/\s+/).length : 0;
        _el('ndm-word-count').textContent = `${words} WORDS`;
    }

    function _updateHistoryUI(node) {
        const h = _app.contentHistory.get(node.id);
        if (h) {
            _el('ndm-history-label').textContent = `STATE ${h.index + 1}/${h.states.length}`;
            _el('ndm-undo').style.opacity = h.index > 0 ? '1' : '0.3';
            _el('ndm-redo').style.opacity = h.index < h.states.length - 1 ? '1' : '0.3';
        }
    }

    function _renderProperties(node) {
        const container = _el('ndm-properties-list');
        const keys = Object.keys(node.properties || {}).filter(k => !k.startsWith('_'));
        if (keys.length === 0) {
            container.innerHTML = '<div style="color:var(--text-disabled);font-size:12px;padding:4px 0">[ NONE ]</div>';
            return;
        }
        container.innerHTML = keys.map(key => {
            const val = node.properties[key];
            return `<div class="prop-row">
                <input type="text" value="${_esc(key)}" placeholder="Key" class="prop-key">
                <input type="text" value="${_esc(String(val))}" placeholder="Value" class="prop-val">
                <button class="btn-remove-prop" data-key="${_esc(key)}">×</button>
            </div>`;
        }).join('');

        container.querySelectorAll('.prop-row').forEach(row => {
            const keyInput = row.querySelector('.prop-key');
            const valInput = row.querySelector('.prop-val');
            const removeBtn = row.querySelector('.btn-remove-prop');
            const origKey = removeBtn.dataset.key;

            const update = () => {
                const newKey = keyInput.value.trim();
                const newVal = valInput.value;
                if (origKey !== newKey) delete node.properties[origKey];
                if (newKey) node.properties[newKey] = newVal;
            };
            keyInput.onblur = update;
            valInput.onblur = update;
            removeBtn.onclick = () => {
                delete node.properties[origKey];
                _renderProperties(node);
            };
        });
    }

    function _renderConnections(node) {
        const container = _el('ndm-connections-list');
        const edges = _app.model.getNodeEdges(node.id);
        if (edges.length === 0) {
            container.innerHTML = '<div style="color:var(--text-disabled);font-size:12px;padding:4px 0">[ NONE ]</div>';
            return;
        }
        container.innerHTML = edges.map(e => {
            const otherId = e.from === node.id ? e.to : e.from;
            const other = _app.model.nodes.get(otherId);
            if (!other) return '';
            const dir = e.from === node.id ? '→' : '←';
            return `<div class="connection-item" data-id="${otherId}">${dir} <span>${_esc(e.label || other.label)}</span></div>`;
        }).join('');

        container.querySelectorAll('.connection-item').forEach(el => {
            el.onclick = () => {
                const target = _app.model.nodes.get(el.dataset.id);
                if (target) {
                    close();
                    _app._jumpToNode(target);
                    setTimeout(() => open(target), 100);
                }
            };
        });
    }

    function _renderBacklinks(node) {
        const container = _el('ndm-backlinks-list');
        const backlinks = [];
        const label = node.label.toLowerCase();

        _app.model.nodes.forEach(other => {
            if (other.id === node.id) return;
            const contentLower = String(other.content || '').toLowerCase();
            const notesLower = String(other.notes || '').toLowerCase();
            if (contentLower.includes(label) || notesLower.includes(label)) {
                backlinks.push(other);
            }
        });

        if (backlinks.length === 0) {
            container.innerHTML = '<div style="color:var(--text-disabled);font-size:12px;padding:4px 0">[ NONE ]</div>';
            return;
        }

        container.innerHTML = backlinks.map(bl =>
            `<div class="backlink-item" data-id="${bl.id}">${_esc(bl.label)}</div>`
        ).join('');

        container.querySelectorAll('.backlink-item').forEach(el => {
            el.onclick = () => {
                const target = _app.model.nodes.get(el.dataset.id);
                if (target) {
                    close();
                    _app._jumpToNode(target);
                    setTimeout(() => open(target), 100);
                }
            };
        });
    }

    function _renderEpistemics(node) {
        const container = _el('ndm-epistemics');
        const statuses = NexusModel.EPISTEMIC_STATUSES;
        if (!statuses) {
            container.innerHTML = '';
            return;
        }
        const currentEpi = statuses[node.epistemicStatus] || statuses.conjecture;
        container.innerHTML = `
            <div class="epistemic-row">
                <label class="epistemic-label">STATUS</label>
                <select id="ndm-ep-status" class="inspector-select">
                    ${Object.entries(statuses).map(([key, val]) =>
                        `<option value="${key}" ${key === node.epistemicStatus ? 'selected' : ''}>${val.label}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="epistemic-row">
                <label class="epistemic-label">CONFIDENCE <span id="ndm-conf-val">${Math.round(node.confidence * 100)}%</span></label>
                <input type="range" id="ndm-conf-slider" class="confidence-slider" min="0" max="100" value="${Math.round(node.confidence * 100)}">
            </div>
            <div class="epistemic-row">
                <label class="epistemic-label">FALSIFICATION</label>
            </div>
            <textarea id="ndm-falsification" class="inspector-textarea" rows="2" placeholder="This claim would be falsified if...">${_esc(node.falsificationCondition || '')}</textarea>
        `;

        _el('ndm-ep-status').onchange = (e) => {
            node.epistemicStatus = e.target.value;
            _app.renderer.markDirty();
        };
        _el('ndm-conf-slider').oninput = (e) => {
            node.confidence = parseInt(e.target.value) / 100;
            _el('ndm-conf-val').textContent = e.target.value + '%';
        };
        _el('ndm-falsification').oninput = (e) => {
            node.falsificationCondition = e.target.value;
        };
    }

    function _populateLayers(node) {
        const select = _el('ndm-layer-select');
        select.innerHTML = _app.model.layers.map(l =>
            `<option value="${l}" ${l === (node.layer || 'Default') ? 'selected' : ''}>${l}</option>`
        ).join('');
    }

    function _esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    /** Refresh modal content if it's open and showing this node */
    function refresh(nodeId) {
        if (_currentNodeId === nodeId && isOpen()) {
            const node = _app.model.nodes.get(nodeId);
            if (node) open(node);
        }
    }

    // — View mode toggles —

    function _switchToRenderedView() {
        const node = _getNode();
        const content = node ? (node.content || '') : '';
        const rendered = _el('ndm-content-rendered');
        const editor = _el('ndm-content');

        if (content.trim()) {
            rendered.innerHTML = _app._renderMarkdown(content);
            rendered.classList.remove('empty-content');
        } else {
            rendered.textContent = '[ Click to start writing... ]';
            rendered.classList.add('empty-content');
        }

        rendered.classList.remove('hidden');
        editor.classList.add('hidden');
    }

    function _switchToEditMode() {
        const rendered = _el('ndm-content-rendered');
        const editor = _el('ndm-content');
        rendered.classList.add('hidden');
        editor.classList.remove('hidden');
        editor.focus();
    }

    return { init, open, close, isOpen, getCurrentNodeId, refresh };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NodeDetailModal;
} else {
    window.NodeDetailModal = NodeDetailModal;
}

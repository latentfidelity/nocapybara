// ============================================
// NOCAPYBARA — Point Cloud Renderer
// ============================================

class GraphRenderer {
    constructor(canvas, model) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.model = model;
        this.dpr = window.devicePixelRatio || 1;

        // Camera
        this.cam = { x: 0, y: 0, zoom: 1 };
        this.targetCam = { x: 0, y: 0, zoom: 1 };

        // Grid
        this.gridSize = 40;

        // Animation
        this._raf = null;
        this._dirty = true;

        // Physics
        this.physicsEnabled = true;
        this._physicsStrength = 0.8; // 0-1
        this._draggedNode = null; // skip physics on dragged node

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width * this.dpr;
        this.canvas.height = rect.height * this.dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.viewW = rect.width;
        this.viewH = rect.height;
        this.markDirty();
    }

    markDirty() { this._dirty = true; }

    start() {
        const loop = () => {
            this._raf = requestAnimationFrame(loop);
            this._animateCamera();
            if (this.physicsEnabled) this._simulateForces();
            if (this._dirty) {
                this._dirty = false;
                this._render();
            }
        };
        loop();
    }

    stop() {
        if (this._raf) cancelAnimationFrame(this._raf);
    }

    // Camera
    _animateCamera() {
        const lerp = 0.15;
        const dx = this.targetCam.x - this.cam.x;
        const dy = this.targetCam.y - this.cam.y;
        const dz = this.targetCam.zoom - this.cam.zoom;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1 || Math.abs(dz) > 0.001) {
            this.cam.x += dx * lerp;
            this.cam.y += dy * lerp;
            this.cam.zoom += dz * lerp;
            this._dirty = true;
        } else {
            this.cam.x = this.targetCam.x;
            this.cam.y = this.targetCam.y;
            this.cam.zoom = this.targetCam.zoom;
        }
    }

    setZoom(z, instant = false) {
        this.targetCam.zoom = Math.max(0.1, Math.min(4, z));
        if (instant) this.cam.zoom = this.targetCam.zoom;
        this.markDirty();
    }

    pan(dx, dy) {
        this.targetCam.x += dx;
        this.targetCam.y += dy;
        this.cam.x += dx;
        this.cam.y += dy;
        this.markDirty();
    }

    panTo(x, y, instant = false) {
        this.targetCam.x = x - this.viewW / 2 / this.cam.zoom;
        this.targetCam.y = y - this.viewH / 2 / this.cam.zoom;
        if (instant) { this.cam.x = this.targetCam.x; this.cam.y = this.targetCam.y; }
        this.markDirty();
    }

    fitView() {
        const nodes = [...this.model.nodes.values()];
        if (nodes.length === 0) {
            this.targetCam = { x: 0, y: 0, zoom: 1 };
            this.markDirty();
            return;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            minX = Math.min(minX, n.x - 60);
            minY = Math.min(minY, n.y - 60);
            maxX = Math.max(maxX, n.x + 60);
            maxY = Math.max(maxY, n.y + 60);
        });
        const pad = 100;
        const w = maxX - minX + pad * 2;
        const h = maxY - minY + pad * 2;
        const zoom = Math.min(this.viewW / w, this.viewH / h, 2);
        this.targetCam.zoom = zoom;
        this.targetCam.x = minX - pad + (w - this.viewW / zoom) / 2;
        this.targetCam.y = minY - pad + (h - this.viewH / zoom) / 2;
        this.markDirty();
    }

    // Coordinate transforms
    screenToWorld(sx, sy) {
        return {
            x: sx / this.cam.zoom + this.cam.x,
            y: sy / this.cam.zoom + this.cam.y
        };
    }

    worldToScreen(wx, wy) {
        return {
            x: (wx - this.cam.x) * this.cam.zoom,
            y: (wy - this.cam.y) * this.cam.zoom
        };
    }

    // Hit testing
    nodeAtScreen(sx, sy) {
        const { x, y } = this.screenToWorld(sx, sy);
        return this.nodeAtWorld(x, y);
    }

    nodeAtWorld(wx, wy) {
        const nodes = [...this.model.nodes.values()].reverse();
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = "500 10px 'Space Grotesk', sans-serif";
        for (const n of nodes) {
            const layer = this.model.layers.find(l => l.id === n.layer);
            if (layer && !layer.visible) continue;
            // Hit test: pill bounding box
            const labelW = tempCtx.measureText(n.label || '').width;
            const pillW = Math.max(labelW + 24, 60);
            const pillH = 28;
            if (wx >= n.x - pillW/2 - 4 && wx <= n.x + pillW/2 + 4 &&
                wy >= n.y - pillH/2 - 4 && wy <= n.y + pillH/2 + 4) {
                return n;
            }
        }
        return null;
    }

    edgeAtScreen(sx, sy) {
        const { x, y } = this.screenToWorld(sx, sy);
        const threshold = 8 / this.cam.zoom;
        for (const e of this.model.edges.values()) {
            const from = this.model.nodes.get(e.from);
            const to = this.model.nodes.get(e.to);
            if (!from || !to) continue;
            const dist = this._pointToSegmentDist(x, y, from.x, from.y, to.x, to.y);
            if (dist < threshold) return e;
        }
        return null;
    }

    _pointToSegmentDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    // ======================== RENDERING ========================

    _render() {
        const ctx = this.ctx;
        const { zoom, x: cx, y: cy } = this.cam;

        ctx.save();
        ctx.clearRect(0, 0, this.viewW, this.viewH);

        // OLED Black background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, this.viewW, this.viewH);

        // Dot grid (Nothing style)
        if (!this.options || this.options.grid) this._drawDotGrid(ctx, cx, cy, zoom);

        // Apply camera
        ctx.save();
        ctx.translate(-cx * zoom, -cy * zoom);
        ctx.scale(zoom, zoom);

        // Draw edges
        if (!this.options || this.options.edges) {
            this.model.edges.forEach(edge => this._drawEdge(ctx, edge));
        }

        // Draw pending connection
        if (this.pendingConnection) {
            const pc = this.pendingConnection;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(pc.fromX, pc.fromY);
            ctx.lineTo(pc.toX, pc.toY);
            ctx.stroke();
            ctx.restore();
        }

        // Draw nodes as point cloud
        this.model.nodes.forEach(node => {
            const layer = this.model.layers.find(l => l.id === node.layer);
            if (layer && !layer.visible) return;
            if (this.typeFilter && !this.typeFilter.has(node.type)) return;
            this._drawNode(ctx, node);
        });

        ctx.restore();

        // Selection box
        if (this.selectionBox) {
            const sb = this.selectionBox;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
            ctx.strokeRect(sb.x, sb.y, sb.w, sb.h);
            ctx.restore();
        }

        // Post-processing: Subtle chromatic aberration / bloom
        // We replicate the canvas lightly with color offsets and 'screen' composite
        if (this.postProcessing !== false) {
            if (!this.ppCanvas) {
                this.ppCanvas = document.createElement('canvas');
                this.ppCtx = this.ppCanvas.getContext('2d', { willReadFrequently: true });
            }
            if (this.ppCanvas.width !== this.canvas.width || this.ppCanvas.height !== this.canvas.height) {
                this.ppCanvas.width = this.canvas.width;
                this.ppCanvas.height = this.canvas.height;
            }
            this.ppCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ppCtx.drawImage(this.canvas, 0, 0);

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = 0.08;
            ctx.drawImage(this.ppCanvas, -2, 0); // Red/left shift
            ctx.drawImage(this.ppCanvas, 2, 0);  // Blue/right shift
            ctx.restore();
        }

        ctx.restore();
    }

    _drawDotGrid(ctx, cx, cy, zoom) {
        // Fade out between zoom 0.5 and 0.2
        const fadeStart = 0.8, fadeEnd = 0.5;
        const fade = zoom >= fadeStart ? 1 : (zoom <= fadeEnd ? 0 : (zoom - fadeEnd) / (fadeStart - fadeEnd));
        if (fade <= 0) return;

        const gs = 40;
        const startX = Math.floor(cx / gs) * gs;
        const startY = Math.floor(cy / gs) * gs;
        const endX = cx + this.viewW / zoom;
        const endY = cy + this.viewH / zoom;

        // Grid lines
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 * fade})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = startX; x <= endX; x += gs) {
            const sx = (x - cx) * zoom;
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, this.viewH);
        }
        for (let y = startY; y <= endY; y += gs) {
            const sy = (y - cy) * zoom;
            ctx.moveTo(0, sy);
            ctx.lineTo(this.viewW, sy);
        }
        ctx.stroke();

        // Dots at intersections
        ctx.fillStyle = `rgba(255, 255, 255, ${0.25 * fade})`;
        for (let x = startX; x <= endX; x += gs) {
            for (let y = startY; y <= endY; y += gs) {
                const sx = (x - cx) * zoom;
                const sy = (y - cy) * zoom;
                ctx.beginPath();
                ctx.arc(sx, sy, 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    _drawNode(ctx, node) {
        let typeDef = NexusModel.NODE_TYPES[node.type] || NexusModel.NODE_TYPES.claim;
        // Override color for debate nodes with debater color
        if (node._debaterColor) {
            typeDef = { ...typeDef, color: node._debaterColor, glow: node._debaterColor.replace(')', ',0.15)').replace('rgb(', 'rgba(') };
        }
        const isSelected = node.selected;
        const isHovered = node.hovered;
        const hasContent = node.content && node.content.length > 0;

        // Measure label to size the pill
        ctx.font = "500 10px 'Space Grotesk', sans-serif";
        const labelText = node.label || '';
        const textW = ctx.measureText(labelText).width;
        const pillW = Math.max(textW + 24, 60);
        const pillH = isSelected ? 28 : (isHovered ? 27 : 26);
        const pillR = pillH / 2; // Full round ends

        // Loading pulse ring
        if (node._loading) {
            const t = (Date.now() % 1500) / 1500;
            const pulseR = pillR + 6 + t * 18;
            const pulseAlpha = 0.3 * (1 - t);
            ctx.save();
            ctx.strokeStyle = `rgba(255,255,255,${pulseAlpha})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(node.x - pillW/2 - (pulseR - pillR), node.y - pillH/2 - (pulseR - pillR), pillW + (pulseR - pillR)*2, pillH + (pulseR - pillR)*2, pulseR);
            ctx.stroke();
            ctx.restore();
            this.markDirty();
        }

        // Epistemic status ring
        const epi = NexusModel.EPISTEMIC_STATUSES[node.epistemicStatus];
        if (epi && node.epistemicStatus !== 'conjecture') {
            ctx.save();
            ctx.strokeStyle = epi.ring;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([3, 3]);
            if (node.epistemicStatus === 'established') ctx.setLineDash([]);
            ctx.beginPath();
            ctx.roundRect(node.x - pillW/2 - 4, node.y - pillH/2 - 4, pillW + 8, pillH + 8, pillR + 4);
            ctx.stroke();
            ctx.restore();
        }

        // Selection glow
        if (isSelected) {
            ctx.save();
            ctx.shadowColor = typeDef.color;
            ctx.shadowBlur = 16;
            ctx.strokeStyle = typeDef.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(node.x - pillW/2 - 3, node.y - pillH/2 - 3, pillW + 6, pillH + 6, pillR + 3);
            ctx.stroke();
            ctx.restore();
        }

        // Pill gradient fill — dark base to type color
        ctx.save();
        const grd = ctx.createLinearGradient(node.x, node.y - pillH/2, node.x, node.y + pillH/2);
        if (isSelected) {
            grd.addColorStop(0, this._brighten(typeDef.color, 0.3));
            grd.addColorStop(1, this._darken(typeDef.color, 0.2));
        } else if (isHovered) {
            grd.addColorStop(0, this._darken(typeDef.color, 0.3));
            grd.addColorStop(1, this._darken(typeDef.color, 0.55));
        } else {
            grd.addColorStop(0, this._darken(typeDef.color, 0.5));
            grd.addColorStop(1, this._darken(typeDef.color, 0.7));
        }
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.roundRect(node.x - pillW/2, node.y - pillH/2, pillW, pillH, pillR);
        ctx.fill();
        ctx.restore();

        // Button top highlight (3D effect)
        ctx.save();
        ctx.globalAlpha = isSelected ? 0.2 : 0.1;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(node.x - pillW/2 + 2, node.y - pillH/2 + 1, pillW - 4, pillH * 0.4, [pillR, pillR, 2, 2]);
        ctx.fill();
        ctx.restore();

        // Pill border
        ctx.save();
        ctx.strokeStyle = isSelected ? typeDef.color : (isHovered ? this._darken(typeDef.color, 0.1) : this._darken(typeDef.color, 0.3));
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.beginPath();
        ctx.roundRect(node.x - pillW/2, node.y - pillH/2, pillW, pillH, pillR);
        ctx.stroke();
        ctx.restore();

        // Label inside pill
        ctx.save();
        ctx.font = isSelected ? "600 10px 'Space Grotesk', sans-serif" : "500 10px 'Space Grotesk', sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isSelected ? '#FFFFFF' : (isHovered ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.75)');

        const maxLabelW = pillW - 20;
        let label = labelText;
        if (ctx.measureText(label).width > maxLabelW) {
            while (label.length > 0 && ctx.measureText(label + '\u2026').width > maxLabelW) {
                label = label.slice(0, -1);
            }
            label += '\u2026';
        }
        ctx.fillText(label, node.x, node.y + 0.5);
        ctx.restore();

        // Type label below pill on hover/select
        if (isSelected || isHovered) {
            ctx.save();
            ctx.font = "400 8.5px 'Space Mono', monospace";
            ctx.textAlign = 'center';
            ctx.fillStyle = typeDef.color;
            ctx.globalAlpha = 0.8;
            ctx.fillText(typeDef.label.toUpperCase(), node.x, node.y + pillH/2 + 16);
            ctx.restore();
        }
    }

    _drawEdge(ctx, edge) {
        const from = this.model.nodes.get(edge.from);
        const to = this.model.nodes.get(edge.to);
        if (!from || !to) return;

        ctx.save();

        const isSelected = edge.selected;
        const isHovered = edge.hovered;
        const fromType = NexusModel.NODE_TYPES[from.type] || NexusModel.NODE_TYPES.claim;
        const toType = NexusModel.NODE_TYPES[to.type] || NexusModel.NODE_TYPES.claim;

        // Edge line
        const color = isSelected ? 'rgba(255,255,255,0.5)' : (isHovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)');
        ctx.strokeStyle = color;
        ctx.lineWidth = edge.weight * (isSelected ? 1.5 : 1);

        if (edge.style === 'dashed') ctx.setLineDash([8, 4]);
        else if (edge.style === 'dotted') ctx.setLineDash([2, 4]);

        const dx = to.x - from.x, dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) { ctx.restore(); return; }

        const nx = dx / dist, ny = dy / dist;
        const startX = from.x + nx * 30;
        const startY = from.y + ny * 14;
        const endX = to.x - nx * 30;
        const endY = to.y - ny * 14;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Small arrowhead
        const arrowLen = 6, arrowAngle = Math.PI / 7;
        const angle = Math.atan2(endY - startY, endX - startX);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - arrowLen * Math.cos(angle - arrowAngle), endY - arrowLen * Math.sin(angle - arrowAngle));
        ctx.lineTo(endX - arrowLen * Math.cos(angle + arrowAngle), endY - arrowLen * Math.sin(angle + arrowAngle));
        ctx.closePath();
        ctx.fill();

        // Animated directional pulse
        const t = ((Date.now() % 3000) / 3000); // 0->1 over 3 seconds
        const px = startX + (endX - startX) * t;
        const py = startY + (endY - startY) * t;
        // Interpolate color from source to target type
        const r1 = parseInt(fromType.color.slice(1,3), 16);
        const g1 = parseInt(fromType.color.slice(3,5), 16);
        const b1 = parseInt(fromType.color.slice(5,7), 16);
        const r2 = parseInt(toType.color.slice(1,3), 16);
        const g2 = parseInt(toType.color.slice(3,5), 16);
        const b2 = parseInt(toType.color.slice(5,7), 16);
        const pr = Math.round(r1 + (r2 - r1) * t);
        const pg = Math.round(g1 + (g2 - g1) * t);
        const pb = Math.round(b1 + (b2 - b1) * t);
        const pulseAlpha = Math.sin(t * Math.PI) * 0.7; // Fade in/out

        ctx.save();
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${pulseAlpha})`;
        ctx.shadowColor = `rgb(${pr},${pg},${pb})`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        this.markDirty(); // Keep animating

        // Label
        if (edge.label && (!this.options || this.options.edgeLabels)) {
            const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
            ctx.font = "400 9px 'Space Mono', monospace";
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = isSelected ? '#999' : '#555';
            ctx.fillText(edge.label.toUpperCase(), mx, my - 4);
        }

        ctx.restore();
    }

    // Force-directed layout simulation
    _simulateForces() {
        const nodes = [...this.model.nodes.values()];
        if (nodes.length < 2) return;

        const s = this._physicsStrength;
        const repulsion = 2000 * s;
        const springK = 0.002 * s;
        const springLen = 160;
        const centerK = 0.0003 * s;
        const damping = 0.7;
        const minMove = 0.05;

        let totalMovement = 0;

        // Init velocity if needed
        nodes.forEach(n => {
            if (n._vx == null) { n._vx = 0; n._vy = 0; }
        });

        // Compute graph centroid for centering (NOT camera)
        let cx = 0, cy = 0;
        nodes.forEach(n => { cx += n.x; cy += n.y; });
        cx /= nodes.length;
        cy /= nodes.length;

        // Repulsion between all node pairs
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i], b = nodes[j];
                let dx = b.x - a.x, dy = b.y - a.y;
                let dist = Math.hypot(dx, dy) || 1;
                if (dist > 400) continue;
                const force = repulsion / (dist * dist);
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                if (this._draggedNode !== a) { a._vx -= fx; a._vy -= fy; }
                if (this._draggedNode !== b) { b._vx += fx; b._vy += fy; }
            }
        }

        // Spring attraction along edges
        this.model.edges.forEach(e => {
            const a = this.model.nodes.get(e.from);
            const b = this.model.nodes.get(e.to);
            if (!a || !b) return;
            let dx = b.x - a.x, dy = b.y - a.y;
            let dist = Math.hypot(dx, dy) || 1;
            const displacement = dist - springLen;
            const force = springK * displacement;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            if (this._draggedNode !== a) { a._vx += fx; a._vy += fy; }
            if (this._draggedNode !== b) { b._vx -= fx; b._vy -= fy; }
        });

        // Gentle center gravity (toward graph centroid, not camera)
        nodes.forEach(n => {
            if (this._draggedNode === n) return;
            n._vx -= (n.x - cx) * centerK;
            n._vy -= (n.y - cy) * centerK;
        });

        // Apply velocity + damping
        nodes.forEach(n => {
            if (this._draggedNode === n) return;
            n._vx *= damping;
            n._vy *= damping;
            const move = Math.hypot(n._vx, n._vy);
            if (move > minMove) {
                if (move > 4) { n._vx *= 4/move; n._vy *= 4/move; }
                n.x += n._vx;
                n.y += n._vy;
                totalMovement += move;
            }
        });

        if (totalMovement > 0.5) {
            this.markDirty();
        }
    }

    // Color helpers for gradient pills
    _darken(hex, amount) {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`;
    }

    _brighten(hex, amount) {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        return `rgb(${Math.min(255, Math.round(r + (255 - r) * amount))},${Math.min(255, Math.round(g + (255 - g) * amount))},${Math.min(255, Math.round(b + (255 - b) * amount))})`;
    }

    // Minimap
    renderMinimap() {
        // Intentionally empty — Nothing design: no minimap, just the cloud
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GraphRenderer };
} else {
    window.NexusRenderer = { GraphRenderer };
}

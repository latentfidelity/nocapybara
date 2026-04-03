// ============================================
// REFLECT — Point Cloud Renderer
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
            if (this._dirty) {
                this._render();
                this._dirty = false;
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
        for (const n of nodes) {
            const layer = this.model.layers.find(l => l.id === n.layer);
            if (layer && !layer.visible) continue;
            // Hit test: circle radius 16 (12 + padding)
            const dist = Math.hypot(wx - n.x, wy - n.y);
            if (dist <= 16) {
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
        this._drawDotGrid(ctx, cx, cy, zoom);

        // Apply camera
        ctx.save();
        ctx.translate(-cx * zoom, -cy * zoom);
        ctx.scale(zoom, zoom);

        // Draw edges
        this.model.edges.forEach(edge => this._drawEdge(ctx, edge));

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
            this._drawNode(ctx, node);
        });

        ctx.restore();

        // Selection box
        if (this.selectionBox) {
            const sb = this.selectionBox;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.fillStyle = 'rgba(255,255,255,0.02)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
            ctx.strokeRect(sb.x, sb.y, sb.w, sb.h);
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
        const typeDef = NexusModel.NODE_TYPES[node.type] || NexusModel.NODE_TYPES.concept;
        const isSelected = node.selected;
        const isHovered = node.hovered;
        const hasContent = node.content && node.content.length > 0;

        const radius = isSelected ? 14 : (isHovered ? 13 : 12);

        // Glow for selected
        if (isSelected) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.beginPath();
            ctx.arc(node.x, node.y, 28, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Circle fill
        ctx.save();
        ctx.fillStyle = isSelected ? '#333333' : (isHovered ? '#2A2A2A' : '#1E1E1E');
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Circle border
        ctx.save();
        ctx.strokeStyle = isSelected ? '#FFFFFF' : (isHovered ? '#CCCCCC' : '#888888');
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Page indicator (small dot inside circle for nodes with content)
        if (hasContent) {
            ctx.save();
            ctx.fillStyle = isSelected ? '#FFFFFF' : '#888888';
            ctx.beginPath();
            ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Label below circle
        ctx.save();
        ctx.font = isSelected ? "500 11px 'Space Grotesk', sans-serif" : "400 10px 'Space Grotesk', sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isSelected ? '#FFFFFF' : (isHovered ? '#E8E8E8' : '#999999');

        const labelY = node.y + radius + 6;
        const maxLabelW = 100;
        let label = node.label;
        if (ctx.measureText(label).width > maxLabelW) {
            while (label.length > 0 && ctx.measureText(label + '…').width > maxLabelW) {
                label = label.slice(0, -1);
            }
            label += '…';
        }
        ctx.fillText(label, node.x, labelY);
        ctx.restore();

        // Type label on hover/select
        if (isSelected || isHovered) {
            ctx.save();
            ctx.font = "400 8px 'Space Mono', monospace";
            ctx.textAlign = 'center';
            ctx.fillStyle = '#666666';
            ctx.fillText(typeDef.label.toUpperCase(), node.x, labelY + 14);
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
        const startX = from.x + nx * 6;
        const startY = from.y + ny * 6;
        const endX = to.x - nx * 6;
        const endY = to.y - ny * 6;

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

        // Label
        if (edge.label) {
            const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
            ctx.font = "400 9px 'Space Mono', monospace";
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = isSelected ? '#999' : '#555';
            ctx.fillText(edge.label.toUpperCase(), mx, my - 4);
        }

        ctx.restore();
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

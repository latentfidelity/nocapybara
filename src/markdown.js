// ============================================
// NOCAPYBARA — Markdown Renderer
// ============================================
// Lightweight markdown → HTML with wiki links, tags, embeds.

const NocapMarkdown = (() => {

    /**
     * Render markdown text to HTML (inline context — debate transcript, status).
     * Does NOT resolve wiki-links to nodes.
     */
    function renderInline(text) {
        if (!text || typeof text !== 'string') return '';
        let html = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
            .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/!\[\[([^\]]+)\]\]/g, '<span class="md-embed" title="Embed: $1">📎 $1</span>')
            .replace(/\[\[([^\]]+)\]\]/g, '<span class="md-wikilink" title="Link: $1">$1</span>')
            .replace(/(^|\s)#(\w[\w-]*)/g, '$1<span class="md-tag">#$2</span>')
            .replace(/^---$/gm, '<hr>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            .replace(/\n/g, '<br>');
        html = html.replace(/((?:<li>.*?<\/li><br>?)+)/g, '<ul>$1</ul>');
        html = html.replace(/<ul>([\s\S]*?)<\/ul>/g, (match, inner) => '<ul>' + inner.replace(/<br>/g, '') + '</ul>');
        html = html.replace(/<\/blockquote><br><blockquote>/g, '<br>');
        return html;
    }

    /**
     * Render page-level markdown with wiki-link resolution, embeds, and tags.
     * @param {string} text
     * @param {function} findNodeByLabel - (label) => node | null
     * @param {function} renderNodeContent - (node, depth) => html (for embeds)
     * @param {number} depth - recursion guard for embeds
     */
    function renderPage(text, findNodeByLabel, renderNodeContent, depth = 0) {
        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Embeds ![[Node Name]] — guard infinite recursion
        if (depth < 2) {
            html = html.replace(/!\[\[([^\]]+)\]\]/g, (_, name) => {
                const target = findNodeByLabel(name);
                if (target && target.content) {
                    const innerHtml = renderNodeContent(target, depth + 1);
                    return `<div class="embed-block"><div class="embed-title">⊞ ${_esc(name)}</div><div class="embed-content">${innerHtml}</div></div>`;
                }
                return `<div class="embed-block"><div class="embed-title">⊞ ${_esc(name)} (not found)</div></div>`;
            });
        }

        // Wiki links [[Node Name]]
        html = html.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
            const exists = findNodeByLabel(name);
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

        // Paragraphs & line breaks
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');
        html = '<p>' + html + '</p>';

        // Clean empty tags
        html = html.replace(/<p><\/p>/g, '');
        html = html.replace(/<p>(<h[1-3]>)/g, '$1');
        html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)<\/p>/g, '$1');
        html = html.replace(/<p>(<hr>)<\/p>/g, '$1');

        return html;
    }

    /**
     * Extract headings from markdown content for outline generation.
     */
    function extractHeadings(content) {
        const headings = [];
        content.split('\n').forEach((line, i) => {
            const m3 = line.match(/^### (.+)/);
            const m2 = line.match(/^## (.+)/);
            const m1 = line.match(/^# (.+)/);
            if (m1) headings.push({ level: 1, text: m1[1], line: i });
            else if (m2) headings.push({ level: 2, text: m2[1], line: i });
            else if (m3) headings.push({ level: 3, text: m3[1], line: i });
        });
        return headings;
    }

    function _esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    return { renderInline, renderPage, extractHeadings, _esc };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NocapMarkdown;
} else {
    window.NocapMarkdown = NocapMarkdown;
}

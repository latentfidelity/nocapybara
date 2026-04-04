/**
 * @jest-environment jsdom
 */
const NocapMarkdown = require('../src/markdown');

describe('renderInline', () => {
    test('escapes HTML', () => {
        expect(NocapMarkdown.renderInline('<script>')).toContain('&lt;script&gt;');
    });

    test('bold', () => {
        expect(NocapMarkdown.renderInline('**bold**')).toContain('<strong>bold</strong>');
    });

    test('italic', () => {
        expect(NocapMarkdown.renderInline('*italic*')).toContain('<em>italic</em>');
    });

    test('bold+italic', () => {
        const r = NocapMarkdown.renderInline('***both***');
        expect(r).toContain('<strong><em>both</em></strong>');
    });

    test('inline code', () => {
        expect(NocapMarkdown.renderInline('`code`')).toContain('<code>code</code>');
    });

    test('headings', () => {
        expect(NocapMarkdown.renderInline('# H1')).toContain('<h1>H1</h1>');
        expect(NocapMarkdown.renderInline('## H2')).toContain('<h2>H2</h2>');
        expect(NocapMarkdown.renderInline('### H3')).toContain('<h3>H3</h3>');
    });

    test('wiki links', () => {
        const r = NocapMarkdown.renderInline('see [[Concept]]');
        expect(r).toContain('md-wikilink');
        expect(r).toContain('Concept');
    });

    test('tags', () => {
        const r = NocapMarkdown.renderInline('text #axiom more');
        expect(r).toContain('md-tag');
        expect(r).toContain('#axiom');
    });

    test('horizontal rule', () => {
        expect(NocapMarkdown.renderInline('---')).toContain('<hr>');
    });

    test('null/undefined returns empty', () => {
        expect(NocapMarkdown.renderInline(null)).toBe('');
        expect(NocapMarkdown.renderInline(undefined)).toBe('');
        expect(NocapMarkdown.renderInline('')).toBe('');
    });

    test('unordered list', () => {
        const r = NocapMarkdown.renderInline('- item1\n- item2');
        expect(r).toContain('<li>item1</li>');
        expect(r).toContain('<li>item2</li>');
    });
});

describe('renderPage', () => {
    const noFind = () => null;
    const noRender = () => '';

    test('wiki links with existing node', () => {
        const find = (label) => label === 'X' ? { id: 'x1' } : null;
        const r = NocapMarkdown.renderPage('see [[X]]', find, noRender);
        expect(r).toContain('wiki-link');
        expect(r).not.toContain('wiki-link-missing');
    });

    test('wiki links missing node', () => {
        const r = NocapMarkdown.renderPage('see [[Missing]]', noFind, noRender);
        expect(r).toContain('wiki-link-missing');
    });

    test('tags rendered', () => {
        const r = NocapMarkdown.renderPage('#test tag', noFind, noRender);
        expect(r).toContain('tag-link');
    });

    test('checkboxes', () => {
        const r = NocapMarkdown.renderPage('- [x] done\n- [ ] todo', noFind, noRender);
        expect(r).toContain('☑');
        expect(r).toContain('☐');
    });

    test('embeds with depth guard', () => {
        const find = (label) => label === 'Sub' ? { content: 'inner' } : null;
        const render = (node, depth) => NocapMarkdown.renderPage(node.content, find, render, depth);
        const r = NocapMarkdown.renderPage('![[Sub]]', find, render, 0);
        expect(r).toContain('embed-block');
        expect(r).toContain('inner');
    });

    test('embeds stop at depth 2', () => {
        const find = (label) => ({ content: `![[${label}]]` });
        const render = (node, depth) => NocapMarkdown.renderPage(node.content, find, render, depth);
        // Depth 2 should not recurse further — no infinite loop
        const r = NocapMarkdown.renderPage('![[A]]', find, render, 0);
        expect(r).toContain('embed-block');
    });
});

describe('extractHeadings', () => {
    test('extracts h1, h2, h3', () => {
        const content = '# Top\ntext\n## Mid\nmore\n### Low';
        const headings = NocapMarkdown.extractHeadings(content);
        expect(headings).toHaveLength(3);
        expect(headings[0]).toEqual({ level: 1, text: 'Top', line: 0 });
        expect(headings[1]).toEqual({ level: 2, text: 'Mid', line: 2 });
        expect(headings[2]).toEqual({ level: 3, text: 'Low', line: 4 });
    });

    test('empty content', () => {
        expect(NocapMarkdown.extractHeadings('')).toEqual([]);
    });

    test('no headings', () => {
        expect(NocapMarkdown.extractHeadings('just text\nno headings')).toEqual([]);
    });
});

describe('_esc', () => {
    test('escapes HTML entities', () => {
        const r = NocapMarkdown._esc('<b>"test"&</b>');
        expect(r).not.toContain('<b>');
        expect(r).toContain('&lt;');
        expect(r).toContain('&amp;');
    });
});

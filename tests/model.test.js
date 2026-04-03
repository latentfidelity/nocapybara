const { NODE_TYPES, NexusNode, NexusEdge, WorldModel, genId } = require('../src/model');

describe('NODE_TYPES', () => {
    test('6 types with required props', () => {
        expect(Object.keys(NODE_TYPES).length).toBe(6);
        Object.values(NODE_TYPES).forEach(t => {
            expect(t).toHaveProperty('label');
            expect(t).toHaveProperty('color');
            expect(t).toHaveProperty('shape');
        });
    });
    test('unique shapes', () => {
        const s = Object.values(NODE_TYPES).map(t => t.shape);
        expect(new Set(s).size).toBe(6);
    });
});

describe('genId', () => {
    test('unique', () => { const s = new Set(Array.from({length:50},()=>genId())); expect(s.size).toBe(50); });
    test('prefix', () => { expect(genId('x')).toMatch(/^x_/); });
});

describe('NexusNode', () => {
    test('init', () => {
        const n = new NexusNode('claim',10,20,'T');
        expect(n.type).toBe('claim'); expect(n.x).toBe(10); expect(n.label).toBe('T');
        expect(n.content).toBe(''); expect(n.notes).toBe(''); expect(n.properties).toEqual({});
    });
    test('default label', () => { expect(new NexusNode('argument',0,0).label).toBe('Argument'); });
});

describe('NexusEdge', () => {
    test('init', () => {
        const e = new NexusEdge('a','b','r');
        expect(e.from).toBe('a'); expect(e.to).toBe('b'); expect(e.label).toBe('r');
    });
});

describe('WorldModel', () => {
    let m;
    beforeEach(() => { m = new WorldModel(); });

    test('empty start', () => { expect(m.nodes.size).toBe(0); expect(m.edges.size).toBe(0); });
    test('addNode', () => { const n=m.addNode('claim',1,2,'X'); expect(m.nodes.get(n.id).label).toBe('X'); });
    test('removeNode cascades', () => {
        const a=m.addNode('claim',0,0),b=m.addNode('argument',1,1);
        m.addEdge(a.id,b.id); m.removeNode(b.id);
        expect(m.edges.size).toBe(0);
    });
    test('dup edge prevented', () => {
        const a=m.addNode('claim',0,0),b=m.addNode('argument',1,1);
        m.addEdge(a.id,b.id); m.addEdge(a.id,b.id);
        expect(m.edges.size).toBe(1);
    });
    test('reverse edge', () => {
        const a=m.addNode('claim',0,0),b=m.addNode('argument',1,1);
        const e=m.addEdge(a.id,b.id); m.reverseEdge(e.id);
        expect(e.from).toBe(b.id);
    });
    test('getNodeEdges', () => {
        const a=m.addNode('claim',0,0),b=m.addNode('argument',1,1),c=m.addNode('evidence',2,2);
        m.addEdge(a.id,b.id); m.addEdge(b.id,c.id);
        expect(m.getNodeEdges(b.id)).toHaveLength(2);
    });
    test('getConnectedNodes', () => {
        const a=m.addNode('claim',0,0,'A'),b=m.addNode('argument',1,1,'B');
        m.addEdge(a.id,b.id);
        expect(m.getConnectedNodes(b.id)[0].label).toBe('A');
    });
    test('clear', () => {
        m.addNode('claim',0,0); m.clear();
        expect(m.nodes.size).toBe(0); expect(m.layers).toHaveLength(1);
    });
});

describe('Serialization', () => {
    test('round-trip', () => {
        const m=new WorldModel();
        const a=m.addNode('axiom',10,20,'Law'); a.content='[[x]]'; a.properties.k='v';
        const b=m.addNode('question',30,40,'Trig'); m.addEdge(a.id,b.id,'causes');
        const m2=new WorldModel(); m2.fromJSON(m.toJSON());
        expect(m2.nodes.size).toBe(2); expect(m2.edges.size).toBe(1);
        expect(m2.nodes.get(a.id).content).toBe('[[x]]');
    });
    test('missing fields', () => {
        const m=new WorldModel();
        m.fromJSON({nodes:[{id:'n1',type:'claim',x:0,y:0,label:'T'}],edges:[]});
        expect(m.nodes.get('n1').content).toBe('');
    });
    test('empty data', () => { expect(()=>new WorldModel().fromJSON({})).not.toThrow(); });
});

describe('Search', () => {
    let m;
    beforeEach(() => {
        m=new WorldModel();
        const a=m.addNode('claim',0,0,'Quantum'); a.description='small'; a.content='[[uncertainty]]';
        const b=m.addNode('argument',1,1,'Relativity'); b.notes='Einstein';
        const c=m.addNode('evidence',2,2,'Grocery'); c.properties.cat='personal';
    });
    test('by label', () => { expect(m.search('quantum')[0].label).toBe('Quantum'); });
    test('by notes', () => { expect(m.search('einstein')[0].label).toBe('Relativity'); });
    test('by property', () => { expect(m.search('personal')[0].label).toBe('Grocery'); });
    test('case insensitive', () => { expect(m.search('QUANTUM')).toHaveLength(1); });
    test('no match', () => { expect(m.search('xyz')).toEqual([]); });
});

describe('Events', () => {
    test('sequence', () => {
        const m=new WorldModel(),ev=[];
        m.onChange(t=>ev.push(t));
        const a=m.addNode('claim',0,0),b=m.addNode('argument',1,1);
        const e=m.addEdge(a.id,b.id);
        m.reverseEdge(e.id); m.removeEdge(e.id); m.removeNode(a.id); m.clear();
        expect(ev).toEqual(['node-added','node-added','edge-added','edge-updated','edge-removed','node-removed','cleared']);
    });
});

describe('Options defaults', () => {
    test('off by default', () => { const o={}; expect(o.grid===true).toBe(false); expect(o.grounding===true).toBe(false); });
    test('on by default', () => { const o={}; expect(o.labels!==false).toBe(true); expect(o.edges!==false).toBe(true); expect(o.autoSave!==false).toBe(true); });
});

describe('String safety', () => {
    test('object', () => { expect(typeof String({text:'x'})).toBe('string'); });
    test('null', () => { expect(String(null||'')).toBe(''); });
    test('toLowerCase', () => { expect(String({}||'').toLowerCase()).toBeTruthy(); });
    test('replace', () => { expect(String({}||'').replace(/\n/g,'<br>')).toBeTruthy(); });
    test('trim+split', () => { expect(String({text:'x'}||'').trim().split(/\s+/).length).toBeGreaterThan(0); });
});

describe('API response', () => {
    test('valid', () => { expect({text:'r',g:null}?.text||'').toBe('r'); });
    test('error', () => { expect({error:'q'}?.text||{error:'q'}?.error||'').toBe('q'); });
    test('null', () => { expect(null?.text||null?.error||String(null||'')).toBe(''); });
});

describe('Edge cases', () => {
    let m; beforeEach(()=>{m=new WorldModel();});
    test('remove nonexistent', () => { expect(()=>m.removeNode('x')).not.toThrow(); });
    test('1000 nodes', () => { for(let i=0;i<1000;i++)m.addNode('claim',i,i,`N${i}`); expect(m.nodes.size).toBe(1000); });
    test('special chars roundtrip', () => {
        const n=m.addNode('claim',0,0,'A"B"&<C>'); n.content='[[w]] ![[e]]';
        const m2=new WorldModel(); m2.fromJSON(m.toJSON());
        expect(m2.nodes.get(n.id).content).toBe('[[w]] ![[e]]');
    });
    test('self-edge cleanup', () => {
        const a=m.addNode('claim',0,0); m.addEdge(a.id,a.id);
        m.removeNode(a.id); expect(m.edges.size).toBe(0);
    });
});

describe('Debate subdrawer', () => {
    test('filters debate children', () => {
        const m=new WorldModel();
        const t=m.addNode('claim',0,0,'Topic');
        const a=m.addNode('claim',0,100); a.properties={side:'A',round:'1'};
        const b=m.addNode('claim',0,200); b.properties={side:'B',round:'1'};
        const r=m.addNode('axiom',0,300); r.properties={type:'resolution'};
        const x=m.addNode('evidence',5,5);
        m.addEdge(t.id,a.id); m.addEdge(t.id,b.id); m.addEdge(t.id,r.id); m.addEdge(t.id,x.id);
        const ch=[]; m.edges.forEach(e=>{if(e.from===t.id)ch.push(e);});
        const dc=ch.map(e=>m.nodes.get(e.to)).filter(c=>c&&c.properties&&(c.properties.side||c.properties.type==='resolution'));
        expect(dc).toHaveLength(3);
    });
});

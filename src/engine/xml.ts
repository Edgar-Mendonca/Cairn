// A small, dependency-free XML reader for data files such as project XML (MSPDI).
// It builds a plain element tree, so file import works the same in the browser and in tests.
// Not supported (not needed for data files): DTDs with internal entities, and processing of namespaces
// beyond dropping prefixes from element names.

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const local = (name: string) => name.slice(name.indexOf(':') + 1);

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;
  if (src.charCodeAt(0) === 0xfeff) i = 1;
  const fail = (msg: string): never => {
    const line = src.slice(0, i).split('\n').length;
    throw new Error('The XML file is not well formed (' + msg + ' near line ' + line + ').');
  };
  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      const t = src.slice(i, textEnd);
      if (stack.length > 1) stack[stack.length - 1].text += decode(t);
      else if (t.trim()) fail('text outside the root element');
    }
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e < 0) fail('unclosed comment');
      i = e + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      if (e < 0) fail('unclosed CDATA section');
      stack[stack.length - 1].text += src.slice(i + 9, e);
      i = e + 3;
    } else if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2);
      if (e < 0) fail('unclosed declaration');
      i = e + 2;
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE: skip, including a bracketed internal subset.
      let depth = 0, j = i + 2;
      for (; j < n; j++) {
        const c = src[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (src[i + 1] === '/') {
      const e = src.indexOf('>', i);
      if (e < 0) fail('unclosed end tag');
      const name = local(src.slice(i + 2, e).trim());
      const top = stack.pop();
      if (!top || top === root || top.name !== name) fail('mismatched end tag </' + name + '>');
      i = e + 1;
    } else {
      // Start tag: name, attributes, optional self-close.
      const re = /<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
      re.lastIndex = i;
      const m = re.exec(src);
      if (!m) fail('malformed start tag');
      const el: XmlNode = { name: local(m![1]), attrs: {}, children: [], text: '' };
      const ar = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m![2]))) el.attrs[local(a[1])] = decode(a[2] ?? a[3] ?? '');
      const parent = stack[stack.length - 1];
      if (parent === root && root.children.length) fail('more than one root element');
      parent.children.push(el);
      if (!m![3]) stack.push(el);
      i = re.lastIndex;
    }
  }
  if (stack.length > 1) fail('unclosed element <' + stack[stack.length - 1].name + '>');
  if (!root.children.length) throw new Error('The file has no XML content.');
  return root.children[0];
}

/* Helpers for reading element trees. */

export function child(el: XmlNode | undefined, name: string): XmlNode | undefined {
  return el?.children.find(c => c.name === name);
}

export function children(el: XmlNode | undefined, name: string): XmlNode[] {
  return el ? el.children.filter(c => c.name === name) : [];
}

export function text(el: XmlNode | undefined, name: string): string {
  const c = child(el, name);
  return c ? c.text.trim() : '';
}

export function num(el: XmlNode | undefined, name: string, def = 0): number {
  const t = text(el, name);
  const v = t === '' ? NaN : Number(t);
  return isFinite(v) ? v : def;
}

export function flag(el: XmlNode | undefined, name: string): boolean {
  const t = text(el, name).toLowerCase();
  return t === '1' || t === 'true';
}

/* Writing */

export function escXml(s: unknown): string {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
}

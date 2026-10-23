// -----------------------------------------------------------------------------
// A small XML reader, enough for RSS, Atom and GeoRSS: elements, attributes,
// text, CDATA and the predefined and numeric entities. No dependency.
//
// Safe by construction: the DOCTYPE is skipped, so no entity is ever defined
// or expanded (no "billion laughs", no external entity), nothing is fetched,
// nothing runs. A malformed document gives what could be read, never a throw
// for a stray character: feeds in the wild are often sloppy.
// -----------------------------------------------------------------------------

const MAX_DEPTH = 64;

const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Replaces the predefined and numeric entities; any other is left as it is. */
export function decodeEntities(text) {
  if (!text.includes('&')) {
    return text;
  }
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    }
    return NAMED[body] ?? whole;
  });
}

const ATTRIBUTE = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** The local part of a qualified name: `georss:point` → `point`. */
export const localName = (name) => name.slice(name.indexOf(':') + 1);

/**
 * Parses a document into `{ name, attributes, children, text }` nodes; `text`
 * is the concatenated direct text of the element. Returns the root element,
 * or null when there is none.
 */
export function parseXml(source) {
  const root = { name: '#document', attributes: {}, children: [], text: '' };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let index = 0;
  const length = source.length;
  while (index < length) {
    const open = source.indexOf('<', index);
    const textEnd = open === -1 ? length : open;
    if (textEnd > index) {
      top().text += decodeEntities(source.slice(index, textEnd));
    }
    if (open === -1) {
      break;
    }
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      index = end === -1 ? length : end + 3;
    } else if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      top().text += source.slice(open + 9, end === -1 ? length : end);
      index = end === -1 ? length : end + 3;
    } else if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open + 2);
      index = end === -1 ? length : end + 2;
    } else if (source.startsWith('<!', open)) {
      // DOCTYPE, with its internal subset if any: skipped, never interpreted.
      const bracket = source.indexOf('[', open);
      const close = source.indexOf('>', open);
      let end = close;
      if (bracket !== -1 && (close === -1 || bracket < close)) {
        const subsetEnd = source.indexOf(']', bracket);
        end = subsetEnd === -1 ? -1 : source.indexOf('>', subsetEnd);
      }
      index = end === -1 ? length : end + 1;
    } else if (source[open + 1] === '/') {
      const end = source.indexOf('>', open);
      const name = source.slice(open + 2, end === -1 ? length : end).trim();
      // Close up to the matching element; a stray closing tag is ignored.
      const at = stack.findLastIndex((node) => node.name === name);
      if (at > 0) {
        stack.length = at;
      }
      index = end === -1 ? length : end + 1;
    } else {
      const end = findTagEnd(source, open + 1);
      if (end === -1) {
        // A lone "<" in text (sloppy feeds): kept as text.
        top().text += '<';
        index = open + 1;
        continue;
      }
      const body = source.slice(open + 1, end);
      const selfClosing = body.endsWith('/');
      const inner = selfClosing ? body.slice(0, -1) : body;
      const nameMatch = /^[^\s/>]+/.exec(inner);
      index = end + 1;
      if (!nameMatch) {
        top().text += '<';
        index = open + 1;
        continue;
      }
      const node = {
        name: nameMatch[0],
        attributes: parseAttributes(inner.slice(nameMatch[0].length)),
        children: [],
        text: '',
      };
      top().children.push(node);
      if (!selfClosing && stack.length <= MAX_DEPTH) {
        stack.push(node);
      }
    }
  }
  return root.children[0] ?? null;
}

// The `>` that ends a tag, outside quoted attribute values.
function findTagEnd(source, from) {
  let quote = null;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    } else if (char === '<') {
      return -1;
    }
  }
  return -1;
}

/** Direct children with this local name. */
export const childrenNamed = (node, name) =>
  node.children.filter((child) => localName(child.name) === name);

/** First direct child with one of these local names. */
export function child(node, ...names) {
  for (const name of names) {
    const found = node.children.find((c) => localName(c.name) === name);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Every descendant (depth first) with this local name. */
export function descendants(node, name, found = []) {
  for (const c of node.children) {
    if (localName(c.name) === name) {
      found.push(c);
    }
    descendants(c, name, found);
  }
  return found;
}

/** The whole text of an element and of its descendants. */
export function textOf(node) {
  if (!node) {
    return '';
  }
  return node.text + node.children.map(textOf).join('');
}

/**
 * Minimal, dependency-free XML reader scoped to the learning_registry schema.
 *
 * Deliberately narrow: elements, attributes, nesting, self-closing tags,
 * comments and processing instructions. It does NOT aim to be a general XML
 * parser. The registry import pipeline is correctness-critical, so the
 * compiler relies on a regular, human-reviewed structure; if a future
 * registry needs full XML features, switch this adapter to a battle-tested
 * library (e.g. fast-xml-parser) behind the same `XmlNode` interface.
 */

export interface XmlNode {
  tag: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text?: string;
}

const NAME_CHAR = /[A-Za-z0-9_:.\-]/;
const WS = /\s/;

function decodeEntity(entity: string): string {
  switch (entity) {
    case "&amp;":
      return "&";
    case "&lt;":
      return "<";
    case "&gt;":
      return ">";
    case "&quot;":
      return '"';
    case "&apos;":
      return "'";
    default:
      return entity;
  }
}

export function parseXml(input: string): XmlNode {
  let i = 0;
  const n = input.length;

  function skipWs(): void {
    while (i < n && WS.test(input[i]!)) i++;
  }

  function skipComment(): boolean {
    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      if (end === -1) throw new Error("Unterminated XML comment");
      i = end + 3;
      return true;
    }
    return false;
  }

  function skipPI(): boolean {
    if (input.startsWith("<?", i)) {
      const end = input.indexOf("?>", i + 2);
      if (end === -1) throw new Error("Unterminated XML processing instruction");
      i = end + 2;
      return true;
    }
    return false;
  }

  function readName(): string {
    let s = "";
    while (i < n && NAME_CHAR.test(input[i]!)) {
      s += input[i];
      i++;
    }
    return s;
  }

  function readAttributeValue(quote: string): string {
    let s = "";
    i++; // consume opening quote
    while (i < n && input[i] !== quote) {
      if (input[i] === "&") {
        const end = input.indexOf(";", i);
        s += decodeEntity(input.slice(i, end + 1));
        i = end + 1;
      } else {
        s += input[i];
        i++;
      }
    }
    i++; // consume closing quote
    return s;
  }

  function readAttributes(): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (;;) {
      skipWs();
      if (i >= n || input[i] === ">" || input[i] === "/") break;
      const name = readName();
      skipWs();
      if (input[i] === "=") {
        i++;
        skipWs();
      }
      let value = "";
      if (input[i] === '"' || input[i] === "'") value = readAttributeValue(input[i]!);
      attrs[name] = value;
    }
    return attrs;
  }

  function parseElement(): XmlNode {
    if (input[i] !== "<") throw new Error(`Expected '<' at ${i}`);
    i++; // consume '<'
    const tag = readName();
    if (!tag) throw new Error(`Empty tag name at ${i}`);
    const attributes = readAttributes();
    skipWs();
    const node: XmlNode = { tag, attributes, children: [] };
    if (input[i] === "/") {
      i += 2; // self-closing '/>'
      return node;
    }
    if (input[i] !== ">") throw new Error(`Expected '>' after <${tag}>`);
    i++;

    for (;;) {
      skipWs();
      if (i >= n) throw new Error(`Unterminated element <${tag}>`);
      if (input.startsWith("</", i)) {
        i += 2;
        const closeTag = readName();
        if (closeTag !== tag) {
          throw new Error(`Mismatched close tag: <${tag}> opened, </${closeTag}> closed`);
        }
        skipWs();
        if (input[i] === ">") i++;
        return node;
      }
      if (skipComment() || skipPI()) continue;
      if (input[i] === "<") {
        node.children.push(parseElement());
        continue;
      }
      let text = "";
      while (i < n && input[i] !== "<") {
        text += input[i];
        i++;
      }
      const trimmed = text.trim();
      if (trimmed) node.text = (node.text ? node.text + " " : "") + trimmed;
    }
  }

  for (;;) {
    skipWs();
    if (i >= n) throw new Error("Empty XML document");
    if (input.startsWith("<?", i) || input.startsWith("<!--", i)) {
      if (skipPI() || skipComment()) continue;
    }
    break;
  }
  if (input[i] !== "<") throw new Error("Expected root element");
  const root = parseElement();
  skipWs();
  if (i < n) throw new Error(`Unexpected trailing content at ${i}`);
  return root;
}

export function childrenByName(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => c.tag === tag);
}

export function childByName(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

export function attr(node: XmlNode, name: string): string | undefined {
  return node.attributes[name];
}

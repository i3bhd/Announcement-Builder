// Clipboard HTML is rebuilt from an allowlist before it enters the editor.
const listStyles = new Set(['disc', 'circle', 'square', 'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman']);
const tags = new Set(['P', 'DIV', 'BR', 'STRONG', 'EM', 'U', 'S', 'SUB', 'SUP', 'UL', 'OL', 'LI', 'SPAN']);
const blocked = 'script,style,iframe,object,embed,link,meta,svg,math,form,input,button,textarea,select';

function relativeLength(value: string, fontSize: number): string {
  const match = value.trim().match(/^([\d.]+)(pt|px|em|rem|%)$/);
  if (!match) return value === '0' ? '0' : '';
  const number = Number(match[1]);
  const em = match[2] === 'pt' ? number * 4 / 3 / fontSize
    : match[2] === 'px' ? number / fontSize
    : match[2] === '%' ? number / 100 : number;
  return Number.isFinite(em) && em <= 12 ? `${Math.round(em * 1000) / 1000}em` : '';
}

function safeStyles(source: HTMLElement, target: HTMLElement) {
  const style = source.style;
  const size = parseFloat(style.fontSize) * (style.fontSize.endsWith('pt') ? 4 / 3 : 1) || 16;
  // Deliberately omit font family and size: the announcement owns typography.
  for (const key of ['color', 'backgroundColor'] as const) {
    const value = style[key];
    if (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(value)) target.style[key] = value;
  }
  if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) target.style.fontWeight = '700';
  if (style.fontStyle === 'italic') target.style.fontStyle = 'italic';
  const decoration = style.textDecorationLine || style.textDecoration;
  if (decoration.includes('underline')) target.style.textDecorationLine = 'underline';
  if (decoration.includes('line-through')) target.style.textDecorationLine += ' line-through';
  if (['left', 'right', 'center', 'justify'].includes(style.textAlign)) target.style.textAlign = style.textAlign;
  if (['P', 'DIV', 'LI', 'UL', 'OL'].includes(target.tagName)) {
    for (const key of ['marginTop', 'marginBottom'] as const) {
      const value = relativeLength(style[key], size);
      if (value) target.style[key] = value;
    }
    const lineHeight = style.lineHeight;
    const value = /^\d+(\.\d+)?$/.test(lineHeight) ? lineHeight : relativeLength(lineHeight, size);
    if (value && parseFloat(value) <= 6) target.style.lineHeight = value;
  }
  if (listStyles.has(style.listStyleType)) target.style.listStyleType = style.listStyleType;
}

function normalizeWordLists(root: DocumentFragment) {
  // Word commonly represents lists as paragraphs with mso-list metadata.
  for (const parent of [root, ...Array.from(root.querySelectorAll('div,td'))]) {
    const stack: { list: HTMLOListElement | HTMLUListElement; item: HTMLLIElement | null; key: string }[] = [];
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue;
      if (!(node instanceof HTMLElement)) continue;
      const raw = node.getAttribute('style') || '';
      const match = raw.match(/mso-list:\s*([^;]+)/i);
      if (!match || /mso-list:\s*ignore/i.test(raw) || !['P', 'DIV'].includes(node.tagName)) {
        stack.length = 0;
        continue;
      }
      const markerNode = node.querySelector<HTMLElement>('[style*="mso-list:Ignore"],[style*="mso-list: Ignore"],[style*="mso-list:ignore"]');
      const marker = (markerNode?.textContent || node.textContent || '').trim();
      const number = marker.match(/^(\d+|[٠-٩]+)[.)]/);
      const letter = marker.match(/^([a-zA-Z])[.)]/);
      const ordered = Boolean(number || letter);
      const depth = Math.min(9, Number(match[1].match(/level(\d+)/i)?.[1] || 1));
      const key = match[1].replace(/level\d+/i, '').trim() + (ordered ? ':ol' : ':ul');
      const level = Math.min(depth, stack.length + 1);
      stack.length = Math.min(stack.length, level);
      if (stack[level - 1]?.key !== key) stack.length = level - 1;
      if (!stack[level - 1]) {
        const list = document.createElement(ordered ? 'ol' : 'ul');
        if (number && list instanceof HTMLOListElement) {
          const start = Number(number[1].replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))));
          if (start > 1) list.start = start;
        }
        if (letter) list.style.listStyleType = letter[1] === letter[1].toUpperCase() ? 'upper-alpha' : 'lower-alpha';
        const enclosing = stack[level - 2]?.item;
        if (enclosing) enclosing.appendChild(list);
        else parent.insertBefore(list, node);
        stack[level - 1] = { list, item: null, key };
      }
      if (markerNode) markerNode.remove();
      else {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const first = walker.nextNode();
        if (first) first.textContent = (first.textContent || '').replace(/^\s*(?:[•·▪●○\uF0B7]|\d+[.)]|[a-zA-Z][.)])\s*/, '');
      }
      const item = document.createElement('li');
      item.setAttribute('style', raw);
      while (node.firstChild) item.appendChild(node.firstChild);
      stack[level - 1].list.appendChild(item);
      stack[level - 1].item = item;
      node.remove();
    }
  }
}

export function sanitizeRichHtml(value: string) {
  const template = document.createElement('template');
  template.innerHTML = value;
  // Read Word's class-based paragraph formatting without attaching its CSS.
  // Only simple class/tag rules are considered; all properties are filtered below.
  const originals = new Map<HTMLElement, string>();
  template.content.querySelectorAll<HTMLElement>('*').forEach(node => originals.set(node, node.getAttribute('style') || ''));
  template.content.querySelectorAll('style').forEach(node => {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(node.textContent || '');
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        for (const selector of rule.selectorText.split(',')) {
          if (!/^[a-zA-Z0-9_. -]+$/.test(selector) || selector.includes(' ')) continue;
          template.content.querySelectorAll<HTMLElement>(selector).forEach(element => {
            element.style.cssText += ';' + rule.style.cssText;
          });
        }
      }
    } catch { /* Unsupported source CSS never blocks pasting. */ }
  });
  originals.forEach((style, node) => {
    if (style) node.setAttribute('style', (node.getAttribute('style') || '') + ';' + style);
  });
  template.content.querySelectorAll(blocked).forEach(node => node.remove());
  normalizeWordLists(template.content);
  const clean = (node: Node): Node => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
    const fragment = document.createDocumentFragment();
    if (!(node instanceof HTMLElement)) return fragment;
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      if (!alt || !/^https:\/\/cdn\.jsdelivr\.net\/npm\/emoji-datasource-apple(?:@[^/]+)?\/img\/apple\/64\/[0-9a-f-]+\.png$/i.test(src)) return fragment;
      const img = document.createElement('img');
      img.src = src; img.alt = alt; img.title = node.title || 'Emoji';
      img.className = 'inline-apple-emoji'; img.draggable = false;
      return img;
    }
    const mapped = ({ B: 'STRONG', I: 'EM', STRIKE: 'S', FONT: 'SPAN', H1: 'P', H2: 'P', H3: 'P', H4: 'P', H5: 'P', H6: 'P' } as Record<string, string>)[node.tagName] || node.tagName;
    const target = document.createElement(tags.has(mapped) ? mapped.toLowerCase() : 'span');
    safeStyles(node, target);
    if (/^H[1-6]$/.test(node.tagName)) target.style.fontWeight = '700';
    if (node.tagName === 'FONT' && /^#[0-9a-f]{3,8}$/i.test(node.getAttribute('color') || '')) target.style.color = node.getAttribute('color')!;
    if (['rtl', 'ltr'].includes(node.getAttribute('dir') || '')) target.dir = node.getAttribute('dir')!;
    for (const attribute of mapped === 'OL' ? ['start'] : mapped === 'LI' ? ['value'] : []) {
      const value = node.getAttribute(attribute);
      if (value && /^-?\d{1,6}$/.test(value)) target.setAttribute(attribute, value);
    }
    if (mapped === 'OL' && ['1', 'a', 'A', 'i', 'I'].includes(node.getAttribute('type') || '')) {
      target.style.listStyleType = ({ '1': 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' } as Record<string,string>)[node.getAttribute('type')!];
    }
    Array.from(node.childNodes).forEach(child => target.appendChild(clean(child)));
    if (target.tagName === 'SPAN' && !target.attributes.length) {
      while (target.firstChild) fragment.appendChild(target.firstChild);
      return fragment;
    }
    return target;
  };
  const output = document.createElement('div');
  Array.from(template.content.childNodes).forEach(node => output.appendChild(clean(node)));
  return output.innerHTML;
}

export function clipboardRichHtml(html: string, text: string) {
  if (html) return sanitizeRichHtml(html);
  const output = document.createElement('div');
  let list: HTMLElement | null = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.match(/^\s*(?:([•●▪*-])|(\d+)[.)])\s+(.*)$/);
    if (match) {
      const tag = match[2] ? 'OL' : 'UL';
      if (!list || list.tagName !== tag) {
        list = document.createElement(tag);
        if (match[2] && Number(match[2]) !== 1) list.setAttribute('start', match[2]);
        output.appendChild(list);
      }
      const item = document.createElement('li');
      item.textContent = match[3]; list.appendChild(item);
    } else {
      list = null;
      const paragraph = document.createElement('p');
      if (line) paragraph.textContent = line;
      else paragraph.appendChild(document.createElement('br'));
      output.appendChild(paragraph);
    }
  }
  return sanitizeRichHtml(output.innerHTML);
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
try {
  const page = await browser.newPage();
  const source = readFileSync(new URL('../lib/rich-text.ts', import.meta.url), 'utf8').replace(/^export /gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  await page.setContent('<div id="editor" contenteditable="true"></div><button id="list">List</button>');
  await page.addScriptTag({ content: js });
  const result = await page.evaluate(() => {
    const cases = {};
    const rich = sanitizeRichHtml('<p style="font-family:Arial;font-size:12pt;margin-bottom:12pt;line-height:18pt"><span style="font-weight:bold;font-style:italic;text-decoration:underline;color:rgb(255,0,0)">Hello</span><br>World</p>');
    cases.rich = rich.includes('font-weight: 700') && rich.includes('font-style: italic') && rich.includes('underline') && rich.includes('margin-bottom: 1em') && rich.includes('line-height: 1.5em') && !rich.includes('font-family') && !rich.includes('font-size');
    cases.idempotent = sanitizeRichHtml(rich) === rich;
    const wordClass = sanitizeRichHtml('<style>p.MsoNormal{font-family:Calibri;font-size:12pt;margin-bottom:6pt;line-height:18pt}</style><p class="MsoNormal">Text</p>');
    cases.wordClass = wordClass.includes('margin-bottom: 0.5em') && wordClass.includes('line-height: 1.5em') && !wordClass.includes('Calibri');
    const word = sanitizeRichHtml('<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">3.<span>&nbsp;</span></span><b>Third</b></p><p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">• </span>Nested</p><p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">4. </span>Fourth</p>');
    const doc = document.createElement('div'); doc.innerHTML = word;
    cases.word = doc.querySelector('ol')?.start === 3 && doc.querySelectorAll('ol > li').length === 2 && Boolean(doc.querySelector('ol > li > ul > li')) && !word.includes('mso-') && !word.includes('3.');
    cases.semantic = sanitizeRichHtml('<ol start="5" type="A"><li value="7">A<ul><li>B</li></ul></li></ol>').includes('start="5"');
    const unsafe = sanitizeRichHtml('<script>alert(1)</script><style>body{display:none}</style><img src="https://evil.test/a" onerror="alert(1)"><a href="javascript:alert(1)">safe</a><svg onload="alert(1)"></svg><p onclick="alert(1)" style="background-image:url(https://evil.test)">ok</p>');
    cases.safe = unsafe === 'safe<p>ok</p>';
    cases.plain = clipboardRichHtml('', '1. One\n2. Two\n\n• Three').includes('<ol><li>One</li><li>Two</li></ol><p><br></p><ul><li>Three</li></ul>');
    cases.arabic = sanitizeRichHtml('<p dir="rtl"><b>مرحبا</b></p><ol><li>الأول</li></ol>').includes('dir="rtl"');
    const editor = document.querySelector('#editor');
    editor.focus();
    document.execCommand('insertHTML', false, clipboardRichHtml('<ol start="3"><li><b>First</b></li><li>Second</li></ol>', ''));
    cases.insertPaste = editor.querySelectorAll('ol > li').length === 2 && editor.querySelector('ol')?.start === 3 && Boolean(editor.querySelector('strong'));
    for (const dir of ['ltr', 'rtl']) {
      editor.dir = dir;
      editor.innerHTML = '<p>One</p><p>Two</p>';
      editor.focus();
      const range = document.createRange(); range.selectNodeContents(editor);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const saved = range.cloneRange();
      document.querySelector('#list').focus();
      editor.focus(); selection.removeAllRanges(); selection.addRange(saved);
      document.execCommand('insertOrderedList', false);
      cases[dir + 'selected'] = editor.querySelectorAll('ol > li').length === 2;
      document.execCommand('insertUnorderedList', false);
      cases[dir + 'switch'] = editor.querySelectorAll('ul > li').length === 2 && !editor.querySelector('ol');
      document.execCommand('insertUnorderedList', false);
      cases[dir + 'toggle'] = !editor.querySelector('ul,ol');
    }
    return { cases, rich, word, unsafe };
  });
  for (const [name, passed] of Object.entries(result.cases)) assert.equal(passed, true, name + ': ' + JSON.stringify(result));
  console.log('PASS: rich paste, Word nested lists, spacing, font removal, sanitization, EN/AR selection, list conversion and toggle.');
} finally { await browser.close(); }

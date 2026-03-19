import { describe, it, expect } from 'vitest';
import { escHtml, renderMarkdown } from './shared';

describe('escHtml()', () => {
  it('escapes HTML special characters', () => {
    expect(escHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(escHtml('foo & bar')).toBe('foo &amp; bar');
  });
});

describe('renderMarkdown()', () => {
  it('renders bold text', () => {
    expect(renderMarkdown('**hello**')).toBe('<strong>hello</strong>');
  });

  it('converts newlines to <br>', () => {
    expect(renderMarkdown('line1\nline2')).toBe('line1<br>line2');
  });

  it('escapes HTML in plain text', () => {
    expect(renderMarkdown('<b>raw</b>')).toBe('&lt;b&gt;raw&lt;/b&gt;');
  });

  it('renders a fenced code block as <pre><code>', () => {
    const input = '```ts\nconst x = 1;\n```';
    const output = renderMarkdown(input);
    expect(output).toContain('<pre><code>');
    expect(output).toContain('const x = 1;');
    expect(output).toContain('</code></pre>');
  });

  it('escapes HTML inside code blocks', () => {
    const input = '```\n<script>alert(1)</script>\n```';
    const output = renderMarkdown(input);
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('does not double-escape code block content', () => {
    const input = '```\nconst a = b && c;\n```';
    const output = renderMarkdown(input);
    expect(output).toContain('b &amp;&amp; c');
    expect(output).not.toContain('&&');
  });

  it('handles text before and after a code block', () => {
    const input = 'Look at this:\n```\ncode here\n```\nWhat is wrong?';
    const output = renderMarkdown(input);
    expect(output).toContain('Look at this:');
    expect(output).toContain('<pre><code>');
    expect(output).toContain('code here');
    expect(output).toContain('What is wrong?');
  });

  it('handles plain text with no markdown', () => {
    expect(renderMarkdown('just text')).toBe('just text');
  });
});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { RichEditor, type RichEditorHandle } from './RichEditor';

function renderEditor(initialMarkdown: string): {
  handleRef: React.RefObject<RichEditorHandle | null>;
} {
  const handleRef = createRef<RichEditorHandle>();
  renderWithI18n(
    <RichEditor
      initialMarkdown={initialMarkdown}
      onChange={vi.fn()}
      onBlur={vi.fn()}
      ariaLabel="Note text"
      handleRef={handleRef}
      createdAt={new Date(2026, 0, 15, 9, 0).getTime()}
      updatedAt={new Date(2026, 0, 15, 9, 0).getTime()}
    />,
  );
  return { handleRef };
}

function bottomToolbar(): HTMLElement {
  return screen.getByRole('toolbar', { name: 'Formatting toolbar' });
}

function topToolbar(): HTMLElement {
  return screen.getByRole('toolbar', { name: 'Top controls' });
}

describe('the bottom toolbar', () => {
  it('renders every action with an accessible name', async () => {
    renderEditor('Some text.');
    await screen.findByLabelText('Note text');

    for (const name of ['Heading', 'Checklist', 'Bullet list', 'Bold', 'Italic', 'Highlight']) {
      expect(within(bottomToolbar()).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('applies bold to the document, not just to the button state', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Bold' }));

    expect(handleRef.current?.getMarkdown()).toBe('**word**');
  });

  it('applies highlight to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Highlight' }));

    expect(handleRef.current?.getMarkdown()).toBe('==word==');
  });

  it('applies a checklist to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Checklist' }));

    // TrailingNode (from StarterKit) appends an empty paragraph after a
    // non-textblock node such as a list, so the document also has a
    // meaningless trailing blank line; trimmed, since it is not what this
    // test is about.
    expect(handleRef.current?.getMarkdown().trim()).toBe('- [ ] word');
  });

  it('applies a bullet list to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Bullet list' }));

    expect(handleRef.current?.getMarkdown().trim()).toBe('- word');
  });

  it('applies a numbered list to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Numbered list' }));

    expect(handleRef.current?.getMarkdown().trim()).toBe('1. word');
  });

  it('applies strikethrough to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Strikethrough' }));

    expect(handleRef.current?.getMarkdown()).toBe('~~word~~');
  });

  it('applies a code block to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Code block' }));

    expect(handleRef.current?.getMarkdown().trim()).toBe('```\nword\n```');
  });

  it('applies a quote to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Quote' }));

    expect(handleRef.current?.getMarkdown().trim()).toBe('> word');
  });

  describe('the link action', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('applies a link to the document', async () => {
      vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
      const { handleRef } = renderEditor('word');
      await screen.findByLabelText('Note text');

      handleRef.current?.editor?.commands.selectAll();
      await userEvent.click(within(bottomToolbar()).getByRole('button', { name: 'Link' }));

      expect(handleRef.current?.getMarkdown()).toBe('[word](https://example.com)');
    });
  });

  it('does not offer underline, which has no markdown representation', async () => {
    renderEditor('word');
    await screen.findByLabelText('Note text');

    expect(screen.queryByRole('button', { name: /underline/i })).not.toBeInTheDocument();
  });
});

describe('the top toolbar', () => {
  it('has its own Bold button, distinguished from the bottom toolbar by the toolbar landmark', async () => {
    renderEditor('word');
    await screen.findByLabelText('Note text');

    expect(within(topToolbar()).getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(within(bottomToolbar()).getByRole('button', { name: 'Bold' })).toBeInTheDocument();
  });

  it("acts on the same document as the bottom toolbar's Bold button", async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(within(topToolbar()).getByRole('button', { name: 'Bold' }));

    expect(handleRef.current?.getMarkdown()).toBe('**word**');
  });
});

describe('the info panel', () => {
  it('counts words and characters in the document', async () => {
    renderEditor('one two three');
    await screen.findByLabelText('Note text');

    await userEvent.click(screen.getByRole('button', { name: 'Note information' }));

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
  });
});

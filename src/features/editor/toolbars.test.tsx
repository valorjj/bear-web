import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

describe('the bottom toolbar', () => {
  it('renders every action with an accessible name', async () => {
    renderEditor('Some text.');
    await screen.findByLabelText('Note text');

    for (const name of ['Heading', 'Checklist', 'Bullet list', 'Bold', 'Italic', 'Highlight']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('applies bold to the document, not just to the button state', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }));

    expect(handleRef.current?.getMarkdown()).toBe('**word**');
  });

  it('applies highlight to the document', async () => {
    const { handleRef } = renderEditor('word');
    await screen.findByLabelText('Note text');

    handleRef.current?.editor?.commands.selectAll();
    await userEvent.click(screen.getByRole('button', { name: 'Highlight' }));

    expect(handleRef.current?.getMarkdown()).toBe('==word==');
  });

  it('does not offer underline, which has no markdown representation', async () => {
    renderEditor('word');
    await screen.findByLabelText('Note text');

    expect(screen.queryByRole('button', { name: /underline/i })).not.toBeInTheDocument();
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

import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RichEditor, type RichEditorHandle } from './RichEditor';

describe('RichEditor', () => {
  it('renders the initial markdown as rich content', async () => {
    const handleRef = createRef<RichEditorHandle>();
    render(
      <RichEditor
        initialMarkdown="# Hello"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument();
  });

  it('exposes the current markdown through its handle', async () => {
    const handleRef = createRef<RichEditorHandle>();
    render(
      <RichEditor
        initialMarkdown="# Hello"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    await screen.findByRole('heading', { name: 'Hello' });
    expect(handleRef.current?.getMarkdown()).toBe('# Hello');
  });

  it('preserves an unsupported construct through the handle', async () => {
    const source = '| a |\n| --- |\n| b |';
    const handleRef = createRef<RichEditorHandle>();
    render(
      <RichEditor
        initialMarkdown={source}
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    await screen.findByLabelText('Note text');
    expect(handleRef.current?.getMarkdown()).toBe(source);
  });
});

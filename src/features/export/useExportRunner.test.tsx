import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { ExportProgressProvider } from './ExportProgressContext';
import { useExportRunner } from './useExportRunner';

vi.mock('./exportNote', () => ({
  exportNote: vi.fn(async () => undefined),
}));

/**
 * The module must be reached through `await import()`, not a static import,
 * or the whole Tiptap stack rides into the eager bundle behind it. A mock
 * alone cannot see the difference — both forms resolve to the mock — so this
 * asserts the OBSERVABLE consequence instead: the runner still works when
 * the module is only available asynchronously, and `exportNote` is called
 * with exactly what the caller passed.
 */
describe('useExportRunner', () => {
  it('runs an export through the dynamically imported module', async () => {
    const { exportNote } = await import('./exportNote');

    const { result } = renderHook(() => useExportRunner(), {
      wrapper: ({ children }) => (
        <I18nProvider>
          <ExportProgressProvider>{children}</ExportProgressProvider>
        </I18nProvider>
      ),
    });

    const note = { title: 'Title', text: 'Title\n\nBody', updatedAt: 0 };
    act(() => {
      result.current.run(note, 'md');
    });

    await waitFor(() => {
      expect(exportNote).toHaveBeenCalledWith(note, 'md', expect.any(String));
    });
    expect(result.current.failureKey).toBeNull();
  });

  it('reports a failure key when the export rejects', async () => {
    const { exportNote } = await import('./exportNote');
    vi.mocked(exportNote).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useExportRunner(), {
      wrapper: ({ children }) => (
        <I18nProvider>
          <ExportProgressProvider>{children}</ExportProgressProvider>
        </I18nProvider>
      ),
    });

    act(() => {
      result.current.run({ title: 'T', text: 'T', updatedAt: 0 }, 'md');
    });

    await waitFor(() => {
      expect(result.current.failureKey).toBe('export.failed');
    });
  });
});

import {
  lazy,
  type ReactElement,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Editor } from '@tiptap/react';

import { deriveTitle, files, folds, notes, storedImagePath } from '@/data';
import type { Note } from '@/data';
import { buildExportHtml, useExportRunner, type ExportFormat } from '@/features/export';
import { downscaleImage } from './downscale';
import {
  EMPTY_DOCUMENT_MARKDOWN,
  foldedKeys,
  normalizeMarkdown,
  RichEditor,
  type RichEditorHandle,
} from '@/features/editor';
import type { PublishedInfo } from '@/features/publish';
import { useLocale, useT } from '@/i18n';

import { BacklinksPanel } from './BacklinksPanel';
import { useAutosave } from './useAutosave';

/**
 * Lazy, and structurally so — not an optimisation.
 *
 * `scripts/bundleSize.test.ts` caps the eager JS closure and measured 455 B
 * of headroom before sub-project M. This chunk pulls in `PublishDialog`'s UI
 * AND `requestPublish.ts`'s network calls — importing either eagerly here
 * would blow the ceiling before a single byte of the feature's own i18n
 * strings counted. If that guard ever fails on this branch, something has
 * leaked across this boundary — find the leak; do not raise the number.
 */
const PublishDialogContainer = lazy(() => import('@/features/publish/PublishDialogContainer'));

/** Matches `AUTOSAVE_DELAY_MS`; folds are persisted on the same rhythm. */
const FOLD_PERSIST_DELAY_MS = 300;

export interface NoteEditorProps {
  note: Note;
  /**
   * The text this note was created with, set ONLY for a note the app just
   * created. A note created inside a tag scope is seeded with that tag, which
   * makes it non-empty and therefore immune to the blank-note purge — so tag
   * scopes would silently fill with notes nobody ever wrote in.
   *
   * Widening `isEmpty` globally to "contains only tags" was rejected: it would
   * delete a note in which the user deliberately wrote nothing but tags.
   * Scoping the rule to the just-created note leaves every existing note
   * untouched, and the truncation guard below keeps its full strength.
   */
  seedText?: string;
  /**
   * Set ONLY for a note the app just created, so the caret lands on the title
   * line and the user can name it by typing.
   *
   * Distinct from `seedText`, which is absent for a note created outside a tag
   * scope — the common case, and precisely the one that needs the caret. The
   * two cannot be collapsed into one flag.
   */
  autoFocus?: boolean;
  /**
   * Called with a tag name when the user Mod-clicks its pill. Returns whether
   * the app acted on it; `false` makes the gesture behave like a plain click.
   */
  onActivateTag?: (tag: string) => boolean;
  /**
   * Called with the normalized title when the user Mod-clicks a `[[link]]`
   * pill. Returns whether the app acted on it; `false` makes the gesture
   * behave like a plain click — same contract as `onActivateTag`.
   */
  onActivateLink?: (title: string) => boolean;
  /**
   * Called with a note's id when a row in the backlinks panel is clicked.
   * The panel itself is not rendered at all when this is omitted — kept
   * optional only to match the other callbacks' contract on this component.
   */
  onOpenNote?: (id: string) => void;
  /**
   * Exposes the mounted `RichEditor`'s imperative handle to the caller.
   * Nothing in the app passes this — `AppShell` never needs to reach the
   * editor instance directly — it exists so tests can reach
   * `handle.current.editor` the same way `RichEditor.test.tsx` does, without
   * a second, parallel ref living only in test code.
   */
  handleRef?: RefObject<RichEditorHandle | null>;
  /**
   * Exposes `handleExport` to a caller outside this component, for L4's
   * command palette: `AppShell` has no other way to reach it. Export reads
   * the LIVE editor text (`docs/rulings/export.md`), which lives only inside
   * this component via `handleRef` — there is no export path that does not
   * go through here. Kept live for as long as this note's `NoteEditor` is
   * mounted; a caller reading it while no note is open (`hasOpenNote` false
   * in `CommandDeps`, which gates whether the palette even offers an export
   * command) would find it `null`.
   */
  exportRef?: RefObject<{ export: (format: ExportFormat) => void } | null>;
}

/**
 * Must be rendered with `key={note.id}` so React remounts it on every switch.
 * The instance then knows exactly one note for its whole lifetime, which is
 * what makes `useAutosave`'s unmount flush a correct flush-on-switch.
 *
 * The editor is the sole writer of this note's text while it is open. Live
 * query updates for the open note are deliberately ignored, so nothing moves
 * the caret except the user.
 */
/**
 * Discards scheduled but not yet executed, keyed by note id.
 *
 * Lives at module scope because a remount is a new component instance: a ref
 * would start empty and cancel nothing. See `discard` below for why a
 * destructive cleanup must be cancellable at all.
 */
const pendingDiscards = new Map<string, ReturnType<typeof setTimeout>>();

export function NoteEditor({
  note,
  seedText,
  autoFocus = false,
  onActivateTag,
  onActivateLink,
  onOpenNote,
  handleRef: externalHandleRef,
  exportRef,
}: NoteEditorProps): ReactElement {
  const t = useT();
  const { locale } = useLocale();

  const internalHandleRef = useRef<RichEditorHandle | null>(null);
  const handleRef = externalHandleRef ?? internalHandleRef;

  // Sub-project M: whether the publish dialog is open, and this note's
  // published page, if any. Both reset naturally on a note switch — this
  // component is remounted per note (`key={note.id}`, see the class doc
  // above), never reused across notes.
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishedPage, setPublishedPage] = useState<PublishedInfo | null>(null);

  // Seeded from the SERIALIZED document, not from `note.text`. Opening a note
  // must never produce a write: a non-canonical note would otherwise differ
  // from its own serialization immediately and be rewritten just for being
  // looked at.
  //
  // Wrapped in try/catch for the same reason as `read`, below: serialization
  // can fail, and a failure here must degrade to the raw stored text plus a
  // visible message rather than crash the component outright.
  //
  // `seedText` is normalized the same way, once, here — but in its OWN
  // try/catch, separate from `initialMarkdown`'s. `isEmpty` below compares
  // against the MOUNTED EDITOR's serialized reading (`read()`), never against
  // raw stored text — `normalizeMarkdown` can itself change the text (for
  // instance, stripping a leading newline), so comparing a normalized reading
  // against a raw `seedText` would silently never match and the seeded-empty
  // check would never fire. A throw from normalizing the SEED is not evidence
  // the note's own text fails to serialize; sharing one try/catch would show
  // the user the serialization-failure banner, and fall back to mounting on
  // raw `note.text`, for a note that serializes perfectly well. A bad seed
  // should only cost the seed check, never the editor's confidence in itself.
  const [{ initialMarkdown, initialSerializeFailed }] = useState(() => {
    try {
      return { initialMarkdown: normalizeMarkdown(note.text), initialSerializeFailed: false };
    } catch {
      return { initialMarkdown: note.text, initialSerializeFailed: true };
    }
  });
  const [normalizedSeedText] = useState(() => {
    if (seedText === undefined) return undefined;
    try {
      return normalizeMarkdown(seedText);
    } catch {
      return seedText;
    }
  });
  const [serializeFailed, setSerializeFailed] = useState(initialSerializeFailed);
  // Its own channel rather than reusing `serializeFailed`: an export failing
  // says nothing about whether the note can be saved, and the two messages
  // must not be able to stand in for each other. The runner reports a KEY, not
  // a boolean, so a signed-out user and an offline user see different
  // sentences.
  const exportRunner = useExportRunner();

  // Set when an image is refused — too large, or something this app cannot
  // encode. Its own channel rather than reusing the save or export failures:
  // three unrelated things going wrong must not be able to stand in for each
  // other.
  const [imageFailed, setImageFailed] = useState(false);

  /**
   * Stores a pasted image and returns the Markdown destination to insert.
   *
   * `null` means refused, and the editor then inserts nothing — a 30MB paste
   * is an ordinary mistake, not an error to throw.
   */
  const handleImage = useCallback(
    async (file: Blob): Promise<string | null> => {
      const image = await downscaleImage(file);
      if (image === null) {
        setImageFailed(true);
        return null;
      }
      setImageFailed(false);
      const record = await files.add(note.id, image.blob, {
        mime: 'image/webp',
        width: image.width,
        height: image.height,
      });
      return storedImagePath(record.id);
    },
    [note.id],
  );

  const read = useCallback((): string => {
    try {
      return handleRef.current?.getMarkdown() ?? initialMarkdown;
    } catch {
      return initialMarkdown;
    }
  }, [initialMarkdown]);

  const save = useCallback(
    async (next: string) => {
      // Serialization already happened in `read`. If it threw, `read` reported
      // the last good value and there is nothing new to write.
      await notes.save(note.id, next);
    },
    [note.id],
  );

  // Guard (c) of three against the "opening a note deletes it" class of bug.
  //
  // Purging is only ever right for a note the USER emptied. A note that held
  // text when it was opened and was never touched must survive, whatever the
  // editor pipeline reports at unmount — a truncation bug upstream must cost a
  // stale render, never the note. Tracked explicitly rather than inferred from
  // comparing text, because a text comparison is exactly what a truncation bug
  // corrupts.
  const editedRef = useRef(false);
  const hadTextAtMountRef = useRef(note.text !== '' && note.text !== seedText);

  // Cancels a discard this note scheduled a moment ago. React ran a cleanup
  // and then mounted us again, so the unmount was a remount, not the user
  // leaving. Module-scope state, not a ref, because the remount is a NEW
  // component instance whose refs start empty.
  useEffect(() => {
    const pending = pendingDiscards.get(note.id);
    if (pending === undefined) return;

    clearTimeout(pending);
    pendingDiscards.delete(note.id);
  }, [note.id]);

  const discard = useCallback(async () => {
    if (hadTextAtMountRef.current && !editedRef.current) return;

    const id = note.id;

    // Deferred by a macrotask rather than run here, so a remount can cancel
    // it. React's effect cleanup is NOT a reliable "this component is going
    // away" signal — StrictMode runs mount/cleanup/mount on every mount in
    // development, `useNotes` routes every selection change through a
    // transient `undefined` that unmounts this editor, and Offscreen may do
    // the same in production. Purging straight from the cleanup meant a
    // just-created note was destroyed milliseconds after `notes.create`
    // returned it: no note could be created at all under `npm run dev`.
    //
    // React runs the remount's effects before this macrotask fires, so the
    // cancel above always wins the race when there is a remount at all. When
    // there is not, the timer fires and the note is reclaimed as before.
    clearTimeout(pendingDiscards.get(id));
    pendingDiscards.set(
      id,
      setTimeout(() => {
        pendingDiscards.delete(id);

        void (async () => {
          // A trashed note lives in the user's Trash and stays there. Without
          // this, the Delete button purged a blank note outright while
          // trashing every other note — one button, two irreversibilities,
          // decided by state the user cannot see. M6 ruled that Delete always
          // trashes; this is that ruling. The reclaim path for a blank note
          // the user simply navigates away from is untouched.
          const current = await notes.get(id);
          if (current === undefined || current.trashedAt !== null) return;

          await notes.purge(id);
        })();
      }, 0),
    );
  }, [note.id]);

  const { schedule, flush, seed, failed } = useAutosave({
    initial: initialMarkdown,
    read,
    save,
    discard,
    isEmpty: (text) =>
      text === EMPTY_DOCUMENT_MARKDOWN ||
      (normalizedSeedText !== undefined && text === normalizedSeedText),
  });

  // Guard (b). `initialMarkdown` above is what the MANAGER produces from the
  // stored text; what matters for "opening a note writes nothing" is what the
  // MOUNTED EDITOR produces, and the two agreeing is an assumption, not a fact.
  // Adopting the editor's own reading as the baseline makes the rule hold by
  // construction instead of by two components happening to match.
  //
  // Safe to do in an effect: React runs a child's effects before its parent's,
  // so `RichEditor` has already published its handle by the time this runs, and
  // nothing can have flushed yet — every flush trigger (blur, debounce,
  // visibility, unmount) is strictly later.
  useEffect(() => {
    let atMount: string;
    try {
      const handle = handleRef.current;
      if (handle === null) return;
      atMount = handle.getMarkdown();
    } catch {
      // Keep the parse-time baseline; `initialSerializeFailed` already covers
      // the user-visible half of this.
      return;
    }
    seed(atMount);
  }, [seed]);

  // `RichEditor`'s own `editor` is what actually goes from `null` to ready;
  // `handleRef` is a plain ref, and reading it once from an effect keyed only
  // on `note.id` races Tiptap's construction with no way to notice if it ever
  // loses that race — which is exactly the failure mode `RichEditor.test.tsx`
  // itself has to guard against with a `waitFor`. Fold persistence subscribes
  // to this reactive signal instead, so it re-attaches if the editor is ever
  // not ready at first commit, rather than silently never running at all.
  const [foldEditor, setFoldEditor] = useState<Editor | null>(null);

  // Shared between the two effects below, so the restore effect can mark a
  // set of keys as "already accounted for" BEFORE dispatching the command
  // that applies them — see the long comment inside the persist effect for
  // why this has to be shared state rather than each effect's own local.
  const lastFoldedKeysRef = useRef('');

  // Folds are loaded once per mount. `NoteEditor` is keyed by `note.id`, so
  // one mounted editor serves exactly one note for its lifetime — the same
  // property that makes its autosave flush-on-unmount correct — and no
  // cross-note reconciliation is needed here.
  useEffect(() => {
    if (!foldEditor) return;
    let cancelled = false;
    void folds.get(note.id).then((keys) => {
      if (cancelled || keys.length === 0) return;
      // Recorded BEFORE dispatching, not after: `setHeadingFolds` fires its
      // transaction synchronously, so if the persist effect's own change
      // detector ran first it would see the empty starting state and read
      // this restore as a brand-new fold to write straight back. Marking the
      // restored set as "already the last known state" first closes that
      // race instead of merely hoping the two effects commit in a lucky order.
      lastFoldedKeysRef.current = keys.join('|');
      foldEditor.commands.setHeadingFolds(keys);
    });
    return () => {
      cancelled = true;
    };
  }, [note.id, foldEditor]);

  // Persisted on change, debounced, fire-and-forget. The fold has ALREADY
  // applied in plugin state by the time this runs, so a failed write costs a
  // fold and never content — which is why it is deliberately not awaited and
  // deliberately does not surface an error.
  useEffect(() => {
    if (!foldEditor) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: string[] | null = null;

    const onTransaction = (): void => {
      const keys = foldedKeys(foldEditor.state);
      const serialized = keys.join('|');
      if (serialized === lastFoldedKeysRef.current) return;
      lastFoldedKeysRef.current = serialized;
      pending = keys;
      clearTimeout(timer);
      timer = setTimeout(() => {
        pending = null;
        // A rejected write (IndexedDB refusing it, say) must cost only a
        // fold, never surface as an unhandled promise rejection — the same
        // "a failed write costs a fold, never content" rule as everywhere
        // else fold persistence is fire-and-forget in this file.
        void folds.set(note.id, keys).catch(() => {});
      }, FOLD_PERSIST_DELAY_MS);
    };

    // Seeded from the editor's own reading, matching whatever the restore
    // effect above has (or has not yet) applied.
    lastFoldedKeysRef.current = foldedKeys(foldEditor.state).join('|');

    foldEditor.on('transaction', onTransaction);
    return () => {
      foldEditor.off('transaction', onTransaction);
      clearTimeout(timer);
      // Flushes a fold made in the last debounce window rather than dropping
      // it, mirroring `useAutosave`'s flush-on-unmount for the same reason:
      // `NoteEditor` remounts on every note switch, so this cleanup runs
      // routinely, not just on a genuine teardown, and a fold made moments
      // before switching notes must not be silently lost.
      if (pending !== null) {
        // Same reasoning as the debounced write above: a rejected flush must
        // not become an unhandled rejection during teardown.
        void folds.set(note.id, pending).catch(() => {});
      }
    };
  }, [note.id, foldEditor]);

  const onChange = useCallback(() => {
    editedRef.current = true;
    try {
      handleRef.current?.getMarkdown();
      setSerializeFailed(false);
      schedule();
    } catch {
      // A serialization failure happens BEFORE any write. `notes.save` is never
      // called, so the stored Markdown is untouched by construction rather than
      // by discipline. The document stays in memory and the next edit retries.
      setSerializeFailed(true);
    }
  }, [schedule]);

  // Exports what is ON SCREEN, not `note.text`. The stored text lags the editor
  // by the autosave debounce, so exporting the record would silently hand the
  // user a file missing their last few seconds of typing. The title is derived
  // from the same live text for the same reason.
  // Exports what is ON SCREEN, not `note.text`. The stored text lags the
  // editor by the autosave debounce, so exporting the record would silently
  // hand the user a file missing their last few seconds of typing. The title
  // is derived from the same live text for the same reason. (The note list's
  // row menu has no live editor to read and exports the record — correct
  // there, because a row the user is not editing has nothing pending.)
  const { run: runExport } = exportRunner;

  const handleExport = useCallback(
    (format: ExportFormat): void => {
      const text = handleRef.current?.getMarkdown() ?? note.text;
      runExport({ title: deriveTitle(text), text, updatedAt: note.updatedAt }, format);
    },
    [runExport, note.text, note.updatedAt],
  );

  // Kept live for exactly as long as this note's editor is mounted, and
  // cleared on unmount — a stale `export` for a note that is no longer open
  // must not be callable through a ref that outlives it.
  useEffect(() => {
    if (exportRef === undefined) return;
    exportRef.current = { export: handleExport };
    return () => {
      exportRef.current = null;
    };
  }, [exportRef, handleExport]);

  // Reads what is ON SCREEN, exactly like `handleExport` above and for the
  // same reason — the stored record lags the live editor by the autosave
  // debounce. Only called once the user clicks "Publish to web" inside the
  // dialog, never eagerly, so the images/diagrams pass this triggers costs
  // nothing until then.
  const handlePublishBuildHtml = useCallback(async (): Promise<string> => {
    const text = handleRef.current?.getMarkdown() ?? note.text;
    return buildExportHtml({ title: deriveTitle(text), text, updatedAt: note.updatedAt }, locale);
  }, [note.text, note.updatedAt, locale]);

  return (
    <div className="flex h-full flex-col">
      <RichEditor
        initialMarkdown={initialMarkdown}
        autoFocus={autoFocus}
        onChange={onChange}
        onBlur={flush}
        ariaLabel={t('editor.textarea')}
        handleRef={handleRef}
        createdAt={note.createdAt}
        updatedAt={note.updatedAt}
        onActivateTag={onActivateTag}
        onActivateLink={onActivateLink}
        onExport={handleExport}
        onPublish={() => setPublishOpen(true)}
        onImage={handleImage}
        onEditorReady={setFoldEditor}
      />

      {publishOpen && (
        <Suspense fallback={null}>
          <PublishDialogContainer
            onClose={() => setPublishOpen(false)}
            noteId={note.id}
            title={deriveTitle(handleRef.current?.getMarkdown() ?? note.text)}
            buildHtml={handlePublishBuildHtml}
            page={publishedPage}
            onPage={setPublishedPage}
          />
        </Suspense>
      )}

      {onOpenNote !== undefined && <BacklinksPanel title={note.title} onOpenNote={onOpenNote} />}

      {(failed || serializeFailed || imageFailed || exportRunner.failureKey !== null) && (
        // `status`, not `alert`: `alert` is the degraded-storage banner's role
        // and the e2e suite asserts there is exactly one of those.
        <p role="status" className="shrink-0 border-t border-border px-6 py-2 text-xs text-muted">
          {imageFailed
            ? t('editor.image.tooLarge')
            : exportRunner.failureKey !== null
              ? t(exportRunner.failureKey)
              : serializeFailed
                ? t('editor.serializeFailed')
                : t('editor.saveFailed')}
        </p>
      )}
    </div>
  );
}

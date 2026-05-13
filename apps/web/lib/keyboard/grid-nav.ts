// Spreadsheet-style keyboard navigation for any grid that follows the
// data-cell-row / data-cell-col convention.
//
// Conventions a grid must follow to opt in:
//
//   <form ref={gridRef}>                ← attach the handler here
//     <input
//       data-cell-row="0"
//       data-cell-col="qty"            ← anything string, just be consistent
//       data-cell-grid="lines"         ← optional namespace if a page has > 1 grid
//     />
//     <input data-cell-row="0" data-cell-col="unit" data-cell-grid="lines" />
//     ...
//   </form>
//
// Handled keys:
//   Enter           → focus row+1 same col; appends a row if at last row
//   Shift+Enter     → focus row-1 same col; no-op if at row 0
//
// Tab / Shift+Tab is intentionally NOT handled — browser default is
// already correct for left/right and wraps cleanly between rows.
//
// Arrow nav is intentionally NOT handled in the foundation. Inside a
// text input, arrow keys move the caret; hijacking them creates a
// "I can't position my cursor" bug that's worse than not having it.
// A future "navigation mode" toggle (Esc to enter, Enter to type)
// could add it without breaking the cell-input contract.

export interface GridNavHandlerOptions {
  // Cell column identifiers in render order. Used to pick the column
  // we should land in if the destination row exists but happens to be
  // missing the same column (kind-specific cells). Optional —
  // currently unused but reserved for future grid layouts.
  cols?: ReadonlyArray<string>;

  // Called with the current row index when Enter is pressed on the
  // last row. The handler will THEN attempt to focus row+1 same col,
  // assuming the parent has re-rendered with the new row by then. In
  // React this happens after the next commit, so we use rAF to defer
  // the focus call.
  onAppendRow?: (currentRowIndex: number) => void;

  // Optional grid namespace, matched against data-cell-grid. Lets
  // multiple independent grids share one form root.
  gridName?: string;
}

function isCell(el: Element | null, gridName?: string): el is HTMLInputElement {
  if (!el || !(el instanceof HTMLInputElement)) return false;
  if (el.dataset.cellRow === undefined || el.dataset.cellCol === undefined) return false;
  if (gridName && el.dataset.cellGrid !== gridName) return false;
  return true;
}

function findCell(
  root: HTMLElement,
  row: number,
  col: string,
  gridName: string | undefined
): HTMLInputElement | null {
  const sel = gridName
    ? `input[data-cell-grid="${CSS.escape(gridName)}"][data-cell-row="${row}"][data-cell-col="${CSS.escape(col)}"]`
    : `input[data-cell-row="${row}"][data-cell-col="${CSS.escape(col)}"]`;
  return root.querySelector<HTMLInputElement>(sel);
}

function focusCell(input: HTMLInputElement): void {
  input.focus();
  // Select the contents so the next keystroke replaces the value, the
  // way Excel works after pressing Enter onto a populated cell.
  try {
    input.select();
  } catch {
    // Some input types (number on Safari) throw on select(); ignore.
  }
}

// Minimal subset of React's SyntheticKeyboardEvent / DOM KeyboardEvent
// the handler reads. Keeps this module React-free so it can be unit-
// tested without a renderer.
export interface GridKeyEvent {
  key: string;
  shiftKey: boolean;
  target: EventTarget | null;
  currentTarget: EventTarget;
  preventDefault: () => void;
}

export function makeGridKeyHandler(opts: GridNavHandlerOptions = {}) {
  return function onKeyDown(e: GridKeyEvent) {
    if (e.key !== 'Enter') return;

    const target = e.target as Element | null;
    if (!isCell(target, opts.gridName)) return;

    const row = Number.parseInt(target.dataset.cellRow ?? '', 10);
    const col = target.dataset.cellCol ?? '';
    if (!Number.isFinite(row) || col === '') return;

    const root = e.currentTarget as HTMLElement;

    if (e.shiftKey) {
      const dest = findCell(root, row - 1, col, opts.gridName);
      if (dest) {
        e.preventDefault();
        focusCell(dest);
      }
      return;
    }

    // Enter (no shift). Try to step down.
    const dest = findCell(root, row + 1, col, opts.gridName);
    if (dest) {
      e.preventDefault();
      focusCell(dest);
      return;
    }

    // No row below: append one and try again on the next frame, after
    // React has rendered the new row.
    if (opts.onAppendRow) {
      e.preventDefault();
      opts.onAppendRow(row);
      requestAnimationFrame(() => {
        const newDest = findCell(root, row + 1, col, opts.gridName);
        if (newDest) focusCell(newDest);
      });
    }
  };
}

'use client';

// "Shop on Amazon Business" — opens a cXML PunchOut session.
//
// The employee shops a real Amazon Business cart and submits it; Amazon posts
// the cart back to B Visible, where it becomes a DRAFT purchase order carrying
// real ASINs, real prices, and real product links. Nothing is purchased by
// this button — placing the order stays a separate, approved step.
//
// The button navigates the TOP-LEVEL window rather than opening a tab: Amazon
// returns the cart by posting a form back to us, and a popup would strand that
// POST in a window the employee has probably already closed.

import { useState, useTransition } from 'react';
import { startAmazonShoppingAction } from '../amazon-actions';

export function AmazonShopButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const result = await startAmazonShoppingAction();
      if (result.ok && result.startPageUrl) {
        window.location.href = result.startPageUrl;
        return;
      }
      setError(result.error ?? 'Could not open Amazon Business.');
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-[10px] border border-[#E7E2DA] bg-white px-4 py-2 text-[12.5px] font-bold text-[#1C4972] shadow-sm hover:bg-[#FBF8F4] disabled:opacity-50"
      >
        {pending ? 'Opening Amazon…' : 'Shop on Amazon Business'}
      </button>
      {error ? (
        <p className="max-w-[280px] text-right text-[11px] font-semibold text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}

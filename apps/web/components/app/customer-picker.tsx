'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SelectControl } from '@/components/app/select-control';

export type CustomerOption = { id: string; companyName: string };

export const NEW_CUSTOMER = '__new__';

type CustomerPickerProps = {
  /** '' (none), a client id, or NEW_CUSTOMER. */
  value: string;
  onChange: (value: string) => void;
  /** First page of customers, rendered by the server so the list isn't empty on open. */
  initialClients: CustomerOption[];
  /** Label for a preselected id that isn't in initialClients (e.g. ?clientId=). */
  initialSelectedName?: string | null;
  className?: string;
  disabled?: boolean;
};

const DEBOUNCE_MS = 200;

/**
 * Customer dropdown with server-side search.
 *
 * The tenant has ~1,800 customers, so the full list is neither shipped to the
 * browser nor filtered in it — each keystroke hits /api/clients/search, which
 * returns a capped slice. Chrome and keyboard behaviour come from
 * SelectControl so this matches every other dropdown in the app.
 */
export function CustomerPicker({
  value,
  onChange,
  initialClients,
  initialSelectedName = null,
  className,
  disabled,
}: CustomerPickerProps) {
  const [results, setResults] = useState<CustomerOption[]>(initialClients);
  const [loading, setLoading] = useState(false);

  // Every customer this component has ever seen, so the trigger can render the
  // selected customer's name even after the result list has churned past it.
  const seenRef = useRef<Map<string, string>>(
    new Map(initialClients.map((c) => [c.id, c.companyName])),
  );
  const [selectedName, setSelectedName] = useState<string | null>(initialSelectedName);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic request id — a slow response for an earlier query must never
  // overwrite the results of a later one.
  const requestSeqRef = useRef(0);

  const remember = useCallback((clients: CustomerOption[]) => {
    for (const c of clients) seenRef.current.set(c.id, c.companyName);
  }, []);

  const runSearch = useCallback(
    async (query: string, pinnedId?: string) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (pinnedId) params.set('id', pinnedId);
        const res = await fetch(`/api/clients/search?${params.toString()}`);
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        const body = (await res.json()) as { clients?: CustomerOption[] };
        if (seq !== requestSeqRef.current) return;
        const clients = body.clients ?? [];
        remember(clients);
        setResults(clients);
        if (pinnedId) {
          const hit = clients.find((c) => c.id === pinnedId);
          if (hit) setSelectedName(hit.companyName);
        }
      } catch {
        if (seq !== requestSeqRef.current) return;
        // Leave the previous results on screen; the empty state would read as
        // "no such customer", which is a worse lie than a stale list.
        setResults((prev) => prev);
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    },
    [remember],
  );

  // Resolve a preselected id we have no name for (arrived via ?clientId=).
  useEffect(() => {
    if (!value || value === NEW_CUSTOMER) return;
    if (seenRef.current.has(value) || selectedName) return;
    void runSearch('', value);
    // Intentionally mount-only: later selections always come from a list we
    // already have names for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleSearchChange = useCallback(
    (query: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!query.trim()) {
        // Reopening with an empty box: show the server's first page again
        // without waiting on a round trip.
        requestSeqRef.current++;
        setLoading(false);
        setResults(initialClients);
        return;
      }
      setLoading(true);
      timerRef.current = setTimeout(() => {
        void runSearch(query.trim());
      }, DEBOUNCE_MS);
    },
    [initialClients, runSearch],
  );

  const options = useMemo(() => {
    const rows: CustomerOption[] = [...results];
    // Keep the current selection in the list — SelectControl derives the
    // trigger label from its options, and rejects commits to unknown values.
    if (value && value !== NEW_CUSTOMER && !rows.some((c) => c.id === value)) {
      const name = seenRef.current.get(value) ?? selectedName;
      if (name) rows.unshift({ id: value, companyName: name });
    }
    return rows;
  }, [results, selectedName, value]);

  return (
    <SelectControl
      className={className}
      disabled={disabled}
      emptyLabel="No customers match"
      loading={loading}
      searchPlaceholder="Search all customers…"
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        if (next && next !== NEW_CUSTOMER) {
          setSelectedName(seenRef.current.get(next) ?? null);
        }
        onChange(next);
      }}
      onSearchChange={handleSearchChange}
    >
      <option value="">Choose customer…</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.companyName}
        </option>
      ))}
      <option value={NEW_CUSTOMER}>+ New customer…</option>
    </SelectControl>
  );
}

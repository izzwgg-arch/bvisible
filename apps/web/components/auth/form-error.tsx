export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
    >
      {message}
    </div>
  );
}

export function FormNotice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'success';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-blue-200 bg-blue-50 text-blue-800';
  return (
    <div
      role="status"
      className={`rounded-[8px] border px-3 py-2 text-[13px] ${cls}`}
    >
      {children}
    </div>
  );
}

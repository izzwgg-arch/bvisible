import { AppShell } from '@/components/app-shell';

export default function HomePage() {
  return (
    <AppShell
      pageTitle="Welcome to B Visible"
      pageSubtitle="Operations platform — sign-and-print workflows from estimate to install."
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Foundation" body="Server, deploy queue, and database scaffold are live. The first real deploy ran through the queue with an exact commit hash." />
        <Card title="Up next" body="Auth, multi-tenant routing, and the first product surface (Clients) land in subsequent deploys." />
        <Card title="Health" body="API ready at /api/health. Each deploy is reproducible from a single commit SHA." monoFooter="GET /api/health" />
      </div>

      <section className="mt-10">
        <Pillar title="Practicality is king, user-friendly is queen." body="The smallest correct thing the team can use today, polished where users actually touch it." />
      </section>
    </AppShell>
  );
}

function Card({
  title,
  body,
  monoFooter,
}: {
  title: string;
  body: string;
  monoFooter?: string;
}) {
  return (
    <article className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
      <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
        {title}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-bv-muted)]">
        {body}
      </p>
      {monoFooter ? (
        <div className="mt-4 inline-flex items-center rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 font-mono text-[12px] text-[var(--color-bv-text)]">
          {monoFooter}
        </div>
      ) : null}
    </article>
  );
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
      <p className="text-[18px] font-semibold tracking-tight text-[var(--color-bv-text)]">
        {title}
      </p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-bv-muted)]">
        {body}
      </p>
    </div>
  );
}

'use client';

import { useActionState, useState } from 'react';
import { updateTenantInvoiceProfileAction, type TenantInvoiceProfileState } from './actions';
import { FormError } from '@/components/auth/form-error';
import { adminInputClass, adminPrimaryButtonClass } from '@/components/app/admin-ui';

const INITIAL: TenantInvoiceProfileState = { error: null };
const LOGO_WIDTH = 640;
const LOGO_HEIGHT = 220;

export function TenantInvoiceProfileForm({
  tenant,
}: {
  tenant: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    slogan: string | null;
    logoDataUrl: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(updateTenantInvoiceProfileAction, INITIAL);
  const [logoDataUrl, setLogoDataUrl] = useState(tenant.logoDataUrl ?? '');
  const [logoMessage, setLogoMessage] = useState<string | null>(null);

  async function handleLogoFile(file: File | null) {
    setLogoMessage(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLogoMessage('Upload an image file. It will be converted to a clean PNG for documents.');
      return;
    }

    try {
      const converted = await convertLogoToPng(file);
      setLogoDataUrl(converted);
      setLogoMessage('Logo converted to invoice-ready PNG.');
    } catch {
      setLogoMessage('Could not convert that logo. Try a PNG, JPG, WebP, or SVG file.');
    }
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="tenantId" value={tenant.id} />
      <textarea name="logoDataUrl" value={logoDataUrl} readOnly hidden />

      <Field id="name" label="Company name" defaultValue={tenant.name} required />
      <Field id="phone" label="Company phone" defaultValue={tenant.phone ?? ''} placeholder="(555) 123-4567" />
      <Field id="email" label="Company email" type="email" defaultValue={tenant.email ?? ''} placeholder="hello@bvisible.com" />
      <Field id="slogan" label="Slogan" defaultValue={tenant.slogan ?? ''} placeholder="Signs, wraps, and visibility that sells." />

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Address</span>
        <textarea
          name="address"
          defaultValue={tenant.address ?? ''}
          rows={3}
          placeholder="Street, city, state, ZIP"
          className={`${adminInputClass} min-h-[92px] resize-y`}
        />
      </label>

      <div className="rounded-[18px] border border-slate-100 bg-slate-50/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Logo</p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              Upload an image and it converts to a polished PNG for estimates and invoices.
            </p>
          </div>
          {logoDataUrl ? (
            <button
              type="button"
              onClick={() => {
                setLogoDataUrl('');
                setLogoMessage('Logo removed.');
              }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 shadow-sm hover:bg-slate-50"
            >
              Remove
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded-[14px] border border-white bg-white shadow-inner">
            {logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoDataUrl} alt="Company logo preview" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300">No logo</span>
            )}
          </div>
          <label className="inline-flex cursor-pointer items-center justify-center rounded-[12px] bg-slate-950 px-3.5 py-2 text-[12px] font-bold text-white shadow-sm transition hover:bg-slate-800">
            Convert logo
            <input
              type="file"
              accept="image/*,.svg"
              className="sr-only"
              onChange={(event) => void handleLogoFile(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
        </div>
        {logoMessage ? <p className="mt-2 text-[12px] font-medium text-slate-500">{logoMessage}</p> : null}
      </div>

      <FormError message={state.error} />
      {state.ok ? (
        <div className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] font-medium text-emerald-800">
          Company invoice profile saved.
        </div>
      ) : null}

      <button type="submit" disabled={pending} className={adminPrimaryButtonClass}>
        {pending ? 'Saving...' : 'Save invoice profile'}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  type = 'text',
  defaultValue,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={adminInputClass}
      />
    </label>
  );
}

function convertLogoToPng(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image_failed'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = LOGO_WIDTH;
        canvas.height = LOGO_HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas_failed'));
          return;
        }

        ctx.clearRect(0, 0, LOGO_WIDTH, LOGO_HEIGHT);
        const scale = Math.min(LOGO_WIDTH / img.width, LOGO_HEIGHT / img.height, 1);
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const x = Math.round((LOGO_WIDTH - width) / 2);
        const y = Math.round((LOGO_HEIGHT - height) / 2);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, x, y, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

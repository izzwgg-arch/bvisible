import { describe, expect, it } from 'vitest';
import { renderEstimateQuoteEmail } from '@/lib/emails/estimate-quote';
import { renderInviteEmail } from '@/lib/emails/invite';
import { renderPurchaseOrderEmail } from '@/lib/emails/purchase-order';
import { BRAND_LOGO_CID } from '@/lib/emails/render';
import { renderResetEmail } from '@/lib/emails/reset';
import { renderTestEmail } from '@/lib/emails/test';

describe('transactional email renderers', () => {
  it('renders all templates with the inline brand logo and responsive shell', () => {
    const emails = [
      renderInviteEmail({
        inviteLink: 'https://bv.example/invite/token',
        role: 'ADMIN',
        tenantName: 'B Visible',
        invitedByEmail: 'admin@bv.example',
      }),
      renderResetEmail({
        resetLink: 'https://bv.example/reset/token',
        expiresInMinutes: 30,
      }),
      renderTestEmail({
        recipientEmail: 'ops@bv.example',
        sentByEmail: 'admin@bv.example',
      }),
      renderEstimateQuoteEmail({
        companyName: 'Shop Inc',
        estimateNumber: 'EST-1',
        title: 'Lobby Signs',
        quoteUrl: 'https://bv.example/quote/RAWTOKEN',
        contactName: 'Pat',
      }),
      renderPurchaseOrderEmail({
        companyName: 'Shop Inc',
        vendorName: 'Vendor Co',
        poNumber: 'PO-1',
        qboPoNumber: 'QBO-9',
        estimateNumber: 'EST-1',
        subtotalCents: 12345,
        lines: [
          {
            description: 'Printed panel',
            qtyMilli: 2000,
            unit: 'ea',
            vendorSku: 'SKU-1',
            unitCostCents: 2500,
            totalCents: 5000,
            notes: 'Matte finish',
          },
        ],
      }),
    ];

    for (const email of emails) {
      expect(email.html).toContain(`cid:${BRAND_LOGO_CID}`);
      expect(email.html).toContain('name="viewport"');
      expect(email.html).toContain('<!--[if mso]>');
      expect(email.html).toContain('B Visible');
      expect(email.text).toContain('B Visible');
    }
  });

  it('keeps estimate quote links accessible without sign-in language', () => {
    const mail = renderEstimateQuoteEmail({
      companyName: 'Shop Inc',
      estimateNumber: 'EST-1',
      title: 'Work',
      quoteUrl: 'https://bv.example/quote/RAWTOKEN',
      contactName: null,
    });

    expect(mail.html).toContain('https://bv.example/quote/RAWTOKEN');
    expect(mail.text).toContain('https://bv.example/quote/RAWTOKEN');
    expect(mail.html).toContain('A PDF copy of this estimate is attached');
    expect(mail.html).not.toContain('Sign in to your B Visible workspace');
  });

  it('renders purchase order line items in html and text fallbacks', () => {
    const mail = renderPurchaseOrderEmail({
      companyName: 'Shop Inc',
      vendorName: 'Vendor Co',
      poNumber: 'PO-12',
      qboPoNumber: null,
      estimateNumber: 'EST-7',
      subtotalCents: 7654,
      lines: [
        {
          description: 'Banner stand',
          qtyMilli: 3000,
          unit: 'ea',
          vendorSku: 'BANNER-3',
          unitCostCents: 1200,
          totalCents: 3600,
          notes: 'Ship flat',
        },
      ],
    });

    expect(mail.html).toContain('Items to fulfill');
    expect(mail.html).toContain('Banner stand');
    expect(mail.html).toContain('BANNER-3');
    expect(mail.html).toContain('Subtotal');
    expect(mail.text).toContain('Banner stand');
    expect(mail.text).toContain('BANNER-3');
    expect(mail.text).toContain('Ship flat');
  });

  it('escapes dynamic html content in rendered email bodies', () => {
    const mail = renderInviteEmail({
      inviteLink: 'https://bv.example/invite/token',
      role: 'USER',
      tenantName: 'Bad <script>alert("x")</script>',
      invitedByEmail: 'admin@bv.example',
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Bad &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
});

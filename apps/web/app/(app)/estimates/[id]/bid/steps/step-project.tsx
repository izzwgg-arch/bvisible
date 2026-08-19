'use client';

// Step 1 — Project details. Real records: customer (search / change / create),
// sales rep, project name + address, PO number, contact, dates. Every field
// autosaves (debounced) to the workflow row; customer + rep changes go
// through the existing estimate actions so the estimate record stays the
// single source of truth.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CustomerPicker, NEW_CUSTOMER } from '@/components/app/customer-picker';
import { createClientAndAttachEstimateAction, updateEstimateClientAction, updateEstimateSalesRepAction } from '../../actions';
import { useBid, StepNav } from '../bid-workspace';
import { Banner, Field, GuideCard, StepHeading, Pill } from '../bid-ui';

const BID_SOURCES = ['Bid email', 'ConstructConnect', 'SmartBid', 'BuildingConnected', 'Phone / walk-in', 'Repeat customer', 'Other'];

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

export function StepProject() {
  const { data, estimateId, readOnly, autosave, refresh, viewer } = useBid();
  const wf = data.workflow;
  const [form, setForm] = useState({
    projectName: wf.projectName ?? data.estimate.title,
    projectAddress: wf.projectAddress ?? '',
    projectContactName: wf.projectContactName ?? '',
    projectContactEmail: wf.projectContactEmail ?? '',
    projectContactPhone: wf.projectContactPhone ?? '',
    poNumber: wf.poNumber ?? '',
    customerReference: wf.customerReference ?? '',
    bidSource: wf.bidSource ?? '',
    dueDate: toDateInput(wf.dueDate),
    bidDeadline: toDateInput(wf.bidDeadline),
    internalNotes: wf.internalNotes ?? '',
  });
  const [customerValue, setCustomerValue] = useState(data.estimate.clientId);
  const [newCustomer, setNewCustomer] = useState({ companyName: '', contactName: '', email: '', phone: '' });
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [repBusy, setRepBusy] = useState(false);
  const [repError, setRepError] = useState<string | null>(null);
  const seededVersion = useRef(wf.version);

  // Re-seed from the server only when a NEWER version arrives and the user
  // has nothing unsaved (never clobber typing with a stale response).
  useEffect(() => {
    if (wf.version > seededVersion.current && !autosave.isDirty) {
      seededVersion.current = wf.version;
      setForm({
        projectName: wf.projectName ?? data.estimate.title,
        projectAddress: wf.projectAddress ?? '',
        projectContactName: wf.projectContactName ?? '',
        projectContactEmail: wf.projectContactEmail ?? '',
        projectContactPhone: wf.projectContactPhone ?? '',
        poNumber: wf.poNumber ?? '',
        customerReference: wf.customerReference ?? '',
        bidSource: wf.bidSource ?? '',
        dueDate: toDateInput(wf.dueDate),
        bidDeadline: toDateInput(wf.bidDeadline),
        internalNotes: wf.internalNotes ?? '',
      });
    }
  }, [wf, data.estimate.title, autosave.isDirty]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    autosave.queue({ [key]: value } as Record<K, string>);
  }

  async function changeCustomer(value: string) {
    setCustomerValue(value);
    setCustomerError(null);
    if (!value || value === NEW_CUSTOMER || value === data.estimate.clientId) return;
    setCustomerBusy(true);
    try {
      const r = await updateEstimateClientAction({ estimateId, clientId: value });
      if (r.error) setCustomerError(r.error);
      else refresh();
    } finally {
      setCustomerBusy(false);
    }
  }

  async function createCustomer() {
    if (!newCustomer.companyName.trim()) {
      setCustomerError('Enter the customer or company name.');
      return;
    }
    setCustomerBusy(true);
    setCustomerError(null);
    try {
      const r = await createClientAndAttachEstimateAction({ estimateId, companyName: newCustomer.companyName.trim(), contactName: newCustomer.contactName.trim() || undefined, email: newCustomer.email.trim() || undefined, phone: newCustomer.phone.trim() || undefined });
      if (r.error) setCustomerError(r.error);
      else {
        setCustomerValue(r.clientId ?? data.estimate.clientId);
        setNewCustomer({ companyName: '', contactName: '', email: '', phone: '' });
        refresh();
      }
    } finally {
      setCustomerBusy(false);
    }
  }

  async function changeRep(id: string) {
    if (!id) return;
    setRepBusy(true);
    setRepError(null);
    try {
      const r = await updateEstimateSalesRepAction({ estimateId, salesRepId: id });
      if (r.error) setRepError(r.error);
      else refresh();
    } finally {
      setRepBusy(false);
    }
  }

  const client = data.estimate.client;
  const complete = !!form.projectName.trim() && !!client.companyName;
  const beforeSend = useMemo(() => {
    const missing: string[] = [];
    if (!client.email) missing.push('customer email');
    if (!form.projectAddress.trim() && !client.address) missing.push('project or customer address');
    return missing;
  }, [client.email, client.address, form.projectAddress]);
  const dis = readOnly;

  return (
    <>
      <StepHeading step={1} title="Start with the project information" description="Enter what is known now. Missing customer details will not stop pricing, but they must be completed before the estimate is sent." actions={<StepNav next={2} nextLabel="Save and continue →" />} />

      <div className="bidw-layout">
        <div className="bidw-stack">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Customer</h2>
                <p>Reused from the customer list — search, change, or add a new customer. Never a duplicate record.</p>
              </div>
              <Pill tone={client.email ? 'green' : 'yellow'}>{client.email ? 'Complete' : 'Email missing'}</Pill>
            </div>
            <div className="card-body">
              <div className="form-grid">
                <Field id="bid-customer" label="Customer / company" required="now" wide>
                  <div id="bid-customer">
                    <CustomerPicker value={customerValue} onChange={(v) => void changeCustomer(v)} initialClients={data.clients} initialSelectedName={client.companyName} disabled={dis || customerBusy} />
                  </div>
                </Field>
                {customerValue === NEW_CUSTOMER && !dis ? (
                  <>
                    <Field id="new-customer-name" label="New customer name" required="now">
                      <input id="new-customer-name" className="input" value={newCustomer.companyName} onChange={(e) => setNewCustomer((c) => ({ ...c, companyName: e.target.value }))} placeholder="Company or customer" />
                    </Field>
                    <Field id="new-customer-contact" label="Contact name" required="optional">
                      <input id="new-customer-contact" className="input" value={newCustomer.contactName} onChange={(e) => setNewCustomer((c) => ({ ...c, contactName: e.target.value }))} />
                    </Field>
                    <Field id="new-customer-email" label="Contact email" required="before-send">
                      <input id="new-customer-email" className="input" type="email" value={newCustomer.email} onChange={(e) => setNewCustomer((c) => ({ ...c, email: e.target.value }))} />
                    </Field>
                    <Field id="new-customer-phone" label="Phone" required="optional">
                      <input id="new-customer-phone" className="input" value={newCustomer.phone} onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))} />
                    </Field>
                    <div className="field-wide bidw-actions">
                      <button type="button" className="btn btn-primary btn-sm" disabled={customerBusy} onClick={() => void createCustomer()}>
                        {customerBusy ? 'Creating…' : 'Create customer and attach'}
                      </button>
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setCustomerValue(data.estimate.clientId)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <div className="field-wide kv" aria-label="Selected customer">
                    <span>Company</span>
                    <strong>{client.companyName}</strong>
                    <span>Contact</span>
                    <div>{client.contactName ?? <em style={{ color: 'var(--muted)' }}>not on file</em>}</div>
                    <span>Email</span>
                    <div>{client.email ?? <em style={{ color: 'var(--muted)' }}>not on file — required before sending</em>}</div>
                    <span>Phone</span>
                    <div>{client.phone ?? <em style={{ color: 'var(--muted)' }}>not on file</em>}</div>
                    <span>Address</span>
                    <div style={{ whiteSpace: 'pre-line' }}>{client.address ?? <em style={{ color: 'var(--muted)' }}>not on file</em>}</div>
                  </div>
                )}
                {customerError ? <p className="field-error field-wide">{customerError}</p> : null}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Project details</h2>
                <p>Information taken from the bid email and plans.</p>
              </div>
              <Pill tone={complete ? 'green' : 'yellow'}>{complete ? 'Complete' : 'In progress'}</Pill>
            </div>
            <div className="card-body">
              <div className="form-grid">
                <Field id="project-name" label="Project name" required="now">
                  <input id="project-name" className="input" value={form.projectName} disabled={dis} onChange={(e) => update('projectName', e.target.value)} placeholder="e.g. Azura Phase 1" />
                </Field>
                <Field id="due-date" label="Bid due date" required="optional">
                  <input id="due-date" className="input" type="date" value={form.dueDate} disabled={dis} onChange={(e) => update('dueDate', e.target.value)} />
                </Field>
                <Field id="project-address" label="Project location" required="before-send" wide note="Use the job name and location exactly as shown on the plans.">
                  <input id="project-address" className="input" value={form.projectAddress} disabled={dis} onChange={(e) => update('projectAddress', e.target.value)} placeholder="Street, city, state" />
                </Field>
                <Field id="estimator" label="Bid estimator / sales rep" required="now" error={repError}>
                  <select id="estimator" className="input" value={data.estimate.salesRepId ?? ''} disabled={dis || repBusy} onChange={(e) => void changeRep(e.target.value)}>
                    {!data.estimate.salesRepId ? <option value="">Select…</option> : null}
                    {data.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name ?? u.email}
                        {u.id === viewer.id ? ' (you)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="bid-source" label="Bid source" required="optional">
                  <select id="bid-source" className="input" value={form.bidSource} disabled={dis} onChange={(e) => update('bidSource', e.target.value)}>
                    <option value="">Select…</option>
                    {BID_SOURCES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field id="po-number" label="Customer PO number" required="optional" hint="when applicable">
                  <input id="po-number" className="input" value={form.poNumber} disabled={dis} onChange={(e) => update('poNumber', e.target.value)} />
                </Field>
                <Field id="customer-ref" label="Customer reference / bid number" required="optional">
                  <input id="customer-ref" className="input" value={form.customerReference} disabled={dis} onChange={(e) => update('customerReference', e.target.value)} />
                </Field>
                <Field id="bid-deadline" label="Bid deadline" required="optional" hint="if different from due date">
                  <input id="bid-deadline" className="input" type="date" value={form.bidDeadline} disabled={dis} onChange={(e) => update('bidDeadline', e.target.value)} />
                </Field>
                <Field id="estimate-number" label="Estimate number">
                  <input id="estimate-number" className="input" value={data.estimate.number} readOnly />
                </Field>
                <Field id="contact-name" label="Project contact" required="optional">
                  <input id="contact-name" className="input" value={form.projectContactName} disabled={dis} onChange={(e) => update('projectContactName', e.target.value)} placeholder="Name" />
                </Field>
                <Field id="contact-email" label="Project contact email" required="optional">
                  <input id="contact-email" className="input" type="email" value={form.projectContactEmail} disabled={dis} onChange={(e) => update('projectContactEmail', e.target.value)} />
                </Field>
                <Field id="contact-phone" label="Project contact phone" required="optional">
                  <input id="contact-phone" className="input" value={form.projectContactPhone} disabled={dis} onChange={(e) => update('projectContactPhone', e.target.value)} />
                </Field>
                <Field id="internal-notes" label="Internal project notes" required="optional" wide note="Never shown to the customer.">
                  <textarea id="internal-notes" className="input" value={form.internalNotes} disabled={dis} onChange={(e) => update('internalNotes', e.target.value)} />
                </Field>
              </div>
            </div>
          </div>

          {beforeSend.length > 0 ? (
            <Banner tone="info">
              <span>
                <strong>Required before sending:</strong> {beforeSend.join(', ')}. Pricing can continue now.
              </span>
            </Banner>
          ) : null}
        </div>

        <GuideCard
          kicker="What this step does"
          title="Creates one organized home for the bid"
          intro="The project information follows the takeoff, questions, pricing, and final estimate."
          items={[
            { mark: '1', text: 'Use the job name and location exactly as shown on the plans.' },
            { mark: '2', text: 'Add the customer from the original bid email.' },
            { mark: '3', text: 'If something is missing, continue pricing and return to it later.' },
          ]}
          tip={<><strong>Why it matters:</strong> This prevents the correct takeoff from being attached to the wrong customer or job.</>}
        />
      </div>

      <StepNav next={2} />
    </>
  );
}

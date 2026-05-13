// Acceptance check: every required string is present in the relevant doc.
const fs = require('fs');

const checks = [
  ['CURSOR_START_HERE.md', 'docs/ai-context/CURSOR_START_HERE.md', [
    'Practicality is king, user-friendly is queen',
    'Read this file first',
    'Do not analyze the whole repo',
    'Do not change unrelated files',
    'root cause + file plan',
    'Git-first deploy',
    'commitHash',
    'Only one deploy at a time',
    'tenantId',
    'Task routing table',
    'server / deployment | ',
    'UI / theme | ',
    'database | ',
    'estimates | ',
    'purchase orders | ',
    'vendors / pricing | ',
    'email ingestion | ',
    'notifications | ',
    'mobile | ',
    'auth / permissions | ',
    'debugging | ',
  ]],
  ['ESTIMATE_ENGINE.md', 'docs/ai-context/ESTIMATE_ENGINE.md', [
    'Materials  = unit_cost', 'Machines   = hours', 'Shop labor = hours', 'Design     = 150',
    'Install    = hours', 'Raw cost', 'Final sell price = Raw cost \u00d7 3',
    'sqft = width_inches', '$4.00 per sq ft', '$3.00 per sq ft', '200 sq ft', '$45.00', '$0.50',
    '90.78', '68.77', '33.45', '44.21',
    'Channel-letter formula', 'size_multiplier', 'complexity_multiplier', 'Manual overrides',
  ]],
  ['PO_SYSTEM.md', 'docs/ai-context/PO_SYSTEM.md', [
    'PO is the master file', 'qboPoNumber', 'QuickBooks PO number', 'Vendor reply routing',
    'Mobile receipts', 'Timeline',
  ]],
  ['EMAIL_INGESTION.md', 'docs/ai-context/EMAIL_INGESTION.md', [
    'Google Workspace', 'app password', 'IMAP', 'SMTP', 'Inbox scan',
    'PO number', 'messageId', 'Attachment', 'Review queue',
  ]],
  ['VENDOR_PRICE_ENGINE.md', 'docs/ai-context/VENDOR_PRICE_ENGINE.md', [
    'Cheapest vendor', 'Vendor matching', 'Item alias', 'Lower-price detection',
    'VendorPriceHistory', 'manual-dismiss',
  ]],
  ['UI_SYSTEM.md', 'docs/ai-context/UI_SYSTEM.md', [
    'SaaS 2026', 'Sidebar', 'sliding drawer', 'Card', 'Rounded corners',
    'Soft shadows', 'Badge', 'Table', 'Empty state', 'raw JSON', 'B Visible',
    'Practicality is king, user-friendly is queen',
  ]],
  ['DEPLOYMENT.md', 'docs/ai-context/DEPLOYMENT.md', [
    '212.56.32.136', 'Ubuntu 24.04', '/opt/bvisible', 'deploy', 'Git-first',
    'commitHash', 'bvisible-deploy', 'bvisible-status', '30s',
    '/opt/bvisible/shared/env/.env', 'Only SSH/HTTP/HTTPS',
  ]],
  ['DEPLOY_QUEUE.md', 'docs/ai-context/DEPLOY_QUEUE.md', [
    '/opt/bvisible/deploy-queue', 'flock',
    'jobs/', 'running/', 'done/', 'failed/', 'logs/', 'bvisible-deploy', 'bvisible-status',
    'every 30 seconds', 'commitHash',
  ]],
  ['DEBUGGING.md', 'docs/ai-context/DEBUGGING.md', [
    'deploy queue', 'stuck lock', 'systemd', 'nginx', 'Docker', 'Build failures',
    'Healthcheck', 'Disk', 'memory', 'Email ingestion', 'Tenant-scope',
    'Prisma', 'hydration', 'Never log secrets',
  ]],
  ['CHANGELOG_AI.md', 'docs/ai-context/CHANGELOG_AI.md', [
    'AI context foundation', 'Files touched', 'No app behavior changed', 'Verification',
  ]],
  ['CURSOR_PROMPT_TEMPLATE.md', 'docs/prompts/CURSOR_PROMPT_TEMPLATE.md', [
    'Read docs/ai-context/CURSOR_START_HERE.md first.',
    'STANDARD END-OF-TASK DOC UPDATE:',
  ]],
];

let pass = 0, fail = 0;
for (const [name, path, needles] of checks) {
  const text = fs.readFileSync(path, 'utf8').toLowerCase();
  for (const n of needles) {
    if (text.includes(n.toLowerCase())) pass++;
    else { fail++; console.log('MISS in ' + name + ': ' + JSON.stringify(n)); }
  }
}
console.log('---');
console.log('PASS=' + pass + ' FAIL=' + fail);
process.exit(fail === 0 ? 0 : 1);

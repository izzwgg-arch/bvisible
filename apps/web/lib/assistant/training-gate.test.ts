import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Role } from '@bvisible/db';
import { canTrainAssistant, parseTrainingCommand } from './agent';

describe('canTrainAssistant', () => {
  it('lets admins and super admins train the assistant', () => {
    expect(canTrainAssistant(Role.ADMIN)).toBe(true);
    expect(canTrainAssistant(Role.SUPER_ADMIN)).toBe(true);
  });

  it('keeps plain users out of the memory bank', () => {
    expect(canTrainAssistant(Role.USER)).toBe(false);
  });
});

describe('parseTrainingCommand', () => {
  it('recognises the teach commands', () => {
    expect(parseTrainingCommand('remember: install is always a final price')).toEqual({
      kind: 'teach',
      text: 'install is always a final price',
    });
    expect(parseTrainingCommand('Correction — lightbox faces use Dura-Bond')?.kind).toBe('teach');
    expect(parseTrainingCommand('RULE: never mark up sq-ft prices')?.kind).toBe('teach');
  });

  it('recognises the forget command', () => {
    expect(parseTrainingCommand('forget: LED modules every 0.5 sq ft')).toEqual({
      kind: 'forget',
      text: 'LED modules every 0.5 sq ft',
    });
  });

  it('leaves ordinary messages to the model (a keyword alone is not a command)', () => {
    expect(parseTrainingCommand('remember to call Joe about the pylon sign')).toBeNull();
    expect(parseTrainingCommand('can you forget the last estimate?')).toBeNull();
    expect(parseTrainingCommand('make me a stop sign estimate')).toBeNull();
  });
});

// The gate has to hold in three independent places; a refactor that drops
// any one of them silently re-opens memory writes to every user.
describe('assistant training gate (static contracts)', () => {
  it('withholds the memory tools from non-admin turns', async () => {
    const src = await readFile(new URL('./agent.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/function toolsForActor\(canTrain: boolean\)[\s\S]*?canTrain \? \[\.\.\.TOOL_DEFS, \.\.\.TRAINING_TOOL_DEFS\] : \[\.\.\.TOOL_DEFS\]/);
    expect(src).toContain('tools: toolsForActor(canTrain)');
    // save_memory / forget_memory live in the admin-only list, not TOOL_DEFS.
    const openTools = src.slice(src.indexOf('const TOOL_DEFS'), src.indexOf('const TRAINING_TOOL_DEFS'));
    expect(openTools).not.toContain("name: 'save_memory'");
    expect(openTools).not.toContain("name: 'forget_memory'");
  });

  it('re-checks the role at the write, not just in the tool list', async () => {
    const src = await readFile(new URL('./agent.ts', import.meta.url), 'utf8');
    expect(src).toMatch(
      /if \(\(name === 'save_memory' \|\| name === 'forget_memory'\) && !canTrainAssistant\(me\.role\)\)/
    );
  });

  it('refuses the explicit training command for non-admins', async () => {
    const src = await readFile(new URL('./agent.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('async function runTrainingCommand'), src.indexOf('export async function runAssistant'));
    expect(fn).toMatch(/if \(!canTrainAssistant\(me\.role\)\)[\s\S]*?TRAINING_DENIED/);
  });

  it('takes the role from the session, never from the request body', async () => {
    const src = await readFile(new URL('../../app/api/assistant/route.ts', import.meta.url), 'utf8');
    expect(src).toContain('const actor: AssistantActor = { id: me.id, tenantId: me.tenantId, role: me.role }');
    expect(src).not.toMatch(/body\.role/);
  });

  it('gates the manual training panel actions on ADMIN+', async () => {
    const src = await readFile(new URL('../../app/(app)/assistant/memory-actions.ts', import.meta.url), 'utf8');
    const guards = src.match(/requireRoleWithEffectiveCompany\(Role\.ADMIN, Role\.SUPER_ADMIN\)/g) ?? [];
    expect(guards.length).toBe(2); // teach + forget
  });
});

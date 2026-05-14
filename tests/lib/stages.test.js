import { describe, it, expect } from 'vitest';
import { LATER_STAGE_STATUSES, requiresRepairCancelledConfirm, shouldAutoClearRepairCancelled } from '../../src/lib/stages.js';

describe('LATER_STAGE_STATUSES', () => {
  it('includes b_wait', () => {
    expect(LATER_STAGE_STATUSES.has('b_wait')).toBe(true);
  });
  it('does not include received', () => {
    expect(LATER_STAGE_STATUSES.has('received')).toBe(false);
  });
});

describe('requiresRepairCancelledConfirm', () => {
  it('returns true when 後工程→received and not already cancelled', () => {
    expect(requiresRepairCancelledConfirm({ status: 'b_wait', repairCancelled: false }, 'received')).toBe(true);
  });
  it('returns false when already repairCancelled', () => {
    expect(requiresRepairCancelledConfirm({ status: 'b_wait', repairCancelled: true }, 'received')).toBe(false);
  });
  it('returns false when newStatus is not received', () => {
    expect(requiresRepairCancelledConfirm({ status: 'b_wait' }, 'b_doing')).toBe(false);
  });
  it('returns false when from received', () => {
    expect(requiresRepairCancelledConfirm({ status: 'received' }, 'received')).toBe(false);
  });
});

describe('shouldAutoClearRepairCancelled', () => {
  it('returns true when repairCancelled and moving to 後工程', () => {
    expect(shouldAutoClearRepairCancelled({ status: 'received', repairCancelled: true }, 'b_wait')).toBe(true);
  });
  it('returns false when not repairCancelled (NO-OP condition)', () => {
    expect(shouldAutoClearRepairCancelled({ status: 'received', repairCancelled: false }, 'b_wait')).toBe(false);
  });
  it('returns false when newStatus is received', () => {
    expect(shouldAutoClearRepairCancelled({ status: 'b_wait', repairCancelled: true }, 'received')).toBe(false);
  });
});

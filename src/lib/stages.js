// Status 分類の単一source of truth。App.jsx と _stealth-wipe-detect.mjs 双方が import。

export const LATER_STAGE_STATUSES = new Set([
  'b_wait', 'b_doing', 'b_done_p_wait', 'p_only', 'prep', 'prep_done', 'prep_p',
  'painting', 'assembly_wait', 'assembly', 'polish', 'polishing',
  'completed', 'assembly_done_both', 'assembly_done_nuri', 'polish_done',
  'delivery_wait', 'delivery_today', 'delivered_unpaid', 'delivered_paid'
]);

// 修理中止確認モーダルが必要か判定する純関数
// （後工程経験ありで received へ戻すが、まだ repairCancelled が立ってない場合に true）
export function requiresRepairCancelledConfirm(task, newStatus) {
  if (!task) return false;
  if (newStatus !== 'received') return false;
  if (task.repairCancelled === true) return false;
  return LATER_STAGE_STATUSES.has(task.status);
}

// 後工程→入庫済み 以外の遷移で repairCancelled を自動 false 化すべきか判定
// （修理中止カードが再進行した場合のフラグクリア）
export function shouldAutoClearRepairCancelled(task, newStatus) {
  if (!task) return false;
  if (task.repairCancelled !== true) return false;
  return LATER_STAGE_STATUSES.has(newStatus);
}

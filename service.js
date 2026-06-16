const store = require('./store');

const { STATUS, STATUS_LABEL, USERS, loadData, saveData, genId, nowISO, addDays, isOverdue, matchAttachmentToMissing } = store;

function listReimbursements(filter = {}) {
  const data = loadData();
  let list = [...data.reimbursements];
  if (filter.status) {
    list = list.filter(r => r.status === filter.status);
  }
  if (filter.applicantId) {
    list = list.filter(r => r.applicantId === filter.applicantId);
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list.map(r => decorateReimbursement(r));
}

function decorateReimbursement(r) {
  const data = loadData();
  const applicant = USERS.find(u => u.id === r.applicantId);
  const reminders = data.reminders.filter(rm => rm.reimbursementId === r.id);
  const totalRemindCount = reminders.reduce((sum, rm) => sum + (rm.remindCount || 0), 0);
  const overdue = r.status === STATUS.PENDING_SUPPLEMENT && r.deadline && isOverdue(r.deadline);
  return {
    ...r,
    statusLabel: STATUS_LABEL[r.status],
    applicantName: applicant ? applicant.name : '未知',
    reminderCount: reminders.length,
    remindCount: totalRemindCount,
    lastReminderAt: reminders.length > 0 ? reminders[reminders.length - 1].remindedAt : null,
    overdue
  };
}

function getReimbursement(id) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) return null;
  return decorateReimbursement(r);
}

function getReimbursementDetail(id) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) return null;
  const reminders = data.reminders.filter(rm => rm.reimbursementId === id)
    .sort((a, b) => new Date(b.remindedAt) - new Date(a.remindedAt));
  const logs = data.operationLogs.filter(l => l.reimbursementId === id)
    .sort((a, b) => new Date(b.operatedAt) - new Date(a.operatedAt));
  return {
    ...decorateReimbursement(r),
    reminders,
    operationLogs: logs
  };
}

function bumpVersion(r) {
  r.version = (r.version || 1) + 1;
  r.updatedAt = nowISO();
}

function checkVersion(r, expectedVersion) {
  if (expectedVersion !== undefined && expectedVersion !== null) {
    const currentVersion = r.version || 1;
    if (currentVersion !== expectedVersion) {
      throw new Error('版本冲突：该单据已被他人修改，请刷新后重试');
    }
  }
}

function createReimbursement(payload, operatorId) {
  const data = loadData();
  const id = genId(data, 'BX');
  const now = nowISO();
  const r = {
    id,
    title: payload.title,
    amount: payload.amount,
    type: payload.type || '差旅费',
    description: payload.description || '',
    applicantId: operatorId,
    status: STATUS.PENDING_AUDIT,
    attachments: payload.attachments || [],
    missingAttachments: [],
    rejectReason: null,
    deadline: null,
    supplementCycle: 0,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  data.reimbursements.push(r);
  logOperation(data, id, operatorId, 'create', '创建报销单');
  saveData(data);
  return getReimbursement(id);
}

function logOperation(data, reimbursementId, operatorId, action, remark = '') {
  const operator = USERS.find(u => u.id === operatorId);
  data.operationLogs.push({
    id: genId(data, 'LOG'),
    reimbursementId,
    operatorId,
    operatorName: operator ? operator.name : '未知',
    operatorRole: operator ? operator.role : 'unknown',
    action,
    remark,
    operatedAt: nowISO()
  });
}

function assertRole(userId, allowedRoles) {
  const user = USERS.find(u => u.id === userId);
  if (!user) throw new Error('用户不存在');
  if (!allowedRoles.includes(user.role)) {
    throw new Error('无权限执行此操作');
  }
}

function assertStatus(r, allowedStatuses, msg = '当前状态不允许此操作') {
  if (!allowedStatuses.includes(r.status)) {
    throw new Error(msg);
  }
}

function auditReject(id, operatorId, reason, expectedVersion) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  checkVersion(r, expectedVersion);
  assertRole(operatorId, ['auditor', 'finance']);
  assertStatus(r, [STATUS.PENDING_AUDIT, STATUS.PENDING_REVIEW]);
  r.status = STATUS.REJECTED;
  r.rejectReason = reason;
  bumpVersion(r);
  logOperation(data, id, operatorId, 'reject', `驳回，原因：${reason}`);
  saveData(data);
  return getReimbursement(id);
}

function auditRequestSupplement(id, operatorId, missingAttachments, deadlineDays = 3, expectedVersion) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  checkVersion(r, expectedVersion);
  assertRole(operatorId, ['auditor', 'finance']);
  assertStatus(r, [STATUS.PENDING_AUDIT, STATUS.PENDING_REVIEW], '仅待审核/待复核状态可发起补件');
  const missing = Array.isArray(missingAttachments) ? missingAttachments : [];
  if (missing.length === 0) {
    throw new Error('请指定缺失的附件');
  }
  r.status = STATUS.PENDING_SUPPLEMENT;
  r.missingAttachments = missing;
  r.supplementCycle = (r.supplementCycle || 0) + 1;
  const now = nowISO();
  r.deadline = addDays(now, deadlineDays);
  bumpVersion(r);
  const op = USERS.find(u => u.id === operatorId);
  const applicant = USERS.find(u => u.id === r.applicantId);
  logOperation(data, id, operatorId, 'request_supplement',
    `发起补件，缺失：${missing.join('、')}，截止：${r.deadline.slice(0, 10)}`);
  const reminder = {
    id: genId(data, 'RM'),
    reimbursementId: id,
    cycle: r.supplementCycle,
    operatorId,
    operatorName: op ? op.name : '未知',
    message: `请补充以下附件：${missing.join('、')}`,
    deadline: r.deadline,
    remindedAt: now,
    lastRemindedAt: now,
    remindCount: 1,
    lastRemindedBy: op ? op.name : '未知',
    assigneeId: r.applicantId,
    assigneeName: applicant ? applicant.name : '未知'
  };
  data.reminders.push(reminder);
  saveData(data);
  return getReimbursement(id);
}

function remindAgain(id, operatorId, expectedVersion) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  checkVersion(r, expectedVersion);
  assertRole(operatorId, ['auditor', 'finance']);
  assertStatus(r, [STATUS.PENDING_SUPPLEMENT], '仅待补件状态可催办');
  const cycle = r.supplementCycle;
  let reminder = data.reminders.find(rm => rm.reimbursementId === id && rm.cycle === cycle);
  const op = USERS.find(u => u.id === operatorId);
  const applicant = USERS.find(u => u.id === r.applicantId);
  const now = nowISO();
  if (reminder) {
    reminder.remindCount += 1;
    reminder.lastRemindedBy = op ? op.name : '未知';
    reminder.lastRemindedAt = now;
    logOperation(data, id, operatorId, 'remind_again',
      `第${reminder.remindCount}次催办（同一补件周期，历史合并，首次催办时间保留）`);
  } else {
    reminder = {
      id: genId(data, 'RM'),
      reimbursementId: id,
      cycle,
      operatorId,
      operatorName: op ? op.name : '未知',
      message: '请尽快补充材料',
      deadline: r.deadline,
      remindedAt: now,
      lastRemindedAt: now,
      remindCount: 1,
      lastRemindedBy: op ? op.name : '未知',
      assigneeId: r.applicantId,
      assigneeName: applicant ? applicant.name : '未知'
    };
    data.reminders.push(reminder);
    logOperation(data, id, operatorId, 'remind_again', '首次催办');
  }
  bumpVersion(r);
  saveData(data);
  return reminder;
}

function batchRemind(ids, operatorId) {
  assertRole(operatorId, ['auditor', 'finance']);
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('请选择要催办的单据');
  }
  const results = { success: [], failed: [] };
  for (const id of ids) {
    try {
      const rm = remindAgain(id, operatorId);
      results.success.push({ id, remindCount: rm.remindCount });
    } catch (e) {
      results.failed.push({ id, error: e.message });
    }
  }
  return results;
}

function updateDeadline(id, operatorId, newDeadline, expectedVersion) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  checkVersion(r, expectedVersion);
  assertStatus(r, [STATUS.PENDING_SUPPLEMENT], '仅待补件状态可修改截止时间');

  const user = USERS.find(u => u.id === operatorId);
  if (!user) throw new Error('用户不存在');

  if (user.role === 'applicant') {
    if (r.applicantId !== operatorId) {
      throw new Error('无权限修改他人报销单的截止时间');
    }
    throw new Error('申请人无权限修改截止时间，请联系审核员或财务');
  }

  if (!['auditor', 'finance'].includes(user.role)) {
    throw new Error('无权限修改截止时间');
  }

  if (!newDeadline) {
    throw new Error('请指定新的截止时间');
  }

  const deadlineDate = new Date(newDeadline);
  if (isNaN(deadlineDate.getTime())) {
    throw new Error('截止时间格式不正确');
  }

  const oldDeadline = r.deadline;
  r.deadline = deadlineDate.toISOString();
  bumpVersion(r);

  const cycle = r.supplementCycle;
  const reminder = data.reminders.find(rm => rm.reimbursementId === id && rm.cycle === cycle);
  if (reminder) {
    reminder.deadline = r.deadline;
  }

  logOperation(data, id, operatorId, 'update_deadline',
    `修改截止时间：${oldDeadline ? oldDeadline.slice(0, 10) : '无'} → ${r.deadline.slice(0, 10)}`);

  saveData(data);
  return getReimbursement(id);
}

function confirmSupplementComplete(id, operatorId, expectedVersion) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  checkVersion(r, expectedVersion);
  assertRole(operatorId, ['auditor', 'finance']);
  assertStatus(r, [STATUS.PENDING_SUPPLEMENT], '仅待补件状态可确认补件完成');

  const required = r.missingAttachments || [];
  const { unmatched } = matchAttachmentToMissing(r.attachments, required);
  if (unmatched.length > 0) {
    throw new Error(`仍有缺失附件未补充：${unmatched.join('、')}，无法确认补件完成`);
  }

  r.missingAttachments = [];
  r.status = STATUS.PENDING_REVIEW;
  bumpVersion(r);

  logOperation(data, id, operatorId, 'confirm_supplement_complete',
    '财务确认补件完成，进入待复核状态');

  saveData(data);
  return getReimbursement(id);
}

function listSupplementTasks(filter = {}) {
  const data = loadData();
  let list = data.reimbursements.filter(r => r.status === STATUS.PENDING_SUPPLEMENT);

  if (filter.applicantId) {
    list = list.filter(r => r.applicantId === filter.applicantId);
  }

  const tasks = list.map(r => {
    const applicant = USERS.find(u => u.id === r.applicantId);
    const reminders = data.reminders.filter(rm => rm.reimbursementId === r.id && rm.cycle === r.supplementCycle);
    const currentReminder = reminders.length > 0 ? reminders[reminders.length - 1] : null;
    const totalRemindCount = reminders.reduce((sum, rm) => sum + (rm.remindCount || 0), 0);
    const overdue = r.deadline && isOverdue(r.deadline);
    const remainingDays = r.deadline ? Math.ceil((new Date(r.deadline) - new Date()) / (1000 * 60 * 60 * 24)) : null;

    const pendingConfirm = (r.missingAttachments || []).length === 0;

    return {
      id: r.id,
      title: r.title,
      amount: r.amount,
      type: r.type,
      applicantId: r.applicantId,
      applicantName: applicant ? applicant.name : '未知',
      status: r.status,
      statusLabel: pendingConfirm ? '待确认' : STATUS_LABEL[r.status],
      missingAttachments: r.missingAttachments || [],
      pendingConfirm,
      deadline: r.deadline,
      remainingDays,
      overdue,
      supplementCycle: r.supplementCycle,
      lastReminderAt: currentReminder ? currentReminder.lastRemindedAt : null,
      remindCount: totalRemindCount,
      version: r.version || 1,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    };
  });

  tasks.sort((a, b) => {
    if (a.pendingConfirm !== b.pendingConfirm) return a.pendingConfirm ? -1 : 1;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
    return 0;
  });

  return tasks;
}

function submitSupplement(id, operatorId, newAttachments, expectedVersion) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  checkVersion(r, expectedVersion);
  assertRole(operatorId, ['applicant']);
  if (r.applicantId !== operatorId) {
    throw new Error('仅申请人可补充材料');
  }
  assertStatus(r, [STATUS.PENDING_SUPPLEMENT], '仅待补件状态可提交补充材料');
  const newAtts = Array.isArray(newAttachments) ? newAttachments : [];
  if (newAtts.length === 0) {
    throw new Error('请至少上传一个补件附件');
  }
  const required = r.missingAttachments || [];
  const { unmatched, matched } = matchAttachmentToMissing(newAtts, required);
  if (unmatched.length > 0) {
    const matchedNames = matched.map(m => `${m.missing} ← ${m.attachment.name}`).join('、');
    throw new Error(`仍有指定材料未补齐：${unmatched.join('、')}。本次匹配到：${matchedNames || '无'}。请上传与要求完全匹配的附件，同名重复上传无效。`);
  }
  r.attachments = [...r.attachments, ...newAtts];
  const matchedNames = matched.map(m => m.missing).join('、');
  if (unmatched.length === 0) {
    r.missingAttachments = [];
  }
  bumpVersion(r);
  logOperation(data, id, operatorId, 'submit_supplement',
    `提交补件材料：${newAtts.map(a => a.name).join('、')}，匹配到：${matchedNames || '无'}${unmatched.length === 0 ? '（已全部补齐，待财务确认）' : `，仍缺：${unmatched.join('、')}`}`);
  saveData(data);
  return getReimbursement(id);
}

function auditApprove(id, operatorId, expectedVersion) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  checkVersion(r, expectedVersion);
  const user = USERS.find(u => u.id === operatorId);
  if (!user) throw new Error('用户不存在');
  if (r.status === STATUS.PENDING_AUDIT) {
    if (user.role !== 'auditor') throw new Error('仅审核员可审批待审核单据');
  } else if (r.status === STATUS.PENDING_REVIEW) {
    if (user.role !== 'finance') throw new Error('仅财务复核员可复核待复核单据');
  } else {
    throw new Error('当前状态不允许审批通过');
  }
  if (r.missingAttachments && r.missingAttachments.length > 0) {
    const { unmatched } = matchAttachmentToMissing(r.attachments, r.missingAttachments);
    if (unmatched.length > 0) {
      throw new Error(`仍有缺失附件未补充：${unmatched.join('、')}，不允许审批通过`);
    }
  }
  if (r.status === STATUS.PENDING_AUDIT) {
    r.status = STATUS.PENDING_REVIEW;
    bumpVersion(r);
    logOperation(data, id, operatorId, 'approve_audit', '初审通过，进入财务复核');
  } else {
    r.status = STATUS.APPROVED;
    bumpVersion(r);
    logOperation(data, id, operatorId, 'approve_finance', '财务复核通过');
  }
  saveData(data);
  return getReimbursement(id);
}

function archive(id, operatorId, expectedVersion) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  checkVersion(r, expectedVersion);
  assertRole(operatorId, ['archiver']);
  assertStatus(r, [STATUS.APPROVED], '仅已通过状态可归档');
  r.status = STATUS.ARCHIVED;
  r.archivedAt = nowISO();
  r.archivedBy = operatorId;
  bumpVersion(r);
  logOperation(data, id, operatorId, 'archive', '已归档');
  saveData(data);
  return getReimbursement(id);
}

function exportArchive(id) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  if (r.status !== STATUS.ARCHIVED) {
    throw new Error('仅已归档单据可导出');
  }
  const reminders = data.reminders.filter(rm => rm.reimbursementId === id);
  const logs = data.operationLogs.filter(l => l.reimbursementId === id)
    .sort((a, b) => new Date(a.operatedAt) - new Date(b.operatedAt));
  const applicant = USERS.find(u => u.id === r.applicantId);
  const decorate = decorateReimbursement(r);
  return {
    reimbursement: {
      ...r,
      applicantName: applicant ? applicant.name : '未知',
      statusLabel: STATUS_LABEL[r.status],
      remindCount: decorate.remindCount,
      reminderCount: decorate.reminderCount,
      overdue: decorate.overdue
    },
    reminders,
    operationLogs: logs
  };
}

function resetAll() {
  const data = {
    reimbursements: [],
    reminders: [],
    operationLogs: [],
    seq: 1000
  };
  saveData(data);
  return { ok: true };
}

module.exports = {
  listReimbursements,
  getReimbursement,
  getReimbursementDetail,
  createReimbursement,
  auditReject,
  auditRequestSupplement,
  remindAgain,
  batchRemind,
  updateDeadline,
  confirmSupplementComplete,
  listSupplementTasks,
  submitSupplement,
  auditApprove,
  archive,
  exportArchive,
  resetAll
};

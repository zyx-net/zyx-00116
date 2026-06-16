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
    updatedAt: now
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

function auditReject(id, operatorId, reason) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  assertRole(operatorId, ['auditor', 'finance']);
  assertStatus(r, [STATUS.PENDING_AUDIT, STATUS.PENDING_REVIEW]);
  r.status = STATUS.REJECTED;
  r.rejectReason = reason;
  r.updatedAt = nowISO();
  const op = USERS.find(u => u.id === operatorId);
  logOperation(data, id, operatorId, 'reject', `驳回，原因：${reason}`);
  saveData(data);
  return getReimbursement(id);
}

function auditRequestSupplement(id, operatorId, missingAttachments, deadlineDays = 3) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
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
  r.updatedAt = now;
  const op = USERS.find(u => u.id === operatorId);
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
    remindCount: 1
  };
  data.reminders.push(reminder);
  saveData(data);
  return getReimbursement(id);
}

function remindAgain(id, operatorId) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  assertRole(operatorId, ['auditor', 'finance']);
  assertStatus(r, [STATUS.PENDING_SUPPLEMENT], '仅待补件状态可催办');
  const cycle = r.supplementCycle;
  let reminder = data.reminders.find(rm => rm.reimbursementId === id && rm.cycle === cycle);
  const op = USERS.find(u => u.id === operatorId);
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
      remindCount: 1
    };
    data.reminders.push(reminder);
    logOperation(data, id, operatorId, 'remind_again', '首次催办');
  }
  r.updatedAt = nowISO();
  saveData(data);
  return reminder;
}

function submitSupplement(id, operatorId, newAttachments) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
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
  r.missingAttachments = [];
  r.status = STATUS.PENDING_REVIEW;
  r.updatedAt = nowISO();
  logOperation(data, id, operatorId, 'submit_supplement',
    `补齐全部缺失材料：${matched.map(m => m.missing).join('、')}，提交附件：${newAtts.map(a => a.name).join('、')}`);
  saveData(data);
  return getReimbursement(id);
}

function auditApprove(id, operatorId) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
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
    r.updatedAt = nowISO();
    logOperation(data, id, operatorId, 'approve_audit', '初审通过，进入财务复核');
  } else {
    r.status = STATUS.APPROVED;
    r.updatedAt = nowISO();
    logOperation(data, id, operatorId, 'approve_finance', '财务复核通过');
  }
  saveData(data);
  return getReimbursement(id);
}

function archive(id, operatorId) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === id);
  if (!r) throw new Error('报销单不存在');
  assertRole(operatorId, ['archiver']);
  assertStatus(r, [STATUS.APPROVED], '仅已通过状态可归档');
  r.status = STATUS.ARCHIVED;
  r.archivedAt = nowISO();
  r.archivedBy = operatorId;
  r.updatedAt = nowISO();
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
  return {
    reimbursement: {
      ...r,
      applicantName: applicant ? applicant.name : '未知',
      statusLabel: STATUS_LABEL[r.status]
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
  submitSupplement,
  auditApprove,
  archive,
  exportArchive,
  resetAll
};

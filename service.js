const store = require('./store');

const { STATUS, STATUS_LABEL, USERS, loadData, saveData, genId, nowISO, addDays, isOverdue, matchAttachmentToMissing, normalizeSupplementRound } = store;

function parseCycleFromRemark(remark) {
  if (!remark) return null;
  const m = remark.match(/\[第(\d+)轮\]/);
  return m ? parseInt(m[1], 10) : null;
}

function buildSupplementRounds(r, data) {
  if (r.supplementRounds && r.supplementRounds.length > 0) {
    return r.supplementRounds
      .map(normalizeSupplementRound)
      .filter(Boolean)
      .sort((a, b) => a.cycle - b.cycle);
  }
  const rounds = [];
  const reminders = (data.reminders || []).filter(rm => rm.reimbursementId === r.id);
  const logs = (data.operationLogs || []).filter(l => l.reimbursementId === r.id);
  const maxCycle = r.supplementCycle || 0;
  if (maxCycle === 0) return [];

  for (let cycle = 1; cycle <= maxCycle; cycle++) {
    const round = normalizeSupplementRound({ cycle, status: 'requested' });

    const rm = reminders.find(x => x.cycle === cycle);
    if (rm) {
      round.requestedAt = rm.remindedAt;
      round.requestedBy = rm.operatorId;
      round.requestedByName = rm.operatorName;
      round.deadline = rm.deadline;
      const msg = rm.message || '';
      const missingMatch = msg.match(/请补充以下附件[：:]\s*(.+)/);
      if (missingMatch) {
        round.missingAttachments = missingMatch[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
      }
    }

    const reqLog = logs.find(l => l.action === 'request_supplement' && parseCycleFromRemark(l.remark) === cycle);
    if (reqLog) {
      round.requestedAt = round.requestedAt || reqLog.operatedAt;
      round.requestedBy = round.requestedBy || reqLog.operatorId;
      round.requestedByName = round.requestedByName || reqLog.operatorName;
      const remark = reqLog.remark || '';
      const missingMatch = remark.match(/缺失[：:]\s*(.+?)[，,]/) || remark.match(/缺失[：:]\s*(.+)/);
      if (missingMatch) {
        round.missingAttachments = missingMatch[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
      }
      const deadlineMatch = remark.match(/截止[：:]\s*(\S+)/);
      if (deadlineMatch) round.deadline = round.deadline || deadlineMatch[1];
    }

    const submitLog = logs.find(l => l.action === 'submit_supplement' && parseCycleFromRemark(l.remark) === cycle);
    if (submitLog) {
      round.submittedAt = submitLog.operatedAt;
      round.submittedBy = submitLog.operatorId;
      round.submittedByName = submitLog.operatorName;
      const attMatch = (submitLog.remark || '').match(/提交补件材料[：:]\s*(.+?)[，,]/);
      if (attMatch) {
        round.submittedAttachments = attMatch[1].split(/[、,，]/).map(name => ({ name: name.trim() }));
      }
      round.status = 'submitted';
    }

    const confirmLog = logs.find(l => l.action === 'confirm_supplement_complete' && parseCycleFromRemark(l.remark) === cycle);
    if (confirmLog) {
      round.confirmedAt = confirmLog.operatedAt;
      round.confirmedBy = confirmLog.operatorId;
      round.confirmedByName = confirmLog.operatorName;
      round.confirmResult = 'passed';
      round.confirmRemark = confirmLog.remark || '';
      round.status = 'confirmed_passed';
    }

    const rejectLog = logs.find(l => l.action === 'reject' && parseCycleFromRemark(l.remark) === cycle);
    if (rejectLog && !confirmLog) {
      round.rejectedAt = rejectLog.operatedAt;
      round.rejectedBy = rejectLog.operatorId;
      round.rejectedByName = rejectLog.operatorName;
      const reasonMatch = (rejectLog.remark || '').match(/原因[：:]\s*(.+)/);
      round.rejectReason = reasonMatch ? reasonMatch[1] : rejectLog.remark || '';
      round.confirmResult = 'rejected';
      round.confirmRemark = rejectLog.remark || '';
      round.status = 'confirmed_rejected';
    }

    rounds.push(round);
  }
  return rounds.sort((a, b) => a.cycle - b.cycle);
}

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
  const pendingConfirm = r.status === STATUS.PENDING_SUPPLEMENT
    && (r.missingAttachments || []).length === 0;
  const supplementRounds = buildSupplementRounds(r, data);
  return {
    ...r,
    statusLabel: pendingConfirm ? '待确认' : STATUS_LABEL[r.status],
    applicantName: applicant ? applicant.name : '未知',
    reminderCount: reminders.length,
    remindCount: totalRemindCount,
    lastReminderAt: reminders.length > 0 ? reminders[reminders.length - 1].remindedAt : null,
    lastSupplementAt: r.lastSupplementAt || null,
    pendingConfirm,
    overdue,
    supplementRounds
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
    lastSupplementAt: null,
    supplementRounds: [],
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
  assertStatus(r, [STATUS.PENDING_AUDIT, STATUS.PENDING_REVIEW, STATUS.PENDING_SUPPLEMENT]);
  const versionBeforeBump = r.version || 1;
  const currentCycle = r.supplementCycle || 0;
  const op = USERS.find(u => u.id === operatorId);
  const rejectTime = nowISO();

  r.status = STATUS.REJECTED;
  r.rejectReason = reason;
  bumpVersion(r);

  if (currentCycle > 0) {
    const rounds = buildSupplementRounds(r, data);
    const currentRound = rounds.find(rd => rd.cycle === currentCycle);
    if (currentRound) {
      currentRound.rejectedAt = rejectTime;
      currentRound.rejectedBy = operatorId;
      currentRound.rejectedByName = op ? op.name : '未知';
      currentRound.rejectReason = reason;
      currentRound.versionAtConfirm = currentRound.versionAtConfirm || versionBeforeBump;
      currentRound.status = 'confirmed_rejected';
      currentRound.confirmResult = currentRound.confirmResult || 'rejected';
      currentRound.confirmRemark = currentRound.confirmRemark || `驳回，原因：${reason}`;
      r.supplementRounds = rounds;
    }
  }

  logOperation(data, id, operatorId, 'reject',
    `${currentCycle > 0 ? `[第${currentCycle}轮] ` : ''}驳回，原因：${reason}，版本：v${versionBeforeBump}→v${r.version}`);
  if (currentCycle > 0) {
    logOperation(data, id, operatorId, 'round_status_change',
      `[第${currentCycle}轮] 轮次状态变更：→ confirmed_rejected，驳回人：${op ? op.name : '未知'}，原因：${reason}`);
  }
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
  const existingRounds = buildSupplementRounds(r, data);
  r.status = STATUS.PENDING_SUPPLEMENT;
  r.missingAttachments = missing;
  r.supplementCycle = (r.supplementCycle || 0) + 1;
  const now = nowISO();
  r.deadline = addDays(now, deadlineDays);
  const versionBeforeBump = r.version || 1;
  bumpVersion(r);
  const op = USERS.find(u => u.id === operatorId);
  const applicant = USERS.find(u => u.id === r.applicantId);

  const newRound = normalizeSupplementRound({
    cycle: r.supplementCycle,
    requestedAt: now,
    requestedBy: operatorId,
    requestedByName: op ? op.name : '未知',
    missingAttachments: missing,
    deadline: r.deadline,
    versionAtRequest: versionBeforeBump,
    status: 'requested'
  });
  r.supplementRounds = [...existingRounds, newRound];

  logOperation(data, id, operatorId, 'request_supplement',
    `[第${r.supplementCycle}轮] 发起补件，缺失：${missing.join('、')}，截止：${r.deadline.slice(0, 10)}，版本：v${versionBeforeBump}→v${r.version}`);
  logOperation(data, id, operatorId, 'round_status_change',
    `[第${r.supplementCycle}轮] 轮次状态变更：→ requested，发起人：${op ? op.name : '未知'}`);
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
  assertRole(operatorId, ['finance']);
  assertStatus(r, [STATUS.PENDING_SUPPLEMENT], '仅待补件状态可确认补件完成');

  const required = r.missingAttachments || [];
  const { unmatched, matched } = matchAttachmentToMissing(r.attachments, required);
  if (unmatched.length > 0) {
    const matchedNames = matched.map(m => `${m.missing}（${m.attachment.name}）`).join('、');
    const currentAttNames = r.attachments.map(a => `${a.name}(${a.category})`).join('、');
    throw new Error(
      `材料未补齐，无法确认补件完成。` +
      `\n  缺失附件（${unmatched.length}项）：${unmatched.join('、')}` +
      `\n  已匹配附件（${matched.length}项）：${matchedNames || '无'}` +
      `\n  当前附件清单：${currentAttNames || '无'}` +
      `\n  请通知申请人补齐缺失材料后再确认。`
    );
  }

  const versionBeforeBump = r.version || 1;
  const currentCycle = r.supplementCycle;
  const op = USERS.find(u => u.id === operatorId);
  const confirmTime = nowISO();

  r.missingAttachments = [];
  r.status = STATUS.PENDING_REVIEW;
  bumpVersion(r);

  const rounds = buildSupplementRounds(r, data);
  const currentRound = rounds.find(rd => rd.cycle === currentCycle);
  if (currentRound) {
    currentRound.confirmedAt = confirmTime;
    currentRound.confirmedBy = operatorId;
    currentRound.confirmedByName = op ? op.name : '未知';
    currentRound.confirmResult = 'passed';
    currentRound.confirmRemark = '财务确认补件完成，进入待复核状态';
    currentRound.versionAtConfirm = versionBeforeBump;
    currentRound.status = 'confirmed_passed';
    r.supplementRounds = rounds;
  }

  logOperation(data, id, operatorId, 'confirm_supplement_complete',
    `[第${currentCycle}轮] 财务确认补件完成，进入待复核状态，版本：v${versionBeforeBump}→v${r.version}`);
  logOperation(data, id, operatorId, 'round_status_change',
    `[第${currentCycle}轮] 轮次状态变更：submitted → confirmed_passed，确认人：${op ? op.name : '未知'}，结果：passed`);

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

    const missingList = r.missingAttachments || [];
    const pendingConfirm = missingList.length === 0;
    const { matched, unmatched } = matchAttachmentToMissing(r.attachments, missingList);
    const supplementRounds = buildSupplementRounds(r, data);

    return {
      id: r.id,
      title: r.title,
      amount: r.amount,
      type: r.type,
      applicantId: r.applicantId,
      applicantName: applicant ? applicant.name : '未知',
      status: r.status,
      statusLabel: pendingConfirm ? '待确认' : STATUS_LABEL[r.status],
      missingAttachments: missingList,
      missingCount: missingList.length,
      matchedAttachments: matched.map(m => ({ missing: m.missing, attachmentName: m.attachment.name })),
      pendingConfirm,
      deadline: r.deadline,
      remainingDays,
      overdue,
      supplementCycle: r.supplementCycle,
      lastReminderAt: currentReminder ? currentReminder.lastRemindedAt : null,
      lastSupplementAt: r.lastSupplementAt || null,
      remindCount: totalRemindCount,
      version: r.version || 1,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      supplementRounds
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
  const versionBeforeBump = r.version || 1;
  const currentCycle = r.supplementCycle;
  const op = USERS.find(u => u.id === operatorId);
  const submitTime = nowISO();

  r.attachments = [...r.attachments, ...newAtts];
  const matchedNames = matched.map(m => m.missing).join('、');
  if (unmatched.length === 0) {
    r.missingAttachments = [];
  }
  r.lastSupplementAt = submitTime;
  bumpVersion(r);

  const rounds = buildSupplementRounds(r, data);
  const currentRound = rounds.find(rd => rd.cycle === currentCycle);
  if (currentRound) {
    currentRound.submittedAt = submitTime;
    currentRound.submittedBy = operatorId;
    currentRound.submittedByName = op ? op.name : '未知';
    currentRound.submittedAttachments = [...newAtts];
    currentRound.versionAtSubmit = versionBeforeBump;
    currentRound.status = unmatched.length === 0 ? 'submitted' : 'requested';
    r.supplementRounds = rounds;
  }

  logOperation(data, id, operatorId, 'submit_supplement',
    `[第${currentCycle}轮] 提交补件材料：${newAtts.map(a => a.name).join('、')}，匹配到：${matchedNames || '无'}${unmatched.length === 0 ? '（已全部补齐，待财务确认）' : `，仍缺：${unmatched.join('、')}`}，版本：v${versionBeforeBump}→v${r.version}`);
  logOperation(data, id, operatorId, 'round_status_change',
    `[第${currentCycle}轮] 轮次状态变更：requested → submitted，提交人：${op ? op.name : '未知'}`);
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
  const reminders = data.reminders.filter(rm => rm.reimbursementId === id)
    .sort((a, b) => new Date(a.remindedAt) - new Date(b.remindedAt));
  const logs = data.operationLogs.filter(l => l.reimbursementId === id)
    .sort((a, b) => new Date(a.operatedAt) - new Date(b.operatedAt));
  const applicant = USERS.find(u => u.id === r.applicantId);
  const decorate = decorateReimbursement(r);
  const supplementRounds = buildSupplementRounds(r, data);

  const supplementLogs = logs.filter(l =>
    l.action === 'request_supplement' ||
    l.action === 'submit_supplement' ||
    l.action === 'confirm_supplement_complete' ||
    l.action === 'remind_again' ||
    l.action === 'reject' ||
    l.action === 'round_status_change'
  );

  const exportRounds = supplementRounds.map(round => {
    const roundReminders = reminders.filter(rm => rm.cycle === round.cycle);
    return {
      cycle: round.cycle,
      status: round.status,
      requestedAt: round.requestedAt,
      requestedBy: round.requestedBy,
      requestedByName: round.requestedByName,
      missingAttachments: round.missingAttachments,
      deadline: round.deadline,
      submittedAt: round.submittedAt,
      submittedBy: round.submittedBy,
      submittedByName: round.submittedByName,
      submittedAttachments: round.submittedAttachments,
      versionAtSubmit: round.versionAtSubmit,
      confirmedAt: round.confirmedAt,
      confirmedBy: round.confirmedBy,
      confirmedByName: round.confirmedByName,
      confirmResult: round.confirmResult,
      confirmRemark: round.confirmRemark,
      rejectedAt: round.rejectedAt,
      rejectedBy: round.rejectedBy,
      rejectedByName: round.rejectedByName,
      rejectReason: round.rejectReason,
      versionAtConfirm: round.versionAtConfirm,
      reminders: roundReminders.map(rm => ({
        remindedAt: rm.remindedAt,
        lastRemindedAt: rm.lastRemindedAt,
        remindCount: rm.remindCount,
        lastRemindedBy: rm.lastRemindedBy,
        operatorName: rm.operatorName,
        message: rm.message
      })),
      totalRemindCount: roundReminders.reduce((s, rm) => s + (rm.remindCount || 0), 0)
    };
  });

  return {
    reimbursement: {
      ...r,
      applicantName: applicant ? applicant.name : '未知',
      statusLabel: STATUS_LABEL[r.status],
      remindCount: decorate.remindCount,
      reminderCount: decorate.reminderCount,
      overdue: decorate.overdue,
      lastSupplementAt: r.lastSupplementAt || null,
      supplementCycle: r.supplementCycle || 0,
      missingAttachments: r.missingAttachments || [],
      pendingConfirm: decorate.pendingConfirm || false,
      supplementRounds: exportRounds
    },
    reminders,
    operationLogs: logs,
    supplementSummary: {
      totalCycles: supplementRounds.length,
      totalRemindCount: decorate.remindCount,
      supplementLogsCount: supplementLogs.length,
      cycles: exportRounds
    }
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
  resetAll,
  buildSupplementRounds,
  parseCycleFromRemark
};

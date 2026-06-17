const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const STATUS = {
  PENDING_AUDIT: 'pending_audit',
  PENDING_SUPPLEMENT: 'pending_supplement',
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
  WITHDRAWN: 'withdrawn'
};

const STATUS_LABEL = {
  pending_audit: '待审核',
  pending_supplement: '待补件',
  pending_review: '待复核',
  approved: '已通过',
  rejected: '已驳回',
  archived: '已归档',
  withdrawn: '已撤销'
};

const DEPARTMENTS = [
  { id: 'dept1', name: '研发部' },
  { id: 'dept2', name: '市场部' },
  { id: 'dept3', name: '财务部' },
  { id: 'dept4', name: '行政部' }
];

const DEPARTMENT_LABEL = {
  dept1: '研发部',
  dept2: '市场部',
  dept3: '财务部',
  dept4: '行政部'
};

const ROLES = {
  APPLICANT: 'applicant',
  AUDITOR: 'auditor',
  FINANCE: 'finance',
  ARCHIVER: 'archiver',
  ADMIN: 'admin'
};

const ROLE_LABEL = {
  applicant: '申请人',
  auditor: '审核员',
  finance: '财务复核员',
  archiver: '归档员',
  admin: '管理员'
};

const USERS = [
  { id: 'u1', username: 'zhangsan', name: '张三', role: 'applicant', departmentId: 'dept1', password: '123456' },
  { id: 'u2', username: 'lisi', name: '李四', role: 'auditor', departmentId: 'dept1', password: '123456' },
  { id: 'u3', username: 'wangwu', name: '王五', role: 'finance', departmentId: 'dept3', password: '123456' },
  { id: 'u4', username: 'zhaoliu', name: '赵六', role: 'archiver', departmentId: 'dept4', password: '123456' },
  { id: 'u5', username: 'admin', name: '系统管理员', role: 'admin', departmentId: 'dept3', password: '123456' }
];

const EXPENSE_CATEGORIES = ['差旅费', '办公费', '招待费', '通讯费', '交通费', '培训费', '其他'];

const BUDGET_TRANSACTION_TYPES = {
  ALLOCATE: 'allocate',
  ADJUST: 'adjust',
  FREEZE: 'freeze',
  DEDUCT: 'deduct',
  RELEASE: 'release',
  IMPORT: 'import'
};

const BUDGET_TRANSACTION_TYPE_LABEL = {
  allocate: '分配额度',
  adjust: '手工调整',
  freeze: '冻结占用',
  deduct: '扣减已用',
  release: '释放回冲',
  import: 'CSV导入'
};

const BUDGET_FREEZE_STATUS = {
  FROZEN: 'frozen',
  DEDUCTED: 'deducted',
  RELEASED: 'released'
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeSupplementRound(round) {
  if (!round) return null;
  const now = nowISO();
  return {
    cycle: round.cycle || 1,
    requestedAt: round.requestedAt || now,
    requestedBy: round.requestedBy || '',
    requestedByName: round.requestedByName || '未知',
    missingAttachments: round.missingAttachments || [],
    deadline: round.deadline || null,
    submittedAt: round.submittedAt || null,
    submittedBy: round.submittedBy || null,
    submittedByName: round.submittedByName || null,
    submittedAttachments: round.submittedAttachments || [],
    versionAtSubmit: round.versionAtSubmit || null,
    confirmedAt: round.confirmedAt || null,
    confirmedBy: round.confirmedBy || null,
    confirmedByName: round.confirmedByName || null,
    confirmResult: round.confirmResult || null,
    confirmRemark: round.confirmRemark || '',
    rejectedAt: round.rejectedAt || null,
    rejectedBy: round.rejectedBy || null,
    rejectedByName: round.rejectedByName || null,
    rejectReason: round.rejectReason || null,
    versionAtConfirm: round.versionAtConfirm || null,
    status: round.status || 'requested'
  };
}

function normalizeReimbursement(r) {
  const now = nowISO();
  return {
    id: r.id,
    title: r.title || '',
    amount: r.amount || 0,
    type: r.type || '差旅费',
    description: r.description || '',
    applicantId: r.applicantId || '',
    status: r.status || STATUS.PENDING_AUDIT,
    attachments: r.attachments || [],
    missingAttachments: r.missingAttachments || [],
    rejectReason: r.rejectReason || null,
    deadline: r.deadline || null,
    supplementCycle: r.supplementCycle || 0,
    lastSupplementAt: r.lastSupplementAt || null,
    supplementRounds: Array.isArray(r.supplementRounds)
      ? r.supplementRounds.map(normalizeSupplementRound).filter(Boolean)
      : [],
    createdAt: r.createdAt || now,
    updatedAt: r.updatedAt || now,
    version: r.version || 1,
    archivedAt: r.archivedAt || null,
    archivedBy: r.archivedBy || null,
    withdrawReason: r.withdrawReason || null,
    withdrawnAt: r.withdrawnAt || null,
    withdrawnBy: r.withdrawnBy || null
  };
}

function normalizeReminder(rm) {
  const now = nowISO();
  return {
    id: rm.id,
    reimbursementId: rm.reimbursementId,
    cycle: rm.cycle || 1,
    operatorId: rm.operatorId || '',
    operatorName: rm.operatorName || '未知',
    message: rm.message || '',
    deadline: rm.deadline || null,
    remindedAt: rm.remindedAt || now,
    lastRemindedAt: rm.lastRemindedAt || rm.remindedAt || now,
    remindCount: rm.remindCount || 1,
    lastRemindedBy: rm.lastRemindedBy || rm.operatorName || '未知',
    assigneeId: rm.assigneeId || null,
    assigneeName: rm.assigneeName || null
  };
}

function normalizeOperationLog(log) {
  return {
    id: log.id,
    reimbursementId: log.reimbursementId,
    operatorId: log.operatorId || '',
    operatorName: log.operatorName || '未知',
    operatorRole: log.operatorRole || 'unknown',
    action: log.action || '',
    remark: log.remark || '',
    operatedAt: log.operatedAt || nowISO()
  };
}

function normalizeBudget(b) {
  const now = nowISO();
  return {
    id: b.id || '',
    month: b.month || '',
    departmentId: b.departmentId || '',
    departmentName: b.departmentName || '',
    category: b.category || '',
    totalAmount: Number(b.totalAmount) || 0,
    usedAmount: Number(b.usedAmount) || 0,
    frozenAmount: Number(b.frozenAmount) || 0,
    version: Number(b.version) || 1,
    createdAt: b.createdAt || now,
    updatedAt: b.updatedAt || now
  };
}

function normalizeBudgetFreeze(f) {
  const now = nowISO();
  return {
    id: f.id || '',
    reimbursementId: f.reimbursementId || '',
    budgetId: f.budgetId || '',
    month: f.month || '',
    departmentId: f.departmentId || '',
    category: f.category || '',
    amount: Number(f.amount) || 0,
    status: f.status || BUDGET_FREEZE_STATUS.FROZEN,
    frozenAt: f.frozenAt || now,
    updatedAt: f.updatedAt || now,
    version: Number(f.version) || 1
  };
}

function normalizeBudgetTransaction(t) {
  const now = nowISO();
  return {
    id: t.id || '',
    budgetId: t.budgetId || '',
    reimbursementId: t.reimbursementId || '',
    type: t.type || '',
    amount: Number(t.amount) || 0,
    balanceAfter: Number(t.balanceAfter) || 0,
    operatorId: t.operatorId || '',
    operatorName: t.operatorName || '未知',
    remark: t.remark || '',
    operatedAt: t.operatedAt || now
  };
}

function normalizeImportBatch(b) {
  const now = nowISO();
  const d = b.details || {};
  return {
    id: b.id || '',
    batchNo: b.batchNo || '',
    fileName: b.fileName || '',
    totalRows: Number(b.totalRows) || 0,
    successCount: Number(b.successCount) || 0,
    skippedCount: Number(b.skippedCount) || 0,
    rejectedCount: Number(b.rejectedCount) || 0,
    failedCount: Number(b.failedCount) || 0,
    totalAmount: Number(b.totalAmount) || 0,
    operatorId: b.operatorId || '',
    operatorName: b.operatorName || '未知',
    month: b.month || '',
    remark: b.remark || '',
    importedAt: b.importedAt || now,
    details: {
      success: Array.isArray(d.success) ? d.success : [],
      skipped: Array.isArray(d.skipped) ? d.skipped : [],
      rejected: Array.isArray(d.rejected) ? d.rejected : [],
      failed: Array.isArray(d.failed) ? d.failed : []
    }
  };
}

function normalizeData(data) {
  if (!data) {
    data = { reimbursements: [], reminders: [], operationLogs: [], seq: 1000 };
  }
  return {
    reimbursements: (data.reimbursements || []).map(normalizeReimbursement),
    reminders: (data.reminders || []).map(normalizeReminder),
    operationLogs: (data.operationLogs || []).map(normalizeOperationLog),
    budgets: (data.budgets || []).map(normalizeBudget),
    budgetFreezes: (data.budgetFreezes || []).map(normalizeBudgetFreeze),
    budgetTransactions: (data.budgetTransactions || []).map(normalizeBudgetTransaction),
    importBatches: (data.importBatches || []).map(normalizeImportBatch),
    seq: data.seq || 1000
  };
}

function loadData() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      reimbursements: [],
      reminders: [],
      operationLogs: [],
      budgets: [],
      budgetFreezes: [],
      budgetTransactions: [],
      importBatches: [],
      seq: 1000
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return normalizeData(raw);
}

function getMonthFromDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getCurrentMonth() {
  return getMonthFromDate(new Date().toISOString());
}

function saveData(data) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function genId(data, prefix) {
  data.seq += 1;
  return `${prefix}${String(data.seq).padStart(4, '0')}`;
}

function nowISO() {
  return new Date().toISOString();
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function isOverdue(deadline) {
  if (!deadline) return false;
  return new Date() > new Date(deadline);
}

function matchAttachmentToMissing(attachments, missingItems) {
  if (!missingItems || missingItems.length === 0) return { matched: [], unmatched: [] };
  const usedAttIds = new Set();
  const matched = [];
  const unmatched = [];
  for (const m of missingItems) {
    let found = null;
    for (const a of attachments) {
      if (usedAttIds.has(a.id)) continue;
      if (a.category === m || (a.name && a.name.includes(m))) {
        found = a;
        break;
      }
    }
    if (found) {
      usedAttIds.add(found.id);
      matched.push({ missing: m, attachment: found });
    } else {
      unmatched.push(m);
    }
  }
  return { matched, unmatched, usedAttIds };
}

module.exports = {
  STATUS, STATUS_LABEL,
  ROLES, ROLE_LABEL, USERS,
  DEPARTMENTS, DEPARTMENT_LABEL,
  EXPENSE_CATEGORIES,
  BUDGET_TRANSACTION_TYPES, BUDGET_TRANSACTION_TYPE_LABEL,
  BUDGET_FREEZE_STATUS,
  loadData, saveData, genId, nowISO, addDays, isOverdue,
  getMonthFromDate, getCurrentMonth,
  matchAttachmentToMissing,
  normalizeData, normalizeReimbursement, normalizeReminder, normalizeOperationLog,
  normalizeSupplementRound, normalizeBudget, normalizeBudgetFreeze, normalizeBudgetTransaction,
  normalizeImportBatch,
  DATA_DIR, DATA_FILE
};

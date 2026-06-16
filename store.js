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
  ARCHIVED: 'archived'
};

const STATUS_LABEL = {
  pending_audit: '待审核',
  pending_supplement: '待补件',
  pending_review: '待复核',
  approved: '已通过',
  rejected: '已驳回',
  archived: '已归档'
};

const ROLES = {
  APPLICANT: 'applicant',
  AUDITOR: 'auditor',
  FINANCE: 'finance',
  ARCHIVER: 'archiver'
};

const ROLE_LABEL = {
  applicant: '申请人',
  auditor: '审核员',
  finance: '财务复核员',
  archiver: '归档员'
};

const USERS = [
  { id: 'u1', username: 'zhangsan', name: '张三', role: 'applicant', password: '123456' },
  { id: 'u2', username: 'lisi', name: '李四', role: 'auditor', password: '123456' },
  { id: 'u3', username: 'wangwu', name: '王五', role: 'finance', password: '123456' },
  { id: 'u4', username: 'zhaoliu', name: '赵六', role: 'archiver', password: '123456' }
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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
    createdAt: r.createdAt || now,
    updatedAt: r.updatedAt || now,
    version: r.version || 1,
    archivedAt: r.archivedAt || null,
    archivedBy: r.archivedBy || null
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

function normalizeData(data) {
  if (!data) {
    data = { reimbursements: [], reminders: [], operationLogs: [], seq: 1000 };
  }
  return {
    reimbursements: (data.reimbursements || []).map(normalizeReimbursement),
    reminders: (data.reminders || []).map(normalizeReminder),
    operationLogs: (data.operationLogs || []).map(normalizeOperationLog),
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
      seq: 1000
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return normalizeData(raw);
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
  STATUS, STATUS_LABEL, ROLES, ROLE_LABEL, USERS,
  loadData, saveData, genId, nowISO, addDays, isOverdue,
  matchAttachmentToMissing,
  normalizeData, normalizeReimbursement, normalizeReminder, normalizeOperationLog,
  DATA_DIR, DATA_FILE
};

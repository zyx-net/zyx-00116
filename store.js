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
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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
  DATA_DIR, DATA_FILE
};

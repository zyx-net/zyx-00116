const express = require('express');
const cors = require('cors');
const path = require('path');
const service = require('./service');
const budgetService = require('./budget-service');
const {
  USERS, ROLE_LABEL, STATUS, STATUS_LABEL,
  DEPARTMENTS, DEPARTMENT_LABEL, EXPENSE_CATEGORIES,
  BUDGET_TRANSACTION_TYPE_LABEL
} = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getUserFromHeader(req) {
  const userId = req.headers['x-user-id'];
  if (!userId) return null;
  return USERS.find(u => u.id === userId) || null;
}

function requireAuth(req, res, next) {
  const user = getUserFromHeader(req);
  if (!user) {
    return res.status(401).json({ error: '未登录，请先选择角色' });
  }
  req.user = user;
  next();
}

app.get('/api/meta', (req, res) => {
  res.json({
    users: USERS.map(u => ({
      id: u.id, name: u.name, role: u.role, roleLabel: ROLE_LABEL[u.role],
      username: u.username, departmentId: u.departmentId,
      departmentName: DEPARTMENT_LABEL[u.departmentId] || ''
    })),
    statuses: Object.entries(STATUS).map(([k, v]) => ({ key: v, label: STATUS_LABEL[v] })),
    roles: Object.entries(ROLE_LABEL).map(([k, v]) => ({ key: k, label: v })),
    departments: DEPARTMENTS.map(d => ({ ...d, name: DEPARTMENT_LABEL[d.id] || d.name })),
    expenseCategories: EXPENSE_CATEGORIES,
    budgetTransactionTypes: Object.entries(BUDGET_TRANSACTION_TYPE_LABEL).map(([k, v]) => ({ key: k, label: v }))
  });
});

app.post('/api/login', (req, res) => {
  const { userId } = req.body;
  const user = USERS.find(u => u.id === userId);
  if (!user) return res.status(400).json({ error: '用户不存在' });
  res.json({ user: { id: user.id, name: user.name, role: user.role, roleLabel: ROLE_LABEL[user.role] } });
});

app.get('/api/reimbursements', requireAuth, (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (req.user.role === 'applicant') {
    filter.applicantId = req.user.id;
  }
  const list = service.listReimbursements(filter);
  res.json({ list });
});

app.get('/api/supplement-tasks', requireAuth, (req, res) => {
  const filter = {};
  if (req.user.role === 'applicant') {
    filter.applicantId = req.user.id;
  }
  const tasks = service.listSupplementTasks(filter);
  res.json({ tasks });
});

app.get('/api/reimbursements/:id', requireAuth, (req, res) => {
  const detail = service.getReimbursementDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: '报销单不存在' });
  res.json(detail);
});

app.post('/api/reimbursements', requireAuth, (req, res) => {
  try {
    const result = service.createReimbursement(req.body, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/request-supplement', requireAuth, (req, res) => {
  try {
    const { missingAttachments, deadlineDays, version } = req.body;
    const result = service.auditRequestSupplement(req.params.id, req.user.id, missingAttachments, deadlineDays, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/remind', requireAuth, (req, res) => {
  try {
    const { version } = req.body;
    const result = service.remindAgain(req.params.id, req.user.id, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/batch-remind', requireAuth, (req, res) => {
  try {
    const { ids } = req.body;
    const result = service.batchRemind(ids, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/reimbursements/:id/deadline', requireAuth, (req, res) => {
  try {
    const { newDeadline, version } = req.body;
    const result = service.updateDeadline(req.params.id, req.user.id, newDeadline, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/confirm-supplement', requireAuth, (req, res) => {
  try {
    const { version } = req.body;
    const result = service.confirmSupplementComplete(req.params.id, req.user.id, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/submit-supplement', requireAuth, (req, res) => {
  try {
    const { attachments, version } = req.body;
    const result = service.submitSupplement(req.params.id, req.user.id, attachments, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/approve', requireAuth, (req, res) => {
  try {
    const { version } = req.body;
    const result = service.auditApprove(req.params.id, req.user.id, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/reject', requireAuth, (req, res) => {
  try {
    const { reason, version } = req.body;
    const result = service.auditReject(req.params.id, req.user.id, reason, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/archive', requireAuth, (req, res) => {
  try {
    const { version } = req.body;
    const result = service.archive(req.params.id, req.user.id, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/reimbursements/:id/export', requireAuth, (req, res) => {
  try {
    const result = service.exportArchive(req.params.id);
    const fileName = `archive_${req.params.id}_${Date.now()}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(result, null, 2));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/withdraw', requireAuth, (req, res) => {
  try {
    const { reason, version } = req.body;
    const result = service.withdrawReimbursement(req.params.id, req.user.id, reason, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/resubmit', requireAuth, (req, res) => {
  try {
    const { version } = req.body;
    const result = service.resubmitReimbursement(req.params.id, req.user.id, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/budgets', requireAuth, (req, res) => {
  try {
    const { month, departmentId, category } = req.query;
    const filter = {};
    if (month) filter.month = month;
    if (departmentId) filter.departmentId = departmentId;
    if (category) filter.category = category;
    if (req.user.role === 'applicant') {
      filter.departmentId = req.user.departmentId;
    }
    const list = budgetService.listBudgets(filter);
    res.json({ list });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/budgets/summary', requireAuth, (req, res) => {
  try {
    const { month, departmentId } = req.query;
    let deptId = departmentId;
    if (req.user.role === 'applicant') {
      deptId = req.user.departmentId;
    }
    const summary = budgetService.getBudgetSummary(month, deptId);
    res.json(summary);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/budgets/:id', requireAuth, (req, res) => {
  try {
    const budget = budgetService.getBudget(req.params.id);
    if (!budget) return res.status(404).json({ error: '预算不存在' });
    res.json(budget);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/budgets', requireAuth, (req, res) => {
  try {
    if (!['admin', 'finance'].includes(req.user.role)) {
      return res.status(403).json({ error: '无权限创建预算' });
    }
    const result = budgetService.createBudget(req.body, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/budgets/:id', requireAuth, (req, res) => {
  try {
    if (!['admin', 'finance'].includes(req.user.role)) {
      return res.status(403).json({ error: '无权限修改预算' });
    }
    const { version, ...payload } = req.body;
    const result = budgetService.updateBudget(req.params.id, payload, req.user.id, version);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/budgets/:id/adjust', requireAuth, (req, res) => {
  try {
    if (!['admin', 'finance'].includes(req.user.role)) {
      return res.status(403).json({ error: '无权限调整预算' });
    }
    const { adjustmentAmount, remark, version } = req.body;
    const result = budgetService.adjustBudget(
      req.params.id, adjustmentAmount, remark, req.user.id, version
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/budgets/:id', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '仅管理员可删除预算' });
    }
    const result = budgetService.deleteBudget(req.params.id, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/budgets/:id/transactions', requireAuth, (req, res) => {
  try {
    const transactions = budgetService.listBudgetTransactions({ budgetId: req.params.id });
    res.json({ list: transactions });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/budget-transactions', requireAuth, (req, res) => {
  try {
    const { reimbursementId, month, type } = req.query;
    const filter = {};
    if (reimbursementId) filter.reimbursementId = reimbursementId;
    if (month) filter.month = month;
    if (type) filter.type = type;
    const list = budgetService.listBudgetTransactions(filter);
    res.json({ list });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/budgets/import', requireAuth, (req, res) => {
  try {
    if (!['admin', 'finance'].includes(req.user.role)) {
      return res.status(403).json({ error: '无权限导入预算' });
    }
    const { csvContent } = req.body;
    const result = budgetService.importBudgetsFromCSV(csvContent, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/budgets/export', requireAuth, (req, res) => {
  try {
    const { month, departmentId, category } = req.query;
    const filter = {};
    if (month) filter.month = month;
    if (departmentId) filter.departmentId = departmentId;
    if (category) filter.category = category;
    if (req.user.role === 'applicant') {
      filter.departmentId = req.user.departmentId;
    }
    const csv = budgetService.exportBudgetsToCSV(filter);
    const fileName = `budgets_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/budget-transactions/export', requireAuth, (req, res) => {
  try {
    const { month, reimbursementId, type } = req.query;
    const filter = {};
    if (month) filter.month = month;
    if (reimbursementId) filter.reimbursementId = reimbursementId;
    if (type) filter.type = type;
    const csv = budgetService.exportTransactionsToCSV(filter);
    const fileName = `budget_transactions_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/budgets/reconcile', requireAuth, (req, res) => {
  try {
    if (!['admin', 'finance'].includes(req.user.role)) {
      return res.status(403).json({ error: '无权限执行预算对账' });
    }
    const result = budgetService.reconcileBudgets();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/reimbursements/:id/budget-status', requireAuth, (req, res) => {
  try {
    const status = budgetService.getReimbursementBudgetStatus(req.params.id);
    res.json(status);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reset', (req, res) => {
  service.resetAll();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`报销单工作台已启动: http://localhost:${PORT}`);
});

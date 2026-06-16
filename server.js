const express = require('express');
const cors = require('cors');
const path = require('path');
const service = require('./service');
const { USERS, ROLE_LABEL, STATUS, STATUS_LABEL } = require('./store');

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
    users: USERS.map(u => ({ id: u.id, name: u.name, role: u.role, roleLabel: ROLE_LABEL[u.role], username: u.username })),
    statuses: Object.entries(STATUS).map(([k, v]) => ({ key: v, label: STATUS_LABEL[v] })),
    roles: Object.entries(ROLE_LABEL).map(([k, v]) => ({ key: k, label: v }))
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
    const { missingAttachments, deadlineDays } = req.body;
    const result = service.auditRequestSupplement(req.params.id, req.user.id, missingAttachments, deadlineDays);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/remind', requireAuth, (req, res) => {
  try {
    const result = service.remindAgain(req.params.id, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/submit-supplement', requireAuth, (req, res) => {
  try {
    const { attachments } = req.body;
    const result = service.submitSupplement(req.params.id, req.user.id, attachments);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/approve', requireAuth, (req, res) => {
  try {
    const result = service.auditApprove(req.params.id, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/reject', requireAuth, (req, res) => {
  try {
    const { reason } = req.body;
    const result = service.auditReject(req.params.id, req.user.id, reason);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/reimbursements/:id/archive', requireAuth, (req, res) => {
  try {
    const result = service.archive(req.params.id, req.user.id);
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

app.post('/api/reset', (req, res) => {
  service.resetAll();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`报销单工作台已启动: http://localhost:${PORT}`);
});

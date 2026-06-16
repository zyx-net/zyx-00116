function getUserId() {
  return currentUser ? currentUser.id : '';
}

const API = {
  async get(path) {
    const headers = {};
    if (getUserId()) headers['X-User-Id'] = getUserId();
    const res = await fetch(path, { headers });
    return await res.json();
  },
  async post(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (getUserId()) headers['X-User-Id'] = getUserId();
    const res = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '操作失败');
    return data;
  }
};

let currentUser = null;
let meta = null;
let currentStatus = 'all';
let currentId = null;
let listData = [];

async function init() {
  meta = await API.get('/api/meta');
  initRoleSelect();
  switchUser(meta.users[0].id);
  bindEvents();
}

function initRoleSelect() {
  const sel = document.getElementById('roleSelect');
  sel.innerHTML = meta.users.map(u =>
    `<option value="${u.id}">${u.name}（${u.roleLabel}）</option>`
  ).join('');
}

function bindEvents() {
  document.getElementById('roleSelect').addEventListener('change', e => {
    switchUser(e.target.value);
  });
  document.getElementById('createBtn').addEventListener('click', showCreateModal);
  document.getElementById('resetBtn').addEventListener('click', resetData);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.querySelector('.modal-mask').addEventListener('click', closeModal);
}

function switchUser(userId) {
  const user = meta.users.find(u => u.id === userId);
  currentUser = user;
  document.getElementById('roleSelect').value = userId;
  document.getElementById('createBtn').style.display =
    user.role === 'applicant' ? 'inline-block' : 'none';
  currentStatus = 'all';
  currentId = null;
  renderStatusNav();
  loadList();
  renderDetailEmpty();
}

async function loadList() {
  const container = document.getElementById('listContainer');
  const filter = currentStatus === 'all' ? {} : { status: currentStatus };
  const params = new URLSearchParams(filter).toString();
  const data = await API.get('/api/reimbursements' + (params ? '?' + params : ''));
  listData = data.list;
  renderList();
  updateTodoCount();
}

function renderStatusNav() {
  const nav = document.getElementById('statusNav');
  const items = [
    { key: 'all', label: '全部' },
    { key: 'pending_audit', label: '待审核' },
    { key: 'pending_supplement', label: '待补件' },
    { key: 'pending_review', label: '待复核' },
    { key: 'approved', label: '已通过' },
    { key: 'rejected', label: '已驳回' },
    { key: 'archived', label: '已归档' }
  ];
  nav.innerHTML = items.map(it => `
    <div class="status-item ${currentStatus === it.key ? 'active' : ''}" data-status="${it.key}">
      <span>${it.label}</span>
      <span class="badge" id="badge-${it.key}">0</span>
    </div>
  `).join('');
  nav.querySelectorAll('.status-item').forEach(el => {
    el.addEventListener('click', () => {
      currentStatus = el.dataset.status;
      renderStatusNav();
      loadList();
    });
  });
}

function updateTodoCount() {
  API.get('/api/reimbursements').then(data => {
    const counts = {};
    ['all', 'pending_audit', 'pending_supplement', 'pending_review',
     'approved', 'rejected', 'archived'].forEach(k => counts[k] = 0);
    data.list.forEach(r => {
      counts.all++;
      if (counts[r.status] !== undefined) counts[r.status]++;
    });
    Object.keys(counts).forEach(k => {
      const el = document.getElementById('badge-' + k);
      if (el) el.textContent = counts[k];
    });
    const todo = counts.pending_audit + counts.pending_supplement + counts.pending_review;
    document.getElementById('todoCount').textContent = todo;
  });
}

function renderList() {
  const container = document.getElementById('listContainer');
  if (listData.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无数据</div>';
    return;
  }
  container.innerHTML = listData.map(r => `
    <div class="list-item ${currentId === r.id ? 'active' : ''}" data-id="${r.id}">
      <div class="list-item-title">
        <span>${r.title}</span>
        <span class="list-item-id">${r.id}</span>
      </div>
      <div class="list-item-meta">
        <div>
          <span class="status-tag status-${r.status}">${r.statusLabel}</span>
          ${r.overdue ? '<span class="overdue-tag">已逾期</span>' : ''}
        </div>
        <span class="list-item-amount">¥${Number(r.amount).toFixed(2)}</span>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', () => {
      currentId = el.dataset.id;
      renderList();
      loadDetail();
    });
  });
}

function renderDetailEmpty() {
  document.getElementById('detailPanel').innerHTML = `
    <div class="empty-state">
      <div style="font-size:48px;margin-bottom:16px">📄</div>
      <p>请选择左侧报销单查看详情</p>
    </div>
  `;
}

async function loadDetail() {
  if (!currentId) return;
  const detail = await API.get('/api/reimbursements/' + currentId);
  renderDetail(detail);
}

function renderDetail(d) {
  const panel = document.getElementById('detailPanel');
  const actions = renderActions(d);
  const rejectSection = d.rejectReason ? `
    <div class="detail-card">
      <div class="detail-card-header">⚠️ 驳回说明</div>
      <div class="detail-card-body">
        <div class="reject-box">${d.rejectReason}</div>
      </div>
    </div>
  ` : '';
  const supplementSection = d.status === 'pending_supplement' || d.missingAttachments?.length > 0 ? `
    <div class="detail-card">
      <div class="detail-card-header">📌 补件信息</div>
      <div class="detail-card-body">
        <div class="detail-row">
          <span class="detail-label">截止时间</span>
          <span class="detail-value ${d.overdue ? 'overdue' : ''}">
            ${formatDate(d.deadline)}
            ${d.overdue ? '（已逾期）' : ''}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">补件轮次</span>
          <span class="detail-value">第 ${d.supplementCycle} 轮</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">催办次数</span>
          <span class="detail-value">${d.reminderCount} 次</span>
        </div>
      </div>
    </div>
  ` : '';
  panel.innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <span>📋 ${d.title}</span>
        <span class="status-tag status-${d.status}">${d.statusLabel}</span>
      </div>
      <div class="detail-card-body">
        <div class="detail-row">
          <span class="detail-label">报销单号</span>
          <span class="detail-value">${d.id}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">报销类型</span>
          <span class="detail-value">${d.type}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">报销金额</span>
          <span class="detail-value amount">¥${Number(d.amount).toFixed(2)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">申请人</span>
          <span class="detail-value">${d.applicantName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">创建时间</span>
          <span class="detail-value">${formatDate(d.createdAt)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">描述</span>
          <span class="detail-value">${d.description || '-'}</span>
        </div>
      </div>
    </div>

    ${rejectSection}
    ${supplementSection}

    <div class="detail-card">
      <div class="detail-card-header">
        <span>📎 附件清单（${d.attachments.length}）</span>
        ${d.missingAttachments?.length ? `<span style="color:#f5222d;font-size:13px">缺失 ${d.missingAttachments.length} 项</span>` : ''}
      </div>
      <div class="detail-card-body">
        ${renderAttachments(d)}
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-card-header">⏰ 催办记录</div>
      <div class="detail-card-body">
        ${renderReminders(d.reminders || [])}
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-card-header">📝 操作日志</div>
      <div class="detail-card-body">
        ${renderLogs(d.operationLogs || [])}
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-card-header">⚡ 操作</div>
      <div class="detail-card-body">
        <div class="action-bar">
          ${actions}
        </div>
      </div>
    </div>
  `;
  bindDetailActions(d);
}

function renderAttachments(d) {
  const items = d.attachments.map(a => `
    <div class="attachment-item">
      <div class="attachment-icon">📄</div>
      <div class="attachment-info">
        <div class="attachment-name">${a.name}</div>
        <div class="attachment-meta">
          <span class="attachment-tag">${a.category || '其他'}</span>
          <span style="margin-left:8px">${a.size || '-'}</span>
        </div>
      </div>
    </div>
  `).join('');
  const missing = (d.missingAttachments || []).map(m => `
    <div class="attachment-item missing">
      <div class="attachment-icon">❌</div>
      <div class="attachment-info">
        <div class="attachment-name" style="color:#cf1322">${m}（缺失）</div>
        <div class="attachment-meta">需要申请人补充</div>
      </div>
    </div>
  `).join('');
  if (!items && !missing) return '<div style="color:#999">暂无附件</div>';
  return missing + items;
}

function renderReminders(list) {
  if (!list || list.length === 0) {
    return '<div style="color:#999">暂无催办记录</div>';
  }
  return list.map(r => `
    <div class="reminder-item">
      <div class="reminder-header">
        <span class="reminder-user">
          ${r.operatorName}
          <span class="reminder-count">第 ${r.remindCount} 次催办</span>
        </span>
        <span class="reminder-time">${formatDate(r.remindedAt)}</span>
      </div>
      <div class="reminder-msg">${r.message}</div>
      <div style="margin-top:6px;font-size:12px;color:#999">
        补件轮次：第 ${r.cycle} 轮 · 截止：${formatDate(r.deadline)}
      </div>
    </div>
  `).join('');
}

function renderLogs(list) {
  if (!list || list.length === 0) {
    return '<div style="color:#999">暂无操作日志</div>';
  }
  const actionMap = {
    create: '创建',
    approve_audit: '初审通过',
    approve_finance: '财务通过',
    reject: '驳回',
    request_supplement: '发起补件',
    submit_supplement: '提交补件',
    remind_again: '催办',
    archive: '归档'
  };
  return list.map(l => `
    <div class="log-item" style="border-left-color:${logColor(l.action)}">
      <div class="log-header">
        <span class="log-user">${l.operatorName}（${roleLabel(l.operatorRole)}）</span>
        <span class="log-time">${formatDate(l.operatedAt)}</span>
      </div>
      <div class="log-msg">${l.remark || actionMap[l.action] || l.action}</div>
    </div>
  `).join('');
}

function logColor(action) {
  if (action.includes('approve')) return '#52c41a';
  if (action.includes('reject')) return '#f5222d';
  if (action.includes('supplement') || action.includes('remind')) return '#fa8c16';
  if (action === 'archive') return '#722ed1';
  return '#1890ff';
}

function roleLabel(role) {
  const map = { applicant: '申请人', auditor: '审核员', finance: '财务复核员', archiver: '归档员' };
  return map[role] || role;
}

function renderActions(d) {
  const role = currentUser.role;
  const btns = [];
  if (role === 'auditor' && d.status === 'pending_audit') {
    btns.push(`<button class="btn btn-success" data-action="approve">✅ 初审通过</button>`);
    btns.push(`<button class="btn btn-warning" data-action="supplement">📨 发起补件</button>`);
    btns.push(`<button class="btn btn-danger" data-action="reject">❌ 驳回</button>`);
  }
  if (role === 'finance' && d.status === 'pending_review') {
    btns.push(`<button class="btn btn-success" data-action="approve">✅ 复核通过</button>`);
    btns.push(`<button class="btn btn-warning" data-action="supplement">📨 发起补件</button>`);
    btns.push(`<button class="btn btn-danger" data-action="reject">❌ 驳回</button>`);
  }
  if ((role === 'auditor' || role === 'finance') && d.status === 'pending_supplement') {
    btns.push(`<button class="btn btn-warning" data-action="remind">⏰ 再次催办</button>`);
  }
  if (role === 'applicant' && d.status === 'pending_supplement' && d.applicantId === currentUser.id) {
    btns.push(`<button class="btn btn-primary" data-action="submit-supplement">📎 提交补件</button>`);
  }
  if (role === 'archiver' && d.status === 'approved') {
    btns.push(`<button class="btn btn-primary" data-action="archive">📦 归档</button>`);
  }
  if (role === 'archiver' && d.status === 'archived') {
    btns.push(`<button class="btn btn-secondary" data-action="export" style="background:#722ed1;color:white;border-color:#722ed1">⬇️ 导出归档</button>`);
  }
  if (btns.length === 0) {
    btns.push('<span style="color:#999">当前角色无可用操作</span>');
  }
  return btns.join('');
}

function bindDetailActions(d) {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.dataset.action, d));
  });
}

async function handleAction(action, d) {
  try {
    switch (action) {
      case 'approve':
        await API.post(`/api/reimbursements/${d.id}/approve`);
        toast('操作成功', 'success');
        refreshAll();
        break;
      case 'reject':
        showRejectModal(d);
        break;
      case 'supplement':
        showSupplementModal(d);
        break;
      case 'remind':
        const rm = await API.post(`/api/reimbursements/${d.id}/remind`);
        toast(`已催办，当前第 ${rm.remindCount} 次（同一周期历史合并）`, 'info');
        refreshAll();
        break;
      case 'submit-supplement':
        showSubmitSupplementModal(d);
        break;
      case 'archive':
        await API.post(`/api/reimbursements/${d.id}/archive`);
        toast('归档成功', 'success');
        refreshAll();
        break;
      case 'export':
        window.open(`/api/reimbursements/${d.id}/export`, '_blank');
        break;
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

function showCreateModal() {
  openModal('新建报销单', `
    <div class="form-group">
      <label>报销标题</label>
      <input type="text" id="f-title" placeholder="例如：3月差旅费报销">
    </div>
    <div class="form-group">
      <label>报销类型</label>
      <select id="f-type">
        <option>差旅费</option>
        <option>办公费</option>
        <option>招待费</option>
        <option>通讯费</option>
        <option>交通费</option>
        <option>培训费</option>
        <option>其他</option>
      </select>
    </div>
    <div class="form-group">
      <label>报销金额（元）</label>
      <input type="number" id="f-amount" step="0.01" placeholder="0.00">
    </div>
    <div class="form-group">
      <label>描述说明</label>
      <textarea id="f-desc" placeholder="请简要说明报销事由"></textarea>
    </div>
    <div class="section-title">附件（可留空，后续补充）</div>
    <div id="attach-list"></div>
    <button class="btn btn-secondary" id="add-attach-btn" style="width:100%;margin-top:8px">+ 添加附件</button>
  `, () => {
    const title = document.getElementById('f-title').value.trim();
    const amount = parseFloat(document.getElementById('f-amount').value);
    const type = document.getElementById('f-type').value;
    const description = document.getElementById('f-desc').value.trim();
    if (!title) { toast('请填写标题', 'error'); return false; }
    if (!amount || amount <= 0) { toast('请填写有效金额', 'error'); return false; }
    const attachments = collectAttachments();
    API.post('/api/reimbursements', { title, amount, type, description, attachments })
      .then(() => {
        toast('创建成功', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => toast(e.message, 'error'));
    return false;
  }, '提交');
  setupAttachFields();
}

let attachCounter = 0;
function setupAttachFields() {
  attachCounter = 0;
  document.getElementById('add-attach-btn')?.addEventListener('click', addAttachField);
}

function addAttachField() {
  const list = document.getElementById('attach-list');
  const idx = ++attachCounter;
  const div = document.createElement('div');
  div.className = 'form-group attach-field';
  div.dataset.idx = idx;
  div.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <input type="text" placeholder="附件名称" data-field="name" style="flex:1">
      <input type="text" placeholder="类别" data-field="category" style="width:100px">
      <button type="button" class="btn btn-danger" data-remove="${idx}" style="padding:4px 10px">×</button>
    </div>
  `;
  list.appendChild(div);
  div.querySelector('[data-remove]').addEventListener('click', () => div.remove());
}

function collectAttachments() {
  const fields = document.querySelectorAll('.attach-field');
  const list = [];
  fields.forEach(f => {
    const name = f.querySelector('[data-field="name"]').value.trim();
    const category = f.querySelector('[data-field="category"]').value.trim() || '其他';
    if (name) {
      list.push({
        id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name, category,
        size: Math.floor(Math.random() * 500 + 20) + 'KB',
        uploadedAt: new Date().toISOString()
      });
    }
  });
  return list;
}

function showRejectModal(d) {
  openModal('驳回报销单', `
    <p style="margin-bottom:12px;color:#666">确定要驳回 <strong>${d.id}</strong> 吗？</p>
    <div class="form-group">
      <label>驳回原因</label>
      <textarea id="reject-reason" placeholder="请详细说明驳回原因，便于申请人修改"></textarea>
    </div>
  `, () => {
    const reason = document.getElementById('reject-reason').value.trim();
    if (!reason) { toast('请填写驳回原因', 'error'); return false; }
    API.post(`/api/reimbursements/${d.id}/reject`, { reason })
      .then(() => {
        toast('已驳回', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => toast(e.message, 'error'));
    return false;
  }, '确认驳回', 'btn-danger');
}

function showSupplementModal(d) {
  openModal('发起补件', `
    <p style="margin-bottom:12px;color:#666">请选择缺失的附件类型，设置补件截止时间</p>
    <div class="form-group">
      <label>缺失附件</label>
      <div class="checkbox-group" id="missing-group">
        <label class="checkbox-item"><input type="checkbox" value="发票"> 发票</label>
        <label class="checkbox-item"><input type="checkbox" value="清单"> 清单</label>
        <label class="checkbox-item"><input type="checkbox" value="入库单"> 入库单</label>
        <label class="checkbox-item"><input type="checkbox" value="行程单"> 行程单</label>
        <label class="checkbox-item"><input type="checkbox" value="审批单"> 审批单</label>
        <label class="checkbox-item"><input type="checkbox" value="证明材料"> 证明材料</label>
      </div>
    </div>
    <div class="form-group">
      <label>其他缺失项（逗号分隔，可选）</label>
      <input type="text" id="missing-other" placeholder="例如：签字版说明,照片">
    </div>
    <div class="form-group">
      <label>补件期限（天）</label>
      <input type="number" id="deadline-days" value="3" min="1" max="30">
    </div>
  `, () => {
    const checks = document.querySelectorAll('#missing-group input:checked');
    const missing = Array.from(checks).map(c => c.value);
    const other = document.getElementById('missing-other').value.trim();
    if (other) {
      missing.push(...other.split(/[,，]/).map(s => s.trim()).filter(Boolean));
    }
    if (missing.length === 0) { toast('请选择缺失的附件', 'error'); return false; }
    const days = parseInt(document.getElementById('deadline-days').value) || 3;
    API.post(`/api/reimbursements/${d.id}/request-supplement`, {
      missingAttachments: missing, deadlineDays: days
    })
      .then(() => {
        toast('补件已发起', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => toast(e.message, 'error'));
    return false;
  }, '发起补件', 'btn-warning');
}

function showSubmitSupplementModal(d) {
  openModal('提交补件材料', `
    <p style="margin-bottom:12px;color:#666">请上传缺失的附件材料</p>
    <div class="section-title">当前缺失</div>
    <div style="margin-bottom:12px">
      ${d.missingAttachments.map(m => `<span class="status-tag status-rejected" style="margin-right:6px;margin-bottom:4px">❌ ${m}</span>`).join('')}
    </div>
    <div class="section-title">补充附件</div>
    <div id="attach-list"></div>
    <button class="btn btn-secondary" id="add-attach-btn" style="width:100%;margin-top:8px">+ 添加附件</button>
  `, () => {
    const attachments = collectAttachments();
    if (attachments.length === 0) { toast('请至少添加一个附件', 'error'); return false; }
    API.post(`/api/reimbursements/${d.id}/submit-supplement`, { attachments })
      .then(() => {
        toast('补件已提交', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => toast(e.message, 'error'));
    return false;
  }, '提交补件', 'btn-primary');
  setupAttachFields();
}

function openModal(title, bodyHtml, onSubmit, submitText = '确定', submitClass = 'btn-primary') {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalFooter').innerHTML = `
    <button class="btn" id="modal-cancel">取消</button>
    <button class="btn ${submitClass}" id="modal-submit">${submitText}</button>
  `;
  document.getElementById('modal').style.display = 'flex';
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-submit').addEventListener('click', onSubmit);
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 2800);
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function refreshAll() {
  loadList();
  if (currentId) loadDetail();
}

async function resetData() {
  if (!confirm('确定要重置所有数据吗？此操作不可撤销。')) return;
  await fetch('/api/reset', { method: 'POST' });
  toast('数据已重置', 'success');
  setTimeout(() => location.reload(), 500);
}

init();

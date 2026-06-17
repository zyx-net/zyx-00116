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
  },
  async put(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (getUserId()) headers['X-User-Id'] = getUserId();
    const res = await fetch(path, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body || {})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '操作失败');
    return data;
  },
  async delete(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (getUserId()) headers['X-User-Id'] = getUserId();
    const res = await fetch(path, {
      method: 'DELETE',
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '操作失败');
    return data;
  }
};

let currentUser = null;
let meta = null;
let currentStatus = 'all';
let currentTab = 'list';
let currentId = null;
let listData = [];
let taskData = [];
let selectedTaskIds = new Set();
let editingDeadlineId = null;
let budgetListData = [];
let currentBudgetId = null;
let budgetFilter = { month: '', departmentId: '', category: '' };
let budgetSummary = { totalAmount: 0, frozenAmount: 0, deductedAmount: 0, availableAmount: 0 };
let budgetTransactionData = [];

async function init() {
  meta = await API.get('/api/meta');
  initRoleSelect();
  initBudgetFilters();
  switchUser(meta.users[0].id);
  bindEvents();
}

function initBudgetFilters() {
  const deptSel = document.getElementById('budgetDeptFilter');
  const catSel = document.getElementById('budgetCategoryFilter');
  if (deptSel && meta.departments) {
    deptSel.innerHTML = '<option value="">全部</option>' +
      meta.departments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
  }
  if (catSel && meta.expenseCategories) {
    catSel.innerHTML = '<option value="">全部</option>' +
      meta.expenseCategories.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  const monthInput = document.getElementById('budgetMonthFilter');
  if (monthInput) {
    const now = new Date();
    monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
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
  document.getElementById('createBudgetBtn').addEventListener('click', showCreateBudgetModal);
  document.getElementById('resetBtn').addEventListener('click', resetData);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.querySelector('.modal-mask').addEventListener('click', closeModal);

  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  document.getElementById('batchRemindBtn').addEventListener('click', handleBatchRemind);

  document.getElementById('budgetSearchBtn').addEventListener('click', () => {
    budgetFilter.month = document.getElementById('budgetMonthFilter').value;
    budgetFilter.departmentId = document.getElementById('budgetDeptFilter').value;
    budgetFilter.category = document.getElementById('budgetCategoryFilter').value;
    loadBudgetList();
    loadBudgetSummary();
  });

  document.getElementById('budgetResetBtn').addEventListener('click', () => {
    const now = new Date();
    document.getElementById('budgetMonthFilter').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('budgetDeptFilter').value = '';
    document.getElementById('budgetCategoryFilter').value = '';
    budgetFilter = { month: '', departmentId: '', category: '' };
    loadBudgetList();
    loadBudgetSummary();
  });

  document.getElementById('budgetImportBtn').addEventListener('click', showBudgetImportModal);
  document.getElementById('budgetExportBtn').addEventListener('click', exportBudgets);
  document.getElementById('budgetTxExportBtn').addEventListener('click', exportBudgetTransactions);
  document.getElementById('budgetReconcileBtn').addEventListener('click', reconcileBudgets);
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-item').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('listContainer').style.display = tab === 'list' ? 'block' : 'none';
  document.getElementById('taskPanel').style.display = tab === 'tasks' ? 'flex' : 'none';
  document.getElementById('budgetPanel').style.display = tab === 'budgets' ? 'flex' : 'none';
  document.getElementById('createBtn').style.display =
    tab === 'list' && currentUser.role === 'applicant' ? 'inline-block' : 'none';
  document.getElementById('createBudgetBtn').style.display =
    tab === 'budgets' && ['admin', 'finance'].includes(currentUser.role) ? 'inline-block' : 'none';

  if (tab === 'tasks') {
    loadTaskList();
    renderDetailEmpty();
  } else if (tab === 'budgets') {
    loadBudgetList();
    loadBudgetSummary();
    renderBudgetDetailEmpty();
  } else {
    loadList();
  }
}

function switchUser(userId) {
  const user = meta.users.find(u => u.id === userId);
  currentUser = user;
  document.getElementById('roleSelect').value = userId;
  document.getElementById('createBtn').style.display =
    currentTab === 'list' && user.role === 'applicant' ? 'inline-block' : 'none';
  document.getElementById('createBudgetBtn').style.display =
    currentTab === 'budgets' && ['admin', 'finance'].includes(user.role) ? 'inline-block' : 'none';
  const budgetTab = document.getElementById('budgetTab');
  if (budgetTab) {
    budgetTab.style.display = ['admin', 'finance'].includes(user.role) ? 'inline-block' : 'none';
    if (currentTab === 'budgets' && !['admin', 'finance'].includes(user.role)) {
      switchTab('list');
    }
  }
  currentStatus = 'all';
  currentId = null;
  currentBudgetId = null;
  selectedTaskIds.clear();
  renderStatusNav();
  if (currentTab === 'tasks') {
    loadTaskList();
  } else if (currentTab === 'budgets') {
    loadBudgetList();
    loadBudgetSummary();
    renderBudgetDetailEmpty();
  } else {
    loadList();
  }
  if (currentTab !== 'budgets') {
    renderDetailEmpty();
  }
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

async function loadTaskList() {
  const data = await API.get('/api/supplement-tasks');
  taskData = data.tasks;
  renderTaskList();
  updateTaskStats();
}

function updateTaskStats() {
  document.getElementById('taskTotalCount').textContent = taskData.length;
  document.getElementById('taskOverdueCount').textContent = taskData.filter(t => t.overdue).length;
  document.getElementById('batchRemindBtn').disabled =
    selectedTaskIds.size === 0 || !['auditor', 'finance'].includes(currentUser.role);
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
    { key: 'withdrawn', label: '已撤销' },
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
     'approved', 'rejected', 'withdrawn', 'archived'].forEach(k => counts[k] = 0);
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
  container.innerHTML = listData.map(r => {
    const budgetTag = renderBudgetStatusTag(r.budgetStatus);
    return `
    <div class="list-item ${currentId === r.id ? 'active' : ''}" data-id="${r.id}">
      <div class="list-item-title">
        <span>${r.title}</span>
        <span class="list-item-id">${r.id}</span>
      </div>
      <div class="list-item-meta">
        <div>
          <span class="status-tag status-${r.status}">${r.statusLabel}</span>
          ${budgetTag}
          ${r.overdue ? '<span class="overdue-tag">已逾期</span>' : ''}
        </div>
        <span class="list-item-amount">¥${Number(r.amount).toFixed(2)}</span>
      </div>
    </div>
  `;
  }).join('');
  container.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', () => {
      currentId = el.dataset.id;
      renderList();
      loadDetail();
    });
  });
}

function renderBudgetStatusTag(budgetStatus) {
  if (!budgetStatus || !budgetStatus.hasBudget) {
    return '<span class="budget-status-tag budget-status-none">无预算</span>';
  }
  const statusMap = {
    frozen: { label: '冻结', cls: 'frozen' },
    deducted: { label: '扣减', cls: 'deducted' },
    released: { label: '释放', cls: 'released' }
  };
  const info = statusMap[budgetStatus.freezeStatus] || { label: budgetStatus.freezeStatus, cls: 'none' };
  return `<span class="budget-status-tag budget-status-${info.cls}">${info.label}</span>`;
}

function renderTaskList() {
  const container = document.getElementById('taskListContainer');
  const isFinanceRole = ['auditor', 'finance'].includes(currentUser.role);

  if (taskData.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无补件任务</div>';
    return;
  }

  container.innerHTML = taskData.map(t => {
    const isSelected = selectedTaskIds.has(t.id);
    const isEditing = editingDeadlineId === t.id;
    const deadlineText = formatDeadlineDisplay(t);
    const confirmTag = t.pendingConfirm ? '<span class="status-tag" style="background:#e6f7ff;color:#1890ff;border-color:#91d5ff;margin-left:6px">待确认</span>' : '';

    return `
      <div class="task-item ${currentId === t.id ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-id="${t.id}">
        <div class="task-item-header">
          ${isFinanceRole ? `<input type="checkbox" class="task-checkbox" data-task-id="${t.id}" ${isSelected ? 'checked' : ''}>` : ''}
          <span class="task-title">${t.title}</span>
          <span class="task-id">${t.id}</span>
          ${confirmTag}
        </div>
        <div class="task-meta">
          <span class="task-meta-item task-assignee">👤 ${t.applicantName}</span>
          <span class="task-meta-item task-amount">¥${Number(t.amount).toFixed(2)}</span>
          <span class="task-meta-item ${t.overdue ? 'overdue' : (t.remainingDays <= 1 ? 'warning' : '')}">
            ⏰ ${deadlineText}
          </span>
          <span class="task-meta-item">
            📢 ${t.remindCount} 次催办
          </span>
          <span class="task-meta-item">
            📅 最近催办：${t.lastReminderAt ? formatDate(t.lastReminderAt) : '-'}
          </span>
          <span class="task-meta-item">
            📎 缺失：${t.missingAttachments.length > 0 ? t.missingAttachments.join('、') : '已补齐'}
          </span>
        </div>
        ${isFinanceRole ? `
        <div class="task-quick-actions">
          ${isEditing ? `
            <input type="date" id="deadline-input-${t.id}" value="${t.deadline ? t.deadline.slice(0, 10) : ''}">
            <button class="btn btn-success btn-sm" data-action="save-deadline" data-id="${t.id}">保存</button>
            <button class="btn btn-secondary btn-sm" data-action="cancel-deadline" data-id="${t.id}">取消</button>
          ` : `
            <button class="btn btn-warning btn-sm" data-action="remind" data-id="${t.id}" data-version="${t.version}">催办</button>
            <button class="btn btn-primary btn-sm" data-action="edit-deadline" data-id="${t.id}">改截止</button>
            <button class="btn btn-success btn-sm" data-action="confirm-complete" data-id="${t.id}" data-version="${t.version}">确认完成</button>
          `}
        </div>
        ` : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.task-checkbox').forEach(cb => {
    cb.addEventListener('click', e => {
      e.stopPropagation();
      const id = cb.dataset.taskId;
      if (cb.checked) {
        selectedTaskIds.add(id);
      } else {
        selectedTaskIds.delete(id);
      }
      cb.closest('.task-item').classList.toggle('selected', cb.checked);
      updateTaskStats();
    });
  });

  container.querySelectorAll('.task-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.task-checkbox') ||
          e.target.closest('.task-quick-actions') ||
          e.target.closest('input')) {
        return;
      }
      currentId = el.dataset.id;
      renderTaskList();
      loadDetail();
    });
  });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const version = parseInt(btn.dataset.version) || undefined;
      handleTaskAction(action, id, version);
    });
  });
}

function formatDeadlineDisplay(t) {
  if (!t.deadline) return '无截止时间';
  if (t.overdue) {
    return `已逾期 ${Math.abs(t.remainingDays)} 天`;
  }
  if (t.remainingDays <= 1) {
    return `剩余 ${t.remainingDays} 天（${t.deadline.slice(0, 10)}）`;
  }
  return `剩余 ${t.remainingDays} 天`;
}

async function handleTaskAction(action, id, version) {
  const task = taskData.find(t => t.id === id);
  if (!task) return;

  try {
    switch (action) {
      case 'remind':
        await API.post(`/api/reimbursements/${id}/remind`, { version });
        toast('催办成功', 'success');
        refreshAll();
        break;
      case 'edit-deadline':
        editingDeadlineId = id;
        renderTaskList();
        setTimeout(() => {
          const input = document.getElementById(`deadline-input-${id}`);
          if (input) input.focus();
        }, 50);
        break;
      case 'save-deadline':
        const input = document.getElementById(`deadline-input-${id}`);
        const newDeadline = input ? input.value : '';
        if (!newDeadline) {
          toast('请选择截止日期', 'error');
          return;
        }
        await API.put(`/api/reimbursements/${id}/deadline`, {
          newDeadline: new Date(newDeadline).toISOString(),
          version: task.version
        });
        toast('截止时间已更新', 'success');
        editingDeadlineId = null;
        refreshAll();
        break;
      case 'cancel-deadline':
        editingDeadlineId = null;
        renderTaskList();
        break;
      case 'confirm-complete':
        if (!confirm('确定确认补件完成吗？确认后将进入待复核状态。')) return;
        await API.post(`/api/reimbursements/${id}/confirm-supplement`, { version });
        toast('补件完成已确认', 'success');
        refreshAll();
        break;
    }
  } catch (e) {
    if (e.message.includes('版本冲突')) {
      toast(e.message + '，正在刷新...', 'error');
      setTimeout(() => {
        refreshAll();
      }, 1500);
    } else {
      toast(e.message, 'error');
    }
  }
}

async function handleBatchRemind() {
  if (selectedTaskIds.size === 0) {
    toast('请先选择要催办的单据', 'error');
    return;
  }
  if (!confirm(`确定催办选中的 ${selectedTaskIds.size} 张单据吗？`)) return;

  try {
    const result = await API.post('/api/reimbursements/batch-remind', {
      ids: Array.from(selectedTaskIds)
    });
    const successCount = result.success.length;
    const failCount = result.failed.length;
    let msg = `批量催办完成：成功 ${successCount} 条`;
    if (failCount > 0) msg += `，失败 ${failCount} 条`;
    toast(msg, failCount > 0 ? 'info' : 'success');
    selectedTaskIds.clear();
    refreshAll();
  } catch (e) {
    toast(e.message, 'error');
  }
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
      <div class="detail-card-header">📌 补件信息${d.status === 'pending_supplement' && (!d.missingAttachments || d.missingAttachments.length === 0) ? '<span class="status-tag" style="background:#e6f7ff;color:#1890ff;border-color:#91d5ff;margin-left:8px">材料已补齐，待确认</span>' : ''}</div>
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
          <span class="detail-value">${d.remindCount} 次</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">缺失材料</span>
          <span class="detail-value">${d.missingAttachments?.length > 0 ? d.missingAttachments.join('、') : '已全部补齐'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">版本号</span>
          <span class="detail-value">v${d.version || 1}</span>
        </div>
      </div>
    </div>
  ` : '';
  const budgetSection = renderBudgetDetailSection(d.budgetStatus);
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
    ${budgetSection}

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

function renderBudgetDetailSection(budgetStatus) {
  if (!budgetStatus || !budgetStatus.hasBudget) {
    return `
    <div class="detail-card">
      <div class="detail-card-header">💰 预算信息</div>
      <div class="detail-card-body">
        <div style="color:#999;text-align:center;padding:20px 0">
          <span class="budget-status-tag budget-status-none">无预算</span>
          <p style="margin-top:8px;font-size:13px">该报销单未关联预算</p>
        </div>
      </div>
    </div>
    `;
  }
  const statusMap = {
    frozen: { label: '已冻结', cls: 'frozen' },
    deducted: { label: '已扣减', cls: 'deducted' },
    released: { label: '已释放', cls: 'released' }
  };
  const statusInfo = statusMap[budgetStatus.freezeStatus] || { label: budgetStatus.freezeStatus, cls: 'none' };
  const usagePercent = budgetStatus.budgetInfo && budgetStatus.budgetInfo.totalAmount > 0
    ? Math.min(100, ((budgetStatus.budgetInfo.usedAmount + budgetStatus.budgetInfo.frozenAmount) / budgetStatus.budgetInfo.totalAmount * 100)).toFixed(1)
    : 0;

  return `
    <div class="detail-card">
      <div class="detail-card-header">
        <span>💰 预算信息</span>
        <span class="budget-status-tag budget-status-${statusInfo.cls}">${statusInfo.label}</span>
      </div>
      <div class="detail-card-body">
        <div class="detail-row">
          <span class="detail-label">预算月份</span>
          <span class="detail-value">${budgetStatus.month || '-'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">部门</span>
          <span class="detail-value">${budgetStatus.departmentName || '-'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">费用科目</span>
          <span class="detail-value">${budgetStatus.category || '-'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">冻结金额</span>
          <span class="detail-value" style="color:#fa8c16;font-weight:600">¥${Number(budgetStatus.frozenAmount).toFixed(2)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">扣减金额</span>
          <span class="detail-value" style="color:#f5222d;font-weight:600">¥${Number(budgetStatus.deductedAmount).toFixed(2)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">释放金额</span>
          <span class="detail-value" style="color:#52c41a;font-weight:600">¥${Number(budgetStatus.releasedAmount).toFixed(2)}</span>
        </div>
        ${budgetStatus.budgetInfo ? `
        <div class="detail-row" style="border-bottom:none">
          <span class="detail-label">预算总额度</span>
          <span class="detail-value">¥${Number(budgetStatus.budgetInfo.totalAmount).toFixed(2)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">可用余额</span>
          <span class="detail-value" style="color:#52c41a;font-weight:600">¥${Number(budgetStatus.budgetInfo.availableAmount).toFixed(2)}</span>
        </div>
        <div class="budget-progress-bar">
          <div class="budget-progress-fill" style="width:${usagePercent}%"></div>
        </div>
        <div style="text-align:right;font-size:12px;color:#999;margin-top:4px">已使用 ${usagePercent}%</div>
        ` : ''}
      </div>
    </div>
  `;
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
        <span class="reminder-time">${formatDate(r.lastRemindedAt || r.remindedAt)}</span>
      </div>
      <div class="reminder-msg">${r.message}</div>
      <div style="margin-top:6px;font-size:12px;color:#999">
        补件轮次：第 ${r.cycle} 轮 · 截止：${formatDate(r.deadline)}
        ${r.assigneeName ? ` · 负责人：${r.assigneeName}` : ''}
      </div>
      <div style="margin-top:4px;font-size:11px;color:#1890ff">
        首次催办：${formatDate(r.remindedAt)} ${r.lastRemindedAt && r.lastRemindedAt !== r.remindedAt ? `· 最新催办：${formatDate(r.lastRemindedAt)}` : ''}
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
    update_deadline: '修改截止时间',
    confirm_supplement_complete: '确认补件完成',
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
  if (action === 'update_deadline') return '#1890ff';
  if (action === 'confirm_supplement_complete') return '#52c41a';
  return '#1890ff';
}

function roleLabel(role) {
  const map = { applicant: '申请人', auditor: '审核员', finance: '财务复核员', archiver: '归档员' };
  return map[role] || role;
}

function renderActions(d) {
  const role = currentUser.role;
  const btns = [];
  if (role === 'applicant' && d.applicantId === currentUser.id) {
    if (d.status === 'pending_audit') {
      btns.push(`<button class="btn withdraw-btn" data-action="withdraw" data-version="${d.version}">↩️ 撤销</button>`);
    }
    if (d.status === 'withdrawn' || d.status === 'rejected') {
      btns.push(`<button class="btn resubmit-btn" data-action="resubmit" data-version="${d.version}">📤 重新提交</button>`);
    }
  }
  if (role === 'auditor' && d.status === 'pending_audit') {
    btns.push(`<button class="btn btn-success" data-action="approve" data-version="${d.version}">✅ 初审通过</button>`);
    btns.push(`<button class="btn btn-warning" data-action="supplement" data-version="${d.version}">📨 发起补件</button>`);
    btns.push(`<button class="btn btn-danger" data-action="reject" data-version="${d.version}">❌ 驳回</button>`);
  }
  if (role === 'finance' && d.status === 'pending_review') {
    btns.push(`<button class="btn btn-success" data-action="approve" data-version="${d.version}">✅ 复核通过</button>`);
    btns.push(`<button class="btn btn-warning" data-action="supplement" data-version="${d.version}">📨 发起补件</button>`);
    btns.push(`<button class="btn btn-danger" data-action="reject" data-version="${d.version}">❌ 驳回</button>`);
  }
  if ((role === 'auditor' || role === 'finance') && d.status === 'pending_supplement') {
    btns.push(`<button class="btn btn-warning" data-action="remind" data-version="${d.version}">⏰ 再次催办</button>`);
    btns.push(`<button class="btn btn-primary" data-action="edit-deadline-detail" data-version="${d.version}">📅 修改截止时间</button>`);
    btns.push(`<button class="btn btn-success" data-action="confirm-complete-detail" data-version="${d.version}">✅ 确认补件完成</button>`);
  }
  if (role === 'applicant' && d.status === 'pending_supplement' && d.applicantId === currentUser.id) {
    btns.push(`<button class="btn btn-primary" data-action="submit-supplement" data-version="${d.version}">📎 提交补件</button>`);
  }
  if (role === 'archiver' && d.status === 'approved') {
    btns.push(`<button class="btn btn-primary" data-action="archive" data-version="${d.version}">📦 归档</button>`);
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
    btn.addEventListener('click', () => {
      const version = parseInt(btn.dataset.version) || undefined;
      handleAction(btn.dataset.action, d, version);
    });
  });
}

async function handleAction(action, d, version) {
  try {
    switch (action) {
      case 'approve':
        await API.post(`/api/reimbursements/${d.id}/approve`, { version });
        toast('操作成功', 'success');
        refreshAll();
        break;
      case 'reject':
        showRejectModal(d, version);
        break;
      case 'supplement':
        showSupplementModal(d, version);
        break;
      case 'remind':
        const rm = await API.post(`/api/reimbursements/${d.id}/remind`, { version });
        toast(`已催办，当前第 ${rm.remindCount} 次（同一周期历史合并）`, 'info');
        refreshAll();
        break;
      case 'edit-deadline-detail':
        showDeadlineModal(d, version);
        break;
      case 'confirm-complete-detail':
        if (!confirm('确定确认补件完成吗？确认后将进入待复核状态。')) return;
        await API.post(`/api/reimbursements/${d.id}/confirm-supplement`, { version });
        toast('补件完成已确认', 'success');
        refreshAll();
        break;
      case 'submit-supplement':
        showSubmitSupplementModal(d, version);
        break;
      case 'archive':
        await API.post(`/api/reimbursements/${d.id}/archive`, { version });
        toast('归档成功', 'success');
        refreshAll();
        break;
      case 'export':
        window.open(`/api/reimbursements/${d.id}/export`, '_blank');
        break;
      case 'withdraw':
        showWithdrawModal(d, version);
        break;
      case 'resubmit':
        if (!confirm('确定要重新提交这张报销单吗？')) return;
        await API.post(`/api/reimbursements/${d.id}/resubmit`, { version });
        toast('已重新提交', 'success');
        refreshAll();
        break;
    }
  } catch (e) {
    if (e.message.includes('版本冲突')) {
      toast(e.message + '，正在刷新...', 'error');
      setTimeout(() => {
        refreshAll();
      }, 1500);
    } else {
      toast(e.message, 'error');
    }
  }
}

function showDeadlineModal(d, version) {
  const currentDeadline = d.deadline ? d.deadline.slice(0, 10) : '';
  openModal('修改截止时间', `
    <p style="margin-bottom:12px;color:#666">当前截止时间：${d.deadline ? formatDate(d.deadline) : '未设置'}</p>
    <div class="form-group">
      <label>新截止日期</label>
      <input type="date" id="new-deadline" value="${currentDeadline}">
    </div>
    <div class="form-group">
      <label>或选择延期天数</label>
      <select id="deadline-days-select">
        <option value="">-- 选择天数 --</option>
        <option value="1">延期 1 天</option>
        <option value="3">延期 3 天</option>
        <option value="5">延期 5 天</option>
        <option value="7">延期 7 天</option>
        <option value="15">延期 15 天</option>
      </select>
    </div>
  `, async () => {
    const dateInput = document.getElementById('new-deadline');
    const daysSelect = document.getElementById('deadline-days-select');
    let newDeadline = null;

    if (daysSelect.value) {
      const days = parseInt(daysSelect.value);
      const baseDate = d.deadline ? new Date(d.deadline) : new Date();
      baseDate.setDate(baseDate.getDate() + days);
      newDeadline = baseDate.toISOString();
    } else if (dateInput.value) {
      newDeadline = new Date(dateInput.value).toISOString();
    }

    if (!newDeadline) {
      toast('请选择新的截止时间', 'error');
      return false;
    }

    try {
      await API.put(`/api/reimbursements/${d.id}/deadline`, { newDeadline, version });
      toast('截止时间已更新', 'success');
      closeModal();
      refreshAll();
    } catch (e) {
      toast(e.message, 'error');
      if (e.message.includes('版本冲突')) {
        setTimeout(() => {
          closeModal();
          refreshAll();
        }, 1500);
      }
    }
    return false;
  }, '确认修改', 'btn-primary');
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

function showWithdrawModal(d, version) {
  openModal('撤销报销单', `
    <p style="margin-bottom:12px;color:#666">确定要撤销 <strong>${d.id}</strong> 吗？撤销后预算将被释放。</p>
    <div class="form-group">
      <label>撤销原因</label>
      <textarea id="withdraw-reason" placeholder="请填写撤销原因（可选）"></textarea>
    </div>
  `, () => {
    const reason = document.getElementById('withdraw-reason').value.trim();
    API.post(`/api/reimbursements/${d.id}/withdraw`, { reason, version })
      .then(() => {
        toast('已撤销', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => {
        toast(e.message, 'error');
        if (e.message.includes('版本冲突')) {
          setTimeout(() => { closeModal(); refreshAll(); }, 1500);
        }
      });
    return false;
  }, '确认撤销', 'btn-warning');
}

function showRejectModal(d, version) {
  openModal('驳回报销单', `
    <p style="margin-bottom:12px;color:#666">确定要驳回 <strong>${d.id}</strong> 吗？</p>
    <div class="form-group">
      <label>驳回原因</label>
      <textarea id="reject-reason" placeholder="请详细说明驳回原因，便于申请人修改"></textarea>
    </div>
  `, () => {
    const reason = document.getElementById('reject-reason').value.trim();
    if (!reason) { toast('请填写驳回原因', 'error'); return false; }
    API.post(`/api/reimbursements/${d.id}/reject`, { reason, version })
      .then(() => {
        toast('已驳回', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => {
        toast(e.message, 'error');
        if (e.message.includes('版本冲突')) {
          setTimeout(() => { closeModal(); refreshAll(); }, 1500);
        }
      });
    return false;
  }, '确认驳回', 'btn-danger');
}

function showSupplementModal(d, version) {
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
      missingAttachments: missing, deadlineDays: days, version
    })
      .then(() => {
        toast('补件已发起', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => {
        toast(e.message, 'error');
        if (e.message.includes('版本冲突')) {
          setTimeout(() => { closeModal(); refreshAll(); }, 1500);
        }
      });
    return false;
  }, '发起补件', 'btn-warning');
}

function showSubmitSupplementModal(d, version) {
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
    API.post(`/api/reimbursements/${d.id}/submit-supplement`, { attachments, version })
      .then(() => {
        toast('补件已提交', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => {
        toast(e.message, 'error');
        if (e.message.includes('版本冲突')) {
          setTimeout(() => { closeModal(); refreshAll(); }, 1500);
        }
      });
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
  if (currentTab === 'tasks') {
    loadTaskList();
  } else if (currentTab === 'budgets') {
    loadBudgetList();
    loadBudgetSummary();
    if (currentBudgetId) loadBudgetDetail();
  } else {
    loadList();
  }
  if (currentId && currentTab !== 'budgets') loadDetail();
}

async function loadBudgetList() {
  const container = document.getElementById('budgetListContainer');
  const params = new URLSearchParams();
  if (budgetFilter.month) params.set('month', budgetFilter.month);
  if (budgetFilter.departmentId) params.set('departmentId', budgetFilter.departmentId);
  if (budgetFilter.category) params.set('category', budgetFilter.category);
  const query = params.toString();
  const data = await API.get('/api/budgets' + (query ? '?' + query : ''));
  budgetListData = data.list;
  renderBudgetList();
}

async function loadBudgetSummary() {
  const params = new URLSearchParams();
  if (budgetFilter.month) params.set('month', budgetFilter.month);
  if (budgetFilter.departmentId) params.set('departmentId', budgetFilter.departmentId);
  const query = params.toString();
  try {
    const data = await API.get('/api/budgets/summary' + (query ? '?' + query : ''));
    budgetSummary = data;
    updateBudgetSummaryDisplay();
  } catch (e) {
    console.error('加载预算汇总失败', e);
  }
}

function updateBudgetSummaryDisplay() {
  document.getElementById('budgetTotalAmount').textContent =
    '¥' + Number(budgetSummary.totalAmount || 0).toFixed(2);
  document.getElementById('budgetFrozenAmount').textContent =
    '¥' + Number(budgetSummary.frozenAmount || 0).toFixed(2);
  document.getElementById('budgetDeductedAmount').textContent =
    '¥' + Number(budgetSummary.usedAmount || budgetSummary.deductedAmount || 0).toFixed(2);
  document.getElementById('budgetAvailableAmount').textContent =
    '¥' + Number(budgetSummary.availableAmount || 0).toFixed(2);
}

function renderBudgetList() {
  const container = document.getElementById('budgetListContainer');
  if (budgetListData.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无预算数据</div>';
    return;
  }
  container.innerHTML = budgetListData.map(b => `
    <div class="budget-item ${currentBudgetId === b.id ? 'active' : ''}" data-id="${b.id}">
      <div class="budget-item-header">
        <span class="budget-item-title">${b.departmentName} - ${b.category}</span>
        <span class="budget-item-month">${b.month}</span>
      </div>
      <div class="budget-item-meta">
        <span class="budget-item-amount">总额 ¥${Number(b.totalAmount).toFixed(2)}</span>
        <span class="budget-item-used">已用 ¥${(Number(b.usedAmount) + Number(b.frozenAmount)).toFixed(2)}</span>
        <span class="budget-item-available">可用 ¥${Number(b.availableAmount).toFixed(2)}</span>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('.budget-item').forEach(el => {
    el.addEventListener('click', () => {
      currentBudgetId = el.dataset.id;
      renderBudgetList();
      loadBudgetDetail();
    });
  });
}

function renderBudgetDetailEmpty() {
  document.getElementById('detailPanel').innerHTML = `
    <div class="empty-state">
      <div style="font-size:48px;margin-bottom:16px">💰</div>
      <p>请选择左侧预算查看详情</p>
    </div>
  `;
}

async function loadBudgetDetail() {
  if (!currentBudgetId) return;
  const detail = await API.get('/api/budgets/' + currentBudgetId);
  const txData = await API.get(`/api/budgets/${currentBudgetId}/transactions`);
  budgetTransactionData = txData.list;
  renderBudgetDetail(detail);
}

function renderBudgetDetail(b) {
  const panel = document.getElementById('detailPanel');
  const usedPercent = b.totalAmount > 0
    ? Math.min(100, ((b.usedAmount + b.frozenAmount) / b.totalAmount * 100)).toFixed(1)
    : 0;
  const isFinanceOrAdmin = ['admin', 'finance'].includes(currentUser.role);
  const transactionsHtml = renderBudgetTransactions(budgetTransactionData);

  panel.innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <span>💰 ${b.departmentName} - ${b.category}</span>
        <span class="status-tag ${b.availableAmount < 0 ? 'status-rejected' : 'status-approved'}">
          ${b.availableAmount < 0 ? '超支' : '正常'}
        </span>
      </div>
      <div class="detail-card-body">
        <div class="detail-row">
          <span class="detail-label">预算编号</span>
          <span class="detail-value">${b.id}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">预算月份</span>
          <span class="detail-value">${b.month}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">部门</span>
          <span class="detail-value">${b.departmentName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">费用科目</span>
          <span class="detail-value">${b.category}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">预算总额</span>
          <span class="detail-value amount">¥${Number(b.totalAmount).toFixed(2)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">已扣减</span>
          <span class="detail-value" style="color:#f5222d;font-weight:600">¥${Number(b.usedAmount).toFixed(2)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">已冻结</span>
          <span class="detail-value" style="color:#fa8c16;font-weight:600">¥${Number(b.frozenAmount).toFixed(2)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">可用余额</span>
          <span class="detail-value" style="color:${b.availableAmount >= 0 ? '#52c41a' : '#f5222d'};font-weight:600">
            ¥${Number(b.availableAmount).toFixed(2)}
          </span>
        </div>
        <div class="budget-progress-bar">
          <div class="budget-progress-fill" style="width:${usedPercent}%"></div>
        </div>
        <div style="text-align:right;font-size:12px;color:#999;margin-top:4px">使用率 ${usedPercent}%</div>
        <div class="detail-row" style="border-bottom:none">
          <span class="detail-label">版本号</span>
          <span class="detail-value">v${b.version || 1}</span>
        </div>
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-card-header">📊 预算流水</div>
      <div class="detail-card-body">
        <div class="budget-transaction-list">
          ${transactionsHtml}
        </div>
      </div>
    </div>

    ${isFinanceOrAdmin ? `
    <div class="detail-card">
      <div class="detail-card-header">⚡ 操作</div>
      <div class="detail-card-body">
        <div class="action-bar">
          <button class="btn btn-primary" data-budget-action="adjust" data-id="${b.id}" data-version="${b.version}">
            ✏️ 调整额度
          </button>
          <button class="btn btn-info" data-budget-action="edit" data-id="${b.id}" data-version="${b.version}">
            📝 编辑信息
          </button>
          ${currentUser.role === 'admin' ? `
          <button class="btn btn-danger" data-budget-action="delete" data-id="${b.id}">
            🗑️ 删除预算
          </button>
          ` : ''}
        </div>
      </div>
    </div>
    ` : ''}
  `;

  bindBudgetDetailActions(b);
}

function renderBudgetTransactions(list) {
  if (!list || list.length === 0) {
    return '<div style="color:#999;text-align:center;padding:20px 0">暂无流水记录</div>';
  }
  const typeMap = {
    allocate: { label: '分配额度', cls: 'type-allocate', sign: 1 },
    adjust: { label: '手工调整', cls: 'type-adjust', sign: 0 },
    freeze: { label: '冻结占用', cls: 'type-freeze', sign: -1 },
    deduct: { label: '扣减已用', cls: 'type-deduct', sign: -1 },
    release: { label: '释放回冲', cls: 'type-release', sign: 1 },
    import: { label: 'CSV导入', cls: 'type-import', sign: 1 }
  };
  return list.map(t => {
    const info = typeMap[t.type] || { label: t.type, cls: '', sign: 0 };
    const amountClass = info.sign > 0 ? 'positive' : (info.sign < 0 ? 'negative' : '');
    const amountPrefix = info.sign > 0 ? '+' : (info.sign < 0 ? '-' : '');
    return `
      <div class="budget-transaction-item ${info.cls}">
        <div class="budget-transaction-header">
          <span>${info.label}</span>
          <span class="budget-transaction-amount ${amountClass}">
            ${amountPrefix}¥${Number(Math.abs(t.amount)).toFixed(2)}
          </span>
        </div>
        <div class="budget-transaction-desc">${t.remark || '-'}</div>
        <div class="budget-transaction-time">
          ${formatDate(t.operatedAt)} · ${t.operatorName || '系统'}
          ${t.reimbursementId ? ` · 单据: ${t.reimbursementId}` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function bindBudgetDetailActions(b) {
  document.querySelectorAll('[data-budget-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.budgetAction;
      const version = parseInt(btn.dataset.version) || undefined;
      handleBudgetAction(action, b, version);
    });
  });
}

async function handleBudgetAction(action, b, version) {
  try {
    switch (action) {
      case 'adjust':
        showAdjustBudgetModal(b, version);
        break;
      case 'edit':
        showEditBudgetModal(b, version);
        break;
      case 'delete':
        if (!confirm('确定要删除这个预算吗？此操作不可撤销。')) return;
        await API.delete(`/api/budgets/${b.id}`);
        toast('预算已删除', 'success');
        currentBudgetId = null;
        refreshAll();
        renderBudgetDetailEmpty();
        break;
    }
  } catch (e) {
    if (e.message.includes('版本冲突')) {
      toast(e.message + '，正在刷新...', 'error');
      setTimeout(() => {
        refreshAll();
      }, 1500);
    } else {
      toast(e.message, 'error');
    }
  }
}

function showCreateBudgetModal() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const deptOptions = meta.departments.map(d =>
    `<option value="${d.id}">${d.name}</option>`
  ).join('');
  const catOptions = meta.expenseCategories.map(c =>
    `<option value="${c}">${c}</option>`
  ).join('');

  openModal('新建预算', `
    <div class="form-group">
      <label>预算月份</label>
      <input type="month" id="f-budget-month" value="${defaultMonth}">
    </div>
    <div class="form-group">
      <label>部门</label>
      <select id="f-budget-dept">
        ${deptOptions}
      </select>
    </div>
    <div class="form-group">
      <label>费用科目</label>
      <select id="f-budget-category">
        ${catOptions}
      </select>
    </div>
    <div class="form-group">
      <label>预算金额（元）</label>
      <input type="number" id="f-budget-amount" step="0.01" placeholder="0.00">
    </div>
    <div class="form-group">
      <label>备注（可选）</label>
      <textarea id="f-budget-remark" placeholder="预算说明"></textarea>
    </div>
  `, () => {
    const month = document.getElementById('f-budget-month').value;
    const departmentId = document.getElementById('f-budget-dept').value;
    const category = document.getElementById('f-budget-category').value;
    const totalAmount = parseFloat(document.getElementById('f-budget-amount').value);
    const remark = document.getElementById('f-budget-remark').value.trim();

    if (!month) { toast('请选择预算月份', 'error'); return false; }
    if (!departmentId) { toast('请选择部门', 'error'); return false; }
    if (!category) { toast('请选择费用科目', 'error'); return false; }
    if (!totalAmount || totalAmount < 0) { toast('请填写有效金额', 'error'); return false; }

    API.post('/api/budgets', { month, departmentId, category, totalAmount, remark })
      .then(() => {
        toast('预算创建成功', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => {
        toast(e.message, 'error');
      });
    return false;
  }, '创建预算', 'btn-primary');
}

function showAdjustBudgetModal(b, version) {
  openModal('调整预算额度', `
    <p style="margin-bottom:12px;color:#666">
      当前预算：<strong>${b.departmentName} - ${b.category}</strong><br>
      当前额度：<strong>¥${Number(b.totalAmount).toFixed(2)}</strong>
    </p>
    <div class="form-group">
      <label>调整方式</label>
      <select id="adjust-type">
        <option value="add">增加额度</option>
        <option value="subtract">减少额度</option>
        <option value="set">设置为</option>
      </select>
    </div>
    <div class="form-group">
      <label>金额（元）</label>
      <input type="number" id="adjust-amount" step="0.01" placeholder="0.00">
    </div>
    <div class="form-group">
      <label>调整原因</label>
      <textarea id="adjust-remark" placeholder="请说明调整原因"></textarea>
    </div>
  `, () => {
    const adjustType = document.getElementById('adjust-type').value;
    const inputAmount = parseFloat(document.getElementById('adjust-amount').value);
    const remark = document.getElementById('adjust-remark').value.trim();

    if (!inputAmount || inputAmount <= 0) {
      toast('请填写有效金额', 'error');
      return false;
    }
    if (!remark) {
      toast('请填写调整原因', 'error');
      return false;
    }

    let adjustmentAmount;
    if (adjustType === 'add') {
      adjustmentAmount = inputAmount;
    } else if (adjustType === 'subtract') {
      adjustmentAmount = -inputAmount;
    } else {
      adjustmentAmount = inputAmount - b.totalAmount;
    }

    API.post(`/api/budgets/${b.id}/adjust`, { adjustmentAmount, remark, version })
      .then(() => {
        toast('预算调整成功', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => {
        toast(e.message, 'error');
        if (e.message.includes('版本冲突')) {
          setTimeout(() => { closeModal(); refreshAll(); }, 1500);
        }
      });
    return false;
  }, '确认调整', 'btn-primary');
}

function showEditBudgetModal(b, version) {
  const deptOptions = meta.departments.map(d =>
    `<option value="${d.id}" ${d.id === b.departmentId ? 'selected' : ''}>${d.name}</option>`
  ).join('');
  const catOptions = meta.expenseCategories.map(c =>
    `<option value="${c}" ${c === b.category ? 'selected' : ''}>${c}</option>`
  ).join('');

  openModal('编辑预算信息', `
    <div class="form-group">
      <label>预算月份</label>
      <input type="month" id="edit-budget-month" value="${b.month}">
    </div>
    <div class="form-group">
      <label>部门</label>
      <select id="edit-budget-dept">
        ${deptOptions}
      </select>
    </div>
    <div class="form-group">
      <label>费用科目</label>
      <select id="edit-budget-category">
        ${catOptions}
      </select>
    </div>
    <p style="color:#999;font-size:12px;margin-top:8px">
      注：修改基本信息不影响预算额度，调整额度请使用"调整额度"功能。
    </p>
  `, () => {
    const month = document.getElementById('edit-budget-month').value;
    const departmentId = document.getElementById('edit-budget-dept').value;
    const category = document.getElementById('edit-budget-category').value;

    if (!month) { toast('请选择预算月份', 'error'); return false; }

    API.put(`/api/budgets/${b.id}`, { month, departmentId, category, version })
      .then(() => {
        toast('预算信息已更新', 'success');
        closeModal();
        refreshAll();
      })
      .catch(e => {
        toast(e.message, 'error');
        if (e.message.includes('版本冲突')) {
          setTimeout(() => { closeModal(); refreshAll(); }, 1500);
        }
      });
    return false;
  }, '保存修改', 'btn-primary');
}

function showBudgetImportModal() {
  openModal('CSV导入预算', `
    <p style="margin-bottom:12px;color:#666">
      请上传 CSV 文件，格式：月份,部门ID,科目,总额度
    </p>
    <div class="form-group">
      <label>CSV 内容</label>
      <textarea id="import-csv-content" rows="8" placeholder="month,departmentId,category,totalAmount
2024-01,dept1,差旅费,50000
2024-01,dept1,办公费,10000"></textarea>
    </div>
    <div class="import-tips">
      <div class="tip-title">📋 导入规则说明</div>
      <ul class="tip-list">
        <li><span class="tip-success">●</span> <strong>成功导入</strong>：新的月份+部门+科目组合，会创建新预算</li>
        <li><span class="tip-skipped">●</span> <strong>跳过重复</strong>：已存在的预算配置会被跳过，不会覆盖</li>
        <li><span class="tip-failed">●</span> <strong>导入失败</strong>：格式错误或数据不合法的行会被拒绝</li>
        <li><span class="tip-info">💡</span> 导入后可使用"导出对账"功能验证数据完整性</li>
      </ul>
    </div>
  `, () => {
    const csvContent = document.getElementById('import-csv-content').value.trim();
    if (!csvContent) {
      toast('请输入CSV内容', 'error');
      return false;
    }
    API.post('/api/budgets/import', { csvContent })
      .then(result => {
        showImportResultModal(result);
      })
      .catch(e => {
        toast(e.message, 'error');
      });
    return false;
  }, '开始导入', 'btn-success');
}

function showImportResultModal(result) {
  const successCount = result.success ? result.success.length : 0;
  const skippedCount = result.skipped ? result.skipped.length : 0;
  const failedCount = result.failed ? result.failed.length : 0;
  const totalCount = successCount + skippedCount + failedCount;

  let successHTML = '';
  if (successCount > 0) {
    successHTML = `
      <div class="result-section success">
        <div class="result-section-title">✅ 成功导入 (${successCount} 条)</div>
        <div class="result-list">
          ${result.success.slice(0, 10).map(s => `
            <div class="result-item">
              <span class="result-line">第${s.line}行</span>
              <span class="result-key">${s.key}</span>
              <span class="result-amount">¥${Number(s.totalAmount).toFixed(2)}</span>
            </div>
          `).join('')}
          ${successCount > 10 ? `<div class="result-more">...还有 ${successCount - 10} 条</div>` : ''}
        </div>
      </div>
    `;
  }

  let skippedHTML = '';
  if (skippedCount > 0) {
    skippedHTML = `
      <div class="result-section skipped">
        <div class="result-section-title">⏭️ 跳过重复 (${skippedCount} 条)</div>
        <div class="result-list">
          ${result.skipped.slice(0, 5).map(s => `
            <div class="result-item">
              <span class="result-line">第${s.line}行</span>
              <span class="result-key">${s.key}</span>
              <span class="result-reason">${s.reason}</span>
            </div>
          `).join('')}
          ${skippedCount > 5 ? `<div class="result-more">...还有 ${skippedCount - 5} 条</div>` : ''}
        </div>
      </div>
    `;
  }

  let failedHTML = '';
  if (failedCount > 0) {
    failedHTML = `
      <div class="result-section failed">
        <div class="result-section-title">❌ 导入失败 (${failedCount} 条)</div>
        <div class="result-list">
          ${result.failed.slice(0, 5).map(f => `
            <div class="result-item">
              <span class="result-line">第${f.line}行</span>
              <span class="result-reason">${f.error}</span>
            </div>
          `).join('')}
          ${failedCount > 5 ? `<div class="result-more">...还有 ${failedCount - 5} 条</div>` : ''}
        </div>
      </div>
    `;
  }

  openModal('导入结果', `
    <div class="import-result-summary">
      <div class="summary-stat total">
        <div class="stat-value">${totalCount}</div>
        <div class="stat-label">总计处理</div>
      </div>
      <div class="summary-stat success">
        <div class="stat-value">${successCount}</div>
        <div class="stat-label">成功导入</div>
      </div>
      <div class="summary-stat skipped">
        <div class="stat-value">${skippedCount}</div>
        <div class="stat-label">跳过重复</div>
      </div>
      <div class="summary-stat failed">
        <div class="stat-value">${failedCount}</div>
        <div class="stat-label">导入失败</div>
      </div>
    </div>
    ${successHTML}
    ${skippedHTML}
    ${failedHTML}
    <div class="result-actions">
      <button class="btn btn-primary btn-sm" onclick="exportBudgets();closeModal();">📤 导出对账</button>
      <button class="btn btn-secondary btn-sm" onclick="closeModal();refreshBudgetList();">确定</button>
    </div>
  `, null, null, null);
}

function exportBudgets() {
  const params = new URLSearchParams();
  if (budgetFilter.month) params.set('month', budgetFilter.month);
  if (budgetFilter.departmentId) params.set('departmentId', budgetFilter.departmentId);
  if (budgetFilter.category) params.set('category', budgetFilter.category);
  const query = params.toString();
  const url = '/api/budgets/export' + (query ? '?' + query : '');
  const userId = getUserId();
  fetch(url, { headers: { 'X-User-Id': userId } })
    .then(res => res.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `budgets_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('预算导出成功', 'success');
    })
    .catch(e => toast(e.message, 'error'));
}

function exportBudgetTransactions() {
  const params = new URLSearchParams();
  if (budgetFilter.month) params.set('month', budgetFilter.month);
  if (currentBudgetId) params.set('budgetId', currentBudgetId);
  const query = params.toString();
  const url = '/api/budget-transactions/export' + (query ? '?' + query : '');
  const userId = getUserId();
  fetch(url, { headers: { 'X-User-Id': userId } })
    .then(res => res.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `budget_transactions_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('流水导出成功', 'success');
    })
    .catch(e => toast(e.message, 'error'));
}

async function reconcileBudgets() {
  if (!confirm('确定要执行预算对账吗？这将重新计算所有预算的已用和冻结金额。')) return;
  try {
    const result = await API.post('/api/budgets/reconcile');
    toast(`对账完成：检查 ${result.checkedCount} 条，修复 ${result.fixedCount} 条`, 'success');
    refreshAll();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function resetData() {
  if (!confirm('确定要重置所有数据吗？此操作不可撤销。')) return;
  await fetch('/api/reset', { method: 'POST' });
  toast('数据已重置', 'success');
  setTimeout(() => location.reload(), 500);
}

init();

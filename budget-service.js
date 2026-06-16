const store = require('./store');

const {
  USERS, DEPARTMENTS, DEPARTMENT_LABEL, EXPENSE_CATEGORIES,
  BUDGET_TRANSACTION_TYPES, BUDGET_TRANSACTION_TYPE_LABEL,
  BUDGET_FREEZE_STATUS,
  loadData, saveData, genId, nowISO, getCurrentMonth, getMonthFromDate,
  normalizeBudget, normalizeBudgetFreeze, normalizeBudgetTransaction
} = store;

function assertRole(userId, allowedRoles) {
  const user = USERS.find(u => u.id === userId);
  if (!user) throw new Error('用户不存在');
  if (!allowedRoles.includes(user.role)) {
    throw new Error('无权限执行此操作');
  }
  return user;
}

function getUserInfo(userId) {
  const user = USERS.find(u => u.id === userId);
  return user ? { id: user.id, name: user.name, role: user.role, departmentId: user.departmentId } : null;
}

function getDepartmentName(deptId) {
  return DEPARTMENT_LABEL[deptId] || deptId;
}

function computeAvailable(budget) {
  return budget.totalAmount - budget.usedAmount - budget.frozenAmount;
}

function listBudgets(filter = {}) {
  const data = loadData();
  let list = [...data.budgets];
  if (filter.month) list = list.filter(b => b.month === filter.month);
  if (filter.departmentId) list = list.filter(b => b.departmentId === filter.departmentId);
  if (filter.category) list = list.filter(b => b.category === filter.category);
  list.sort((a, b) => {
    if (a.month !== b.month) return b.month.localeCompare(a.month);
    if (a.departmentId !== b.departmentId) return a.departmentId.localeCompare(b.departmentId);
    return a.category.localeCompare(b.category);
  });
  return list.map(b => decorateBudget(b));
}

function decorateBudget(b) {
  return {
    ...b,
    departmentName: b.departmentName || getDepartmentName(b.departmentId),
    availableAmount: computeAvailable(b),
    statusLabel: computeAvailable(b) < 0 ? '超支' : '正常'
  };
}

function getBudget(id) {
  const data = loadData();
  const b = data.budgets.find(x => x.id === id);
  if (!b) return null;
  return decorateBudget(b);
}

function getBudgetByKey(month, departmentId, category) {
  const data = loadData();
  const b = data.budgets.find(x =>
    x.month === month && x.departmentId === departmentId && x.category === category
  );
  if (!b) return null;
  return decorateBudget(b);
}

function findOrCreateBudgetRecord(data, month, departmentId, category, operatorId) {
  let b = data.budgets.find(x =>
    x.month === month && x.departmentId === departmentId && x.category === category
  );
  if (!b) {
    const deptName = getDepartmentName(departmentId);
    b = normalizeBudget({
      id: genId(data, 'BG'),
      month,
      departmentId,
      departmentName: deptName,
      category,
      totalAmount: 0,
      usedAmount: 0,
      frozenAmount: 0,
      version: 1,
      createdAt: nowISO(),
      updatedAt: nowISO()
    });
    data.budgets.push(b);
    addTransaction(data, {
      budgetId: b.id,
      type: BUDGET_TRANSACTION_TYPES.ALLOCATE,
      amount: 0,
      balanceAfter: 0,
      operatorId,
      operatorName: getUserInfo(operatorId)?.name || '系统',
      remark: `初始化预算：${month} ${deptName} ${category}`,
      operatedAt: nowISO()
    });
  }
  return b;
}

function checkBudgetVersion(budget, expectedVersion) {
  if (expectedVersion !== undefined && expectedVersion !== null) {
    if ((budget.version || 1) !== expectedVersion) {
      throw new Error('预算版本冲突：该预算已被他人修改，请刷新后重试');
    }
  }
}

function bumpBudgetVersion(budget) {
  budget.version = (budget.version || 1) + 1;
  budget.updatedAt = nowISO();
}

function addTransaction(data, tx) {
  const transaction = normalizeBudgetTransaction({
    id: genId(data, 'BGT'),
    ...tx
  });
  data.budgetTransactions.push(transaction);
  return transaction;
}

function createBudget(payload, operatorId) {
  assertRole(operatorId, ['admin', 'finance']);
  const data = loadData();
  const { month, departmentId, category, totalAmount } = payload;

  if (!month) throw new Error('请指定预算月份');
  if (!departmentId) throw new Error('请指定部门');
  if (!category) throw new Error('请指定费用科目');
  if (totalAmount === undefined || totalAmount === null) throw new Error('请指定预算额度');
  const amount = Number(totalAmount);
  if (isNaN(amount) || amount < 0) throw new Error('预算额度必须为非负数字');

  const existing = data.budgets.find(b =>
    b.month === month && b.departmentId === departmentId && b.category === category
  );
  if (existing) {
    throw new Error(`该预算配置已存在（${month} ${getDepartmentName(departmentId)} ${category}），请使用调整功能`);
  }

  const deptName = getDepartmentName(departmentId);
  const budget = normalizeBudget({
    id: genId(data, 'BG'),
    month,
    departmentId,
    departmentName: deptName,
    category,
    totalAmount: amount,
    usedAmount: 0,
    frozenAmount: 0,
    version: 1,
    createdAt: nowISO(),
    updatedAt: nowISO()
  });

  data.budgets.push(budget);

  addTransaction(data, {
    budgetId: budget.id,
    type: BUDGET_TRANSACTION_TYPES.ALLOCATE,
    amount: amount,
    balanceAfter: computeAvailable(budget),
    operatorId,
    operatorName: getUserInfo(operatorId)?.name || '系统',
    remark: `创建预算：${month} ${deptName} ${category}，额度 ${amount.toFixed(2)} 元`
  });

  saveData(data);
  return decorateBudget(budget);
}

function updateBudget(id, payload, operatorId, expectedVersion) {
  assertRole(operatorId, ['admin', 'finance']);
  const data = loadData();
  const b = data.budgets.find(x => x.id === id);
  if (!b) throw new Error('预算不存在');
  checkBudgetVersion(b, expectedVersion);

  const oldTotal = b.totalAmount;
  if (payload.totalAmount !== undefined) {
    const newTotal = Number(payload.totalAmount);
    if (isNaN(newTotal) || newTotal < 0) throw new Error('预算额度必须为非负数字');
    b.totalAmount = newTotal;
  }
  if (payload.month) b.month = payload.month;
  if (payload.departmentId) {
    b.departmentId = payload.departmentId;
    b.departmentName = getDepartmentName(payload.departmentId);
  }
  if (payload.category) b.category = payload.category;

  bumpBudgetVersion(b);

  if (payload.totalAmount !== undefined && oldTotal !== b.totalAmount) {
    addTransaction(data, {
      budgetId: b.id,
      type: BUDGET_TRANSACTION_TYPES.ADJUST,
      amount: b.totalAmount - oldTotal,
      balanceAfter: computeAvailable(b),
      operatorId,
      operatorName: getUserInfo(operatorId)?.name || '系统',
      remark: `调整预算总额：${oldTotal.toFixed(2)} → ${b.totalAmount.toFixed(2)} 元`
    });
  }

  saveData(data);
  return decorateBudget(b);
}

function adjustBudget(id, adjustmentAmount, remark, operatorId, expectedVersion) {
  assertRole(operatorId, ['admin', 'finance']);
  const data = loadData();
  const b = data.budgets.find(x => x.id === id);
  if (!b) throw new Error('预算不存在');
  checkBudgetVersion(b, expectedVersion);

  const adj = Number(adjustmentAmount);
  if (isNaN(adj) || adj === 0) throw new Error('请输入有效的调整金额');

  const oldTotal = b.totalAmount;
  b.totalAmount = Math.max(0, oldTotal + adj);
  bumpBudgetVersion(b);

  addTransaction(data, {
    budgetId: b.id,
    type: BUDGET_TRANSACTION_TYPES.ADJUST,
    amount: adj,
    balanceAfter: computeAvailable(b),
    operatorId,
    operatorName: getUserInfo(operatorId)?.name || '系统',
    remark: remark || `手工调整：${adj > 0 ? '+' : ''}${adj.toFixed(2)} 元（${oldTotal.toFixed(2)} → ${b.totalAmount.toFixed(2)}）`
  });

  saveData(data);
  return decorateBudget(b);
}

function deleteBudget(id, operatorId) {
  assertRole(operatorId, ['admin']);
  const data = loadData();
  const idx = data.budgets.findIndex(x => x.id === id);
  if (idx === -1) throw new Error('预算不存在');

  const b = data.budgets[idx];
  if (b.usedAmount > 0 || b.frozenAmount > 0) {
    throw new Error('该预算已有占用或冻结记录，无法删除');
  }

  data.budgets.splice(idx, 1);
  data.budgetTransactions = data.budgetTransactions.filter(t => t.budgetId !== id);

  saveData(data);
  return { ok: true };
}

function checkBudgetAvailable(month, departmentId, category, amount) {
  const data = loadData();
  let b = data.budgets.find(x =>
    x.month === month && x.departmentId === departmentId && x.category === category
  );
  if (!b) {
    return { available: false, availableAmount: 0, reason: '未配置预算' };
  }
  const available = computeAvailable(b);
  return {
    available: available >= amount,
    availableAmount: available,
    totalAmount: b.totalAmount,
    usedAmount: b.usedAmount,
    frozenAmount: b.frozenAmount,
    budgetId: b.id
  };
}

function _freezeBudgetInternal(data, reimbursementId, amount, month, departmentId, category, operatorId) {
  const opName = getUserInfo(operatorId)?.name || '系统';
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) throw new Error('冻结金额必须为正数');

  const existingFreeze = data.budgetFreezes.find(f =>
    f.reimbursementId === reimbursementId && f.status === BUDGET_FREEZE_STATUS.FROZEN
  );
  if (existingFreeze) {
    return { freeze: existingFreeze, isNew: false };
  }

  const deductedFreeze = data.budgetFreezes.find(f =>
    f.reimbursementId === reimbursementId && f.status === BUDGET_FREEZE_STATUS.DEDUCTED
  );
  if (deductedFreeze) {
    throw new Error('该报销单预算已扣减，无法重复冻结');
  }

  const b = data.budgets.find(x =>
    x.month === month && x.departmentId === departmentId && x.category === category
  );
  if (!b) {
    throw new Error(
      `预算配置缺失：${month} ${getDepartmentName(departmentId)} ${category} ` +
      `未配置预算，请先在预算管理中配置后再提交`
    );
  }

  const available = computeAvailable(b);
  if (available < amt) {
    throw new Error(
      `预算不足：${b.month} ${b.departmentName} ${b.category} ` +
      `可用 ${available.toFixed(2)} 元，需冻结 ${amt.toFixed(2)} 元，` +
      `超支 ${(amt - available).toFixed(2)} 元`
    );
  }

  b.frozenAmount += amt;
  bumpBudgetVersion(b);

  const freeze = normalizeBudgetFreeze({
    id: genId(data, 'BF'),
    reimbursementId,
    budgetId: b.id,
    month,
    departmentId,
    category,
    amount: amt,
    status: BUDGET_FREEZE_STATUS.FROZEN,
    frozenAt: nowISO(),
    updatedAt: nowISO(),
    version: 1
  });
  data.budgetFreezes.push(freeze);

  addTransaction(data, {
    budgetId: b.id,
    reimbursementId,
    type: BUDGET_TRANSACTION_TYPES.FREEZE,
    amount: amt,
    balanceAfter: computeAvailable(b),
    operatorId,
    operatorName: opName,
    remark: `冻结预算：报销单 ${reimbursementId}，金额 ${amt.toFixed(2)} 元`
  });

  return { freeze, isNew: true, budget: b };
}

function freezeBudget(reimbursementId, amount, month, departmentId, category, operatorId) {
  const data = loadData();
  const result = _freezeBudgetInternal(data, reimbursementId, amount, month, departmentId, category, operatorId);
  saveData(data);
  return decorateBudgetFreeze(result.freeze);
}

function _deductBudgetInternal(data, reimbursementId, operatorId) {
  const opName = getUserInfo(operatorId)?.name || '系统';

  const freeze = data.budgetFreezes.find(f =>
    f.reimbursementId === reimbursementId && f.status === BUDGET_FREEZE_STATUS.FROZEN
  );
  if (!freeze) {
    const deducted = data.budgetFreezes.find(f =>
      f.reimbursementId === reimbursementId && f.status === BUDGET_FREEZE_STATUS.DEDUCTED
    );
    if (deducted) {
      return { freeze: deducted, isNew: false };
    }
    return { freeze: null, isNew: false, skipped: true, reason: 'no_freeze' };
  }

  const b = data.budgets.find(x => x.id === freeze.budgetId);
  if (!b) throw new Error('关联预算不存在，数据异常');

  if (b.frozenAmount < freeze.amount) {
    throw new Error(`预算冻结金额不足：冻结 ${b.frozenAmount}，需扣减 ${freeze.amount}，数据可能异常`);
  }

  b.frozenAmount -= freeze.amount;
  b.usedAmount += freeze.amount;
  bumpBudgetVersion(b);

  freeze.status = BUDGET_FREEZE_STATUS.DEDUCTED;
  freeze.updatedAt = nowISO();
  freeze.version = (freeze.version || 1) + 1;

  addTransaction(data, {
    budgetId: b.id,
    reimbursementId,
    type: BUDGET_TRANSACTION_TYPES.DEDUCT,
    amount: freeze.amount,
    balanceAfter: computeAvailable(b),
    operatorId,
    operatorName: opName,
    remark: `扣减预算：报销单 ${reimbursementId}，金额 ${freeze.amount.toFixed(2)} 元`
  });

  return { freeze, isNew: true, budget: b };
}

function deductBudget(reimbursementId, operatorId) {
  const data = loadData();
  const result = _deductBudgetInternal(data, reimbursementId, operatorId);
  if (result.skipped) {
    throw new Error('该报销单无有效冻结记录，无法扣减');
  }
  saveData(data);
  return decorateBudgetFreeze(result.freeze);
}

function _releaseBudgetInternal(data, reimbursementId, reason, operatorId) {
  const opName = getUserInfo(operatorId)?.name || '系统';

  const freeze = data.budgetFreezes.find(f =>
    f.reimbursementId === reimbursementId && f.status === BUDGET_FREEZE_STATUS.FROZEN
  );
  if (!freeze) {
    const released = data.budgetFreezes.find(f =>
      f.reimbursementId === reimbursementId && f.status === BUDGET_FREEZE_STATUS.RELEASED
    );
    if (released) {
      return { freeze: released, isNew: false };
    }
    return { freeze: null, isNew: false, skipped: true, reason: 'no_freeze' };
  }

  const b = data.budgets.find(x => x.id === freeze.budgetId);
  if (!b) throw new Error('关联预算不存在，数据异常');

  if (b.frozenAmount < freeze.amount) {
    throw new Error(`预算冻结金额不足：冻结 ${b.frozenAmount}，需释放 ${freeze.amount}，数据可能异常`);
  }

  b.frozenAmount -= freeze.amount;
  bumpBudgetVersion(b);

  freeze.status = BUDGET_FREEZE_STATUS.RELEASED;
  freeze.updatedAt = nowISO();
  freeze.version = (freeze.version || 1) + 1;

  addTransaction(data, {
    budgetId: b.id,
    reimbursementId,
    type: BUDGET_TRANSACTION_TYPES.RELEASE,
    amount: -freeze.amount,
    balanceAfter: computeAvailable(b),
    operatorId,
    operatorName: opName,
    remark: `释放预算：报销单 ${reimbursementId}，${reason || '无原因'}，金额 ${freeze.amount.toFixed(2)} 元`
  });

  return { freeze, isNew: true, budget: b };
}

function releaseBudget(reimbursementId, reason, operatorId) {
  const data = loadData();
  const result = _releaseBudgetInternal(data, reimbursementId, reason, operatorId);
  saveData(data);
  return result.freeze ? decorateBudgetFreeze(result.freeze) : null;
}

function decorateBudgetFreeze(f) {
  return {
    ...f,
    departmentName: f.departmentName || getDepartmentName(f.departmentId)
  };
}

function getReimbursementBudgetStatus(reimbursementId) {
  const data = loadData();
  const freezes = data.budgetFreezes.filter(f => f.reimbursementId === reimbursementId);
  if (freezes.length === 0) {
    return {
      hasBudget: false,
      freezeStatus: 'none',
      frozenAmount: 0,
      deductedAmount: 0,
      releasedAmount: 0,
      budgetInfo: null
    };
  }

  const frozen = freezes.filter(f => f.status === BUDGET_FREEZE_STATUS.FROZEN);
  const deducted = freezes.filter(f => f.status === BUDGET_FREEZE_STATUS.DEDUCTED);
  const released = freezes.filter(f => f.status === BUDGET_FREEZE_STATUS.RELEASED);

  const latest = freezes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
  const budget = data.budgets.find(b => b.id === latest.budgetId);

  return {
    hasBudget: true,
    freezeStatus: latest.status,
    frozenAmount: frozen.reduce((s, f) => s + f.amount, 0),
    deductedAmount: deducted.reduce((s, f) => s + f.amount, 0),
    releasedAmount: released.reduce((s, f) => s + f.amount, 0),
    month: latest.month,
    departmentId: latest.departmentId,
    departmentName: getDepartmentName(latest.departmentId),
    category: latest.category,
    budgetInfo: budget ? decorateBudget(budget) : null,
    freezes: freezes.map(decorateBudgetFreeze)
  };
}

function listBudgetFreezes(filter = {}) {
  const data = loadData();
  let list = [...data.budgetFreezes];
  if (filter.reimbursementId) list = list.filter(f => f.reimbursementId === filter.reimbursementId);
  if (filter.budgetId) list = list.filter(f => f.budgetId === filter.budgetId);
  if (filter.status) list = list.filter(f => f.status === filter.status);
  if (filter.month) list = list.filter(f => f.month === filter.month);
  if (filter.departmentId) list = list.filter(f => f.departmentId === filter.departmentId);
  list.sort((a, b) => new Date(b.frozenAt) - new Date(a.frozenAt));
  return list.map(decorateBudgetFreeze);
}

function listBudgetTransactions(filter = {}) {
  const data = loadData();
  let list = [...data.budgetTransactions];
  if (filter.budgetId) list = list.filter(t => t.budgetId === filter.budgetId);
  if (filter.reimbursementId) list = list.filter(t => t.reimbursementId === filter.reimbursementId);
  if (filter.type) list = list.filter(t => t.type === filter.type);
  if (filter.month) {
    const budgetIds = data.budgets.filter(b => b.month === filter.month).map(b => b.id);
    list = list.filter(t => budgetIds.includes(t.budgetId));
  }
  list.sort((a, b) => new Date(b.operatedAt) - new Date(a.operatedAt));
  return list;
}

function getBudgetSummary(month, departmentId) {
  const data = loadData();
  const budgets = data.budgets.filter(b =>
    (!month || b.month === month) &&
    (!departmentId || b.departmentId === departmentId)
  );

  const total = budgets.reduce((s, b) => s + b.totalAmount, 0);
  const used = budgets.reduce((s, b) => s + b.usedAmount, 0);
  const frozen = budgets.reduce((s, b) => s + b.frozenAmount, 0);
  const available = total - used - frozen;

  return {
    month: month || '全部',
    departmentId: departmentId || '全部',
    departmentName: departmentId ? getDepartmentName(departmentId) : '全部部门',
    totalAmount: total,
    usedAmount: used,
    frozenAmount: frozen,
    availableAmount: available,
    budgetCount: budgets.length,
    usageRate: total > 0 ? (used / total * 100).toFixed(2) + '%' : '0%'
  };
}

function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx] : '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

function importBudgetsFromCSV(csvContent, operatorId) {
  assertRole(operatorId, ['admin', 'finance']);
  const { headers, rows } = parseCSV(csvContent);

  const requiredFields = ['month', 'departmentId', 'category', 'totalAmount'];
  const missing = requiredFields.filter(f => !headers.includes(f));
  if (missing.length > 0) {
    throw new Error(`CSV缺少必填字段：${missing.join('、')}。需要字段：${requiredFields.join('、')}`);
  }

  const data = loadData();
  const results = { success: [], failed: [], skipped: [] };
  const seenKeys = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNum = i + 2;
    try {
      const month = row.month?.trim();
      const departmentId = row.departmentId?.trim();
      const category = row.category?.trim();
      const totalAmount = parseFloat(row.totalAmount);

      if (!month || !departmentId || !category) {
        throw new Error('月份、部门、费用科目不能为空');
      }
      if (isNaN(totalAmount) || totalAmount < 0) {
        throw new Error('预算额度必须为非负数字');
      }

      const key = `${month}-${departmentId}-${category}`;
      if (seenKeys.has(key)) {
        results.skipped.push({ line: lineNum, key, reason: 'CSV内重复，已跳过' });
        continue;
      }
      seenKeys.add(key);

      const existing = data.budgets.find(b =>
        b.month === month && b.departmentId === departmentId && b.category === category
      );

      if (existing) {
        results.skipped.push({
          line: lineNum,
          key,
          reason: `预算已存在（当前额度 ${existing.totalAmount.toFixed(2)} 元），已跳过，如需修改请使用调整功能`
        });
        continue;
      }

      const deptName = getDepartmentName(departmentId);
      const budget = normalizeBudget({
        id: genId(data, 'BG'),
        month,
        departmentId,
        departmentName: deptName,
        category,
        totalAmount,
        usedAmount: 0,
        frozenAmount: 0,
        version: 1,
        createdAt: nowISO(),
        updatedAt: nowISO()
      });
      data.budgets.push(budget);

      addTransaction(data, {
        budgetId: budget.id,
        type: BUDGET_TRANSACTION_TYPES.IMPORT,
        amount: totalAmount,
        balanceAfter: computeAvailable(budget),
        operatorId,
        operatorName: getUserInfo(operatorId)?.name || '系统',
        remark: `CSV导入：${month} ${deptName} ${category}，额度 ${totalAmount.toFixed(2)} 元`
      });

      results.success.push({ line: lineNum, key, budgetId: budget.id, totalAmount });
    } catch (e) {
      results.failed.push({ line: lineNum, row, error: e.message });
    }
  }

  saveData(data);
  return results;
}

function exportBudgetsToCSV(filter = {}) {
  const budgets = listBudgets(filter);
  const headers = ['id', 'month', 'departmentId', 'departmentName', 'category',
    'totalAmount', 'usedAmount', 'frozenAmount', 'availableAmount', 'version'];

  const lines = [headers.join(',')];
  for (const b of budgets) {
    const row = headers.map(h => {
      let val = b[h];
      if (typeof val === 'number') {
        val = val.toFixed(2);
      }
      if (typeof val === 'string' && val.includes(',')) {
        val = `"${val}"`;
      }
      return val;
    });
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

function exportTransactionsToCSV(filter = {}) {
  const transactions = listBudgetTransactions(filter);
  const headers = ['id', 'budgetId', 'reimbursementId', 'type', 'typeLabel',
    'amount', 'balanceAfter', 'operatorId', 'operatorName', 'remark', 'operatedAt'];

  const lines = [headers.join(',')];
  for (const t of transactions) {
    const row = headers.map(h => {
      let val;
      if (h === 'typeLabel') {
        val = BUDGET_TRANSACTION_TYPE_LABEL[t.type] || t.type;
      } else {
        val = t[h];
      }
      if (typeof val === 'number') {
        val = val.toFixed(2);
      }
      if (typeof val === 'string' && val.includes(',')) {
        val = `"${val}"`;
      }
      return val !== undefined ? val : '';
    });
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

function reconcileBudgets() {
  const data = loadData();
  const issues = [];
  const fixes = [];

  for (const budget of data.budgets) {
    const freezes = data.budgetFreezes.filter(f => f.budgetId === budget.id);
    const frozenSum = freezes
      .filter(f => f.status === BUDGET_FREEZE_STATUS.FROZEN)
      .reduce((s, f) => s + f.amount, 0);

    const deductedSum = freezes
      .filter(f => f.status === BUDGET_FREEZE_STATUS.DEDUCTED)
      .reduce((s, f) => s + f.amount, 0);

    if (Math.abs(budget.frozenAmount - frozenSum) > 0.001) {
      issues.push({
        budgetId: budget.id,
        type: 'frozen_mismatch',
        expected: frozenSum,
        actual: budget.frozenAmount
      });
      budget.frozenAmount = frozenSum;
      fixes.push(`修正预算 ${budget.id} 冻结金额：${budget.frozenAmount} → ${frozenSum}`);
    }

    if (Math.abs(budget.usedAmount - deductedSum) > 0.001) {
      issues.push({
        budgetId: budget.id,
        type: 'used_mismatch',
        expected: deductedSum,
        actual: budget.usedAmount
      });
      budget.usedAmount = deductedSum;
      fixes.push(`修正预算 ${budget.id} 已用金额：${budget.usedAmount} → ${deductedSum}`);
    }

    bumpBudgetVersion(budget);
  }

  if (fixes.length > 0) {
    saveData(data);
  }

  return {
    issueCount: issues.length,
    fixCount: fixes.length,
    issues,
    fixes
  };
}

function resetAllBudgets() {
  const data = loadData();
  data.budgets = [];
  data.budgetFreezes = [];
  data.budgetTransactions = [];
  saveData(data);
  return { ok: true };
}

module.exports = {
  listBudgets,
  getBudget,
  getBudgetByKey,
  createBudget,
  updateBudget,
  adjustBudget,
  deleteBudget,
  checkBudgetAvailable,
  freezeBudget,
  deductBudget,
  releaseBudget,
  getReimbursementBudgetStatus,
  listBudgetFreezes,
  listBudgetTransactions,
  getBudgetSummary,
  importBudgetsFromCSV,
  exportBudgetsToCSV,
  exportTransactionsToCSV,
  reconcileBudgets,
  resetAllBudgets,
  computeAvailable,
  getDepartmentName,
  getUserInfo,
  _freezeBudgetInternal,
  _deductBudgetInternal,
  _releaseBudgetInternal
};

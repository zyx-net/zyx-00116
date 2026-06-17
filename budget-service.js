const store = require('./store');

const {
  USERS, DEPARTMENTS, DEPARTMENT_LABEL, EXPENSE_CATEGORIES,
  BUDGET_TRANSACTION_TYPES, BUDGET_TRANSACTION_TYPE_LABEL,
  BUDGET_FREEZE_STATUS, STATUS, STATUS_LABEL,
  loadData, saveData, genId, nowISO, getMonthFromDate, getCurrentMonth,
  normalizeBudget, normalizeBudgetFreeze, normalizeBudgetTransaction,
  normalizeImportBatch
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

function importBudgetsFromCSV(csvContent, operatorId, options = {}) {
  assertRole(operatorId, ['admin', 'finance']);
  const { headers, rows } = parseCSV(csvContent);

  const requiredFields = ['month', 'departmentId', 'category', 'totalAmount'];
  const missing = requiredFields.filter(f => !headers.includes(f));
  if (missing.length > 0) {
    throw new Error(`CSV缺少必填字段：${missing.join('、')}。需要字段：${requiredFields.join('、')}`);
  }

  const allowOverride = options.allowOverride === true;
  const fileName = options.fileName || 'import.csv';
  const remark = options.remark || '';

  const data = loadData();
  const results = { success: [], failed: [], skipped: [], rejected: [] };
  const seenKeys = new Set();
  let totalAmount = 0;
  let batchMonth = '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNum = i + 2;
    try {
      const month = row.month?.trim();
      const departmentId = row.departmentId?.trim();
      const category = row.category?.trim();
      const totalAmountVal = parseFloat(row.totalAmount);

      if (!month || !departmentId || !category) {
        throw new Error('月份、部门、费用科目不能为空');
      }
      if (isNaN(totalAmountVal) || totalAmountVal < 0) {
        throw new Error('预算额度必须为非负数字');
      }

      if (!batchMonth) batchMonth = month;

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
        if (allowOverride) {
          const oldTotal = existing.totalAmount;
          existing.totalAmount = totalAmountVal;
          bumpBudgetVersion(existing);
          addTransaction(data, {
            budgetId: existing.id,
            type: BUDGET_TRANSACTION_TYPES.ADJUST,
            amount: totalAmountVal - oldTotal,
            balanceAfter: computeAvailable(existing),
            operatorId,
            operatorName: getUserInfo(operatorId)?.name || '系统',
            remark: `导入覆盖：${month} ${getDepartmentName(departmentId)} ${category}，${oldTotal.toFixed(2)} → ${totalAmountVal.toFixed(2)} 元`
          });
          results.success.push({
            line: lineNum, key, budgetId: existing.id, totalAmount: totalAmountVal,
            overridden: true, oldTotal
          });
          totalAmount += totalAmountVal;
        } else {
          results.rejected.push({
            line: lineNum,
            key,
            reason: `预算已存在（当前额度 ${existing.totalAmount.toFixed(2)} 元），拒绝覆盖。如需覆盖请勾选"允许覆盖已有预算"`,
            existingAmount: existing.totalAmount
          });
        }
        continue;
      }

      const deptName = getDepartmentName(departmentId);
      const budget = normalizeBudget({
        id: genId(data, 'BG'),
        month,
        departmentId,
        departmentName: deptName,
        category,
        totalAmount: totalAmountVal,
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
        amount: totalAmountVal,
        balanceAfter: computeAvailable(budget),
        operatorId,
        operatorName: getUserInfo(operatorId)?.name || '系统',
        remark: `CSV导入：${month} ${deptName} ${category}，额度 ${totalAmountVal.toFixed(2)} 元`
      });

      results.success.push({ line: lineNum, key, budgetId: budget.id, totalAmount: totalAmountVal });
      totalAmount += totalAmountVal;
    } catch (e) {
      results.failed.push({ line: lineNum, row, error: e.message });
    }
  }

  const batchId = genId(data, 'BATCH');
  const now = nowISO();
  const batch = normalizeImportBatch({
    id: batchId,
    batchNo: `BATCH${new Date(now).getFullYear()}${String(new Date(now).getMonth() + 1).padStart(2, '0')}${String(new Date(now).getDate()).padStart(2, '0')}${String(data.importBatches.length + 1).padStart(3, '0')}`,
    fileName,
    totalRows: rows.length,
    successCount: results.success.length,
    skippedCount: results.skipped.length,
    rejectedCount: results.rejected.length,
    failedCount: results.failed.length,
    totalAmount,
    operatorId,
    operatorName: getUserInfo(operatorId)?.name || '系统',
    month: batchMonth,
    remark,
    importedAt: now,
    details: {
      success: results.success,
      skipped: results.skipped,
      rejected: results.rejected,
      failed: results.failed
    }
  });
  data.importBatches.push(batch);

  saveData(data);
  return { ...results, batch, batchId: batch.id, batchNo: batch.batchNo };
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
  data.importBatches = [];
  saveData(data);
  return { ok: true };
}

function checkBudgetConfig(month, options = {}) {
  const targetMonth = month || getCurrentMonth();
  const data = loadData();
  const departments = options.departments || DEPARTMENTS.map(d => d.id);
  const categories = options.categories || EXPENSE_CATEGORIES;

  const existingKeys = new Set(
    data.budgets
      .filter(b => b.month === targetMonth)
      .map(b => `${b.departmentId}-${b.category}`)
  );

  const missing = [];
  const existing = [];

  for (const deptId of departments) {
    for (const cat of categories) {
      const key = `${deptId}-${cat}`;
      const budget = data.budgets.find(
        b => b.month === targetMonth && b.departmentId === deptId && b.category === cat
      );
      if (budget) {
        existing.push({
          month: targetMonth,
          departmentId: deptId,
          departmentName: getDepartmentName(deptId),
          category: cat,
          totalAmount: budget.totalAmount,
          availableAmount: computeAvailable(budget),
          status: budget.totalAmount > 0 ? 'configured' : 'zero',
          budgetId: budget.id
        });
      } else {
        missing.push({
          month: targetMonth,
          departmentId: deptId,
          departmentName: getDepartmentName(deptId),
          category: cat,
          suggestion: `请在预算管理中为 ${targetMonth} 月 ${getDepartmentName(deptId)} 的【${cat}】配置预算额度`
        });
      }
    }
  }

  const totalCombinations = departments.length * categories.length;
  const coverageRate = totalCombinations > 0
    ? ((existing.length / totalCombinations) * 100).toFixed(1) + '%'
    : '0%';

  return {
    month: targetMonth,
    totalCombinations,
    configuredCount: existing.length,
    missingCount: missing.length,
    coverageRate,
    isComplete: missing.length === 0,
    missing,
    existing,
    zeroAmountBudgets: existing.filter(e => e.status === 'zero')
  };
}

function autoSetupBudgets(month, operatorId, options = {}) {
  assertRole(operatorId, ['admin', 'finance']);
  const targetMonth = month || getCurrentMonth();
  const defaultAmount = options.defaultAmount || 0;
  const onlyZero = options.onlyZero === true;
  const deptAmounts = options.deptAmounts || {};
  const categoryAmounts = options.categoryAmounts || {};

  const config = checkBudgetConfig(targetMonth);
  const data = loadData();
  const created = [];
  const updated = [];

  if (!onlyZero) {
    for (const item of config.missing) {
      let amount = defaultAmount;
      if (deptAmounts[item.departmentId]) amount = deptAmounts[item.departmentId];
      if (categoryAmounts[item.category]) amount = categoryAmounts[item.category];

      const deptName = getDepartmentName(item.departmentId);
      const budget = normalizeBudget({
        id: genId(data, 'BG'),
        month: targetMonth,
        departmentId: item.departmentId,
        departmentName: deptName,
        category: item.category,
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
        remark: `自动补齐预算：${targetMonth} ${deptName} ${item.category}，额度 ${amount.toFixed(2)} 元`
      });

      created.push({
        budgetId: budget.id,
        month: targetMonth,
        departmentId: item.departmentId,
        departmentName: deptName,
        category: item.category,
        totalAmount: amount
      });
    }
  }

  for (const item of config.zeroAmountBudgets) {
    let amount = defaultAmount;
    if (deptAmounts[item.departmentId]) amount = deptAmounts[item.departmentId];
    if (categoryAmounts[item.category]) amount = categoryAmounts[item.category];
    if (amount <= 0) continue;

    const budget = data.budgets.find(b => b.id === item.budgetId);
    if (budget) {
      const oldTotal = budget.totalAmount;
      budget.totalAmount = amount;
      bumpBudgetVersion(budget);

      addTransaction(data, {
        budgetId: budget.id,
        type: BUDGET_TRANSACTION_TYPES.ADJUST,
        amount: amount - oldTotal,
        balanceAfter: computeAvailable(budget),
        operatorId,
        operatorName: getUserInfo(operatorId)?.name || '系统',
        remark: `自动补齐零额度预算：${targetMonth} ${item.departmentName} ${item.category}，${oldTotal.toFixed(2)} → ${amount.toFixed(2)} 元`
      });

      updated.push({
        budgetId: budget.id,
        month: targetMonth,
        departmentId: item.departmentId,
        departmentName: item.departmentName,
        category: item.category,
        oldTotal,
        totalAmount: amount
      });
    }
  }

  saveData(data);
  return {
    month: targetMonth,
    createdCount: created.length,
    updatedCount: updated.length,
    created,
    updated
  };
}

function listImportBatches(filter = {}) {
  const data = loadData();
  let list = [...data.importBatches];
  if (filter.month) list = list.filter(b => b.month === filter.month);
  if (filter.operatorId) list = list.filter(b => b.operatorId === filter.operatorId);
  list.sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  const includeDetails = filter.includeDetails === true || filter.includeDetails === 'true';
  return list.map(b => {
    const base = {
      id: b.id,
      batchNo: b.batchNo,
      fileName: b.fileName,
      totalRows: b.totalRows,
      successCount: b.successCount,
      skippedCount: b.skippedCount,
      rejectedCount: b.rejectedCount,
      failedCount: b.failedCount,
      totalAmount: b.totalAmount,
      operatorId: b.operatorId,
      operatorName: b.operatorName,
      month: b.month,
      remark: b.remark,
      importedAt: b.importedAt
    };
    if (includeDetails) {
      base.details = normalizeBatchDetailsForView(b);
    }
    return base;
  });
}

function normalizeBatchDetailsForView(b) {
  const d = b.details || {};
  const decorate = (arr, type) => (arr || []).map(item => ({
    ...item,
    type,
    batchId: b.id,
    batchNo: b.batchNo,
    month: item.month || b.month,
    departmentName: item.departmentName ||
      (item.departmentId ? getDepartmentName(item.departmentId) : ''),
    departmentId: item.departmentId || ''
  }));
  return {
    success: decorate(d.success || [], 'success'),
    skipped: decorate(d.skipped || [], 'skipped'),
    rejected: decorate(d.rejected || [], 'rejected'),
    failed: decorate(d.failed || [], 'failed')
  };
}

function getImportBatch(id) {
  const data = loadData();
  const b = data.importBatches.find(x => x.id === id);
  if (!b) return null;
  return {
    ...b,
    details: normalizeBatchDetailsForView(b)
  };
}

function exportReconcile(filter = {}) {
  const data = loadData();
  const result = [];

  const budgets = filter.month
    ? data.budgets.filter(b => b.month === filter.month)
    : data.budgets;

  const relevantBatchIds = new Set();
  for (const budget of budgets) {
    const txList = data.budgetTransactions
      .filter(t => t.budgetId === budget.id)
      .sort((a, b) => new Date(a.operatedAt) - new Date(b.operatedAt));

    let runningTotal = 0;
    let runningUsed = 0;
    let runningFrozen = 0;

    for (const tx of txList) {
      const importBatch = data.importBatches.find(b => {
        if (!b.details || !b.details.success) return false;
        return b.details.success.some(s => s.budgetId === budget.id);
      });
      if (importBatch) relevantBatchIds.add(importBatch.id);

      switch (tx.type) {
        case BUDGET_TRANSACTION_TYPES.ALLOCATE:
        case BUDGET_TRANSACTION_TYPES.IMPORT:
          runningTotal += tx.amount;
          break;
        case BUDGET_TRANSACTION_TYPES.ADJUST:
          runningTotal += tx.amount;
          break;
        case BUDGET_TRANSACTION_TYPES.FREEZE:
          runningFrozen += tx.amount;
          break;
        case BUDGET_TRANSACTION_TYPES.DEDUCT:
          runningFrozen -= tx.amount;
          runningUsed += tx.amount;
          break;
        case BUDGET_TRANSACTION_TYPES.RELEASE:
          runningFrozen += tx.amount;
          break;
      }

      result.push({
        batchNo: importBatch ? importBatch.batchNo : '-',
        batchId: importBatch ? importBatch.id : '-',
        budgetId: budget.id,
        month: budget.month,
        departmentId: budget.departmentId,
        departmentName: getDepartmentName(budget.departmentId),
        category: budget.category,
        transactionId: tx.id,
        transactionType: tx.type,
        transactionTypeLabel: BUDGET_TRANSACTION_TYPE_LABEL[tx.type] || tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        runningTotal: Number(runningTotal.toFixed(2)),
        runningUsed: Number(runningUsed.toFixed(2)),
        runningFrozen: Number(runningFrozen.toFixed(2)),
        runningAvailable: Number((runningTotal - runningUsed - runningFrozen).toFixed(2)),
        reimbursementId: tx.reimbursementId || '-',
        operatorId: tx.operatorId,
        operatorName: tx.operatorName,
        remark: tx.remark,
        operatedAt: tx.operatedAt
      });
    }
  }

  return result;
}

function exportReconcileToCSV(filter = {}) {
  const records = exportReconcile(filter);
  const headers = [
    'batchNo', 'batchId', 'budgetId', 'month', 'departmentId', 'departmentName',
    'category', 'transactionId', 'transactionType', 'transactionTypeLabel',
    'amount', 'balanceAfter', 'runningTotal', 'runningUsed', 'runningFrozen',
    'runningAvailable', 'reimbursementId', 'operatorId', 'operatorName',
    'remark', 'operatedAt'
  ];

  const lines = [headers.join(',')];
  for (const r of records) {
    const row = headers.map(h => {
      let val = r[h];
      if (typeof val === 'number') {
        val = val.toFixed(2);
      }
      if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val !== undefined ? val : '';
    });
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

function exportReconcileToJSON(filter = {}) {
  const records = exportReconcile(filter);
  const summary = {};

  for (const r of records) {
    const key = `${r.month}-${r.departmentId}-${r.category}`;
    if (!summary[key]) {
      summary[key] = {
        month: r.month,
        departmentId: r.departmentId,
        departmentName: r.departmentName,
        category: r.category,
        finalTotal: 0,
        finalUsed: 0,
        finalFrozen: 0,
        finalAvailable: 0,
        transactionCount: 0,
        batches: new Set()
      };
    }
    summary[key].finalTotal = r.runningTotal;
    summary[key].finalUsed = r.runningUsed;
    summary[key].finalFrozen = r.runningFrozen;
    summary[key].finalAvailable = r.runningAvailable;
    summary[key].transactionCount++;
    if (r.batchNo !== '-') summary[key].batches.add(r.batchNo);
  }

  const summaryList = Object.values(summary).map(s => ({
    ...s,
    batches: Array.from(s.batches)
  }));

  return JSON.stringify({
    exportTime: nowISO(),
    filter,
    totalRecords: records.length,
    summaryCount: summaryList.length,
    summary: summaryList,
    details: records
  }, null, 2);
}

function validateReimbursementLogConsistency(reimbursementId) {
  const data = loadData();
  const r = data.reimbursements.find(x => x.id === reimbursementId);
  if (!r) return { valid: false, error: '报销单不存在' };

  const logs = data.operationLogs.filter(l => l.reimbursementId === reimbursementId);
  const budgetTx = data.budgetTransactions.filter(t => t.reimbursementId === reimbursementId);
  const issues = [];

  if (r.status === STATUS.WITHDRAWN) {
    const hasRelease = budgetTx.some(t => t.type === BUDGET_TRANSACTION_TYPES.RELEASE);
    if (!hasRelease) {
      issues.push('已撤销的报销单缺少预算释放流水');
    }
    const withdrawLog = logs.find(l => l.action === 'withdraw');
    if (!withdrawLog) {
      issues.push('已撤销的报销单缺少撤销操作日志');
    }
  }

  if (r.status === STATUS.APPROVED || r.status === STATUS.ARCHIVED) {
    const hasDeduct = budgetTx.some(t => t.type === BUDGET_TRANSACTION_TYPES.DEDUCT);
    if (!hasDeduct) {
      issues.push('已通过/归档的报销单缺少预算扣减流水');
    }
  }

  const expectedTxTypes = [];
  const statuses = logs.map(l => l.action);
  if (statuses.includes('create')) expectedTxTypes.push(BUDGET_TRANSACTION_TYPES.FREEZE);
  if (statuses.includes('withdraw')) expectedTxTypes.push(BUDGET_TRANSACTION_TYPES.RELEASE);
  if (statuses.includes('reject')) expectedTxTypes.push(BUDGET_TRANSACTION_TYPES.RELEASE);
  if (statuses.filter(s => s === 'approve').length >= 2) {
    expectedTxTypes.push(BUDGET_TRANSACTION_TYPES.DEDUCT);
  }

  const actualTxTypes = budgetTx.map(t => t.type);
  for (const expected of expectedTxTypes) {
    if (!actualTxTypes.includes(expected)) {
      issues.push(`缺少预期的流水类型：${BUDGET_TRANSACTION_TYPE_LABEL[expected] || expected}`);
    }
  }

  return {
    valid: issues.length === 0,
    reimbursementId,
    status: r.status,
    logCount: logs.length,
    transactionCount: budgetTx.length,
    issues
  };
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
  checkBudgetConfig,
  autoSetupBudgets,
  listImportBatches,
  getImportBatch,
  exportReconcile,
  exportReconcileToCSV,
  exportReconcileToJSON,
  validateReimbursementLogConsistency,
  computeAvailable,
  getDepartmentName,
  getUserInfo,
  _freezeBudgetInternal,
  _deductBudgetInternal,
  _releaseBudgetInternal
};

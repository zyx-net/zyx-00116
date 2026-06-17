const fs = require('fs');
const path = require('path');
const store = require('./store');
const service = require('./service');
const budgetService = require('./budget-service');

const {
  STATUS, STATUS_LABEL, USERS, DEPARTMENTS,
  loadData, saveData, nowISO, getCurrentMonth,
  BUDGET_TRANSACTION_TYPES, BUDGET_TRANSACTION_TYPE_LABEL,
  BUDGET_FREEZE_STATUS
} = store;

const RESULTS_DIR = path.join(__dirname, 'acceptance-results');
const REPORT_FILE = path.join(RESULTS_DIR, 'budget-acceptance-report.html');
const LOG_FILE = path.join(RESULTS_DIR, 'budget-acceptance.log');

const acceptanceState = {
  startTime: null,
  endTime: null,
  totalScenarios: 0,
  passedScenarios: 0,
  failedScenarios: 0,
  skippedScenarios: 0,
  scenarios: [],
  logs: [],
  currentScenario: null,
  currentStep: null
};

function log(level, message, detail = null) {
  const entry = {
    time: nowISO(),
    level,
    message,
    detail,
    scenario: acceptanceState.currentScenario,
    step: acceptanceState.currentStep
  };
  acceptanceState.logs.push(entry);
  const prefix = `[${entry.time.slice(11, 19)}] [${level.toUpperCase()}]`;
  const scenarioPrefix = acceptanceState.currentScenario ? `[${acceptanceState.currentScenario}]` : '';
  console.log(`${prefix} ${scenarioPrefix} ${message}`);
  if (detail) {
    console.log(`  ${JSON.stringify(detail)}`);
  }
}

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function saveLog() {
  ensureResultsDir();
  const logContent = acceptanceState.logs
    .map(e => `[${e.time}] [${e.level.toUpperCase()}] [${e.scenario || 'global'}] ${e.message}${e.detail ? ' | ' + JSON.stringify(e.detail) : ''}`)
    .join('\n');
  fs.writeFileSync(LOG_FILE, logContent, 'utf8');
}

function resetAll() {
  service.resetAll();
  budgetService.resetAllBudgets();
  log('info', '数据已完全重置');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}：期望 ${expected}，实际 ${actual}`);
  }
}

function assertApprox(actual, expected, msg, delta = 0.001) {
  if (Math.abs(actual - expected) > delta) {
    throw new Error(`${msg}：期望 ${expected}，实际 ${actual}，误差超过 ${delta}`);
  }
}

function assertContains(str, substr, msg) {
  if (!str.includes(substr)) {
    throw new Error(`${msg}：期望包含 "${substr}"，实际为 "${str}"`);
  }
}

function assertTrue(condition, msg) {
  if (!condition) {
    throw new Error(msg);
  }
}

function runStep(name, fn) {
  acceptanceState.currentStep = name;
  log('info', `执行步骤：${name}`);
  try {
    const result = fn();
    log('info', `步骤成功：${name}`, typeof result === 'string' ? result : null);
    return result;
  } catch (e) {
    log('error', `步骤失败：${name}`, e.message);
    throw e;
  } finally {
    acceptanceState.currentStep = null;
  }
}

function runScenario(id, name, description, fn) {
  acceptanceState.totalScenarios++;
  acceptanceState.currentScenario = name;
  const scenario = {
    id,
    name,
    description,
    status: 'running',
    startTime: nowISO(),
    endTime: null,
    steps: [],
    error: null,
    duration: 0
  };
  acceptanceState.scenarios.push(scenario);

  log('info', `═══════ 开始场景：${name} ═══════`);
  log('info', `描述：${description}`);

  try {
    const result = fn();
    scenario.status = 'passed';
    scenario.result = result;
    acceptanceState.passedScenarios++;
    log('info', `✅ 场景通过：${name}`);
  } catch (e) {
    scenario.status = 'failed';
    scenario.error = {
      message: e.message,
      stack: e.stack
    };
    acceptanceState.failedScenarios++;
    log('error', `❌ 场景失败：${name}`, e.message);
  } finally {
    scenario.endTime = nowISO();
    scenario.duration = new Date(scenario.endTime) - new Date(scenario.startTime);
    acceptanceState.currentScenario = null;
  }

  return scenario.status === 'passed';
}

function simulateRestart() {
  log('info', '模拟服务重启：重新加载数据模块');
  delete require.cache[require.resolve('./store.js')];
  delete require.cache[require.resolve('./service.js')];
  delete require.cache[require.resolve('./budget-service.js')];

  const newStore = require('./store.js');
  const newService = require('./service.js');
  const newBudgetService = require('./budget-service.js');

  return { store: newStore, service: newService, budgetService: newBudgetService };
}

function snapshotData(label) {
  const data = loadData();
  const snapshot = {
    label,
    time: nowISO(),
    budgetCount: data.budgets.length,
    freezeCount: data.budgetFreezes.length,
    txCount: data.budgetTransactions.length,
    reimbursementCount: data.reimbursements.length,
    budgets: data.budgets.map(b => ({
      id: b.id, month: b.month, departmentId: b.departmentId,
      category: b.category, totalAmount: b.totalAmount,
      usedAmount: b.usedAmount, frozenAmount: b.frozenAmount,
      version: b.version
    })),
    freezes: data.budgetFreezes.map(f => ({
      id: f.id, reimbursementId: f.reimbursementId,
      budgetId: f.budgetId, amount: f.amount, status: f.status
    })),
    transactions: data.budgetTransactions.map(t => ({
      id: t.id, budgetId: t.budgetId, type: t.type,
      amount: t.amount, balanceAfter: t.balanceAfter
    }))
  };
  log('debug', `数据快照：${label}`, {
    budgetCount: snapshot.budgetCount,
    freezeCount: snapshot.freezeCount,
    txCount: snapshot.txCount
  });
  return snapshot;
}

function compareSnapshots(snap1, snap2, fields = null) {
  const issues = [];

  if (snap1.budgetCount !== snap2.budgetCount) {
    issues.push(`预算数量不一致：${snap1.budgetCount} vs ${snap2.budgetCount}`);
  }
  if (snap1.freezeCount !== snap2.freezeCount) {
    issues.push(`冻结记录数量不一致：${snap1.freezeCount} vs ${snap2.freezeCount}`);
  }
  if (snap1.txCount !== snap2.txCount) {
    issues.push(`交易流水数量不一致：${snap1.txCount} vs ${snap2.txCount}`);
  }

  for (const b1 of snap1.budgets) {
    const b2 = snap2.budgets.find(x => x.id === b1.id);
    if (!b2) {
      issues.push(`预算 ${b1.id} 在重启后丢失`);
      continue;
    }
    const compareFields = fields || ['totalAmount', 'usedAmount', 'frozenAmount', 'version'];
    for (const f of compareFields) {
      if (Math.abs(b1[f] - b2[f]) > 0.001) {
        issues.push(`预算 ${b1.id} 的 ${f} 不一致：${b1[f]} vs ${b2[f]}`);
      }
    }
  }

  for (const f1 of snap1.freezes) {
    const f2 = snap2.freezes.find(x => x.id === f1.id);
    if (!f2) {
      issues.push(`冻结记录 ${f1.id} 在重启后丢失`);
      continue;
    }
    if (f1.status !== f2.status) {
      issues.push(`冻结记录 ${f1.id} 状态不一致：${f1.status} vs ${f2.status}`);
    }
    if (Math.abs(f1.amount - f2.amount) > 0.001) {
      issues.push(`冻结记录 ${f1.id} 金额不一致：${f1.amount} vs ${f2.amount}`);
    }
  }

  return issues;
}

function scenario_restartRecovery() {
  const currentMonth = getCurrentMonth();

  runStep('初始化测试数据', () => {
    resetAll();
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '差旅费',
      totalAmount: 10000
    }, 'u5');
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '办公费',
      totalAmount: 5000
    }, 'u5');

    const r = service.createReimbursement({
      title: '重启恢复测试报销单',
      amount: 2500,
      type: '差旅费',
      description: '用于测试重启后数据一致性'
    }, 'u1');

    service.auditApprove(r.id, 'u2');
    service.auditApprove(r.id, 'u3');

    return `创建报销单 ${r.id}，已审批通过，冻结金额 2500 元`;
  });

  const beforeSnapshot = runStep('保存重启前数据快照', () => {
    return snapshotData('重启前');
  });

  runStep('模拟服务重启', () => {
    const { store: s2, service: svc2, budgetService: bs2 } = simulateRestart();
    return '模块重新加载完成';
  });

  runStep('验证重启后数据一致性', () => {
    const afterSnapshot = snapshotData('重启后');
    const issues = compareSnapshots(beforeSnapshot, afterSnapshot);

    if (issues.length > 0) {
      throw new Error(`重启后数据不一致：\n${issues.join('\n')}`);
    }

    return `重启后数据完全一致：${afterSnapshot.budgetCount} 条预算，${afterSnapshot.freezeCount} 条冻结，${afterSnapshot.txCount} 条流水`;
  });

  runStep('验证重启后业务操作正常', () => {
    const list = budgetService.listBudgets({ month: currentMonth, departmentId: 'dept1' });
    assertEqual(list.length, 2, '研发部预算数量');

    const r = service.createReimbursement({
      title: '重启后新建报销单',
      amount: 1000,
      type: '办公费'
    }, 'u1');

    const budget = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(budget.frozenAmount, 1000, '办公费冻结金额');

    return `重启后操作正常：新建报销单 ${r.id}，冻结 1000 元`;
  });

  return '重启恢复验证通过';
}

function scenario_importConflict() {
  const currentMonth = getCurrentMonth();

  runStep('初始化：清理预算数据', () => {
    budgetService.resetAllBudgets();
    return '预算数据已清空';
  });

  runStep('首次导入：4条预算', () => {
    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,15000
${currentMonth},dept1,办公费,6000
${currentMonth},dept2,差旅费,10000
${currentMonth},dept2,招待费,3000`;

    const result = budgetService.importBudgetsFromCSV(csvContent, 'u5');
    assertEqual(result.success.length, 4, '成功导入数量');
    assertEqual(result.skipped.length, 0, '跳过数量');
    assertEqual(result.failed.length, 0, '失败数量');
    return `首次导入成功：${result.success.length} 条`;
  });

  runStep('重复导入：已存在的拒绝覆盖，新增的成功', () => {
    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,99999
${currentMonth},dept1,培训费,5000
${currentMonth},dept2,差旅费,88888
${currentMonth},dept3,交通费,2000`;

    const result = budgetService.importBudgetsFromCSV(csvContent, 'u5');
    assertEqual(result.success.length, 2, '成功导入数量（培训费+交通费）');
    assertEqual(result.rejected.length, 2, '拒绝覆盖数量（差旅费+差旅费）');

    const travelBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(travelBudget.totalAmount, 15000, '已存在的差旅费额度未被覆盖');

    const trainingBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '培训费');
    assertApprox(trainingBudget.totalAmount, 5000, '新增培训费成功');

    return `重复导入：成功 ${result.success.length}，拒绝覆盖 ${result.rejected.length}，已有数据不覆盖`;
  });

  runStep('CSV内部重复：只取第一条', () => {
    budgetService.resetAllBudgets();
    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept3,交通费,2000
${currentMonth},dept3,交通费,3000
${currentMonth},dept3,交通费,4000`;

    const result = budgetService.importBudgetsFromCSV(csvContent, 'u5');
    assertEqual(result.success.length, 1, '成功1条');
    assertEqual(result.skipped.length, 2, '跳过2条（CSV内重复）');

    const budget = budgetService.getBudgetByKey(currentMonth, 'dept3', '交通费');
    assertApprox(budget.totalAmount, 2000, '取第一条的额度 2000');

    return `CSV内重复去重：成功 ${result.success.length}，跳过 ${result.skipped.length}`;
  });

  runStep('导入结果分类清晰：成功/跳过/拒绝覆盖/失败', () => {
    budgetService.resetAllBudgets();
    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,10000
${currentMonth},dept1,办公费,5000
${currentMonth},dept1,差旅费,8000
invalid_row
${currentMonth},dept1,招待费,abc`;

    const result = budgetService.importBudgetsFromCSV(csvContent, 'u5');

    assertTrue(result.success.length >= 1, '至少有1条成功');
    assertTrue(result.skipped.length >= 1, '至少有1条跳过（CSV内重复）');
    assertTrue(result.rejected.length >= 0, '拒绝覆盖数量');
    assertTrue(result.failed.length >= 1, '至少有1条失败');

    for (const s of result.success) {
      assertTrue(s.budgetId !== undefined, '成功记录包含budgetId');
      assertTrue(s.totalAmount !== undefined, '成功记录包含totalAmount');
    }
    for (const s of result.skipped) {
      assertTrue(s.reason !== undefined, '跳过记录包含reason');
      assertTrue(s.line !== undefined, '跳过记录包含line号');
    }
    for (const f of result.failed) {
      assertTrue(f.error !== undefined, '失败记录包含error');
      assertTrue(f.line !== undefined, '失败记录包含line号');
    }

    return `导入结果四分法：成功 ${result.success.length}，跳过 ${result.skipped.length}，拒绝覆盖 ${result.rejected.length}，失败 ${result.failed.length}`;
  });

  return '导入冲突与分类验证通过';
}

function scenario_permissionInterception() {
  const currentMonth = getCurrentMonth();

  runStep('初始化测试数据', () => {
    resetAll();
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '差旅费',
      totalAmount: 10000
    }, 'u5');
    return '初始化完成';
  });

  runStep('申请人不能创建预算', () => {
    try {
      budgetService.createBudget({
        month: currentMonth,
        departmentId: 'dept1',
        category: '招待费',
        totalAmount: 3000
      }, 'u1');
      throw new Error('应该抛出权限错误');
    } catch (e) {
      assertContains(e.message, '无权限', '错误信息包含无权限');
      return '申请人创建预算被正确拦截';
    }
  });

  runStep('申请人不能调整预算', () => {
    const list = budgetService.listBudgets({ departmentId: 'dept1', category: '差旅费' });
    try {
      budgetService.adjustBudget(list[0].id, 100, '测试', 'u1');
      throw new Error('应该抛出权限错误');
    } catch (e) {
      assertContains(e.message, '无权限', '错误信息包含无权限');
      return '申请人调整预算被正确拦截';
    }
  });

  runStep('申请人不能导入预算', () => {
    try {
      budgetService.importBudgetsFromCSV(
        `${currentMonth},dept1,培训费,2000`,
        'u1'
      );
      throw new Error('应该抛出权限错误');
    } catch (e) {
      assertContains(e.message, '无权限', '错误信息包含无权限');
      return '申请人导入预算被正确拦截';
    }
  });

  runStep('审核员不能创建预算', () => {
    try {
      budgetService.createBudget({
        month: currentMonth,
        departmentId: 'dept1',
        category: '培训费',
        totalAmount: 2000
      }, 'u2');
      throw new Error('应该抛出权限错误');
    } catch (e) {
      assertContains(e.message, '无权限', '错误信息包含无权限');
      return '审核员创建预算被正确拦截';
    }
  });

  runStep('财务可以创建/调整预算', () => {
    const b = budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept2',
      category: '差旅费',
      totalAmount: 8000
    }, 'u3');
    assertEqual(b.departmentId, 'dept2', '部门正确');

    const adjusted = budgetService.adjustBudget(b.id, 1000, '财务追加', 'u3', b.version);
    assertApprox(adjusted.totalAmount, 9000, '调整后额度');

    return '财务创建和调整预算正常';
  });

  runStep('财务不能删除预算（仅管理员）', () => {
    const list = budgetService.listBudgets({ departmentId: 'dept2', category: '差旅费' });
    try {
      budgetService.deleteBudget(list[0].id, 'u3');
      throw new Error('应该抛出权限错误');
    } catch (e) {
      assertContains(e.message, '无权限', '错误信息包含无权限');
      return '财务删除预算被正确拦截';
    }
  });

  runStep('管理员可以删除预算', () => {
    const list = budgetService.listBudgets({ departmentId: 'dept2', category: '差旅费' });
    const before = list.length;
    budgetService.deleteBudget(list[0].id, 'u5');
    const after = budgetService.listBudgets({ departmentId: 'dept2', category: '差旅费' }).length;
    assertEqual(after, before - 1, '删除后数量减少');
    return '管理员删除预算成功';
  });

  return '权限拦截验证通过';
}

function scenario_withdrawRefund() {
  const currentMonth = getCurrentMonth();

  runStep('初始化测试数据', () => {
    resetAll();
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '差旅费',
      totalAmount: 10000
    }, 'u5');
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '办公费',
      totalAmount: 5000
    }, 'u5');
    return '初始化完成';
  });

  let testId;
  let initialAvailable;

  runStep('创建报销单 → 冻结预算', () => {
    const r = service.createReimbursement({
      title: '撤销回补测试单',
      amount: 2000,
      type: '差旅费',
      description: '测试撤销后预算回补'
    }, 'u1');
    testId = r.id;

    const budget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    initialAvailable = budget.availableAmount;
    assertApprox(budget.frozenAmount, 2000, '差旅费冻结2000');
    assertApprox(budget.availableAmount, 10000 - 2000, '可用减少2000');

    return `创建报销单 ${r.id}，冻结 2000 元`;
  });

  runStep('申请人撤销 → 预算释放回补', () => {
    const beforeBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    const beforeFrozen = beforeBudget.frozenAmount;
    const beforeAvailable = beforeBudget.availableAmount;

    const result = service.withdrawReimbursement(testId, 'u1', '信息有误，撤销修改');
    assertEqual(result.status, STATUS.WITHDRAWN, '状态为已撤销');

    const afterBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(afterBudget.frozenAmount, beforeFrozen - 2000, '冻结减少2000');
    assertApprox(afterBudget.availableAmount, beforeAvailable + 2000, '可用增加2000');
    assertApprox(afterBudget.availableAmount, 10000, '可用额度恢复到原始值');

    const freeze = store.loadData().budgetFreezes.find(f => f.reimbursementId === testId);
    assertEqual(freeze.status, BUDGET_FREEZE_STATUS.RELEASED, '冻结记录状态为已释放');

    return `撤销成功：冻结从 ${beforeFrozen} → ${afterBudget.frozenAmount}，可用从 ${beforeAvailable} → ${afterBudget.availableAmount}`;
  });

  runStep('撤销后重提 → 预算重新冻结', () => {
    const beforeBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    const beforeFrozen = beforeBudget.frozenAmount;

    const result = service.resubmitReimbursement(testId, 'u1');
    assertEqual(result.status, STATUS.PENDING_AUDIT, '重提后状态为待审核');

    const afterBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(afterBudget.frozenAmount, beforeFrozen + 2000, '冻结增加2000');
    assertApprox(afterBudget.availableAmount, beforeBudget.availableAmount - 2000, '可用减少2000');

    return `重提成功：冻结从 ${beforeFrozen} → ${afterBudget.frozenAmount}`;
  });

  runStep('撤销 → 重提 → 再撤销 → 再重提，额度计算正确', () => {
    for (let i = 1; i <= 3; i++) {
      service.withdrawReimbursement(testId, 'u1', `第${i}次撤销`);
      const afterWithdraw = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
      assertApprox(afterWithdraw.frozenAmount, 0, `第${i}次撤销后冻结为0`);
      assertApprox(afterWithdraw.availableAmount, 10000, `第${i}次撤销后可用恢复`);

      service.resubmitReimbursement(testId, 'u1');
      const afterResubmit = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
      assertApprox(afterResubmit.frozenAmount, 2000, `第${i}次重提后冻结2000`);
      assertApprox(afterResubmit.availableAmount, 8000, `第${i}次重提后可用8000`);
    }
    return '多次撤销重提循环，额度计算准确';
  });

  runStep('驳回归还预算（另一路径）', () => {
    const r = service.createReimbursement({
      title: '驳回归还测试',
      amount: 1500,
      type: '办公费'
    }, 'u1');

    const beforeReject = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(beforeReject.frozenAmount, 1500, '驳回前冻结1500');

    const result = service.auditReject(r.id, 'u2', '材料不全');
    assertEqual(result.status, STATUS.REJECTED, '状态为已驳回');

    const afterReject = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(afterReject.frozenAmount, 0, '驳回后冻结为0');
    assertApprox(afterReject.availableAmount, 5000, '可用额度恢复');

    return '驳回归还预算验证通过';
  });

  return '撤销后额度回补验证通过';
}

function scenario_missingConfigFallback() {
  const currentMonth = getCurrentMonth();

  runStep('初始化：只配置部分预算', () => {
    budgetService.resetAllBudgets();
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '差旅费',
      totalAmount: 10000
    }, 'u5');
    return '只配置了研发部差旅费';
  });

  runStep('未配置的科目提交 → 明确的配置缺失提示', () => {
    try {
      service.createReimbursement({
        title: '未配置科目测试',
        amount: 1000,
        type: '招待费'
      }, 'u1');
      throw new Error('应该抛出配置缺失错误');
    } catch (e) {
      assertContains(e.message, '预算配置缺失', '错误信息包含"预算配置缺失"');
      assertContains(e.message, '招待费', '错误信息包含缺失的科目');
      assertContains(e.message, '请先在预算管理中配置', '错误信息包含操作指引');
      return '配置缺失提示清晰，包含具体科目和操作指引';
    }
  });

  runStep('未配置的部门提交 → 明确的配置缺失提示', () => {
    try {
      service.createReimbursement({
        title: '未配置部门测试',
        amount: 1000,
        type: '差旅费'
      }, 'u3');
      throw new Error('应该抛出配置缺失错误');
    } catch (e) {
      assertContains(e.message, '预算配置缺失', '错误信息包含"预算配置缺失"');
      return '部门维度的配置缺失也能正确提示';
    }
  });

  runStep('预算不足时 → 明确的数字对比提示', () => {
    const budget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    const available = budget.availableAmount;
    const overAmount = available + 500;

    let errorMsg = '';
    try {
      service.createReimbursement({
        title: '超预算测试',
        amount: overAmount,
        type: '差旅费'
      }, 'u1');
    } catch (e) {
      errorMsg = e.message;
    }

    assertContains(errorMsg, '预算不足', '包含"预算不足"字样');
    assertContains(errorMsg, available.toFixed(2), '包含可用额度数字');
    assertContains(errorMsg, overAmount.toFixed(2), '包含申请额度数字');
    assertContains(errorMsg, '超支', '包含"超支"字样');
    assertContains(errorMsg, (overAmount - available).toFixed(2), '包含超支金额');

    return '预算不足提示包含完整数字对比';
  });

  runStep('配置缺失时状态回退：不产生任何占用记录', () => {
    const beforeSnapshot = snapshotData('提交前');

    try {
      service.createReimbursement({
        title: '配置缺失回退测试',
        amount: 500,
        type: '培训费'
      }, 'u1');
    } catch (e) {
    }

    const afterSnapshot = snapshotData('提交失败后');
    const issues = compareSnapshots(beforeSnapshot, afterSnapshot);

    if (issues.length > 0) {
      throw new Error(`配置缺失回退不彻底：\n${issues.join('\n')}`);
    }

    return '配置缺失时完全回退，不产生脏数据';
  });

  return '配置缺失回退验证通过';
}

function scenario_repeatImportConsistency() {
  const currentMonth = getCurrentMonth();

  runStep('初始化：导入基础预算', () => {
    budgetService.resetAllBudgets();
    const csv = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,10000
${currentMonth},dept1,办公费,5000
${currentMonth},dept2,差旅费,8000`;
    const result = budgetService.importBudgetsFromCSV(csv, 'u5');
    assertEqual(result.success.length, 3, '首次导入3条');
    return '基础数据导入完成';
  });

  runStep('同批数据重复导入3次，结果完全一致', () => {
    const csv = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,20000
${currentMonth},dept1,培训费,3000
${currentMonth},dept3,交通费,2000`;

    let lastResult = null;
    for (let i = 1; i <= 3; i++) {
      const result = budgetService.importBudgetsFromCSV(csv, 'u5');
      if (i === 1) {
        lastResult = result;
        assertEqual(result.success.length, 2, '第1次：新增2条（培训费+交通费）');
        assertEqual(result.rejected.length, 1, '第1次：拒绝覆盖1条（差旅费已存在）');
      } else {
        assertEqual(result.success.length, 0, `第${i}次：新增0条`);
        assertEqual(result.rejected.length, 3, `第${i}次：拒绝覆盖3条（全部已存在）`);
      }
    }

    const travelBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(travelBudget.totalAmount, 10000, '差旅费额度保持原值，未被覆盖');

    const trainingBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '培训费');
    assertApprox(trainingBudget.totalAmount, 3000, '培训费额度保持首次导入值');

    return '重复导入3次结果一致，数据稳定';
  });

  runStep('重复导入后额度、冻结、流水一致性校验', () => {
    const beforeSnapshot = snapshotData('重复导入前');

    const csv = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,99999
${currentMonth},dept1,办公费,99999`;
    budgetService.importBudgetsFromCSV(csv, 'u5');
    budgetService.importBudgetsFromCSV(csv, 'u5');
    budgetService.importBudgetsFromCSV(csv, 'u5');

    const afterSnapshot = snapshotData('重复导入后');

    for (const b1 of beforeSnapshot.budgets) {
      const b2 = afterSnapshot.budgets.find(x => x.id === b1.id);
      if (!b2) continue;
      assertApprox(b1.totalAmount, b2.totalAmount, `预算 ${b1.id} 总额未变`);
      assertApprox(b1.usedAmount, b2.usedAmount, `预算 ${b1.id} 已用未变`);
      assertApprox(b1.frozenAmount, b2.frozenAmount, `预算 ${b1.id} 冻结未变`);
    }

    assertEqual(beforeSnapshot.freezeCount, afterSnapshot.freezeCount, '冻结记录数不变');
    assertEqual(beforeSnapshot.txCount, afterSnapshot.txCount, '交易流水数不变（跳过不新增流水）');

    return '重复导入不改变现有额度、冻结记录和操作日志';
  });

  runStep('导入导出对账：导出再导入，数据一致', () => {
    const beforeList = budgetService.listBudgets({ month: currentMonth });
    const csv = budgetService.exportBudgetsToCSV({ month: currentMonth });

    budgetService.resetAllBudgets();
    const importResult = budgetService.importBudgetsFromCSV(csv, 'u5');

    const afterList = budgetService.listBudgets({ month: currentMonth });
    assertEqual(afterList.length, beforeList.length, '导出再导入后数量一致');

    for (const b1 of beforeList) {
      const b2 = afterList.find(x =>
        x.month === b1.month &&
        x.departmentId === b1.departmentId &&
        x.category === b1.category
      );
      assertTrue(b2 !== undefined, `找到对应的预算：${b1.month}-${b1.departmentId}-${b1.category}`);
      assertApprox(b1.totalAmount, b2.totalAmount, '总额一致');
    }

    return `导出导入对账通过：${beforeList.length} 条预算数据一致`;
  });

  return '重复导入一致性验证通过';
}

function scenario_crossRestartConsistency() {
  const currentMonth = getCurrentMonth();

  runStep('初始化复杂场景数据', () => {
    resetAll();

    budgetService.createBudget({ month: currentMonth, departmentId: 'dept1', category: '差旅费', totalAmount: 15000 }, 'u5');
    budgetService.createBudget({ month: currentMonth, departmentId: 'dept1', category: '办公费', totalAmount: 6000 }, 'u5');
    budgetService.createBudget({ month: currentMonth, departmentId: 'dept2', category: '差旅费', totalAmount: 10000 }, 'u5');

    const r1 = service.createReimbursement({ title: '已通过报销单', amount: 3000, type: '差旅费' }, 'u1');
    service.auditApprove(r1.id, 'u2');
    service.auditApprove(r1.id, 'u3');

    const r2 = service.createReimbursement({ title: '待审核报销单', amount: 2000, type: '办公费' }, 'u1');

    const r3 = service.createReimbursement({ title: '已撤销报销单', amount: 1500, type: '差旅费' }, 'u1');
    service.withdrawReimbursement(r3.id, 'u1', '测试撤销');

    const r4 = service.createReimbursement({ title: '已驳回报销单', amount: 1000, type: '差旅费' }, 'u1');
    service.auditReject(r4.id, 'u2', '测试驳回');

    return '创建了4张不同状态的报销单，覆盖冻结、扣减、释放等场景';
  });

  const beforeSnapshot = runStep('保存重启前完整快照', () => {
    return snapshotData('重启前完整状态');
  });

  runStep('模拟重启（清除模块缓存重新加载）', () => {
    simulateRestart();
    return '服务重启模拟完成';
  });

  runStep('验证重启后所有数据完全一致', () => {
    const afterSnapshot = snapshotData('重启后完整状态');
    const issues = compareSnapshots(beforeSnapshot, afterSnapshot);

    if (issues.length > 0) {
      throw new Error(`跨重启数据不一致：\n${issues.map(i => '  - ' + i).join('\n')}`);
    }

    return `数据完全一致：${afterSnapshot.budgetCount} 条预算，${afterSnapshot.freezeCount} 条冻结，${afterSnapshot.txCount} 条流水`;
  });

  runStep('验证重启后各项计算正确', () => {
    const data = loadData();

    for (const budget of data.budgets) {
      const freezes = data.budgetFreezes.filter(f => f.budgetId === budget.id);
      const frozenSum = freezes
        .filter(f => f.status === BUDGET_FREEZE_STATUS.FROZEN)
        .reduce((s, f) => s + f.amount, 0);
      const deductedSum = freezes
        .filter(f => f.status === BUDGET_FREEZE_STATUS.DEDUCTED)
        .reduce((s, f) => s + f.amount, 0);

      assertApprox(budget.frozenAmount, frozenSum, `预算 ${budget.id} 冻结金额与冻结记录一致`);
      assertApprox(budget.usedAmount, deductedSum, `预算 ${budget.id} 已用金额与扣减记录一致`);

      const available = budget.totalAmount - budget.usedAmount - budget.frozenAmount;
      const txList = data.budgetTransactions.filter(t => t.budgetId === budget.id);
      const lastTx = txList.sort((a, b) => new Date(b.operatedAt) - new Date(a.operatedAt))[0];
      if (lastTx) {
        assertApprox(lastTx.balanceAfter, available, `最后一笔流水余额与实际可用一致`);
      }
    }

    return '重启后各项计算逻辑正确';
  });

  runStep('验证重启后操作正常（可继续审批）', () => {
    const pendingList = service.listReimbursements({ status: STATUS.PENDING_AUDIT });
    assertTrue(pendingList.length > 0, '有待审核的报销单');

    const r = pendingList[0];
    const result = service.auditApprove(r.id, 'u2');
    assertEqual(result.status, STATUS.PENDING_REVIEW, '可以正常审批');

    return '重启后业务操作正常，可继续流转';
  });

  return '跨重启状态一致性验证通过';
}

function scenario_withdrawResubmitReplay() {
  const currentMonth = getCurrentMonth();

  runStep('初始化预算数据', () => {
    resetAll();
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '差旅费',
      totalAmount: 10000
    }, 'u5');
    return '初始化完成';
  });

  let testId;
  const snapshots = [];

  runStep('完整回放：创建 → 撤销 → 重提 → 审批 → 归档', () => {
    const r = service.createReimbursement({
      title: '完整链路回放测试',
      amount: 2500,
      type: '差旅费'
    }, 'u1');
    testId = r.id;
    snapshots.push({ stage: '已创建', data: snapshotData('创建后') });

    service.withdrawReimbursement(testId, 'u1', '第一次撤销');
    snapshots.push({ stage: '已撤销', data: snapshotData('撤销后') });

    service.resubmitReimbursement(testId, 'u1');
    snapshots.push({ stage: '已重提', data: snapshotData('重提后') });

    service.auditApprove(testId, 'u2');
    service.auditApprove(testId, 'u3');
    snapshots.push({ stage: '已通过', data: snapshotData('通过后') });

    service.archive(testId, 'u4');
    snapshots.push({ stage: '已归档', data: snapshotData('归档后') });

    return '完整链路执行完成';
  });

  runStep('验证各阶段额度变化正确', () => {
    const stages = {};
    for (const s of snapshots) {
      const budget = s.data.budgets.find(b => b.category === '差旅费' && b.departmentId === 'dept1');
      stages[s.stage] = budget;
    }

    assertApprox(stages['已创建'].frozenAmount, 2500, '创建后冻结2500');
    assertApprox(stages['已撤销'].frozenAmount, 0, '撤销后冻结为0');
    assertApprox(stages['已重提'].frozenAmount, 2500, '重提后冻结2500');
    assertApprox(stages['已通过'].frozenAmount, 0, '通过后冻结为0（转已用）');
    assertApprox(stages['已通过'].usedAmount, 2500, '通过后已用2500');
    assertApprox(stages['已归档'].usedAmount, 2500, '归档后已用保持2500');

    return '各阶段额度变化轨迹正确';
  });

  runStep('验证流水记录完整（每一步都有对应流水）', () => {
    const transactions = store.loadData().budgetTransactions
      .filter(t => t.reimbursementId === testId)
      .sort((a, b) => new Date(a.operatedAt) - new Date(b.operatedAt));

    const types = transactions.map(t => t.type);
    const expectedTypes = [
      BUDGET_TRANSACTION_TYPES.FREEZE,
      BUDGET_TRANSACTION_TYPES.RELEASE,
      BUDGET_TRANSACTION_TYPES.FREEZE,
      BUDGET_TRANSACTION_TYPES.DEDUCT
    ];

    assertEqual(types.length, expectedTypes.length, '流水数量正确');
    for (let i = 0; i < expectedTypes.length; i++) {
      assertEqual(types[i], expectedTypes[i], `第${i + 1}条流水类型正确`);
    }

    return `操作流水完整：${types.length} 条，类型依次为 ${types.join(' → ')}`;
  });

  runStep('验证冻结记录状态流转正确', () => {
    const freezes = store.loadData().budgetFreezes
      .filter(f => f.reimbursementId === testId)
      .sort((a, b) => new Date(a.frozenAt) - new Date(b.frozenAt));

    assertEqual(freezes.length, 2, '有2条冻结记录（第一次释放，第二次扣减）');
    assertEqual(freezes[0].status, BUDGET_FREEZE_STATUS.RELEASED, '第一条冻结已释放');
    assertEqual(freezes[1].status, BUDGET_FREEZE_STATUS.DEDUCTED, '第二条冻结已扣减');

    return '冻结记录状态流转正确';
  });

  runStep('验证报销单操作日志与预算流水一致性', () => {
    const result = budgetService.validateReimbursementLogConsistency(testId);
    assertTrue(result.valid, `日志与流水一致性验证通过，问题：${result.issues.join('; ')}`);
    assertEqual(result.logCount > 0, true, '有操作日志');
    assertEqual(result.transactionCount > 0, true, '有预算流水');
    return '操作日志与预算流水一致性验证通过';
  });

  return '撤销再提交回放验证通过';
}

function scenario_configCheckAndAutoSetup() {
  const currentMonth = getCurrentMonth();

  runStep('初始化：清空所有预算', () => {
    budgetService.resetAllBudgets();
    return '预算已清空';
  });

  let configBefore;
  runStep('执行配置检查：应报告缺失项', () => {
    configBefore = budgetService.checkBudgetConfig(currentMonth);
    assertTrue(configBefore.missingCount > 0, `报告了缺失项（共缺失 ${configBefore.missingCount} 项）`);
    assertEqual(configBefore.isComplete, false, '配置未完成状态正确');
    assertTrue(configBefore.coverageRate !== undefined, '覆盖率字段存在');

    const firstMissing = configBefore.missing[0];
    assertTrue(firstMissing.suggestion !== undefined, '每项缺失都有操作建议');
    assertTrue(firstMissing.suggestion.includes('配置预算额度'), '建议包含操作指引');

    return `检测到 ${configBefore.missingCount} 项缺失，覆盖率 ${configBefore.coverageRate}`;
  });

  runStep('自动补齐：以默认额度 0 补齐所有缺失项', () => {
    const result = budgetService.autoSetupBudgets(currentMonth, 'u5', { defaultAmount: 0 });
    assertEqual(result.createdCount, configBefore.missingCount, `补齐数量与缺失数一致（${result.createdCount}）`);
    assertEqual(result.created.length, configBefore.missingCount, 'created数组长度正确');
    return `自动创建 ${result.createdCount} 条零额度预算`;
  });

  runStep('再次检查：应标记零额度项', () => {
    const configAfter = budgetService.checkBudgetConfig(currentMonth);
    assertEqual(configAfter.isComplete, true, '无缺失项，标记为完成');
    assertTrue(configAfter.zeroAmountBudgets.length > 0, `检测到 ${configAfter.zeroAmountBudgets.length} 个零额度预算`);
    return `配置完整，其中 ${configAfter.zeroAmountBudgets.length} 项为零额度`;
  });

  runStep('再次补齐（只补零额度）：给零额度项赋予有意义的值', () => {
    const deptAmounts = { dept1: 15000, dept2: 12000, dept3: 8000, dept4: 5000 };
    const result = budgetService.autoSetupBudgets(currentMonth, 'u5', {
      defaultAmount: 10000,
      onlyZero: true,
      deptAmounts
    });

    const zeroAfter = store.loadData().budgets.filter(
      b => b.month === currentMonth && b.totalAmount === 0
    ).length;
    assertEqual(zeroAfter, 0, '补齐后没有零额度预算');
    assertTrue(result.updatedCount > 0, `零额度更新了 ${result.updatedCount} 条`);

    const configFinal = budgetService.checkBudgetConfig(currentMonth);
    assertEqual(configFinal.isComplete, true, '配置完全完整');
    assertEqual(configFinal.zeroAmountBudgets.length, 0, '零额度项已全部补齐');

    return `更新了 ${result.updatedCount} 条零额度预算，配置完整度 100%`;
  });

  return '配置检查与自动补齐验证通过';
}

function scenario_fourCategoryImportDetails() {
  const currentMonth = getCurrentMonth();

  runStep('初始化：先创建2条已有预算', () => {
    budgetService.resetAllBudgets();
    budgetService.createBudget({
      month: currentMonth, departmentId: 'dept1',
      category: '差旅费', totalAmount: 15000
    }, 'u5');
    budgetService.createBudget({
      month: currentMonth, departmentId: 'dept1',
      category: '办公费', totalAmount: 6000
    }, 'u5');
    return '已创建 2 条基础预算：差旅费15000，办公费6000';
  });

  let importResult;
  runStep('导入混合CSV：成功/跳过/拒绝覆盖/失败 四类应有', () => {
    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,20000
${currentMonth},dept1,培训费,5000
${currentMonth},dept1,差旅费,25000
${currentMonth},dept2,招待费,3000
${currentMonth},,交通费,2000
${currentMonth},dept3,通讯费,invalid
${currentMonth},dept4,培训费,8000`;

    importResult = budgetService.importBudgetsFromCSV(csvContent, 'u5', {
      fileName: 'test_mixed.csv',
      remark: '测试四类导入明细'
    });

    assertTrue(importResult.success.length >= 2, `成功至少2条，实际 ${importResult.success.length}`);
    assertTrue(importResult.skipped.length >= 1, `跳过至少1条（CSV内重复），实际 ${importResult.skipped.length}`);
    assertTrue(importResult.rejected.length >= 1, `拒绝覆盖至少1条，实际 ${importResult.rejected.length}`);
    assertTrue(importResult.failed.length >= 1, `失败至少1条，实际 ${importResult.failed.length}`);

    return `四类明细结果：成功${importResult.success.length}、跳过${importResult.skipped.length}、拒绝覆盖${importResult.rejected.length}、失败${importResult.failed.length}`;
  });

  runStep('验证四类明细字段完整', () => {
    for (const s of importResult.success) {
      assertTrue(s.budgetId !== undefined, '成功记录包含budgetId');
      assertTrue(s.totalAmount !== undefined, '成功记录包含totalAmount');
      assertTrue(s.line !== undefined, '成功记录包含行号');
    }
    for (const s of importResult.skipped) {
      assertTrue(s.reason !== undefined, '跳过记录包含reason');
      assertTrue(s.line !== undefined, '跳过记录包含行号');
    }
    for (const r of importResult.rejected) {
      assertTrue(r.reason !== undefined, '拒绝覆盖记录包含reason');
      assertTrue(r.existingAmount !== undefined, '拒绝覆盖记录包含现有额度');
      assertTrue(r.line !== undefined, '拒绝覆盖记录包含行号');
      assertTrue(r.reason.includes('允许覆盖'), '拒绝覆盖原因提示如何覆盖');
    }
    for (const f of importResult.failed) {
      assertTrue(f.error !== undefined, '失败记录包含error');
      assertTrue(f.line !== undefined, '失败记录包含行号');
    }
    return '四类明细字段完整性验证通过';
  });

  runStep('拒绝覆盖的数据未被修改', () => {
    const travelBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(travelBudget.totalAmount, 15000, '差旅费保持原值15000，未被覆盖');
    return '拒绝覆盖的预算未被修改';
  });

  runStep('验证批次记录保存完整', () => {
    assertTrue(importResult.batchId !== undefined, '返回了批次ID');
    assertTrue(importResult.batchNo !== undefined, '返回了批次号');
    assertTrue(importResult.batchNo.startsWith('BATCH'), '批次号格式正确');
    assertEqual(importResult.batch.totalRows, 7, '批次总行数正确');
    assertEqual(importResult.batch.successCount, importResult.success.length, '批次成功计数正确');
    assertEqual(importResult.batch.rejectedCount, importResult.rejected.length, '批次拒绝计数正确');
    assertTrue(importResult.batch.totalAmount > 0, '批次总额度统计正确');

    const batches = budgetService.listImportBatches({ month: currentMonth });
    assertTrue(batches.length >= 1, `能查询到批次记录（共${batches.length}个批次）`);
    const lastBatch = budgetService.getImportBatch(importResult.batchId);
    assertTrue(lastBatch !== null, '可通过ID查询批次详情');
    assertEqual(lastBatch.batchNo, importResult.batchNo, '批次号一致');
    return `批次 ${importResult.batchNo} 记录完整，可查询`;
  });

  runStep('允许覆盖模式：能覆盖已存在的预算', () => {
    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,25000
${currentMonth},dept1,办公费,10000`;

    const overrideResult = budgetService.importBudgetsFromCSV(csvContent, 'u5', {
      fileName: 'test_override.csv',
      remark: '测试覆盖导入',
      allowOverride: true
    });

    assertEqual(overrideResult.rejected.length, 0, '允许覆盖时拒绝覆盖为0');
    assertEqual(overrideResult.success.length, 2, '两条都成功（覆盖）');

    const travelAfter = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    const officeAfter = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(travelAfter.totalAmount, 25000, '差旅费被覆盖为25000');
    assertApprox(officeAfter.totalAmount, 10000, '办公费被覆盖为10000');

    return '允许覆盖模式工作正常，两条预算均被覆盖';
  });

  return '四类导入明细验证通过';
}

function scenario_reconcileExportAndCrossCheck() {
  const currentMonth = getCurrentMonth();

  runStep('初始化：创建预算 → 导入批次 → 报销审批产生流水', () => {
    resetAll();
    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,20000
${currentMonth},dept1,办公费,8000
${currentMonth},dept2,差旅费,15000`;
    const batch1 = budgetService.importBudgetsFromCSV(csvContent, 'u5', {
      fileName: 'reconcile_test_batch1.csv'
    });

    const r1 = service.createReimbursement({
      title: '对账测试-差旅费1', amount: 5000, type: '差旅费'
    }, 'u1');
    service.auditApprove(r1.id, 'u2');
    service.auditApprove(r1.id, 'u3');

    const r2 = service.createReimbursement({
      title: '对账测试-办公费1', amount: 2000, type: '办公费'
    }, 'u1');
    service.withdrawReimbursement(r2.id, 'u1', '测试撤销回滚');

    service.resubmitReimbursement(r2.id, 'u1');
    service.auditApprove(r2.id, 'u2');
    service.auditApprove(r2.id, 'u3');

    return `批次1创建 + 2张报销单完整流转`;
  });

  let reconcileCSV;
  runStep('导出对账数据（CSV格式）', () => {
    reconcileCSV = budgetService.exportReconcileToCSV({ month: currentMonth });
    assertTrue(reconcileCSV.length > 0, 'CSV导出内容不为空');
    const lines = reconcileCSV.split('\n');
    assertTrue(lines.length >= 2, '至少有表头和一行数据');

    const header = lines[0];
    const requiredCols = ['batchNo', 'budgetId', 'month', 'departmentId', 'category',
      'transactionType', 'amount', 'balanceAfter', 'runningTotal', 'runningAvailable'];
    for (const col of requiredCols) {
      assertTrue(header.includes(col), `CSV表头包含 ${col}`);
    }

    return `CSV导出成功：${lines.length - 1} 行数据`;
  });

  let reconcileJSON;
  runStep('导出对账数据（JSON格式）并校验结构', () => {
    reconcileJSON = budgetService.exportReconcileToJSON({ month: currentMonth });
    const obj = JSON.parse(reconcileJSON);

    assertTrue(obj.exportTime !== undefined, 'JSON包含导出时间');
    assertTrue(obj.summary !== undefined, 'JSON包含summary');
    assertTrue(obj.details !== undefined, 'JSON包含details');
    assertTrue(obj.summaryCount > 0, 'summary有数据');
    assertTrue(obj.totalRecords > 0, 'details有数据');

    for (const s of obj.summary) {
      assertTrue(s.month !== undefined, 'summary有month');
      assertTrue(s.departmentId !== undefined, 'summary有departmentId');
      assertTrue(s.category !== undefined, 'summary有category');
      assertTrue(s.finalAvailable !== undefined, 'summary有finalAvailable');
      assertTrue(s.batches !== undefined, 'summary关联了批次号');
    }

    for (const d of obj.details) {
      assertTrue(d.transactionId !== undefined, 'detail有transactionId');
      assertTrue(d.runningTotal !== undefined, 'detail有runningTotal');
      assertTrue(d.operatedAt !== undefined, 'detail有operatedAt');
    }

    return `JSON导出成功：${obj.summaryCount} 条汇总，${obj.totalRecords} 条明细`;
  });

  runStep('对账数据交叉校验：批次、月份、部门、交易类型、额度变化一致', () => {
    const obj = JSON.parse(reconcileJSON);
    const byBudget = {};

    for (const d of obj.details) {
      const key = `${d.budgetId}`;
      if (!byBudget[key]) byBudget[key] = [];
      byBudget[key].push(d);
    }

    for (const budgetId of Object.keys(byBudget)) {
      const items = byBudget[budgetId].sort((a, b) =>
        new Date(a.operatedAt) - new Date(b.operatedAt)
      );
      const last = items[items.length - 1];

      const budget = budgetService.getBudget(budgetId);
      assertApprox(last.runningTotal, budget.totalAmount,
        `预算 ${budgetId} 的 runningTotal 与 totalAmount 一致`);
      assertApprox(last.runningUsed, budget.usedAmount,
        `预算 ${budgetId} 的 runningUsed 与 usedAmount 一致`);
      assertApprox(last.runningFrozen, budget.frozenAmount,
        `预算 ${budgetId} 的 runningFrozen 与 frozenAmount 一致`);
      assertApprox(last.runningAvailable, budgetService.computeAvailable(budget),
        `预算 ${budgetId} 的 runningAvailable 与 计算值 一致`);
    }

    const hasImport = obj.details.some(d => d.transactionType === BUDGET_TRANSACTION_TYPES.IMPORT);
    const hasFreeze = obj.details.some(d => d.transactionType === BUDGET_TRANSACTION_TYPES.FREEZE);
    const hasDeduct = obj.details.some(d => d.transactionType === BUDGET_TRANSACTION_TYPES.DEDUCT);
    const hasRelease = obj.details.some(d => d.transactionType === BUDGET_TRANSACTION_TYPES.RELEASE);
    assertTrue(hasImport, '对账包含导入流水');
    assertTrue(hasFreeze, '对账包含冻结流水');
    assertTrue(hasDeduct, '对账包含扣减流水');
    assertTrue(hasRelease, '对账包含释放流水');

    return '对账数据与实际数据完全一致，涵盖导入/冻结/扣减/释放四种交易类型';
  });

  runStep('对账数据关联导入批次号正确', () => {
    const obj = JSON.parse(reconcileJSON);
    const batches = budgetService.listImportBatches({ month: currentMonth });
    assertTrue(batches.length >= 1, '至少有1个导入批次');

    const importRecords = obj.details.filter(
      d => d.transactionType === BUDGET_TRANSACTION_TYPES.IMPORT
    );
    for (const rec of importRecords) {
      assertTrue(rec.batchNo !== '-', '导入流水关联了批次号');
      const found = batches.some(b => b.batchNo === rec.batchNo);
      assertTrue(found, `批次号 ${rec.batchNo} 在批次列表中存在`);
    }

    return `对账数据批次关联正确，共 ${importRecords.length} 条导入流水已关联`;
  });

  return '对账导出与交叉校验验证通过';
}

function scenario_fullAcceptancePipeline() {
  const currentMonth = getCurrentMonth();
  const STAGES = [];

  runStep('STAGE 1: 初始化 → 检查配置 → 自动补齐', () => {
    resetAll();

    const check1 = budgetService.checkBudgetConfig(currentMonth);
    STAGES.push({ stage: 'S1-初始检查', missing: check1.missingCount });

    if (!check1.isComplete) {
      const auto = budgetService.autoSetupBudgets(currentMonth, 'u5', {
        defaultAmount: 0
      });
      STAGES.push({ stage: 'S1-零额度补齐', created: auto.createdCount });

      const auto2 = budgetService.autoSetupBudgets(currentMonth, 'u5', {
        onlyZero: true,
        deptAmounts: { dept1: 20000, dept2: 15000, dept3: 10000, dept4: 8000 },
        categoryAmounts: { 差旅费: 5000, 招待费: 3000 }
      });
      STAGES.push({ stage: 'S1-零额度更新', updated: auto2.updatedCount });
    }

    const finalCheck = budgetService.checkBudgetConfig(currentMonth);
    assertTrue(finalCheck.isComplete, `配置检查通过，覆盖率 ${finalCheck.coverageRate}`);
    assertEqual(finalCheck.zeroAmountBudgets.length, 0, '零额度全部补齐');
    STAGES.push({ stage: 'S1-完成', configured: finalCheck.configuredCount });

    return `配置检查 + 自动补齐完成，共 ${finalCheck.configuredCount} 条预算配置完毕`;
  });

  let batch1Id, batch2Id;
  runStep('STAGE 2: 导入预算（首次覆盖 + 二次含拒绝覆盖）', () => {
    const csv1 = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,25000
${currentMonth},dept1,办公费,10000
${currentMonth},dept2,差旅费,18000
${currentMonth},dept2,招待费,5000
${currentMonth},dept3,培训费,8000
${currentMonth},dept4,交通费,3000`;
    const batch1 = budgetService.importBudgetsFromCSV(csv1, 'u5', {
      fileName: 'FY25_budget_v1.csv', remark: '首次正式导入',
      allowOverride: true
    });
    batch1Id = batch1.batchId;
    STAGES.push({
      stage: 'S2-批次1',
      batchNo: batch1.batchNo,
      success: batch1.success.length,
      skipped: batch1.skipped.length,
      rejected: batch1.rejected.length,
      failed: batch1.failed.length,
      totalAmount: batch1.batch.totalAmount
    });

    const csv2 = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,99999
${currentMonth},dept1,培训费,6000
${currentMonth},dept4,通讯费,1500
${currentMonth},dept3,交通费,invalid
${currentMonth},dept2,差旅费,99999`;
    const batch2 = budgetService.importBudgetsFromCSV(csv2, 'u3', {
      fileName: 'FY25_budget_supplement.csv', remark: '补充科目'
    });
    batch2Id = batch2.batchId;
    assertTrue(batch2.rejected.length >= 2, `拒绝覆盖至少2条（差旅费重复），实际 ${batch2.rejected.length}`);
    assertTrue(batch2.failed.length >= 1, `失败至少1条（invalid），实际 ${batch2.failed.length}`);
    STAGES.push({
      stage: 'S2-批次2',
      batchNo: batch2.batchNo,
      success: batch2.success.length,
      skipped: batch2.skipped.length,
      rejected: batch2.rejected.length,
      failed: batch2.failed.length,
      totalAmount: batch2.batch.totalAmount
    });

    const travelBudget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(travelBudget.totalAmount, 25000, '拒绝覆盖生效，差旅费保持25000');

    return `两个批次导入完成：批次1 ${batch1.success.length}条，批次2 ${batch2.success.length}条`;
  });

  runStep('STAGE 3: 业务操作（创建/撤销/重提/审批/归档）', () => {
    const r1 = service.createReimbursement({
      title: '差旅报销-北京出差', amount: 8000, type: '差旅费'
    }, 'u1');
    const r2 = service.createReimbursement({
      title: '办公用品采购', amount: 3500, type: '办公费'
    }, 'u1');
    const r3 = service.createReimbursement({
      title: '客户招待餐费', amount: 2000, type: '招待费'
    }, 'u1');

    service.withdrawReimbursement(r2.id, 'u1', '金额填错，撤销修改');
    service.resubmitReimbursement(r2.id, 'u1');

    service.auditApprove(r1.id, 'u2');
    service.auditApprove(r1.id, 'u3');
    service.auditApprove(r2.id, 'u2');
    service.auditApprove(r2.id, 'u3');
    service.auditApprove(r3.id, 'u2');
    service.auditApprove(r3.id, 'u3');

    service.archive(r1.id, 'u4');
    service.archive(r2.id, 'u4');

    for (const id of [r1.id, r2.id, r3.id]) {
      const result = budgetService.validateReimbursementLogConsistency(id);
      assertTrue(result.valid, `报销单 ${id} 日志一致性：${result.issues.join(';')}`);
    }
    STAGES.push({ stage: 'S3-业务完成', reimbursements: 3 });

    return '3张报销单全部完成流转，日志与流水一致性全部通过';
  });

  runStep('STAGE 4: 导出对账，交叉校验数据完整性', () => {
    const csv = budgetService.exportReconcileToCSV({ month: currentMonth });
    const json = budgetService.exportReconcileToJSON({ month: currentMonth });
    const obj = JSON.parse(json);

    const csvLines = csv.split('\n');
    assertTrue(csvLines.length >= 5, 'CSV至少5行');
    assertEqual(obj.totalRecords, csvLines.length - 1, 'JSON与CSV记录数一致');

    const batches = budgetService.listImportBatches({ month: currentMonth });
    assertTrue(batches.length >= 2, `至少有2个导入批次（实际${batches.length}）`);

    const batchNos = new Set();
    for (const d of obj.details) {
      if (d.transactionType === BUDGET_TRANSACTION_TYPES.IMPORT && d.batchNo !== '-') {
        batchNos.add(d.batchNo);
      }
    }
    for (const b of batches) {
      const hasSuccess = b.details && Array.isArray(b.details.success) && b.details.success.length > 0;
      if (hasSuccess) {
        assertTrue(batchNos.has(b.batchNo), `对账数据包含有成功记录的批次 ${b.batchNo}`);
      }
    }

    STAGES.push({ stage: 'S4-对账完成', summaryCount: obj.summaryCount, totalRecords: obj.totalRecords });

    return `对账导出完成：JSON ${obj.totalRecords} 条明细，CSV ${csvLines.length - 1} 行，包含 ${batches.length} 个批次`;
  });

  runStep('STAGE 5: 模拟重启，跨重启状态保持验证', () => {
    const before = snapshotData('重启前');
    simulateRestart();
    const after = snapshotData('重启后');
    const issues = compareSnapshots(before, after);
    assertEqual(issues.length, 0, `重启后数据一致，问题：${issues.join('; ')}`);

    const batchesAfter = budgetService.listImportBatches({ month: currentMonth });
    assertEqual(batchesAfter.length, 2, '重启后导入批次记录保留');

    const data = store.loadData();
    for (const budget of data.budgets) {
      const freezes = data.budgetFreezes.filter(f => f.budgetId === budget.id);
      const frozenSum = freezes
        .filter(f => f.status === BUDGET_FREEZE_STATUS.FROZEN)
        .reduce((s, f) => s + f.amount, 0);
      const deductedSum = freezes
        .filter(f => f.status === BUDGET_FREEZE_STATUS.DEDUCTED)
        .reduce((s, f) => s + f.amount, 0);

      assertApprox(budget.frozenAmount, frozenSum, `预算 ${budget.id} 冻结一致`);
      assertApprox(budget.usedAmount, deductedSum, `预算 ${budget.id} 已用一致`);
    }

    STAGES.push({ stage: 'S5-重启通过', budgetCount: after.budgetCount });
    return '跨重启状态保持验证通过';
  });

  log('info', '完整验收链路阶段汇总:', STAGES);
  return `完整验收链路通过：5个阶段全部验证成功（${STAGES.map(s => s.stage).join(' → ')}）`;
}

function generateHTMLReport() {
  ensureResultsDir();

  const passedRate = acceptanceState.totalScenarios > 0
    ? ((acceptanceState.passedScenarios / acceptanceState.totalScenarios) * 100).toFixed(1)
    : '0';

  const scenariosHTML = acceptanceState.scenarios.map(s => {
    const statusClass = s.status === 'passed' ? 'passed' : s.status === 'failed' ? 'failed' : 'skipped';
    const statusIcon = s.status === 'passed' ? '✅' : s.status === 'failed' ? '❌' : '⏭️';
    const duration = (s.duration / 1000).toFixed(2);

    let errorHTML = '';
    if (s.error) {
      errorHTML = `
        <div class="error-detail">
          <div class="error-title">错误信息</div>
          <div class="error-message">${s.error.message}</div>
          <details class="error-stack">
            <summary>查看堆栈</summary>
            <pre>${s.error.stack}</pre>
          </details>
        </div>
      `;
    }

    return `
      <div class="scenario-card ${statusClass}">
        <div class="scenario-header">
          <div class="scenario-title">
            <span class="status-icon">${statusIcon}</span>
            <span class="scenario-name">${s.name}</span>
          </div>
          <div class="scenario-meta">
            <span class="duration">${duration}s</span>
          </div>
        </div>
        <div class="scenario-description">${s.description}</div>
        ${errorHTML}
        <div class="scenario-footer">
          <span class="scenario-id">ID: ${s.id}</span>
          <span class="scenario-time">${s.startTime.replace('T', ' ').slice(0, 19)}</span>
        </div>
      </div>
    `;
  }).join('');

  const failedScenarios = acceptanceState.scenarios.filter(s => s.status === 'failed');
  const failedSummaryHTML = failedScenarios.length > 0 ? `
    <div class="section">
      <h2>🔍 失败定位</h2>
      <div class="failed-list">
        ${failedScenarios.map(s => `
          <div class="failed-item">
            <div class="failed-name">❌ ${s.name}</div>
            <div class="failed-error">${s.error.message}</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const recentLogs = acceptanceState.logs.slice(-50);
  const logsHTML = recentLogs.map(l => {
    const levelClass = l.level.toLowerCase();
    return `
      <div class="log-entry ${levelClass}">
        <span class="log-time">${l.time.slice(11, 19)}</span>
        <span class="log-level">[${l.level.toUpperCase()}]</span>
        <span class="log-scenario">${l.scenario || '-'}</span>
        <span class="log-message">${l.message}</span>
      </div>
    `;
  }).join('');

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>预算回放验收报告</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      color: #333;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    .header h1 { font-size: 28px; margin-bottom: 10px; }
    .header .subtitle { opacity: 0.9; font-size: 14px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 20px;
    }
    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .summary-card .value { font-size: 32px; font-weight: bold; margin-bottom: 4px; }
    .summary-card .label { color: #666; font-size: 13px; }
    .summary-card.total .value { color: #333; }
    .summary-card.passed .value { color: #52c41a; }
    .summary-card.failed .value { color: #ff4d4f; }
    .summary-card.skipped .value { color: #faad14; }
    .section {
      background: white;
      padding: 24px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .section h2 { font-size: 18px; margin-bottom: 16px; color: #1a1a1a; }
    .scenario-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 16px;
    }
    .scenario-card {
      border: 1px solid #e8e8e8;
      border-radius: 8px;
      padding: 16px;
      transition: box-shadow 0.2s;
    }
    .scenario-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .scenario-card.passed { border-left: 4px solid #52c41a; }
    .scenario-card.failed { border-left: 4px solid #ff4d4f; }
    .scenario-card.skipped { border-left: 4px solid #faad14; }
    .scenario-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .scenario-title { font-weight: 600; font-size: 15px; }
    .status-icon { margin-right: 6px; }
    .scenario-meta { font-size: 12px; color: #999; }
    .scenario-description {
      color: #666;
      font-size: 13px;
      margin-bottom: 12px;
      line-height: 1.5;
    }
    .scenario-footer {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #999;
      border-top: 1px solid #f0f0f0;
      padding-top: 8px;
    }
    .error-detail {
      background: #fff2f0;
      border: 1px solid #ffccc7;
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .error-title { font-weight: 600; color: #ff4d4f; margin-bottom: 6px; font-size: 13px; }
    .error-message { font-size: 13px; color: #333; margin-bottom: 8px; }
    .error-stack summary { cursor: pointer; font-size: 12px; color: #666; }
    .error-stack pre {
      background: #2d2d2d;
      color: #ccc;
      padding: 10px;
      border-radius: 4px;
      font-size: 11px;
      overflow-x: auto;
      margin-top: 6px;
    }
    .failed-list { display: flex; flex-direction: column; gap: 12px; }
    .failed-item {
      background: #fff2f0;
      border-left: 4px solid #ff4d4f;
      padding: 12px 16px;
      border-radius: 4px;
    }
    .failed-name { font-weight: 600; margin-bottom: 4px; }
    .failed-error { color: #666; font-size: 13px; }
    .logs-container {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 16px;
      border-radius: 6px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      max-height: 400px;
      overflow-y: auto;
    }
    .log-entry {
      padding: 2px 0;
      display: flex;
      gap: 8px;
      white-space: pre-wrap;
    }
    .log-time { color: #808080; }
    .log-level { font-weight: bold; min-width: 50px; }
    .log-entry.info .log-level { color: #569cd6; }
    .log-entry.error .log-level { color: #f48771; }
    .log-entry.warning .log-level { color: #dcdcaa; }
    .log-entry.debug .log-level { color: #808080; }
    .log-scenario { color: #ce9178; min-width: 150px; }
    .log-message { color: #d4d4d4; }
    .footer {
      text-align: center;
      color: #999;
      font-size: 12px;
      margin-top: 20px;
      padding: 20px;
    }
    .stats-row {
      display: flex;
      gap: 20px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .stat-item {
      background: rgba(255,255,255,0.2);
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💰 预算回放验收报告</h1>
      <div class="subtitle">预算模块全场景自动化验收 · 一键复跑</div>
      <div class="stats-row">
        <div class="stat-item">开始时间：${acceptanceState.startTime?.replace('T', ' ').slice(0, 19) || '-'}</div>
        <div class="stat-item">结束时间：${acceptanceState.endTime?.replace('T', ' ').slice(0, 19) || '-'}</div>
        <div class="stat-item">总耗时：${acceptanceState.endTime ? ((new Date(acceptanceState.endTime) - new Date(acceptanceState.startTime)) / 1000).toFixed(2) + 's' : '-'}</div>
        <div class="stat-item">通过率：${passedRate}%</div>
      </div>
    </div>

    <div class="summary">
      <div class="summary-card total">
        <div class="value">${acceptanceState.totalScenarios}</div>
        <div class="label">总场景数</div>
      </div>
      <div class="summary-card passed">
        <div class="value">${acceptanceState.passedScenarios}</div>
        <div class="label">通过</div>
      </div>
      <div class="summary-card failed">
        <div class="value">${acceptanceState.failedScenarios}</div>
        <div class="label">失败</div>
      </div>
      <div class="summary-card skipped">
        <div class="value">${acceptanceState.skippedScenarios}</div>
        <div class="label">跳过</div>
      </div>
    </div>

    <div class="section">
      <h2>📋 场景列表</h2>
      <div class="scenario-list">
        ${scenariosHTML}
      </div>
    </div>

    ${failedSummaryHTML}

    <div class="section">
      <h2>📝 日志摘要（最近 50 条）</h2>
      <div class="logs-container">
        ${logsHTML}
      </div>
    </div>

    <div class="footer">
      <p>预算回放验收模块 · 自动生成 · 可通过 <code>npm run budget-acceptance</code> 重新运行</p>
      <p>完整日志：acceptance-results/budget-acceptance.log</p>
    </div>
  </div>
</body>
</html>
  `;

  fs.writeFileSync(REPORT_FILE, html, 'utf8');
  log('info', `HTML 报告已生成：${REPORT_FILE}`);
  return REPORT_FILE;
}

function runAcceptance() {
  acceptanceState.startTime = nowISO();
  const currentMonth = getCurrentMonth();

  console.log('\n' + '═'.repeat(70));
  console.log('💰 预算验收中心 · 全链路自动化验收');
  console.log('═'.repeat(70));
  console.log('内置场景：重启恢复、导入冲突、权限拦截、撤销回补、配置缺失回退');
  console.log('          重复导入一致性、跨重启一致性、撤销重提回放');
  console.log('  ✨ 新增：  配置检查与自动补齐、四类导入明细、对账导出与交叉校验');
  console.log('          完整端到端链路（配置→导入→业务→对账→重启）');
  console.log('输出：HTML 结果页、日志摘要、失败定位、CLI 提示');
  console.log('═'.repeat(70));

  try {
    const initConfig = budgetService.checkBudgetConfig(currentMonth);
    console.log(`\n📋 启动时预算配置检查（${currentMonth}月）：`);
    console.log(`   覆盖率：${initConfig.coverageRate}（${initConfig.configuredCount}/${initConfig.totalCombinations}）`);
    if (initConfig.isComplete && initConfig.zeroAmountBudgets.length === 0) {
      console.log(`   ✅ 配置完整，可直接进入验收`);
    } else {
      if (initConfig.missingCount > 0) {
        console.log(`   ⚠️  缺失 ${initConfig.missingCount} 项预算配置`);
        console.log(`      示例缺失：${initConfig.missing.slice(0, 3).map(m => `${m.departmentName}-${m.category}`).join('、')}${initConfig.missing.length > 3 ? '...' : ''}`);
      }
      if (initConfig.zeroAmountBudgets.length > 0) {
        console.log(`   ⚠️  ${initConfig.zeroAmountBudgets.length} 项为零额度预算`);
      }
      console.log(`   💡 修复方式：`);
      console.log(`      1. 在验收场景中会自动调用 autoSetupBudgets 补齐`);
      console.log(`      2. 或手动调用 API：POST /api/budgets/auto-setup`);
      console.log(`      3. 或使用管理员账号在预算管理中导入 CSV`);
    }

    resetAll();

    runScenario(
      'S01',
      '重启恢复验证',
      '模拟服务重启，验证预算数据、冻结记录、交易流水完全一致，重启后业务操作正常',
      scenario_restartRecovery
    );

    runScenario(
      'S02',
      '导入冲突与分类验证',
      '验证重复导入跳过已存在、CSV内重复去重、成功/跳过/失败三类结果清晰可辨',
      scenario_importConflict
    );

    runScenario(
      'S03',
      '权限拦截验证',
      '验证申请人/审核员/财务/管理员各角色的预算操作权限边界',
      scenario_permissionInterception
    );

    runScenario(
      'S04',
      '撤销后额度回补',
      '验证撤销后预算释放、重提后重新冻结、多次循环后额度计算准确',
      scenario_withdrawRefund
    );

    runScenario(
      'S05',
      '配置缺失回退',
      '验证未配置预算时的友好提示，以及失败时数据完全回退不产生脏数据',
      scenario_missingConfigFallback
    );

    runScenario(
      'S06',
      '重复导入一致性',
      '验证同批数据多次重复导入后额度、冻结、流水保持一致，导出导入对账正确',
      scenario_repeatImportConsistency
    );

    runScenario(
      'S07',
      '跨重启状态一致性',
      '复杂场景下（冻结/扣减/释放并存）重启后所有数据和计算逻辑完全一致',
      scenario_crossRestartConsistency
    );

    runScenario(
      'S08',
      '撤销再提交回放',
      '完整回放：创建→撤销→重提→审批→归档，验证额度变化、流水记录、冻结状态及操作日志一致性',
      scenario_withdrawResubmitReplay
    );

    runScenario(
      'S09',
      '配置检查与自动补齐',
      '启动时检查配置完整性，自动补齐缺失项和零额度项，CLI 和接口明确提示缺失内容',
      scenario_configCheckAndAutoSetup
    );

    runScenario(
      'S10',
      '四类导入明细',
      '导入结果明确区分成功、跳过重复、拒绝覆盖、失败原因四类明细，批次记录完整',
      scenario_fourCategoryImportDetails
    );

    runScenario(
      'S11',
      '对账导出与交叉校验',
      '导出CSV/JSON对账数据，校验批次号、月份、部门、交易类型、额度变化与实际数据完全一致',
      scenario_reconcileExportAndCrossCheck
    );

    runScenario(
      'S12',
      '完整端到端验收链路',
      '5阶段完整链路：配置检查&自动补齐 → 导入两个批次含拒绝覆盖 → 业务操作（创建/撤销/重提/审批/归档） → 对账导出交叉校验 → 跨重启状态保持',
      scenario_fullAcceptancePipeline
    );

  } catch (e) {
    log('error', '验收执行异常', e.message);
  } finally {
    acceptanceState.endTime = nowISO();
  }

  console.log('\n' + '═'.repeat(70));
  console.log('📊 验收结果汇总');
  console.log('═'.repeat(70));
  console.log(`  总场景数：${acceptanceState.totalScenarios}`);
  console.log(`  ✅  通过：${acceptanceState.passedScenarios}`);
  console.log(`  ❌  失败：${acceptanceState.failedScenarios}`);
  console.log(`  ⏭️  跳过：${acceptanceState.skippedScenarios}`);
  const passRate = acceptanceState.totalScenarios > 0
    ? ((acceptanceState.passedScenarios / acceptanceState.totalScenarios) * 100).toFixed(1)
    : 0;
  console.log(`  通过率：${passRate}%`);
  console.log('═'.repeat(70));

  if (acceptanceState.failedScenarios > 0) {
    console.log('\n❌ 失败场景定位：');
    acceptanceState.scenarios
      .filter(s => s.status === 'failed')
      .forEach((s, i) => {
        console.log(`  ${i + 1}. [${s.id}] ${s.name}`);
        console.log(`     错误：${s.error.message}`);
        const failedStep = s.error.stack?.split('\n')[1] || '';
        if (failedStep) console.log(`     位置：${failedStep.trim()}`);
      });
    console.log('\n🔍 失败排查建议：');
    console.log('  · 查看日志文件 acceptance-results/budget-acceptance.log');
    console.log('  · 查看HTML报告中的失败堆栈');
    console.log('  · 用管理员账号在前端验收中心查看详细状态');
  }

  const reportFile = generateHTMLReport();
  saveLog();

  const resultFile = path.join(RESULTS_DIR, 'budget-acceptance-result.json');
  const jsonResult = {
    startTime: acceptanceState.startTime,
    endTime: acceptanceState.endTime,
    durationMs: acceptanceState.endTime ? (new Date(acceptanceState.endTime) - new Date(acceptanceState.startTime)) : 0,
    totalScenarios: acceptanceState.totalScenarios,
    passedScenarios: acceptanceState.passedScenarios,
    failedScenarios: acceptanceState.failedScenarios,
    skippedScenarios: acceptanceState.skippedScenarios,
    passRate: passRate,
    reportUrl: '/api/acceptance/report',
    reportFile: reportFile,
    logFile: LOG_FILE,
    results: acceptanceState.scenarios.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      status: s.status,
      passed: s.status === 'passed',
      durationMs: s.durationMs || 0,
      stepCount: s.stepCount || 0,
      error: s.error ? { message: s.error.message, stack: (s.error.stack || '').split('\n').slice(0, 3).join('\n') } : null,
      stages: s.stages || null
    })),
    failedScenariosDetails: acceptanceState.scenarios
      .filter(s => s.status === 'failed')
      .map(s => ({
        id: s.id,
        name: s.name,
        error: s.error ? s.error.message : '未知错误',
        failedStep: s.error?.stack?.split('\n')[1]?.trim() || ''
      }))
  };
  fs.writeFileSync(resultFile, JSON.stringify(jsonResult, null, 2), 'utf8');

  console.log(`\n📄 HTML 报告：${reportFile}`);
  console.log(`📝 完整日志：${LOG_FILE}`);
  console.log(`💾 结果数据：${resultFile}`);
  console.log(`\n💡 重新运行：npm run budget-acceptance`);

  if (acceptanceState.failedScenarios > 0) {
    process.exit(1);
  } else {
    console.log('\n🎉 所有验收场景通过！预算验收中心已就绪。');
    process.exit(0);
  }
}

try {
  runAcceptance();
} catch (e) {
  console.error('\n❌ 验收模块异常:', e.message);
  console.error(e.stack);
  process.exit(1);
}

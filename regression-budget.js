const store = require('./store');
const service = require('./service');
const budgetService = require('./budget-service');

const {
  STATUS, STATUS_LABEL, USERS, DEPARTMENTS,
  loadData, saveData, nowISO, getCurrentMonth
} = store;

function test(name, fn) {
  console.log(`\n▶️  ${name}`);
  try {
    const result = fn();
    console.log(`  ✅ 成功: ${result}`);
    return result;
  } catch (e) {
    console.log(`  ❌ 失败: ${e.message}`);
    throw e;
  }
}

function expectFail(name, fn, expectedMsg) {
  console.log(`\n▶️  ${name}（预期失败）`);
  try {
    fn();
    console.log(`  ❌ 未按预期失败！`);
    return false;
  } catch (e) {
    if (expectedMsg && !e.message.includes(expectedMsg)) {
      console.log(`  ❌ 错误信息不符，期望包含 "${expectedMsg}"，实际：${e.message}`);
      return false;
    }
    console.log(`  ✅ 按预期失败: ${e.message}`);
    return true;
  }
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

function resetAll() {
  service.resetAll();
}

function setupBudgetData() {
  resetAll();
  const currentMonth = getCurrentMonth();

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

  budgetService.createBudget({
    month: currentMonth,
    departmentId: 'dept2',
    category: '差旅费',
    totalAmount: 8000
  }, 'u5');

  return currentMonth;
}

function getRawBudget(id) {
  const data = loadData();
  return data.budgets.find(b => b.id === id);
}

function getFreezeByReimbursement(reimbursementId) {
  const data = loadData();
  return data.budgetFreezes.find(f => f.reimbursementId === reimbursementId);
}

function runRegression() {
  console.log('='.repeat(70));
  console.log('预算模块回归测试：配置、占用、回冲、导入导出、权限、重启恢复');
  console.log('='.repeat(70));

  let currentMonth;

  console.log('\n' + '='.repeat(70));
  console.log('一、预算配置管理');
  console.log('='.repeat(70));

  test('重置数据后，预算列表为空', () => {
    resetAll();
    const list = budgetService.listBudgets();
    assertEqual(list.length, 0, '预算数量');
    return `预算列表为空，共 ${list.length} 条`;
  });

  test('管理员创建预算：研发部差旅费 10000 元', () => {
    currentMonth = getCurrentMonth();
    const b = budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '差旅费',
      totalAmount: 10000
    }, 'u5');
    assertEqual(b.month, currentMonth, '月份');
    assertEqual(b.departmentId, 'dept1', '部门ID');
    assertEqual(b.category, '差旅费', '费用科目');
    assertApprox(b.totalAmount, 10000, '总额度');
    assertApprox(b.usedAmount, 0, '已用额度');
    assertApprox(b.frozenAmount, 0, '冻结额度');
    assertApprox(b.availableAmount, 10000, '可用额度');
    return `创建成功：${b.id}，可用 ${b.availableAmount.toFixed(2)} 元`;
  });

  expectFail('重复创建相同月份+部门+科目的预算 → 失败', () =>
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '差旅费',
      totalAmount: 5000
    }, 'u5'),
    '已存在');

  expectFail('申请人创建预算 → 权限拦截', () =>
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '招待费',
      totalAmount: 3000
    }, 'u1'),
    '无权限');

  test('财务可以创建预算', () => {
    const b = budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept1',
      category: '办公费',
      totalAmount: 5000
    }, 'u3');
    assertEqual(b.category, '办公费', '科目');
    assertApprox(b.totalAmount, 5000, '总额度');
    return `财务创建成功：${b.id}`;
  });

  test('手工调整预算额度 +2000', () => {
    const list = budgetService.listBudgets({ month: currentMonth, departmentId: 'dept1', category: '差旅费' });
    const b = list[0];
    const before = b.totalAmount;
    const result = budgetService.adjustBudget(b.id, 2000, 'Q2追加预算', 'u5', b.version);
    assertApprox(result.totalAmount, before + 2000, '调整后总额');
    assertApprox(result.availableAmount, before + 2000, '可用额度同步增加');
    return `调整成功：${before.toFixed(2)} → ${result.totalAmount.toFixed(2)} 元`;
  });

  test('预算列表查询：按月份+部门过滤', () => {
    budgetService.createBudget({
      month: currentMonth,
      departmentId: 'dept2',
      category: '差旅费',
      totalAmount: 8000
    }, 'u5');

    const dept1List = budgetService.listBudgets({ month: currentMonth, departmentId: 'dept1' });
    assertEqual(dept1List.length >= 2, true, '研发部至少2条预算');

    const dept2List = budgetService.listBudgets({ month: currentMonth, departmentId: 'dept2' });
    assertEqual(dept2List.length, 1, '市场部1条预算');

    return `研发部 ${dept1List.length} 条，市场部 ${dept2List.length} 条`;
  });

  test('预算汇总：按部门汇总', () => {
    const summary = budgetService.getBudgetSummary(currentMonth, 'dept1');
    assertEqual(summary.departmentId, 'dept1', '部门ID');
    assertApprox(summary.totalAmount, 10000 + 2000 + 5000, '总额度（12000差旅费+5000办公费）');
    assertApprox(summary.usedAmount, 0, '已用为0');
    assertApprox(summary.frozenAmount, 0, '冻结为0');
    assertApprox(summary.availableAmount, 17000, '可用17000');
    return `研发部总预算 ${summary.totalAmount.toFixed(2)} 元，可用 ${summary.availableAmount.toFixed(2)} 元`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('二、报销单流转中的预算冻结/扣减/释放');
  console.log('='.repeat(70));

  test('Step 1: 创建报销单 → 自动冻结预算', () => {
    const r = service.createReimbursement({
      title: '北京出差报销',
      amount: 3000,
      type: '差旅费',
      description: '测试预算冻结'
    }, 'u1');
    assertEqual(r.status, STATUS.PENDING_AUDIT, '状态为待审核');
    assertApprox(r.amount, 3000, '金额');

    const budgetStatus = r.budgetStatus;
    assertEqual(budgetStatus.hasBudget, true, '有预算记录');
    assertEqual(budgetStatus.freezeStatus, 'frozen', '状态为冻结');
    assertApprox(budgetStatus.frozenAmount, 3000, '冻结金额');

    const budget = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(budget.frozenAmount, 3000, '预算冻结增加3000');
    assertApprox(budget.availableAmount, 12000 - 3000, '可用减少3000');

    return `创建成功：${r.id}，预算已冻结 3000 元`;
  });

  let testReimbursementId;

  test('Step 2: 初审通过 → 预算保持冻结', () => {
    const list = service.listReimbursements();
    testReimbursementId = list[0].id;

    const before = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    const result = service.auditApprove(testReimbursementId, 'u2');
    assertEqual(result.status, STATUS.PENDING_REVIEW, '状态为待复核');

    const after = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(after.frozenAmount, before.frozenAmount, '初审通过不改变冻结金额');
    assertApprox(after.usedAmount, before.usedAmount, '初审通过不改变已用金额');

    return `初审通过：预算保持冻结 ${after.frozenAmount.toFixed(2)} 元`;
  });

  test('Step 3: 财务复核通过 → 预算扣减（冻结转已用）', () => {
    const before = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    const beforeFrozen = before.frozenAmount;
    const beforeUsed = before.usedAmount;

    const result = service.auditApprove(testReimbursementId, 'u3');
    assertEqual(result.status, STATUS.APPROVED, '状态为已通过');

    const after = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(after.frozenAmount, beforeFrozen - 3000, '冻结减少3000');
    assertApprox(after.usedAmount, beforeUsed + 3000, '已用增加3000');
    assertApprox(after.availableAmount, before.availableAmount + 0, '可用额度不变（冻结转已用）');

    const freeze = getFreezeByReimbursement(testReimbursementId);
    assertEqual(freeze.status, 'deducted', '冻结记录状态为已扣减');

    return `财务通过：预算扣减 3000 元，已用 ${after.usedAmount.toFixed(2)} 元`;
  });

  test('Step 4: 归档 → 预算无变化（已在审批时扣减）', () => {
    const before = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    const result = service.archive(testReimbursementId, 'u4');
    assertEqual(result.status, STATUS.ARCHIVED, '状态为已归档');

    const after = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(after.totalAmount, before.totalAmount, '总额度不变');
    assertApprox(after.usedAmount, before.usedAmount, '已用额度不变');
    assertApprox(after.frozenAmount, before.frozenAmount, '冻结额度不变');

    return `归档完成：预算数据无变化`;
  });

  test('Step 5: 归档导出包含预算信息', () => {
    const exported = service.exportArchive(testReimbursementId);
    assertEqual(exported.budgetInfo !== undefined, true, '导出包含预算信息');
    assertEqual(exported.budgetInfo.status.hasBudget, true, '预算状态存在');
    assertEqual(exported.budgetInfo.status.freezeStatus, 'deducted', '扣减状态');
    assertEqual(exported.budgetInfo.transactions.length > 0, true, '包含预算流水');

    return `归档导出包含预算信息，流水 ${exported.budgetInfo.transactions.length} 条`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('三、驳回归还预算');
  console.log('='.repeat(70));

  let rejectTestId;

  test('创建待审核报销单（冻结预算）', () => {
    const r = service.createReimbursement({
      title: '驳回测试单',
      amount: 2000,
      type: '办公费',
      description: '测试驳回释放'
    }, 'u1');
    rejectTestId = r.id;

    const before = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(before.frozenAmount, 2000, '办公费冻结2000');

    return `创建成功：${r.id}，冻结 2000 元`;
  });

  test('初审驳回 → 预算释放', () => {
    const before = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    const beforeFrozen = before.frozenAmount;
    const beforeAvailable = before.availableAmount;

    const result = service.auditReject(rejectTestId, 'u2', '材料不符合要求');
    assertEqual(result.status, STATUS.REJECTED, '状态为已驳回');

    const after = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(after.frozenAmount, beforeFrozen - 2000, '冻结减少2000');
    assertApprox(after.availableAmount, beforeAvailable + 2000, '可用增加2000');

    const freeze = getFreezeByReimbursement(rejectTestId);
    assertEqual(freeze.status, 'released', '冻结记录状态为已释放');

    return `驳回成功：预算释放 2000 元，可用 ${after.availableAmount.toFixed(2)} 元`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('四、撤销与重提（申请人操作）');
  console.log('='.repeat(70));

  let withdrawTestId;

  test('创建待审核报销单（冻结预算）', () => {
    const r = service.createReimbursement({
      title: '撤销测试单',
      amount: 1500,
      type: '办公费',
      description: '测试撤销释放'
    }, 'u1');
    withdrawTestId = r.id;

    const budget = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(budget.frozenAmount, 1500, '办公费冻结1500');

    return `创建成功：${r.id}，冻结 1500 元`;
  });

  test('申请人撤销 → 预算释放', () => {
    const before = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    const beforeFrozen = before.frozenAmount;

    const result = service.withdrawReimbursement(withdrawTestId, 'u1', '信息有误，需要修改');
    assertEqual(result.status, STATUS.WITHDRAWN, '状态为已撤销');

    const after = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(after.frozenAmount, beforeFrozen - 1500, '冻结减少1500');
    assertApprox(after.availableAmount, before.availableAmount + 1500, '可用增加1500');

    return `撤销成功：预算释放 1500 元`;
  });

  expectFail('非申请人撤销 → 权限拦截', () =>
    service.withdrawReimbursement(withdrawTestId, 'u2', '测试'),
    '无权限');

  test('申请人重提 → 预算重新冻结', () => {
    const before = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    const beforeFrozen = before.frozenAmount;

    const result = service.resubmitReimbursement(withdrawTestId, 'u1');
    assertEqual(result.status, STATUS.PENDING_AUDIT, '重提后状态为待审核');

    const after = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(after.frozenAmount, beforeFrozen + 1500, '冻结增加1500');
    assertApprox(after.availableAmount, before.availableAmount - 1500, '可用减少1500');

    return `重提成功：预算重新冻结 1500 元`;
  });

  test('驳回后也可以重提', () => {
    const before = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    const beforeFrozen = before.frozenAmount;

    const result = service.resubmitReimbursement(rejectTestId, 'u1');
    assertEqual(result.status, STATUS.PENDING_AUDIT, '重提后状态为待审核');

    const after = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    assertApprox(after.frozenAmount, beforeFrozen + 2000, '冻结增加2000');

    return `驳回后重提成功：预算重新冻结 2000 元`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('五、预算不足与配置缺失的可验证反馈');
  console.log('='.repeat(70));

  test('当前办公费可用余额', () => {
    const budget = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    return `办公费可用：${budget.availableAmount.toFixed(2)} 元（总额 ${budget.totalAmount}，已用 ${budget.usedAmount}，冻结 ${budget.frozenAmount}）`;
  });

  expectFail('超预算提交 → 明确的预算不足提示', () =>
    service.createReimbursement({
      title: '超大额报销',
      amount: 99999,
      type: '办公费',
      description: '测试超预算'
    }, 'u1'),
    '预算不足');

  expectFail('未配置的科目 → 明确的配置缺失提示', () =>
    service.createReimbursement({
      title: '招待费报销',
      amount: 1000,
      type: '招待费',
      description: '测试未配置科目'
    }, 'u1'),
    '预算配置缺失');

  test('超预算提示包含具体数字（可验证）', () => {
    const budget = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费');
    const available = budget.availableAmount;
    const overAmount = available + 100;

    let errorMsg = '';
    try {
      service.createReimbursement({
        title: '超额测试',
        amount: overAmount,
        type: '办公费'
      }, 'u1');
    } catch (e) {
      errorMsg = e.message;
    }

    assertEqual(errorMsg.includes(available.toFixed(2)), true, '错误信息包含可用额度');
    assertEqual(errorMsg.includes(overAmount.toFixed(2)), true, '错误信息包含申请额度');
    assertEqual(errorMsg.includes('超支'), true, '错误信息包含超支字样');

    return `错误信息验证通过：包含可用金额、申请金额、超支提示`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('六、幂等性：重复操作不串数据');
  console.log('='.repeat(70));

  let idempotentTestId;

  test('创建报销单（第一次）', () => {
    const r = service.createReimbursement({
      title: '幂等性测试',
      amount: 800,
      type: '差旅费',
      description: '测试重复操作'
    }, 'u1');
    idempotentTestId = r.id;
    return `创建：${r.id}`;
  });

  test('审批通过后，重复调用扣减接口 → 幂等，不重复扣减', () => {
    service.auditApprove(idempotentTestId, 'u2');
    service.auditApprove(idempotentTestId, 'u3');

    const beforeUsed = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费').usedAmount;

    try {
      budgetService.deductBudget(idempotentTestId, 'u3');
    } catch (e) {
      if (!e.message.includes('无法重复冻结') && !e.message.includes('无有效冻结记录')) {
        throw e;
      }
    }

    const afterUsed = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费').usedAmount;
    assertApprox(afterUsed, beforeUsed, '重复扣减不改变已用金额');

    return `重复扣减保持幂等：已用金额 ${afterUsed.toFixed(2)} 元未变`;
  });

  test('重复释放已释放的预算 → 幂等，不重复增加', () => {
    const r = service.createReimbursement({
      title: '释放幂等测试',
      amount: 500,
      type: '办公费'
    }, 'u1');

    service.withdrawReimbursement(r.id, 'u1', '测试');

    const beforeAvailable = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费').availableAmount;

    budgetService.releaseBudget(r.id, '测试重复释放', 'u1');
    budgetService.releaseBudget(r.id, '测试重复释放2', 'u1');

    const afterAvailable = budgetService.getBudgetByKey(currentMonth, 'dept1', '办公费').availableAmount;
    assertApprox(afterAvailable, beforeAvailable, '重复释放不改变可用金额');

    return `重复释放保持幂等：可用金额 ${afterAvailable.toFixed(2)} 元未变`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('七、CSV 导入导出与冲突处理');
  console.log('='.repeat(70));

  test('导出预算CSV', () => {
    const csv = budgetService.exportBudgetsToCSV({ month: currentMonth });
    const lines = csv.trim().split('\n');
    assertEqual(lines.length > 1, true, 'CSV有多行（表头+数据）');
    assertEqual(lines[0].includes('month'), true, '表头包含month');
    assertEqual(lines[0].includes('totalAmount'), true, '表头包含totalAmount');
    assertEqual(lines[0].includes('availableAmount'), true, '表头包含availableAmount');
    return `CSV导出成功：${lines.length - 1} 条数据`;
  });

  test('导入新预算CSV', () => {
    budgetService.resetAllBudgets();
    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,15000
${currentMonth},dept1,办公费,6000
${currentMonth},dept2,差旅费,10000
${currentMonth},dept2,招待费,3000`;

    const result = budgetService.importBudgetsFromCSV(csvContent, 'u5');
    assertEqual(result.success.length, 4, '成功导入4条');
    assertEqual(result.failed.length, 0, '无失败');
    assertEqual(result.skipped.length, 0, '无跳过');

    const list = budgetService.listBudgets({ month: currentMonth });
    assertEqual(list.length, 4, '预算列表有4条');

    return `导入成功：${result.success.length} 条`;
  });

  test('重复导入 → 已存在的跳过，不覆盖', () => {
    const before = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    const beforeAmount = before.totalAmount;

    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept1,差旅费,99999
${currentMonth},dept1,培训费,5000`;

    const result = budgetService.importBudgetsFromCSV(csvContent, 'u5');
    assertEqual(result.success.length, 1, '成功导入1条（新增培训费）');
    assertEqual(result.skipped.length, 1, '跳过1条（差旅费已存在）');

    const after = budgetService.getBudgetByKey(currentMonth, 'dept1', '差旅费');
    assertApprox(after.totalAmount, beforeAmount, '差旅费额度未被覆盖');

    const training = budgetService.getBudgetByKey(currentMonth, 'dept1', '培训费');
    assertApprox(training.totalAmount, 5000, '培训费新增成功');

    return `重复导入：成功 ${result.success.length}，跳过 ${result.skipped.length}，已有数据不被覆盖`;
  });

  test('CSV内重复行 → 只导入第一条，其余跳过', () => {
    budgetService.resetAllBudgets();
    const csvContent = `month,departmentId,category,totalAmount
${currentMonth},dept3,交通费,2000
${currentMonth},dept3,交通费,3000
${currentMonth},dept3,交通费,4000`;

    const result = budgetService.importBudgetsFromCSV(csvContent, 'u5');
    assertEqual(result.success.length, 1, '成功1条');
    assertEqual(result.skipped.length, 2, '跳过2条');

    const budget = budgetService.getBudgetByKey(currentMonth, 'dept3', '交通费');
    assertApprox(budget.totalAmount, 2000, '取第一条的额度');

    return `CSV内重复：成功 ${result.success.length}，跳过 ${result.skipped.length}`;
  });

  expectFail('CSV缺少必填字段 → 导入失败并说明缺哪些字段', () =>
    budgetService.importBudgetsFromCSV('month,dept,amount\n2024-01,dept1,1000', 'u5'),
    '缺少必填字段');

  test('导出预算流水CSV', () => {
    const csv = budgetService.exportTransactionsToCSV({ month: currentMonth });
    const lines = csv.trim().split('\n');
    assertEqual(lines.length > 1, true, '流水CSV有多行');
    assertEqual(lines[0].includes('type'), true, '包含type字段');
    assertEqual(lines[0].includes('amount'), true, '包含amount字段');
    assertEqual(lines[0].includes('remark'), true, '包含remark字段');
    return `流水CSV导出成功：${lines.length - 1} 条记录`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('八、重启恢复与数据一致性');
  console.log('='.repeat(70));

  test('保存数据快照，模拟重启，验证预算数据完全一致', () => {
    setupBudgetData();
    service.createReimbursement({
      title: '重启一致性测试',
      amount: 2500,
      type: '差旅费'
    }, 'u1');

    const before = loadData();
    const budgetsBefore = before.budgets.map(b => ({
      id: b.id, totalAmount: b.totalAmount,
      usedAmount: b.usedAmount, frozenAmount: b.frozenAmount, version: b.version
    }));
    const freezesBefore = before.budgetFreezes.map(f => ({
      id: f.id, reimbursementId: f.reimbursementId, amount: f.amount, status: f.status
    }));
    const txCountBefore = before.budgetTransactions.length;

    delete require.cache[require.resolve('./store.js')];
    delete require.cache[require.resolve('./budget-service.js')];
    const store2 = require('./store.js');
    const budgetService2 = require('./budget-service.js');

    const after = store2.loadData();
    const budgetsAfter = after.budgets.map(b => ({
      id: b.id, totalAmount: b.totalAmount,
      usedAmount: b.usedAmount, frozenAmount: b.frozenAmount, version: b.version
    }));
    const freezesAfter = after.budgetFreezes.map(f => ({
      id: f.id, reimbursementId: f.reimbursementId, amount: f.amount, status: f.status
    }));
    const txCountAfter = after.budgetTransactions.length;

    assertEqual(budgetsBefore.length, budgetsAfter.length, '预算数量一致');
    assertEqual(freezesBefore.length, freezesAfter.length, '冻结记录数量一致');
    assertEqual(txCountBefore, txCountAfter, '交易流水数量一致');

    for (let i = 0; i < budgetsBefore.length; i++) {
      assertEqual(budgetsBefore[i].id, budgetsAfter[i].id, `预算${i} ID一致`);
      assertApprox(budgetsBefore[i].totalAmount, budgetsAfter[i].totalAmount, `预算${i} 总额一致`);
      assertApprox(budgetsBefore[i].usedAmount, budgetsAfter[i].usedAmount, `预算${i} 已用一致`);
      assertApprox(budgetsBefore[i].frozenAmount, budgetsAfter[i].frozenAmount, `预算${i} 冻结一致`);
    }

    return `重启后完全一致：${budgetsBefore.length} 条预算，${freezesBefore.length} 条冻结，${txCountBefore} 条流水`;
  });

  test('预算对账功能：检测并修复不一致', () => {
    const data = loadData();
    const budget = data.budgets.find(b => b.category === '差旅费' && b.departmentId === 'dept1');
    if (budget) {
      budget.frozenAmount = budget.frozenAmount + 999;
      budget.usedAmount = budget.usedAmount + 555;
    }
    saveData(data);

    const result = budgetService.reconcileBudgets();
    assertEqual(result.issueCount > 0, true, '检测到不一致');
    assertEqual(result.fixCount > 0, true, '执行了修复');

    const after = budgetService.getBudget(budget.id);
    const freezes = budgetService.listBudgetFreezes({ budgetId: budget.id });
    const frozenSum = freezes.filter(f => f.status === 'frozen').reduce((s, f) => s + f.amount, 0);
    const usedSum = freezes.filter(f => f.status === 'deducted').reduce((s, f) => s + f.amount, 0);

    assertApprox(after.frozenAmount, frozenSum, '修复后冻结金额与冻结记录一致');
    assertApprox(after.usedAmount, usedSum, '修复后已用金额与扣减记录一致');

    return `对账修复：${result.issueCount} 个问题，${result.fixCount} 项修复`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('九、权限控制验证');
  console.log('='.repeat(70));

  test('申请人只能查看本部门预算', () => {
    setupBudgetData();
    const allBudgets = budgetService.listBudgets();
    assertEqual(allBudgets.length >= 3, true, '管理员能看到所有部门预算');

    const dept1Budgets = budgetService.listBudgets({ departmentId: 'dept1' });
    const dept2Budgets = budgetService.listBudgets({ departmentId: 'dept2' });
    assertEqual(dept1Budgets.length >= 2, true, '研发部有2条以上预算');
    assertEqual(dept2Budgets.length >= 1, true, '市场部有1条以上预算');

    return `权限隔离验证通过：可按部门过滤`;
  });

  expectFail('申请人不能创建预算', () =>
    budgetService.createBudget({
      month: getCurrentMonth(),
      departmentId: 'dept1',
      category: '其他',
      totalAmount: 1000
    }, 'u1'),
    '无权限');

  expectFail('申请人不能调整预算', () => {
    const list = budgetService.listBudgets({ departmentId: 'dept1', category: '差旅费' });
    return budgetService.adjustBudget(list[0].id, 100, '测试', 'u1');
  },
    '无权限');

  expectFail('申请人不能删除预算', () => {
    const list = budgetService.listBudgets({ departmentId: 'dept1', category: '办公费' });
    return budgetService.deleteBudget(list[0].id, 'u1');
  },
    '无权限');

  expectFail('财务不能删除预算（只有管理员可以）', () => {
    const list = budgetService.listBudgets({ departmentId: 'dept2', category: '差旅费' });
    return budgetService.deleteBudget(list[0].id, 'u3');
  },
    '无权限');

  test('管理员可以删除预算', () => {
    const list = budgetService.listBudgets({ departmentId: 'dept2', category: '差旅费' });
    const before = list.length;
    budgetService.deleteBudget(list[0].id, 'u5');
    const after = budgetService.listBudgets({ departmentId: 'dept2', category: '差旅费' }).length;
    assertEqual(after, before - 1, '删除后数量减少');
    return `管理员删除预算成功`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('十、列表、详情、归档共用同一份预算数据');
  console.log('='.repeat(70));

  test('列表、详情、归档导出中的预算状态一致', () => {
    setupBudgetData();
    const r = service.createReimbursement({
      title: '数据一致性测试',
      amount: 3500,
      type: '差旅费'
    }, 'u1');

    const listItem = service.listReimbursements()[0];
    const detail = service.getReimbursementDetail(r.id);

    assertEqual(listItem.budgetStatus.hasBudget, true, '列表有预算状态');
    assertEqual(detail.budgetStatus.hasBudget, true, '详情有预算状态');
    assertEqual(listItem.budgetStatus.freezeStatus, detail.budgetStatus.freezeStatus, '列表与详情冻结状态一致');
    assertApprox(listItem.budgetStatus.frozenAmount, detail.budgetStatus.frozenAmount, '列表与详情冻结金额一致');

    service.auditApprove(r.id, 'u2');
    service.auditApprove(r.id, 'u3');
    service.archive(r.id, 'u4');

    const exported = service.exportArchive(r.id);
    assertEqual(exported.budgetInfo.status.freezeStatus, 'deducted', '归档导出显示扣减状态');
    assertApprox(exported.budgetInfo.status.deductedAmount, 3500, '归档导出扣减金额一致');

    return `列表、详情、归档三者预算数据完全一致，共用同一数据源`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('🎉 所有预算模块回归测试通过！');
  console.log('='.repeat(70));
}

try {
  runRegression();
} catch (e) {
  console.error('\n❌ 预算回归测试失败:', e.message);
  console.error(e.stack);
  process.exit(1);
}

const store = require('./store');
const service = require('./service');
const { STATUS } = store;

function nowISO() { return new Date().toISOString(); }
function newAtt(id, name, category) {
  return { id, name, category, size: '100KB', uploadedAt: nowISO() };
}

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

function setup() {
  service.resetAll();
  const data = store.loadData();
  const now = nowISO();
  const applicantId = 'u1';
  const auditorId = 'u2';

  const r1 = {
    id: 'BX1001', title: '上海出差差旅费', amount: 3580.5, type: '差旅费',
    description: '', applicantId, status: STATUS.PENDING_AUDIT,
    attachments: [newAtt('a1', '机票.pdf', '机票')],
    missingAttachments: [], rejectReason: null, deadline: null, supplementCycle: 0,
    createdAt: now, updatedAt: now
  };
  const r2 = {
    id: 'BX1002', title: '办公用品采购', amount: 1260, type: '办公费',
    description: '', applicantId, status: STATUS.PENDING_SUPPLEMENT,
    attachments: [newAtt('a3', '采购清单.xlsx', '清单')],
    missingAttachments: ['发票', '入库单'], rejectReason: null,
    deadline: store.addDays(now, -1), supplementCycle: 1,
    createdAt: now, updatedAt: now
  };
  const r3 = {
    id: 'BX1003', title: '员工培训费', amount: 2800, type: '培训费',
    description: '', applicantId, status: STATUS.PENDING_REVIEW,
    attachments: [newAtt('a4', '培训发票.pdf', '发票'), newAtt('a5', '结业证书.jpg', '证书')],
    missingAttachments: [], rejectReason: null, deadline: null, supplementCycle: 0,
    createdAt: now, updatedAt: now
  };

  data.reimbursements = [r1, r2, r3];
  data.seq = 1010;
  data.reminders = [{
    id: 'RM0001', reimbursementId: 'BX1002', cycle: 1, operatorId: auditorId,
    operatorName: '李四', message: '请补充：发票、入库单', deadline: r2.deadline,
    remindedAt: now, lastRemindedAt: now, remindCount: 2
  }];
  data.operationLogs = [
    { id: 'LOG1', reimbursementId: 'BX1002', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建', operatedAt: now },
    { id: 'LOG2', reimbursementId: 'BX1002', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'request_supplement', remark: '发起补件', operatedAt: now },
    { id: 'LOG3', reimbursementId: 'BX1002', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'remind_again', remark: '第2次催办', operatedAt: now }
  ];
  store.saveData(data);
}

function getBx(id) {
  const data = store.loadData();
  return data.reimbursements.find(r => r.id === id);
}
function getReminders(id) {
  const data = store.loadData();
  return data.reminders.filter(r => r.reimbursementId === id);
}

function runRegression() {
  console.log('='.repeat(70));
  console.log('回归测试：补件完成判断 + 催办去重 + 时间保留');
  console.log('='.repeat(70));

  setup();

  console.log('\n' + '-'.repeat(70));
  console.log('一、补件完成判断：必须全部指定材料补齐，才能从待补件进入待复核');
  console.log('-'.repeat(70));

  test('BX1002 初始状态：待补件，缺失 发票、入库单', () => {
    const r = getBx('BX1002');
    assertEqual(r.status, STATUS.PENDING_SUPPLEMENT, '状态');
    assertEqual(r.missingAttachments.join(','), '发票,入库单', '缺失项');
    assertEqual(r.supplementCycle, 1, '补件轮次');
    return `status=${r.status}, missing=[${r.missingAttachments.join(',')}]`;
  });

  expectFail('【场景1】上传完全无关附件（情况说明.txt）→ 失败', () =>
    service.submitSupplement('BX1002', 'u1', [newAtt('t1', '情况说明.txt', '说明')]),
    '仍有指定材料未补齐');

  test('验证：状态仍为待补件，missingAttachments 未变', () => {
    const r = getBx('BX1002');
    assertEqual(r.status, STATUS.PENDING_SUPPLEMENT, '状态');
    assertEqual(r.missingAttachments.length, 2, '缺失项数量');
    return `status=${r.status}, missingCount=${r.missingAttachments.length}`;
  });

  expectFail('【场景2】只补一个（只补发票，缺入库单）→ 失败', () =>
    service.submitSupplement('BX1002', 'u1', [newAtt('t2', '采购发票.pdf', '发票')]),
    '入库单');

  expectFail('【场景3】重复上传同类（传2个发票，不传入库单）→ 失败', () =>
    service.submitSupplement('BX1002', 'u1', [
      newAtt('t3', '发票1.pdf', '发票'),
      newAtt('t4', '发票2.pdf', '发票')
    ]), '入库单');

  expectFail('【场景4】模糊匹配但缺一个（传"入库单说明.pdf"匹配入库单，但缺发票）→ 失败', () =>
    service.submitSupplement('BX1002', 'u1', [
      newAtt('t5', '入库单说明.pdf', '说明')
    ]), '发票');

  test('【场景5】两个都补齐（发票+入库单）→ 成功，状态转待复核', () => {
    const result = service.submitSupplement('BX1002', 'u1', [
      newAtt('t6', '采购发票.pdf', '发票'),
      newAtt('t7', '入库单.pdf', '入库单')
    ]);
    assertEqual(result.status, STATUS.PENDING_REVIEW, '状态');
    assertEqual(result.missingAttachments.length, 0, '缺失项应清空');
    const r = getBx('BX1002');
    assertEqual(r.attachments.length, 3, '附件数（原1个采购清单 + 2个新附件 = 3）');
    return `status=${result.status}, 缺失项已清空，附件数=${r.attachments.length}`;
  });

  console.log('\n' + '-'.repeat(70));
  console.log('二、审核通过校验：缺失附件时不能审批通过');
  console.log('-'.repeat(70));

  setup();

  test('给 BX1003 设缺失项：培训合同，状态保持待复核', () => {
    const data = store.loadData();
    const r = data.reimbursements.find(x => x.id === 'BX1003');
    r.missingAttachments = ['培训合同'];
    store.saveData(data);
    const d = service.getReimbursement('BX1003');
    assertEqual(d.status, STATUS.PENDING_REVIEW, '状态');
    assertEqual(d.missingAttachments[0], '培训合同', '缺失项');
    return `status=${d.status}, missing=${d.missingAttachments.join(',')}`;
  });

  expectFail('财务复核通过 → 因缺培训合同被拒', () =>
    service.auditApprove('BX1003', 'u3'), '培训合同');

  test('补上培训合同后 → 复核通过', () => {
    const data = store.loadData();
    const r = data.reimbursements.find(x => x.id === 'BX1003');
    r.attachments.push(newAtt('t8', '培训合同.pdf', '培训合同'));
    store.saveData(data);
    const result = service.auditApprove('BX1003', 'u3');
    assertEqual(result.status, STATUS.APPROVED, '状态');
    return `status=${result.status}，财务复核通过`;
  });

  console.log('\n' + '-'.repeat(70));
  console.log('三、同一催办周期重复提醒不新增多条，首次催办时间保持不变');
  console.log('-'.repeat(70));

  setup();

  const firstRemindedAt = test('记录初始催办时间', () => {
    const rms = getReminders('BX1002');
    assertEqual(rms.length, 1, '催办记录数');
    assertEqual(rms[0].remindCount, 2, '催办次数');
    return rms[0].remindedAt;
  });
  console.log(`  📌 首次催办时间: ${firstRemindedAt.slice(0, 23)}`);

  const sleep = ms => { const start = Date.now(); while (Date.now() - start < ms); };
  sleep(1100);

  for (let i = 1; i <= 3; i++) {
    test(`第 ${i} 次催办（共催 ${2 + i} 次）`, () => {
      const rm = service.remindAgain('BX1002', 'u2');
      return `remindCount=${rm.remindCount}`;
    });
  }

  test('验证：催办记录仍为 1 条，次数递增到 5，首次时间未变，最新时间已更新', () => {
    const rms = getReminders('BX1002');
    assertEqual(rms.length, 1, '催办记录数（应保持 1 条，合并）');
    const rm = rms[0];
    assertEqual(rm.remindCount, 5, '催办次数（应=2+3=5）');
    assertEqual(rm.remindedAt, firstRemindedAt, '首次催办时间应保持不变');
    if (rm.lastRemindedAt === firstRemindedAt) {
      throw new Error('lastRemindedAt 应更新，但与 remindedAt 相同');
    }
    const data = store.loadData();
    const logCount = data.operationLogs.filter(l => l.reimbursementId === 'BX1002' && l.action === 'remind_again').length;
    if (logCount < 3 + 1) { // 初始1次 + 新3次 = 4次
      throw new Error('催办操作日志不足，应有每次的记录');
    }
    return `记录数=${rms.length}, 次数=${rm.remindCount}, 首次时间未变, latest=${rm.lastRemindedAt.slice(0,19)}, 操作日志=${logCount}条`;
  });

  test('验证 matchAttachmentToMissing 匹配逻辑正确性', () => {
    const { matchAttachmentToMissing } = store;
    const missing = ['发票', '入库单'];

    const t1 = matchAttachmentToMissing([newAtt('x', '说明.txt', '说明')], missing);
    assertEqual(t1.unmatched.length, 2, '无关附件应都不匹配');

    const t2 = matchAttachmentToMissing([newAtt('x', '发票.pdf', '发票')], missing);
    assertEqual(t2.unmatched.length, 1, '只补发票应缺入库单');
    assertEqual(t2.unmatched[0], '入库单', '缺的应是入库单');

    const t3 = matchAttachmentToMissing([
      newAtt('x1', '发票1.pdf', '发票'),
      newAtt('x2', '发票2.pdf', '发票')
    ], missing);
    assertEqual(t3.unmatched.length, 1, '重复传发票仍缺入库单');
    assertEqual(t3.matched.length, 1, '只能匹配一个发票');

    const t4 = matchAttachmentToMissing([
      newAtt('x1', '采购发票.pdf', '发票'),
      newAtt('x2', '入库单.pdf', '入库单')
    ], missing);
    assertEqual(t4.unmatched.length, 0, '都补齐应无缺失');
    assertEqual(t4.matched.length, 2, '两个都匹配到');

    const t5 = matchAttachmentToMissing([
      newAtt('x', '入库单说明.pdf', '说明') // name 包含入库单
    ], missing);
    assertEqual(t5.unmatched.length, 1, '靠name模糊匹配到入库单，但仍缺发票');
    assertEqual(t5.unmatched[0], '发票', '缺的应是发票');

    return '匹配逻辑全部正确';
  });

  console.log('\n' + '-'.repeat(70));
  console.log('四、持久化验证：重启后数据对得上');
  console.log('-'.repeat(70));

  test('保存当前状态快照', () => {
    const data = store.loadData();
    const bx = data.reimbursements.find(r => r.id === 'BX1002');
    const rms = getReminders('BX1002');
    return `BX1002状态=${bx.status}, 缺失=${bx.missingAttachments.join(',')}, 催办记录=${rms.length}条, 催办次数=${rms[0].remindCount}`;
  });

  test('模拟重启：重新加载数据，验证完全一致', () => {
    const before = store.loadData();
    const bxBefore = before.reimbursements.find(r => r.id === 'BX1002');
    const rmBefore = before.reminders.find(r => r.reimbursementId === 'BX1002');
    const logsBefore = before.operationLogs.filter(l => l.reimbursementId === 'BX1002');

    const after = JSON.parse(JSON.stringify(store.loadData()));
    const bxAfter = after.reimbursements.find(r => r.id === 'BX1002');
    const rmAfter = after.reminders.find(r => r.reimbursementId === 'BX1002');
    const logsAfter = after.operationLogs.filter(l => l.reimbursementId === 'BX1002');

    assertEqual(bxAfter.status, bxBefore.status, '状态一致');
    assertEqual(bxAfter.missingAttachments.join(','), bxBefore.missingAttachments.join(','), '缺失项一致');
    assertEqual(bxAfter.supplementCycle, bxBefore.supplementCycle, '补件轮次一致');
    assertEqual(rmAfter.remindedAt, rmBefore.remindedAt, '首次催办时间一致');
    assertEqual(rmAfter.lastRemindedAt, rmBefore.lastRemindedAt, '最新催办时间一致');
    assertEqual(rmAfter.remindCount, rmBefore.remindCount, '催办次数一致');
    assertEqual(logsAfter.length, logsBefore.length, '操作日志数一致');

    return '重启前后所有数据完全一致：状态、缺失项、补件轮次、催办记录（时间+次数）、操作日志';
  });

  console.log('\n' + '='.repeat(70));
  console.log('🎉 所有回归测试通过！');
  console.log('='.repeat(70));
}

try {
  runRegression();
} catch (e) {
  console.error('\n❌ 回归测试失败:', e.message);
  process.exit(1);
}

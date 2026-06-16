const store = require('./store');
const service = require('./service');
const fs = require('fs');

const { STATUS, STATUS_LABEL, loadData, saveData, addDays, nowISO, normalizeData } = store;

function resetAll() {
  service.resetAll();
}

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

function getRaw(id) {
  const data = loadData();
  return data.reimbursements.find(r => r.id === id);
}

function setupFullFlowData() {
  resetAll();
  const data = loadData();
  const now = nowISO();

  const r1 = {
    id: 'BX3001', title: '北京出差差旅费', amount: 4500, type: '差旅费',
    description: '', applicantId: 'u1', status: STATUS.PENDING_SUPPLEMENT,
    attachments: [newAtt('a1', '机票.pdf', '机票')],
    missingAttachments: ['发票', '行程单'], rejectReason: null,
    deadline: addDays(now, 3), supplementCycle: 1,
    createdAt: now, updatedAt: now, version: 2
  };
  const r2 = {
    id: 'BX3002', title: '部门聚餐费', amount: 1200, type: '招待费',
    description: '', applicantId: 'u1', status: STATUS.PENDING_SUPPLEMENT,
    attachments: [],
    missingAttachments: ['发票'], rejectReason: null,
    deadline: addDays(now, 2), supplementCycle: 1,
    createdAt: now, updatedAt: now, version: 1
  };
  const r3 = {
    id: 'BX3003', title: '培训费报销', amount: 3000, type: '培训费',
    description: '', applicantId: 'u1', status: STATUS.PENDING_SUPPLEMENT,
    attachments: [newAtt('a2', '培训合同.pdf', '合同')],
    missingAttachments: ['发票'], rejectReason: null,
    deadline: addDays(now, -1), supplementCycle: 1,
    createdAt: now, updatedAt: now, version: 3
  };

  data.reimbursements = [r1, r2, r3];
  data.seq = 3010;
  data.reminders = [
    {
      id: 'RM3001', reimbursementId: 'BX3001', cycle: 1, operatorId: 'u2',
      operatorName: '李四', message: '请补充发票和行程单', deadline: r1.deadline,
      remindedAt: addDays(now, -2), lastRemindedAt: addDays(now, -1),
      remindCount: 2, lastRemindedBy: '李四',
      assigneeId: 'u1', assigneeName: '张三'
    },
    {
      id: 'RM3002', reimbursementId: 'BX3002', cycle: 1, operatorId: 'u3',
      operatorName: '王五', message: '请补充发票', deadline: r2.deadline,
      remindedAt: addDays(now, -1), lastRemindedAt: addDays(now, -1),
      remindCount: 1, lastRemindedBy: '王五',
      assigneeId: 'u1', assigneeName: '张三'
    },
    {
      id: 'RM3003', reimbursementId: 'BX3003', cycle: 1, operatorId: 'u2',
      operatorName: '李四', message: '请补充发票', deadline: r3.deadline,
      remindedAt: addDays(now, -3), lastRemindedAt: addDays(now, -1),
      remindCount: 3, lastRemindedBy: '李四',
      assigneeId: 'u1', assigneeName: '张三'
    }
  ];
  data.operationLogs = [
    { id: 'LOG3001', reimbursementId: 'BX3001', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建', operatedAt: addDays(now, -5) },
    { id: 'LOG3002', reimbursementId: 'BX3001', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'request_supplement', remark: '发起补件', operatedAt: addDays(now, -2) },
    { id: 'LOG3003', reimbursementId: 'BX3002', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建', operatedAt: addDays(now, -3) },
    { id: 'LOG3004', reimbursementId: 'BX3002', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'request_supplement', remark: '发起补件', operatedAt: addDays(now, -1) },
    { id: 'LOG3005', reimbursementId: 'BX3003', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建', operatedAt: addDays(now, -7) },
    { id: 'LOG3006', reimbursementId: 'BX3003', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'request_supplement', remark: '发起补件', operatedAt: addDays(now, -3) }
  ];

  saveData(data);
}

async function main() {
  console.log('='.repeat(70));
  console.log('回归测试：submitSupplement → confirmSupplementComplete 完整链路');
  console.log('='.repeat(70));

  console.log('\n' + '='.repeat(70));
  console.log('一、核心修复：申请人补件后状态保持待补件，不直接跳待复核');
  console.log('='.repeat(70));

  setupFullFlowData();

  test('申请人补齐全部材料后，状态保持 pending_supplement', () => {
    const r = getRaw('BX3002');
    assertEqual(r.status, STATUS.PENDING_SUPPLEMENT, '初始状态');
    assertEqual(r.missingAttachments.length, 1, '缺失1项');

    const result = service.submitSupplement('BX3002', 'u1', [
      newAtt('s1', '餐饮发票.pdf', '发票')
    ]);
    assertEqual(result.status, STATUS.PENDING_SUPPLEMENT, '提交后状态仍为待补件');
    assertEqual(result.missingAttachments.length, 0, '缺失项已清空');

    const rAfter = getRaw('BX3002');
    assertEqual(rAfter.status, STATUS.PENDING_SUPPLEMENT, '数据库中状态仍为待补件');
    assertEqual(rAfter.missingAttachments.length, 0, '数据库中缺失项已清空');
    assertEqual(rAfter.attachments.length, 1, '附件数=1');

    return `补件提交后：status=${result.status}, missing=[], 附件=${rAfter.attachments.length}个`;
  });

  test('提交补件后，财务确认补件完成 → 状态转 pending_review', () => {
    const result = service.confirmSupplementComplete('BX3002', 'u3');
    assertEqual(result.status, STATUS.PENDING_REVIEW, '确认后状态变为待复核');

    const rAfter = getRaw('BX3002');
    assertEqual(rAfter.status, STATUS.PENDING_REVIEW, '数据库中状态为待复核');
    assertEqual(rAfter.missingAttachments.length, 0, '缺失项保持清空');

    return `财务确认后：status=${result.status}, 状态正确流转到待复核`;
  });

  test('提交补件的操作日志包含"待财务确认"', () => {
    const data = loadData();
    const logs = data.operationLogs.filter(l => l.reimbursementId === 'BX3002');
    const submitLog = logs.find(l => l.action === 'submit_supplement');
    assertEqual(submitLog !== undefined, true, '存在submit_supplement日志');
    assertEqual(submitLog.remark.includes('待财务确认'), true, '日志包含待财务确认');

    const confirmLog = logs.find(l => l.action === 'confirm_supplement_complete');
    assertEqual(confirmLog !== undefined, true, '存在confirm_supplement_complete日志');

    return `日志正确：submit含"待财务确认"，confirm日志存在`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('二、材料不齐时财务确认失败');
  console.log('='.repeat(70));

  setupFullFlowData();

  expectFail('材料不齐时财务确认补件完成 → 失败', () =>
    service.confirmSupplementComplete('BX3001', 'u3'),
    '缺失附件');

  expectFail('申请人未补件时财务确认 → 失败', () =>
    service.confirmSupplementComplete('BX3002', 'u3'),
    '缺失附件');

  test('部分补件也不改变状态（submitSupplement仍要求全部补齐）', () => {
    const r = getRaw('BX3001');
    assertEqual(r.missingAttachments.length, 2, '缺失2项');

    try {
      service.submitSupplement('BX3001', 'u1', [
        newAtt('s2', '差旅发票.pdf', '发票')
      ]);
      throw new Error('部分补件不应成功');
    } catch (e) {
      if (!e.message.includes('未补齐')) {
        throw e;
      }
    }

    const rAfter = getRaw('BX3001');
    assertEqual(rAfter.status, STATUS.PENDING_SUPPLEMENT, '状态仍为待补件');
    assertEqual(rAfter.missingAttachments.length, 2, '缺失项不变');

    return '部分补件被拒绝，状态和缺失项不变';
  });

  console.log('\n' + '='.repeat(70));
  console.log('三、补件任务面板中待确认状态正确展示');
  console.log('='.repeat(70));

  setupFullFlowData();

  test('补件前：所有任务 missingAttachments 非空，pendingConfirm=false', () => {
    const tasks = service.listSupplementTasks();
    assertEqual(tasks.length, 3, '3条任务');
    tasks.forEach(t => {
      assertEqual(t.pendingConfirm, false, `${t.id} pendingConfirm应为false`);
      assertEqual(t.missingAttachments.length > 0, true, `${t.id} 缺失项非空`);
      assertEqual(t.statusLabel, '待补件', `${t.id} 状态标签应为待补件`);
    });
    return '所有任务均为待补件，缺失项非空';
  });

  test('申请人补齐材料后：pendingConfirm=true，标签显示待确认，排序最前', () => {
    service.submitSupplement('BX3002', 'u1', [
      newAtt('s3', '餐饮发票.pdf', '发票')
    ]);

    const tasks = service.listSupplementTasks();
    assertEqual(tasks.length, 3, '仍为3条任务（状态仍为pending_supplement）');

    const confirmed = tasks.find(t => t.id === 'BX3002');
    assertEqual(confirmed.pendingConfirm, true, 'pendingConfirm=true');
    assertEqual(confirmed.statusLabel, '待确认', '状态标签为待确认');
    assertEqual(confirmed.missingAttachments.length, 0, '缺失项为空');

    const notConfirmed = tasks.filter(t => t.id !== 'BX3002');
    notConfirmed.forEach(t => {
      assertEqual(t.pendingConfirm, false, `${t.id} pendingConfirm应为false`);
      assertEqual(t.statusLabel, '待补件', `${t.id} 状态标签应为待补件`);
    });

    assertEqual(tasks[0].id, 'BX3002', '待确认的任务排在最前面');

    return `待确认任务(BX3002)排在首位，标签=待确认，pendingConfirm=true`;
  });

  test('财务确认完成后：该任务从列表消失（不再是pending_supplement）', () => {
    service.confirmSupplementComplete('BX3002', 'u3');
    const tasks = service.listSupplementTasks();
    assertEqual(tasks.length, 2, '剩余2条任务');
    assertEqual(tasks.find(t => t.id === 'BX3002'), undefined, 'BX3002已不在补件任务列表');

    return '确认完成后任务从面板消失';
  });

  console.log('\n' + '='.repeat(70));
  console.log('四、完整链路：创建 → 补件 → 确认 → 复核 → 归档');
  console.log('='.repeat(70));

  resetAll();

  test('Step 1: 创建报销单', () => {
    const r = service.createReimbursement({
      title: '完整链路测试报销单', amount: 2000, type: '差旅费', description: '测试'
    }, 'u1');
    assertEqual(r.status, STATUS.PENDING_AUDIT, '初始状态为待审核');
    return `创建成功：${r.id}，status=${r.status}`;
  });

  let testId;
  test('Step 2: 审核员初审通过', () => {
    const list = service.listReimbursements();
    testId = list[0].id;
    const result = service.auditApprove(testId, 'u2');
    assertEqual(result.status, STATUS.PENDING_REVIEW, '初审通过→待复核');
    return `初审通过：status=${result.status}`;
  });

  test('Step 3: 财务发起补件', () => {
    const result = service.auditRequestSupplement(testId, 'u3', ['发票', '行程单'], 3);
    assertEqual(result.status, STATUS.PENDING_SUPPLEMENT, '发起补件→待补件');
    assertEqual(result.missingAttachments.length, 2, '缺失2项');
    return `发起补件：status=${result.status}，缺失=${result.missingAttachments.join('、')}`;
  });

  test('Step 4: 申请人补齐材料（状态保持待补件）', () => {
    const r = getRaw(testId);
    const result = service.submitSupplement(testId, 'u1', [
      newAtt('full1', '差旅发票.pdf', '发票'),
      newAtt('full2', '行程单.pdf', '行程单')
    ]);
    assertEqual(result.status, STATUS.PENDING_SUPPLEMENT, '提交后状态仍为待补件');
    assertEqual(result.missingAttachments.length, 0, '缺失项已清空');
    return `申请人补件完成：status=${result.status}，缺失已清空`;
  });

  test('Step 5: 财务确认补件完成 → 待复核', () => {
    const result = service.confirmSupplementComplete(testId, 'u3');
    assertEqual(result.status, STATUS.PENDING_REVIEW, '确认后→待复核');
    return `财务确认完成：status=${result.status}`;
  });

  test('Step 6: 财务复核通过', () => {
    const result = service.auditApprove(testId, 'u3');
    assertEqual(result.status, STATUS.APPROVED, '复核通过→已通过');
    return `复核通过：status=${result.status}`;
  });

  test('Step 7: 归档', () => {
    const result = service.archive(testId, 'u4');
    assertEqual(result.status, STATUS.ARCHIVED, '归档成功');
    return `归档成功：status=${result.status}`;
  });

  test('Step 8: 验证操作日志完整链路', () => {
    const detail = service.getReimbursementDetail(testId);
    const logs = detail.operationLogs;
    const coreActions = logs.filter(l => l.action !== 'round_status_change').map(l => l.action).reverse();

    assertEqual(coreActions[0], 'create', '第1步：创建');
    assertEqual(coreActions[1], 'approve_audit', '第2步：初审通过');
    assertEqual(coreActions[2], 'request_supplement', '第3步：发起补件');
    assertEqual(coreActions[3], 'submit_supplement', '第4步：提交补件');
    assertEqual(coreActions[4], 'confirm_supplement_complete', '第5步：确认补件完成');
    assertEqual(coreActions[5], 'approve_finance', '第6步：复核通过');
    assertEqual(coreActions[6], 'archive', '第7步：归档');

    const roundLogs = logs.filter(l => l.action === 'round_status_change');
    assertEqual(roundLogs.length >= 3, true, '每轮状态变更日志至少3条');

    const submitLog = logs.find(l => l.action === 'submit_supplement');
    assertEqual(submitLog.remark.includes('待财务确认'), true, '提交补件日志包含待财务确认');

    const confirmLog = logs.find(l => l.action === 'confirm_supplement_complete');
    assertEqual(confirmLog.remark.includes('待复核'), true, '确认补件完成日志包含待复核');

    return `核心日志完整：${coreActions.join(' → ')}，轮次变更日志${roundLogs.length}条`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('五、版本号在补件→确认链路中正确递增');
  console.log('='.repeat(70));

  setupFullFlowData();

  test('submitSupplement 递增版本号', () => {
    const vBefore = getRaw('BX3002').version;
    service.submitSupplement('BX3002', 'u1', [newAtt('v1', '餐饮发票.pdf', '发票')]);
    const vAfter = getRaw('BX3002').version;
    assertEqual(vAfter, vBefore + 1, '提交补件后版本+1');
    return `版本 v${vBefore} → v${vAfter}`;
  });

  test('confirmSupplementComplete 递增版本号', () => {
    const vBefore = getRaw('BX3002').version;
    service.confirmSupplementComplete('BX3002', 'u3');
    const vAfter = getRaw('BX3002').version;
    assertEqual(vAfter, vBefore + 1, '确认补件完成后版本+1');
    return `版本 v${vBefore} → v${vAfter}`;
  });

  test('乐观锁在补件→确认链路中有效', () => {
    const r = getRaw('BX3001');
    const version = r.version;

    service.remindAgain('BX3001', 'u3', version);

    try {
      service.confirmSupplementComplete('BX3001', 'u3', version);
      throw new Error('应检测到版本冲突');
    } catch (e) {
      if (!e.message.includes('版本冲突')) {
        throw e;
      }
    }

    return '乐观锁在补件确认链路中有效';
  });

  console.log('\n' + '='.repeat(70));
  console.log('六、重启后数据一致性（补件→确认链路）');
  console.log('='.repeat(70));

  setupFullFlowData();

  test('申请人补件后重启，状态和字段保持一致', () => {
    service.submitSupplement('BX3002', 'u1', [newAtt('rst1', '餐饮发票.pdf', '发票')]);

    const before = loadData();
    const bxBefore = before.reimbursements.find(r => r.id === 'BX3002');
    const logsBefore = before.operationLogs.filter(l => l.reimbursementId === 'BX3002');

    delete require.cache[require.resolve('./service.js')];
    delete require.cache[require.resolve('./store.js')];
    const store2 = require('./store.js');

    const after = store2.loadData();
    const bxAfter = after.reimbursements.find(r => r.id === 'BX3002');
    const logsAfter = after.operationLogs.filter(l => l.reimbursementId === 'BX3002');

    assertEqual(bxAfter.status, bxBefore.status, '状态一致（pending_supplement）');
    assertEqual(bxAfter.missingAttachments.length, bxBefore.missingAttachments.length, '缺失项一致');
    assertEqual(bxAfter.version, bxBefore.version, '版本号一致');
    assertEqual(bxAfter.attachments.length, bxBefore.attachments.length, '附件数一致');
    assertEqual(logsAfter.length, logsBefore.length, '日志数一致');

    return '重启后补件提交的数据完全一致';
  });

  test('财务确认后重启，状态和字段保持一致', () => {
    delete require.cache[require.resolve('./service.js')];
    delete require.cache[require.resolve('./store.js')];
    const service2 = require('./service.js');
    const store2 = require('./store.js');

    service2.confirmSupplementComplete('BX3002', 'u3');

    const before = store2.loadData();
    const bxBefore = before.reimbursements.find(r => r.id === 'BX3002');

    delete require.cache[require.resolve('./service.js')];
    delete require.cache[require.resolve('./store.js')];
    const store3 = require('./store.js');

    const after = store3.loadData();
    const bxAfter = after.reimbursements.find(r => r.id === 'BX3002');

    assertEqual(bxAfter.status, bxBefore.status, '状态一致（pending_review）');
    assertEqual(bxAfter.version, bxBefore.version, '版本号一致');
    assertEqual(bxAfter.missingAttachments.length, 0, '缺失项为空');

    return '重启后确认补件完成的数据完全一致';
  });

  console.log('\n' + '='.repeat(70));
  console.log('七、导出功能在补件→确认链路中的数据正确性');
  console.log('='.repeat(70));

  setupFullFlowData();

  test('完整链路归档导出：所有状态变更和日志都对得上', () => {
    service.submitSupplement('BX3002', 'u1', [newAtt('exp1', '餐饮发票.pdf', '发票')]);
    service.confirmSupplementComplete('BX3002', 'u3');

    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX3002');
    r.status = STATUS.APPROVED;
    saveData(data);
    service.archive('BX3002', 'u4');

    const exported = service.exportArchive('BX3002');
    const logs = exported.operationLogs;
    const actions = logs.map(l => l.action);

    assertEqual(actions.includes('submit_supplement'), true, '导出包含submit_supplement日志');
    assertEqual(actions.includes('confirm_supplement_complete'), true, '导出包含confirm_supplement_complete日志');

    const submitLog = logs.find(l => l.action === 'submit_supplement');
    assertEqual(submitLog.remark.includes('待财务确认'), true, '提交补件日志包含待财务确认');

    assertEqual(exported.reimbursement.version !== undefined, true, '导出包含version');
    assertEqual(exported.reimbursement.remindCount !== undefined, true, '导出包含remindCount');

    return `导出完整，包含submit+confirm日志，version=${exported.reimbursement.version}`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('八、旧数据兼容：缺少missingAttachments字段不报错');
  console.log('='.repeat(70));

  test('旧数据中pending_supplement单据缺少missingAttachments → normalizeData补全', () => {
    const oldData = {
      reimbursements: [{
        id: 'BX9001', title: '旧补件单', amount: 500, type: '差旅费',
        applicantId: 'u1', status: 'pending_supplement',
        attachments: [], createdAt: nowISO(), updatedAt: nowISO()
      }],
      reminders: [],
      operationLogs: [],
      seq: 9000
    };

    const normalized = normalizeData(oldData);
    const r = normalized.reimbursements[0];
    assertEqual(Array.isArray(r.missingAttachments), true, 'missingAttachments存在');
    assertEqual(r.missingAttachments.length, 0, '缺失项默认为空数组');
    assertEqual(r.version, 1, '版本号默认1');

    return '旧补件单数据normalize成功';
  });

  test('旧数据submit后再加载不报错', () => {
    const DATA_FILE = store.DATA_FILE;
    const backup = fs.readFileSync(DATA_FILE, 'utf8');
    try {
      const oldData = {
        reimbursements: [{
          id: 'BX9002', title: '测试', amount: 100, type: '差旅费',
          applicantId: 'u1', status: 'pending_supplement',
          attachments: [newAtt('old1', '发票.pdf', '发票')],
          missingAttachments: [],
          createdAt: nowISO(), updatedAt: nowISO(), version: 2
        }],
        reminders: [{
          id: 'RM9002', reimbursementId: 'BX9002', cycle: 1,
          operatorId: 'u2', operatorName: '李四', message: 'test',
          deadline: nowISO(), remindedAt: nowISO(), remindCount: 1
        }],
        operationLogs: [],
        seq: 9000
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(oldData, null, 2), 'utf8');

      const data = loadData();
      assertEqual(data.reimbursements[0].status, 'pending_supplement', '状态保持');
      assertEqual(data.reimbursements[0].missingAttachments.length, 0, '缺失项为空');

      const tasks = service.listSupplementTasks();
      assertEqual(tasks.length, 1, '任务列表包含1条');
      assertEqual(tasks[0].pendingConfirm, true, '缺失项为空→pendingConfirm=true');
      assertEqual(tasks[0].statusLabel, '待确认', '标签为待确认');

      return '旧数据加载后任务面板正确显示待确认';
    } finally {
      fs.writeFileSync(DATA_FILE, backup, 'utf8');
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log('🎉 所有补件→确认完整链路回归测试通过！');
  console.log('='.repeat(70));
}

main().catch(e => {
  console.error('\n❌ 测试失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});

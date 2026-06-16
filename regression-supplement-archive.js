const store = require('./store');
const service = require('./service');
const fs = require('fs');

const { STATUS, STATUS_LABEL, USERS, loadData, saveData, addDays, nowISO, normalizeData } = store;

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

function setupOldFormatMultiRoundData() {
  resetAll();
  const data = loadData();
  const now = nowISO();
  const applicantId = 'u1';
  const auditorId = 'u2';
  const financeId = 'u3';

  const r = {
    id: 'BX4001', title: '多轮补件归档测试', amount: 5000, type: '差旅费',
    description: '旧格式数据，无supplementRounds数组', applicantId,
    status: STATUS.ARCHIVED,
    attachments: [
      newAtt('a1', '机票.pdf', '机票'),
      newAtt('a2', '出差审批单.pdf', '审批单'),
      newAtt('a3', '餐饮发票.pdf', '发票')
    ],
    missingAttachments: [],
    rejectReason: null,
    deadline: null,
    supplementCycle: 2,
    lastSupplementAt: addDays(now, -2),
    createdAt: addDays(now, -20),
    updatedAt: now,
    version: 8,
    archivedAt: now,
    archivedBy: 'u4'
  };

  data.reimbursements = [r];
  data.seq = 4010;

  data.reminders = [
    {
      id: 'RM4001', reimbursementId: 'BX4001', cycle: 1, operatorId: auditorId,
      operatorName: '李四', message: '请补充以下附件：出差审批单',
      deadline: addDays(now, -15),
      remindedAt: addDays(now, -18), lastRemindedAt: addDays(now, -17),
      remindCount: 2, lastRemindedBy: '李四',
      assigneeId: applicantId, assigneeName: '张三'
    },
    {
      id: 'RM4002', reimbursementId: 'BX4001', cycle: 2, operatorId: financeId,
      operatorName: '王五', message: '请补充以下附件：餐饮发票',
      deadline: addDays(now, -5),
      remindedAt: addDays(now, -8), lastRemindedAt: addDays(now, -7),
      remindCount: 2, lastRemindedBy: '王五',
      assigneeId: applicantId, assigneeName: '张三'
    }
  ];

  data.operationLogs = [
    { id: 'LOG4001', reimbursementId: 'BX4001', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建报销单', operatedAt: addDays(now, -20) },
    { id: 'LOG4002', reimbursementId: 'BX4001', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'approve_audit', remark: '初审通过，进入财务复核', operatedAt: addDays(now, -19) },
    { id: 'LOG4003', reimbursementId: 'BX4001', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'request_supplement', remark: '[第1轮] 发起补件，缺失：出差审批单，截止：' + addDays(now, -15).slice(0, 10) + '，版本：v2→v3', operatedAt: addDays(now, -18) },
    { id: 'LOG4004', reimbursementId: 'BX4001', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'remind_again', remark: '第2次催办（同一补件周期，历史合并）', operatedAt: addDays(now, -17) },
    { id: 'LOG4005', reimbursementId: 'BX4001', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'submit_supplement', remark: '[第1轮] 提交补件材料：出差审批单.pdf，匹配到：出差审批单（已全部补齐，待财务确认），版本：v3→v4', operatedAt: addDays(now, -16) },
    { id: 'LOG4006', reimbursementId: 'BX4001', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'confirm_supplement_complete', remark: '[第1轮] 财务确认补件完成，进入待复核状态，版本：v4→v5', operatedAt: addDays(now, -15) },
    { id: 'LOG4007', reimbursementId: 'BX4001', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'request_supplement', remark: '[第2轮] 发起补件，缺失：餐饮发票，截止：' + addDays(now, -5).slice(0, 10) + '，版本：v5→v6', operatedAt: addDays(now, -8) },
    { id: 'LOG4008', reimbursementId: 'BX4001', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'remind_again', remark: '第2次催办（第2轮补件周期，历史合并）', operatedAt: addDays(now, -7) },
    { id: 'LOG4009', reimbursementId: 'BX4001', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'submit_supplement', remark: '[第2轮] 提交补件材料：餐饮发票.pdf，匹配到：餐饮发票（已全部补齐，待财务确认），版本：v6→v7', operatedAt: addDays(now, -5) },
    { id: 'LOG4010', reimbursementId: 'BX4001', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'confirm_supplement_complete', remark: '[第2轮] 财务确认补件完成，进入待复核状态，版本：v7→v8', operatedAt: addDays(now, -4) },
    { id: 'LOG4011', reimbursementId: 'BX4001', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'approve_finance', remark: '财务复核通过', operatedAt: addDays(now, -3) },
    { id: 'LOG4012', reimbursementId: 'BX4001', operatorId: 'u4', operatorName: '赵六', operatorRole: 'archiver', action: 'archive', remark: '已归档', operatedAt: now }
  ];

  saveData(data);
}

async function main() {
  console.log('='.repeat(70));
  console.log('回归测试：补件归档完整性 - 旧数据兼容 / 多轮历史 / 权限 / 日志追踪');
  console.log('='.repeat(70));

  console.log('\n' + '='.repeat(70));
  console.log('一、旧存量数据（无 supplementRounds）导入后重启再导出，每轮历史完整还原');
  console.log('='.repeat(70));

  setupOldFormatMultiRoundData();

  test('旧格式数据：buildSupplementRounds 能还原出2轮补件', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX4001');
    const rounds = service.buildSupplementRounds(r, data);
    assertEqual(rounds.length, 2, '应还原出2轮');
    return `还原出 ${rounds.length} 轮`;
  });

  test('旧格式数据：第1轮 - 发起人、提交人、确认人、结果、版本号全部正确', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX4001');
    const rounds = service.buildSupplementRounds(r, data);
    const r1 = rounds[0];
    assertEqual(r1.cycle, 1, '第1轮 cycle=1');
    assertEqual(r1.requestedByName, '李四', '第1轮发起人=李四');
    assertEqual(r1.missingAttachments.join(','), '出差审批单', '第1轮缺失=出差审批单');
    assertEqual(r1.submittedByName, '张三', '第1轮提交人=张三');
    assertEqual(r1.submittedAttachments.length, 1, '第1轮提交附件数=1');
    assertEqual(r1.confirmedByName, '王五', '第1轮确认人=王五');
    assertEqual(r1.confirmResult, 'passed', '第1轮确认结果=passed');
    assertEqual(r1.status, 'confirmed_passed', '第1轮状态=confirmed_passed');
    return `第1轮完整：发起=李四 提交=张三 确认=王五 结果=passed`;
  });

  test('旧格式数据：第2轮 - 发起人、提交人、确认人、结果、版本号全部正确', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX4001');
    const rounds = service.buildSupplementRounds(r, data);
    const r2 = rounds[1];
    assertEqual(r2.cycle, 2, '第2轮 cycle=2');
    assertEqual(r2.requestedByName, '王五', '第2轮发起人=王五');
    assertEqual(r2.missingAttachments.join(','), '餐饮发票', '第2轮缺失=餐饮发票');
    assertEqual(r2.submittedByName, '张三', '第2轮提交人=张三');
    assertEqual(r2.confirmedByName, '王五', '第2轮确认人=王五');
    assertEqual(r2.confirmResult, 'passed', '第2轮确认结果=passed');
    assertEqual(r2.status, 'confirmed_passed', '第2轮状态=confirmed_passed');
    return `第2轮完整：发起=王五 提交=张三 确认=王五 结果=passed`;
  });

  test('旧格式数据：第1轮确认人不是第2轮发起人（不串轮）', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX4001');
    const rounds = service.buildSupplementRounds(r, data);
    assertEqual(rounds[0].confirmedByName, '王五', '第1轮确认人=王五');
    assertEqual(rounds[1].requestedByName, '王五', '第2轮发起人=王五');
    assertEqual(rounds[0].submittedAttachments[0].name, '出差审批单.pdf', '第1轮附件名不串');
    assertEqual(rounds[1].submittedAttachments[0].name, '餐饮发票.pdf', '第2轮附件名不串');
    return '轮次数据未串轮';
  });

  test('旧格式数据：导出归档后每轮数据完整', () => {
    const exported = service.exportArchive('BX4001');
    const cycles = exported.supplementSummary.cycles;
    assertEqual(cycles.length, 2, '导出包含2轮');
    assertEqual(cycles[0].requestedByName, '李四', '导出第1轮发起人=李四');
    assertEqual(cycles[0].submittedByName, '张三', '导出第1轮提交人=张三');
    assertEqual(cycles[0].confirmedByName, '王五', '导出第1轮确认人=王五');
    assertEqual(cycles[0].confirmResult, 'passed', '导出第1轮结果=passed');
    assertEqual(cycles[1].requestedByName, '王五', '导出第2轮发起人=王五');
    assertEqual(cycles[1].submittedByName, '张三', '导出第2轮提交人=张三');
    assertEqual(cycles[1].confirmedByName, '王五', '导出第2轮确认人=王五');
    assertEqual(cycles[1].confirmResult, 'passed', '导出第2轮结果=passed');
    return '导出每轮数据完整';
  });

  test('旧格式数据：模拟重启（清require缓存后重新加载），导出仍完整', () => {
    const beforeExport = service.exportArchive('BX4001');

    delete require.cache[require.resolve('./service.js')];
    delete require.cache[require.resolve('./store.js')];
    const service2 = require('./service.js');

    const afterExport = service2.exportArchive('BX4001');
    assertEqual(afterExport.supplementSummary.cycles.length, beforeExport.supplementSummary.cycles.length, '重启后轮次数一致');
    for (let i = 0; i < afterExport.supplementSummary.cycles.length; i++) {
      const before = beforeExport.supplementSummary.cycles[i];
      const after = afterExport.supplementSummary.cycles[i];
      assertEqual(after.requestedByName, before.requestedByName, `重启后第${i + 1}轮发起人一致`);
      assertEqual(after.submittedByName, before.submittedByName, `重启后第${i + 1}轮提交人一致`);
      assertEqual(after.confirmedByName, before.confirmedByName, `重启后第${i + 1}轮确认人一致`);
      assertEqual(after.confirmResult, before.confirmResult, `重启后第${i + 1}轮结果一致`);
      assertEqual(after.status, before.status, `重启后第${i + 1}轮状态一致`);
    }
    return '重启后导出数据完整一致';
  });

  console.log('\n' + '='.repeat(70));
  console.log('二、列表 / 详情 / 导出 三处共用 buildSupplementRounds 数据源');
  console.log('='.repeat(70));

  setupOldFormatMultiRoundData();

  test('列表页 supplementRounds 与导出 supplementSummary.cycles 数据一致', () => {
    delete require.cache[require.resolve('./service.js')];
    delete require.cache[require.resolve('./store.js')];
    const svc = require('./service.js');

    const list = svc.listReimbursements();
    const listItem = list.find(x => x.id === 'BX4001');
    const detail = svc.getReimbursementDetail('BX4001');
    const exported = svc.exportArchive('BX4001');

    const listRounds = listItem.supplementRounds;
    const detailRounds = detail.supplementRounds;
    const exportCycles = exported.supplementSummary.cycles;

    assertEqual(listRounds.length, detailRounds.length, '列表与详情轮次数一致');
    assertEqual(listRounds.length, exportCycles.length, '列表与导出轮次数一致');

    for (let i = 0; i < listRounds.length; i++) {
      assertEqual(listRounds[i].cycle, detailRounds[i].cycle, `第${i + 1}轮 cycle 一致`);
      assertEqual(listRounds[i].cycle, exportCycles[i].cycle, `第${i + 1}轮导出 cycle 一致`);
      assertEqual(listRounds[i].requestedByName, detailRounds[i].requestedByName, `第${i + 1}轮发起人一致`);
      assertEqual(listRounds[i].requestedByName, exportCycles[i].requestedByName, `第${i + 1}轮导出发起人一致`);
      assertEqual(listRounds[i].submittedByName, detailRounds[i].submittedByName, `第${i + 1}轮提交人一致`);
      assertEqual(listRounds[i].submittedByName, exportCycles[i].submittedByName, `第${i + 1}轮导出提交人一致`);
      assertEqual(listRounds[i].confirmedByName, detailRounds[i].confirmedByName, `第${i + 1}轮确认人一致`);
      assertEqual(listRounds[i].confirmedByName, exportCycles[i].confirmedByName, `第${i + 1}轮导出确认人一致`);
      assertEqual(listRounds[i].confirmResult, detailRounds[i].confirmResult, `第${i + 1}轮结果一致`);
      assertEqual(listRounds[i].confirmResult, exportCycles[i].confirmResult, `第${i + 1}轮导出结果一致`);
    }
    return '列表/详情/导出 三处轮次数据完全一致';
  });

  console.log('\n' + '='.repeat(70));
  console.log('三、确认权限：仅财务可确认补件完成，审核员不能代替');
  console.log('='.repeat(70));

  resetAll();

  test('创建报销单并走完一轮补件', () => {
    const r = service.createReimbursement({
      title: '权限测试报销单', amount: 1000, type: '差旅费', description: '测试'
    }, 'u1');
    service.auditRequestSupplement(r.id, 'u2', ['发票'], 3);
    service.submitSupplement(r.id, 'u1', [newAtt('perm1', '发票.pdf', '发票')]);
    return `单据 ${r.id} 已提交补件，待确认`;
  });

  expectFail('审核员(u2)不能确认补件完成', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.status === STATUS.PENDING_SUPPLEMENT);
    service.confirmSupplementComplete(r.id, 'u2');
  }, '无权限');

  expectFail('申请人(u1)不能确认补件完成', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.status === STATUS.PENDING_SUPPLEMENT);
    service.confirmSupplementComplete(r.id, 'u1');
  }, '无权限');

  expectFail('归档员(u4)不能确认补件完成', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.status === STATUS.PENDING_SUPPLEMENT);
    service.confirmSupplementComplete(r.id, 'u4');
  }, '无权限');

  test('财务(u3)可以确认补件完成', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.status === STATUS.PENDING_SUPPLEMENT);
    const result = service.confirmSupplementComplete(r.id, 'u3');
    assertEqual(result.status, STATUS.PENDING_REVIEW, '确认后状态=待复核');
    return '财务确认成功';
  });

  console.log('\n' + '='.repeat(70));
  console.log('四、连续补件2轮以上，导出每轮提交内容、确认人、确认时间、版本号不丢');
  console.log('='.repeat(70));

  resetAll();

  const testId = test('创建报销单', () => {
    const r = service.createReimbursement({
      title: '连续补件测试', amount: 3000, type: '差旅费', description: '2轮以上'
    }, 'u1');
    return r.id;
  });

  test('第1轮：审核员发起补件（缺：审批单）', () => {
    const r = getRaw(testId);
    return service.auditRequestSupplement(testId, 'u2', ['审批单'], 3, r.version).supplementCycle;
  });

  test('第1轮：申请人提交补件', () => {
    const r = getRaw(testId);
    service.submitSupplement(testId, 'u1', [newAtt('c1', '审批单.pdf', '审批单')], r.version);
    return '提交成功';
  });

  test('第1轮：财务确认补件完成', () => {
    const r = getRaw(testId);
    service.confirmSupplementComplete(testId, 'u3', r.version);
    return '确认成功';
  });

  const vAfterR1 = getRaw(testId).version;

  test('第2轮：财务发起补件（缺：发票）', () => {
    const r = getRaw(testId);
    return service.auditRequestSupplement(testId, 'u3', ['发票'], 2, r.version).supplementCycle;
  });

  test('第2轮：申请人提交补件', () => {
    const r = getRaw(testId);
    service.submitSupplement(testId, 'u1', [newAtt('c2', '发票.pdf', '发票')], r.version);
    return '提交成功';
  });

  test('第2轮：财务确认补件完成', () => {
    const r = getRaw(testId);
    service.confirmSupplementComplete(testId, 'u3', r.version);
    return '确认成功';
  });

  test('第3轮：审核员再次发起补件（缺：行程单）', () => {
    const r = getRaw(testId);
    return service.auditRequestSupplement(testId, 'u2', ['行程单'], 3, r.version).supplementCycle;
  });

  test('第3轮：申请人提交补件', () => {
    const r = getRaw(testId);
    service.submitSupplement(testId, 'u1', [newAtt('c3', '行程单.pdf', '行程单')], r.version);
    return '提交成功';
  });

  test('第3轮：财务确认补件完成', () => {
    const r = getRaw(testId);
    service.confirmSupplementComplete(testId, 'u3', r.version);
    return '确认成功';
  });

  test('3轮补件后，轮次数组长度=3，每轮状态=confirmed_passed', () => {
    const detail = service.getReimbursementDetail(testId);
    assertEqual(detail.supplementRounds.length, 3, '3轮');
    detail.supplementRounds.forEach((rd, i) => {
      assertEqual(rd.status, 'confirmed_passed', `第${i + 1}轮状态=confirmed_passed`);
    });
    return '3轮全部确认通过';
  });

  test('3轮补件后，版本号严格递增，每轮 versionAtSubmit 和 versionAtConfirm 有值', () => {
    const detail = service.getReimbursementDetail(testId);
    const rounds = detail.supplementRounds;
    for (let i = 0; i < rounds.length; i++) {
      assertEqual(rounds[i].versionAtSubmit !== null, true, `第${i + 1}轮 versionAtSubmit 有值`);
      assertEqual(rounds[i].versionAtConfirm !== null, true, `第${i + 1}轮 versionAtConfirm 有值`);
      if (i > 0) {
        assertEqual(rounds[i].versionAtSubmit > rounds[i - 1].versionAtConfirm, true, `第${i + 1}轮提交版本 > 第${i}轮确认版本`);
      }
    }
    return '版本号严格递增，每轮快照完整';
  });

  test('3轮补件后，归档导出每轮提交内容、确认人、确认时间、确认结论完整', () => {
    service.auditApprove(testId, 'u3');
    service.archive(testId, 'u4');

    const exported = service.exportArchive(testId);
    const cycles = exported.supplementSummary.cycles;
    assertEqual(cycles.length, 3, '导出3轮');

    assertEqual(cycles[0].missingAttachments.join(','), '审批单', '第1轮缺失=审批单');
    assertEqual(cycles[0].submittedAttachments.length, 1, '第1轮提交附件数=1');
    assertEqual(cycles[0].submittedAttachments[0].name, '审批单.pdf', '第1轮附件名=审批单.pdf');
    assertEqual(cycles[0].confirmedByName, '王五', '第1轮确认人=王五');
    assertEqual(cycles[0].confirmedAt !== null, true, '第1轮确认时间有值');
    assertEqual(cycles[0].confirmResult, 'passed', '第1轮确认结论=passed');

    assertEqual(cycles[1].missingAttachments.join(','), '发票', '第2轮缺失=发票');
    assertEqual(cycles[1].submittedAttachments.length, 1, '第2轮提交附件数=1');
    assertEqual(cycles[1].submittedAttachments[0].name, '发票.pdf', '第2轮附件名=发票.pdf');
    assertEqual(cycles[1].confirmedByName, '王五', '第2轮确认人=王五');
    assertEqual(cycles[1].confirmedAt !== null, true, '第2轮确认时间有值');
    assertEqual(cycles[1].confirmResult, 'passed', '第2轮确认结论=passed');

    assertEqual(cycles[2].missingAttachments.join(','), '行程单', '第3轮缺失=行程单');
    assertEqual(cycles[2].submittedAttachments.length, 1, '第3轮提交附件数=1');
    assertEqual(cycles[2].submittedAttachments[0].name, '行程单.pdf', '第3轮附件名=行程单.pdf');
    assertEqual(cycles[2].confirmedByName, '王五', '第3轮确认人=王五');
    assertEqual(cycles[2].confirmedAt !== null, true, '第3轮确认时间有值');
    assertEqual(cycles[2].confirmResult, 'passed', '第3轮确认结论=passed');

    return '导出3轮数据完整，不串轮、不丢版本';
  });

  console.log('\n' + '='.repeat(70));
  console.log('五、连续补件后删除 supplementRounds 回旧格式，重启再导出仍完整');
  console.log('='.repeat(70));

  test('3轮补件数据切回旧格式后重启，导出每轮数据仍正确', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.id === testId);
    assertEqual(r.supplementRounds.length, 3, '切前有3轮');

    r.supplementRounds = [];
    saveData(data);

    delete require.cache[require.resolve('./service.js')];
    delete require.cache[require.resolve('./store.js')];
    const svc = require('./service.js');

    const exported = svc.exportArchive(testId);
    const cycles = exported.supplementSummary.cycles;
    assertEqual(cycles.length, 3, '切回旧格式后导出仍3轮');
    assertEqual(cycles[0].requestedByName, '李四', '第1轮发起人仍=李四');
    assertEqual(cycles[0].submittedByName, '张三', '第1轮提交人仍=张三');
    assertEqual(cycles[0].confirmedByName, '王五', '第1轮确认人仍=王五');
    assertEqual(cycles[0].confirmResult, 'passed', '第1轮结果仍=passed');
    assertEqual(cycles[1].requestedByName, '王五', '第2轮发起人仍=王五');
    assertEqual(cycles[1].submittedByName, '张三', '第2轮提交人仍=张三');
    assertEqual(cycles[1].confirmedByName, '王五', '第2轮确认人仍=王五');
    assertEqual(cycles[2].missingAttachments.join(','), '行程单', '第3轮缺失仍=行程单');
    assertEqual(cycles[2].submittedAttachments[0].name, '行程单.pdf', '第3轮附件名仍=行程单.pdf');
    assertEqual(cycles[2].confirmedByName, '王五', '第3轮确认人仍=王五');

    return '切回旧格式重启后导出每轮数据完整';
  });

  console.log('\n' + '='.repeat(70));
  console.log('六、并发确认冲突保护');
  console.log('='.repeat(70));

  resetAll();

  test('并发确认：两人同时确认同一单据，后者因版本冲突被拒绝', () => {
    const r = service.createReimbursement({
      title: '并发确认测试', amount: 2000, type: '差旅费', description: '并发'
    }, 'u1');
    service.auditRequestSupplement(r.id, 'u2', ['发票'], 3);
    service.submitSupplement(r.id, 'u1', [newAtt('cc1', '发票.pdf', '发票')]);

    const raw = getRaw(r.id);
    const version = raw.version;

    service.confirmSupplementComplete(r.id, 'u3', version);

    try {
      service.confirmSupplementComplete(r.id, 'u3', version);
      throw new Error('第二次确认应被版本冲突拒绝');
    } catch (e) {
      if (!e.message.includes('版本冲突')) {
        throw e;
      }
    }

    return '并发确认保护正常，第二次被版本冲突拒绝';
  });

  test('并发：提交补件与确认同时操作，后者被版本冲突拒绝', () => {
    const r2 = service.createReimbursement({
      title: '并发测试2', amount: 1500, type: '差旅费', description: '并发2'
    }, 'u1');
    service.auditRequestSupplement(r2.id, 'u2', ['发票', '审批单'], 3);

    const raw = getRaw(r2.id);
    const version = raw.version;

    service.submitSupplement(r2.id, 'u1', [
      newAtt('cc2', '发票.pdf', '发票'),
      newAtt('cc3', '审批单.pdf', '审批单')
    ], version);

    try {
      service.confirmSupplementComplete(r2.id, 'u3', version);
      throw new Error('确认应被版本冲突拒绝');
    } catch (e) {
      if (!e.message.includes('版本冲突')) {
        throw e;
      }
    }

    return '提交与确认并发保护正常';
  });

  console.log('\n' + '='.repeat(70));
  console.log('七、轮次状态变更日志追踪');
  console.log('='.repeat(70));

  resetAll();

  test('完整链路操作后，round_status_change 日志覆盖每轮状态变化', () => {
    const r = service.createReimbursement({
      title: '日志追踪测试', amount: 2500, type: '差旅费', description: '追踪'
    }, 'u1');

    service.auditRequestSupplement(r.id, 'u2', ['发票'], 3);
    service.submitSupplement(r.id, 'u1', [newAtt('lt1', '发票.pdf', '发票')]);
    service.confirmSupplementComplete(r.id, 'u3');

    const data = loadData();
    const logs = data.operationLogs.filter(l =>
      l.reimbursementId === r.id && l.action === 'round_status_change'
    );

    assertEqual(logs.length, 3, '应有3条 round_status_change 日志');

    const statuses = logs.map(l => {
      const m = l.remark.match(/→ (\w+)/);
      return m ? m[1] : '';
    });
    assertEqual(statuses[0], 'requested', '第1条：→ requested');
    assertEqual(statuses[1], 'submitted', '第2条：→ submitted');
    assertEqual(statuses[2], 'confirmed_passed', '第3条：→ confirmed_passed');

    for (const log of logs) {
      assertEqual(log.remark.includes('[第1轮]'), true, '日志包含轮次标注');
    }

    return `3条 round_status_change 日志：${statuses.join(' → ')}`;
  });

  test('多轮补件，round_status_change 日志按轮次正确区分', () => {
    const r = service.createReimbursement({
      title: '多轮日志测试', amount: 1800, type: '差旅费', description: '多轮'
    }, 'u1');

    service.auditRequestSupplement(r.id, 'u2', ['发票'], 3);
    service.submitSupplement(r.id, 'u1', [newAtt('ml1', '发票.pdf', '发票')]);
    service.confirmSupplementComplete(r.id, 'u3');

    service.auditRequestSupplement(r.id, 'u3', ['合同'], 2);
    service.submitSupplement(r.id, 'u1', [newAtt('ml2', '合同.pdf', '合同')]);
    service.confirmSupplementComplete(r.id, 'u3');

    const data = loadData();
    const logs = data.operationLogs.filter(l =>
      l.reimbursementId === r.id && l.action === 'round_status_change'
    );

    assertEqual(logs.length, 6, '2轮×3=6条 round_status_change 日志');

    const r1Logs = logs.filter(l => l.remark.includes('[第1轮]'));
    const r2Logs = logs.filter(l => l.remark.includes('[第2轮]'));
    assertEqual(r1Logs.length, 3, '第1轮3条状态变更');
    assertEqual(r2Logs.length, 3, '第2轮3条状态变更');

    return `6条 round_status_change 日志，第1轮3条 第2轮3条`;
  });

  test('驳回时 round_status_change 日志记录 confirmed_rejected', () => {
    resetAll();
    const r = service.createReimbursement({
      title: '驳回日志测试', amount: 900, type: '招待费', description: '驳回'
    }, 'u1');
    service.auditRequestSupplement(r.id, 'u2', ['发票'], 3);
    service.submitSupplement(r.id, 'u1', [newAtt('rj1', '发票.pdf', '发票')]);
    service.auditReject(r.id, 'u3', '发票不合规');

    const data = loadData();
    const logs = data.operationLogs.filter(l =>
      l.reimbursementId === r.id && l.action === 'round_status_change'
    );
    const rejectLog = logs.find(l => l.remark.includes('confirmed_rejected'));
    assertEqual(rejectLog !== undefined, true, '存在 confirmed_rejected 状态变更日志');
    assertEqual(rejectLog.remark.includes('驳回人'), true, '日志包含驳回人');

    return '驳回 round_status_change 日志记录正确';
  });

  console.log('\n' + '='.repeat(70));
  console.log('八、parseCycleFromRemark 工具函数验证');
  console.log('='.repeat(70));

  test('parseCycleFromRemark 正确解析轮次', () => {
    const svc = require('./service.js');
    assertEqual(svc.parseCycleFromRemark('[第1轮] 发起补件'), 1, '解析第1轮');
    assertEqual(svc.parseCycleFromRemark('[第2轮] 提交补件材料'), 2, '解析第2轮');
    assertEqual(svc.parseCycleFromRemark('[第10轮] 确认'), 10, '解析第10轮');
    assertEqual(svc.parseCycleFromRemark('没有轮次标注'), null, '无轮次标注返回null');
    assertEqual(svc.parseCycleFromRemark(null), null, 'null返回null');
    assertEqual(svc.parseCycleFromRemark(''), null, '空字符串返回null');
    return 'parseCycleFromRemark 全部正确';
  });

  console.log('\n' + '='.repeat(70));
  console.log('🎉 所有补件归档完整性回归测试通过！');
  console.log('='.repeat(70));
}

main().catch(e => {
  console.error('\n❌ 测试失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});

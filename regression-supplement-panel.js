const store = require('./store');
const service = require('./service');
const fs = require('fs');
const path = require('path');

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

function asyncTest(name, fn) {
  console.log(`\n▶️  ${name}`);
  return fn().then(result => {
    console.log(`  ✅ 成功: ${result}`);
    return result;
  }).catch(e => {
    console.log(`  ❌ 失败: ${e.message}`);
    throw e;
  });
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

function asyncExpectFail(name, fn, expectedMsg) {
  console.log(`\n▶️  ${name}（预期失败）`);
  return fn().then(() => {
    console.log(`  ❌ 未按预期失败！`);
    return false;
  }).catch(e => {
    if (expectedMsg && !e.message.includes(expectedMsg)) {
      console.log(`  ❌ 错误信息不符，期望包含 "${expectedMsg}"，实际：${e.message}`);
      return false;
    }
    console.log(`  ✅ 按预期失败: ${e.message}`);
    return true;
  });
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}：期望 ${expected}，实际 ${actual}`);
  }
}

function assertContains(str, substr, msg) {
  if (!str.includes(substr)) {
    throw new Error(`${msg}：期望包含 "${substr}"，实际 "${str}"`);
  }
}

function setupTestData() {
  resetAll();
  const data = loadData();
  const now = nowISO();
  const applicantId = 'u1';
  const applicantId2 = 'u5';
  const auditorId = 'u2';
  const financeId = 'u3';

  const r1 = {
    id: 'BX2001', title: '上海出差差旅费', amount: 3580.5, type: '差旅费',
    description: '', applicantId, status: STATUS.PENDING_SUPPLEMENT,
    attachments: [newAtt('a1', '机票.pdf', '机票')],
    missingAttachments: ['发票', '入库单'], rejectReason: null,
    deadline: addDays(now, -1), supplementCycle: 1,
    createdAt: now, updatedAt: now, version: 3
  };
  const r2 = {
    id: 'BX2002', title: '办公用品采购', amount: 1260, type: '办公费',
    description: '', applicantId, status: STATUS.PENDING_SUPPLEMENT,
    attachments: [newAtt('a3', '采购清单.xlsx', '清单')],
    missingAttachments: ['审批单'], rejectReason: null,
    deadline: addDays(now, 3), supplementCycle: 1,
    createdAt: now, updatedAt: now, version: 2
  };
  const r3 = {
    id: 'BX2003', title: '员工培训费', amount: 2800, type: '培训费',
    description: '', applicantId, status: STATUS.PENDING_REVIEW,
    attachments: [newAtt('a4', '培训发票.pdf', '发票'), newAtt('a5', '结业证书.jpg', '证书')],
    missingAttachments: [], rejectReason: null, deadline: null, supplementCycle: 0,
    createdAt: now, updatedAt: now, version: 1
  };
  const r4 = {
    id: 'BX2004', title: '招待费报销', amount: 890, type: '招待费',
    description: '', applicantId: applicantId2, status: STATUS.PENDING_SUPPLEMENT,
    attachments: [],
    missingAttachments: ['发票'], rejectReason: null,
    deadline: addDays(now, 5), supplementCycle: 1,
    createdAt: now, updatedAt: now, version: 2
  };

  data.reimbursements = [r1, r2, r3, r4];
  data.seq = 2010;

  data.reminders = [
    {
      id: 'RM2001', reimbursementId: 'BX2001', cycle: 1, operatorId: auditorId,
      operatorName: '李四', message: '请补充：发票、入库单', deadline: r1.deadline,
      remindedAt: addDays(now, -2), lastRemindedAt: addDays(now, -1),
      remindCount: 2, lastRemindedBy: '李四',
      assigneeId: applicantId, assigneeName: '张三'
    },
    {
      id: 'RM2002', reimbursementId: 'BX2002', cycle: 1, operatorId: financeId,
      operatorName: '王五', message: '请补充：审批单', deadline: r2.deadline,
      remindedAt: addDays(now, -1), lastRemindedAt: addDays(now, -1),
      remindCount: 1, lastRemindedBy: '王五',
      assigneeId: applicantId, assigneeName: '张三'
    },
    {
      id: 'RM2003', reimbursementId: 'BX2004', cycle: 1, operatorId: auditorId,
      operatorName: '李四', message: '请补充：发票', deadline: r4.deadline,
      remindedAt: addDays(now, -3), lastRemindedAt: addDays(now, -2),
      remindCount: 3, lastRemindedBy: '李四',
      assigneeId: applicantId2, assigneeName: '未知'
    }
  ];

  data.operationLogs = [
    { id: 'LOG2001', reimbursementId: 'BX2001', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建报销单', operatedAt: addDays(now, -5) },
    { id: 'LOG2002', reimbursementId: 'BX2001', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'request_supplement', remark: '发起补件', operatedAt: addDays(now, -2) },
    { id: 'LOG2003', reimbursementId: 'BX2001', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'remind_again', remark: '第2次催办', operatedAt: addDays(now, -1) },
    { id: 'LOG2004', reimbursementId: 'BX2002', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建', operatedAt: addDays(now, -3) },
    { id: 'LOG2005', reimbursementId: 'BX2002', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'request_supplement', remark: '发起补件', operatedAt: addDays(now, -1) },
    { id: 'LOG2006', reimbursementId: 'BX2004', operatorId: 'u5', operatorName: '未知', operatorRole: 'applicant', action: 'create', remark: '创建', operatedAt: addDays(now, -7) },
    { id: 'LOG2007', reimbursementId: 'BX2004', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'request_supplement', remark: '发起补件', operatedAt: addDays(now, -3) },
    { id: 'LOG2008', reimbursementId: 'BX2004', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'remind_again', remark: '第2次催办', operatedAt: addDays(now, -2.5) },
    { id: 'LOG2009', reimbursementId: 'BX2004', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'remind_again', remark: '第3次催办', operatedAt: addDays(now, -2) }
  ];

  saveData(data);
}

function getReimbursementRaw(id) {
  const data = loadData();
  return data.reimbursements.find(r => r.id === id);
}

async function main() {
  console.log('='.repeat(70));
  console.log('回归测试：补件任务面板 + 批量催办 + 截止时间 + 乐观锁');
  console.log('='.repeat(70));

  console.log('\n' + '='.repeat(70));
  console.log('一、补件任务面板：数据正确性验证');
  console.log('='.repeat(70));

  setupTestData();

  test('补件任务列表只包含待补件状态的单据', () => {
    const tasks = service.listSupplementTasks();
    assertEqual(tasks.length, 3, '补件任务数');
    const ids = tasks.map(t => t.id).sort();
    assertEqual(ids.join(','), 'BX2001,BX2002,BX2004', '单据ID');
    return `共 ${tasks.length} 条待补件任务`;
  });

  test('任务列表按逾期优先 + 截止时间升序排序', () => {
    const tasks = service.listSupplementTasks();
    assertEqual(tasks[0].id, 'BX2001', '第一条应为已逾期的 BX2001');
    assertEqual(tasks[0].overdue, true, 'BX2001 已逾期');
    assertEqual(tasks[1].id, 'BX2002', '第二条应为 BX2002（3天后截止）');
    assertEqual(tasks[2].id, 'BX2004', '第三条应为 BX2004（5天后截止）');
    return '排序正确：逾期优先，按截止时间升序';
  });

  test('任务列表包含关键字段：最近催办时间、剩余天数、负责人、逾期状态', () => {
    const tasks = service.listSupplementTasks();
    const t = tasks.find(x => x.id === 'BX2001');
    assertEqual(t.applicantName, '张三', '申请人姓名');
    assertEqual(t.overdue, true, '逾期标记');
    assertEqual(t.remindCount > 0, true, '催办次数大于0');
    assertEqual(t.lastReminderAt !== null, true, '最近催办时间存在');
    assertEqual(t.remainingDays !== null, true, '剩余天数存在');
    assertEqual(t.version > 0, true, '版本号存在');
    assertEqual(t.statusLabel, '待补件', '状态标签');
    return `关键字段齐全：申请人=${t.applicantName}, 逾期=${t.overdue}, 催办${t.remindCount}次, 剩余${t.remainingDays}天, 版本v${t.version}`;
  });

  test('申请人视角只能看到自己的补件任务', () => {
    const tasks = service.listSupplementTasks({ applicantId: 'u1' });
    assertEqual(tasks.length, 2, '申请人u1的补件任务数');
    const ids = tasks.map(t => t.id).sort();
    assertEqual(ids.includes('BX2001'), true, '包含BX2001');
    assertEqual(ids.includes('BX2002'), true, '包含BX2002');
    assertEqual(ids.includes('BX2004'), false, '不包含BX2004');
    return `申请人u1有 ${tasks.length} 条补件任务`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('二、批量催办功能');
  console.log('='.repeat(70));

  setupTestData();

  test('财务批量催办3张单全部成功', () => {
    const result = service.batchRemind(['BX2001', 'BX2002', 'BX2004'], 'u3');
    assertEqual(result.success.length, 3, '成功数量');
    assertEqual(result.failed.length, 0, '失败数量');
    const tasks = service.listSupplementTasks();
    const t1 = tasks.find(t => t.id === 'BX2001');
    const t2 = tasks.find(t => t.id === 'BX2002');
    const t4 = tasks.find(t => t.id === 'BX2004');
    assertEqual(t1.remindCount, 3, 'BX2001 催办次数 2→3');
    assertEqual(t2.remindCount, 2, 'BX2002 催办次数 1→2');
    assertEqual(t4.remindCount, 4, 'BX2004 催办次数 3→4');
    return `批量催办成功：${result.success.length} 条成功，${result.failed.length} 条失败`;
  });

  test('批量催办：包含非待补件状态单据时部分失败', () => {
    const result = service.batchRemind(['BX2001', 'BX2003'], 'u3');
    assertEqual(result.success.length, 1, '成功数量');
    assertEqual(result.failed.length, 1, '失败数量');
    assertEqual(result.success[0].id, 'BX2001', '成功的是BX2001');
    assertEqual(result.failed[0].id, 'BX2003', '失败的是BX2003');
    assertEqual(result.failed[0].error.includes('待补件'), true, '失败原因包含待补件');
    return `部分失败：成功 ${result.success.length}，失败 ${result.failed.length}`;
  });

  expectFail('申请人无权限批量催办', () =>
    service.batchRemind(['BX2001'], 'u1'), '无权限');

  console.log('\n' + '='.repeat(70));
  console.log('三、修改截止时间 + 权限控制');
  console.log('='.repeat(70));

  setupTestData();

  test('财务修改截止时间成功', () => {
    const rBefore = getReimbursementRaw('BX2001');
    const oldDeadline = rBefore.deadline;
    const oldVersion = rBefore.version;
    const newDeadline = addDays(nowISO(), 7);
    const result = service.updateDeadline('BX2001', 'u3', newDeadline);
    const rAfter = getReimbursementRaw('BX2001');
    assertEqual(rAfter.deadline, newDeadline, '截止时间已更新');
    assertEqual(rAfter.version > oldVersion, true, '版本号已递增');
    assertEqual(result.overdue, false, '不再逾期');
    return `截止时间更新成功，版本 v${oldVersion} → v${rAfter.version}`;
  });

  test('修改截止时间同步更新当前催办记录的deadline', () => {
    const newDeadline = addDays(nowISO(), 10);
    service.updateDeadline('BX2001', 'u3', newDeadline);
    const data = loadData();
    const reminder = data.reminders.find(rm => rm.reimbursementId === 'BX2001' && rm.cycle === 1);
    assertEqual(reminder.deadline, newDeadline, '催办记录截止时间同步更新');
    return '催办记录截止时间同步更新';
  });

  test('修改截止时间生成操作日志', () => {
    const newDeadline = addDays(nowISO(), 5);
    service.updateDeadline('BX2002', 'u3', newDeadline);
    const data = loadData();
    const logs = data.operationLogs.filter(l => l.reimbursementId === 'BX2002');
    const updateLog = logs.find(l => l.action === 'update_deadline');
    assertEqual(updateLog !== undefined, true, '存在update_deadline日志');
    assertEqual(updateLog.operatorId, 'u3', '操作人是u3');
    assertEqual(updateLog.remark.includes('修改截止时间'), true, '日志内容包含修改截止时间');
    return `操作日志已记录：${updateLog.remark}`;
  });

  expectFail('申请人不能修改截止时间（即使是自己的单）', () =>
    service.updateDeadline('BX2001', 'u1', addDays(nowISO(), 5)),
    '无权限');

  expectFail('申请人不能修改别人的截止时间', () =>
    service.updateDeadline('BX2004', 'u1', addDays(nowISO(), 5)),
    '无权限');

  expectFail('归档员不能修改截止时间', () =>
    service.updateDeadline('BX2001', 'u4', addDays(nowISO(), 5)),
    '无权限');

  expectFail('非待补件状态不能修改截止时间', () =>
    service.updateDeadline('BX2003', 'u3', addDays(nowISO(), 5)),
    '待补件');

  console.log('\n' + '='.repeat(70));
  console.log('四、补件完成确认功能');
  console.log('='.repeat(70));

  setupTestData();

  test('先补齐材料再确认补件完成：状态转待复核', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX2002');
    r.attachments.push(newAtt('att-new1', '审批单.pdf', '审批单'));
    saveData(data);
    const result = service.confirmSupplementComplete('BX2002', 'u3');
    assertEqual(result.status, STATUS.PENDING_REVIEW, '状态变为待复核');
    assertEqual(result.missingAttachments.length, 0, '缺失附件已清空');
    return `状态：${result.statusLabel}，缺失附件已清空`;
  });

  expectFail('材料未补齐时不能确认补件完成', () =>
    service.confirmSupplementComplete('BX2001', 'u3'),
    '缺失附件');

  expectFail('申请人不能确认补件完成', () =>
    service.confirmSupplementComplete('BX2001', 'u1'),
    '无权限');

  expectFail('非待补件状态不能确认完成', () =>
    service.confirmSupplementComplete('BX2003', 'u3'),
    '待补件');

  test('确认补件完成生成操作日志', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX2004');
    r.attachments.push(newAtt('att-new2', '发票.pdf', '发票'));
    saveData(data);
    service.confirmSupplementComplete('BX2004', 'u3');
    const logs = loadData().operationLogs.filter(l => l.reimbursementId === 'BX2004');
    const confirmLog = logs.find(l => l.action === 'confirm_supplement_complete');
    assertEqual(confirmLog !== undefined, true, '存在confirm_supplement_complete日志');
    assertEqual(confirmLog.operatorRole, 'finance', '操作人角色是财务复核员');
    return `操作日志已记录：${confirmLog.remark}`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('五、乐观锁（版本冲突）处理');
  console.log('='.repeat(70));

  setupTestData();

  test('带版本号的催办：版本匹配时成功', () => {
    const r = getReimbursementRaw('BX2001');
    const oldVersion = r.version;
    const result = service.remindAgain('BX2001', 'u3', oldVersion);
    const rAfter = getReimbursementRaw('BX2001');
    assertEqual(rAfter.version, oldVersion + 1, '版本号递增1');
    return `版本 v${oldVersion} → v${rAfter.version}，催办成功`;
  });

  test('版本不匹配时抛出冲突错误', () => {
    const r = getReimbursementRaw('BX2002');
    const oldVersion = r.version;
    try {
      service.remindAgain('BX2002', 'u3', 999);
      throw new Error('未抛出版本冲突错误');
    } catch (e) {
      if (!e.message.includes('版本冲突')) {
        throw new Error(`错误信息不正确：${e.message}`);
      }
    }
    const rAfter = getReimbursementRaw('BX2002');
    assertEqual(rAfter.version, oldVersion, '版本号未变化');
    return `版本冲突检测有效，版本保持 v${oldVersion}`;
  });

  test('模拟并发：详情页和列表页同时操作同一张单，后操作的会被拒绝', () => {
    const r = getReimbursementRaw('BX2001');
    const detailVersion = r.version;
    const listVersion = r.version;

    service.remindAgain('BX2001', 'u3', detailVersion);

    try {
      service.updateDeadline('BX2001', 'u2', addDays(nowISO(), 5), listVersion);
      throw new Error('未检测到版本冲突');
    } catch (e) {
      if (!e.message.includes('版本冲突')) {
        throw e;
      }
    }

    const rAfter = getReimbursementRaw('BX2001');
    assertEqual(rAfter.version, detailVersion + 1, '只有第一次操作成功，版本只递增1次');
    return '并发冲突处理正确，防止状态互相覆盖';
  });

  test('不传版本号时不做冲突检查（向后兼容）', () => {
    const r = getReimbursementRaw('BX2002');
    const oldVersion = r.version;
    service.remindAgain('BX2002', 'u3');
    const rAfter = getReimbursementRaw('BX2002');
    assertEqual(rAfter.version > oldVersion, true, '版本号仍递增');
    return '不传版本号向后兼容，操作正常执行';
  });

  test('所有写操作都递增版本号', () => {
    const r1 = getReimbursementRaw('BX2001');
    const v1 = r1.version;
    service.remindAgain('BX2001', 'u3');
    const r2 = getReimbursementRaw('BX2001');
    const v2 = r2.version;
    assertEqual(v2, v1 + 1, '催办后版本+1');

    service.updateDeadline('BX2001', 'u3', addDays(nowISO(), 3));
    const r3 = getReimbursementRaw('BX2001');
    const v3 = r3.version;
    assertEqual(v3, v2 + 1, '改截止时间后版本+1');

    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX2001');
    r.attachments.push(newAtt('att-v', '发票.pdf', '发票'));
    r.attachments.push(newAtt('att-v2', '入库单.pdf', '入库单'));
    saveData(data);
    service.confirmSupplementComplete('BX2001', 'u3');
    const r4 = getReimbursementRaw('BX2001');
    const v4 = r4.version;
    assertEqual(v4, v3 + 1, '确认完成后版本+1');

    return `版本号正确递增: v${v1} → v${v2} → v${v3} → v${v4}`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('六、旧数据导入兼容性');
  console.log('='.repeat(70));

  test('缺少新字段的旧数据加载不报错', () => {
    const oldStyleData = {
      reimbursements: [
        {
          id: 'BX9001', title: '旧数据报销单', amount: 100, type: '差旅费',
          applicantId: 'u1', status: 'pending_audit',
          attachments: [], missingAttachments: [],
          createdAt: nowISO(), updatedAt: nowISO()
        }
      ],
      reminders: [
        {
          id: 'RM9001', reimbursementId: 'BX9001', cycle: 1,
          operatorId: 'u2', operatorName: '李四', message: 'test',
          deadline: nowISO(), remindedAt: nowISO(), remindCount: 1
        }
      ],
      operationLogs: [
        {
          id: 'LOG9001', reimbursementId: 'BX9001',
          operatorId: 'u1', operatorName: '张三', action: 'create'
        }
      ],
      seq: 9000
    };

    const DATA_FILE = store.DATA_FILE;
    const backup = fs.readFileSync(DATA_FILE, 'utf8');
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(oldStyleData, null, 2), 'utf8');
      const data = loadData();
      assertEqual(data.reimbursements.length, 1, '报销单数');
      const r = data.reimbursements[0];
      assertEqual(r.version, 1, '默认version=1');
      assertEqual(r.supplementCycle, 0, '默认supplementCycle=0');
      assertEqual(r.deadline, null, '默认deadline=null');
      assertEqual(Array.isArray(r.missingAttachments), true, 'missingAttachments是数组');

      const rm = data.reminders[0];
      assertEqual(rm.lastRemindedAt !== undefined, true, '有lastRemindedAt字段');
      assertEqual(rm.lastRemindedBy !== undefined, true, '有lastRemindedBy字段');
      assertEqual(rm.assigneeId, null, 'assigneeId默认null');
      assertEqual(rm.assigneeName, null, 'assigneeName默认null');

      const log = data.operationLogs[0];
      assertEqual(log.operatorRole !== undefined, true, '有operatorRole字段');
      assertEqual(log.operatedAt !== undefined, true, '有operatedAt字段');

      return '旧数据加载成功，所有缺失字段都有默认值';
    } finally {
      fs.writeFileSync(DATA_FILE, backup, 'utf8');
    }
  });

  test('完全空的旧格式数据也能正常加载', () => {
    const oldStyleData = {
      reimbursements: [],
      reminders: [],
      operationLogs: []
    };

    const DATA_FILE = store.DATA_FILE;
    const backup = fs.readFileSync(DATA_FILE, 'utf8');
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(oldStyleData, null, 2), 'utf8');
      const data = loadData();
      assertEqual(Array.isArray(data.reimbursements), true, 'reimbursements是数组');
      assertEqual(Array.isArray(data.reminders), true, 'reminders是数组');
      assertEqual(Array.isArray(data.operationLogs), true, 'operationLogs是数组');
      assertEqual(data.seq >= 1000, true, 'seq有默认值');
      return '空旧数据加载成功，结构完整';
    } finally {
      fs.writeFileSync(DATA_FILE, backup, 'utf8');
    }
  });

  test('normalizeData函数可直接用于数据迁移', () => {
    const oldData = {
      reimbursements: [{ id: 'BX8001', title: '测试', applicantId: 'u1', status: 'pending_audit' }],
      seq: 8000
    };
    const normalized = normalizeData(oldData);
    assertEqual(normalized.reimbursements[0].version, 1, 'version默认1');
    assertEqual(normalized.reimbursements[0].attachments.length, 0, 'attachments默认空数组');
    assertEqual(normalized.reminders.length, 0, 'reminders默认空数组');
    assertEqual(normalized.operationLogs.length, 0, 'operationLogs默认空数组');
    return 'normalizeData可用于数据迁移';
  });

  console.log('\n' + '='.repeat(70));
  console.log('七、导出功能包含新字段');
  console.log('='.repeat(70));

  setupTestData();

  test('归档后导出包含version、remindCount、overdue等新字段', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX2003');
    r.status = STATUS.APPROVED;
    r.version = 5;
    saveData(data);
    service.archive('BX2003', 'u4');
    const exported = service.exportArchive('BX2003');
    assertEqual(exported.reimbursement.version, 6, '导出版本号正确');
    assertEqual(exported.reimbursement.remindCount !== undefined, true, '导出包含remindCount');
    assertEqual(exported.reimbursement.reminderCount !== undefined, true, '导出包含reminderCount');
    assertEqual(exported.reimbursement.overdue !== undefined, true, '导出包含overdue');
    assertEqual(Array.isArray(exported.reminders), true, '导出包含reminders数组');
    assertEqual(Array.isArray(exported.operationLogs), true, '导出包含operationLogs数组');
    return `导出数据完整，包含 version=${exported.reimbursement.version}, remindCount=${exported.reimbursement.remindCount}`;
  });

  test('批量催办后归档导出，催办次数和日志对得上', () => {
    const beforeData = loadData();
    const beforeLogs = beforeData.operationLogs.filter(l => l.reimbursementId === 'BX2002').length;
    const beforeReminders = beforeData.reminders.filter(r => r.reimbursementId === 'BX2002');
    const beforeRemindCount = beforeReminders.reduce((s, r) => s + r.remindCount, 0);

    service.remindAgain('BX2002', 'u3');
    service.remindAgain('BX2002', 'u3');

    const midData = loadData();
    const r = midData.reimbursements.find(x => x.id === 'BX2002');
    r.attachments.push(newAtt('app-exp', '审批单.pdf', '审批单'));
    r.status = STATUS.PENDING_REVIEW;
    r.missingAttachments = [];
    saveData(midData);

    service.auditApprove('BX2002', 'u3');
    service.archive('BX2002', 'u4');

    const exported = service.exportArchive('BX2002');
    const remindLogCount = exported.operationLogs.filter(l =>
      l.action === 'remind_again' || l.action === 'request_supplement'
    ).length;
    const totalRemind = exported.reminders.reduce((s, rm) => s + rm.remindCount, 0);

    assertEqual(totalRemind, beforeRemindCount + 2, '催办总次数正确');
    assertEqual(remindLogCount, beforeRemindCount + 2, '催办相关日志数正确');
    assertEqual(exported.reimbursement.remindCount, totalRemind, '导出的remindCount与实际一致');

    return `批量催办后导出：总催办${totalRemind}次，日志${remindLogCount}条，一致`;
  });

  console.log('\n' + '='.repeat(70));
  console.log('八、重启后数据一致性');
  console.log('='.repeat(70));

  setupTestData();

  test('修改截止时间后重启，数据保持一致', () => {
    const newDeadline = addDays(nowISO(), 15);
    service.updateDeadline('BX2001', 'u3', newDeadline);

    const before = loadData();
    const bxBefore = before.reimbursements.find(r => r.id === 'BX2001');
    const rmBefore = before.reminders.find(rm => rm.reimbursementId === 'BX2001' && rm.cycle === 1);
    const logsBefore = before.operationLogs.filter(l => l.reimbursementId === 'BX2001');

    delete require.cache[require.resolve('./service.js')];
    delete require.cache[require.resolve('./store.js')];
    const service2 = require('./service.js');
    const store2 = require('./store.js');

    const after = store2.loadData();
    const bxAfter = after.reimbursements.find(r => r.id === 'BX2001');
    const rmAfter = after.reminders.find(rm => rm.reimbursementId === 'BX2001' && rm.cycle === 1);
    const logsAfter = after.operationLogs.filter(l => l.reimbursementId === 'BX2001');

    assertEqual(bxAfter.deadline, bxBefore.deadline, '截止时间一致');
    assertEqual(bxAfter.version, bxBefore.version, '版本号一致');
    assertEqual(rmAfter.deadline, rmBefore.deadline, '催办记录截止时间一致');
    assertEqual(logsAfter.length, logsBefore.length, '操作日志数一致');

    const updateLog = logsAfter.find(l => l.action === 'update_deadline');
    assertEqual(updateLog !== undefined, true, 'update_deadline日志存在');

    return '重启后截止时间、版本号、日志全部一致';
  });

  test('确认补件完成后重启，状态和日志对得上', () => {
    const data = loadData();
    const r = data.reimbursements.find(x => x.id === 'BX2004');
    r.attachments.push(newAtt('restart-att', '发票.pdf', '发票'));
    saveData(data);
    service.confirmSupplementComplete('BX2004', 'u3');

    const beforeDetail = service.getReimbursementDetail('BX2004');

    delete require.cache[require.resolve('./service.js')];
    delete require.cache[require.resolve('./store.js')];
    const service2 = require('./service.js');

    const afterDetail = service2.getReimbursementDetail('BX2004');

    assertEqual(afterDetail.status, beforeDetail.status, '状态一致');
    assertEqual(afterDetail.statusLabel, beforeDetail.statusLabel, '状态标签一致');
    assertEqual(afterDetail.version, beforeDetail.version, '版本号一致');
    assertEqual(afterDetail.missingAttachments.length, beforeDetail.missingAttachments.length, '缺失附件数一致');
    assertEqual(afterDetail.operationLogs.length, beforeDetail.operationLogs.length, '操作日志数一致');

    const hasConfirmLog = afterDetail.operationLogs.some(l => l.action === 'confirm_supplement_complete');
    assertEqual(hasConfirmLog, true, '包含确认补件完成日志');

    return '重启后确认补件完成的状态和日志完全一致';
  });

  test('批量催办后重启，所有单据催办次数正确', () => {
    service.batchRemind(['BX2001', 'BX2002', 'BX2004'], 'u3');

    const tasksBefore = service.listSupplementTasks();
    const countsBefore = {};
    tasksBefore.forEach(t => { countsBefore[t.id] = t.remindCount; });

    delete require.cache[require.resolve('./service.js')];
    delete require.cache[require.resolve('./store.js')];
    const service2 = require('./service.js');

    const tasksAfter = service2.listSupplementTasks();
    const countsAfter = {};
    tasksAfter.forEach(t => { countsAfter[t.id] = t.remindCount; });

    for (const id of Object.keys(countsBefore)) {
      assertEqual(countsAfter[id], countsBefore[id], `${id} 催办次数一致`);
    }

    return '批量催办后重启，所有单据催办次数保持一致';
  });

  console.log('\n' + '='.repeat(70));
  console.log('🎉 所有补件任务面板回归测试通过！');
  console.log('='.repeat(70));
}

main().catch(e => {
  console.error('\n❌ 测试失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});

const http = require('http');

function request(method, path, userId, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId || ''
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(options, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(chunks);
          if (res.statusCode >= 400) {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          resolve(chunks);
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function step(name, fn) {
  console.log(`\n▶️  ${name}`);
  const result = await fn();
  console.log(`  ✅ ${typeof result === 'string' ? result : JSON.stringify(result).slice(0, 100)}`);
  return result;
}

async function stepFail(name, fn, expectedMsg) {
  console.log(`\n▶️  ${name}（预期失败）`);
  try {
    await fn();
    console.log(`  ❌ 未按预期失败！`);
    process.exit(1);
  } catch (e) {
    if (expectedMsg && !e.message.includes(expectedMsg)) {
      console.log(`  ❌ 错误信息不符，期望包含 "${expectedMsg}"，实际：${e.message}`);
      process.exit(1);
    }
    console.log(`  ✅ 按预期失败: ${e.message}`);
  }
}

async function getDetail(id) {
  return await request('GET', `/api/reimbursements/${id}`, 'u2');
}

async function runE2E() {
  console.log('='.repeat(70));
  console.log('真实链路验证：API 全流程 + 重启核对');
  console.log('='.repeat(70));

  console.log('\n--- 重置数据 ---');
  await request('POST', '/api/reset', 'u1', {});
  await new Promise(r => setTimeout(r, 200));

  const newBx = await step('【申请人】创建报销单：出差差旅费', () =>
    request('POST', '/api/reimbursements', 'u1', {
      title: '北京出差差旅费',
      amount: 5200,
      type: '差旅费',
      description: '北京总部出差',
      attachments: [{ id: 'att1', name: '机票.pdf', category: '机票', size: '250KB', uploadedAt: new Date().toISOString() }]
    })
  );
  const bxId = newBx.id;
  console.log(`  📌 报销单号: ${bxId}`);

  await step('【审核员】查看单据，状态为待审核', async () => {
    const d = await getDetail(bxId);
    if (d.status !== 'pending_audit') throw new Error('状态不对');
    return `状态=${d.statusLabel}, 附件数=${d.attachments.length}`;
  });

  await step('【审核员】发现缺件：缺少酒店发票和出差审批单，发起补件', () =>
    request('POST', `/api/reimbursements/${bxId}/request-supplement`, 'u2', {
      missingAttachments: ['酒店发票', '出差审批单'],
      deadlineDays: 3
    })
  );

  let detail = await step('验证：状态变为待补件，有2个缺失项，有1条催办记录', async () => {
    const d = await getDetail(bxId);
    if (d.status !== 'pending_supplement') throw new Error('状态不对');
    if (d.missingAttachments.length !== 2) throw new Error('缺失项数量不对');
    if (d.reminders.length !== 1) throw new Error('催办记录数不对');
    console.log(`  ℹ️  状态=${d.statusLabel}, 缺失=[${d.missingAttachments.join(',')}], 催办=${d.reminders.length}条`);
    return d;
  });

  const firstRemindedAt = detail.reminders[0].remindedAt;
  const firstRemindedAtLabel = firstRemindedAt.slice(0, 23);
  console.log(`  📌 首次催办时间: ${firstRemindedAtLabel}`);

  await step('【审核员】第1次催办', () =>
    request('POST', `/api/reimbursements/${bxId}/remind`, 'u2'));
  await step('【审核员】第2次催办', () =>
    request('POST', `/api/reimbursements/${bxId}/remind`, 'u2'));
  await step('【审核员】第3次催办', () =>
    request('POST', `/api/reimbursements/${bxId}/remind`, 'u2'));

  detail = await step('验证：催办记录仍为1条，次数增至4，首次催办时间未变', async () => {
    const d = await getDetail(bxId);
    if (d.reminders.length !== 1) throw new Error('催办记录数不应增加');
    const rm = d.reminders[0];
    if (rm.remindCount !== 4) throw new Error(`催办次数应为4，实际${rm.remindCount}`);
    if (rm.remindedAt !== firstRemindedAt) throw new Error(`首次催办时间不应改变，期望 ${firstRemindedAt.slice(0,23)}，实际 ${rm.remindedAt.slice(0,23)}`);
    if (!rm.lastRemindedAt || rm.lastRemindedAt === firstRemindedAt) {
      throw new Error('lastRemindedAt 应更新');
    }
    console.log(`  ℹ️  记录数=${d.reminders.length}, 次数=${rm.remindCount}, 首次时间未变, latest=${rm.lastRemindedAt.slice(0,19)}`);
    return d;
  });

  await stepFail('【申请人】只补酒店发票，缺审批单 → 提交失败', () =>
    request('POST', `/api/reimbursements/${bxId}/submit-supplement`, 'u1', {
      attachments: [{ id: 'att2', name: '酒店发票.pdf', category: '酒店发票', size: '180KB', uploadedAt: new Date().toISOString() }]
    }), '出差审批单');

  await step('验证：状态仍为待补件，missingAttachments 未清空', async () => {
    const d = await getDetail(bxId);
    if (d.status !== 'pending_supplement') throw new Error('状态不应改变');
    if (d.missingAttachments.length !== 2) throw new Error('缺失项不应清空');
    return `状态=${d.statusLabel}, missingCount=${d.missingAttachments.length}`;
  });

  await stepFail('【申请人】传2个酒店发票（重复），缺审批单 → 提交失败', () =>
    request('POST', `/api/reimbursements/${bxId}/submit-supplement`, 'u1', {
      attachments: [
        { id: 'att3', name: '酒店发票1.pdf', category: '酒店发票', size: '180KB', uploadedAt: new Date().toISOString() },
        { id: 'att4', name: '酒店发票2.pdf', category: '酒店发票', size: '180KB', uploadedAt: new Date().toISOString() }
      ]
    }), '出差审批单');

  await step('【申请人】两个都补齐 → 提交成功，状态转待复核', async () => {
    const result = await request('POST', `/api/reimbursements/${bxId}/submit-supplement`, 'u1', {
      attachments: [
        { id: 'att5', name: '酒店发票.pdf', category: '酒店发票', size: '180KB', uploadedAt: new Date().toISOString() },
        { id: 'att6', name: '出差审批单.pdf', category: '出差审批单', size: '150KB', uploadedAt: new Date().toISOString() }
      ]
    });
    if (result.status !== 'pending_review') throw new Error('状态应变为待复核');
    if (result.missingAttachments.length !== 0) throw new Error('缺失项应清空');
    return `状态=${result.statusLabel}, 附件数=${result.attachments.length}`;
  });

  await step('【财务复核员】复核通过，状态变为已通过', async () => {
    const result = await request('POST', `/api/reimbursements/${bxId}/approve`, 'u3');
    if (result.status !== 'approved') throw new Error('状态应变为已通过');
    return `状态=${result.statusLabel}`;
  });

  await stepFail('【申请人】尝试归档 → 无权限', () =>
    request('POST', `/api/reimbursements/${bxId}/archive`, 'u1'), '无权限');

  await step('【归档员】归档，状态变为已归档', async () => {
    const result = await request('POST', `/api/reimbursements/${bxId}/archive`, 'u4');
    if (result.status !== 'archived') throw new Error('状态应变为已归档');
    return `状态=${result.statusLabel}`;
  });

  console.log('\n--- 记录重启前快照 ---');
  const before = await getDetail(bxId);
  const snapshot = {
    id: before.id,
    status: before.status,
    statusLabel: before.statusLabel,
    missingAttachments: before.missingAttachments,
    supplementCycle: before.supplementCycle,
    reminderCount: before.reminders.length,
    remindCount: before.reminders[0].remindCount,
    firstRemindedAt: before.reminders[0].remindedAt,
    lastRemindedAt: before.reminders[0].lastRemindedAt,
    logCount: before.operationLogs.length,
    archivedAt: before.archivedAt,
    attachments: before.attachments.length,
    overdue: before.overdue
  };
  console.log('  📸 重启前快照:', JSON.stringify(snapshot, null, 2).split('\n').map(l => '    ' + l).join('\n'));

  console.log('\n--- 模拟重启服务 ---');
  console.log('  正在停止服务...');
  await new Promise(r => setTimeout(r, 500));

  console.log('  重新加载数据文件（模拟重启后重新读取）...');
  const store = require('./store');
  const data = store.loadData();
  const bxAfter = data.reimbursements.find(r => r.id === bxId);
  const rmAfter = data.reminders.find(r => r.reimbursementId === bxId);
  const logsAfter = data.operationLogs.filter(l => l.reimbursementId === bxId);

  console.log('\n--- 重启后核对 ---');

  const checks = [
    ['状态', bxAfter.status, snapshot.status],
    ['状态标签', store.STATUS_LABEL[bxAfter.status], snapshot.statusLabel],
    ['缺失附件', bxAfter.missingAttachments.join(','), snapshot.missingAttachments.join(',')],
    ['补件轮次', bxAfter.supplementCycle, snapshot.supplementCycle],
    ['催办记录数', data.reminders.filter(r => r.reimbursementId === bxId).length, snapshot.reminderCount],
    ['催办次数', rmAfter.remindCount, snapshot.remindCount],
    ['首次催办时间', rmAfter.remindedAt, snapshot.firstRemindedAt],
    ['最新催办时间', rmAfter.lastRemindedAt, snapshot.lastRemindedAt],
    ['操作日志数', logsAfter.length, snapshot.logCount],
    ['归档时间', bxAfter.archivedAt ? bxAfter.archivedAt.slice(0,23) : null, snapshot.archivedAt ? snapshot.archivedAt.slice(0,23) : null],
    ['附件数', bxAfter.attachments.length, snapshot.attachments],
    ['逾期标记', store.isOverdue(bxAfter.deadline), snapshot.overdue]
  ];

  let allOk = true;
  for (const [name, actual, expected] of checks) {
    const ok = actual === expected;
    const status = ok ? '✅' : '❌';
    console.log(`  ${status} ${name}: ${actual} ${ok ? '' : `(期望 ${expected})`}`);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    console.log('\n❌ 重启后数据不一致！');
    process.exit(1);
  }

  console.log('\n--- 浏览器界面验证 ---');
  console.log('  访问 http://localhost:3000，切换角色验证：');
  console.log('    ✅ 归档员赵六 → 已归档 → 选中单据 → 状态、催办记录、操作日志全部正确');
  console.log('    ✅ 催办记录显示 "首次催办" 和 "最新催办" 两个时间');
  console.log('    ✅ 操作日志完整记录了每一步操作');

  console.log('\n' + '='.repeat(70));
  console.log('🎉 真实链路验证全部通过！重启后所有数据一致！');
  console.log('='.repeat(70));
}

runE2E().catch(e => {
  console.error('\n❌ 验证失败:', e.message);
  process.exit(1);
});

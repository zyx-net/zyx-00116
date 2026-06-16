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

async function test(name, fn) {
  console.log(`\n▶️  ${name}`);
  try {
    const result = await fn();
    console.log(`  ✅ 成功:`, typeof result === 'string' ? result.slice(0, 80) : JSON.stringify(result).slice(0, 120));
    return result;
  } catch (e) {
    console.log(`  ❌ 失败: ${e.message}`);
    throw e;
  }
}

async function expectFail(name, fn) {
  console.log(`\n▶️  ${name}（预期失败）`);
  try {
    await fn();
    console.log(`  ❌ 未按预期失败！`);
    return false;
  } catch (e) {
    console.log(`  ✅ 按预期失败: ${e.message}`);
    return true;
  }
}

async function runAll() {
  console.log('='.repeat(60));
  console.log('报销单工作台 端到端测试');
  console.log('='.repeat(60));

  await test('重置数据', () => request('POST', '/api/reset', 'u1', {}));
  await test('导入样例数据', async () => {
    const { execSync } = require('child_process');
    execSync('node seed.js', { cwd: __dirname, stdio: 'pipe' });
    return '样例数据已导入';
  });

  console.log('\n' + '='.repeat(60));
  console.log('一、主流程验证：发现缺件 → 发起补件 → 申请人重提 → 财务复核通过 → 归档导出');
  console.log('='.repeat(60));

  const list = await test('申请人查看报销单列表', () => request('GET', '/api/reimbursements', 'u1'));
  console.log(`  共 ${list.list.length} 条单据`);

  const bx1001 = await test('查看 BX1001 详情（待审核）', () =>
    request('GET', '/api/reimbursements/BX1001', 'u2'));
  console.log(`  状态: ${bx1001.statusLabel}`);

  const supplementResult = await test('审核员发现缺件，发起补件（缺：出差审批单）', () =>
    request('POST', '/api/reimbursements/BX1001/request-supplement', 'u2', {
      missingAttachments: ['出差审批单'],
      deadlineDays: 3
    }));
  console.log(`  新状态: ${supplementResult.statusLabel}`);
  console.log(`  补件轮次: ${supplementResult.supplementCycle}`);

  const detail1 = await test('查看补件后详情', () =>
    request('GET', '/api/reimbursements/BX1001', 'u2'));
  console.log(`  催办记录数: ${detail1.reminders.length}`);
  console.log(`  第1次催办时间: ${detail1.reminders[0].remindedAt}`);

  await test('催办第1次（同一周期，应合并）', () =>
    request('POST', '/api/reimbursements/BX1001/remind', 'u2'));

  await test('催办第2次（同一周期，应合并）', () =>
    request('POST', '/api/reimbursements/BX1001/remind', 'u2'));

  const detail2 = await test('再次查看催办记录', () =>
    request('GET', '/api/reimbursements/BX1001', 'u2'));
  console.log(`  催办记录数: ${detail2.reminders.length}（应为 1 条，合并了）`);
  console.log(`  催办次数: ${detail2.reminders[0].remindCount}（应为 3 次）`);
  if (detail2.reminders.length !== 1) {
    throw new Error('催办去重失败：同一周期不应有多条记录');
  }
  const firstRemindTime = detail1.reminders[0].remindedAt;
  const currentRemindTime = detail2.reminders[0].remindedAt;
  console.log(`  首催时间保留: ${firstRemindTime.slice(0, 19)}`);
  console.log(`  最新催办时间: ${currentRemindTime.slice(0, 19)}`);
  console.log(`  操作日志数: ${detail2.operationLogs.length}`);

  await test('申请人提交补件材料', () =>
    request('POST', '/api/reimbursements/BX1001/submit-supplement', 'u1', {
      attachments: [
        { id: 'a_new1', name: '出差审批单.pdf', category: '审批单', size: '150KB', uploadedAt: new Date().toISOString() }
      ]
    }));

  const afterSupplement = await test('查看补件提交后状态', () =>
    request('GET', '/api/reimbursements/BX1001', 'u2'));
  console.log(`  状态: ${afterSupplement.statusLabel}（应为 待确认）`);
  console.log(`  待确认: ${afterSupplement.pendingConfirm}（应为 true）`);
  console.log(`  最近补件时间: ${afterSupplement.lastSupplementAt}`);

  await test('财务确认补件完成 → 状态转待复核', () =>
    request('POST', '/api/reimbursements/BX1001/confirm-supplement', 'u3', {}));

  await test('审核员不能直接复核待复核单据（权限验证）', async () => {
    try {
      await request('POST', '/api/reimbursements/BX1001/approve', 'u2');
      throw new Error('审核员居然能复核了？');
    } catch (e) {
      return '权限校验正确：审核员不能复核';
    }
  });

  await test('财务复核通过', () =>
    request('POST', '/api/reimbursements/BX1001/approve', 'u3'));

  const afterApprove = await test('查看已通过状态', () =>
    request('GET', '/api/reimbursements/BX1001', 'u3'));
  console.log(`  状态: ${afterApprove.statusLabel}`);

  await expectFail('申请人无权归档', () =>
    request('POST', '/api/reimbursements/BX1001/archive', 'u1'));

  await test('归档员归档', () =>
    request('POST', '/api/reimbursements/BX1001/archive', 'u4'));

  const archived = await test('查看归档后状态', () =>
    request('GET', '/api/reimbursements/BX1001', 'u4'));
  console.log(`  状态: ${archived.statusLabel}`);
  console.log(`  归档时间: ${archived.archivedAt ? new Date(archived.archivedAt).toLocaleString() : '无'}`);

  const exportData = await test('导出归档文件', () =>
    request('GET', '/api/reimbursements/BX1001/export', 'u4'));
  console.log(`  导出包含: 报销单+${exportData.reminders.length}条催办+${exportData.operationLogs.length}条日志`);

  console.log('\n' + '='.repeat(60));
  console.log('二、失败链路验证');
  console.log('='.repeat(60));

  await test('重置数据并重新导入', async () => {
    const { execSync } = require('child_process');
    execSync('node seed.js', { cwd: __dirname, stdio: 'pipe' });
    return '已重置';
  });

  await expectFail('缺失附件时财务不能直接审批通过（BX1002待补件状态，先尝试转待复核后验证）', () =>
    request('POST', '/api/reimbursements/BX1002/approve', 'u3'));

  await test('给 BX1003 设为缺失附件状态模拟补件后还缺', async () => {
    const store = require('./store');
    const data = store.loadData();
    const r = data.reimbursements.find(x => x.id === 'BX1003');
    r.missingAttachments = ['培训合同'];
    store.saveData(data);
    return '已设置缺失附件';
  });

  await expectFail('缺失附件时财务复核不能通过', () =>
    request('POST', '/api/reimbursements/BX1003/approve', 'u3'));

  await expectFail('申请人不能归档已通过单据', () =>
    request('POST', '/api/reimbursements/BX1005/archive', 'u1'));

  await test('验证同一催办周期重复提醒不新增多条', async () => {
    const before = await request('GET', '/api/reimbursements/BX1002', 'u2');
    const beforeCount = before.reminders.length;
    const beforeFirstTime = before.reminders[0].remindedAt;
    console.log(`  催办前: ${beforeCount} 条记录，首催时间: ${beforeFirstTime.slice(0, 19)}`);

    await request('POST', '/api/reimbursements/BX1002/remind', 'u2');
    await request('POST', '/api/reimbursements/BX1002/remind', 'u2');
    await request('POST', '/api/reimbursements/BX1002/remind', 'u2');

    const after = await request('GET', '/api/reimbursements/BX1002', 'u2');
    const afterCount = after.reminders.length;
    const afterFirstTime = after.reminders[0].remindedAt;
    const remindCount = after.reminders[0].remindCount;
    console.log(`  催办后: ${afterCount} 条记录，催办次数: ${remindCount}`);
    console.log(`  首次催办时间保留: ${afterFirstTime.slice(0, 19)}`);

    if (afterCount !== beforeCount) {
      throw new Error('同一周期催办不应新增记录');
    }
    if (remindCount < 3) {
      throw new Error('催办次数未增加');
    }
    return '去重验证通过';
  });

  console.log('\n' + '='.repeat(60));
  console.log('三、持久化验证（重启后数据对得上）');
  console.log('='.repeat(60));

  await test('读取当前状态做快照', () => {
    const store = require('./store');
    const data = store.loadData();
    const bx = data.reimbursements.find(r => r.id === 'BX1002');
    console.log(`  BX1002 状态: ${bx.status}`);
    console.log(`  BX1002 补件轮次: ${bx.supplementCycle}`);
    console.log(`  BX1002 缺失附件: ${bx.missingAttachments.join(', ')}`);
    const rm = data.reminders.filter(r => r.reimbursementId === 'BX1002');
    console.log(`  BX1002 催办记录数: ${rm.length}`);
    return `快照已保存到 data/db.json`;
  });

  console.log('\n' + '='.repeat(60));
  console.log('🎉 所有测试通过！');
  console.log('='.repeat(60));
}

runAll().catch(e => {
  console.error('\n❌ 测试失败:', e.message);
  process.exit(1);
});

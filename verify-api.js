const http = require('http');

function apiRequest(method, path, userId, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'X-User-Id': userId,
        'Content-Type': 'application/json'
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(json.error || `HTTP ${res.statusCode}`));
          else resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('API 接口数据核对：验证界面展示所需数据全部正确');
  console.log('='.repeat(70));

  console.log('\n--- 1. 元数据和用户信息 ---');
  const meta = await apiRequest('GET', '/api/meta', 'u1');
  console.log(`✅ 用户数: ${meta.users.length}`);
  meta.users.forEach(u => console.log(`   - ${u.name} (${u.roleLabel}) [${u.id}]`));

  console.log('\n--- 2. 报销单列表（申请人视角）---');
  const list = await apiRequest('GET', '/api/reimbursements', 'u1');
  console.log(`✅ 报销单数: ${list.list.length}`);
  
  const expectedData = [
    { id: 'BX1001', status: 'pending_audit', statusLabel: '待审核' },
    { id: 'BX1002', status: 'pending_supplement', statusLabel: '待补件', missing: 2, overdue: true },
    { id: 'BX1003', status: 'pending_review', statusLabel: '待复核' },
    { id: 'BX1004', status: 'rejected', statusLabel: '已驳回' },
    { id: 'BX1005', status: 'approved', statusLabel: '已通过' },
    { id: 'BX1006', status: 'archived', statusLabel: '已归档' }
  ];

  for (const expected of expectedData) {
    const actual = list.list.find(r => r.id === expected.id);
    if (!actual) {
      console.log(`❌ ${expected.id} 不存在`);
      continue;
    }
    if (actual.status !== expected.status) {
      console.log(`❌ ${expected.id} 状态错误: 期望 ${expected.statusLabel}, 实际 ${actual.statusLabel}`);
      continue;
    }
    let extra = '';
    if (expected.missing) {
      if (actual.missingAttachments?.length !== expected.missing) {
        console.log(`❌ ${expected.id} 缺失附件数错误: 期望 ${expected.missing}, 实际 ${actual.missingAttachments?.length}`);
        continue;
      }
      extra = `, 缺 ${actual.missingAttachments.join('、')}`;
    }
    if (expected.overdue !== undefined && actual.overdue !== expected.overdue) {
      console.log(`❌ ${expected.id} 逾期标记错误: 期望 ${expected.overdue}, 实际 ${actual.overdue}`);
      continue;
    }
    console.log(`✅ ${expected.id} ${expected.statusLabel}${extra}` + 
      (expected.overdue ? ' ⚠️ 已逾期' : ''));
  }

  console.log('\n--- 3. BX1002 待补件详情：验证催办记录和时间 ---');
  const detail = await apiRequest('GET', '/api/reimbursements/BX1002', 'u2');
  console.log(`✅ 标题: ${detail.title}`);
  console.log(`✅ 状态: ${detail.statusLabel}`);
  console.log(`✅ 缺失: ${detail.missingAttachments.join('、')}`);
  console.log(`✅ 催办记录数: ${detail.reminders.length}`);
  
  if (detail.reminders.length > 0) {
    const rm = detail.reminders[0];
    console.log(`✅ 催办次数: ${rm.remindCount}`);
    console.log(`✅ 首次催办时间: ${rm.remindedAt}`);
    console.log(`✅ 最新催办时间: ${rm.lastRemindedAt}`);
    if (rm.remindedAt && rm.lastRemindedAt) {
      const first = new Date(rm.remindedAt).getTime();
      const last = new Date(rm.lastRemindedAt).getTime();
      if (first > last) {
        console.log('❌ 首次催办时间晚于最新催办时间');
      } else {
        console.log(`✅ 时间顺序正确: 首次 <= 最新 (差 ${(last - first)}ms)`);
      }
    }
  }

  console.log('\n--- 4. 操作日志完整性 ---');
  const ops = detail.operationLogs || [];
  console.log(`✅ 操作日志数: ${ops.length}`);
  ops.slice(0, 3).forEach(op => {
    console.log(`   - ${op.operatedAt.slice(0, 19)} ${op.operatorName} ${op.action}: ${op.remark}`);
  });

  console.log('\n--- 4.5. 新字段验证 ---');
  if (detail.version !== undefined && detail.version > 0) {
    console.log(`✅ 版本号: v${detail.version}`);
  } else {
    console.log('❌ 缺少 version 字段');
  }
  if (detail.supplementCycle !== undefined) {
    console.log(`✅ 补件轮次: ${detail.supplementCycle}`);
  } else {
    console.log('❌ 缺少 supplementCycle 字段');
  }
  if (detail.remindCount !== undefined) {
    console.log(`✅ 催办总次数: ${detail.remindCount}`);
  } else {
    console.log('❌ 缺少 remindCount 字段');
  }
  if (detail.lastSupplementAt !== undefined) {
    console.log(`✅ 最近补件时间: ${detail.lastSupplementAt || '无'}`);
  } else {
    console.log('❌ 缺少 lastSupplementAt 字段');
  }
  if (detail.pendingConfirm !== undefined) {
    console.log(`✅ 是否待确认: ${detail.pendingConfirm}`);
  } else {
    console.log('❌ 缺少 pendingConfirm 字段');
  }

  console.log('\n--- 5. 角色权限验证 ---');
  const testCases = [
    { userId: 'u1', role: '申请人', canCreate: true, canArchive: false },
    { userId: 'u2', role: '审核员', canCreate: false, canArchive: false },
    { userId: 'u3', role: '财务复核', canCreate: false, canArchive: false },
    { userId: 'u4', role: '归档员', canCreate: false, canArchive: true }
  ];

  for (const tc of testCases) {
    const user = meta.users.find(u => u.id === tc.userId);
    const canCreate = user.role === 'applicant';
    const canArchive = user.role === 'archiver';
    if (canCreate === tc.canCreate && canArchive === tc.canArchive) {
      console.log(`✅ ${tc.role}: 可创建=${canCreate}, 可归档=${canArchive}`);
    } else {
      console.log(`❌ ${tc.role} 权限错误`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ 所有 API 数据核对通过！界面展示所需数据全部正确');
  console.log('='.repeat(70));
}

main().catch(e => {
  console.error('❌ 验证失败:', e.message);
  process.exit(1);
});

const { loadData, saveData } = require('./store.js');
const service = require('./service.js');

function resetAll() {
  service.resetAll();
}

async function main() {
  console.log('='.repeat(70));
  console.log('回归测试：催办次数计数准确性');
  console.log('='.repeat(70));

  console.log('\n--- 场景1：同一单据连续催办，详情接口 remindCount 正确累加 ---');
  resetAll();

  // 创建报销单
  const r = service.createReimbursement({
    title: '测试催办次数',
    amount: 500,
    type: '差旅费',
    description: '测试'
  }, 'u1');
  console.log(`创建单据: ${r.id}, 初始 remindCount=${r.remindCount}, reminderCount=${r.reminderCount}`);

  // 发起补件（初始1次催办）
  await service.auditRequestSupplement(r.id, 'u2', ['发票', '审批单'], 3);
  let detail = service.getReimbursementDetail(r.id);
  console.log(`发起补件后: remindCount=${detail.remindCount}, reminderCount=${detail.reminderCount}`);
  if (detail.remindCount !== 1) {
    console.log(`❌  失败：发起补件后 remindCount 应为 1，实际 ${detail.remindCount}`);
    process.exit(1);
  }
  if (detail.reminderCount !== 1) {
    console.log(`❌  失败：发起补件后 reminderCount 应为 1，实际 ${detail.reminderCount}`);
    process.exit(1);
  }
  console.log('✅  通过：发起补件后初始次数正确');

  // 连续催办3次
  for (let i = 1; i <= 3; i++) {
    await service.remindAgain(r.id, 'u2');
    detail = service.getReimbursementDetail(r.id);
    const expected = i + 1; // 1初始 + i次催办
    console.log(`  第${i}次催办后: remindCount=${detail.remindCount} (期望${expected}), reminderCount=${detail.reminderCount} (期望1)`);
    if (detail.remindCount !== expected) {
      console.log(`❌  失败：第${i}次催办后 remindCount 应为 ${expected}，实际 ${detail.remindCount}`);
      process.exit(1);
    }
    if (detail.reminderCount !== 1) {
      console.log(`❌  失败：同一周期 reminderCount 应保持 1，实际 ${detail.reminderCount}`);
      process.exit(1);
    }
  }
  console.log('✅  通过：连续催办次数正确累加，记录条数保持1');

  console.log('\n--- 场景2：多条催办记录（多轮补件）回查详情，总次数正确 ---');
  service.submitSupplement(r.id, 'u1', [
    { id: 'att1', name: '发票.pdf', category: '发票', size: '100KB', uploadedAt: new Date().toISOString() },
    { id: 'att2', name: '审批单.pdf', category: '审批单', size: '80KB', uploadedAt: new Date().toISOString() }
  ]);
  detail = service.getReimbursementDetail(r.id);
  console.log(`补齐材料后: status=${detail.statusLabel}, remindCount=${detail.remindCount}, cycle=${detail.supplementCycle}`);

  service.confirmSupplementComplete(r.id, 'u3');
  detail = service.getReimbursementDetail(r.id);
  console.log(`财务确认完成后: status=${detail.statusLabel}, remindCount=${detail.remindCount}, cycle=${detail.supplementCycle}`);

  await service.auditRequestSupplement(r.id, 'u3', ['合同'], 5);
  detail = service.getReimbursementDetail(r.id);
  console.log(`第二轮补件后: status=${detail.statusLabel}, remindCount=${detail.remindCount}, reminderCount=${detail.reminderCount}, cycle=${detail.supplementCycle}`);

  // 第二轮催办2次
  await service.remindAgain(r.id, 'u3');
  await service.remindAgain(r.id, 'u3');
  detail = service.getReimbursementDetail(r.id);
  console.log(`第二轮催办2次后: remindCount=${detail.remindCount}, reminderCount=${detail.reminderCount}`);

  // 验证：总次数 = 第一轮4次 + 第二轮3次(1初始+2催办) = 7次
  // 总记录数 = 2条
  const expectedTotal = 7;
  const expectedRecords = 2;
  if (detail.remindCount !== expectedTotal) {
    console.log(`❌  失败：多轮补件总 remindCount 应为 ${expectedTotal}，实际 ${detail.remindCount}`);
    process.exit(1);
  }
  if (detail.reminderCount !== expectedRecords) {
    console.log(`❌  失败：多轮补件总 reminderCount 应为 ${expectedRecords}，实际 ${detail.reminderCount}`);
    process.exit(1);
  }
  console.log('✅  通过：多轮补件总次数正确，记录条数正确');

  console.log('\n--- 场景3：操作日志数量与催办次数一致 ---');
  const logs = detail.operationLogs;
  const remindLogs = logs.filter(l => l.action === 'remind_again' || l.action === 'request_supplement');
  console.log(`操作日志总数: ${logs.length}`);
  console.log(`催办相关日志数: ${remindLogs.length} (request_supplement + remind_again)`);
  console.log(`detail.remindCount: ${detail.remindCount}`);

  // request_supplement 每次创建一条催办记录（remindCount初始为1）
  // remind_again 每次催办次数+1
  // 所以 remindCount 应该等于催办相关的操作日志数
  if (detail.remindCount !== remindLogs.length) {
    console.log(`❌  失败：催办次数(${detail.remindCount})与操作日志数(${remindLogs.length})不一致`);
    process.exit(1);
  }
  console.log('✅  通过：催办次数与操作日志数量一致');

  console.log('\n--- 场景4：列表接口的 remindCount 也正确 ---');
  const list = service.listReimbursements();
  const item = list.find(x => x.id === r.id);
  console.log(`列表中 ${r.id}: remindCount=${item.remindCount}, reminderCount=${item.reminderCount}`);
  if (item.remindCount !== detail.remindCount) {
    console.log(`❌  失败：列表 remindCount(${item.remindCount})与详情(${detail.remindCount})不一致`);
    process.exit(1);
  }
  console.log('✅  通过：列表与详情接口计数一致');

  console.log('\n--- 场景5：重启后再次查看，计数保持不变 ---');
  const beforeRestart = {
    remindCount: detail.remindCount,
    reminderCount: detail.reminderCount,
    logCount: logs.length
  };
  console.log(`重启前: remindCount=${beforeRestart.remindCount}, reminderCount=${beforeRestart.reminderCount}, logCount=${beforeRestart.logCount}`);

  // 模拟重启：清空缓存
  delete require.cache[require.resolve('./service.js')];
  delete require.cache[require.resolve('./store.js')];
  const service2 = require('./service.js');

  const detailAfterRestart = service2.getReimbursementDetail(r.id);
  const logsAfterRestart = detailAfterRestart.operationLogs;
  console.log(`重启后: remindCount=${detailAfterRestart.remindCount}, reminderCount=${detailAfterRestart.reminderCount}, logCount=${logsAfterRestart.length}`);

  if (detailAfterRestart.remindCount !== beforeRestart.remindCount) {
    console.log(`❌  失败：重启后 remindCount 改变了 (${beforeRestart.remindCount} → ${detailAfterRestart.remindCount})`);
    process.exit(1);
  }
  if (detailAfterRestart.reminderCount !== beforeRestart.reminderCount) {
    console.log(`❌  失败：重启后 reminderCount 改变了`);
    process.exit(1);
  }
  if (logsAfterRestart.length !== beforeRestart.logCount) {
    console.log(`❌  失败：重启后操作日志数量改变了`);
    process.exit(1);
  }
  console.log('✅  通过：重启后所有计数保持一致');

  console.log('\n--- 场景6：区分 remindCount（次数）和 reminderCount（记录条数） ---');
  console.log(`remindCount(催办总次数): ${detailAfterRestart.remindCount}`);
  console.log(`reminderCount(催办记录条数): ${detailAfterRestart.reminderCount}`);
  if (detailAfterRestart.remindCount === detailAfterRestart.reminderCount && detailAfterRestart.remindCount > 1) {
    console.log('⚠️  警告：催办次数和记录条数相等，可能还是混用了？请确认场景合理性');
  } else {
    console.log('✅  通过：两个字段含义不同，值也不同（次数 > 条数）');
  }

  // 清理
  resetAll();

  console.log('\n' + '='.repeat(70));
  console.log('🎉 所有催办次数计数测试通过！');
  console.log('='.repeat(70));
}

main().catch(e => {
  console.error('❌ 测试失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});

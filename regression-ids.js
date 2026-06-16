const { loadData, saveData } = require('./store.js');

function resetSeq(value) {
  const data = loadData();
  data.seq = value;
  saveData(data);
  console.log(`🧹 重置 seq 为 ${value}`);
}

function getSeqFromFile() {
  const data = loadData();
  return data.seq;
}

async function main() {
  console.log('='.repeat(70));
  console.log('验证测试：单号不重复 & 催办日志编号不重复');
  console.log('='.repeat(70));

  // 先重置所有数据
  const service = require('./service.js');
  service.resetAll();
  console.log('🧹 所有数据已重置');

  // 重置 seq 到一个已知值
  resetSeq(1000);

  console.log('\n--- 场景1：连续新建两张报销单 ---');
  const { createReimbursement, auditRequestSupplement, remindAgain } = require('./service.js');

  console.log(`初始 seq (文件): ${getSeqFromFile()}`);

  const r1 = createReimbursement({
    title: '测试单据1',
    amount: 100,
    type: '差旅费',
    description: '测试'
  }, 'u1');

  console.log(`第1张单号: ${r1.id}, 状态: ${r1.status}, 此时文件 seq: ${getSeqFromFile()}`);

  const r2 = createReimbursement({
    title: '测试单据2',
    amount: 200,
    type: '差旅费',
    description: '测试'
  }, 'u1');

  console.log(`第2张单号: ${r2.id}, 此时文件 seq: ${getSeqFromFile()}`);

  if (r1.id === r2.id) {
    console.log(`❌  失败：两张单据单号相同！都是 ${r1.id}`);
    process.exit(1);
  } else {
    console.log(`✅  通过：${r1.id} ≠ ${r2.id}`);
  }

  console.log('\n--- 场景2：同一单据重复催办，日志编号不重复 ---');
  // 先对 r1 发起补件（r1 是待审核状态，可以发起补件）
  console.log(`对 ${r1.id} 发起补件...`);
  await auditRequestSupplement(r1.id, 'u2', ['发票', '审批单'], 3);
  const dataAfterSupplement = loadData();
  const rm = dataAfterSupplement.reminders.find(x => x.reimbursementId === r1.id);
  console.log(`催办记录初始 ID: ${rm.id}, seq: ${getSeqFromFile()}`);

  // 连续催办3次（同一周期，应该更新同一条记录，不生成新 ID）
  const remindResults = [];
  for (let i = 1; i <= 3; i++) {
    const result = await remindAgain(r1.id, 'u2');
    remindResults.push(result);
    console.log(`第${i}次催办返回 ID: ${result.id}, 文件 seq: ${getSeqFromFile()}`);
  }

  // 验证：3次催办应该都返回同一个 ID（同一周期）
  const allSameId = remindResults.every(r => r.id === rm.id);
  if (!allSameId) {
    console.log(`❌  失败：同一周期催办返回了不同 ID！`);
    remindResults.forEach((r, i) => console.log(`   第${i+1}次: ${r.id}`));
    process.exit(1);
  } else {
    console.log(`✅  通过：同一周期催办 ID 保持不变（${rm.id}）`);
  }

  // 验证：操作日志 ID 不重复
  const dataAfter = loadData();
  const logs = dataAfter.operationLogs.filter(l => l.reimbursementId === r1.id);
  const logIds = logs.map(l => l.id);
  const uniqueLogIds = [...new Set(logIds)];
  console.log(`\n操作日志 ID: ${logIds.join(', ')}`);
  if (uniqueLogIds.length !== logIds.length) {
    console.log(`❌  失败：操作日志 ID 重复！`);
    process.exit(1);
  } else {
    console.log(`✅  通过：操作日志 ID 全部唯一`);
  }

  // 验证：催办次数正确
  const rmAfter = dataAfter.reminders.find(x => x.reimbursementId === r1.id);
  console.log(`催办次数: ${rmAfter.remindCount}（期望 4=1初始+3次催办）`);
  if (rmAfter.remindCount !== 4) {
    console.log(`❌  失败：催办次数不正确`);
    process.exit(1);
  } else {
    console.log(`✅  通过：催办次数正确`);
  }

  console.log('\n--- 场景3：重启后新增，不重复旧编号 ---');
  const seqBeforeRestart = getSeqFromFile();
  console.log(`重启前 seq: ${seqBeforeRestart}`);

  // 模拟重启：清空 require 缓存
  delete require.cache[require.resolve('./service.js')];
  delete require.cache[require.resolve('./store.js')];

  // 重新加载
  const { createReimbursement: createReimbursement2 } = require('./service.js');

  const r3 = createReimbursement2({
    title: '重启后新建',
    amount: 300,
    type: '差旅费',
    description: '测试重启后'
  }, 'u1');

  const seqAfterRestart = getSeqFromFile();
  console.log(`重启后新建单号: ${r3.id}, seq: ${seqAfterRestart}`);

  if (r3.id === r1.id || r3.id === r2.id) {
    console.log(`❌  失败：重启后新建单号与旧单号重复！`);
    process.exit(1);
  } else if (seqAfterRestart <= seqBeforeRestart) {
    console.log(`❌  失败：重启后 seq 没有递增！`);
    process.exit(1);
  } else {
    console.log(`✅  通过：重启后新增正常，单号不重复`);
  }

  console.log('\n--- 场景4：旧记录不被新编号覆盖 ---');
  const dataFinal = require('./store.js').loadData();
  const r1Exists = dataFinal.reimbursements.some(r => r.id === r1.id && r.title === '测试单据1');
  const r2Exists = dataFinal.reimbursements.some(r => r.id === r2.id && r.title === '测试单据2');
  const r3Exists = dataFinal.reimbursements.some(r => r.id === r3.id && r.title === '重启后新建');

  if (r1Exists && r2Exists && r3Exists) {
    console.log(`✅  通过：所有记录都在，没有被覆盖`);
  } else {
    console.log(`❌  失败：记录丢失或被覆盖！`);
    console.log(`   r1(${r1.id}): ${r1Exists ? '存在' : '丢失'}`);
    console.log(`   r2(${r2.id}): ${r2Exists ? '存在' : '丢失'}`);
    console.log(`   r3(${r3.id}): ${r3Exists ? '存在' : '丢失'}`);
    process.exit(1);
  }

  // 清理测试数据
  const cleanData = loadData();
  cleanData.reimbursements = cleanData.reimbursements.filter(r => 
    !['测试单据1', '测试单据2', '重启后新建'].includes(r.title)
  );
  cleanData.reminders = cleanData.reminders.filter(rm => 
    rm.reimbursementId !== r1.id
  );
  cleanData.operationLogs = cleanData.operationLogs.filter(l => 
    !['测试单据1', '测试单据2', '重启后新建'].includes(l.reimbursementId)
  );
  saveData(cleanData);
  console.log('\n🧹 测试数据已清理');

  console.log('\n' + '='.repeat(70));
  console.log('🎉 所有场景验证通过！编号生成逻辑修复成功！');
  console.log('='.repeat(70));
}

main().catch(e => {
  console.error('❌ 测试出错:', e.message);
  console.error(e.stack);
  process.exit(1);
});

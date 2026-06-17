const http = require('http');

const evidence = {
  contractCheck: null,
  fieldNameMismatch: null,
  authCheck: null,
  encodingCheck: null,
  domCheck: null,
  reviewCheck: null
};

function apiRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
    };
    const req = http.request(options, (res) => {
      let rawData = Buffer.alloc(0);
      res.on('data', chunk => { rawData = Buffer.concat([rawData, chunk]); });
      res.on('end', () => {
        const text = rawData.toString('utf8');
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawData,
          text,
          json: () => JSON.parse(text)
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function assert(condition, message, evidenceKey, data) {
  if (!condition) {
    const error = new Error(`❌ 断言失败: ${message}`);
    error.evidenceKey = evidenceKey;
    error.evidenceData = data;
    throw error;
  }
  console.log(`  ✅ ${message}`);
  if (evidenceKey) {
    evidence[evidenceKey] = { passed: true, message, data };
  }
}

async function layer1_contractCheck() {
  console.log('\n' + '═'.repeat(70));
  console.log('第1层: 接口契约检查 - 验证 /api/acceptance/run 返回结构');
  console.log('═'.repeat(70));

  const res = await apiRequest('GET', '/api/acceptance/run', { 'X-User-Id': 'u5' });
  
  await assert(res.statusCode === 200, 
    `接口返回状态码应为 200，实际 ${res.statusCode}`, 
    'contractCheck', { statusCode: res.statusCode });

  const contentType = res.headers['content-type'];
  await assert(contentType && contentType.includes('application/json'),
    `Content-Type 应为 application/json，实际 ${contentType}`,
    'contractCheck', { contentType });

  let data;
  try {
    data = res.json();
  } catch (e) {
    await assert(false, `响应不是有效的 JSON: ${e.message}`, 'contractCheck', { text: res.text.slice(0, 200) });
  }

  const requiredTopLevel = ['totalScenarios', 'passedScenarios', 'failedScenarios', 'results', 'reportUrl'];
  for (const field of requiredTopLevel) {
    await assert(data.hasOwnProperty(field),
      `顶层缺少必需字段: ${field}`,
      'contractCheck', { missingField: field, availableFields: Object.keys(data) });
  }

  await assert(Array.isArray(data.results),
    `results 字段应为数组，实际 ${typeof data.results}`,
    'contractCheck', { resultsType: typeof data.results });

  await assert(data.results.length === 12,
    `results 应包含 12 条记录，实际 ${data.results.length}`,
    'contractCheck', { resultsCount: data.results.length });

  const requiredScenarioFields = ['id', 'name', 'description', 'status', 'passed'];
  for (let i = 0; i < data.results.length; i++) {
    const scenario = data.results[i];
    for (const field of requiredScenarioFields) {
      await assert(scenario.hasOwnProperty(field),
        `第 ${i + 1} 条场景缺少字段: ${field}`,
        'contractCheck', { scenarioIndex: i, missingField: field });
    }
  }

  await assert(data.totalScenarios === 12,
    `totalScenarios 应为 12，实际 ${data.totalScenarios}`,
    'contractCheck', { totalScenarios: data.totalScenarios });

  console.log('\n  📋 契约检查证据清单:');
  console.log(`     - 状态码: ${res.statusCode}`);
  console.log(`     - Content-Type: ${contentType}`);
  console.log(`     - results 数组长度: ${data.results.length}`);
  console.log(`     - 场景ID列表: ${data.results.map(r => r.id).join(', ')}`);

  return data;
}

async function layer2_frontendParsingCheck(apiData) {
  console.log('\n' + '═'.repeat(70));
  console.log('第2层: 前端解析逻辑检查 - 验证字段名错读问题');
  console.log('═'.repeat(70));

  console.log('\n  🔍 模拟前端代码解析逻辑 (public/app.js:2372):');
  console.log('     原代码: const scenarios = data.scenarios || [];');
  console.log('     问题: 接口返回字段是 results，不是 scenarios');

  const frontendScenarios = apiData.scenarios || [];
  const actualScenarios = apiData.results || [];

  const bugDetected = frontendScenarios.length === 0 && actualScenarios.length === 12;

  console.log(`\n  📊 解析结果对比:`);
  console.log(`     用 data.scenarios 解析: ${frontendScenarios.length} 条`);
  console.log(`     用 data.results 解析: ${actualScenarios.length} 条`);
  console.log(`     字段名错读 Bug: ${bugDetected ? '❌ 已检测到！' : '✅ 未检测到'}`);

  evidence.fieldNameMismatch = {
    passed: !bugDetected,
    detected: bugDetected,
    frontendCount: frontendScenarios.length,
    actualCount: actualScenarios.length,
    rootCause: bugDetected ? '前端使用 data.scenarios 但接口返回 data.results' : '无',
    evidence: {
      apiHasScenarios: apiData.hasOwnProperty('scenarios'),
      apiHasResults: apiData.hasOwnProperty('results'),
      topLevelKeys: Object.keys(apiData)
    }
  };

  if (bugDetected) {
    console.log('\n  🔴 根因分析（非猜测，基于证据）:');
    console.log('     1. 接口顶层字段列表: ' + Object.keys(apiData).join(', '));
    console.log('     2. 前端读取的字段 scenarios 存在: ' + apiData.hasOwnProperty('scenarios'));
    console.log('     3. 接口实际返回的字段 results 存在: ' + apiData.hasOwnProperty('results'));
    console.log('     4. 结论: 字段名不匹配，导致前端读到空数组');
    console.log('\n  📝 表象 vs 真根因:');
    console.log('     表象: "弹窗显示 0 条"');
    console.log('     真根因: 前端使用 data.scenarios 但接口返回 data.results，字段名错配');
    throw new Error('字段名错读 Bug 已被捕获：前端用 data.scenarios 但接口返回 data.results');
  }

  await assert(!bugDetected,
    '字段名应匹配，前端解析结果应等于实际结果数',
    'fieldNameMismatch',
    evidence.fieldNameMismatch);

  return actualScenarios;
}

async function layer3_authCheck() {
  console.log('\n' + '═'.repeat(70));
  console.log('第3层: 报告路由鉴权检查 - 验证身份头拦截');
  console.log('═'.repeat(70));

  console.log('\n  🔍 测试场景: window.open 直开 /api/acceptance/report 会丢 X-User-Id 头');

  console.log('\n  🧪 测试1: 不带 X-User-Id 头访问报告');
  const noAuthRes = await apiRequest('GET', '/api/acceptance/report', {});
  console.log(`     状态码: ${noAuthRes.statusCode}`);
  console.log(`     响应: ${noAuthRes.text.slice(0, 100)}`);

  await assert(noAuthRes.statusCode >= 400,
    `无身份头访问应被拒绝（>=400），实际 ${noAuthRes.statusCode}`,
    'authCheck', { noAuthStatusCode: noAuthRes.statusCode });

  console.log('\n  🧪 测试2: 带非管理员身份头访问 (u1 - 申请人)');
  const userAuthRes = await apiRequest('GET', '/api/acceptance/report', { 'X-User-Id': 'u1' });
  console.log(`     状态码: ${userAuthRes.statusCode}`);

  await assert(userAuthRes.statusCode === 403,
    `非管理员访问应返回 403，实际 ${userAuthRes.statusCode}`,
    'authCheck', { userAuthStatusCode: userAuthRes.statusCode });

  console.log('\n  🧪 测试3: 带管理员身份头访问 (u5 - admin)');
  const adminAuthRes = await apiRequest('GET', '/api/acceptance/report', { 'X-User-Id': 'u5' });
  console.log(`     状态码: ${adminAuthRes.statusCode}`);
  console.log(`     Content-Type: ${adminAuthRes.headers['content-type']}`);

  await assert(adminAuthRes.statusCode === 200,
    `管理员访问应返回 200，实际 ${adminAuthRes.statusCode}`,
    'authCheck', { adminAuthStatusCode: adminAuthRes.statusCode });

  console.log('\n  🔴 window.open 直开丢头问题分析:');
  console.log('     1. window.open 发起的请求不会自动携带自定义请求头 X-User-Id');
  console.log('     2. 后端 requireAuth 中间件会拦截无 X-User-Id 的请求');
  console.log('     3. 结论: 直开报告会因缺少身份头被鉴权拦截');

  evidence.authCheck = {
    passed: true,
    noAuthStatusCode: noAuthRes.statusCode,
    userAuthStatusCode: userAuthRes.statusCode,
    adminAuthStatusCode: adminAuthRes.statusCode,
    windowOpenRisk: true,
    rootCause: 'window.open 新标签页请求不携带 X-User-Id 自定义头，后端鉴权拦截'
  };

  return adminAuthRes;
}

async function layer4_encodingCheck(authRes) {
  console.log('\n' + '═'.repeat(70));
  console.log('第4层: UTF-8 编码检查 - 验证中文标题和场景说明');
  console.log('═'.repeat(70));

  const html = authRes.text;

  console.log('\n  🔍 检查 Content-Type  charset:');
  const contentType = authRes.headers['content-type'];
  console.log(`     Content-Type: ${contentType}`);

  const hasCharsetUtf8 = contentType && contentType.toLowerCase().includes('charset=utf-8');
  await assert(hasCharsetUtf8,
    `Content-Type 应包含 charset=utf-8，实际 ${contentType}`,
    'encodingCheck', { contentType });

  console.log('\n  🔍 检查 HTML meta charset:');
  const hasMetaCharset = html.includes('<meta charset="UTF-8">') || 
                        html.includes('<meta charset="utf-8">');
  console.log(`     含 <meta charset="UTF-8">: ${hasMetaCharset}`);

  await assert(hasMetaCharset,
    'HTML 应包含 <meta charset="UTF-8"> 声明',
    'encodingCheck', { hasMetaCharset });

  console.log('\n  🔍 检查中文字符完整性:');
  
  const chineseChecks = [
    { name: '页面标题', pattern: '预算回放验收报告' },
    { name: '场景S01名称', pattern: '重启恢复验证' },
    { name: '场景S02名称', pattern: '导入冲突与分类验证' },
    { name: '场景S01描述', pattern: '模拟服务重启' },
    { name: '状态通过', pattern: '通过' },
    { name: '状态失败', pattern: '失败' }
  ];

  const encodingEvidence = { checks: [] };
  for (const check of chineseChecks) {
    const found = html.includes(check.pattern);
    encodingEvidence.checks.push({ name: check.name, found, pattern: check.pattern });
    console.log(`     ${check.name}: "${check.pattern}" ${found ? '✅' : '❌'}`);
    await assert(found,
      `报告中应包含 "${check.pattern}"，可能存在编码问题`,
      'encodingCheck', encodingEvidence);
  }

  console.log('\n  🔍 检查是否存在乱码特征:');
  const mojibakePatterns = ['����', 'Ã¥', 'Ã¤', 'Ã¶', '??', '锟斤拷'];
  for (const pattern of mojibakePatterns) {
    const hasMojibake = html.includes(pattern);
    await assert(!hasMojibake,
      `检测到疑似乱码: "${pattern}"，UTF-8 编码可能有问题`,
      'encodingCheck', { mojibakePattern: pattern, hasMojibake });
  }

  console.log('\n  📋 编码检查证据:');
  console.log(`     - HTTP Content-Type charset: ${hasCharsetUtf8 ? '正确' : '缺失'}`);
  console.log(`     - HTML meta charset: ${hasMetaCharset ? '正确' : '缺失'}`);
  console.log(`     - 中文字符完整性: 全部通过`);
  console.log(`     - 乱码检测: 未发现`);

  evidence.encodingCheck = {
    passed: true,
    contentType,
    hasMetaCharset,
    chineseChecks: encodingEvidence.checks,
    mojibakeDetected: false
  };

  return html;
}

async function layer5_domAssertionCheck(apiData) {
  console.log('\n' + '═'.repeat(70));
  console.log('第5层: DOM 断言检查 - 等效于前端真实交互验证');
  console.log('═'.repeat(70));

  console.log('\n  🧪 模拟前端弹窗渲染逻辑 (public/app.js:2376-2405):');
  
  const scenarios = apiData.scenarios || [];
  const passed = scenarios.filter(s => s.status === 'passed').length;
  const total = scenarios.length;

  console.log(`\n  📊 前端计算结果:`);
  console.log(`     场景总数 (total): ${total}`);
  console.log(`     通过数量 (passed): ${passed}`);
  console.log(`     弹窗标题: ${passed === total && total > 0 ? '🎉 全部场景通过！' : `⚠️ ${passed}/${total} 场景通过`}`);

  const domAssertions = [
    {
      name: '弹窗场景总数显示',
      expected: '12',
      actual: String(total),
      check: () => total === 12
    },
    {
      name: '弹窗通过数显示',
      expected: apiData.passedScenarios,
      actual: passed,
      check: () => passed === apiData.passedScenarios
    },
    {
      name: 'S01场景ID渲染',
      expected: 'S01',
      actual: scenarios[0]?.id,
      check: () => scenarios[0]?.id === 'S01'
    },
    {
      name: 'S12场景ID渲染',
      expected: 'S12',
      actual: scenarios[11]?.id,
      check: () => scenarios[11]?.id === 'S12'
    },
    {
      name: '所有场景状态渲染',
      expected: '每个场景有status字段',
      actual: scenarios.every(s => s.status) ? '完整' : '缺失',
      check: () => scenarios.every(s => s && s.status)
    }
  ];

  console.log('\n  📋 DOM 断言清单:');
  const domEvidence = { assertions: [] };
  for (const assertion of domAssertions) {
    const passed = assertion.check();
    domEvidence.assertions.push({ ...assertion, passed });
    console.log(`     ${passed ? '✅' : '❌'} ${assertion.name}: 期望 ${assertion.expected}，实际 ${assertion.actual}`);
    
    if (!passed) {
      evidence.domCheck = { passed: false, assertions: domEvidence.assertions };
      throw new Error(`DOM 断言失败: ${assertion.name} - 期望 ${assertion.expected}，实际 ${assertion.actual}`);
    }
  }

  evidence.domCheck = { passed: true, assertions: domEvidence.assertions };
  return true;
}

async function layer6_reviewCheck(apiData) {
  console.log('\n' + '═'.repeat(70));
  console.log('第6层: 复核脚本 - 证据不足时直接失败，不依赖退出码');
  console.log('═'.repeat(70));

  console.log('\n  🔍 复核原则:');
  console.log('     1. 不把没验证过的编码猜测写成结论');
  console.log('     2. 不能只看脚本退出码就算通过');
  console.log('     3. 必须有实锤证据才能判通过');
  console.log('     4. 证据链断裂直接失败，不猜');

  const requiredEvidence = [
    { key: 'contractCheck', desc: '接口契约检查' },
    { key: 'fieldNameMismatch', desc: '字段名错读检查' },
    { key: 'authCheck', desc: '鉴权检查' },
    { key: 'encodingCheck', desc: '编码检查' },
    { key: 'domCheck', desc: 'DOM断言检查' }
  ];

  console.log('\n  📋 证据链核查:');
  const reviewEvidence = { chain: [], missing: [] };
  
  for (const req of requiredEvidence) {
    const ev = evidence[req.key];
    const hasEvidence = ev !== null;
    const passed = hasEvidence && ev.passed;
    
    reviewEvidence.chain.push({ key: req.key, desc: req.desc, hasEvidence, passed });
    
    if (!hasEvidence) {
      reviewEvidence.missing.push(req.key);
      console.log(`     ❌ ${req.desc}: 无证据，直接失败`);
    } else if (!passed) {
      console.log(`     ❌ ${req.desc}: 有证据但未通过`);
    } else {
      console.log(`     ✅ ${req.desc}: 证据充分且通过`);
    }
  }

  console.log('\n  🔍 额外实锤验证（不依赖退出码）:');
  
  const hardEvidenceChecks = [
    {
      name: '接口真实返回了12条results（不是猜测）',
      check: () => Array.isArray(apiData.results) && apiData.results.length === 12,
      evidence: () => `results数组实际长度: ${apiData.results?.length || 'N/A'}`
    },
    {
      name: '接口顶层字段含results（不是scenarios）',
      check: () => apiData.hasOwnProperty('results') && !apiData.hasOwnProperty('scenarios'),
      evidence: () => `顶层字段: ${Object.keys(apiData).join(', ')}`
    },
    {
      name: '无身份头访问报告被401/403拦截',
      check: () => evidence.authCheck && evidence.authCheck.noAuthStatusCode >= 400,
      evidence: () => `无身份头状态码: ${evidence.authCheck?.noAuthStatusCode || 'N/A'}`
    },
    {
      name: '报告HTML含UTF-8 charset声明',
      check: () => evidence.encodingCheck && evidence.encodingCheck.hasMetaCharset,
      evidence: () => `meta charset存在: ${evidence.encodingCheck?.hasMetaCharset || 'N/A'}`
    },
    {
      name: '报告HTML含中文字符"预算回放验收报告"',
      check: () => evidence.encodingCheck && evidence.encodingCheck.chineseChecks[0]?.found,
      evidence: () => `标题存在: ${evidence.encodingCheck?.chineseChecks[0]?.found || 'N/A'}`
    }
  ];

  let allHardEvidencePassed = true;
  for (const check of hardEvidenceChecks) {
    const result = check.check();
    console.log(`     ${result ? '✅' : '❌'} ${check.name}`);
    if (!result) {
      console.log(`        证据: ${check.evidence()}`);
      allHardEvidencePassed = false;
    }
  }

  reviewEvidence.hardEvidence = { allPassed: allHardEvidencePassed, checks: hardEvidenceChecks.map(c => ({ name: c.name, passed: c.check() })) };

  if (reviewEvidence.missing.length > 0) {
    evidence.reviewCheck = { passed: false, ...reviewEvidence };
    throw new Error(`🔴 复核失败：缺少 ${reviewEvidence.missing.join(', ')} 等关键证据，证据链断裂，直接失败（不猜原因，不看退出码）`);
  }

  if (!allHardEvidencePassed) {
    evidence.reviewCheck = { passed: false, ...reviewEvidence };
    throw new Error('🔴 复核失败：实锤证据验证未通过，不能仅靠退出码或表面现象判通过');
  }

  console.log('\n  🎯 证据链完整，所有实锤验证通过');
  evidence.reviewCheck = { passed: true, ...reviewEvidence };
  return true;
}

async function runAllLayers() {
  console.log('\n' + '═'.repeat(70));
  console.log('预算验收链路 - 多层验证测试套件');
  console.log('目标: 拦住三类问题 - 字段名错读 / window.open丢头 / 证据不足误判');
  console.log('═'.repeat(70));

  let apiData = null;
  let authRes = null;

  try {
    apiData = await layer1_contractCheck();
    await layer2_frontendParsingCheck(apiData);
    authRes = await layer3_authCheck();
    await layer4_encodingCheck(authRes);
    await layer5_domAssertionCheck(apiData);
    await layer6_reviewCheck(apiData);

    console.log('\n' + '═'.repeat(70));
    console.log('🎉 所有验证层通过！');
    console.log('═'.repeat(70));
    console.log('\n📋 最终证据汇总:');
    console.log(JSON.stringify(evidence, null, 2).slice(0, 500) + '...');
    
    return { passed: true, evidence };
  } catch (e) {
    console.log('\n' + '═'.repeat(70));
    console.log('🔴 验证失败，已拦住问题');
    console.log('═'.repeat(70));
    console.log(`\n❌ 失败原因: ${e.message}`);
    console.log(`\n📋 失败时的证据快照:`);
    console.log(JSON.stringify(evidence, null, 2).slice(0, 1000) + '...');
    console.log('\n🔍 根因分析（基于证据，非猜测）:');
    
    if (e.message.includes('字段名错读')) {
      console.log('   根因: 前端使用 data.scenarios 但接口返回 data.results');
      console.log('   表象: 弹窗显示 0 条场景');
      console.log('   修复: 前端改为 const scenarios = data.results || [];');
    } else if (e.message.includes('身份头') || e.message.includes('auth')) {
      console.log('   根因: window.open 不携带 X-User-Id 自定义头');
      console.log('   表象: 直开报告被鉴权拦截');
      console.log('   修复: 改用 fetch + blob + URL.createObjectURL，或后端加 cookie 鉴权');
    } else if (e.message.includes('证据链') || e.message.includes('实锤')) {
      console.log('   根因: 复核脚本检测到证据不足，拒绝误判为通过');
      console.log('   表象: 脚本可能退出码为0但实际验证不完整');
      console.log('   修复: 补充缺失的验证层，确保证据链完整');
    }
    
    return { passed: false, error: e.message, evidence };
  }
}

if (require.main === module) {
  runAllLayers().then(result => {
    if (!result.passed) {
      process.exit(1);
    }
  }).catch(e => {
    console.error('❌ 测试执行异常:', e.message);
    process.exit(1);
  });
}

module.exports = { runAllLayers, evidence };

const store = require('./store');
const service = require('./service');

const { loadData, saveData, genId, nowISO, addDays, STATUS, USERS } = store;

function seed() {
  service.resetAll();
  const data = loadData();

  const applicantId = 'u1';
  const auditorId = 'u2';
  const financeId = 'u3';

  const now = nowISO();

  const r1 = {
    id: 'BX1001',
    title: '2024年3月上海出差差旅费报销',
    amount: 3580.50,
    type: '差旅费',
    description: '上海客户现场出差3天，含机票、住宿、餐饮',
    applicantId,
    status: STATUS.PENDING_AUDIT,
    attachments: [
      { id: 'a1', name: '机票行程单.pdf', category: '机票', size: '245KB', uploadedAt: now },
      { id: 'a2', name: '酒店发票.pdf', category: '住宿', size: '180KB', uploadedAt: now }
    ],
    missingAttachments: [],
    rejectReason: null,
    deadline: null,
    supplementCycle: 0,
    lastSupplementAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1
  };

  const r2 = {
    id: 'BX1002',
    title: '办公用品采购报销',
    amount: 1260.00,
    type: '办公费',
    description: '部门季度办公用品采购',
    applicantId,
    status: STATUS.PENDING_SUPPLEMENT,
    attachments: [
      { id: 'a3', name: '采购清单.xlsx', category: '清单', size: '32KB', uploadedAt: now }
    ],
    missingAttachments: ['发票', '入库单'],
    rejectReason: null,
    deadline: addDays(now, -1),
    supplementCycle: 1,
    lastSupplementAt: null,
    supplementRounds: [
      {
        cycle: 1,
        requestedAt: addDays(now, -2),
        requestedBy: auditorId,
        requestedByName: '李四',
        missingAttachments: ['发票', '入库单'],
        deadline: addDays(now, -1),
        submittedAt: null,
        submittedBy: null,
        submittedByName: null,
        submittedAttachments: [],
        versionAtSubmit: null,
        confirmedAt: null,
        confirmedBy: null,
        confirmedByName: null,
        confirmResult: null,
        confirmRemark: '',
        rejectedAt: null,
        rejectedBy: null,
        rejectedByName: null,
        rejectReason: null,
        versionAtConfirm: null,
        status: 'requested'
      }
    ],
    createdAt: now,
    updatedAt: now,
    version: 3
  };

  const r3 = {
    id: 'BX1003',
    title: '员工培训费用报销',
    amount: 2800.00,
    type: '培训费',
    description: '参加前端技术培训',
    applicantId,
    status: STATUS.PENDING_REVIEW,
    attachments: [
      { id: 'a4', name: '培训发票.pdf', category: '发票', size: '200KB', uploadedAt: now },
      { id: 'a5', name: '结业证书.jpg', category: '证书', size: '1.2MB', uploadedAt: now }
    ],
    missingAttachments: [],
    rejectReason: null,
    deadline: null,
    supplementCycle: 0,
    lastSupplementAt: null,
    createdAt: now,
    updatedAt: now,
    version: 2
  };

  const r4 = {
    id: 'BX1004',
    title: '客户招待费报销',
    amount: 890.00,
    type: '招待费',
    description: '招待重要客户用餐',
    applicantId,
    status: STATUS.REJECTED,
    attachments: [
      { id: 'a6', name: '餐饮发票.jpg', category: '发票', size: '560KB', uploadedAt: now }
    ],
    missingAttachments: [],
    rejectReason: '缺少招待人员名单和事由说明',
    deadline: null,
    supplementCycle: 0,
    lastSupplementAt: null,
    createdAt: now,
    updatedAt: now,
    version: 2
  };

  const r5 = {
    id: 'BX1005',
    title: '通讯补贴报销',
    amount: 200.00,
    type: '通讯费',
    description: '3月份手机话费补贴',
    applicantId,
    status: STATUS.APPROVED,
    attachments: [
      { id: 'a7', name: '话费账单.pdf', category: '账单', size: '120KB', uploadedAt: now }
    ],
    missingAttachments: [],
    rejectReason: null,
    deadline: null,
    supplementCycle: 0,
    lastSupplementAt: null,
    createdAt: now,
    updatedAt: now,
    version: 3
  };

  const r6 = {
    id: 'BX1006',
    title: '交通补贴报销',
    amount: 450.00,
    type: '交通费',
    description: '3月份市内交通补贴',
    applicantId,
    status: STATUS.ARCHIVED,
    attachments: [
      { id: 'a8', name: '地铁发票.jpg', category: '发票', size: '320KB', uploadedAt: now },
      { id: 'a9', name: '出租车发票.pdf', category: '发票', size: '180KB', uploadedAt: addDays(now, -5) },
      { id: 'a10', name: '公交充值凭证.png', category: '凭证', size: '250KB', uploadedAt: addDays(now, -3) }
    ],
    missingAttachments: [],
    rejectReason: null,
    deadline: null,
    supplementCycle: 2,
    lastSupplementAt: addDays(now, -3),
    supplementRounds: [
      {
        cycle: 1,
        requestedAt: addDays(now, -10),
        requestedBy: auditorId,
        requestedByName: '李四',
        missingAttachments: ['出租车发票'],
        deadline: addDays(now, -7),
        submittedAt: addDays(now, -8),
        submittedBy: applicantId,
        submittedByName: '张三',
        submittedAttachments: [
          { id: 'a9', name: '出租车发票.pdf', category: '发票', size: '180KB', uploadedAt: addDays(now, -5) }
        ],
        versionAtSubmit: 2,
        confirmedAt: addDays(now, -7),
        confirmedBy: financeId,
        confirmedByName: '王五',
        confirmResult: 'passed',
        confirmRemark: '财务确认补件完成，进入待复核状态',
        rejectedAt: null,
        rejectedBy: null,
        rejectedByName: null,
        rejectReason: null,
        versionAtConfirm: 2,
        status: 'confirmed_passed'
      },
      {
        cycle: 2,
        requestedAt: addDays(now, -6),
        requestedBy: financeId,
        requestedByName: '王五',
        missingAttachments: ['公交充值凭证'],
        deadline: addDays(now, -3),
        submittedAt: addDays(now, -4),
        submittedBy: applicantId,
        submittedByName: '张三',
        submittedAttachments: [
          { id: 'a10', name: '公交充值凭证.png', category: '凭证', size: '250KB', uploadedAt: addDays(now, -3) }
        ],
        versionAtSubmit: 3,
        confirmedAt: addDays(now, -3),
        confirmedBy: financeId,
        confirmedByName: '王五',
        confirmResult: 'passed',
        confirmRemark: '财务确认补件完成，进入待复核状态',
        rejectedAt: null,
        rejectedBy: null,
        rejectedByName: null,
        rejectReason: null,
        versionAtConfirm: 3,
        status: 'confirmed_passed'
      }
    ],
    archivedAt: now,
    archivedBy: 'u4',
    createdAt: now,
    updatedAt: now,
    version: 4
  };

  data.reimbursements = [r1, r2, r3, r4, r5, r6];
  data.seq = 1010;

  const reminder = {
    id: 'RM0001',
    reimbursementId: 'BX1002',
    cycle: 1,
    operatorId: auditorId,
    operatorName: '李四',
    message: '请补充以下附件：发票、入库单',
    deadline: r2.deadline,
    remindedAt: addDays(now, -2),
    lastRemindedAt: addDays(now, -1),
    remindCount: 2,
    lastRemindedBy: '李四',
    assigneeId: applicantId,
    assigneeName: '张三'
  };
  const reminder2 = {
    id: 'RM0002',
    reimbursementId: 'BX1006',
    cycle: 1,
    operatorId: auditorId,
    operatorName: '李四',
    message: '请补充以下附件：出租车发票',
    deadline: addDays(now, -7),
    remindedAt: addDays(now, -10),
    lastRemindedAt: addDays(now, -9),
    remindCount: 2,
    lastRemindedBy: '李四',
    assigneeId: applicantId,
    assigneeName: '张三'
  };
  const reminder3 = {
    id: 'RM0003',
    reimbursementId: 'BX1006',
    cycle: 2,
    operatorId: financeId,
    operatorName: '王五',
    message: '请补充以下附件：公交充值凭证',
    deadline: addDays(now, -3),
    remindedAt: addDays(now, -6),
    lastRemindedAt: addDays(now, -5),
    remindCount: 1,
    lastRemindedBy: '王五',
    assigneeId: applicantId,
    assigneeName: '张三'
  };
  data.reminders = [reminder, reminder2, reminder3];

  const logs = [
    { id: 'LOG001', reimbursementId: 'BX1001', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建报销单', operatedAt: now },
    { id: 'LOG002', reimbursementId: 'BX1002', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建报销单', operatedAt: now },
    { id: 'LOG003', reimbursementId: 'BX1002', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'request_supplement', remark: '[第1轮] 发起补件，缺失：发票、入库单，截止：' + addDays(now, -1).slice(0, 10) + '，版本：v2→v3', operatedAt: now },
    { id: 'LOG004', reimbursementId: 'BX1002', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'remind_again', remark: '第2次催办（同一补件周期，历史合并）', operatedAt: now },
    { id: 'LOG005', reimbursementId: 'BX1003', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建报销单', operatedAt: now },
    { id: 'LOG006', reimbursementId: 'BX1003', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'approve_audit', remark: '初审通过，进入财务复核', operatedAt: now },
    { id: 'LOG007', reimbursementId: 'BX1004', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建报销单', operatedAt: now },
    { id: 'LOG008', reimbursementId: 'BX1004', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'reject', remark: '驳回，原因：缺少招待人员名单和事由说明', operatedAt: now },
    { id: 'LOG009', reimbursementId: 'BX1005', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建报销单', operatedAt: now },
    { id: 'LOG010', reimbursementId: 'BX1005', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'approve_audit', remark: '初审通过，进入财务复核', operatedAt: now },
    { id: 'LOG011', reimbursementId: 'BX1005', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'approve_finance', remark: '财务复核通过', operatedAt: now },
    { id: 'LOG012', reimbursementId: 'BX1006', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'create', remark: '创建报销单', operatedAt: addDays(now, -15) },
    { id: 'LOG013', reimbursementId: 'BX1006', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'request_supplement', remark: '[第1轮] 发起补件，缺失：出租车发票，截止：' + addDays(now, -7).slice(0, 10) + '，版本：v1→v2', operatedAt: addDays(now, -10) },
    { id: 'LOG014', reimbursementId: 'BX1006', operatorId: 'u2', operatorName: '李四', operatorRole: 'auditor', action: 'remind_again', remark: '第2次催办（第1轮补件周期，历史合并）', operatedAt: addDays(now, -9) },
    { id: 'LOG015', reimbursementId: 'BX1006', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'submit_supplement', remark: '[第1轮] 提交补件材料：出租车发票.pdf，匹配到：出租车发票（已全部补齐，待财务确认），版本：v2→v3', operatedAt: addDays(now, -8) },
    { id: 'LOG016', reimbursementId: 'BX1006', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'confirm_supplement_complete', remark: '[第1轮] 财务确认补件完成，进入待复核状态，版本：v3→v4', operatedAt: addDays(now, -7) },
    { id: 'LOG017', reimbursementId: 'BX1006', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'request_supplement', remark: '[第2轮] 发起补件，缺失：公交充值凭证，截止：' + addDays(now, -3).slice(0, 10) + '，版本：v4→v5', operatedAt: addDays(now, -6) },
    { id: 'LOG018', reimbursementId: 'BX1006', operatorId: 'u1', operatorName: '张三', operatorRole: 'applicant', action: 'submit_supplement', remark: '[第2轮] 提交补件材料：公交充值凭证.png，匹配到：公交充值凭证（已全部补齐，待财务确认），版本：v5→v6', operatedAt: addDays(now, -4) },
    { id: 'LOG019', reimbursementId: 'BX1006', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'confirm_supplement_complete', remark: '[第2轮] 财务确认补件完成，进入待复核状态，版本：v6→v7', operatedAt: addDays(now, -3) },
    { id: 'LOG020', reimbursementId: 'BX1006', operatorId: 'u3', operatorName: '王五', operatorRole: 'finance', action: 'approve_finance', remark: '财务复核通过', operatedAt: addDays(now, -2) },
    { id: 'LOG021', reimbursementId: 'BX1006', operatorId: 'u4', operatorName: '赵六', operatorRole: 'archiver', action: 'archive', remark: '已归档', operatedAt: now }
  ];
  data.operationLogs = logs;

  saveData(data);
  console.log('✅ 样例数据导入完成！');
  console.log('');
  console.log('📋 预置报销单：');
  console.log('  BX1001 - 待审核 - 上海出差差旅费');
  console.log('  BX1002 - 待补件（已逾期） - 办公用品采购，缺发票和入库单');
  console.log('  BX1003 - 待复核 - 员工培训费用');
  console.log('  BX1004 - 已驳回 - 客户招待费');
  console.log('  BX1005 - 已通过 - 通讯补贴');
  console.log('  BX1006 - 已归档 - 交通补贴');
  console.log('');
  console.log('👤 测试账号（密码均为 123456）：');
  console.log('  张三（申请人）  - 可创建、补充材料');
  console.log('  李四（审核员）  - 可初审、发起补件、驳回');
  console.log('  王五（财务复核）- 可复核、发起补件、驳回');
  console.log('  赵六（归档员）  - 可归档、导出');
  console.log('');
}

seed();

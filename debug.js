const store = require('./store');
const { matchAttachmentToMissing } = store;

const data = store.loadData();
const r = data.reimbursements.find(x => x.id === 'BX1002');
console.log('BX1002 status:', r.status);
console.log('BX1002 missingAttachments:', r.missingAttachments);
console.log('BX1002 attachments:', r.attachments.map(a => ({ name: a.name, category: a.category })));

const newAtts = [{ id: 't1', name: '情况说明.txt', category: '说明', size: '10KB' }];
console.log('\n新附件:', newAtts.map(a => ({ name: a.name, category: a.category })));

const result = matchAttachmentToMissing(newAtts, r.missingAttachments);
console.log('\n匹配结果:');
console.log('  matched:', result.matched.map(m => `${m.missing} <- ${m.attachment.name}`));
console.log('  unmatched:', result.unmatched);

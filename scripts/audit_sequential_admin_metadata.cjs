// Read-only reproduction: asserts the current metadata defects, not desired behavior.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const loader = fs.readFileSync(path.resolve('app/reception/dispatch/useDispatchBoard.logic.ts'), 'utf8');
const noteExpression = loader.match(/noteForKtv: (bi\.options[^\n]+),/)[1];
const bi = { options: JSON.stringify({ notesForKtvs: { 'DEMO-B': 'B cần lực nhẹ' } }) };
const tCode = 'DEMO-B';
const actualNote = Function('bi','tCode',`return (${noteExpression})`)(bi,tCode);
assert.equal(actualNote,'');
assert.equal(JSON.parse(bi.options).notesForKtvs[tCode],'B cần lực nhẹ');
console.log('CONFIRMED: actual admin loader expression drops notes from JSON options');
const filename = path.resolve('scripts/test_sequential_flows.cjs');
let source = fs.readFileSync(filename,'utf8');
source = source.replace('} finally { global.Date = originalDate;', `
  reset(); chooseA(); minutes(0,30); send(); sequential(); assignLiveB();
  const legacy=order();
  legacy.services[0].options.serviceNamesForKtvs={'demo-b':'Tên riêng B đã lưu'};
  const parsedOptions=legacy.services[0].options;
  const tCode='DEMO-B';
  // Populate row with the exact current loader expression, then execute actual Quick hooks.
  legacy.services[0].staffList.find(row=>row.ktvId===tCode).serviceNameForKtv=(${loader.match(/serviceNameForKtv: (parsedOptions[^\n]+)[\r\n]/)[1]});
  data.set(key,JSON.stringify(legacy));app=hooks(SequentialDemo);quick=card=null;flush();
  const ownNameInput=elements(card.tree,e=>e.props['aria-label']==='Tên dịch vụ riêng của DEMO-B')[0];
  assert.equal(ownNameInput.props.value,'');
  const employeeBefore=renderToStaticMarkup(React.createElement(AccountDemo,{service:service(),employeeId:'DEMO-B',employeeName:'B',now}));
  assert.ok(employeeBefore.includes('Tên riêng B đã lưu'));
  name('DEMO-A','Tên A thay đổi');
  assert.equal(service().options.serviceNamesForKtvs?.['demo-b'],undefined);
  const employeeAfter=renderToStaticMarkup(React.createElement(AccountDemo,{service:service(),employeeId:'DEMO-B',employeeName:'B',now}));
  assert.ok(!employeeAfter.includes('Tên riêng B đã lưu'));
  originalLog('CONFIRMED: case-variant stored B name shown to employee but blank in admin; changing A deletes B override');
} finally { global.Date = originalDate;`);
const loaded = new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));loaded._compile(source,filename);

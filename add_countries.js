const fs = require('fs');
fetch('https://gist.githubusercontent.com/anubhavshrimal/75f6183458db8c453306f93521e93d37/raw/f77e7598a8503f1f70528ae1cbf9f66755698a16/CountryCodes.json')
  .then(res => res.json())
  .then(data => {
    let options = '';
    data.forEach(c => {
      const code = c.code;
      const flag = code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
      options += `                           <option value="${c.dial_code}">${flag} ${c.dial_code} (${code})</option>\n`;
    });
    const file = 'components/shared/ScheduleBoard/ScheduleBoard.tsx';
    let content = fs.readFileSync(file, 'utf8');
    const startTag = '<datalist id="phone-codes">';
    const endTag = '</datalist>';
    const startIndex = content.indexOf(startTag);
    const endIndex = content.indexOf(endTag) + endTag.length;
    if (startIndex !== -1 && endIndex !== -1) {
      content = content.substring(0, startIndex) + startTag + '\n' + options + '                        ' + endTag + content.substring(endIndex);
      fs.writeFileSync(file, content, 'utf8');
      console.log('Replaced successfully with ' + data.length + ' countries.');
    } else {
      console.log('Could not find datalist tags');
    }
  }).catch(e => console.error(e));

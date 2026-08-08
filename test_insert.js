const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  'https://adzfohfdindovfcpaizb.supabase.co', 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
sb.from('TaskTemplates').select('id').limit(1).then(({data}) => {
  const tplId = data[0].id;
  sb.from('Rooms').select('id').limit(1).then(({data: rData}) => {
    const roomId = rData[0].id;
    sb.from('RoomTaskTemplates').insert({template_id: tplId, room_id: roomId}).then(res => {
      console.log('Insert res:', res);
      process.exit(0);
    });
  });
});
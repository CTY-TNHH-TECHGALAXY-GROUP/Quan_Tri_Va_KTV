const fs = require('fs');
const file = 'app/reception/dispatch/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace standard fetchData() calls with debouncedFetchData() ONLY inside the channel setup
const parts = content.split('const channel = supabase');
if (parts.length > 1) {
  const channelSetup = 'const channel = supabase' + parts[1].split('.subscribe();')[0] + '.subscribe();';
  let newChannelSetup = channelSetup.replace(/fetchData\(\)/g, 'debouncedFetchData()');
  
  const setupPrefix = `
      let fetchTimeout: NodeJS.Timeout;
      const debouncedFetchData = () => {
        clearTimeout(fetchTimeout);
        fetchTimeout = setTimeout(() => {
          console.log('⚡ [Dispatch] Debounced fetch triggering...');
          fetchData();
        }, 1000);
      };
      
      `;

  content = content.replace(channelSetup, setupPrefix + newChannelSetup);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Success');
} else {
  console.log('Failed to find channel setup');
}

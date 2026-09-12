const allMySegs = [
  { duration: 2, actualStartTime: new Date(Date.now() - 120000).toISOString() }, // 2 mins ago
  { duration: 2, actualStartTime: undefined } // Hasn't started
];

const totalSegDuration = allMySegs.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0);
const totalSecs = totalSegDuration * 60; // 4 * 60 = 240
const activeSegStartTime = allMySegs[0].actualStartTime;
const start = new Date(activeSegStartTime).getTime();
const now = new Date().getTime();
const elapsed = Math.floor((now - start) / 1000); // 120
const newRemaining = Math.max(0, totalSecs - elapsed); // 240 - 120 = 120

console.log({ totalSegDuration, totalSecs, elapsed, newRemaining });

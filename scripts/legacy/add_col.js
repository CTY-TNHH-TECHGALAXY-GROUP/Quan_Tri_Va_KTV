
const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });
const client = new Client({ connectionString: process.env.DIRECT_URL });
client.connect().then(() => {
  return client.query(`ALTER TABLE "PreBookings" ADD COLUMN IF NOT EXISTS customer_email TEXT;`);
}).then(() => {
  console.log("Column added successfully");
  client.end();
}).catch(err => {
  console.error(err);
  client.end();
});


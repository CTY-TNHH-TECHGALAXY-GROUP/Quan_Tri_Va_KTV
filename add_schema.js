
const fs = require("fs");
const file = "TableInSupabase.md";
let content = fs.readFileSync(file, "utf8");
content = content.replace(
    "| `customer_email` | text | Email khách hàng (tu? ch?n) |",
    "| `customer_email` | text | Email khách hàng (tu? ch?n) |\n| `menu_type` | text | Lo?i menu khách h?n (standard/vip/spa) |"
);
fs.writeFileSync(file, content, "utf8");


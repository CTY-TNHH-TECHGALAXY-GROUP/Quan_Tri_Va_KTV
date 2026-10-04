import type { PromotionMenu } from '@/lib/types/promotion-client';

/**
 * Snapshot of the live Services catalogue (2026-10-04), shaped like
 * promo_menu_catalog: menu = service id prefix, categories = Services.category as stored in DB.
 * Includes isActive=false services — they are still booked (whole NHT menu). Mock mode only;
 * regenerate from the DB rather than editing by hand.
 */
export const MOCK_MENUS: PromotionMenu[] = [
  {
    "code": "NHP",
    "label": "Menu VIP",
    "serviceCount": 14,
    "categories": [
      {
        "code": "VIP_MENU",
        "label": "Vip_Menu",
        "serviceCount": 14
      }
    ],
    "services": [
      {
        "id": "NHP0001",
        "name": "VIP 1 KTV (60 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0002",
        "name": "VIP 1 KTV (70 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0003",
        "name": "VIP 1 KTV (90 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0004",
        "name": "VIP 1 KTV (120 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0005",
        "name": "VIP 1 KTV (150 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0006",
        "name": "VIP 1 KTV (180 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0007",
        "name": "VIP 1 KTV (240 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0008",
        "name": "VIP 2 KTV (60 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0009",
        "name": "VIP 2 KTV (70 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0010",
        "name": "VIP 2 KTV (90 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0011",
        "name": "VIP 2 KTV (120 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0012",
        "name": "VIP 2 KTV (150 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0013",
        "name": "VIP 2 KTV (180 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      },
      {
        "id": "NHP0014",
        "name": "VIP 2 KTV (240 phút)",
        "category": "VIP_MENU",
        "categoryCodes": [
          "VIP_MENU"
        ]
      }
    ]
  },
  {
    "code": "NHS",
    "label": "Menu Standard",
    "serviceCount": 128,
    "categories": [
      {
        "code": "ADDITIONAL",
        "label": "Additional",
        "serviceCount": 9
      },
      {
        "code": "BARBER",
        "label": "Barber",
        "serviceCount": 8
      },
      {
        "code": "BODY",
        "label": "Body",
        "serviceCount": 63
      },
      {
        "code": "EAR CLEAN",
        "label": "Ear Clean",
        "serviceCount": 15
      },
      {
        "code": "FACIAL",
        "label": "Facial",
        "serviceCount": 6
      },
      {
        "code": "FOOT",
        "label": "Foot",
        "serviceCount": 13
      },
      {
        "code": "HAIR WASH",
        "label": "Hair Wash",
        "serviceCount": 8
      },
      {
        "code": "HEEL SKIN SHAVE",
        "label": "Heel Skin Shave",
        "serviceCount": 4
      },
      {
        "code": "MANICURE & PEDICURE",
        "label": "Manicure & Pedicure",
        "serviceCount": 4
      },
      {
        "code": "PACKAGE",
        "label": "Package",
        "serviceCount": 12
      },
      {
        "code": "PREMIUM",
        "label": "Premium",
        "serviceCount": 1
      }
    ],
    "services": [
      {
        "id": "NHS0000",
        "name": "Dịch vụ TEST (1 Phút)",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0001",
        "name": "Tinh dầu",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0002",
        "name": "Tinh dầu",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0003",
        "name": "Tinh dầu",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0004",
        "name": "Tinh dầu",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0005",
        "name": "Tinh dầu",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0006",
        "name": "Tinh dầu",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0007",
        "name": "Tinh dầu",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0008",
        "name": "Tinh dầu dừa",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0009",
        "name": "Tinh dầu dừa",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0010",
        "name": "Tinh dầu dừa",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0011",
        "name": "Tinh dầu dừa",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0012",
        "name": "Tinh dầu dừa",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0013",
        "name": "Tinh dầu dừa",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0014",
        "name": "Tinh dầu dừa",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0015",
        "name": "Ấn huyệt",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0016",
        "name": "Ấn huyệt",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0017",
        "name": "Ấn huyệt",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0018",
        "name": "Ấn huyệt",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0019",
        "name": "Ấn huyệt",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0020",
        "name": "Ấn huyệt",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0021",
        "name": "Ấn huyệt",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0022",
        "name": "Đá nóng",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0023",
        "name": "Đá nóng",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0024",
        "name": "Đá nóng",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0025",
        "name": "Đá nóng",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0026",
        "name": "Đá nóng",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0027",
        "name": "Đá nóng",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0028",
        "name": "Thái",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0029",
        "name": "Thái",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0030",
        "name": "Thái",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0031",
        "name": "Thái",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0032",
        "name": "Thái",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0033",
        "name": "Thái",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0034",
        "name": "Hai kỹ thuật viên",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0035",
        "name": "Hai kỹ thuật viên",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0036",
        "name": "Hai kỹ thuật viên",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0037",
        "name": "Hai kỹ thuật viên",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0038",
        "name": "Hai kỹ thuật viên",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0039",
        "name": "Hai kỹ thuật viên",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0040",
        "name": "Kết hợp 4 liệu trình",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0041",
        "name": "Kết hợp 4 liệu trình",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0042",
        "name": "Kết hợp 4 liệu trình",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0043",
        "name": "Kết hợp 4 liệu trình",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0044",
        "name": "Kết hợp 4 liệu trình",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0045",
        "name": "Kết hợp 4 liệu trình",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0046",
        "name": "Không dầu",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0047",
        "name": "Không dầu",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0048",
        "name": "Không dầu",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0049",
        "name": "Không dầu",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0050",
        "name": "Không dầu",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0051",
        "name": "Không dầu",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0052",
        "name": "Không dầu",
        "category": "[\"Body\"]",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHS0100",
        "name": "Ấn huyệt chân chuyên nghiệp",
        "category": "[\"Foot\"]",
        "categoryCodes": [
          "FOOT"
        ]
      },
      {
        "id": "NHS0101",
        "name": "Ấn huyệt chân chuyên nghiệp",
        "category": "[\"Foot\"]",
        "categoryCodes": [
          "FOOT"
        ]
      },
      {
        "id": "NHS0102",
        "name": "Ấn huyệt chân chuyên nghiệp",
        "category": "[\"Foot\"]",
        "categoryCodes": [
          "FOOT"
        ]
      },
      {
        "id": "NHS0103",
        "name": "Ấn huyệt chân chuyên nghiệp",
        "category": "[\"Foot\"]",
        "categoryCodes": [
          "FOOT"
        ]
      },
      {
        "id": "NHS0104",
        "name": "Ấn huyệt chân chuyên nghiệp",
        "category": "[\"Foot\"]",
        "categoryCodes": [
          "FOOT"
        ]
      },
      {
        "id": "NHS0105",
        "name": "Ấn huyệt chân chuyên nghiệp",
        "category": "[\"Foot\"]",
        "categoryCodes": [
          "FOOT"
        ]
      },
      {
        "id": "NHS0106",
        "name": "Ấn huyệt chân chuyên nghiệp",
        "category": "[\"Foot\"]",
        "categoryCodes": [
          "FOOT"
        ]
      },
      {
        "id": "NHS0107",
        "name": "Ấn huyệt chân chuyên nghiệp",
        "category": "[\"Foot\"]",
        "categoryCodes": [
          "FOOT"
        ]
      },
      {
        "id": "NHS0200",
        "name": "Gội đầu",
        "category": "Hair Wash",
        "categoryCodes": [
          "HAIR WASH"
        ]
      },
      {
        "id": "NHS0201",
        "name": "Gội đầu",
        "category": "Hair Wash",
        "categoryCodes": [
          "HAIR WASH"
        ]
      },
      {
        "id": "NHS0202",
        "name": "Gội đầu",
        "category": "Hair Wash",
        "categoryCodes": [
          "HAIR WASH"
        ]
      },
      {
        "id": "NHS0203",
        "name": "Gói gội đầu 1",
        "category": "Hair Wash",
        "categoryCodes": [
          "HAIR WASH"
        ]
      },
      {
        "id": "NHS0204",
        "name": "Gói gội đầu 2",
        "category": "Hair Wash",
        "categoryCodes": [
          "HAIR WASH"
        ]
      },
      {
        "id": "NHS0205",
        "name": "Gói gội đầu 3",
        "category": "Hair Wash",
        "categoryCodes": [
          "HAIR WASH"
        ]
      },
      {
        "id": "NHS0206",
        "name": "Gói gội đầu 4",
        "category": "Hair Wash",
        "categoryCodes": [
          "HAIR WASH"
        ]
      },
      {
        "id": "NHS0207",
        "name": "Gói gội đầu 5",
        "category": "Hair Wash",
        "categoryCodes": [
          "HAIR WASH"
        ]
      },
      {
        "id": "NHS0300",
        "name": "Chăm sóc da mặt",
        "category": "Facial",
        "categoryCodes": [
          "FACIAL"
        ]
      },
      {
        "id": "NHS0301",
        "name": "Chăm sóc da mặt",
        "category": "Facial",
        "categoryCodes": [
          "FACIAL"
        ]
      },
      {
        "id": "NHS0302",
        "name": "Gói chăm sóc da mặt 1",
        "category": "Facial",
        "categoryCodes": [
          "FACIAL"
        ]
      },
      {
        "id": "NHS0303",
        "name": "Gói chăm sóc da mặt 2",
        "category": "Facial",
        "categoryCodes": [
          "FACIAL"
        ]
      },
      {
        "id": "NHS0304",
        "name": "Gói chăm sóc da mặt 3",
        "category": "Facial",
        "categoryCodes": [
          "FACIAL"
        ]
      },
      {
        "id": "NHS0400",
        "name": "Chà gót chân",
        "category": "Additional",
        "categoryCodes": [
          "ADDITIONAL"
        ]
      },
      {
        "id": "NHS0401",
        "name": "Gói chà gót chân 1",
        "category": "Heel Skin Shave",
        "categoryCodes": [
          "HEEL SKIN SHAVE"
        ]
      },
      {
        "id": "NHS0402",
        "name": "Gói chà gót chân 2",
        "category": "Heel Skin Shave",
        "categoryCodes": [
          "HEEL SKIN SHAVE"
        ]
      },
      {
        "id": "NHS0403",
        "name": "Gói chà gót chân 3",
        "category": "Heel Skin Shave",
        "categoryCodes": [
          "HEEL SKIN SHAVE"
        ]
      },
      {
        "id": "NHS0404",
        "name": "Gói chà gót chân 4",
        "category": "Heel Skin Shave",
        "categoryCodes": [
          "HEEL SKIN SHAVE"
        ]
      },
      {
        "id": "NHS0500",
        "name": "Làm móng tay & chân",
        "category": "[\"Additional\"]",
        "categoryCodes": [
          "ADDITIONAL"
        ]
      },
      {
        "id": "NHS0501",
        "name": "Gói làm móng tay + chân 1",
        "category": "[\"Manicure & Pedicure\"]",
        "categoryCodes": [
          "MANICURE & PEDICURE"
        ]
      },
      {
        "id": "NHS0502",
        "name": "Gói làm móng tay + chân 2",
        "category": "Manicure & Pedicure",
        "categoryCodes": [
          "MANICURE & PEDICURE"
        ]
      },
      {
        "id": "NHS0503",
        "name": "Gói làm móng tay + chân 3",
        "category": "Manicure & Pedicure",
        "categoryCodes": [
          "MANICURE & PEDICURE"
        ]
      },
      {
        "id": "NHS0504",
        "name": "Gói làm móng tay + chân 4",
        "category": "Manicure & Pedicure",
        "categoryCodes": [
          "MANICURE & PEDICURE"
        ]
      },
      {
        "id": "NHS0600",
        "name": "Lấy ráy tai",
        "category": "Ear Clean",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS0601",
        "name": "Lấy ráy tai",
        "category": "Ear Clean",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS0602",
        "name": "Lấy ráy tai",
        "category": "Ear Clean",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS0603",
        "name": "70m | Lấy ráy tai, đầu vai cổ và chăm sóc chân",
        "category": "Ear Clean",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS0604",
        "name": "90m | Lấy ráy tai, đầu vai cổ và chăm sóc chân",
        "category": "Ear Clean",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS0605",
        "name": "70m | Lấy ráy tai, đầu vai cổ, chăm sóc toàn thân",
        "category": "Ear Clean",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS0606",
        "name": "90m | Lấy ráy tai, đầu vai cổ, chăm sóc toàn thân",
        "category": "Ear Clean",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS0607",
        "name": "120m | Lấy ráy tai, đầu vai cổ, chăm sóc toàn thân, mặt & gội",
        "category": "Ear Clean",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS0700",
        "name": "Cạo/tỉa râu",
        "category": "[\"Barber\"]",
        "categoryCodes": [
          "BARBER"
        ]
      },
      {
        "id": "NHS0701",
        "name": "Cắt tóc",
        "category": "[\"Barber\"]",
        "categoryCodes": [
          "BARBER"
        ]
      },
      {
        "id": "NHS0702",
        "name": "Gói cắt tóc 1",
        "category": "[\"Barber\"]",
        "categoryCodes": [
          "BARBER"
        ]
      },
      {
        "id": "NHS0703",
        "name": "Gói cắt tóc 2",
        "category": "Barber",
        "categoryCodes": [
          "BARBER"
        ]
      },
      {
        "id": "NHS0704",
        "name": "Gói cắt tóc 3",
        "category": "[\"Barber\"]",
        "categoryCodes": [
          "BARBER"
        ]
      },
      {
        "id": "NHS0705",
        "name": "Gói cắt tóc 4",
        "category": "Barber",
        "categoryCodes": [
          "BARBER"
        ]
      },
      {
        "id": "NHS0706",
        "name": "Gói cắt tóc 5",
        "category": "Barber",
        "categoryCodes": [
          "BARBER"
        ]
      },
      {
        "id": "NHS0800",
        "name": "Gói dịch vụ cao cấp",
        "category": "[\"Premium\"]",
        "categoryCodes": [
          "PREMIUM"
        ]
      },
      {
        "id": "NHS0902",
        "name": "Cắt tóc",
        "category": "[\"Barber\"]",
        "categoryCodes": [
          "BARBER"
        ]
      },
      {
        "id": "NHS0903",
        "name": "Cạo râu (dao cạo)",
        "category": "Additional",
        "categoryCodes": [
          "ADDITIONAL"
        ]
      },
      {
        "id": "NHS0904",
        "name": "Chăm sóc da mặt",
        "category": "Facial",
        "categoryCodes": [
          "FACIAL"
        ]
      },
      {
        "id": "NHS0905",
        "name": "Chà gót chân",
        "category": "Additional",
        "categoryCodes": [
          "ADDITIONAL"
        ]
      },
      {
        "id": "NHS0906",
        "name": "Làm móng tay & chân",
        "category": "[\"Additional\"]",
        "categoryCodes": [
          "ADDITIONAL"
        ]
      },
      {
        "id": "NHS0907",
        "name": "Mát-xa chân",
        "category": "[\"Additional\"]",
        "categoryCodes": [
          "ADDITIONAL"
        ]
      },
      {
        "id": "NHS0908",
        "name": "Mát-xa lưng",
        "category": "[\"Additional\"]",
        "categoryCodes": [
          "ADDITIONAL"
        ]
      },
      {
        "id": "NHS0909",
        "name": "Mát-xa đầu cổ vai & tay",
        "category": "[\"Additional\"]",
        "categoryCodes": [
          "ADDITIONAL"
        ]
      },
      {
        "id": "NHS0910",
        "name": "Gội đầu & sấy khô",
        "category": "Additional",
        "categoryCodes": [
          "ADDITIONAL"
        ]
      },
      {
        "id": "NHS1000",
        "name": "Mát-xa chân - Cắt móng (tay & chân) - Chà gót",
        "category": "[\"Package\",\"Foot\"]",
        "categoryCodes": [
          "PACKAGE",
          "FOOT"
        ]
      },
      {
        "id": "NHS1001",
        "name": "Ráy tai - Gội đầu - Cổ vai gáy",
        "category": "[\"Ear Clean\"]",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS1002",
        "name": "Ráy tai - Gội đầu - Cổ vai gáy",
        "category": "[\"Ear Clean\"]",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS1003",
        "name": "Ráy tai - Cổ vai gáy - Mát-xa chân",
        "category": "[\"Ear Clean\"]",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS1004",
        "name": "Ráy tai - Cổ vai gáy - Mát-xa chân",
        "category": "[\"Ear Clean\"]",
        "categoryCodes": [
          "EAR CLEAN"
        ]
      },
      {
        "id": "NHS1005",
        "name": "Ráy tai - Cổ vai gáy - Body",
        "category": "[\"Ear Clean\",\"Body\"]",
        "categoryCodes": [
          "EAR CLEAN",
          "BODY"
        ]
      },
      {
        "id": "NHS1006",
        "name": "Ráy tai - Cổ vai gáy - Body",
        "category": "[\"Ear Clean\",\"Body\"]",
        "categoryCodes": [
          "EAR CLEAN",
          "BODY"
        ]
      },
      {
        "id": "NHS1007",
        "name": "Ráy tai - Body - Cổ vai gáy - Gội đầu",
        "category": "[\"Ear Clean\",\"Body\"]",
        "categoryCodes": [
          "EAR CLEAN",
          "BODY"
        ]
      },
      {
        "id": "NHS1009",
        "name": "Gội đầu - Cổ vai gáy - Mát-xa chân",
        "category": "[\"Package\",\"Foot\"]",
        "categoryCodes": [
          "PACKAGE",
          "FOOT"
        ]
      },
      {
        "id": "NHS1010",
        "name": "Gội đầu - Cổ vai gáy - Mát-xa chân",
        "category": "[\"Package\",\"Foot\"]",
        "categoryCodes": [
          "PACKAGE",
          "FOOT"
        ]
      },
      {
        "id": "NHS1011",
        "name": "Gội đầu - Cổ vai gáy - Body",
        "category": "[\"Package\",\"Body\"]",
        "categoryCodes": [
          "PACKAGE",
          "BODY"
        ]
      },
      {
        "id": "NHS1012",
        "name": "Gội đầu - Cổ vai gáy - Body",
        "category": "[\"Package\",\"Body\"]",
        "categoryCodes": [
          "PACKAGE",
          "BODY"
        ]
      },
      {
        "id": "NHS1013",
        "name": "Gội đầu - Chăm sóc da mặt - Cổ vai gáy - Chân - Body",
        "category": "[\"Package\",\"Body\"]",
        "categoryCodes": [
          "PACKAGE",
          "BODY"
        ]
      },
      {
        "id": "NHS1014",
        "name": "Chăm sóc da mặt - Cạo râu (cạo máy) - Cổ vai gáy - Body - Gội nhanh",
        "category": "[\"Package\",\"Body\"]",
        "categoryCodes": [
          "PACKAGE",
          "BODY"
        ]
      },
      {
        "id": "NHS1015",
        "name": "Chăm sóc da mặt - Cạo râu (cạo máy) - Cổ vai gáy - Body - Gội nhanh",
        "category": "[\"Package\",\"Body\"]",
        "categoryCodes": [
          "PACKAGE",
          "BODY"
        ]
      },
      {
        "id": "NHS1016",
        "name": "Chà gót - Cắt móng (tay & chân) - Mát-xa chân",
        "category": "[\"Package\",\"Foot\"]",
        "categoryCodes": [
          "PACKAGE",
          "FOOT"
        ]
      },
      {
        "id": "NHS1017",
        "name": "Chà gót - Cắt móng (tay & chân) - Mát-xa chân",
        "category": "[\"Package\",\"Foot\"]",
        "categoryCodes": [
          "PACKAGE",
          "FOOT"
        ]
      },
      {
        "id": "NHS1018",
        "name": "Chà gót chân - Cắt móng (tay & chân) - Body",
        "category": "[\"Package\",\"Body\"]",
        "categoryCodes": [
          "PACKAGE",
          "BODY"
        ]
      },
      {
        "id": "NHS1019",
        "name": "Chà gót chân - Cắt móng (tay & chân) - Body",
        "category": "[\"Package\",\"Body\"]",
        "categoryCodes": [
          "PACKAGE",
          "BODY"
        ]
      }
    ]
  },
  {
    "code": "NHT",
    "label": "Menu Deep Body",
    "serviceCount": 6,
    "categories": [
      {
        "code": "BODY",
        "label": "Body",
        "serviceCount": 6
      }
    ],
    "services": [
      {
        "id": "NHT0001",
        "name": "Điều trị Therapy",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHT0002",
        "name": "Điều trị Therapy",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHT0003",
        "name": "Điều trị Therapy",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHT0004",
        "name": "Điều trị Therapy",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHT0005",
        "name": "Điều trị Therapy",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      },
      {
        "id": "NHT0006",
        "name": "Điều trị Therapy",
        "category": "Body",
        "categoryCodes": [
          "BODY"
        ]
      }
    ]
  }
];

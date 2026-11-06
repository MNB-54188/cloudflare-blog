// 根据 Cloudflare 请求上下文解析访客地区
// 只保存「国家 / 省级行政区」这类粗粒度文本，不保存完整 IP。

const CN_REGIONS = {
  beijing: "北京",
  tianjin: "天津",
  hebei: "河北",
  shanxi: "山西",
  "inner mongolia": "内蒙古",
  "nei mongol": "内蒙古",
  neimenggu: "内蒙古",
  liaoning: "辽宁",
  jilin: "吉林",
  heilongjiang: "黑龙江",
  shanghai: "上海",
  jiangsu: "江苏",
  zhejiang: "浙江",
  anhui: "安徽",
  fujian: "福建",
  jiangxi: "江西",
  shandong: "山东",
  henan: "河南",
  hubei: "湖北",
  hunan: "湖南",
  guangdong: "广东",
  guangxi: "广西",
  hainan: "海南",
  chongqing: "重庆",
  sichuan: "四川",
  guizhou: "贵州",
  yunnan: "云南",
  tibet: "西藏",
  xizang: "西藏",
  shaanxi: "陕西",
  gansu: "甘肃",
  qinghai: "青海",
  ningxia: "宁夏",
  xinjiang: "新疆",
  taiwan: "台湾",
  "hong kong": "香港",
  macau: "澳门",
  macao: "澳门",
};

const COUNTRY_NAMES = {
  CN: "中国",
  HK: "中国香港",
  MO: "中国澳门",
  TW: "中国台湾",
  US: "美国",
  JP: "日本",
  KR: "韩国",
  SG: "新加坡",
  MY: "马来西亚",
  TH: "泰国",
  VN: "越南",
  ID: "印度尼西亚",
  PH: "菲律宾",
  IN: "印度",
  GB: "英国",
  DE: "德国",
  FR: "法国",
  NL: "荷兰",
  ES: "西班牙",
  IT: "意大利",
  PT: "葡萄牙",
  IE: "爱尔兰",
  CH: "瑞士",
  AT: "奥地利",
  SE: "瑞典",
  NO: "挪威",
  DK: "丹麦",
  FI: "芬兰",
  PL: "波兰",
  RU: "俄罗斯",
  UA: "乌克兰",
  TR: "土耳其",
  AE: "阿联酋",
  SA: "沙特阿拉伯",
  IL: "以色列",
  EG: "埃及",
  ZA: "南非",
  NG: "尼日利亚",
  BR: "巴西",
  AR: "阿根廷",
  CL: "智利",
  MX: "墨西哥",
  CA: "加拿大",
  AU: "澳大利亚",
  NZ: "新西兰",
};

/**
 * 解析访客地区，返回形如「中国 · 重庆」「日本」「本地」的短文本。
 * request.cf 由 Cloudflare 边缘注入，本地开发时通常为空。
 */
export function resolveLocation(request) {
  const cf = request?.cf || {};
  const code = String(cf.country || "").toUpperCase();

  if (!code) return "本地";

  if (code === "CN") {
    const region = String(cf.region || "").trim().toLowerCase();
    const regionName = CN_REGIONS[region];
    return regionName ? `中国 · ${regionName}` : "中国";
  }

  return COUNTRY_NAMES[code] || code;
}

// Concrete visual imagery named in a transcript (Han, 21 Oct: the Concrete
// Imagery Floor). A closed list of things a painting can show (the moon, the
// sea, the sky, sunlight, rain…), matched in the transcript's own words, so a
// motif counts only when it was actually sung, never because a language
// model supplied it. Feelings (love, longing, sadness) are not on the list,
// and neither are words that are mostly figurative in songs (light, fire,
// heart, wind).
//
//   concreteImagery(text) → [{ motif, term }] in the order they were sung
//
// Each entry: [English motif name, Chinese terms, English pattern].

const ENTRIES = [
  ['moon', ['月亮', '月光', '明月', '月色', '弯月', '满月', '月'], /\bmoon(?:s|light|lit)?\b/],
  ['stars', ['星星', '星空', '星光', '繁星', '星河', '银河'], /\b(?:stars?|starlight|starry|starlit)\b/],
  ['sun', ['太阳', '夕阳', '朝阳', '落日', '日出', '日落'], /\b(?:sun|suns|sunrise|sunset|sundown)\b/],
  ['sunlight', ['阳光', '日光', '晨光', '曙光'], /\b(?:sunlight|sunshine|sunbeams?|sunlit)\b/],
  ['sky', ['天空', '蓝天', '夜空', '星空', '晴空', '长空', '天边', '天'], /\b(?:sky|skies)\b/],
  ['sea', ['大海', '海洋', '海浪', '海面', '海边', '海岸', '海风', '海'], /\b(?:seas?|ocean|oceans|seaside|seashore)\b/],
  ['waves', ['浪花', '波浪', '波涛', '浪'], /\b(?:waves?|tides?)\b/],
  ['shore', ['沙滩', '海滩', '岸边', '岸'], /\b(?:shores?|beach(?:es)?|sand|coast)\b/],
  ['clouds', ['白云', '云朵', '乌云', '云彩', '云'], /\bclouds?\b/],
  ['rain', ['雨滴', '下雨', '雨水', '雨天', '细雨', '大雨', '雨'], /\b(?:rain|rains|raining|rainy|raindrops?|rainfall)\b/],
  ['snow', ['雪花', '白雪', '下雪', '大雪', '雪'], /\b(?:snow|snows|snowing|snowflakes?|snowy)\b/],
  ['rainbow', ['彩虹'], /\brainbows?\b/],
  ['mist', ['雾', '烟雨'], /\b(?:mist|misty|fog|foggy|haze)\b/],
  ['river', ['河流', '小河', '江水', '河', '江', '溪'], /\b(?:rivers?|streams?|creeks?)\b/],
  ['lake', ['湖面', '湖水', '湖'], /\blakes?\b/],
  ['mountain', ['高山', '山顶', '山峰', '山'], /\b(?:mountains?|hills?|peaks?)\b/],
  ['flowers', ['花朵', '花瓣', '鲜花', '玫瑰', '花'], /\b(?:flowers?|blossoms?|petals?|roses?)\b/],
  ['trees', ['大树', '树叶', '落叶', '森林', '树林', '树'], /\b(?:trees?|forests?|woods|leaf)\b/],
  ['field', ['田野', '草原', '麦田', '草地'], /\b(?:fields?|meadows?|grass)\b/],
  ['road', ['道路', '小路', '街道', '马路', '街', '路'], /\b(?:roads?|streets?|paths?|lanes?)\b/],
  ['window', ['窗口', '窗外', '窗台', '窗'], /\bwindows?\b/],
  ['door', ['门口', '大门'], /\b(?:doors?|doorways?)\b/],
  ['boat', ['小船', '帆船', '船'], /\b(?:boats?|ships?|sails?)\b/],
  ['bird', ['飞鸟', '海鸥', '鸟'], /\b(?:birds?|seagulls?|gulls?)\b/],
  ['bridge', ['桥'], /\bbridges?\b/],
  ['lamp', ['路灯', '灯火', '灯光', '蜡烛', '灯'], /\b(?:lamps?|lanterns?|candles?|streetlights?)\b/],
  ['city', ['城市', '小镇'], /\b(?:city|cities|town)\b/],
  ['train', ['火车', '列车', '车站', '月台'], /\b(?:trains?|stations?|platforms?)\b/],
];

// Compounds that contain a term but name no visible thing: days and seasons
// (今天, 春天), turns of phrase (天真, 一路), crowds (人海) and verbs (花钱).
// They are removed before matching, so 今天 is not the sky and 花钱 not a flower.
const NOT_IMAGERY_ZH = [
  '今天', '明天', '昨天', '后天', '前天', '每天', '天天', '整天', '当天', '那天', '这天', '哪天', '几天', '一天', '有天', '半天', '某天',
  '春天', '夏天', '秋天', '冬天', '聊天', '天真', '天使', '天生', '天下', '天堂', '天涯', '老天', '天意', '天才', '变天',
  '天啊', '天哪', '天气', '月份', '岁月', '蜜月', '每月', '月底', '月初',
  '人山人海', '人海', '脑海', '心海', '苦海', '学海', '海报', '海誓山盟',
  '花钱', '花费', '花了', '花光', '花心', '眼花', '花样',
  '一路', '出路', '退路', '思路', '套路',
  '浪漫', '流浪', '浪费', '放浪',
  '江湖', '山盟', '靠山', '山寨',
  '部门', '专门', '热门', '出门', '进门', '关门',
  '星期', '明星', '救星', '零星',
  '云淡风轻', '风云', '烟云', '过眼云烟',
  '雨伞',
  '灯泡',
];
const MONTH_ZH = /[一二三四五六七八九十正腊几]+月/g;

function stripZh(text) {
  let s = text.replace(MONTH_ZH, '　');
  for (const w of NOT_IMAGERY_ZH) s = s.split(w).join('　');
  return s;
}

// The concrete motifs a transcript names, each once, in the order sung.
export function concreteImagery(text = '') {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];
  const zh = stripZh(raw);
  const lower = raw.toLowerCase();
  const found = [];
  for (const [motif, terms, en] of ENTRIES) {
    let at = Infinity, term = null;
    for (const t of terms) {
      const i = zh.indexOf(t);
      if (i >= 0 && i < at) { at = i; term = t; }
    }
    const m = en.exec(lower);
    if (m && m.index < at) { at = m.index; term = m[0]; }
    if (term) found.push({ motif, term, at });
  }
  return found.sort((a, b) => a.at - b.at).map(({ motif, term }) => ({ motif, term }));
}

export const IMAGERY_MOTIFS = ENTRIES.map(([m]) => m);

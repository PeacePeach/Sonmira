// Small keyword lists for reading the user's note. English entries match
// as word prefixes ("flower" matches "flowers"); Chinese entries match as
// substrings. Deliberately short and easy to edit; a speech-to-text or
// language-model classifier can replace this later behind the same API.

export const EMOTION_WORDS = {
  tender: ['love', 'gentle', 'soft', 'quiet', 'calm', 'lullaby', 'sleep', 'baby', 'mother', 'mom', 'mum',
    'grandma', 'hug', 'warm', 'dear', 'miss you', 'tender', 'peace',
    '温柔', '安静', '轻', '摇篮', '睡', '宝宝', '妈妈', '外婆', '奶奶', '想你', '抱', '暖', '平静', '爱'],
  bright: ['happy', 'joy', 'birthday', 'sun', 'sunny', 'morning', 'laugh', 'smile', 'fun', 'dance',
    'party', 'celebrat', 'friend', 'yay', 'bright', 'hope', 'summer', 'spring',
    '开心', '快乐', '生日', '阳光', '早晨', '早上', '笑', '跳舞', '朋友', '希望', '夏天', '春天', '晴'],
  melancholic: ['sad', 'alone', 'lonely', 'rain', 'tears', 'cry', 'miss', 'goodbye', 'lost', 'grey', 'gray',
    'tired', 'blue', 'autumn', 'winter', 'remember', 'memory', 'half remembered', 'night',
    '难过', '伤心', '孤独', '一个人', '雨', '眼泪', '哭', '想念', '再见', '离开', '累', '秋', '冬', '回忆', '夜'],
  intense: ['angry', 'loud', 'shout', 'scream', 'fire', 'storm', 'fight', 'power', 'wild', 'rock', 'run',
    'heart', 'burn', 'fierce', 'windows down', 'high note',
    '生气', '大声', '喊', '火', '暴风', '激动', '狂', '燃', '奔跑', '心跳', '用力'],
};

export const MOTIF_WORDS = {
  water: ['sea', 'ocean', 'river', 'lake', 'wave', 'shore', 'beach', 'rain', 'water', 'swim', 'boat',
    'harbo', 'bay', 'tide', 'pond', 'bath', 'shower', 'window',
    '海', '河', '湖', '浪', '岸', '沙滩', '雨', '水', '游泳', '船', '港', '湾', '潮', '池'],
  sky: ['sky', 'cloud', 'sun', 'moon', 'star', 'night', 'dawn', 'dusk', 'sunset', 'sunrise', 'wind', 'bird',
    'fly', 'air', 'morning', 'evening',
    '天', '云', '太阳', '月', '星', '夜', '黎明', '黄昏', '日落', '日出', '风', '鸟', '飞', '早晨', '傍晚'],
  garden: ['flower', 'garden', 'tree', 'leaf', 'leaves', 'rose', 'bloom', 'blossom', 'grass', 'park',
    'plant', 'petal', 'spring', 'forest',
    '花', '园', '树', '叶', '玫瑰', '开花', '草', '公园', '植物', '春', '森林'],
  landscape: ['mountain', 'hill', 'road', 'walk', 'home', 'city', 'street', 'field', 'car', 'town', 'cafe',
    'café', 'train', 'travel', 'village', 'bridge', 'valley', 'house', 'window',
    '山', '路', '回家', '家', '城', '街', '田', '车', '小镇', '咖啡', '火车', '旅行', '村', '桥', '房子'],
  abstract: ['dream', 'feeling', 'thought', 'nothing', 'something', 'half asleep', 'testing', 'hum',
    '梦', '感觉', '想法', '随便', '哼', '试'],
};

const isCjk = (w) => /[㐀-鿿]/.test(w);
const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Returns { [category]: hitCount } for the given lists.
export function countMatches(text, lists) {
  const counts = {};
  const t = (text || '').toLowerCase();
  for (const [cat, words] of Object.entries(lists)) {
    let n = 0;
    for (const w of words) {
      if (isCjk(w)) { if (t.includes(w)) n++; }
      else if (new RegExp(`(^|[^\\p{L}])${escape(w)}`, 'u').test(t)) n++;
    }
    counts[cat] = n;
  }
  return counts;
}

// Categories with the most hits (several when tied); empty when none.
export function topMatches(counts, priority) {
  const max = Math.max(0, ...priority.map((c) => counts[c] || 0));
  return max > 0 ? priority.filter((c) => (counts[c] || 0) === max) : [];
}

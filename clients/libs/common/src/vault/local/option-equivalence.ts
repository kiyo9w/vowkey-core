export interface SelectOptionCandidate {
  value: string;
  text: string;
  disabled?: boolean;
}

export interface RadioOptionCandidate {
  value: string;
  label?: string | null;
}

type EquivalenceCategory = "country" | "month" | "sex" | "marital" | "era" | "boolean";

interface EquivalenceGroup {
  id: string;
  category: EquivalenceCategory;
  /** Primary canonical tokens that unambiguously identify this category when seen in option lists. */
  strong: readonly string[];
  /** Short or numeric aliases (e.g. "1", "2", "m", "f") that apply when context does not conflict. */
  weak?: readonly string[];
}

const COUNTRY_EQUIVALENCES: ReadonlyArray<readonly string[]> = [
  ["US", "USA", "United States", "United States of America", "U.S.", "U.S.A.", "Hoa Kỳ", "Mỹ", "アメリカ", "アメリカ合衆国", "米国", "미국", "美国", "美國", "Estados Unidos", "États-Unis", "Etats-Unis", "Vereinigte Staaten"],
  ["AU", "AUS", "Australia", "Úc", "オーストラリア", "豪州", "호주", "오스트레일리아", "澳大利亚", "澳洲", "Australie", "Australien", "Austrália"],
  ["VN", "VNM", "Vietnam", "Viet Nam", "Việt Nam", "Socialist Republic of Vietnam", "ベトナム", "베트남", "越南", "Viêt Nam", "Vietnã"],
  ["JP", "JPN", "Japan", "Nhật Bản", "Nhật", "日本", "日本国", "일본", "Japón", "Japon", "Japão"],
  ["KR", "KOR", "South Korea", "Korea", "Republic of Korea", "ROK", "Hàn Quốc", "韓国", "大韓民国", "대한민국", "한국", "韩国", "韓國", "Corea del Sur", "Corée du Sud", "Südkorea", "Coreia do Sul"],
  ["KP", "PRK", "North Korea", "Triều Tiên", "北朝鮮", "북한", "朝鲜", "北韓"],
  ["CN", "CHN", "China", "People's Republic of China", "PRC", "Trung Quốc", "中国", "中華人民共和国", "중국", "中國", "Chine"],
  ["TW", "TWN", "Taiwan", "Đài Loan", "台湾", "台灣", "臺灣", "대만", "타이완", "Taiwán", "Taïwan"],
  ["HK", "HKG", "Hong Kong", "Hồng Kông", "香港", "홍콩"],
  ["MO", "MAC", "Macao", "Macau", "澳門", "澳门", "マカオ", "마카오"],
  ["SG", "SGP", "Singapore", "シンガポール", "싱가포르", "新加坡", "Singapur", "Singapour", "Cingapura"],
  ["MY", "MYS", "Malaysia", "マレーシア", "말레이시아", "马来西亚", "馬來西亞", "Malasia", "Malaisie", "Malásia"],
  ["TH", "THA", "Thailand", "Thái Lan", "タイ", "태국", "泰国", "泰國", "Tailandia", "Thaïlande", "Tailândia"],
  ["ID", "IDN", "Indonesia", "インドネシア", "인도네시아", "印度尼西亚", "印尼", "Indonésie", "Indonesien", "Indonésia"],
  ["PH", "PHL", "Philippines", "Phi-líp-pin", "フィリピン", "필리핀", "菲律宾", "菲律賓", "Filipinas", "Philippinen"],
  ["KH", "KHM", "Cambodia", "Campuchia", "カンボジア", "캄보디아", "柬埔寨", "Camboya", "Cambodge", "Kambodscha", "Camboja"],
  ["LA", "LAO", "Laos", "Lao PDR", "Lào", "ラオス", "라오스", "老挝", "寮國"],
  ["MM", "MMR", "Myanmar", "Burma", "ミャンマー", "미얀마", "缅甸", "緬甸", "Birmanie"],
  ["BN", "BRN", "Brunei", "Brunei Darussalam", "ブルネイ", "브루나이", "文莱", "汶萊"],
  ["TL", "TLS", "Timor-Leste", "East Timor", "東ティモール", "동티모르", "东帝汶", "東帝汶"],
  ["IN", "IND", "India", "Ấn Độ", "インド", "인도", "印度", "Inde", "Indien", "Índia"],
  ["PK", "PAK", "Pakistan", "パキスタン", "파키스탄", "巴基斯坦", "Pakistán", "Paquistão"],
  ["BD", "BGD", "Bangladesh", "バングラデシュ", "방글라데시", "孟加拉国", "孟加拉"],
  ["LK", "LKA", "Sri Lanka", "スリランカ", "스리랑카", "斯里兰卡", "斯里蘭卡"],
  ["NP", "NPL", "Nepal", "ネパール", "네팔", "尼泊尔", "尼泊爾", "Népal"],
  ["MN", "MNG", "Mongolia", "Mông Cổ", "モンゴル", "몽골", "蒙古", "Mongolie", "Mongolei", "Mongólia"],
  ["UZ", "UZB", "Uzbekistan", "ウズベキスタン", "우즈베키스탄", "乌兹别克斯坦", "烏茲別克"],
  ["KZ", "KAZ", "Kazakhstan", "カザフスタン", "카자흐스탄", "哈萨克斯坦", "哈薩克"],
  ["GB", "GBR", "UK", "United Kingdom", "Great Britain", "Britain", "England", "Vương quốc Anh", "Anh", "イギリス", "英国", "영국", "英國", "Reino Unido", "Royaume-Uni", "Vereinigtes Königreich", "Großbritannien"],
  ["CA", "CAN", "Canada", "カナダ", "캐나다", "加拿大", "Canadá", "Kanada"],
  ["NZ", "NZL", "New Zealand", "ニュージーランド", "뉴질랜드", "新西兰", "紐西蘭", "Nueva Zelanda", "Nouvelle-Zélande", "Neuseeland", "Nova Zelândia"],
  ["IE", "IRL", "Ireland", "Republic of Ireland", "アイルランド", "아일랜드", "爱尔兰", "愛爾蘭", "Irlanda", "Irlande", "Irland"],
  ["DE", "DEU", "Germany", "Đức", "ドイツ", "독일", "德国", "德國", "Alemania", "Allemagne", "Deutschland", "Alemanha"],
  ["FR", "FRA", "France", "Pháp", "フランス", "프랑스", "法国", "法國", "Francia", "Frankreich", "França"],
  ["ES", "ESP", "Spain", "Tây Ban Nha", "スペイン", "스페인", "西班牙", "España", "Espagne", "Spanien", "Espanha"],
  ["PT", "PRT", "Portugal", "Bồ Đào Nha", "ポルトガル", "포르투갈", "葡萄牙"],
  ["IT", "ITA", "Italy", "Ý", "イタリア", "이탈리아", "意大利", "義大利", "Italia", "Italie", "Italien", "Itália"],
  ["NL", "NLD", "Netherlands", "The Netherlands", "Holland", "Hà Lan", "オランダ", "네덜란드", "荷兰", "荷蘭", "Países Bajos", "Pays-Bas", "Niederlande", "Países Baixos"],
  ["BE", "BEL", "Belgium", "Bỉ", "ベルギー", "벨기에", "比利时", "比利時", "Bélgica", "Belgique", "Belgien"],
  ["LU", "LUX", "Luxembourg", "ルクセンブルク", "룩셈부르크", "卢森堡", "盧森堡", "Luxemburgo", "Luxemburg"],
  ["CH", "CHE", "Switzerland", "Thụy Sĩ", "スイス", "스위스", "瑞士", "Suiza", "Suisse", "Schweiz", "Suíça"],
  ["AT", "AUT", "Austria", "Áo", "オーストリア", "오스트리아", "奥地利", "奧地利", "Autriche", "Österreich", "Áustria"],
  ["SE", "SWE", "Sweden", "Thụy Điển", "スウェーデン", "스웨덴", "瑞典", "Suecia", "Suède", "Schweden", "Suécia"],
  ["NO", "NOR", "Norway", "Na Uy", "ノルウェー", "노르웨이", "挪威", "Noruega", "Norvège", "Norwegen"],
  ["DK", "DNK", "Denmark", "Đan Mạch", "デンマーク", "덴마크", "丹麦", "丹麥", "Dinamarca", "Danemark", "Dänemark"],
  ["FI", "FIN", "Finland", "Phần Lan", "フィンランド", "핀란드", "芬兰", "芬蘭", "Finlandia", "Finlande", "Finnland", "Finlândia"],
  ["IS", "ISL", "Iceland", "アイスランド", "아이슬란드", "冰岛", "冰島", "Islandia", "Islande", "Island", "Islândia"],
  ["PL", "POL", "Poland", "Ba Lan", "ポーランド", "폴란드", "波兰", "波蘭", "Polonia", "Pologne", "Polen", "Polônia"],
  ["CZ", "CZE", "Czechia", "Czech Republic", "Séc", "チェコ", "체코", "捷克", "Chequia", "República Checa", "Tchéquie", "Tschechien", "Tchéquia"],
  ["SK", "SVK", "Slovakia", "スロバキア", "슬로바키아", "斯洛伐克", "Eslovaquia", "Slovaquie", "Slowakei", "Eslováquia"],
  ["HU", "HUN", "Hungary", "ハンガリー", "헝가리", "匈牙利", "Hungría", "Hongrie", "Ungarn", "Hungria"],
  ["RO", "ROU", "Romania", "ルーマニア", "루마니아", "罗马尼亚", "羅馬尼亞", "Rumania", "Roumanie", "Rumänien", "Romênia"],
  ["BG", "BGR", "Bulgaria", "ブルガリア", "불가리아", "保加利亚", "保加利亞", "Bulgarie", "Bulgarien", "Bulgária"],
  ["GR", "GRC", "Greece", "Hy Lạp", "ギリシャ", "그리스", "希腊", "希臘", "Grecia", "Grèce", "Griechenland", "Grécia"],
  ["HR", "HRV", "Croatia", "クロアチア", "크로아티아", "克罗地亚", "克羅埃西亞", "Croacia", "Croatie", "Kroatien", "Croácia"],
  ["SI", "SVN", "Slovenia", "スロベニア", "슬로베니아", "斯洛文尼亚", "斯洛維尼亞", "Eslovenia", "Slovénie", "Slowenien", "Eslovênia"],
  ["RS", "SRB", "Serbia", "セルビア", "세르비아", "塞尔维亚", "塞爾維亞", "Serbie", "Serbien", "Sérvia"],
  ["EE", "EST", "Estonia", "エストニア", "에스토니아", "爱沙尼亚", "愛沙尼亞", "Estonie", "Estland", "Estônia"],
  ["LV", "LVA", "Latvia", "ラトビア", "라트비아", "拉脱维亚", "拉脫維亞", "Letonia", "Lettonie", "Lettland", "Letônia"],
  ["LT", "LTU", "Lithuania", "リトアニア", "리투아니아", "立陶宛", "Lituania", "Lituanie", "Litauen", "Lituânia"],
  ["TR", "TUR", "Turkey", "Türkiye", "Turkiye", "Thổ Nhĩ Kỳ", "トルコ", "터키", "튀르키예", "土耳其", "Turquía", "Turquie", "Türkei", "Turquia"],
  ["RU", "RUS", "Russia", "Russian Federation", "Nga", "ロシア", "러시아", "俄罗斯", "俄羅斯", "Rusia", "Russie", "Russland", "Rússia"],
  ["UA", "UKR", "Ukraine", "ウクライナ", "우크라이나", "乌克兰", "烏克蘭", "Ucrania", "Ucrânia"],
  ["IL", "ISR", "Israel", "イスラエル", "이스라엘", "以色列", "Israël"],
  ["AE", "ARE", "United Arab Emirates", "UAE", "アラブ首長国連邦", "아랍에미리트", "阿联酋", "阿聯酋", "阿拉伯联合酋长国", "Emiratos Árabes Unidos", "Émirats arabes unis", "Vereinigte Arabische Emirate", "Emirados Árabes Unidos"],
  ["SA", "SAU", "Saudi Arabia", "サウジアラビア", "사우디아라비아", "沙特阿拉伯", "沙烏地阿拉伯", "Arabia Saudita", "Arabie saoudite", "Saudi-Arabien", "Arábia Saudita"],
  ["QA", "QAT", "Qatar", "カタール", "카타르", "卡塔尔", "卡達", "Catar", "Katar"],
  ["KW", "KWT", "Kuwait", "クウェート", "쿠웨이트", "科威特", "Koweït"],
  ["EG", "EGY", "Egypt", "Ai Cập", "エジプト", "이집트", "埃及", "Egipto", "Égypte", "Ägypten", "Egito"],
  ["ZA", "ZAF", "South Africa", "Nam Phi", "南アフリカ", "남아프리카 공화국", "남아공", "南非", "Sudáfrica", "Afrique du Sud", "Südafrika", "África do Sul"],
  ["NG", "NGA", "Nigeria", "ナイジェリア", "나이지리아", "尼日利亚", "奈及利亞", "Nigéria"],
  ["KE", "KEN", "Kenya", "ケニア", "케냐", "肯尼亚", "肯亞", "Kenia", "Quênia"],
  ["MA", "MAR", "Morocco", "モロッコ", "모로코", "摩洛哥", "Marruecos", "Maroc", "Marokko", "Marrocos"],
  ["MX", "MEX", "Mexico", "メキシコ", "멕시코", "墨西哥", "México", "Mexique", "Mexiko"],
  ["BR", "BRA", "Brazil", "ブラジル", "브라질", "巴西", "Brasil", "Brésil", "Brasilien"],
  ["AR", "ARG", "Argentina", "アルゼンチン", "아르헨티나", "阿根廷", "Argentine", "Argentinien"],
  ["CL", "CHL", "Chile", "チリ", "칠레", "智利", "Chili"],
  ["CO", "COL", "Colombia", "コロンビア", "콜롬비아", "哥伦比亚", "哥倫比亞", "Colombie", "Kolumbien", "Colômbia"],
  ["PE", "PER", "Peru", "ペルー", "페루", "秘鲁", "秘魯", "Perú", "Pérou"],
  ["VE", "VEN", "Venezuela", "ベネズエラ", "베네수엘라", "委内瑞拉", "委內瑞拉"],
  ["CU", "CUB", "Cuba", "キューバ", "쿠바", "古巴", "Kuba"],
];

const MONTH_EQUIVALENCES: ReadonlyArray<{ num: number; strong: readonly string[]; weak: readonly string[] }> = [
  { num: 1, strong: ["01", "jan", "january", "01jan", "1jan", "01january", "1january", "tháng 1", "tháng một", "1月", "一月", "1월", "enero", "ene", "janvier", "janv", "januar", "janeiro"], weak: ["1"] },
  { num: 2, strong: ["02", "feb", "february", "02feb", "2feb", "02february", "2february", "tháng 2", "tháng hai", "2月", "二月", "2월", "febrero", "février", "fevrier", "févr", "februar", "fevereiro", "fev"], weak: ["2"] },
  { num: 3, strong: ["03", "mar", "march", "03mar", "3mar", "03march", "3march", "tháng 3", "tháng ba", "3月", "三月", "3월", "marzo", "mars", "märz", "maerz", "março", "marco"], weak: ["3"] },
  { num: 4, strong: ["04", "apr", "april", "04apr", "4apr", "04april", "4april", "tháng 4", "tháng tư", "4月", "四月", "4월", "abril", "abr", "avril", "avr"], weak: ["4"] },
  { num: 5, strong: ["05", "may", "05may", "5may", "tháng 5", "tháng năm", "5月", "五月", "5월", "mayo", "mai", "maio"], weak: ["5"] },
  { num: 6, strong: ["06", "jun", "june", "06jun", "6jun", "06june", "6june", "tháng 6", "tháng sáu", "6月", "六月", "6월", "junio", "juin", "juni", "junho"], weak: ["6"] },
  { num: 7, strong: ["07", "jul", "july", "07jul", "7jul", "07july", "7july", "tháng 7", "tháng bảy", "7月", "七月", "7월", "julio", "juillet", "juil", "juli", "julho"], weak: ["7"] },
  { num: 8, strong: ["08", "aug", "august", "08aug", "8aug", "08august", "8august", "tháng 8", "tháng tám", "8月", "八月", "8월", "agosto", "ago", "août", "aout"], weak: ["8"] },
  { num: 9, strong: ["09", "sep", "sept", "september", "09sep", "9sep", "09september", "9september", "tháng 9", "tháng chín", "9月", "九月", "9월", "septiembre", "setiembre", "septembre", "setembro", "set"], weak: ["9"] },
  { num: 10, strong: ["10", "oct", "october", "10oct", "10october", "tháng 10", "tháng mười", "10月", "十月", "10월", "octubre", "octobre", "oktober", "okt", "outubro", "out"], weak: [] },
  { num: 11, strong: ["11", "nov", "november", "11nov", "11november", "tháng 11", "11月", "十一月", "11월", "noviembre", "novembre", "novembro"], weak: [] },
  { num: 12, strong: ["12", "dec", "december", "12dec", "12december", "tháng 12", "12月", "十二月", "12월", "diciembre", "dic", "décembre", "decembre", "déc", "dezember", "dez", "dezembro"], weak: [] },
];

const NON_COUNTRY_GROUPS: ReadonlyArray<EquivalenceGroup> = [
  ...MONTH_EQUIVALENCES.map((m) => ({
    id: `month:${m.num}`,
    category: "month" as const,
    strong: m.strong,
    weak: m.weak,
  })),
  {
    id: "sex:male",
    category: "sex",
    strong: ["male", "man", "男", "男性", "nam", "남", "남성", "남자", "homme", "masculin", "masculino", "varón", "varon", "männlich", "maennlich"],
    weak: ["m", "1"],
  },
  {
    id: "sex:female",
    category: "sex",
    strong: ["female", "woman", "女", "女性", "nữ", "nu", "여", "여성", "여자", "femme", "féminin", "feminin", "femenino", "feminino", "weiblich"],
    weak: ["f", "2"],
  },
  {
    id: "sex:other",
    category: "sex",
    strong: ["non-binary", "nonbinary", "other", "khác", "その他", "기타", "其他", "autre", "divers", "otro", "outro"],
    weak: ["x", "3", "9"],
  },
  {
    id: "marital:single",
    category: "marital",
    strong: ["single", "unmarried", "never married", "独身", "未婚", "độc thân", "chưa kết hôn", "미혼", "célibataire", "celibataire", "soltero", "soltera", "solteiro", "solteira", "ledig"],
    weak: ["s"],
  },
  {
    id: "marital:married",
    category: "marital",
    strong: ["married", "既婚", "配偶者あり", "đã kết hôn", "có gia đình", "기혼", "已婚", "marié", "marie", "mariée", "casado", "casada", "verheiratet"],
    weak: ["m"],
  },
  {
    id: "marital:divorced",
    category: "marital",
    strong: ["divorced", "離婚", "ly hôn", "이혼", "离异", "離婚", "divorcé", "divorce", "divorcée", "divorciado", "divorciada", "geschieden"],
    weak: ["d"],
  },
  {
    id: "marital:widowed",
    category: "marital",
    strong: ["widowed", "widow", "widower", "死別", "丧偶", "喪偶", "góa", "사별", "veuf", "veuve", "viudo", "viuda", "viúvo", "viúva", "verwitwet"],
    weak: ["w"],
  },
  {
    id: "era:meiji",
    category: "era",
    strong: ["明治", "meiji", "めいじ", "メイジ"],
    weak: ["m"],
  },
  {
    id: "era:taisho",
    category: "era",
    strong: ["大正", "taisho", "taishō", "たいしょう", "タイショウ"],
    weak: ["t"],
  },
  {
    id: "era:showa",
    category: "era",
    strong: ["昭和", "showa", "shōwa", "しょうわ", "ショウワ"],
    weak: ["s"],
  },
  {
    id: "era:heisei",
    category: "era",
    strong: ["平成", "heisei", "へいせい", "ヘイセイ"],
    weak: ["h"],
  },
  {
    id: "era:reiwa",
    category: "era",
    strong: ["令和", "reiwa", "れいわ", "レイワ"],
    weak: ["r"],
  },
  {
    id: "boolean:yes",
    category: "boolean",
    strong: ["yes", "true", "はい", "有", "あり", "có", "예", "네", "是", "sí", "oui", "ja", "sim"],
    weak: ["y", "1"],
  },
  {
    id: "boolean:no",
    category: "boolean",
    strong: ["no", "false", "いいえ", "無", "なし", "không", "아니오", "아니요", "否", "non", "nein", "não", "nao"],
    weak: ["n", "0"],
  },
];

const ALL_GROUPS: ReadonlyArray<EquivalenceGroup> = [
  ...COUNTRY_EQUIVALENCES.map((names) => ({
    id: `country:${names[0]}`,
    category: "country" as const,
    strong: names,
  })),
  ...NON_COUNTRY_GROUPS,
];

export function normalizeOptionToken(raw: string | null | undefined): string {
  if (!raw) {
    return "";
  }
  return raw
    .normalize("NFKC")
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stripPunctuationToken(normalized: string): string {
  return normalized.replace(/[.,()[\]/_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function foldDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function compactLongToken(s: string): string {
  const compact = s.replace(/[\s.,()[\]/_-]+/g, "");
  return compact.length >= 4 ? compact : "";
}

function stripParentheticalDecorations(normalized: string): string[] {
  const variants = new Set<string>();
  if (!normalized) {
    return [];
  }
  const addVariant = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed) {
      return;
    }
    variants.add(trimmed);
    const compact = compactLongToken(trimmed);
    if (compact) {
      variants.add(compact);
    }
    if (trimmed.length >= 4) {
      const folded = foldDiacritics(trimmed);
      if (folded) {
        variants.add(folded);
        const foldedCompact = compactLongToken(folded);
        if (foldedCompact) {
          variants.add(foldedCompact);
        }
      }
    }
  };
  addVariant(normalized);
  const punct = stripPunctuationToken(normalized);
  if (punct) {
    addVariant(punct);
  }
  // Handle options like "United States (+1)", "+84 Vietnam", "US - United States", "Vietnam (VN)"
  const withoutParens = normalized.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (withoutParens) {
    addVariant(withoutParens);
    const cleanParens = stripPunctuationToken(withoutParens);
    if (cleanParens) {
      addVariant(cleanParens);
    }
  }
  const withoutDialPrefix = withoutParens.replace(/^\+\d+\s*[-–:]?\s*/, "").trim();
  if (withoutDialPrefix) {
    addVariant(withoutDialPrefix);
  }
  for (const part of normalized.split(/\s+[-–/|]\s+/)) {
    addVariant(part);
  }
  return [...variants];
}

interface IndexedGroup {
  group: EquivalenceGroup;
  strongSet: Set<string>;
  weakSet: Set<string>;
  longNames: string[];
}

const INDEXED_GROUPS: ReadonlyArray<IndexedGroup> = ALL_GROUPS.map((group) => {
  const strongSet = new Set<string>();
  const longNames: string[] = [];
  for (const item of group.strong) {
    const norm = normalizeOptionToken(item);
    const stripped = stripPunctuationToken(norm);
    for (const token of [norm, stripped]) {
      if (!token) {
        continue;
      }
      strongSet.add(token);
      if (token.length >= 4 && !longNames.includes(token)) {
        longNames.push(token);
      }
      const compact = compactLongToken(token);
      if (compact) {
        strongSet.add(compact);
      }
      if (token.length >= 4) {
        const folded = foldDiacritics(token);
        if (folded) {
          strongSet.add(folded);
          const foldedCompact = compactLongToken(folded);
          if (foldedCompact) {
            strongSet.add(foldedCompact);
          }
        }
      }
    }
  }
  const weakSet = new Set<string>();
  for (const item of group.weak ?? []) {
    const norm = normalizeOptionToken(item);
    if (norm) {
      weakSet.add(norm);
    }
  }
  return { group, strongSet, weakSet, longNames };
});

function groupsForToken(
  raw: string | null | undefined,
  allowWeak: boolean,
): Array<{ indexed: IndexedGroup; strength: "strong" | "weak" }> {
  const variants = stripParentheticalDecorations(normalizeOptionToken(raw));
  if (variants.length === 0) {
    return [];
  }
  const out: Array<{ indexed: IndexedGroup; strength: "strong" | "weak" }> = [];
  for (const indexed of INDEXED_GROUPS) {
    if (variants.some((v) => indexed.strongSet.has(v))) {
      out.push({ indexed, strength: "strong" });
    } else if (allowWeak && variants.some((v) => indexed.weakSet.has(v))) {
      out.push({ indexed, strength: "weak" });
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholeTerm(haystack: string, term: string): boolean {
  if (term.length < 4 || !haystack.includes(term)) {
    return false;
  }
  // CJK terms don't use ASCII word boundaries
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(term)) {
    return true;
  }
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "iu");
  return re.test(haystack);
}

function detectDominantCategories(candidates: ReadonlyArray<{ value: string; text?: string | null }>): Set<EquivalenceCategory> {
  const counts = new Map<EquivalenceCategory, number>();
  for (const c of candidates) {
    const seenForCandidate = new Set<EquivalenceCategory>();
    for (const token of [c.text, c.value]) {
      for (const match of groupsForToken(token, false)) {
        seenForCandidate.add(match.indexed.group.category);
      }
    }
    for (const cat of seenForCandidate) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
  }
  const active = new Set<EquivalenceCategory>();
  for (const [cat, count] of counts) {
    if (count >= 1) {
      active.add(cat);
    }
  }
  return active;
}

function isPlaceholderOption(option: SelectOptionCandidate): boolean {
  const val = normalizeOptionToken(option.value);
  const txt = normalizeOptionToken(option.text);
  if (!val && (!txt || /^(select|choose|--|—|선택|選択|chọn|请选择|請選擇)/i.test(txt))) {
    return true;
  }
  return false;
}

/**
 * Resolves the best `<select>` or ARIA listbox option `value` for a desired profile value.
 * Never performs substring matching on short strings (`<= 3` characters), preventing `"US"` from
 * matching `"Australia"`.
 */
export function resolveSelectOption(
  options: ReadonlyArray<SelectOptionCandidate>,
  desired: string | null | undefined,
): SelectOptionCandidate | null {
  const normDesired = normalizeOptionToken(desired);
  if (!normDesired || options.length === 0) {
    return null;
  }

  const enabledOptions = options.filter((opt) => !opt.disabled);
  if (enabledOptions.length === 0) {
    return null;
  }

  // 1. Exact normalized match on value or visible text
  for (const opt of enabledOptions) {
    if (normalizeOptionToken(opt.value) === normDesired) {
      return opt;
    }
  }
  for (const opt of enabledOptions) {
    if (normalizeOptionToken(opt.text) === normDesired) {
      return opt;
    }
  }

  const strippedDesired = stripPunctuationToken(normDesired);
  if (strippedDesired) {
    for (const opt of enabledOptions) {
      if (
        stripPunctuationToken(normalizeOptionToken(opt.value)) === strippedDesired ||
        stripPunctuationToken(normalizeOptionToken(opt.text)) === strippedDesired
      ) {
        return opt;
      }
    }
  }
  const compactDesired = compactLongToken(normDesired);
  if (compactDesired) {
    for (const opt of enabledOptions) {
      if (
        compactLongToken(normalizeOptionToken(opt.value)) === compactDesired ||
        compactLongToken(normalizeOptionToken(opt.text)) === compactDesired
      ) {
        return opt;
      }
    }
  }

  // 2. Equivalence group resolution (ISO countries, months, sex, marital status, eras, yes/no)
  const dominantCategories = detectDominantCategories(enabledOptions);
  const desiredGroups = groupsForToken(desired, true).filter(({ indexed, strength }) => {
    if (strength === "strong") {
      return dominantCategories.size === 0 || dominantCategories.has(indexed.group.category) || indexed.group.category === "country";
    }
    // Weak token (like "M", "F", "1", "2"): allow when the option list has strong tokens in that category,
    // or when all options are weak codes of that category (e.g., radio/select values M/F or 1/2).
    if (dominantCategories.size > 0) {
      return dominantCategories.has(indexed.group.category);
    }
    return enabledOptions.length <= 5;
  });

  if (desiredGroups.length > 0) {
    let bestOption: SelectOptionCandidate | null = null;
    let bestScore = 0;

    for (const opt of enabledOptions) {
      if (isPlaceholderOption(opt)) {
        continue;
      }
      const optTextGroups = groupsForToken(opt.text, true);
      const optValGroups = groupsForToken(opt.value, true);
      const optTextNorm = normalizeOptionToken(opt.text);
      const optValNorm = normalizeOptionToken(opt.value);

      // If option text explicitly names a strong category group (e.g. "Female"), do not let its
      // numeric value ("1") match a conflicting group in the same category ("Male").
      const explicitStrongIds = new Set(
        optTextGroups.filter((g) => g.strength === "strong").map((g) => g.indexed.group.id),
      );
      const explicitStrongCats = new Set(
        optTextGroups.filter((g) => g.strength === "strong").map((g) => g.indexed.group.category),
      );

      for (const dg of desiredGroups) {
        const targetId = dg.indexed.group.id;
        const targetCat = dg.indexed.group.category;

        if (explicitStrongCats.has(targetCat) && !explicitStrongIds.has(targetId)) {
          continue;
        }

        let score = 0;
        const textMatch = optTextGroups.find((g) => g.indexed.group.id === targetId);
        const valMatch = optValGroups.find((g) => g.indexed.group.id === targetId);

        if (textMatch?.strength === "strong" && valMatch?.strength === "strong") {
          score = 100;
        } else if (textMatch?.strength === "strong") {
          score = 95;
        } else if (valMatch?.strength === "strong") {
          score = 90;
        } else if (dg.strength === "strong" && (textMatch?.strength === "weak" || valMatch?.strength === "weak")) {
          score = 80;
        } else if (dg.strength === "weak" && (textMatch?.strength === "weak" || valMatch?.strength === "weak")) {
          score = 70;
        } else {
          // Check word-bounded containment for >=4-char canonical names (e.g., "United States (+1)")
          for (const longName of dg.indexed.longNames) {
            if (containsWholeTerm(optTextNorm, longName) || containsWholeTerm(optValNorm, longName)) {
              score = 85;
              break;
            }
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestOption = opt;
        }
      }
    }

    if (bestOption) {
      return bestOption;
    }
  }

  // 3. Safe long-token (>= 4 chars) whole-word / prefix fallback — NEVER for <= 3 chars!
  if (normDesired.length >= 4) {
    for (const opt of enabledOptions) {
      if (isPlaceholderOption(opt)) {
        continue;
      }
      const optText = normalizeOptionToken(opt.text);
      const optVal = normalizeOptionToken(opt.value);
      if (containsWholeTerm(optText, normDesired) || containsWholeTerm(optVal, normDesired)) {
        return opt;
      }
    }
    for (const opt of enabledOptions) {
      if (isPlaceholderOption(opt)) {
        continue;
      }
      const optText = normalizeOptionToken(opt.text);
      if (optText.startsWith(normDesired)) {
        return opt;
      }
    }
  }

  return null;
}

/**
 * Checks whether a single radio button (`value` + individual `label`) matches `desired`.
 * When `siblings` are provided, resolves across the radio group so ambiguous numeric/letter codes
 * respect explicit option labels.
 */
export function matchesRadioOption(
  candidate: RadioOptionCandidate,
  desired: string | null | undefined,
  siblings?: ReadonlyArray<RadioOptionCandidate>,
): boolean {
  const normDesired = normalizeOptionToken(desired);
  if (!normDesired) {
    return false;
  }
  const candVal = normalizeOptionToken(candidate.value);
  const candLabel = normalizeOptionToken(candidate.label);
  const candEffectiveText = candLabel || candVal;

  if (candLabel && candLabel === normDesired) {
    return true;
  }
  if (candVal && candVal !== "on" && candVal === normDesired) {
    const hasExplicitLabelConflict =
      Boolean(candLabel) &&
      groupsForToken(candLabel, false).some((cg) =>
        groupsForToken(desired, true).some(
          (dg) =>
            dg.indexed.group.category === cg.indexed.group.category &&
            dg.indexed.group.id !== cg.indexed.group.id,
        ),
      );
    if (!hasExplicitLabelConflict) {
      return true;
    }
  }

  const pool = siblings && siblings.length > 0 ? siblings : [candidate];
  const resolved = resolveSelectOption(
    pool.map((item) => {
      const label = normalizeOptionToken(item.label);
      const val = normalizeOptionToken(item.value);
      return {
        value: val === "on" && label ? label : item.value,
        text: item.label?.trim() ? item.label : item.value,
      };
    }),
    desired,
  );
  if (!resolved) {
    return false;
  }
  const expectedVal = candVal === "on" && candLabel ? candLabel : candVal;
  return (
    normalizeOptionToken(resolved.value) === expectedVal &&
    normalizeOptionToken(resolved.text) === candEffectiveText
  );
}

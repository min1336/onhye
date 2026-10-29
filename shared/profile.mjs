export const SPECIAL = { JA0301: '난임·예비부모', JA0302: '임신', JA0303: '출산·입양', JA0313: '농업', JA0314: '어업', JA0315: '축산업', JA0316: '임업', JA0328: '장애', JA0329: '보훈', JA0330: '질병', JA0401: '다문화', JA0402: '북한이탈', JA0403: '한부모·조손', JA0404: '1인 가구', JA0411: '다자녀', JA0412: '무주택', JA0413: '신규 전입', JA1101: '예비창업', JA1102: '사업 운영', JA1103: '폐업 예정' };
export const MONEY = { monthlyIncome: '개인 월소득', householdIncome: '가구 월소득', financialAssets: '예금·현금 등 금융재산', totalAssets: '부동산 포함 총재산', debt: '부채', householdFinancialAssets: '가구 금융재산' };
export const EMPTY_PROFILE = { age: null, childAge: null, housingGoal: 'unknown', sex: 'unknown', region: 'unknown', district: '', businessRegion: 'unknown', businessDistrict: '', employment: 'unknown', subject: 'self', special: [], monthlyIncome: null, householdIncome: null, financialAssets: null, totalAssets: null, debt: null, incomeBracket: 'unknown', householdSize: null, recipient: 'unknown', crisis: 'unknown', amountsAssessed: false };

// shortcut: 명시한 표현만 추출한다. 복수 인물·충돌하는 값은 확인 대상으로 남긴다.
export function extractProfile(text) {
  const profile = { ...EMPTY_PROFILE, special: [] };
  const family = /(?:아버지|어머니|부모님|할머니|할아버지|배우자|자녀|아들|딸).*?(?:혜택|지원)|(?:혜택|지원).*?(?:아버지|어머니|부모님|자녀)/.test(text);
  if (family) profile.subject = 'family';
  // shortcut: 과거·부정·변경이 섞인 값은 추측하지 않고 확인 화면에서 입력받는다.
  const past = /작년|지난|예전|과거|이전|당시|옛날|였|이었|살았|거주했/.test(text);
  const ageNegated = /(?:살|세)(?:가|는|이|은)?\s*(?:아니|아닌|아닙|않)/.test(text);
  const ages = [...text.matchAll(/(?:만\s*)?(\d{1,3})\s*(?:살|세)/g)].map(x => Number(x[1]));
  if (!past && !ageNegated && new Set(ages).size === 1 && ages[0] <= 120) profile.age = ages[0];
  const regions = [...new Set((text.match(/서울|경기도?|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주/g) || []).map(x => x === '경기도' ? '경기' : x))];
  if (!past && !/살지|거주하지|아니|아닌|아닙|않|안\s*(?:살|거주)|이사|전입/.test(text) && regions.length === 1) profile.region = regions[0];
  // 다른 사람의 성별·직업·재산을 지원받을 사람에게 옮기지 않는다.
  if (family) {
    const familyAges = [
      ...text.matchAll(/(\d{1,3})\s*(?:살|세)\s*(?:이신\s*|인\s*)?(?:아버지|어머니|부모님|할머니|할아버지|배우자|자녀|아들|딸)/g),
      ...text.matchAll(/(?:아버지|어머니|할머니|할아버지|배우자|아들|딸)(?:는|은|가|이)?\s*(?:만\s*)?(\d{1,3})\s*(?:살|세)/g),
    ].map(match => Number(match[1]));
    profile.age = !past && !ageNegated && new Set(familyAges).size === 1 && familyAges[0] <= 120 ? familyAges[0] : null;
    profile.region = 'unknown';
    return profile;
  }
  const positive = text.replace(/(?:남성|남자|여성|여자|무직|구직자|학생|재직|직장인)(?:은|는|이|가)?\s*(?:아니[^ ,.!?]*|않[^ ,.!?]*)/g, '');
  if (/(?:여성|여자)/.test(positive) && !/(?:남성|남자)/.test(positive)) profile.sex = 'female';
  if (/(?:남성|남자)/.test(positive) && !/(?:여성|여자)/.test(positive)) profile.sex = 'male';
  const jobs = [['seeking', /구직|취업(?:을)?\s*준비|실업|무직/], ['employed', /재직|직장인|근로자/], ['student', /대학생|대학원생|학생/]].filter(([, pattern]) => pattern.test(positive));
  if (jobs.length === 1) profile.employment = jobs[0][0];
  for (const [key, pattern] of Object.entries({ JA0328: /장애(?:인|가 있어)/, JA0329: /국가유공자|보훈대상/, JA0403: /한부모|조손가정/, JA0404: /1인\s*가구|혼자\s*살/, JA0411: /다자녀/, JA0412: /무주택/, JA1101: /예비\s*창업/, JA1102: /사업자|자영업/ })) {
    const match = positive.match(pattern);
    if (match && !/^(?:은|는|이|가|자)?\s*(?:아니|않)/.test(positive.slice(match.index + match[0].length))) profile.special.push(key);
  }
  const size = text.match(/([1-9]\d?)\s*인\s*가구/);
  if (size) profile.householdSize = Number(size[1]);
  const moneyUncertain = past || /변경|올랐|늘었|줄었|아니|아닌|않|이하|이상|미만|초과|정도|약\s*\d|원\s*(?:에서|→|->)/.test(text);
  for (const [key, label] of Object.entries({ monthlyIncome: '개인\\s*월소득', householdIncome: '가구\\s*월소득', householdFinancialAssets: '가구\\s*금융재산', financialAssets: '(?<!가구\\s)금융재산|예금|현금', totalAssets: '총재산', debt: '부채|대출잔액' })) {
    const matches = [...text.matchAll(new RegExp(`(?:${label})\\s*(?:은|는|이|가|:)?\\s*([\\d,]+)\\s*(만)?원`, 'g'))];
    const values = [...new Set(matches.map(match => Number(match[1].replaceAll(',', '')) * (match[2] ? 10000 : 1)))];
    if (!moneyUncertain && values.length === 1) profile[key] = values[0];
  }
  return profile;
}

export function redactMoney(text) {
  return text.replace(/[\d,]+(?:\.\d+)?(?:\s*[억만천]\s*[\d,.]*)*\s*원|[\d,]+(?:\.\d+)?\s*[억만천](?![가-힣])/g, '[금액 비공개]');
}

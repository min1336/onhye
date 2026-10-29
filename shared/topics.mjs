export const categories = {
  employment: { label: '취업·배움', words: /취업|구직|실직|퇴사|일자리|백수|직업|훈련|내일배움|이직/ },
  housing: { label: '주거', words: /월세|전세|주거|보증금|임대|집세|주택|이사/ },
  family: { label: '출산·양육', words: /출산|육아|아이|아기|양육|영아|신생아|임신|자녀|개월/ },
  livelihood: { label: '생활·긴급지원', words: /생활비|생계|소득이 없|소득은 없|먹고|위기|긴급|수입이 없|장려금/ },
  senior: { label: '노후', words: /노후|연금|어르신|노인|은퇴|경로/ },
  health: { label: '건강·의료', words: /의료|병원|질환|건강|진료|치료|수술|약값|의료비|병원비/ },
  education: { label: '교육·장학', words: /교육|장학|학비|학생|학교|학자금|등록금|급식/ },
  care: { label: '보호·돌봄', words: /돌봄|간병|요양|장애|활동지원|보호시설/ },
  culture: { label: '문화·환경', words: /문화|체육|스포츠|여행|관광|환경|에너지|전기요금/ },
  business: { label: '창업·사업', words: /창업|사업자|소상공인|중소기업|사업체|자영업|폐업/ },
  agriculture: { label: '농림·어업', words: /농업|농사|농민|농림|어업|어민|축산|임업|귀농|귀어/ },
  administration: { label: '행정·안전', words: /행정|안전|재난|법률|법무|범죄|보훈|국가유공/ },
  other: { label: '기타 지원', words: /기타\s*(?:혜택|지원)/ },
};
export const TOPICS = Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, value.label]));
export const REGIONS = ['서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '전남광주', '경북', '경남', '제주'];

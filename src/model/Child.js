export const CHILD_SEX_LABELS = {
    boy: "男",
    girl: "女",
};
export const CHILD_TRAINING_OPTIONS = [
    { id: "balanced", label: "均衡", hint: "兼修文武礼" },
    { id: "literary", label: "文艺", hint: "侧重文采" },
    { id: "martial", label: "武艺", hint: "侧重武学" },
    { id: "etiquette", label: "礼仪", hint: "侧重礼法" },
    { id: "business", label: "商业", hint: "侧重经商" },
];
// 性格类型判定
export const getPersonalityType = (personality) => {
    if (personality < 35)
        return "rebellious";
    if (personality > 65)
        return "obedient";
    return "moderate";
};
export const PERSONALITY_LABELS = {
    rebellious: "叛逆",
    moderate: "温和",
    obedient: "顺从",
};
export const getPersonalityLabel = (personality) => {
    const type = getPersonalityType(personality);
    return PERSONALITY_LABELS[type];
};
// 获取子嗣的最高属性
export const getHighestStat = (child) => {
    const stats = child.stats;
    let highest = { stat: "literary", value: stats.literary };
    if (stats.martial > highest.value) {
        highest = { stat: "martial", value: stats.martial };
    }
    if (stats.etiquette > highest.value) {
        highest = { stat: "etiquette", value: stats.etiquette };
    }
    if (stats.business && stats.business > highest.value) {
        highest = { stat: "business", value: stats.business };
    }
    return highest;
};
export const STAT_LABELS = {
    literary: "文学",
    martial: "武艺",
    etiquette: "礼仪",
    business: "商业",
};
const clamp = (value) => Math.max(0, Math.min(100, value));
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const createRandomChild = (birthTurn) => {
    const aptitude = randomInt(40, 95);
    const base = 12 + Math.random() * 10 + aptitude * 0.1;
    const variance = () => (Math.random() - 0.5) * 6;
    // 性格值：正态分布，偏向中间值，但也有极端情况
    const personalityBase = 50;
    const personalityVariance = (Math.random() + Math.random() + Math.random()) / 3 - 0.5; // 三次随机平均，更接近正态分布
    const personality = clamp(personalityBase + personalityVariance * 60);
    return {
        id: `${Date.now()}_${randomInt(1000, 99999)}`,
        name: "", // 初始无名字，等待取名
        sex: Math.random() < 0.5 ? "boy" : "girl",
        birthTurn,
        aptitude,
        stats: {
            literary: clamp(base + variance()),
            martial: clamp(base + variance()),
            etiquette: clamp(base + variance()),
            business: clamp(base + variance()), // 初始化商业能力
        },
        training: "balanced",
        personality,
        takenByMatron: false,
    };
};

export class Formula {
    static compare(current, requirement) {
        if (typeof requirement === "number") {
            return current >= requirement;
        }
        if (typeof requirement === "string") {
            const match = requirement.match(/^(>=|<=|==|>|<)\s*(\-?\d+(?:\.\d+)?)$/);
            if (!match) {
                return false;
            }
            const [, op, rawValue] = match;
            const target = Number(rawValue);
            switch (op) {
                case ">=":
                    return current >= target;
                case "<=":
                    return current <= target;
                case ">":
                    return current > target;
                case "<":
                    return current < target;
                case "==":
                    return current === target;
            }
        }
        return false;
    }
}

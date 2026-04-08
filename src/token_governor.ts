import { BudgetMode, TokenBudget } from "./schemas";

export class TokenGovernor {
  private readonly CAPS: Record<BudgetMode, number> = {
    scout: 2000,
    operate: 8000,
    investigate: 16000,
    forensics: 32000
  };

  createBudget(mode: BudgetMode): TokenBudget {
    return {
      mode,
      max_input_tokens: this.CAPS[mode],
      used_tokens: 0
    };
  }

  // Rough estimation: 1 token ~= 4 chars
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  canFit(budget: TokenBudget, text: string): boolean {
    const estimated = this.estimateTokens(text);
    return budget.used_tokens + estimated <= budget.max_input_tokens;
  }

  addCost(budget: TokenBudget, text: string): boolean {
    const cost = this.estimateTokens(text);
    if (budget.used_tokens + cost <= budget.max_input_tokens) {
      budget.used_tokens += cost;
      return true;
    }
    return false;
  }
}

// 把"今日决策台"的主结论合成逻辑放在纯函数里，方便单测。
//
// 主结论默认来自策略优化器（自动优化挑选的最优规则）；当优化器不可用时退回到信号引擎。
// 但只要信号引擎触发了 warning 级别（趋势转弱、风险降档、禁止追高等），主结论必须吸收信号的动作和仓位上限，
// 避免出现"标题主仓持有 / 副标题禁止追高"这类自相矛盾的展示。

export function composePrimaryDecision({ signal, optimizer, riskBudget, trendProfile }) {
  const riskCap = riskBudget / 100
  const base = optimizer?.ok
    ? {
        action: optimizer.best.current.action,
        tone: optimizer.best.current.tone,
        score: optimizer.best.stabilityScore,
        exposure: Math.min(optimizer.best.current.exposure, riskCap),
        source: '自动优化',
        rule: optimizer.best.label,
        overfitRisk: optimizer.best.overfitRisk,
        stabilityScore: optimizer.best.stabilityScore,
      }
    : {
        action: signal.action,
        tone: signal.tone,
        score: signal.score,
        exposure: Math.min(signal.suggestedExposure, riskCap),
        source: '信号引擎',
        rule: trendProfile?.state ?? '样本不足',
        overfitRisk: '暂无',
        stabilityScore: signal.confidence,
      }

  if (signal.tone !== 'warning') return base

  // 信号是 warning：动作改用信号判定，仓位至少压到信号建议，并在规则里追加来源说明
  return {
    ...base,
    action: signal.action,
    tone: 'warning',
    exposure: Math.min(base.exposure, signal.suggestedExposure),
    rule: `${base.rule} · 信号 ${signal.action}`,
  }
}

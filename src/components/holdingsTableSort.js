// numeric-primitive-only 排序契约：与 src/analysis/formatters.js 的 formatPercent /
// formatNumber 在 PR #26-#30 收紧的边界对齐——只有 Number.isFinite(value) 的原始 number
// 参与数值比较，null/undefined/NaN/±Infinity/string/boolean/array/object/BigInt/
// boxed Number/Date/valueOf-obj 等"非有限 number 原始值"一律排在合法 number 之后，且
// asc/desc 表现一致（缺失值在两个方向上都稳定钉到列尾，不随 factor 翻到列首）。
// 两侧都缺失时返回 0，依赖 Array.prototype.sort 的稳定性保留原始顺序。
export function compareHoldingsNumeric(av, bv, factor) {
  const aValid = Number.isFinite(av)
  const bValid = Number.isFinite(bv)
  if (aValid && bValid) return (av - bv) * factor
  if (aValid) return -1
  if (bValid) return 1
  return 0
}

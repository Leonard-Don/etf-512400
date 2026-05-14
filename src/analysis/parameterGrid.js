// 参数网格：把 { axisName: values[] } 平铺成确定性、可序列化的组合枚举。
// 设计取向：
// 1) axis 名称按字典序排序，便于跨进程对齐组合 key。
// 2) axis 值升序去重，避免输入顺序影响枚举顺序。
// 3) 非有限值（NaN/Infinity）默认抛错；可通过 onInvalid: 'skip' 切换为剔除并 warn。
// 4) filter 用于裁剪不可行组合（如 fast/slow 距离不足）；返回 false 即剔除并计入 rejectedByFilter。

const VALID_ON_INVALID = new Set(['throw', 'skip'])

function isFiniteOrString(value) {
  if (typeof value === 'string') return true
  return Number.isFinite(value)
}

function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

function dedupeAndSort(values) {
  const seen = new Set()
  const out = []
  values.forEach((value) => {
    const key = typeof value === 'number' ? `n:${value}` : `s:${value}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(value)
    }
  })
  return out.sort(compareValues)
}

function validateAxes(axes) {
  if (axes === null || typeof axes !== 'object' || Array.isArray(axes)) {
    throw new TypeError('parameterGrid：axes 必须是非空对象 { name: values[] }')
  }
  const names = Object.keys(axes)
  if (names.length === 0) {
    throw new RangeError('parameterGrid：至少一个 axis')
  }
  return names.sort()
}

function normaliseAxisValues(name, rawValues, onInvalid, warnings) {
  if (!Array.isArray(rawValues)) {
    throw new TypeError(`parameterGrid：axis "${name}" 的值必须是数组`)
  }
  if (rawValues.length === 0) {
    throw new RangeError(`parameterGrid：axis "${name}" 不能为空数组（empty）`)
  }
  const filtered = []
  const dropped = []
  rawValues.forEach((value) => {
    if (isFiniteOrString(value)) {
      filtered.push(value)
    } else {
      dropped.push(value)
    }
  })
  if (dropped.length > 0) {
    if (onInvalid === 'throw') {
      throw new RangeError(
        `parameterGrid：axis "${name}" 包含非有限值（NaN/Infinity）：${dropped.join(', ')}`,
      )
    }
    warnings.push(
      `axis "${name}" 剔除 ${dropped.length} 个非有限值（invalid）：${dropped.join(', ')}`,
    )
  }
  if (filtered.length === 0) {
    throw new RangeError(`parameterGrid：axis "${name}" 清洗后为空`)
  }
  return dedupeAndSort(filtered)
}

function cartesian(axisNames, axisValues) {
  // 第一个 axis 变化最慢、最后一个 axis 变化最快，组合按字典序输出。
  let acc = [{}]
  axisNames.forEach((name) => {
    const next = []
    acc.forEach((combo) => {
      axisValues[name].forEach((value) => {
        next.push({ ...combo, [name]: value })
      })
    })
    acc = next
  })
  return acc
}

export function parameterGrid(axes, options = {}) {
  const onInvalid = options.onInvalid ?? 'throw'
  if (!VALID_ON_INVALID.has(onInvalid)) {
    throw new TypeError(
      `parameterGrid：onInvalid 必须为 throw 或 skip，收到 "${onInvalid}"`,
    )
  }
  const filter = options.filter ?? null
  if (filter !== null && typeof filter !== 'function') {
    throw new TypeError('parameterGrid：options.filter 必须是 function')
  }

  const axisNames = validateAxes(axes)
  const warnings = []
  const axisValues = {}
  axisNames.forEach((name) => {
    axisValues[name] = normaliseAxisValues(name, axes[name], onInvalid, warnings)
  })

  const raw = cartesian(axisNames, axisValues)
  let rejectedByFilter = 0
  const combinations = []
  raw.forEach((combo) => {
    if (filter) {
      let keep
      try {
        keep = Boolean(filter(combo))
      } catch (error) {
        throw new Error(
          `parameterGrid：filter 抛错（combo=${JSON.stringify(combo)}）：${error.message}`,
          { cause: error },
        )
      }
      if (!keep) {
        rejectedByFilter += 1
        return
      }
    }
    combinations.push(Object.freeze(combo))
  })

  if (filter && combinations.length === 0 && raw.length > 0) {
    warnings.push('filter 拒绝了全部组合，最终网格为空')
  }

  const size = combinations.length
  const frozenCombinations = Object.freeze(combinations)
  const frozenAxisNames = Object.freeze([...axisNames])
  const axisValuesFrozen = Object.freeze(
    axisNames.reduce((acc, name) => {
      acc[name] = Object.freeze([...axisValues[name]])
      return acc
    }, {}),
  )

  return Object.freeze({
    axisCount: axisNames.length,
    axisNames: frozenAxisNames,
    axisValues: axisValuesFrozen,
    combinations: frozenCombinations,
    size,
    rejectedByFilter,
    warnings: Object.freeze([...warnings]),
    iterate() {
      return frozenCombinations[Symbol.iterator]()
    },
    toJSON() {
      return {
        axisNames: [...frozenAxisNames],
        axisValues: axisNames.reduce((acc, name) => {
          acc[name] = [...axisValues[name]]
          return acc
        }, {}),
        combinations: frozenCombinations.map((combo) => ({ ...combo })),
        size,
        rejectedByFilter,
        warnings: [...warnings],
      }
    },
  })
}

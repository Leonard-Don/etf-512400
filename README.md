# 512400 ETF Research Console

[![CI](https://github.com/Leonard-Don/etf-512400/actions/workflows/ci.yml/badge.svg)](https://github.com/Leonard-Don/etf-512400/actions/workflows/ci.yml)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=1d1d1f)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Realtime Quotes](https://img.shields.io/badge/quotes-runtime%20fallback-0969da)
![Research Snapshot](https://img.shields.io/badge/snapshot-local%20research-6a7f64)
![Status](https://img.shields.io/badge/status-personal%20research-6a7f64)

有色金属 ETF 南方（512400）的本地实时行情与研究决策台。它把盘中行情、估算净值、折溢价、流动性、商品驱动、跟踪质量和历史策略验证放到一个单页控制台里，用于自用研究、复盘和交易前检查。

## GitHub 首页速览

- **盘中看板**：实时价格、涨跌幅、成交额、换手、估算净值和折溢价集中展示。
- **降级可见**：东方财富、腾讯行情、天天基金估值等数据源失败或回退时，页面会明确标出来源和新鲜度。
- **策略实验**：趋势跟随、回撤低吸、因子共振和自动优化规则都保留历史验证口径。
- **本地优先**：不提供交易入口，数据刷新、历史缓存和复盘全部在本地研究 workflow 中完成。

![512400 ETF Research Console](docs/assets/github-console.png)

## 它回答什么

- 今天是追高、观望，还是只等回撤低吸？
- 当前 512400 的实时价格、涨跌幅、成交额、换手和折溢价是否正常？
- 黄金、铜、铝、锂、稀土这些商品驱动里，哪些在贡献趋势，哪些在放大风险？
- 512400 相对 000819 基准的跟踪质量、流动性和净值偏离是否需要额外检查？
- 历史样本里，趋势跟随、回撤低吸、因子共振和自动优化规则的收益与回撤表现如何？

## 核心能力

- **实时行情层**：运行时请求 512400 最新报价，并在东方财富 quote/kline 不可用时使用腾讯行情兜底。
- **今日决策台**：聚合主动作、主仓位、核心风险、商品风险排序和当前数据新鲜度。
- **信号实验室**：用趋势、因子、折溢价、流动性和风险预算合成当前动作与建议仓位。
- **自动策略优化**：搜索趋势窗口、回撤档位和风控阈值，并做样本外验证评分。
- **跟踪与交易质量**：对比 000819 基准，监控跟踪差、折溢价温度和成交额分位。
- **动态策略回测**：展示买入持有、趋势跟随、回撤低吸、因子共振等历史参考结果。
- **本地历史缓存**：每次刷新会追加 `src/data/history/512400-snapshots.json`，便于复盘数据状态。

## 数据口径

这个项目有两层数据，不会把所有数据都伪装成实时：

| 层级 | 刷新方式 | 用途 | 主要入口 |
| --- | --- | --- | --- |
| 运行时实时行情 | 页面启动后请求，本地开发环境约 30 秒刷新 | 价格、涨跌幅、成交额、换手、交易时间 | `src/analysis/realtimeQuote.js`、`/api/realtime/*` |
| 研究快照 | 手动运行 `npm run refresh:data` 写入本地 JSON | K 线、基准、净值趋势、商品驱动、持仓、历史缓存 | `scripts/refreshData.mjs`、`src/data/liveSnapshot.json` |

当前接入的数据源包括：

- 东方财富行情接口：512400 quote、512400 日 K、000819 基准日 K、期货/指数行情与 K 线
- 腾讯行情接口：512400 实时报价兜底
- 天天基金脚本：单位净值、累计净值、阶段收益、净值序列
- 天天基金估算净值：盘中估值与估算涨跌幅
- 上交所、中证指数和基金公告：持仓、指数编制和基础资料

## 本地运行

```bash
npm install
npm run refresh:data
npm run memo:export -- --format=text
npm run dev
```

开发服务器默认由 Vite 启动。实时行情代理只在本地开发服务器中启用，用于规避浏览器跨域限制。
`npm run memo:export` 会基于本地 `src/data/liveSnapshot.json` 导出研究备忘，支持 `--format=markdown`、`--format=json` 和 `--format=text`。

## 验证

```bash
npm run lint
npm run test
npm run build
```

CI 会在 `main` 分支推送和 pull request 上执行 lint、单元测试、Vitest 组件测试、smoke test 和构建。

## 项目结构

```text
src/
  analysis/                信号、趋势、实时行情解析、自动优化、动态回测与格式化函数
  components/              页面展示组件
  data/history/            本地刷新历史缓存
  data/etf512400.js        ETF、持仓、因子、风险、事件样例数据
  data/liveSnapshot.json   刷新脚本生成的当前研究快照
  App.jsx                  研究工作台界面
  App.css                  页面样式
scripts/
  refreshData.mjs          拉取并写入研究快照
  smokeTest.mjs            核心分析链路冒烟验证
tests/
  *.test.mjs               Node 单元测试
  *.test.jsx               Vitest 组件测试
```

## 使用边界

这是个人研究工具，不是交易系统，也不构成投资建议。所有实时行情和研究快照都依赖公开网页接口、本地代理和本地缓存；遇到接口限流、节假日、盘后或源站结构变化时，页面会显示降级状态，研究结论需要人工复核。

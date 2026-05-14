# Antigravity Context Window Monitor
## 需求详细说明书 (Issue #54)

### 1. 业务背景与用户痛点
在原项目中（Issue #54），用户反馈了以下核心体验问题：
1. **积分查看隐蔽**：官方系统的日常额度掉档快（20% 阶梯式 UI），导致重度用户最终主要依靠 **AI Credits (专属越界积分)**，但原生的积分布局在多层菜单内，查看体验极其繁琐。
2. **多账号管理混乱**：多设备或多账号党记不清每个账号具体在哪一天自动续费或刷新，常常导致快到期的账号闲置浪费，没到期的账号却提前暴雷。

### 2. 底层架构与技术可行性边界
根据我们在诊断脚本（`mine_system.ts` 和 `ide-quota-logic.ts`）取得的数据：

*   **🟢 AI Credits 量（完全可行）**: 
    在底层 `GetUserStatus` 返回包中的 `userTier.availableCredits[0].creditAmount`，可随每一次轮询拿到实时的、最准确的点数。
*   **🔴 月结刷新日（系统死锁无法自动化）**: 
    Windsurf/Codeium 云端 **绝不在平时** 下发你的包月账单刷新日（`GetBillingInfo` 会直接 HTTP 404）。只有当某一次向大模型发起请求被云端因为彻底没额度给掐断（`QUOTA_EXHAUSTED`）时，API 拦截下来的 `metadata.quotaResetUTCTimestamp` 才会告诉你真正的月充值日。因此，无法用任何预先请求抓到这个数据。

### 3. 解决方案设计
基于上面的边界推导，我们采用 **“API 全自动获取” + “配置式本地推算”** 的混搭方案：

#### 3.1 功能一：状态栏 AI 专属积分外显
*   **机制**：在原有的轮询（Polling）数据逻辑里，除了获取 Context Tokens 和 Fraction 之外，顺手把 Credits 抓下来。
*   **交互**：在 VS Code / Windsurf 的右下角状态栏区域，增设一个模块显示如 `⚡ 14701` 或并排到现有的组件中。
*   **控制**：可通过设置项决定是否要把这个部分独立展示还是合并、隐藏。

#### 3.2 功能二：跨账号的推算账期挂件
*   **机制**：让用户在 VSCode 插件配置页手动配置自己的充值日（1-31 日）。这是成本最低也最通用的本地记账解法。
*   **交互**：通过读取主机当前自然日，并算出距离目标刷新日的天数。
*   **效果展示**：集成在积分项中，如展示为：`⚡ 14701 (15天后刷新)` 或 Tooltip 悬停显示。

---

### 4. 代码模块与实施计划 (Implementation Tasks)

#### Task 1: 扩展插件配置项
在现有的 `package.json` 的 `configuration.properties` 节点中增加：
1.  `antigravityContextMonitor.statusBar.showAiCredits`: (布尔型)是否在状态栏展示专属 AI 积分。默认为 `true`。
2.  `antigravityContextMonitor.accountBillingDay`: (数字型)所在账号的月度统筹账单日期设定。范围 `0-31`，`0` 表示不开启天数推算。

#### Task 2: 拦截并提取底层结构字段
在发往 LS `LanguageServerService/GetUserStatus` 的 RPC 调用回调处理中，更新数据存储模块（如原本处理 `planStatus` 的结构）：
```typescript
{
  // 额外拦截路径：
  const creditsArray = response.userTier?.availableCredits;
  const aiCreditStr = creditsArray?.[0]?.creditType === 'GOOGLE_ONE_AI' 
                      ? creditsArray[0].creditAmount 
                      : '0';
  const aiCredits = parseInt(aiCreditStr, 10);
  // 加入全局 Context/Store 中准备渲染
}
```

#### Task 3: 月度计息倒数推算
新增一个工具函数（`Date` 日期推演）：根据系统当前的月份天数，以及读取出的 `accountBillingDay` 阈值，推演 `(目标日 - 今日)` 的跨月或同月有效天数。

#### Task 4: UI/状态栏渲染更新 (StatusBarController)
*   如果配了 `showAiCredits`，则读取存下的积分，展示文本内容；
*   如果在 `accountBillingDay` > 0 开启了推算，就把得到的天数包裹在 Tooltip (鼠标悬停词条) 或状态条主体，例如:
    `[ 🤖 15k | 🟢 100% | ⚡ 14701 ]` (鼠标悬停: *您的附加积分有 14701。距离下一次月账单额度重置还有 12 天*)。

#### Task 5: 快捷网页面板跳转 (Quick Actions)
*   **机制**：在原有的状态栏配置增加 `Command` 命令绑定，当用户点击 `⚡ 14701` 面板时，通过菜单或直接调用 `vscode.env.openExternal` 唤起浏览器。
*   **底层直达链接**：
    1. **活动记录看板 (查看点数详情与日期)**: `https://antigravity.google/g1-activity`
    2. **获取更多积分商城**: `https://antigravity.google/g1-credits`
*   *(说明：你在源码截图里看到的 `?utm_source=...` 后缀，是官方专门拿来追踪各种按钮的点击率数据的（比如记录“用户是不是点了设置页的这个按钮来的”）。我们在自定义插件里不需要发这些"假"参数给官方，只用最干净的主链接，既不污染官方后台数据，也能百分百打开同一个界面。)*

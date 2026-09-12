# Issue #23：未弹窗却报告用户拒绝

## 已确认的机制

截图中的 automation_create 在约 3 ms 内返回 the user rejected tool。仅凭截图不能确认远端会话策略。

当前 Desktop app.asar 的 dsh-user-approval@0.1.5-rc.1 在 effectivePolicy(session) 为 never 时，直接返回 rejected，不调用 approval/request 响应端。dsh-tools 将 rejected 一律翻译为 the user rejected tool。在隔离环境中提取并调用这两个真实方法，复现 prompts=0，同时得到截图中的错误文本；未连接真实 Agent、写入会话或改变策略。

## 插件修复

插件自身要求人工审批的操作，在下游允许后读取宿主提供的 effectivePolicy(session)。若为 never，明确报告策略自动阻止，告知用户改用 ask 后重试，或在自动化页面手动管理；不再声称用户点击拒绝。策略读取失败时明确诊断并阻止执行。

ask 及不提供策略读取接口的旧宿主仍使用原有 ask 流程。其他拦截器的拒绝/审批结果、取消、非管理 Agent、只读查询和纯暂停操作保持原状。没有自动放行，也没有修改任何审批策略。

## 验证与限制

157 项测试、类型检查及 Host / Client 构建通过。新增 4 项测试覆盖 never、ask、旧接口、前置拒绝、取消、纯暂停及读取失败。

这修复的是策略禁用导致的误导反馈，不是强制弹出审批。若报告者实际使用 ask，仍需其审批日志核对响应端是否返回 rejected；现有截图不足以确定这一分支。PR #24 的 Agent 初始化适配与此问题独立。

本修复不包含 RPC 注册兼容改动或 PR #24 的 Agent 初始化适配；不改变审批策略，不操作真实自动化。需重新加载宿主后应用构建产物。

# 桌宠菜单与自动关注修复

基于官方 `0.2.0-rc.2` 和已验收的 `m4-fixes`，修复包位于 `electron/apps/desktop/.desktop-build/targets/win-x64/candidates/m4-pet-fixes/personal-unsigned/win-unpacked`。使用 [启动脚本](../electron/migration/m4-pet-fixes/launch-trial.ps1) 运行，继续使用原来的 `m4-trial-data` 会话和配置。启动前退出旧客户端。

## 用户可见行为

- 右键菜单在宠物旁展开，根据屏幕边缘选择左右方向，不再覆盖宠物。Escape、窗口失焦或执行菜单操作后，收起菜单并释放额外窗口空间。失焦收起同时由原生窗口负责。
- “自动跟随”更名为“自动关注任务”。点击后立即解除固定会话，清除原关注对象的动画和短暂保持状态，优先关注等待处理、阻塞、运行中的任务，最后显示短暂的完成提示。没有活动任务时恢复闲置。
- 菜单高亮当前模式，显示任务状态及会话末尾短标识。运行中的任务显示“正在处理任务”。没有可关注会话时禁用固定选项；双击宠物仍打开所关注的会话。

## 实现范围

宠物呈现与选择逻辑位于 `@nidofy/dsh-desktop-extras`；窗口扩展、屏幕内定位及原生失焦处理位于桌面适配层 `apps/desktop/src/pet.ts`。未修改官方 Agent Loop 或 Session 写入逻辑。动作完成后立即刷新宠物快照，避免仅等待下一轮轮询。

## 验收

- 21 项桌宠状态、动画和交互测试通过，新增解除同优先级固定会话及等待/运行/完成优先级回归。
- Desktop 构建通过，修改的原生文件 lint 为 0 警告、0 错误；扩展 README 中英配对检查通过。
- 最终打包客户端运行 `m4-pet-fixes-0SEAs0`：M2、M3、M4 共 33 项检查全部通过。使用独立测试数据和本地模拟模型，不使用真实模型凭据。
- 菜单覆盖 0.75、1、1.25、1.5 四档尺寸及屏幕左右边缘，检查与宠物不重叠、菜单完整可见、关闭释放空间、原生失焦关闭。
- 实际官方 Session 流程验证：固定已结束会话 → 自动关注运行任务 → 另一工作区任务调用 `ask_user_question` → 优先关注等待输入 → 取消后回到运行任务 → 结束后恢复闲置 → 菜单隐藏宠物。
- 同时回归官方登录入口、环境浮窗、中英页面反复切换/缩放、连接路由、工程工作台、资源加载、多宠物和取消退出后的可用性。
- 已核对最终包的宠物资源与源码摘要一致，原 M4 与 M4-fixes 的 6 个已记录产物摘要保持不变。

并发测试使用两个独立工作区；受保护的同一工作区会返回 `PROTECTION_BUSY`，不能用作等待输入场景。Windows 高 DPI 几何检查等待原生尺寸稳定，并允许 CSS 浮点误差。最终验收包含真实原生焦点切换。

验收结果及摘要见 [evidence/summary.json](../electron/migration/m4-pet-fixes/evidence/summary.json)；完整运行见 [evidence/desktop.json](../electron/migration/m4-pet-fixes/evidence/desktop.json)。此前的企业内网验收继续搁置；本次产物仍为未签名试用包。

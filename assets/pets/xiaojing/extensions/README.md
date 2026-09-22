# 吃白饭的大肥鱼：独立互动扩展

使用内置 imagegen，以 package/portrait.png 为身份参考生成独立 pat、happy、dragged。不修改基础 v2 图集。

- pat：4 帧，低头、闭眼和满足地歪头，再恢复。
- happy：4 帧，轻触身体后抬手、微笑，再放松。
- dragged：3 帧，悬坐与轻摆；原生成四宫格中右上帧配饰方向错误，已排除。
- 一次性动作结束由运行时返回最新任务状态。拖动循环只在实际拖动期间持续。
- durationsMs 与实际帧坐标见 interactions.json，校验见 checksums.json。
- sources 保留原始生成结果；pat/happy 第一轮横排因跨格边界被弃用。assemble.py 仅裁切、统一比例与透明排版，不生成或复制动作。
- contact-sheet.png 是正常尺寸逐帧视觉记录；各 *-preview.webp 为按声明时长循环的检查动画。原生窗口和真实手势验证另记，不由这些预览代替。

生成提示概要：严格保留母版身份、右侧蝴蝶结/鲸尾；四个透明全身姿态，2×2 布局，同尺寸、无阴影/文字/粒子；分别表达摸头、开心、悬吊拖动。最终接受图与排除记录见 visual-record.json。

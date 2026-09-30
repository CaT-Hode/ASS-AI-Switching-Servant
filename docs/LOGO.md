# Logo 编辑记录

当前版本以用户指定参考图的 `public/ass-logo-reference.svg` 为底稿，逐片收窄花瓣并调整橙色枢纽。保留八片花瓣各自的原始曲线特征，不做旋转复制；参考底稿不改动。源码为 `scripts/brand-geometry.cjs`，最终 SVG 为 `public/ass-logo.svg`。

## 0.2.18 收窄花瓣与向内加粗

- 在每片花瓣自身的径向坐标中，把横向宽度压缩到原来的 93%，径向长度不变，略微扩大相邻花瓣的透明间隙。
- 从收窄后的真实根部重新拟合中心外沿，中心与花瓣的法向间距从 16 增至 20 个源图单位。
- 中心圆孔半径从 132 缩小至 116，使橙色齿轮向内加粗；中心位置、八瓣数量和两种实色保持一致。
- SVG、透明 PNG、界面图标和 Windows ICO 均使用同一导出源；检查花瓣宽度、径向长度、八处空隙边以及中心不接触花瓣。

## 0.2.17 内部修改与统一导出

- 沿用基线的八片花瓣，包括所有外弧、切角、相对位置、间距与实色；仅替换中心路径。
- 从每片原始贝塞尔路径提取靠近中心的实际根部，用 1.5 个源图单位以内的折线近似生成根部导向边。
- 按真实位置闭合根部轮廓，八处相邻花瓣之间均添加单独的空隙宽度导向边；不跳过空隙，也不强求正十六边形。
- 中心外沿为完整导向轮廓向内的 16 个源图单位法向偏移。内孔为半径 132 的正圆，中心保留参考图位置。
- 花瓣及中心采用原图取样实色 `#82807c` / `#dc782f`，无高光、渐变、阴影或纹理。
- `scripts/make-icons.cjs` 从同一 SVG 导出透明 PNG 与多尺寸 ICO；导出清单、花瓣路径哈希、根部 / 空隙导向边与文件哈希保存于 `docs/assets/ass-logo-exports.json`。
- 定向检查验证八片花瓣未变、八条空隙边均参与匹配、导向边等距，以及中心与原始贝塞尔花瓣不接触。

## 原样 SVG 复刻基线

- 原图：`docs/assets/ass-reference-flat.png`，1254 × 1254；保留输入文件，SHA-256 和各花瓣边界记录见 `docs/assets/ass-reference-trace.json`。
- SVG：`public/ass-logo-reference.svg`。八片花瓣各为独立的闭合贝塞尔路径，中心圆环为带孔路径；无内嵌位图、无旋转复制、无外部资源。
- 保留实际外弧、切角、大小差异、位置、花瓣间距和原始中心圆环；不进行对称化或形状重设计。
- 沿用纯平面要求，使用参考图不透明区域的灰色和橙色中位数作为实色填充，不复刻细微纹理或背景中的红色残留噪点。
- 原尺寸轮廓掩膜比对：花瓣 IoU 0.9974741717，圆环 IoU 0.9928461054。该数值衡量轮廓覆盖，不代表纹理逐像素一致。
- 复刻预览：`design/logo/ass-reference-preview.png`；复刻基线保留原始圆环，最终内部修改位于另一份 SVG 中。
- 描摹工具为仅安装于 `qa/logo-trace-tools` 的 node-potrace 2.1.8（GPL-2.0），未引入应用依赖，也不打包其代码；独立生成的 SVG 为项目原图的轮廓输出。

## 未采用的 0.2.17 参数化重建尝试

- 八片宽花瓣使用同一条纯色路径，按 45° 旋转复制，具有一致的切角与旋转轮廓。
- 中心内孔是半径 116 的正圆；外沿由 16 段直边构成，不强求正十六边形。
- 每片花瓣的两段内缘来自中心对应边的法向偏移：间距固定为 16 个源图单位，不采用缩放多边形或单独旋转猜测。
- 内缘端点各缩进 20 个单位，在相邻花瓣的根部保留空隙。外部曲线另留出宽瓣间隙，不粘连。
- 1024 × 1024 源画布仅含 `#858581` 灰色与 `#d97732` 橙色；无高光、渐变、滤镜、阴影或纹理，内孔与所有间隙透明。
- PNG 和 16 / 24 / 32 / 48 / 64 / 128 / 256px ICO 均由同一 SVG 导出。顶栏、关于页、托盘、EXE、开始菜单与注册图标不各自修改颜色或比例。

## 0.2.16 历史平面位图

以第一版宽花瓣的旋转轮廓为基础，保留八瓣、切角边缘与增大的花瓣间距。中心改为更大的橙色枢纽：内圆，外沿从十六边形进一步调整为顺着花瓣和空隙宽度变化的不规则轮廓。取消原有立体高光设计。使用内置图像编辑工具生成，统一导出应用图标与 Windows ICO；历史版本可从 Git 恢复。

最终编辑提示词：

Refine ONLY the orange center hub silhouette of this ASS flat eight-blade swirling emblem. Preserve all eight gray wide clockwise curved petals from reference, their chamfered sharp corners, location, gap width, composition and color. Preserve a large perfectly CIRCULAR transparent inner opening. The outer hub should NOT be a regular polygon now: use a carefully fitted irregular 16-facet contour with alternating long and short straight edges, eight repeated clockwise angular sectors. Tailor its corners and long faces to parallel the adjacent petals' inner edges; outward shoulders selectively extend into wider gaps, shorter chamfer faces sit opposite narrower spaces, giving consistent narrow transparent clearance between hub and all petals. No touching or overlap. The outer boundary should subtly echo the petals' clockwise sweep like a purpose-designed enigmatic coupling / aperture, not a bolt or randomly distorted blob, not sharp narrow spikes, not a gear with extra teeth. Keep orange bold substantial visual weight and center size 35-37 percent emblem diameter. Flat uniform burnt orange hub and uniform gray petals, two colors only, refined clean mathematical graphic identity. NO shading, gradients, highlights, grain, metal, bevels, lighting, glow or texture. No extra symbols/text. Make background and circular hole clean genuine transparent alpha with absolutely no red residue or stray pixels. Compact square transparent production logo PNG.

此前的规则十六边形版本提示词：

Precise refinement of supplied ASS flat eight-petal spinning flower mark. Center geometry must now be REVERSED: perfectly round smooth circular TRANSPARENT INNER HOLE, and a regular SIXTEEN-SIDED OUTER boundary, exactly sixteen straight facets with sixteen crisp corners. NO outer octagon. Keep hub enlarged around 35 percent total emblem diameter. Rotate the outer hexadecagon by approximately 11.25 degrees relative to horizontal-top-edge orientation and optically align its short outer facets to the adjacent eight petals' inner angular edges: intimate coherent fit, uniform narrow transparent clearance around hub, no overlap. This geometry should feel intriguingly enigmatic like a precision aperture or silent symbolic mechanism, not mechanical nut with 8 sides. Preserve original first-concept broad graceful eight clockwise curved gray petals with harder chamfered tips, enlarged separation and compact full square framing. Center circular hole about 65 percent hub width. Solid restrained warm burnt orange central ring, solid uniform graphite gray petals. PURE FLAT solid color graphic, no shading/gradients/highlights/noise, no dimensional render. Mystery comes ONLY from the rotated geometry, symmetry and negative space; absolutely no extra symbols, eyes, runes, texture or ornament. All background, hole and petal gaps true transparent alpha with no red specks or fringes, clean precise antialiased edges. One full square transparent logo PNG; no text, mockup or border.

## 0.2.14 历史提示词

Use case: precise-object-edit. Edit target: the provided ASS existing app icon PNG. Change ONLY the eight blue petals to a neutral graphite gray / silver-gray palette with no blue or green tint. Preserve the exact existing 8-petal swirling flower silhouette, each petal shape, direction, relative sizes, overlaps and soft dimensional gradient structure. Preserve the red hollow center ring unchanged in color, thickness, size and material style; the center hole must remain transparent. Preserve the compact tightly filled square composition. Neutral gray highlights should not be white or overly bright, with charcoal shadows and medium silver gray highlights readable on both dark and light backgrounds. Genuine transparent alpha background, clean antialiased edges, no extra details, no text, no border, no background or cast shadow. Output a production app icon, not a mockup.

源图为 `public/ass-logo.png`，界面使用紧凑导出 `public/ass-app-icon.png`，Windows 使用 `assets/ass.ico`。注册用 ICO 同时打包到 `resources/ass.ico`。不再以 CSS 灰度滤镜单独处理某个入口。

## 历史圆环编辑提示词

Edit this existing ASS application logo with one precise local change only. The source is a blue chrysanthemum/pinwheel icon with a solid blue circular disc exactly at its center. Replace ONLY that central solid blue disc with a clean vivid red hollow circular ring (a red outlined circle, like ⭕, not a prohibition slash). The ring's outer diameter should match the current blue disc, with an even moderately thick stroke about 15 percent of its outer diameter, a genuinely transparent empty center, and a smooth anti-aliased edge. Keep the ring centered exactly where the original blue disc was. Preserve every surrounding blue petal, their shapes, positions, gradients, blue hues, count, lighting, and original spacing. Preserve the overall square canvas and original artwork framing/padding; do NOT enlarge or reposition the surrounding flower in this edit, as icon export code handles the requested final Windows size separately. Preserve the genuinely transparent background and the transparent gaps between petals. No other changes, no new text, no emoji glyph outside the center, no extra symbols, no border around the whole logo, no drop shadow, no colored background. Output the complete edited square transparent PNG logo, not a cropped center fragment.

# 小鲸资源生成记录

使用内置 image_gen，通过 hatch-pet 流程制作；未使用 API CLI。原图仅用于角色外观参考。以下是生产提示词及修正记录。

## 共同修正

- 后续动作只引用已由四张原图生成的统一母版与布局参考，避免超过五张输入图限制。
- 保持完整头发、鲸尾和鞋；缩小整行角色占位以修复裁切或相邻人物接触。
- 向右侧面时，角色解剖学左侧蝴蝶结位于远侧并可被遮挡；向左侧面保持近侧蝴蝶结。
- 接受内置工具返回的真实 alpha，不为强制绿底而重新生成。
- 跳跃改为约 5–6% 身高的小跳，以减少切换动作的尺寸差。
- 第九行从上经右到右下，任何中间姿势不能朝左；第十行从下经左到左上，任何中间姿势不能朝右。
- 第十行最终以完整已生成行作为编辑目标，修正向下看的半睁眼；保留成功的尺度和左转方向。

## 各视觉任务的权威提示词

### base  Create one clean full-body reference sprite for Codex pet Xiaojing.

Pet identity: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona..
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..


Place a single centered pose on a perfectly flat pure green #00FF00 chroma-key background. Keep the full pet visible, compact, readable at 192x208, and easy to animate. Preserve approved reference identity cues. No scenery, text, borders, checkerboard transparency, shadows, glows, detached effects, or extra props. Keep #00FF00 and close colors out of the pet, props, highlights, and effects.

### idle  Create one horizontal animation strip for Codex pet `xiaojing`, state `idle`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 6 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 6 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Calm low-distraction resting loop: subtle breathing, tiny blink, slight head/body bob, and only quiet persona-preserving motion.

State requirements:
- CRITICAL: idle is the low-distraction baseline state and the first frame is also used as the reduced-motion static pet.
- Use only subtle idle motion: gentle breathing, a tiny blink, a slight head or body bob, a very small material sway, or another quiet motion that fits the pet persona.
- Keep the pet essentially in the same pose, facing direction, silhouette, markings, palette, and prop state across all 6 frames.
- Idle variation must stay calm but still read as animation; do not repeat effectively identical copies across the loop.
- Do not show waving, walking, running, jumping, talking, working, reviewing, emotional reactions, large gestures, item interactions, or new props.
- Feet, base, body, or object anchor should remain planted or nearly planted.
- The first and last frames should be very close visually so the loop feels calm and does not pop.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### running-right  Create one horizontal animation strip for Codex pet `xiaojing`, state `running-right`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 8 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 8 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Dragging-right loop: show directional movement to the right through body and limb poses only.

State requirements:
- Show directional drag movement to the right through body, limb, and prop movement only.
- The row must unmistakably face and travel right.
- The movement cadence must alternate visibly across the 8 frames instead of repeating one nearly static stride.
- Do not draw speed lines, dust clouds, floor shadows, motion trails, or detached motion effects.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### running-left  Create one horizontal animation strip for Codex pet `xiaojing`, state `running-left`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 8 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 8 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Dragging-left loop: show directional movement to the left through body and limb poses only.

State requirements:
- Show directional drag movement to the left through body, limb, and prop movement only.
- The row must unmistakably face and travel left.
- The movement cadence must alternate visibly across the 8 frames instead of repeating one nearly static stride.
- Do not draw speed lines, dust clouds, floor shadows, motion trails, or detached motion effects.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### waving  Create one horizontal animation strip for Codex pet `xiaojing`, state `waving`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 4 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 4 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Greeting loop: paw or limb down, raised, tilted, and returning in a friendly attention gesture.

State requirements:
- Show the greeting through paw, hand, wing, or limb pose only.
- Do not draw wave marks, motion arcs, lines, sparkles, symbols, or floating effects around the gesture.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### jumping  Create one horizontal animation strip for Codex pet `xiaojing`, state `jumping`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 5 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 5 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Hover jump loop: anticipation, lift, airborne peak, descent, and settle through body height.

State requirements:
- Show the jump through pose and vertical body position only: anticipation, lift, airborne peak, descent, settle.
- Do not draw ground shadows, contact shadows, drop shadows, oval shadows, landing marks, dust, smears, bounce pads, or motion marks under the pet.
- Keep the background outside the pet perfectly flat chroma key with no darker key-colored patches.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### failed  Create one horizontal animation strip for Codex pet `xiaojing`, state `failed`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 8 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 8 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Blocked/failed loop: slumped or deflated reaction with sad or closed eyes.

State requirements:
- Show failure through slumped pose, drooping ears/limbs, closed or sad eyes, and lower body position.
- Tears, small smoke puffs, or tiny stars are allowed only if attached to or overlapping the pet silhouette and kept inside the same frame slot.
- Do not draw red X marks, floating symbols, detached stars, separated smoke clouds, falling tear drops, dust, or other loose effects.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### waiting  Create one horizontal animation strip for Codex pet `xiaojing`, state `waiting`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 6 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 6 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Needs-input loop: expectant asking pose for approval, help, or user input.

State requirements:
- Show that Codex needs approval, help, or user input through an expectant asking pose.
- Keep the motion patient and readable, without turning it into ordinary idle or review.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### running  Create one horizontal animation strip for Codex pet `xiaojing`, state `running`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 6 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 6 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Working loop: focused active-task processing, thinking, typing, scanning, or effortful concentration; not literal foot-running, jogging, sprinting, treadmill motion, raised knees, long steps, pumping arms, or directional travel.

State requirements:
- Show the pet actively working or processing, as if running a task: focused posture, busy hands or paws, purposeful bobbing, thinking motion, tool or prop motion only if already part of the pet identity, or other non-locomotion activity.
- Do not show literal foot-running, jogging, sprinting, treadmill motion, raised knees, long steps, pumping arms, directional travel, speed lines, dust clouds, floor shadows, motion trails, or detached motion effects.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### review  Create one horizontal animation strip for Codex pet `xiaojing`, state `review`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 6 full-body frames in one left-to-right row on flat pure green #00FF00. Treat the row as 6 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Preserve the user reference character: chibi blue whale maid girl, deep navy to azure long wavy hair, blue eyes, white frilled maid headband, blue bow on screen-right side, fin-shaped ears, navy long-sleeved dress with gold trim and bows, white ruffled apron with small whale motif, dark shoes, large blue whale tail visible on screen-right, one curved ahoge. Compact whole body as reference 03; polished clean anime chibi illustration as references 03 and 04. No words, slogans, speech bubbles, backgrounds, furniture, sparkles, symbols, watermark or new props. Calm mischievous friendly persona.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row. User style notes: Clean non-pixel anime chibi sprite, strong dark outlines, soft restrained cel shading, simplified lace readable at 192x208..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Ready-review loop: focused inspection of completed output with lean, blink, narrowed eyes, head tilt, or paw pose.

State requirements:
- Show review through lean, blink, narrowed eyes, head tilt, or paw/hand position.
- Do not add magnifying glasses, papers, code, UI, punctuation, symbols, or other new props unless they already exist in the base pet identity.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### look-cardinals  Create one horizontal four-cardinal anchor strip for Codex pet `xiaojing`.

Use the attached canonical base, completed standard contact sheet, and layout guide for exact identity, style, scale, baseline, face construction, materials, palette, markings, props, and spacing. Read `qa/look-mechanics.md` and use the pet's natural gaze mechanism.

Output exactly four centered complete full-body poses in this exact left-to-right order: `000 up`, `090 screen-right`, `180 down`, `270 screen-left`. Screen-left and screen-right always mean the viewer's image edges, never the character's own left or right.

For `000`, keep the face broadly frontal and point the eyes and natural head mechanism toward the TOP edge. For `090`, put the nose tip, pupils, face surface, or natural aiming feature on the screen-right side of the head center. For `180`, keep the face broadly frontal and point toward the BOTTOM edge. For `270`, apply the inverse screen-left landmark rule. Every cardinal must be unmistakable without labels.

Place one pose in each invisible equal-width slot on a flat pure green #00FF00 background with generous padding. Keep scale, feet/base, lower body, and registration consistent across all four slots.

Do not rotate, skew, or tilt the whole sprite to fake gaze. Do not add replacement eyes, labels, degree text, arrows, boxes, guide marks, shadows, scenery, detached effects, or chroma-key colors inside the pet.

### look-row-9  Create one horizontal look-direction strip for Codex pet `xiaojing`, atlas row 9.

Use the attached canonical base, completed standard contact sheet, layout guide, and approved four-cardinal strip for identity, scale, registration, spacing, direction semantics, and cross-row continuity. Read `qa/look-mechanics.md` and follow its pet-specific movement and eye/prop mechanics. The approved cardinal strip is authoritative for the up, screen-right, down, and screen-left pose families. Interpolate the intermediate directions as even 22.5-degree steps between those anchors.

COHERENT SYNTHESIS LOCK: produce one unified eight-pose row. Do not paste, tile, or independently restyle individual cells. Every final cell must be drawn together with the same face construction, body proportions, line/render quality, lighting, materials, scale, baseline, and registration.

Output exactly 8 complete full-body frames in this exact left-to-right order: 000, 022.5, 045, 067.5, 090, 112.5, 135, 157.5. Degrees are clockwise: 000 is up, 090 right, 180 down, and 270 left. Neutral/front is not part of this row.

DIRECTION TARGETS — use these to shape the coherent row, not as pixel-level landmark gates:

1. `000`: vertical UP; no horizontal requirement.
2. `022.5`: horizontal SCREEN-RIGHT and vertical UP.
3. `045`: horizontal SCREEN-RIGHT and vertical UP.
4. `067.5`: horizontal SCREEN-RIGHT and vertical UP.
5. `090`: horizontal SCREEN-RIGHT; no vertical requirement.
6. `112.5`: horizontal SCREEN-RIGHT and vertical DOWN.
7. `135`: horizontal SCREEN-RIGHT and vertical DOWN.
8. `157.5`: horizontal SCREEN-RIGHT and vertical DOWN.

Cardinals must be unmistakable. Intermediate poses should broadly occupy the intended quadrant and advance naturally through the ordered loop. Minor pupil, nose, eyelid, or aiming-feature deviations are acceptable when the overall direction, continuity, identity, and motion remain coherent. Do not deform the character merely to make every intermediate axis independently obvious.

SCREEN-COORDINATE LOCK: screen-right means the viewer's right image edge, never the character's own right. The row should travel naturally through the right half of the loop. Near-vertical 022.5 and 157.5 may have subtle horizontal cues; prioritize a coherent arc over exact pupil or nose placement.

HARD LAYOUT AND CONTINUITY CONTRACT — DETERMINISTIC REGISTRATION: draw exactly eight separated pose groups in left-to-right direction order. Keep enough chroma-only space between neighboring poses that each complete pose can be detected without cutting through foreground. Approximate the guide's equal spacing, but do not distort a pose merely to hit an exact source-canvas coordinate; deterministic assembly will crop the eight ordered groups, then apply one shared scale and baseline.

Use the same body height, head size, baseline, and planted-body position across the generated family. Never overlap neighboring poses, merge two poses into one connected group, crop foreground at the outer canvas edge, or resize one pose independently.

Keep the feet, base, or lower torso planted at the same coordinates across all eight frames. Express direction through the eyes, face, head, upper body, and physically appropriate prop movement, not by moving, rotating, or rescaling the entire sprite.

Place one centered pose in each invisible equal-width slot on flat pure green #00FF00. Change only the natural parts needed to express gaze: eyes, eyelids, head, face, neck, upper body, appendages, and constrained prop follow-through. Keep identity, silhouette, materials, palette, markings, and props consistent.

ROW-BOUNDARY LOCK: 157.5 must be one even 22.5-degree step before 180. Match the approved 180 pose's body size, baseline, planted anchor, expression, and construction. Preserve the overall right-hand arc, but do not distort pupils, nose, or body geometry merely to exaggerate the subtle horizontal component.

PRE-RETURN CHECK: reject this result if it does not contain eight separated pose groups in the required order; neighboring poses overlap; foreground is cropped at the outer canvas edge; any frame changes sprite scale, body or head size, baseline, or planted-body position; the row visibly reverses into the wrong half of the loop; or 157.5 does not flow evenly into 180. Minor intermediate pupil or nose deviations are not rejection reasons. Exact cell cropping, resizing, and recentering happen deterministically after generation.

Do not rotate, skew, or tilt the whole sprite to fake gaze. Do not add replacement/googly eyes, labels, degree text, arrows, clocks, grids, shadows, glows, scenery, detached effects, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

### look-row-10  Create one horizontal look-direction strip for Codex pet `xiaojing`, atlas row 10.

Use the attached canonical base, completed standard contact sheet, layout guide, and approved four-cardinal strip for identity, scale, registration, spacing, direction semantics, and cross-row continuity. Read `qa/look-mechanics.md` and follow its pet-specific movement and eye/prop mechanics. The approved cardinal strip and completed coherent row 9 are authoritative. Use the cardinals for direction meaning and row 9 for cross-row identity, scale, registration, and continuity.

COHERENT SYNTHESIS LOCK: produce one unified eight-pose row. Do not paste, tile, or independently restyle individual cells. Every final cell must be drawn together with the same face construction, body proportions, line/render quality, lighting, materials, scale, baseline, and registration.

Output exactly 8 complete full-body frames in this exact left-to-right order: 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5. Degrees are clockwise: 000 is up, 090 right, 180 down, and 270 left. Neutral/front is not part of this row.

DIRECTION TARGETS — use these to shape the coherent row, not as pixel-level landmark gates:

1. `180`: vertical DOWN; no horizontal requirement.
2. `202.5`: horizontal SCREEN-LEFT and vertical DOWN.
3. `225`: horizontal SCREEN-LEFT and vertical DOWN.
4. `247.5`: horizontal SCREEN-LEFT and vertical DOWN.
5. `270`: horizontal SCREEN-LEFT; no vertical requirement.
6. `292.5`: horizontal SCREEN-LEFT and vertical UP.
7. `315`: horizontal SCREEN-LEFT and vertical UP.
8. `337.5`: horizontal SCREEN-LEFT and vertical UP.

Cardinals must be unmistakable. Intermediate poses should broadly occupy the intended quadrant and advance naturally through the ordered loop. Minor pupil, nose, eyelid, or aiming-feature deviations are acceptable when the overall direction, continuity, identity, and motion remain coherent. Do not deform the character merely to make every intermediate axis independently obvious.

SCREEN-COORDINATE LOCK: screen-left means the viewer's left image edge, never the character's own left. The row should travel naturally through the left half of the loop. Near-vertical 202.5 and 337.5 may have subtle horizontal cues; prioritize a coherent arc over exact pupil or nose placement.

HARD LAYOUT AND CONTINUITY CONTRACT — DETERMINISTIC REGISTRATION: draw exactly eight separated pose groups in left-to-right direction order. Keep enough chroma-only space between neighboring poses that each complete pose can be detected without cutting through foreground. Approximate the guide's equal spacing, but do not distort a pose merely to hit an exact source-canvas coordinate; deterministic assembly will crop the eight ordered groups, then apply one shared scale and baseline.

Use the same body height, head size, baseline, and planted-body position across the generated family. Never overlap neighboring poses, merge two poses into one connected group, crop foreground at the outer canvas edge, or resize one pose independently.

Keep the feet, base, or lower torso planted at the same coordinates across all eight frames. Express direction through the eyes, face, head, upper body, and physically appropriate prop movement, not by moving, rotating, or rescaling the entire sprite.

Place one centered pose in each invisible equal-width slot on flat pure green #00FF00. Change only the natural parts needed to express gaze: eyes, eyelids, head, face, neck, upper body, appendages, and constrained prop follow-through. Keep identity, silhouette, materials, palette, markings, and props consistent.

ROW-BOUNDARY LOCK: 180 must continue directly from row 9's 157.5, matching its body size, baseline, planted anchor, expression, and construction. 337.5 must be one even 22.5-degree step before 000: nearly up-facing while remaining on the overall left-hand arc. Do not distort pupils, nose, or body geometry merely to exaggerate the subtle horizontal component.

PRE-RETURN CHECK: reject this result if it does not contain eight separated pose groups in the required order; neighboring poses overlap; foreground is cropped at the outer canvas edge; any frame changes sprite scale, body or head size, baseline, or planted-body position; the row visibly reverses into the wrong half of the loop; or 180 does not continue from 157.5 or 337.5 does not flow evenly into 000. Minor intermediate pupil or nose deviations are not rejection reasons. Exact cell cropping, resizing, and recentering happen deterministically after generation.

Do not rotate, skew, or tilt the whole sprite to fake gaze. Do not add replacement/googly eyes, labels, degree text, arrows, clocks, grids, shadows, glows, scenery, detached effects, or chroma-key colors inside the pet.

Wide-silhouette spacing correction: treat tail, hair and raised hands as part of each complete figure. Keep every silhouette inside only 70% of its slot width, with at least 15% empty key-color margin on both sides of each slot and outer canvas edges. Scale all figures uniformly smaller to fit their entire tail, never crop or wrap a tail and never overlap neighbors. Keep upper/lower empty background if needed; do not enlarge figures to fill the image height. Bow remains on the character's anatomical left (screen-right in frontal pose), attached to the same hair/ear side during turns.

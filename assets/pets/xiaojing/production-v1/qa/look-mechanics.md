# Xiaojing look mechanics

The canonical pet is a chibi humanoid with a separate head, large drawn anime eyes, soft long hair, fin ears, a frilled headband, asymmetric blue bow on her anatomical left, and a whale tail. Preserve these exact features and the calm friendly persona. No whole-sprite rotation, affine tilting, skull stretching, replacement eyes or new props.

Anchor both shoes, skirt hem, apron/waist and lower-body center. The lower body stays frontal and stationary across all sixteen directions. The whale tail stays attached at the same base and retains almost exactly the idle contour; it must not teleport between sides. Hands stay in the neutral canonical position. Maintain shared character height and shoe baseline close to idle.

Eyes lead attention with the whole drawn eye aperture, iris, eyelids and eyebrows participating together. The head/neck follows with moderate yaw or pitch. Hair at cheeks and fin ears follows gently; the headband and bow follow head orientation. Do not move only pupils on otherwise frozen idle heads. Do not distort the head or body. The bow remains on the anatomical left: in a turn toward screen-right it is partly occluded on the far side; toward screen-left it is clearly visible on the near side. Avoid adding a second bow.

Cardinal families (screen coordinates):
- 000 UP: frontal head gently tilted back, chin raised and eyes clearly looking toward the upper edge; pupils high under raised upper lids, reduced upper-head view. Torso/feet anchored.
- 090 RIGHT: head yaw toward screen-right, nose tip and pupils clearly to the right of head center. Opposite far eye narrows naturally; bow may be hidden behind far hair. Keep body front-facing.
- 180 DOWN: chin tucked, face tilted down, upper hair/headband surface slightly more visible, eyes directed below face center with lowered gaze. Not a sad closed-eye pose; gaze must read down.
- 270 LEFT: head yaw toward screen-left, nose and pupils left of head center, converse facial occlusion to090, near anatomical-left bow retained. Keep body front-facing.

Each intermediate pose combines neighboring cardinal families using even22.5-degree steps. Use a restrained head yaw of roughly25-35degrees at horizontal cardinals and pitch of roughly15-20degrees at vertical cardinals. Intermediate gaze must show both axes without turning into idle. Shoes and apron anchor may vary at most1-2final pixels; eyes/head/hair transition gradually with no snaps. Row9 travels up through right toward down; row10 starts down, travels left, and ends one step before up. Maintain canonical eye shape and face proportions at normal192x208 display size.

The cardinals establish meaning; generation labels are not a substitute for visible direction. Sixteen directions are source assets only and do not imply DSH pointer-following is implemented.

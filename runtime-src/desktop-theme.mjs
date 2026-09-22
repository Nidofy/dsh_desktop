import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {writeAtomic} from './project-actions.mjs';
export function appearance(value) {
  return {preference: ['light','dark','system'].includes(value?.preference) ? value.preference : 'system',
    fontSize: Number.isInteger(value?.fontSize) && value.fontSize >= 12 && value.fontSize <= 17 ? value.fontSize : 14};
}
export function installDesktopTheme(ctx, home) {
  const read = () => appearance(ctx.get('settings')?.get('ui-theme'));
  let saved, writing = Promise.resolve();
  const publish = () => {
    if (!ctx.get('settings')?.get('ui-theme')) return;
    const next = JSON.stringify(read());
    if (saved === next) return;
    saved = next;
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(home, {recursive:true});
      await writeAtomic(join(home,'desktop-appearance.json'), next);
    }).catch(() => { saved = undefined; });
  };
  ctx.on('settings/updated', ns => { if (ns === 'ui-theme') publish(); });
  // Also covers the initial namespace registration, which can follow this plugin.
  const timer = setInterval(publish, 1000); timer.unref();
  ctx.effect(() => async () => { clearInterval(timer); await writing; });
  publish();
  return read;
}

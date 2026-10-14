import { panelAppearanceCss } from './panel-appearance.ts'
/** Wallpaper asset, inset and opacity match the Tauri edition. */
export const wallpaperCss = `
[data-conversation-surface="main"]{isolation:isolate}
[data-conversation-surface="main"]::before{content:"";position:absolute;inset:24px;z-index:-1;pointer-events:none;background:url("/api/nidofy-extras/assets/theme/wallpaper.png") center/contain no-repeat;opacity:.14}
@media(forced-colors:active){[data-conversation-surface="main"]::before{display:none}}
`
/** The center container already excludes both official sidebars. */
export const appearanceCss = `
.nidofy-width-probe{width:0;height:0;flex:0 0 0px;pointer-events:none}
@container shell-center (min-width:1040px){.nidofy-width-probe{width:1px;flex-basis:1px}}
.nidofy-dock{display:flex;align-items:flex-start;box-sizing:border-box;flex:0 0 300px;width:300px;min-height:0;padding:14px;overflow:auto;border-left:0.5px solid var(--dsw-alias-border-l2)}
.nidofy-body{color:var(--dsw-alias-label-primary);font:13px/1.5 var(--dsw-font-family);display:flex;flex-direction:column;gap:12px;min-width:0;width:100%}
.nidofy-body *{box-sizing:border-box}
.nidofy-body button{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent;border-radius:8px;min-width:0}
.nidofy-body button:hover{background:var(--dsw-alias-bg-layer-1)}
.nidofy-body button:focus-visible,.nidofy-drawer-trigger:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
.nidofy-body svg{flex-shrink:0;opacity:.75}
.nidofy-drawer{max-height:90vh;width:min(440px,calc(100vw - 24px));overflow:auto}
.nidofy-drawer-trigger{flex:none;align-self:flex-start;display:flex;align-items:center;flex-direction:column;padding:6px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:12px var(--dsw-font-family);cursor:pointer}
.nidofy-drawer-trigger img{width:32px;height:32px;object-fit:contain}
.nidofy-hints,.nidofy-attention{padding:10px 14px;border-top:0.5px solid var(--dsw-alias-border-l2);overflow-wrap:anywhere;line-height:1.5}
.nidofy-attention button{padding:8px}
.nidofy-environment{flex:none;padding:10px;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);border-radius:16px;box-shadow:var(--dsw-elevation-panel)}
.nidofy-collapse{display:flex;gap:10px;align-items:center;width:100%;text-align:start;padding:8px}
.nidofy-collapse>span:first-of-type{flex:1;font-weight:500}
.nidofy-workspace{margin:12px 8px 6px;font-weight:500;overflow-wrap:anywhere}
.nidofy-row{display:flex;align-items:center;gap:10px;text-align:start;width:100%;padding:10px 8px}
.nidofy-row>span:first-of-type{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.nidofy-row small{font-size:12px;white-space:nowrap}
.nidofy-added{color:var(--dsw-alias-state-success-primary)}.nidofy-deleted{color:var(--dsw-alias-state-error-primary)}
.nidofy-path{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:6px 8px 12px;max-height:66px;overflow:auto}
.nidofy-environment-footer{display:flex;justify-content:space-between;border-top:0.5px solid var(--dsw-alias-border-l2);padding-top:8px;margin-top:8px}
.nidofy-environment-footer button{display:flex;align-items:center;gap:10px;padding:8px}
.nidofy-error{font-size:12px;margin:8px;overflow-wrap:anywhere}
.nidofy-companion{display:flex;flex-direction:column;flex-shrink:0;border-radius:16px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.nidofy-character{position:relative;height:220px;flex-shrink:0;min-height:150px;margin:12px 8px 4px;overflow:hidden;border-top:0.5px solid var(--dsw-alias-border-l2)}
.nidofy-character img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom;user-select:none}
.nidofy-character canvas{width:100%;height:100%;display:block}
.nidofy-companion-caption{padding:12px 14px}
.nidofy-companion-caption p{font-size:12px;color:var(--dsw-alias-label-primary);margin:6px 0 0;line-height:1.5}
.nidofy-companion nav{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 8px 8px}
.nidofy-companion nav button{display:flex;align-items:center;gap:8px;text-align:start;padding:10px 8px;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);font-size:12px}

.nidofy-body button:disabled{cursor:default;opacity:.45}
.nidofy-change-row{display:flex;align-items:center;min-width:0}.nidofy-change-row>.nidofy-row{flex:1;min-width:0}.nidofy-more{flex:none;padding:10px 6px}
.nidofy-action-menu{display:grid;grid-template-columns:1fr 1fr;padding:6px;gap:4px;background:var(--dsw-alias-bg-layer-1);border-radius:12px}.nidofy-action-menu button{text-align:start;padding:8px}
.nidofy-detail{margin-top:10px;border-top:0.5px solid var(--dsw-alias-border-l2);padding:10px 4px;overflow-wrap:anywhere;min-width:0}
.nidofy-detail>header{display:flex;align-items:center;justify-content:space-between;gap:8px}.nidofy-detail>header button{padding:6px 10px}
.nidofy-detail p{font-size:12px;line-height:1.5}.nidofy-detail dl{font-size:12px;line-height:1.5}.nidofy-detail dt{color:var(--dsw-alias-label-secondary);margin-top:10px}.nidofy-detail dd{margin:2px 0}
.nidofy-detail form,.nidofy-detail label{display:flex;flex-direction:column;gap:8px}.nidofy-detail label{margin:10px 0}
.nidofy-detail :is(input,select,textarea){width:100%;min-width:0;font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px}.nidofy-detail textarea{resize:vertical;min-height:72px}
.nidofy-detail small{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}.nidofy-detail form button,.nidofy-inline-actions button{padding:8px;border:0.5px solid var(--dsw-alias-border-l2)}
.nidofy-inline-actions{display:flex;flex-wrap:wrap;gap:6px}.nidofy-full-workbench{margin-top:12px;padding:8px;font-size:12px!important;text-align:start}
.nidofy-companion-controls{display:flex;flex-direction:column;gap:8px;min-width:0;padding:0 8px}
.nidofy-follow-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.nidofy-follow-actions button{text-align:start;white-space:normal;overflow-wrap:anywhere}
.nidofy-control-row,.nidofy-control-fold>summary,.nidofy-companion-controls>.nidofy-notebook-surface>.nidofy-row{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:10px 8px;text-align:start;line-height:1.5;white-space:normal;overflow-wrap:anywhere}
.nidofy-control-fold{min-width:0;border-top:0.5px solid var(--dsw-alias-border-l2)}.nidofy-control-fold>summary{cursor:pointer;list-style:none;border-radius:8px}
.nidofy-control-fold>summary::-webkit-details-marker{display:none}.nidofy-control-fold>summary:hover{background:var(--dsw-alias-bg-layer-1)}
.nidofy-control-fold>summary:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
.nidofy-control-row::before,.nidofy-control-fold>summary::before,.nidofy-companion-controls>.nidofy-notebook-surface>.nidofy-row::before{content:"";flex:none;width:0;height:0;border-block:4px solid transparent;border-inline-start:5px solid currentColor}
.nidofy-control-row[aria-expanded="true"]::before,.nidofy-control-fold[open]>summary::before,.nidofy-companion-controls>.nidofy-notebook-surface>.nidofy-row[aria-expanded="true"]::before{transform:rotate(90deg)}
.nidofy-pet-settings>button{padding:8px;border:0.5px solid var(--dsw-alias-border-l2);margin-top:8px}.nidofy-pet-settings .nidofy-inline-actions{margin-top:8px}
.nidofy-change-list{max-height:220px;overflow:auto;margin:8px 0}.nidofy-change-list button{display:flex;gap:8px;width:100%;padding:7px 4px;text-align:start}.nidofy-change-list code{flex:none}.nidofy-change-list span{overflow-wrap:anywhere;min-width:0}
.nidofy-explorer [aria-pressed="true"],.nidofy-row[aria-expanded="true"]{background:var(--dsw-alias-bg-layer-1)}
.nidofy-detail pre{max-width:100%;max-height:260px;overflow:auto;font-size:11px;padding:8px;background:var(--dsw-alias-bg-layer-1);border-radius:8px;white-space:pre}
.nidofy-detail .nidofy-note-pin{flex-direction:row;align-items:center}.nidofy-detail .nidofy-note-pin input{width:auto;flex:none}.nidofy-notebook{max-height:65vh;overflow:auto;padding-right:8px}
.nidofy-analysis,.nidofy-settings{padding:12px;min-width:0}.nidofy-analysis button,.nidofy-settings button{padding:8px;border:0.5px solid var(--dsw-alias-border-l2);margin:8px 4px 0 0}
.nidofy-analysis pre,.nidofy-settings pre{overflow-wrap:anywhere}.nidofy-character>div>button{padding:5px 8px;background:var(--dsw-alias-bg-layer-1);font-size:11px}
.nidofy-operation-preview{padding:8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px}.nidofy-operation-preview button{margin:8px 4px 0 0}
${panelAppearanceCss}
`

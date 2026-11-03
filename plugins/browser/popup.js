import {previewPermission} from './previews.js';
const status = document.querySelector('#status');
async function refresh() {
  const enabled = await chrome.permissions.contains(previewPermission);
  document.querySelector('#enable').hidden = enabled;
  document.querySelector('#disable').hidden = !enabled;
  const data = await chrome.runtime.sendMessage({action: 'preview-status'});
  document.querySelector("#connection").textContent = data.connected ? "已连接 BeaconHop / Connected" : "等待连接，请打开 BeaconHop → 应用插件 / Open BeaconHop → Application plugins";
  status.textContent = enabled ? `已开启 · ${data.entries} 张缓存 / cached previews` : '未开启 / Disabled';
}
document.querySelector('#enable').onclick = async () => {
  try {
    await chrome.permissions.request(previewPermission);
    await chrome.runtime.sendMessage({action: 'preview-refresh'});
    await refresh();
  } catch (error) { status.textContent = String(error.message ?? error); }
};
document.querySelector('#disable').onclick = async () => {
  await chrome.permissions.remove(previewPermission);
  await chrome.runtime.sendMessage({action: 'preview-clear'});
  await refresh();
};
document.querySelector('#reconnect').onclick = async () => {
  await chrome.runtime.sendMessage({action: 'reconnect'});
  status.textContent = '已请求连接 / Connection requested';
};
setInterval(()=>void refresh().catch(()=>{}),2000);
void refresh().catch(error => { status.textContent = String(error.message ?? error); });

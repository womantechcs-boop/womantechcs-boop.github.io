const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('radar',{
  check:(v)=>ipcRenderer.invoke('radar:check',String(v||'')),
  apply:()=>ipcRenderer.invoke('radar:apply'),
  resolve:(q)=>ipcRenderer.invoke('radar:resolve',String(q||'')),
  setBrowser:(v)=>ipcRenderer.send('radar:browser',String(v||'')),
  ready:()=>ipcRenderer.send('radar:ready')
});

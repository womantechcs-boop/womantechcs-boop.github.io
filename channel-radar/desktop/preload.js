const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('radar',{
  check:(v)=>ipcRenderer.invoke('radar:check',String(v||'')),
  apply:()=>ipcRenderer.invoke('radar:apply'),
  ready:()=>ipcRenderer.send('radar:ready')
});

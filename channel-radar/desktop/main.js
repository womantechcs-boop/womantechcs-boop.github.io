const {app,BrowserWindow,shell,Menu,ipcMain,net}=require('electron');
const path=require('path'),fs=require('fs'),crypto=require('crypto');

// 새 버전을 받아 오는 곳 (깃허브 공개 저장소)
const BASE=process.env.RADAR_UPDATE_BASE||'https://raw.githubusercontent.com/womantechcs-boop/womantechcs-boop.github.io/main/channel-radar/';
const BUNDLED=path.join(__dirname,'index.html');
const updDir=()=>path.join(app.getPath('userData'),'update');
const updFile=()=>path.join(updDir(),'index.html');

function verOf(file){try{const m=/var APP_VERSION="([\d.]+)"/.exec(fs.readFileSync(file,'utf8'));return m?m[1]:null}catch(e){return null}}
function cmp(a,b){const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<3;i++){const d=(x[i]||0)-(y[i]||0);if(d)return d>0?1:-1}return 0}
// 내려받은 업데이트가 프로그램에 들어 있는 것보다 새 버전일 때만 그 파일을 연다
function pick(){const uv=verOf(updFile()),bv=verOf(BUNDLED);return (uv&&bv&&cmp(uv,bv)>0)?{file:updFile(),updated:true}:{file:BUNDLED,updated:false}}
async function get(url){
  const r=await net.fetch(url+(url.includes('?')?'&':'?')+'t='+Date.now(),{cache:'no-store'});
  if(!r.ok)throw new Error('서버 응답 '+r.status);
  return r;
}

if(!app.requestSingleInstanceLock()){app.quit()}
let win=null,readyTimer=null;
function openOutside(url){if(/^https:\/\//i.test(url))shell.openExternal(url)}
function load(){
  const p=pick();
  clearTimeout(readyTimer);
  if(p.updated){
    // 업데이트한 화면이 10초 안에 정상적으로 뜨지 않으면 원래 버전으로 되돌린다
    readyTimer=setTimeout(()=>{try{fs.rmSync(updDir(),{recursive:true,force:true})}catch(e){} if(win)win.loadFile(BUNDLED)},10000);
  }
  win.loadFile(p.file);
}
function create(){
  win=new BrowserWindow({width:1320,height:880,minWidth:420,minHeight:500,title:'채널 레이더',autoHideMenuBar:true,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'preload.js')}});
  Menu.setApplicationMenu(null);
  load();
  // 유튜브 링크는 프로그램 안이 아니라 컴퓨터의 기본 브라우저에서 연다
  win.webContents.setWindowOpenHandler(({url})=>{openOutside(url);return {action:'deny'}});
  win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('file:')){e.preventDefault();openOutside(url)}});
  // 입력 칸에서 마우스 오른쪽 버튼으로 붙여넣기
  win.webContents.on('context-menu',(e,p)=>{
    const items=[];
    if(p.isEditable){items.push({label:'잘라내기',role:'cut',enabled:p.editFlags.canCut},{label:'복사',role:'copy',enabled:p.editFlags.canCopy},{label:'붙여넣기',role:'paste',enabled:p.editFlags.canPaste},{label:'모두 선택',role:'selectAll'})}
    else if(p.selectionText){items.push({label:'복사',role:'copy'})}
    if(items.length)Menu.buildFromTemplate(items).popup({window:win});
  });
  win.on('closed',()=>{win=null;clearTimeout(readyTimer)});
}

ipcMain.on('radar:ready',()=>{clearTimeout(readyTimer)});
ipcMain.handle('radar:check',async(e,cur)=>{
  try{const j=await (await get(BASE+'latest.json')).json();
    return {ok:true,current:cur,latest:String(j.version),newer:cmp(j.version,cur)>0,notes:String(j.notes||'')}}
  catch(err){return {ok:false,error:String(err&&err.message||err)}}
});
ipcMain.handle('radar:apply',async()=>{
  try{
    const j=await (await get(BASE+'latest.json')).json();
    const name=String(j.url||'index.html');
    if(!/^[\w.\-]+$/.test(name))throw new Error('업데이트 정보가 올바르지 않습니다.');
    const buf=Buffer.from(await (await get(BASE+name)).arrayBuffer());
    const sha=crypto.createHash('sha256').update(buf).digest('hex');
    if(j.sha256&&sha!==j.sha256)throw new Error('내려받은 파일이 아직 준비 중이거나 손상되었습니다. 5분쯤 뒤에 다시 눌러 주세요.');
    if(!buf.toString('utf8').includes('var APP_VERSION="'+j.version+'"'))throw new Error('버전 정보가 맞지 않습니다.');
    fs.mkdirSync(updDir(),{recursive:true});
    fs.writeFileSync(updFile()+'.tmp',buf);
    fs.renameSync(updFile()+'.tmp',updFile());
    setTimeout(()=>{if(win)load()},300);
    return {ok:true,version:String(j.version)};
  }catch(err){return {ok:false,error:String(err&&err.message||err)}}
});

app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus()}});
app.whenReady().then(create);
app.on('window-all-closed',()=>app.quit());

const {app,BrowserWindow,shell,Menu,ipcMain,net}=require('electron');
const path=require('path'),fs=require('fs'),crypto=require('crypto');
const {spawn}=require('child_process');

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

// 일부 윈도우 컴퓨터에서 소리가 윈도우까지 전달되지 않는 문제 대응:
// 소리 처리 부분의 격리(샌드박스)를 끄고 프로그램 본체에서 직접 소리를 낸다
// 소리 방식 0: 기본 / 1: 소리 처리 격리 끄기 / 2: 프로그램 본체에서 직접 소리 내기
// '소리 테스트'에서 소리 장치가 켜지지 않으면 다음 방식으로 바꿔 다시 시작한다
const SHELL=3;
const SET_FILE=path.join(app.getPath('userData'),'shell-settings.json');
let audioMode=0;
try{audioMode=Math.max(0,Math.min(2,JSON.parse(fs.readFileSync(SET_FILE,'utf8')).audioMode|0))}catch(e){}
function saveSettings(){try{fs.mkdirSync(path.dirname(SET_FILE),{recursive:true});fs.writeFileSync(SET_FILE,JSON.stringify({audioMode}))}catch(e){}}
if(audioMode===1)app.commandLine.appendSwitch('disable-features','AudioServiceSandbox');
if(audioMode===2)app.commandLine.appendSwitch('disable-features','AudioServiceSandbox,AudioServiceOutOfProcess');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');

if(!app.requestSingleInstanceLock()){app.quit()}
let win=null,readyTimer=null;
let browserPref='chrome';
// 크롬이 깔려 있으면 크롬으로, 없으면 윈도우 기본 브라우저로 연다
function chromePath(){
  if(process.platform!=='win32')return null;
  const dirs=[process.env['PROGRAMFILES'],process.env['PROGRAMFILES(X86)'],process.env['LOCALAPPDATA']].filter(Boolean);
  for(const d of dirs){const f=path.join(d,'Google','Chrome','Application','chrome.exe');try{if(fs.existsSync(f))return f}catch(e){}}
  return null;
}
function openOutside(url){
  if(!/^https:\/\//i.test(url))return;
  const cp=browserPref==='chrome'?chromePath():null;
  if(cp){try{spawn(cp,[url],{detached:true,stdio:'ignore'}).unref();return}catch(e){}}
  shell.openExternal(url);
}
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

ipcMain.on('radar:browser',(e,v)=>{browserPref=v==='default'?'default':'chrome'});
ipcMain.handle('radar:info',()=>({shell:SHELL,electron:process.versions.electron,audioMode}));
ipcMain.handle('radar:audio-next',()=>{
  if(audioMode>=2){audioMode=0;saveSettings();return {ok:false,mode:0}}
  audioMode++;saveSettings();
  setTimeout(()=>{app.relaunch();app.exit(0)},1500);
  return {ok:true,mode:audioMode};
});
ipcMain.on('radar:ready',()=>{clearTimeout(readyTimer)});
ipcMain.handle('radar:check',async(e,cur)=>{
  try{const j=await (await get(BASE+'latest.json')).json();
    return {ok:true,current:cur,latest:String(j.version),newer:cmp(j.version,cur)>0,notes:String(j.notes||'')}}
  catch(err){return {ok:false,error:String(err&&err.message||err)}}
});
// @한글핸들처럼 API가 못 찾는 주소는 유튜브 채널 페이지를 한 번 열어 채널 번호를 확인한다
ipcMain.handle('radar:resolve',async(e,q)=>{
  try{
    const h=String(q||'').trim().replace(/^@/,'');
    if(!h||h.length>60||/[\/\s?#&]/.test(h))return {ok:false};
    const r=await net.fetch('https://www.youtube.com/@'+encodeURIComponent(h),{headers:{'accept-language':'ko,en;q=0.8'}});
    if(!r.ok)return {ok:false};
    const t=await r.text();
    const m=/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(t)||/"externalId":"(UC[\w-]{22})"/.exec(t)||/<meta itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/.exec(t);
    return m?{ok:true,id:m[1]}:{ok:false};
  }catch(err){return {ok:false}}
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

import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
createInterface({input:process.stdin}).on('line',line=>{
 if(line==='start'){
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  console.log(child.pid);
 }
});

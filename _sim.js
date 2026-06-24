// 对话模拟器（仅本地评估用，不进仓库）
// 教练端 = 真实 systemPrompt.js；用户端 = 一个有情绪、会犹豫的新晋管理者人设
const fs = require('fs');
const path = require('path');
const { buildSystemPrompt } = require('./systemPrompt.js');

(function loadEnv(){
  const c = fs.readFileSync(path.join(__dirname,'.env'),'utf8');
  c.split(/\r?\n/).forEach(l=>{l=l.trim();if(!l||l.startsWith('#'))return;const i=l.indexOf('=');if(i<0)return;const k=l.slice(0,i).trim();const v=l.slice(i+1).trim();if(!process.env[k])process.env[k]=v;});
})();

const KEY = process.env.DEEPSEEK_KEY;
const URL = 'https://api.deepseek.com/v1/chat/completions';
const KICKOFF = '（这是系统自动触发信号，不是用户发言。请直接执行"七、启动指令"，输出开场白，不要复述这条信号。）';

async function call(messages, max=900, temp=0.7){
  const r = await fetch(URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${KEY}`},
    body:JSON.stringify({model:'deepseek-chat',max_tokens:max,temperature:temp,messages})});
  const d = await r.json();
  if(!d.choices) throw new Error(JSON.stringify(d).slice(0,200));
  return d.choices[0].message.content.trim();
}

function isArchive(t){ return /带着它走/.test(t) || (/📌/.test(t) && /我今天带走的/.test(t)); }

async function simulate(name, personaDesc){
  const coachSys = buildSystemPrompt(name);
  const userSys = `你在扮演一个真实的人，名叫${name}，正在跟一个叫"小钱钱"的转念教练对话。
你的处境：${personaDesc}
扮演要求：
- 像真人一样说话，有情绪、会停顿、会犹豫，不要太有条理。
- 每次只回一两句，口语化，可以有"嗯""唉""其实吧"这种语气。
- 真实地回应教练的问题，不要跳步，不要替教练推进流程。
- 当教练给你存档、说"带着它走"之类的收尾时，你简单回应一句即可。
- 绝对不要跳出角色，不要解释你在扮演。`;

  const coachMsgs = [{role:'user',content:KICKOFF}];   // 发给教练的对话（系统提示词另加）
  const userMsgs = [];                                  // 发给"用户人设"的对话
  const transcript = [];

  // 开场白
  let coachReply = await call([{role:'system',content:coachSys},...coachMsgs]);
  coachMsgs.push({role:'assistant',content:coachReply});
  transcript.push(['小钱钱',coachReply]);

  for(let turn=0; turn<14; turn++){
    // 用户人设回应教练最后一句
    userMsgs.push({role:'user',content:coachReply});
    let userReply = await call([{role:'system',content:userSys},...userMsgs], 200, 0.9);
    userMsgs.push({role:'assistant',content:userReply});
    transcript.push([name,userReply]);

    // 教练回应
    coachMsgs.push({role:'user',content:userReply});
    coachReply = await call([{role:'system',content:coachSys},...coachMsgs]);
    coachMsgs.push({role:'assistant',content:coachReply});
    transcript.push(['小钱钱',coachReply]);

    if(isArchive(coachReply)) break;
  }
  return transcript;
}

(async()=>{
  const scenarios = [['阿强','刚升项目经理，带一个跨部门项目，团队里没人愿意配合，事事都要他亲自盯，觉得为什么所有压力都压在我们团队身上，特别委屈和无力。']];
  for(const [name,desc] of scenarios){
    const t = await simulate(name,desc);
    let out = `\n\n========== 对话：${name} ==========\n（${desc}）\n\n`;
    out += t.map(([who,txt])=>`【${who}】${txt}`).join('\n\n');
    fs.appendFileSync(path.join(__dirname,'_sim_out7.txt'), out, 'utf8');
    console.log(`完成：${name}（${t.length} 条）`);
  }
  console.log('全部完成 → _sim_out7.txt');
})().catch(e=>{console.error('ERR',e);process.exit(1);});

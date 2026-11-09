(() => {
  'use strict';
  const {lessons,questions,proofs,subjects}=window.MathCourse;
  const KEY='collegeMath.v1', $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const choiceLike=q=>q.kind==='choice'||q.kind==='judgment';
  const kindNames={choice:'选择题',number:'填空题',judgment:'判断题'};
  const qById=Object.fromEntries(questions.map(q=>[q.id,q]));
  const lessonIds=new Set(lessons.map(l=>l.id)), proofIds=new Set(proofs.map(p=>p.id));
  const blank=()=>({done:[],answers:{},wrong:[],proofDrafts:{},proofChecks:{},proofReviews:{},notes:'',subjectNotes:{},lastLesson:lessons[0].id,exam:null,subjectExams:{},exams:[]});
  const unique=(items,allowed)=>[...new Set(Array.isArray(items)?items.filter(id=>allowed.has(id)):[])];
  function normalize(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('记录格式不正确');
    const s=blank(), ids=new Set(questions.map(q=>q.id));
    s.done=unique(value.done,lessonIds); s.wrong=unique(value.wrong,ids);
    s.lastLesson=lessonIds.has(value.lastLesson)?value.lastLesson:s.lastLesson;
    s.notes=typeof value.notes==='string'?value.notes.slice(0,100000):'';
    for(const [id,a] of Object.entries(value.answers||{})){
      if(ids.has(id)&&a&&['string','number'].includes(typeof a.value)){
        const result=judge(qById[id],a.value);
        if(result.valid)s.answers[id]={value:a.value,correct:result.correct,at:typeof a.at==='string'?a.at:'',attempts:Math.max(1,Math.min(100000,Number(a.attempts)||1))};
      }
    }
    for(const id of proofIds){
      if(typeof value.proofDrafts?.[id]==='string')s.proofDrafts[id]=value.proofDrafts[id].slice(0,20000);
      if(Array.isArray(value.proofChecks?.[id]))s.proofChecks[id]=[0,1,2,3,4].map(i=>value.proofChecks[id][i]===true);
      if(typeof value.proofReviews?.[id]==='string'&&s.proofDrafts[id]?.trim()&&s.proofChecks[id]?.every(Boolean))s.proofReviews[id]=value.proofReviews[id];
    }
    for(const subject of Object.keys(subjects)){
      const note=value.subjectNotes?.[subject];
      if(typeof note==='string')s.subjectNotes[subject]=note.slice(0,100000);
    }
    function normalizeExam(raw,scope){
      const items=raw?.ids;
      if(!Array.isArray(items)||items.length!==10)return null;
      const examIds=unique(items,ids);
      if(examIds.length!==10||(scope!=='all'&&examIds.some(id=>qById[id].subject!==scope)))return null;
      const exam={ids:examIds,answers:{},submitted:raw.submitted===true,scope};
      for(const id of examIds)if(['string','number'].includes(typeof raw.answers?.[id]))exam.answers[id]=raw.answers[id];
      if(exam.submitted&&examIds.some(id=>!judge(qById[id],exam.answers[id]).valid))exam.submitted=false;
      return exam;
    }
    for(const subject of Object.keys(subjects)){
      const exam=normalizeExam(value.subjectExams?.[subject],subject);
      if(exam)s.subjectExams[subject]=exam;
    }
    const oldScope=value.exam?.scope;
    if(Object.hasOwn(subjects,oldScope)){
      const oldExam=normalizeExam(value.exam,oldScope);
      if(oldExam&&!s.subjectExams[oldScope])s.subjectExams[oldScope]=oldExam;
    }else s.exam=normalizeExam(value.exam,'all');
    if(Array.isArray(value.exams))s.exams=value.exams.filter(e=>e&&Number.isInteger(e.score)&&e.score>=0&&e.score<=10&&typeof e.at==='string').slice(-20).map(e=>({score:e.score,at:e.at,scope:['all','calculus','algebra'].includes(e.scope)?e.scope:'all'}));
    return s;
  }
  function numberValue(raw){
    const text=String(raw??'').trim().replaceAll('−','-').replace(/\s/g,'');
    const part='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
    if(new RegExp('^'+part+'$').test(text)){const v=Number(text);return Number.isFinite(v)?v:null}
    if(new RegExp('^'+part+'/'+part+'$').test(text)){const [a,b]=text.split('/').map(Number);return b!==0&&Number.isFinite(a/b)?a/b:null}
    return null;
  }
  function judge(q,raw){
    if(choiceLike(q)){
      if(raw===undefined||raw===null||raw==='')return {valid:false};
      const value=Number(raw),valid=Number.isInteger(value)&&value>=0&&value<q.choices.length;
      return {valid,correct:valid&&value===q.answer,value};
    }
    const value=numberValue(raw);
    return {valid:value!==null,correct:value!==null&&Math.abs(value-q.answer)<=1e-9*Math.max(1,Math.abs(q.answer)),value};
  }
  let state=blank(),storageAvailable=true;
  try{const raw=localStorage.getItem(KEY);if(raw)state=normalize(JSON.parse(raw))}catch{storageAvailable=false}
  let currentPage='home',selectedLesson=state.lastLesson,proofId='p2',practiceMode='objective',onlyWrong=false,redoIds=new Set(),perm=[1,2,3],toastTimer;
  let activeSubject=lessons.find(l=>l.id===selectedLesson).subject, legacyExam=false;
  let renderedView=null;
  const scrollPositions=new Map(), lastLessonBySubject=new Map();
  const inSubject=item=>item.subject===activeSubject;
  const currentExam=()=>legacyExam?state.exam:state.subjectExams[activeSubject];
  const wrongForSubject=()=>state.wrong.filter(id=>inSubject(qById[id]));
  function selectSubject(subject){
    if(activeSubject===subject)return;
    lastLessonBySubject.set(activeSubject,selectedLesson);
    activeSubject=subject;
    selectedLesson=lastLessonBySubject.get(subject)||lessons.find(l=>l.id===state.lastLesson&&inSubject(l))?.id||lessons.find(inSubject).id;
    $('#lesson-search').value='';
    $('#practice-lesson').value='all';
    onlyWrong=false;legacyExam=false;
  }
  function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2600)}
  function save(){
    try{localStorage.setItem(KEY,JSON.stringify(state))}catch{if(storageAvailable)toast('当前浏览器无法保存记录，请及时导出备份');storageAvailable=false}
    renderStats();
  }
  function statMarkup(scoped){
    const scope=item=>!scoped||inSubject(item);
    const courses=lessons.filter(scope), tasks=proofs.filter(scope), objective=questions.filter(scope);
    const correct=objective.filter(q=>state.answers[q.id]?.correct).length;
    const done=courses.filter(l=>state.done.includes(l.id)).length;
    return [[done+' / '+courses.length,'已复习课程','课'],[correct+' / '+objective.length,'最近作答正确的小题','练'],[tasks.filter(p=>state.proofReviews[p.id]).length+' / '+tasks.length,'完成自查的大题','题'],[state.wrong.filter(id=>scope(qById[id])).length,'待复习错题','记']].map(([count,label,icon])=>`<div class="card stat"><div><b>${count}</b><span>${label}</span></div><i class="stat-icon">${icon}</i></div>`).join('');
  }
  function renderStats(){
    $('#home-stats').innerHTML=statMarkup(false);
    $('#progress-stats').innerHTML=statMarkup(true);
    const scoped=!['home','plot'].includes(currentPage), courses=scoped?lessons.filter(inSubject):lessons;
    $('#top-progress').textContent='已复习 '+courses.filter(l=>state.done.includes(l.id)).length+' / '+courses.length+' 节';
  }
  function go(page,restore=true){
    if(!['home','lessons','practice','exam','progress','plot'].includes(page))page='home';
    const scoped=page!=='home'&&page!=='plot';
    const routeKey=scoped?activeSubject+'/'+page:page;
    const viewKey=page==='lessons'?routeKey+'/'+selectedLesson:routeKey;
    if(renderedView!==null)scrollPositions.set(renderedView,window.scrollY);
    renderedView=viewKey;
    currentPage=page;$$('.page').forEach(el=>el.classList.toggle('active',el.id==='page-'+page));
    $$('nav [data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false')});
    $('#subject-bar').hidden=!scoped;$('#active-subject').textContent='当前科目：'+subjects[activeSubject];
    $$('#subject-bar [data-subject]').forEach(b=>{
      b.classList.toggle('active',b.dataset.subject===activeSubject);
      b.setAttribute('aria-pressed',String(b.dataset.subject===activeSubject));
    });
    try{history.replaceState(null,'','#'+routeKey)}catch{}
    if(page==='lessons')renderLesson();if(page==='practice')renderPractice();if(page==='exam')renderExam();if(page==='progress')renderProgress();
    if(page==='plot')window.MathPlot.render();
    renderStats();
    window.scrollTo({top:restore?(scrollPositions.get(viewKey)??0):0,behavior:'instant'});
  }
  function route(){
    const [first,second]=location.hash.slice(1).split('/');
    if(first==='main')return;
    if(Object.hasOwn(subjects,first)){selectSubject(first);go(second||'lessons');}
    else go(first||'home');
  }
  function renderLessonList(){
    const term=$('#lesson-search').value.trim().toLowerCase();
    $('#lesson-list').innerHTML=Object.entries(subjects).map(([subject,name])=>{
      const rows=lessons.filter(inSubject).filter(l=>l.subject===subject&&(l.title+l.focus).toLowerCase().includes(term));
      if(!rows.length)return '';
      return `<div class="phasehead">${name}</div>`+rows.map(l=>`<button class="lessonlink ${selectedLesson===l.id?'sel':''} ${state.done.includes(l.id)?'done':''}" data-lesson="${l.id}"><span class="num">${state.done.includes(l.id)?'✓':String(lessons.indexOf(l)+1).padStart(2,'0')}</span><span>${esc(l.title)}</span></button>`).join('');
    }).join('')||'<p class="empty">没有匹配的已学课程。</p>';
    $('#lesson-list .sel')?.scrollIntoView({block:'nearest'});
  }
  function renderLesson(){
    renderLessonList();
    const l=lessons.find(x=>inSubject(x)&&x.id===selectedLesson)||lessons.find(inSubject);
    const hasPractice=questions.some(q=>q.lesson===l.id)||proofs.some(p=>p.lesson===l.id);
    $('#lesson-detail').innerHTML=`<span class="tag">${subjects[l.subject]}</span><h2>${esc(l.title)}</h2><p class="lede">${esc(l.intro)}</p>${l.body}${['l-inversions','l-parity','l-definition'].includes(l.id)?'<div id="perm-tool"></div>':''}<div class="actions">${hasPractice?`<button class="btn primary" data-lesson-practice="${l.id}">练这一节</button>`:''}<button class="btn" data-mark-lesson="${l.id}">${state.done.includes(l.id)?'已复习 · 取消标记':'标记已复习'}</button></div><p class="muted">复习标记只记录阅读情况；小题作答与证明自查另行记录。</p>`;
    if($('#perm-tool'))renderPermutation();
  }
  const inversionPairs=a=>a.flatMap((x,i)=>a.slice(i+1).filter(y=>x>y).map(y=>[x,y]));
  function renderPermutation(){
    const pairs=inversionPairs(perm),sign=pairs.length%2?-1:1,matrix=[[2,1,0],[1,3,2],[4,0,1]],values=perm.map((col,row)=>matrix[row][col-1]);
    $('#perm-tool').innerHTML=`<div class="perm-tool"><h3>动手看：排列怎样决定一项</h3><p class="muted">交换列号，观察逆序对、奇偶性和系数选择。</p><div class="toolbar"><label class="muted" for="perm-select">列号排列</label><select id="perm-select">${['123','132','213','231','312','321'].map(p=>`<option value="${p}" ${p===perm.join('')?'selected':''}>${p}</option>`).join('')}</select><button class="btn compact" data-swap="0">交换前两个</button><button class="btn compact" data-swap="1">交换后两个</button></div><div class="perm-numbers">${perm.map(v=>'<span>'+v+'</span>').join('')}</div><div class="perm-detail" id="perm-status">逆序对：${pairs.length?pairs.map(p=>'('+p.join(',')+')').join('、'):'无'}<br>逆序数 <b>${pairs.length}</b> · ${sign===1?'偶排列，正号':'奇排列，负号'}</div><div class="matrix" aria-label="系数表，选中的元素用蓝色标出">${matrix.flatMap((row,r)=>row.map((v,c)=>`<span class="${perm[r]===c+1?'picked':''}" data-row="${r+1}" data-col="${c+1}">${v}</span>`)).join('')}</div><div class="formula" id="perm-term">${sign===1?'+':'−'} (${values.join(' × ')}) = ${sign*values.reduce((a,b)=>a*b,1)}</div><p class="muted">这一项每行、每列各取一个元素。定义中的 6 个带符号项相加，得到这个三阶行列式。</p></div>`;
  }
  function answerLabel(q,value){return choiceLike(q)?q.choices[Number(value)]??'未作答':String(value??'未作答')}
  function questionCard(q,context='practice'){
    const previous=context==='practice'&&!redoIds.has(q.id)?state.answers[q.id]:null;
    const value=context==='exam'?currentExam()?.answers[q.id]:previous?.value;
    const name='answer-'+context+'-'+q.id;
    const fields=choiceLike(q)?q.choices.map((choice,i)=>`<label class="option"><input type="radio" name="${name}" value="${i}" ${value!==undefined&&Number(value)===i?'checked':''}><span>${esc(choice)}</span></label>`).join(''):`<label class="numeric-label" for="${name}">填空答案（可输入小数或分数）</label><input class="numeric" id="${name}" name="${name}" inputmode="decimal" value="${esc(value??'')}" autocomplete="off">`;
    const feedback=previous?feedbackHtml(q,previous.correct,previous.value):'';
    return `<article class="card qcard" id="q-${context}-${q.id}"><div class="q-meta"><span class="question-type" data-kind="${q.kind}">${kindNames[q.kind]}</span><span class="tag">${subjects[q.subject].split(' · ')[0]}</span><span class="muted">${esc(lessons.find(l=>l.id===q.lesson)?.focus||'')}</span></div><h3>${esc(q.title)}</h3><p class="prompt">${esc(q.prompt)}</p><form data-question="${q.id}" data-context="${context}">${fields}${context==='practice'?`<div class="q-actions"><button class="btn primary compact" type="submit">检查答案</button><button class="btn compact" type="button" data-retry="${q.id}">重新作答</button></div><details class="hint"><summary>给我一点提示</summary><p>${esc(q.hint)}</p></details><div class="feedback-wrap" aria-live="polite">${feedback}</div>${answerDetails(q)}`:''}</form></article>`;
  }
  function answerDetails(q){return `<details class="answer" data-answer="${q.id}"><summary>点击查看答案与解析</summary><div class="answer-content"><b>参考答案：${esc(answerLabel(q,q.answer))}</b><p>${esc(q.explanation)}</p></div></details>`}
  function feedbackHtml(q,correct,value){return `<div class="feedback ${correct?'ok':'bad'}"><b>${correct?'这一步答对了':'这一步需要订正'}</b><div>你的答案：${esc(answerLabel(q,value))}。${correct?'':'可以先重试，或点击下方查看答案。'}</div><button type="button" class="btn compact" data-lesson="${q.lesson}" style="margin-top:9px">回顾对应知识</button></div>`}
  function updatePracticeOptions(){
    const previous=$('#practice-lesson').value;
    $('#practice-lesson').innerHTML='<option value="all">全部主题</option>'+lessons.filter(l=>inSubject(l)&&questions.some(q=>q.lesson===l.id)).map(l=>`<option value="${l.id}">${esc(l.title)}</option>`).join('');
    if($$('#practice-lesson option').some(o=>o.value===previous))$('#practice-lesson').value=previous;
  }
  function renderPractice(){
    $('#objective-panel').hidden=practiceMode==='proofs';$('#proof-panel').hidden=practiceMode!=='proofs';
    $$('[data-practice-mode]').forEach(b=>{const active=b.dataset.practiceMode===practiceMode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
    if(practiceMode==='proofs'){renderProof();return}
    updatePracticeOptions();
    const lesson=$('#practice-lesson').value;
    const rows=questions.filter(q=>(practiceMode==='objective'||q.kind===practiceMode)&&inSubject(q)&&(lesson==='all'||q.lesson===lesson)&&(!onlyWrong||state.wrong.includes(q.id)));
    $('#practice-count').textContent=rows.length+' 道'+(onlyWrong?'待复习错题':kindNames[practiceMode]||'小题');
    $('#practice-list').innerHTML=rows.map(q=>questionCard(q)).join('')||'<div class="empty">当前没有符合筛选条件的题目。</div>';
  }
  function readAnswer(form){const q=qById[form.dataset.question];return choiceLike(q)?form.querySelector('input:checked')?.value:form.querySelector('.numeric')?.value}
  function recordAnswer(q,raw){
    const result=judge(q,raw);if(!result.valid)return result;
    state.answers[q.id]={value:choiceLike(q)?result.value:String(raw),correct:result.correct,at:new Date().toISOString(),attempts:(state.answers[q.id]?.attempts||0)+1};
    if(result.correct)state.wrong=state.wrong.filter(id=>id!==q.id);else if(!state.wrong.includes(q.id))state.wrong.push(q.id);
    redoIds.delete(q.id);return result;
  }
  function jumpToQuestion(id){
    const q=qById[id];if(!q)return;
    practiceMode='objective';onlyWrong=false;selectSubject(q.subject);updatePracticeOptions();$('#practice-lesson').value=q.lesson;
    redoIds.add(id);go('practice');
    $('#q-practice-'+id)?.scrollIntoView({block:'center'});$('#q-practice-'+id+' input')?.focus({preventScroll:true});
  }
  const checks=['候选值、参数条件与取值范围已写清','误差完整写为 |xₙ−A|，符号处理正确','估计方向正确，使用了足够的条件','任给 ε>0，明确选出正整数 N','对所有 n>N 正向验证误差小于 ε'];
  function renderProof(){
    const rows=proofs.filter(inSubject), p=rows.find(x=>x.id===proofId)||rows[0];proofId=p.id;
    $('#proof-panel').innerHTML=`<label class="muted" for="proof-select">选择大题</label><select id="proof-select" class="proof-select">${rows.map(x=>`<option value="${x.id}" ${x.id===proofId?'selected':''}>${esc(x.title)}</option>`).join('')}</select><div class="proof-grid"><section class="card"><span class="tag">大题练习 · 保留草稿</span><h2 style="margin-top:13px">${esc(p.title)}</h2><p>${esc(p.prompt)}</p><label class="sr-only" for="proof-draft">我的大题草稿</label><textarea id="proof-draft" data-proof-draft="${p.id}" placeholder="写下解题步骤、每一步的依据和最后的结论。">${esc(state.proofDrafts[p.id]||'')}</textarea><p class="muted">输入后自动保存。可在“错题与进度”导出草稿，继续讨论。</p><details class="hint"><summary>只看关键提示</summary><p>${esc(p.hint)}</p></details><details class="answer"><summary>点击查看参考答案与步骤</summary><p class="proof-answer">${esc(p.answer)}</p></details><button class="btn compact" data-lesson="${p.lesson}">回顾对应知识</button></section><aside class="card"><h2>逐项自查</h2><p class="muted">勾选表示你已经自行检查，不是自动判定整题正确。</p><div class="checks">${(p.checks||checks).map((text,i)=>`<label><input type="checkbox" data-proof-check="${i}" ${state.proofChecks[p.id]?.[i]?'checked':''}><span>${text}</span></label>`).join('')}</div><button id="save-proof-review" class="btn primary">记录自查完成</button><div id="proof-review-feedback" aria-live="polite">${state.proofReviews[p.id]?'<p class="feedback ok">已记录自查完成；整题正确性仍需批改。</p>':''}</div></aside></div>`;
  }
  function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
  function startExam(){
    const old=currentExam();
    if(legacyExam)return;
    if(old&&!old.submitted&&!confirm('重新生成会替换本学科未提交的自测。继续吗？'))return;
    const scope=activeSubject,pool=questions.filter(inSubject);
    state.subjectExams[scope]={ids:shuffle(pool).slice(0,10).map(q=>q.id),answers:{},scope,submitted:false};save();renderExam();
  }
  function renderExam(){
    if(!state.exam)legacyExam=false;
    const exam=currentExam();
    $('#exam-scope').textContent=legacyExam?'旧混合自测':subjects[activeSubject];
    $('#legacy-exam').hidden=!state.exam;
    $('#legacy-exam').textContent=legacyExam?'返回当前科目自测':'查看旧混合自测';
    $('#start-exam').hidden=legacyExam;
    if(!exam){$('#exam-area').innerHTML='<div class="empty">生成本学科 10 道小题。只使用已学内容。</div>';return}
    if(exam.submitted){
      const score=exam.ids.filter(id=>judge(qById[id],exam.answers[id]).correct).length;
      $('#exam-area').innerHTML=`<div class="exam-box"><div class="exam-result"><b>本次答对 ${score} / 10 题</b><p class="muted">答案与解析默认折叠，点击查看后订正，再尝试完整大题。</p></div>${exam.ids.map(id=>`<article class="card qcard"><h3>${esc(qById[id].prompt)}</h3>${feedbackHtml(qById[id],judge(qById[id],exam.answers[id]).correct,exam.answers[id])}${answerDetails(qById[id])}</article>`).join('')}</div>`;return;
    }
    $('#exam-area').innerHTML='<div class="exam-box">'+exam.ids.map(id=>questionCard(qById[id],'exam')).join('')+'<button class="btn primary" id="submit-exam">提交自测</button><div id="exam-feedback" aria-live="polite"></div></div>';
  }
  function submitExam(){
    const exam=currentExam();if(!exam||exam.submitted)return;
    const formValues=Object.fromEntries(exam.ids.map(id=>[id,readAnswer($('#q-exam-'+id+' form'))]));
    const missing=exam.ids.find(id=>!judge(qById[id],formValues[id]).valid);
    if(missing){$('#exam-feedback').innerHTML='<p class="feedback neutral">还有题目未作答或数值格式不正确，请补齐后提交。</p>';$('#q-exam-'+missing).scrollIntoView({block:'center'});toast('请先完成全部 10 题');return}
    let score=0;for(const id of exam.ids){exam.answers[id]=formValues[id];if(recordAnswer(qById[id],formValues[id]).correct)score++}
    exam.submitted=true;state.exams.push({score,scope:exam.scope,at:new Date().toISOString()});state.exams=state.exams.slice(-20);save();renderExam();window.scrollTo({top:0,behavior:'instant'});
  }
  function renderProgress(){
    renderStats();
    const wrong=wrongForSubject(), exams=state.exams.filter(e=>e.scope===activeSubject);
    $('#wrong-list').innerHTML=wrong.length?wrong.map(id=>{const q=qById[id];return `<div class="wrong-row"><div><b>${esc(q.title)}</b><p>${esc(q.prompt)}</p></div><button class="btn compact" data-question-jump="${id}">重做</button></div>`}).join(''):'<p class="muted">目前没有待复习错题。回答错误后会自动记录在这里。</p>';
    $('#progress-detail').innerHTML=lessons.filter(inSubject).map(l=>`<div class="progress-row"><span>${esc(l.title)}</span><span>${state.done.includes(l.id)?'已复习':'待复习'}</span></div>`).join('')+'<h3 style="margin-top:22px">大题草稿与自查</h3>'+proofs.filter(inSubject).map(p=>`<div class="progress-row"><button class="btn compact" data-proof="${p.id}">${esc(p.title)}</button><span>${state.proofReviews[p.id]?'已自查':state.proofDrafts[p.id]?.trim()?'有草稿':'待练习'}</span></div>`).join('');
    $('#study-notes').value=state.subjectNotes[activeSubject]||'';
    $('#legacy-notes').hidden=!state.notes;
    $('#legacy-notes-text').textContent=state.notes;
    const legacyHistory=state.exams.filter(e=>e.scope==='all').slice(-5).reverse();
    $('#legacy-history').hidden=!legacyHistory.length;
    $('#legacy-history-list').innerHTML=legacyHistory.map(e=>'<div class="progress-row"><span>'+esc(new Date(e.at).toLocaleDateString('zh-CN'))+'</span><b>'+e.score+' / 10</b></div>').join('');
    $('#exam-history').innerHTML=exams.length?'<h3 style="margin-top:22px">本学科最近自测</h3>'+exams.slice(-5).reverse().map(e=>`<div class="progress-row"><span>${esc(new Date(e.at).toLocaleDateString('zh-CN'))} · ${e.scope==='all'?'综合':e.scope==='algebra'?'线代':'高数'}</span><b>${e.score} / 10</b></div>`).join(''):'';
  }
  function download(name,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function exportQuestions(){
    const lines=['# '+subjects[activeSubject]+'练习与疑问','',new Date().toLocaleString('zh-CN'),'','## 我的疑问',state.subjectNotes[activeSubject]||'尚未记录',''];
    for(const id of wrongForSubject()){const q=qById[id];lines.push('## 待复习：'+q.title,q.prompt,'我的答案：'+answerLabel(q,state.answers[id]?.value),'检查反馈：'+q.explanation,'')}
    for(const p of proofs.filter(inSubject))if(state.proofDrafts[p.id]?.trim())lines.push('## 大题草稿：'+p.title,state.proofDrafts[p.id],'自查状态：'+(state.proofReviews[p.id]?'已自行检查，待批改':'尚未完成自查'),'');
    download('数学练习与疑问.md',lines.join('\n'),'text/markdown;charset=utf-8');toast('已导出疑问和大题草稿');
  }
  document.addEventListener('submit',event=>{
    const form=event.target.closest('form[data-question]');if(!form)return;event.preventDefault();
    if(form.dataset.context==='exam')return;
    const q=qById[form.dataset.question],raw=readAnswer(form),result=recordAnswer(q,raw);
    form.querySelector('.feedback-wrap').innerHTML=result.valid?feedbackHtml(q,result.correct,raw):'<div class="feedback neutral">请先选择答案，或输入有效数值。分母不能为零。</div>';
    if(result.valid)save();
  });
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.subject){
      selectSubject(b.dataset.subject);
      go(currentPage==='home'?'lessons':currentPage);
    }
    else if(b.dataset.graph){go('plot',false);window.MathPlot.preset(b.dataset.graph)}
    else if(b.dataset.page){onlyWrong=false;legacyExam=false;go(b.dataset.page)}
    else if(b.dataset.go){onlyWrong=false;go(b.dataset.go)}
    else if(b.dataset.lesson){selectSubject(lessons.find(l=>l.id===b.dataset.lesson).subject);selectedLesson=b.dataset.lesson;state.lastLesson=selectedLesson;save();go('lessons')}
    else if(b.dataset.markLesson){const id=b.dataset.markLesson;state.done=state.done.includes(id)?state.done.filter(x=>x!==id):[...state.done,id];save();renderLesson()}
    else if(b.dataset.lessonPractice){const l=lessons.find(x=>x.id===b.dataset.lessonPractice),p=proofs.find(x=>x.lesson===l.id);onlyWrong=false;if(!questions.some(q=>q.lesson===l.id)&&p){proofId=p.id;practiceMode='proofs';go('practice',false)}else{practiceMode='objective';updatePracticeOptions();$('#practice-lesson').value=l.id;go('practice',false);if(!questions.some(q=>q.lesson===l.id)){$('#practice-lesson').value='all';renderPractice()}}}
    else if(b.dataset.practiceMode){practiceMode=b.dataset.practiceMode;onlyWrong=false;renderPractice()}
    else if(b.dataset.proof){selectSubject(proofs.find(p=>p.id===b.dataset.proof).subject);proofId=b.dataset.proof;practiceMode='proofs';go('practice',false)}
    else if(b.dataset.retry){redoIds.add(b.dataset.retry);renderPractice();$('#q-practice-'+b.dataset.retry)?.scrollIntoView({block:'center'})}
    else if(b.dataset.questionJump)jumpToQuestion(b.dataset.questionJump);
    else if(b.dataset.swap!==undefined){const i=Number(b.dataset.swap);[perm[i],perm[i+1]]=[perm[i+1],perm[i]];renderPermutation()}
    else if(b.id==='save-proof-review'){
      const flags=state.proofChecks[proofId]||[];
      if(!state.proofDrafts[proofId]?.trim()||flags.length!==5||!flags.every(Boolean)){$('#proof-review-feedback').innerHTML='<p class="feedback neutral">先写出解答，并逐项检查后再记录完成。</p>';return}
      state.proofReviews[proofId]=new Date().toISOString();save();$('#proof-review-feedback').innerHTML='<p class="feedback ok">已记录自查完成；这表示你做了检查，不是自动判定整题正确。</p>';
    }
    else if(b.id==='legacy-exam'){legacyExam=!legacyExam;renderExam()}
    else if(b.id==='start-exam')startExam();
    else if(b.id==='submit-exam')submitExam();
    else if(b.id==='review-wrong'){practiceMode='objective';onlyWrong=true;wrongForSubject().forEach(id=>redoIds.add(id));updatePracticeOptions();$('#practice-lesson').value='all';go('practice',false)}
    else if(b.id==='export-records'){download('大学数学学习记录.json',JSON.stringify({version:1,data:state},null,2),'application/json');toast('已导出学习记录')}
    else if(b.id==='export-questions')exportQuestions();
    else if(b.id==='reset-records'&&confirm('清空当前浏览器的数学记录？建议先导出备份。')){state=blank();selectedLesson=state.lastLesson;redoIds.clear();save();renderProgress();toast('本机数学记录已清空')}
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.id==='lesson-search')renderLessonList();
    else if(el.dataset.proofDraft){state.proofDrafts[el.dataset.proofDraft]=el.value;delete state.proofReviews[el.dataset.proofDraft];save();if($('#proof-review-feedback'))$('#proof-review-feedback').textContent='草稿已修改，请重新自查。'}
    else if(el.id==='study-notes'){state.subjectNotes[activeSubject]=el.value;save()}
    else if(el.closest('form[data-context="exam"]')){
      const exam=currentExam(),form=el.closest('form');
      if(exam&&!exam.submitted){exam.answers[form.dataset.question]=readAnswer(form);save()}
    }
  });
  document.addEventListener('change',async event=>{
    const el=event.target;
    if(el.id==='practice-lesson'){onlyWrong=false;renderPractice()}
    else if(el.id==='proof-select'){proofId=el.value;renderProof()}
    else if(el.dataset.proofCheck!==undefined){const flags=state.proofChecks[proofId]||[false,false,false,false,false];flags[Number(el.dataset.proofCheck)]=el.checked;state.proofChecks[proofId]=flags;delete state.proofReviews[proofId];save();$('#proof-review-feedback').textContent='检查项已更新，请确认后记录完成。'}
    else if(el.id==='perm-select'){perm=el.value.split('').map(Number);renderPermutation()}
    else if(el.id==='import-records'){
      try{
        const file=el.files?.[0];if(!file)return;if(file.size>1024*1024)throw new Error('文件超过 1 MB');
        const backup=JSON.parse(await file.text());if(backup.version!==1)throw new Error('不支持的记录版本');
        const imported=normalize(backup.data);if(!confirm('导入会替换当前记录。是否继续？'))return;
        state=imported;selectedLesson=state.lastLesson;redoIds.clear();save();renderProgress();toast('学习记录已导入');
      }catch(error){toast('导入失败：'+error.message)}finally{el.value=''}
    }
  });
  window.addEventListener('hashchange',route);
  const header=$('.top');
  new ResizeObserver(()=>document.documentElement.style.setProperty('--header-height',header.offsetHeight+'px')).observe(header);
  route();
  if(!storageAvailable)toast('记录暂时无法读取或保存，请使用导出备份');
})();
